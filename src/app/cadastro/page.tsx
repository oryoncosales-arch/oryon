"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export default function CadastroPage() {
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setSucesso(null);
    setLoading(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signUp({
        email,
        password: senha,
        options: {
          data: { nome },
        },
      });

      if (error) {
        setErro(error.message);
        return;
      }

      setSucesso("Confirme seu email para continuar");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#080808] text-white flex items-center justify-center px-6">
      <div className="w-full max-w-md">
        <div className="mb-10">
          <div className="text-center text-3xl font-semibold tracking-[0.2em] text-[#1D9E75]">
            +CONTÁBIL
          </div>
        </div>

        <form
          onSubmit={onSubmit}
          className="rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur"
        >
          <div className="space-y-4">
            <div>
              <label className="block text-sm text-white/80 mb-2">
                Nome completo
              </label>
              <input
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                required
                className="w-full rounded-xl bg-black/30 border border-white/10 px-4 py-3 outline-none focus:border-[#5DCAA5]"
                placeholder="Seu nome"
              />
            </div>

            <div>
              <label className="block text-sm text-white/80 mb-2">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full rounded-xl bg-black/30 border border-white/10 px-4 py-3 outline-none focus:border-[#5DCAA5]"
                placeholder="seu@email.com"
              />
            </div>

            <div>
              <label className="block text-sm text-white/80 mb-2">Senha</label>
              <input
                type="password"
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                required
                className="w-full rounded-xl bg-black/30 border border-white/10 px-4 py-3 outline-none focus:border-[#5DCAA5]"
                placeholder="Crie uma senha"
              />
            </div>

            {erro ? <div className="text-sm text-red-500">{erro}</div> : null}
            {sucesso ? (
              <div className="text-sm text-[#5DCAA5]">{sucesso}</div>
            ) : null}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-[#1D9E75] py-3 font-semibold text-black hover:brightness-110 disabled:opacity-60"
            >
              {loading ? "Criando..." : "Criar conta"}
            </button>
          </div>

          <div className="mt-6 text-center text-sm text-white/70">
            Já tem conta?{" "}
            <Link className="text-[#5DCAA5] hover:underline" href="/login">
              Entrar
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}

