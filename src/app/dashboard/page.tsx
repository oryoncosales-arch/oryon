import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import DashboardClient from "./DashboardClient";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: escritorio } = await supabase
    .from("escritorios")
    .select("*")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  if (!escritorio) redirect("/onboarding");

  const { data: empresas } = await supabase
    .from("empresas")
    .select("*")
    .eq("escritorio_id", escritorio.id)
    .order("created_at", { ascending: true });

  const empresaIds = (empresas ?? []).map((e) => e.id);

  const { data: contratos } =
    empresaIds.length > 0
      ? await supabase
          .from("contratos")
          .select("*")
          .in("empresa_id", empresaIds)
          .order("created_at", { ascending: false })
      : { data: [] as never[] };

  return (
    <DashboardClient
      user={user}
      escritorio={escritorio}
      empresas={empresas ?? []}
      contratos={contratos ?? []}
    />
  );
}
