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

    const body = (await req.json()) as { funcionarioId?: string };
    const funcionarioId =
      typeof body.funcionarioId === "string" ? body.funcionarioId : "";

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

    const { error: updErr } = await admin
      .from("funcionarios")
      .update({ ativo: false })
      .eq("id", funcionarioId);

    if (updErr) {
      return NextResponse.json({ error: updErr.message }, { status: 500 });
    }

    return NextResponse.json({ sucesso: true });
  } catch (e) {
    console.error("POST /api/funcionarios/desativar:", e);
    return NextResponse.json({ error: "Erro ao desativar" }, { status: 500 });
  }
}
