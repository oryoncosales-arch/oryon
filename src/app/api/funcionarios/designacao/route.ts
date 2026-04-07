export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

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
      funcionarioId?: string;
      empresaIds?: string[];
    };

    const funcionarioId =
      typeof body.funcionarioId === "string" ? body.funcionarioId : "";
    const empresaIds = Array.isArray(body.empresaIds)
      ? body.empresaIds.filter((id): id is string => typeof id === "string" && id.length > 0)
      : [];

    if (!funcionarioId) {
      return NextResponse.json({ error: "funcionarioId obrigatório" }, { status: 400 });
    }

    const admin = createAdminClient();

    const { data: funcRow, error: funcErr } = await admin
      .from("funcionarios")
      .select("id, escritorio_id")
      .eq("id", funcionarioId)
      .single();

    if (funcErr || !funcRow) {
      return NextResponse.json({ error: "Funcionário não encontrado" }, { status: 404 });
    }

    const dono = await usuarioEhDonoDoEscritorio(supabase, user.id, funcRow.escritorio_id);
    if (!dono) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }

    if (empresaIds.length) {
      const { data: empresasValidas } = await admin
        .from("empresas")
        .select("id")
        .eq("escritorio_id", funcRow.escritorio_id)
        .in("id", empresaIds);

      const validSet = new Set((empresasValidas ?? []).map((e) => e.id));
      for (const id of empresaIds) {
        if (!validSet.has(id)) {
          return NextResponse.json(
            { error: "Uma ou mais empresas são inválidas" },
            { status: 400 },
          );
        }
      }
    }

    const { error: delErr } = await admin
      .from("funcionario_empresas")
      .delete()
      .eq("funcionario_id", funcionarioId);

    if (delErr) {
      console.error("delete funcionario_empresas:", delErr);
      return NextResponse.json({ error: delErr.message }, { status: 500 });
    }

    if (empresaIds.length) {
      const { error: insErr } = await admin.from("funcionario_empresas").insert(
        empresaIds.map((empresa_id) => ({ funcionario_id: funcionarioId, empresa_id })),
      );
      if (insErr) {
        console.error("insert funcionario_empresas:", insErr);
        return NextResponse.json({ error: insErr.message }, { status: 500 });
      }
    }

    const { data: fullRow } = await admin
      .from("funcionarios")
      .select("*, funcionario_empresas(empresa_id)")
      .eq("id", funcionarioId)
      .single();

    return NextResponse.json({ sucesso: true, funcionario: fullRow });
  } catch (e) {
    console.error("POST /api/funcionarios/designacao:", e);
    return NextResponse.json({ error: "Erro ao salvar designações" }, { status: 500 });
  }
}
