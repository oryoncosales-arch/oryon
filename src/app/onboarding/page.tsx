"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

function formatCnpj(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 14);
  const p1 = digits.slice(0, 2);
  const p2 = digits.slice(2, 5);
  const p3 = digits.slice(5, 8);
  const p4 = digits.slice(8, 12);
  const p5 = digits.slice(12, 14);

  let out = p1;
  if (digits.length > 2) out += `.${p2}`;
  if (digits.length > 5) out += `.${p3}`;
  if (digits.length > 8) out += `/${p4}`;
  if (digits.length > 12) out += `-${p5}`;
  return out;
}

export default function OnboardingPage() {
  const router = useRouter();

  const [step, setStep] = useState<1 | 2>(1);
  const [userId, setUserId] = useState<string | null>(null);

  const [nomeEscritorio, setNomeEscritorio] = useState("");
  const [escritorioId, setEscritorioId] = useState<string | null>(null);

  const [nomeEmpresa, setNomeEmpresa] = useState("");
  const [cnpj, setCnpj] = useState("");

  const [erro, setErro] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const progress = useMemo(
    () => (step === 1 ? [true, false] : [true, true]),
    [step],
  );

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (cancelled) return;
      if (!user) {
        router.replace("/login");
        return;
      }
      setUserId(user.id);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function salvarEscritorio(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);

    if (!userId) {
      setErro("Sessão inválida. Faça login novamente.");
      return;
    }

    setLoading(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("escritorios")
        .insert({
          user_id: userId,
          nome: nomeEscritorio.trim(),
        })
        .select("id")
        .single();

      if (error) {
        setErro(error.message);
        return;
      }

      setEscritorioId(data.id);
      setStep(2);
    } finally {
      setLoading(false);
    }
  }

  async function salvarEmpresa(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);

    if (!escritorioId) {
      setErro("Escritório não encontrado. Volte e tente novamente.");
      return;
    }

    setLoading(true);
    try {
      const supabase = createClient();
      const cnpjDigits = cnpj.replace(/\D/g, "");
      const { error } = await supabase.from("empresas").insert({
        escritorio_id: escritorioId,
        nome: nomeEmpresa.trim(),
        cnpj: cnpjDigits.length ? cnpjDigits : null,
      });

      if (error) {
        setErro(error.message);
        return;
      }

      router.replace("/dashboard");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#080808] text-white flex items-center justify-center px-6">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <div className="text-3xl font-semibold tracking-[0.2em] text-[#1D9E75]">
            +CONTÁBIL
          </div>
        </div>

        <div className="mb-4 flex items-center justify-center gap-2">
          <div
            className={`h-3 w-3 rounded-full ${
              progress[0] ? "bg-[#1D9E75]" : "bg-white/20"
            }`}
            aria-label="Passo 1"
          />
          <div
            className={`h-3 w-3 rounded-full ${
              progress[1] ? "bg-[#1D9E75]" : "bg-white/20"
            }`}
            aria-label="Passo 2"
          />
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur">
          {step === 1 ? (
            <form onSubmit={salvarEscritorio} className="space-y-4">
              <div className="text-lg font-semibold">Sobre seu escritório</div>

              <div>
                <label className="block text-sm text-white/80 mb-2">
                  Nome do escritório
                </label>
                <input
                  value={nomeEscritorio}
                  onChange={(e) => setNomeEscritorio(e.target.value)}
                  required
                  className="w-full rounded-xl bg-black/30 border border-white/10 px-4 py-3 outline-none focus:border-[#5DCAA5]"
                  placeholder="Ex: Oryon Advocacia"
                />
              </div>

              {erro ? <div className="text-sm text-red-500">{erro}</div> : null}

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-xl bg-[#1D9E75] py-3 font-semibold text-black hover:brightness-110 disabled:opacity-60"
              >
                {loading ? "Salvando..." : "Continuar"}
              </button>
            </form>
          ) : (
            <form onSubmit={salvarEmpresa} className="space-y-4">
              <div className="text-lg font-semibold">
                Adicione sua primeira empresa
              </div>

              <div>
                <label className="block text-sm text-white/80 mb-2">
                  Nome da empresa
                </label>
                <input
                  value={nomeEmpresa}
                  onChange={(e) => setNomeEmpresa(e.target.value)}
                  required
                  className="w-full rounded-xl bg-black/30 border border-white/10 px-4 py-3 outline-none focus:border-[#5DCAA5]"
                  placeholder="Ex: ACME LTDA"
                />
              </div>

              <div>
                <label className="block text-sm text-white/80 mb-2">CNPJ</label>
                <input
                  value={cnpj}
                  onChange={(e) => setCnpj(formatCnpj(e.target.value))}
                  inputMode="numeric"
                  className="w-full rounded-xl bg-black/30 border border-white/10 px-4 py-3 outline-none focus:border-[#5DCAA5]"
                  placeholder="12.345.678/0001-90"
                />
              </div>

              {erro ? <div className="text-sm text-red-500">{erro}</div> : null}

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-xl bg-[#1D9E75] py-3 font-semibold text-black hover:brightness-110 disabled:opacity-60"
              >
                {loading ? "Salvando..." : "Entrar no +Contábil"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

