export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

type Cargo = "socio" | "contador" | "assistente";

async function usuarioEhDonoDoEscritorio(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  escritorioId: string,
) {
  const { data } = await supabase
    .from("escritorios")
    .select("id")
    .eq("id", escritorioId)
    .eq("user_id", userId)
    .maybeSingle();
  return !!data;
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    const body = (await req.json()) as {
      nome?: string;
      email?: string;
      cargo?: Cargo;
      escritorioId?: string;
      empresaIds?: string[];
    };

    const nome = typeof body.nome === "string" ? body.nome.trim() : "";
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const cargo = body.cargo;
    const escritorioId = typeof body.escritorioId === "string" ? body.escritorioId : "";
    const empresaIds = Array.isArray(body.empresaIds)
      ? body.empresaIds.filter((id): id is string => typeof id === "string" && id.length > 0)
      : [];

    if (!nome || !email || !escritorioId) {
      return NextResponse.json({ error: "Dados incompletos" }, { status: 400 });
    }

    if (cargo !== "socio" && cargo !== "contador" && cargo !== "assistente") {
      return NextResponse.json({ error: "Cargo inválido" }, { status: 400 });
    }

    const dono = await usuarioEhDonoDoEscritorio(supabase, user.id, escritorioId);
    if (!dono) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }

    if (empresaIds.length) {
      const { data: empresasValidas } = await supabase
        .from("empresas")
        .select("id")
        .eq("escritorio_id", escritorioId)
        .in("id", empresaIds);

      const validSet = new Set((empresasValidas ?? []).map((e) => e.id));
      for (const id of empresaIds) {
        if (!validSet.has(id)) {
          return NextResponse.json(
            { error: "Uma ou mais empresas são inválidas para este escritório" },
            { status: 400 },
          );
        }
      }
    }

    const admin = createAdminClient();

    const { data: inviteData, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(
      email,
      {
        data: {
          nome,
          escritorio_id: escritorioId,
          cargo,
        },
      },
    );

    if (inviteErr) {
      console.error("inviteUserByEmail:", inviteErr);
      return NextResponse.json(
        { error: inviteErr.message ?? "Falha ao convidar usuário" },
        { status: 422 },
      );
    }

    const newUserId = inviteData?.user?.id ?? null;

    const { data: funcionario, error: insertFuncErr } = await admin
      .from("funcionarios")
      .insert({
        escritorio_id: escritorioId,
        nome,
        email,
        cargo,
        user_id: newUserId,
        ativo: true,
        salario: null,
        dia_pagamento: null,
        comissao_percentual: null,
      })
      .select("*")
      .single();

    if (insertFuncErr || !funcionario) {
      console.error("insert funcionario:", insertFuncErr);
      return NextResponse.json(
        { error: insertFuncErr?.message ?? "Falha ao criar funcionário" },
        { status: 500 },
      );
    }

    if (empresaIds.length) {
      const rows = empresaIds.map((empresa_id) => ({
        funcionario_id: funcionario.id,
        empresa_id,
      }));
      const { error: linkErr } = await admin.from("funcionario_empresas").insert(rows);
      if (linkErr) {
        console.error("insert funcionario_empresas:", linkErr);
        return NextResponse.json(
          { error: linkErr.message ?? "Falha ao vincular empresas" },
          { status: 500 },
        );
      }
    }

    const { data: fullRow } = await admin
      .from("funcionarios")
      .select("*, funcionario_empresas(empresa_id)")
      .eq("id", funcionario.id)
      .single();

    return NextResponse.json({ sucesso: true, funcionario: fullRow ?? funcionario });
  } catch (e) {
    console.error("POST /api/funcionarios:", e);
    return NextResponse.json({ error: "Erro ao criar funcionário" }, { status: 500 });
  }
}
