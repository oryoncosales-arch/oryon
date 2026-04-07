export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import type { ContentBlockParam } from "@anthropic-ai/sdk/resources/messages";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/** PDFs acima disso (bytes decodificados do base64) viram texto via pdf-parse para reduzir payload ao Claude. */
const PDF_TEXT_EXTRACT_THRESHOLD_BYTES = 3 * 1024 * 1024;

const SYSTEM_PROMPT = `Você é um classificador financeiro especializado em extratos bancários brasileiros.
Receba as linhas do extrato e retorne APENAS um JSON array válido.
Cada objeto deve ter exatamente estes campos:
- data: string no formato YYYY-MM-DD
- descricao: string com a descrição da transação
- valor: number positivo
- tipo: "entrada" ou "saida"
- categoria: uma das opções: "Receita" | "Despesa Operacional" | "Folha de Pagamento" | "Impostos" | "Fornecedores" | "Aluguel" | "Utilities" | "Taxas Bancárias" | "Transferência" | "Outros"

Regras:
- Se o valor for negativo no extrato, tipo = "saida" e valor = Math.abs(valor)
- Se o valor for positivo, tipo = "entrada"
- Interprete datas em qualquer formato brasileiro e converta para YYYY-MM-DD
- Se uma linha não for uma transação válida, ignore
- Retorne APENAS o JSON array, sem markdown, sem explicação, sem texto adicional`;

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

    if (hasText) {
      userContent = `Classifique este extrato bancário:\n\n${extrato}`;
    } else if (tipo === "application/pdf") {
      const pdfBuffer = Buffer.from(arquivo, "base64");

      if (pdfBuffer.length > PDF_TEXT_EXTRACT_THRESHOLD_BYTES) {
        const { PDFParse } = await import("pdf-parse");
        const parser = new PDFParse({ data: pdfBuffer });
        try {
          const textResult = await parser.getText();
          const textoExtraido = textResult.text?.trim() ?? "";
          if (!textoExtraido) {
            return NextResponse.json(
              {
                erro:
                  "Não foi possível extrair texto deste PDF. Envie CSV/TXT ou um PDF com camada de texto.",
              },
              { status: 422 },
            );
          }
          userContent = `Classifique este extrato bancário:\n\n${textoExtraido}`;
        } finally {
          await parser.destroy();
        }
      } else {
        userContent = [
          {
            type: "document",
            source: {
              type: "base64",
              media_type: "application/pdf",
              data: arquivo,
            },
          },
          {
            type: "text",
            text: "Classifique este extrato bancário.",
          },
        ];
      }
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
          text: "Classifique este extrato bancário.",
        },
      ];
    }

    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 4000,
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
      // Se o JSON foi cortado, tenta encontrar o último objeto completo
      const lastBracket = clean.lastIndexOf("}");
      const fixedClean =
        lastBracket !== -1 ? clean.slice(0, lastBracket + 1) + "]" : clean;
      const jsonStr = fixedClean.startsWith("[") ? fixedClean : "[" + fixedClean;
      transacoes = JSON.parse(jsonStr);
    } catch {
      // Tenta parse direto como fallback
      try {
        transacoes = JSON.parse(content.text);
      } catch {
        throw new Error("Não foi possível interpretar a resposta do classificador.");
      }
    }

    if (!Array.isArray(transacoes)) throw new Error("Formato inválido");

    const totalEntradas = transacoes
      .filter((t) => t.tipo === "entrada")
      .reduce((acc, t) => acc + t.valor, 0);

    const totalSaidas = transacoes
      .filter((t) => t.tipo === "saida")
      .reduce((acc, t) => acc + t.valor, 0);

    const porCategoria = transacoes.reduce<Record<string, number>>((acc, t) => {
      acc[t.categoria] = (acc[t.categoria] || 0) + t.valor;
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
    });
  } catch (error) {
    console.error("Erro no classificador:", error);
    return NextResponse.json(
      { erro: "Erro ao classificar extrato." },
      { status: 500 }
    );
  }
}
