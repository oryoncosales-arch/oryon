export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import type { ContentBlockParam } from "@anthropic-ai/sdk/resources/messages";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT =
  'Classificador de extratos bancários BR. Retorne APENAS JSON array:\n' +
  '[{data:YYYY-MM-DD,descricao:string,valor:number,tipo:entrada|saida,categoria:Receita|Despesa Operacional|Folha de Pagamento|Impostos|Fornecedores|Aluguel|Utilities|Taxas Bancárias|Transferência|Outros}]\n' +
  'Regras: valor sempre positivo, tipo por sinal (crédito=entrada, débito=saida), sem markdown, inclua TODAS as transações sem omitir nenhuma.';

function hashExtratoSimples(extrato: string) {
  const seed = `${extrato.slice(0, 500)}::${extrato.length}`;
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) {
    h = (h * 31 + seed.charCodeAt(i)) % 1_000_000_007;
  }
  return `h${h}_${extrato.length}`;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as unknown;
    const extrato =
      typeof body === "object" && body !== null && "extrato" in body
        ? (body as any).extrato
        : undefined;
    const arquivo =
      typeof body === "object" && body !== null && "arquivo" in body
        ? (body as any).arquivo
        : undefined;
    const tipo =
      typeof body === "object" && body !== null && "tipo" in body
        ? (body as any).tipo
        : undefined;

    const hasText = typeof extrato === "string" && extrato.trim().length > 0;
    const hasFile =
      typeof arquivo === "string" &&
      arquivo.trim().length > 0 &&
      typeof tipo === "string" &&
      tipo.trim().length > 0;

    if (!hasText && !hasFile) {
      return NextResponse.json(
        { erro: "Envie { extrato: string } ou { arquivo: base64, tipo: mime }." },
        { status: 400 }
      );
    }

    let userContent: string | ContentBlockParam[];
    const extratoHash = hasText ? hashExtratoSimples(extrato) : null;

    if (hasText) {
      // Cache: tenta reutilizar classificação salva
      try {
        const supabase = await createSupabaseClient();
        const { data: cachedRows, error } = await supabase
          .from("transacoes")
          .select("data,descricao,valor,tipo,categoria")
          .eq("extrato_hash", extratoHash)
          .order("data", { ascending: true });

        if (!error && Array.isArray(cachedRows) && cachedRows.length > 0) {
          const transacoes = cachedRows as any[];
          const totalEntradas = transacoes
            .filter((t) => t.tipo === "entrada")
            .reduce((acc, t) => acc + Number(t.valor || 0), 0);
          const totalSaidas = transacoes
            .filter((t) => t.tipo === "saida")
            .reduce((acc, t) => acc + Number(t.valor || 0), 0);
          const porCategoria = transacoes.reduce<Record<string, number>>((acc, t) => {
            const k = String(t.categoria ?? "Outros");
            acc[k] = (acc[k] || 0) + Number(t.valor || 0);
            return acc;
          }, {});

          return NextResponse.json({
            transacoes,
            resumo: {
              totalEntradas,
              totalSaidas,
              saldo: totalEntradas - totalSaidas,
              porCategoria,
            },
            extratoHash,
            cacheHit: true,
          });
        }
      } catch {
        // Se falhar, segue sem cache
      }

      userContent = `Classifique TODAS as transações deste extrato bancário sem omitir nenhuma:\n\n${extrato}`;
    } else {
      userContent = [
        {
          type: "image",
          source: {
            type: "base64",
            media_type: tipo,
            data: arquivo,
          },
        },
        {
          type: "text",
          text: "Classifique TODAS as transações deste extrato bancário sem omitir nenhuma.",
        },
      ];
    }

    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 8000,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: userContent,
        },
      ],
    });

    const content = response.content[0];
    if (content.type !== "text") throw new Error("Resposta inválida");

    let transacoes;
    try {
      const clean = content.text.replace(/```json|```/g, "").trim();

      let jsonStr = clean;
      if (!jsonStr.startsWith("[")) jsonStr = "[" + jsonStr;

      if (!jsonStr.endsWith("]")) {
        const lastBracket = jsonStr.lastIndexOf("}");
        if (lastBracket !== -1) {
          jsonStr = jsonStr.slice(0, lastBracket + 1) + "]";
        } else {
          jsonStr = jsonStr + "]";
        }
      }

      transacoes = JSON.parse(jsonStr);
    } catch {
      try {
        transacoes = JSON.parse(content.text);
      } catch {
        throw new Error("Não foi possível interpretar a resposta do classificador.");
      }
    }

    if (!Array.isArray(transacoes)) throw new Error("Formato inválido");

    const totalEntradas = transacoes
      .filter((t) => t.tipo === "entrada")
      .reduce((acc, t) => acc + Number(t.valor || 0), 0);

    const totalSaidas = transacoes
      .filter((t) => t.tipo === "saida")
      .reduce((acc, t) => acc + Number(t.valor || 0), 0);

    const porCategoria = transacoes.reduce<Record<string, number>>((acc, t) => {
      acc[t.categoria] = (acc[t.categoria] || 0) + Number(t.valor || 0);
      return acc;
    }, {});

    return NextResponse.json({
      transacoes,
      resumo: {
        totalEntradas,
        totalSaidas,
        saldo: totalEntradas - totalSaidas,
        porCategoria,
      },
      extratoHash,
      cacheHit: false,
    });
  } catch (error) {
    console.error("Erro no classificador:", error);
    return NextResponse.json(
      { erro: "Erro ao classificar extrato." },
      { status: 500 }
    );
  }
}