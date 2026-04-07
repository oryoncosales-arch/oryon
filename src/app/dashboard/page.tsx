import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import DashboardClient from "./DashboardClient";

export const dynamic = "force-dynamic";

type MeuPerfilRow = {
  id: string;
  escritorio_id: string;
  user_id: string | null;
  nome: string;
  email: string;
  cargo: "socio" | "contador" | "assistente";
  ativo: boolean;
  salario?: number | null;
  dia_pagamento?: number | null;
  comissao_percentual?: number | null;
  funcionario_empresas: { empresa_id: string }[] | null;
};

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: escritorioDono } = await supabase
    .from("escritorios")
    .select("*")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  const isOwner = !!escritorioDono;
  let escritorio = escritorioDono;
  let meuPerfilFuncionario: MeuPerfilRow | null = null;

  if (!escritorio) {
    const { data: perfil } = await supabase
      .from("funcionarios")
      .select("*, funcionario_empresas(empresa_id)")
      .eq("user_id", user.id)
      .eq("ativo", true)
      .maybeSingle();

    if (!perfil) redirect("/onboarding");

    const { data: escRow, error: escErr } = await supabase
      .from("escritorios")
      .select("*")
      .eq("id", perfil.escritorio_id)
      .single();

    if (escErr || !escRow) redirect("/onboarding");

    escritorio = escRow;
    meuPerfilFuncionario = perfil as MeuPerfilRow;
  }

  const { data: empresasTodasRaw } = await supabase
    .from("empresas")
    .select("*")
    .eq("escritorio_id", escritorio.id)
    .order("created_at", { ascending: true });

  const empresasTodas = empresasTodasRaw ?? [];

  let empresas = empresasTodas;
  if (!isOwner && meuPerfilFuncionario && meuPerfilFuncionario.cargo !== "socio") {
    const allowed = new Set(
      (meuPerfilFuncionario.funcionario_empresas ?? []).map((x) => x.empresa_id),
    );
    empresas = empresasTodas.filter((e) => allowed.has(e.id));
  }

  const empresaIdsForContratos =
    isOwner || meuPerfilFuncionario?.cargo === "socio"
      ? empresasTodas.map((e) => e.id)
      : empresas.map((e) => e.id);

  const { data: contratos } =
    empresaIdsForContratos.length > 0
      ? await supabase
          .from("contratos")
          .select("*")
          .in("empresa_id", empresaIdsForContratos)
          .order("created_at", { ascending: false })
      : { data: [] as never[] };

  const { data: funcionarios } = await supabase
    .from("funcionarios")
    .select("*, funcionario_empresas(empresa_id)")
    .eq("escritorio_id", escritorio.id)
    .order("created_at", { ascending: true });

  return (
    <DashboardClient
      user={{ id: user.id, email: user.email ?? undefined }}
      escritorio={escritorio}
      empresas={empresas}
      empresasEscritorio={empresasTodas}
      contratos={contratos ?? []}
      funcionarios={funcionarios ?? []}
      isOwner={isOwner}
      initialMeuPerfil={meuPerfilFuncionario}
    />
  );
}
