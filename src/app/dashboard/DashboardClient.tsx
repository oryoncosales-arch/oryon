"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import * as pdfjsLib from "pdfjs-dist";
import { createClient } from "@/lib/supabase/client";

pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

type TabKey = "upload" | "diagnostico" | "chat" | "acoes";

type Escritorio = {
  id: string;
  user_id: string;
  nome: string;
  created_at?: string;
};

type Empresa = {
  id: string;
  escritorio_id: string;
  nome: string;
  cnpj?: string | null;
  created_at?: string;
};

type AuthedUser = {
  id: string;
  email?: string;
};

type Transacao = {
  data: string; // YYYY-MM-DD
  descricao: string;
  valor: number;
  tipo: "entrada" | "saida";
  categoria:
    | "Receita"
    | "Despesa Operacional"
    | "Folha de Pagamento"
    | "Impostos"
    | "Fornecedores"
    | "Aluguel"
    | "Utilities"
    | "Taxas Bancárias"
    | "Transferência"
    | "Outros";
};

type Resumo = {
  totalEntradas: number;
  totalSaidas: number;
  saldo: number;
  porCategoria: Record<string, number>;
};

type Diagnostico = {
  saude_financeira: "boa" | "regular" | "critica";
  score: number;
  resumo: string;
  problemas: string[];
  oportunidades: string[];
  sugestoes: string[];
  maiores_gastos: { categoria: string; valor: number; percentual: number }[];
};

type Acao = {
  destinatario: string;
  assunto: string;
  mensagem: string;
  prioridade: "baixa" | "media" | "alta";
};

type ChatMsg = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

type ContratoStatus = "ativo" | "inadimplente" | "cancelado";

type Contrato = {
  id: string;
  empresa_id: string;
  valor_mensal: number;
  dia_vencimento: number;
  data_inicio: string;
  status: ContratoStatus;
  created_at?: string;
};

type Secao = "escritorio" | "empresa";
type PaginaEscritorio = "visao-geral" | "clientes" | "contratos" | "cobrancas";

const money = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const TRANSACOES_POR_PAGINA = 15;

function formatDatePtBR(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("pt-BR");
}

function clsx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

async function extrairTextoPdf(file: File): Promise<string> {
  const data = new Uint8Array(await file.arrayBuffer());
  const task = pdfjsLib.getDocument({ data });
  const pdf = await task.promise;
  const chunks: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const line = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ");
    chunks.push(line);
  }
  return chunks.join("\n");
}

function consolidarResultadosClassificador(
  partes: { transacoes: Transacao[]; resumo: Resumo }[],
): { transacoes: Transacao[]; resumo: Resumo } {
  const transacoes = partes.flatMap((p) => p.transacoes);
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
  return {
    transacoes,
    resumo: {
      totalEntradas,
      totalSaidas,
      saldo: totalEntradas - totalSaidas,
      porCategoria,
    },
  };
}

function daysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/** Próxima data de vencimento a partir de `from` (usa dia do mês, ajusta fim de mês). */
function nextDueDate(diaVencimento: number, from: Date): Date {
  const y = from.getFullYear();
  const m = from.getMonth();
  const dim = daysInMonth(y, m);
  const day = Math.min(Math.max(1, diaVencimento), dim);
  let due = new Date(y, m, day, 12, 0, 0, 0);
  const fromNoon = new Date(from.getFullYear(), from.getMonth(), from.getDate(), 12, 0, 0, 0);
  if (due < fromNoon) {
    const nm = m + 1;
    const ny = nm > 11 ? y + 1 : y;
    const nm2 = nm > 11 ? 0 : nm;
    const dim2 = daysInMonth(ny, nm2);
    const day2 = Math.min(Math.max(1, diaVencimento), dim2);
    due = new Date(ny, nm2, day2, 12, 0, 0, 0);
  }
  return due;
}

function formatCnpjDigits(value: string) {
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

function contratoMaisRecente(empresaId: string, contratos: Contrato[]) {
  const list = contratos.filter((c) => c.empresa_id === empresaId);
  if (!list.length) return null;
  return [...list].sort(
    (a, b) =>
      new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime(),
  )[0];
}

function statusBadgeClass(s: ContratoStatus | null) {
  if (s === "ativo") return "bg-[#1D9E75]/15 text-[#5DCAA5] border-[#1D9E75]/25";
  if (s === "inadimplente")
    return "bg-red-500/15 text-red-300 border-red-500/25";
  if (s === "cancelado") return "bg-white/10 text-white/50 border-white/15";
  return "bg-white/10 text-white/45 border-white/15";
}

function UploadIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="text-white/70"
    >
      <path
        d="M12 16V4M12 4L7 9M12 4L17 9"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M4 16.5C4 18.9853 6.01472 21 8.5 21H15.5C17.9853 21 20 18.9853 20 16.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ArrowUpIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M12 19V5M12 5L6 11M12 5L18 11"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ChartIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M4 19V5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M8 19V11"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M12 19V7"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M16 19V13"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M20 19V9"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M7 8H17M7 12H14"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M21 12C21 16.4183 16.9706 20 12 20C10.9109 20 9.86696 19.8279 8.9 19.5143L3 21L4.7 16.6C4.24694 15.8267 4 14.9437 4 14C4 9.58172 8.02944 6 13 6C17.9706 6 21 7.58172 21 12Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function BoltIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M13 2L3 14H11L9 22L21 9H13L13 2Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function GridIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M4 4H10V10H4V4Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M14 4H20V10H14V4Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M4 14H10V20H4V14Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M14 14H20V20H14V14Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

function PeopleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M17 21V19C17 16.7909 15.2091 15 13 15H7C4.79086 15 3 16.7909 3 19V21"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M10 11C12.2091 11 14 9.20914 14 7C14 4.79086 12.2091 3 10 3C7.79086 3 6 4.79086 6 7C6 9.20914 7.79086 11 10 11Z"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M21 21V19C21 17.3431 19.6569 16 18 16"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M16 3.13C17.8598 3.65 19.1402 5.34 19.1402 7.25C19.1402 9.16 17.8598 10.85 16 11.37"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function DocumentIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M7 3H15L19 7V21H7V3Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M15 3V8H19" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M9 13H15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M9 17H13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function DollarIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M12 3V21M17 8.5C17 6.01472 14.7614 4 12 4C9.23858 4 7 6.01472 7 8.5C7 10.9853 9.23858 13 12 13C14.7614 13 17 15.0147 17 17.5C17 19.9853 14.7614 22 12 22C9.23858 22 7 19.9853 7 17.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function Spinner() {
  return (
    <div
      className="h-4 w-4 animate-spin rounded-full border-2 border-[#1D9E75] border-t-transparent"
      aria-label="Carregando"
    />
  );
}

function Dots() {
  return (
    <span className="inline-flex gap-1 align-middle">
      <span className="h-1.5 w-1.5 rounded-full bg-white/50 animate-bounce [animation-delay:0ms]" />
      <span className="h-1.5 w-1.5 rounded-full bg-white/50 animate-bounce [animation-delay:120ms]" />
      <span className="h-1.5 w-1.5 rounded-full bg-white/50 animate-bounce [animation-delay:240ms]" />
    </span>
  );
}

function scoreColor(score: number) {
  if (score > 70) return { ring: "#1D9E75", badge: "Boa", badgeBg: "#1D9E75" };
  if (score >= 40) return { ring: "#EAB308", badge: "Regular", badgeBg: "#EAB308" };
  return { ring: "#EF4444", badge: "Crítica", badgeBg: "#EF4444" };
}

function prioridadeColors(p: Acao["prioridade"]) {
  if (p === "alta") return "bg-[#EF4444]/15 text-[#EF4444] border-[#EF4444]/25";
  if (p === "media") return "bg-[#EAB308]/15 text-[#EAB308] border-[#EAB308]/25";
  return "bg-[#1D9E75]/15 text-[#1D9E75] border-[#1D9E75]/25";
}

function categoriaPill(categoria: string) {
  const key = categoria.toLowerCase();
  if (key.includes("receita")) return "bg-[#1D9E75]/15 text-[#5DCAA5] border-[#1D9E75]/25";
  if (key.includes("impost")) return "bg-[#EAB308]/15 text-[#EAB308] border-[#EAB308]/25";
  if (key.includes("folha")) return "bg-[#60A5FA]/15 text-[#93C5FD] border-[#60A5FA]/25";
  if (key.includes("fornecedor")) return "bg-[#A78BFA]/15 text-[#C4B5FD] border-[#A78BFA]/25";
  if (key.includes("taxa")) return "bg-[#F97316]/15 text-[#FDBA74] border-[#F97316]/25";
  return "bg-white/5 text-white/70 border-white/10";
}

export default function DashboardClient(props: {
  user: AuthedUser;
  escritorio: Escritorio;
  empresas: Empresa[];
  contratos: Contrato[];
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [secao, setSecao] = useState<Secao>("escritorio");
  const [paginaEscritorio, setPaginaEscritorio] =
    useState<PaginaEscritorio>("visao-geral");
  const [empresaSelecionadaId, setEmpresaSelecionadaId] = useState<string | null>(
    null,
  );

  const [abaEmpresa, setAbaEmpresa] = useState<TabKey>("upload");
  const empresaSelecionada = useMemo(
    () => props.empresas.find((e) => e.id === empresaSelecionadaId) ?? null,
    [empresaSelecionadaId, props.empresas],
  );

  const [modalEmpresa, setModalEmpresa] = useState(false);
  const [novaEmpresaNome, setNovaEmpresaNome] = useState("");
  const [novaEmpresaCnpj, setNovaEmpresaCnpj] = useState("");
  const [salvandoEmpresa, setSalvandoEmpresa] = useState(false);

  const [modalContrato, setModalContrato] = useState(false);
  const [novoContratoEmpresaId, setNovoContratoEmpresaId] = useState("");
  const [novoContratoValor, setNovoContratoValor] = useState("");
  const [novoContratoDia, setNovoContratoDia] = useState("");
  const [novoContratoInicio, setNovoContratoInicio] = useState("");
  const [salvandoContrato, setSalvandoContrato] = useState(false);

  const [editingContratoId, setEditingContratoId] = useState<string | null>(null);
  const [avisosEnviados, setAvisosEnviados] = useState<Record<string, boolean>>({});

  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [transacoes, setTransacoes] = useState<Transacao[] | null>(null);
  const [resumo, setResumo] = useState<Resumo | null>(null);
  const [diagnostico, setDiagnostico] = useState<Diagnostico | null>(null);
  const [acoes, setAcoes] = useState<Acao[] | null>(null);
  const [extratoHash, setExtratoHash] = useState<string | null>(null);
  const [paginaTransacoes, setPaginaTransacoes] = useState(1);

  const [mensagens, setMensagens] = useState<ChatMsg[]>([]);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);

  const [uploadLoading, setUploadLoading] = useState(false);
  const [uploadStatusMessage, setUploadStatusMessage] = useState("");
  const [salvarLoading, setSalvarLoading] = useState(false);
  const [acoesLoading, setAcoesLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const empresaNomePorId = useMemo(() => {
    const m = new Map<string, string>();
    props.empresas.forEach((e) => m.set(e.id, e.nome));
    return m;
  }, [props.empresas]);

  const hoje = useMemo(() => startOfDay(new Date()), []);
  const limite7 = useMemo(() => addDays(hoje, 7), [hoje]);

  const contratosAtivos = useMemo(
    () => props.contratos.filter((c) => c.status === "ativo"),
    [props.contratos],
  );

  const ultimosContratos = useMemo(
    () =>
      [...props.contratos].sort(
        (a, b) =>
          new Date(b.created_at ?? 0).getTime() -
          new Date(a.created_at ?? 0).getTime(),
      ),
    [props.contratos],
  );

  const contratosCobranca = useMemo(() => {
    const out: { contrato: Contrato; due: Date; dias: number }[] = [];
    for (const c of contratosAtivos) {
      const due = nextDueDate(c.dia_vencimento, hoje);
      if (due >= hoje && due <= limite7) {
        const dias = Math.round(
          (due.getTime() - hoje.getTime()) / (1000 * 60 * 60 * 24),
        );
        out.push({ contrato: c, due, dias });
      }
    }
    return out.sort((a, b) => a.due.getTime() - b.due.getTime());
  }, [contratosAtivos, hoje, limite7]);

  const visaoGeralKpis = useMemo(() => {
    const ref = new Date();
    const ano = ref.getFullYear();
    const mes = ref.getMonth();

    const ativos = props.contratos.filter((c) => c.status === "ativo");
    const mrr = ativos.reduce((s, c) => s + Number(c.valor_mensal || 0), 0);
    const nAtivos = ativos.length;
    const ticketMedio = nAtivos > 0 ? mrr / nAtivos : 0;

    const inadimplentesList = props.contratos.filter(
      (c) => c.status === "inadimplente",
    );
    const somaInadimplente = inadimplentesList.reduce(
      (s, c) => s + Number(c.valor_mensal || 0),
      0,
    );
    const taxaInadimplenciaPct =
      mrr > 0 ? (somaInadimplente / mrr) * 100 : 0;

    const projecao90 = mrr * 3;

    const createdNoMesAtual = (created_at: string | undefined) => {
      if (!created_at) return false;
      const d = new Date(created_at);
      return d.getFullYear() === ano && d.getMonth() === mes;
    };

    const novosEsteMes = props.contratos.filter((c) =>
      createdNoMesAtual(c.created_at),
    ).length;
    const cancelamentosEsteMes = props.contratos.filter(
      (c) => c.status === "cancelado" && createdNoMesAtual(c.created_at),
    ).length;

    const baseChurn = props.contratos.filter(
      (c) => c.status === "ativo" || c.status === "cancelado",
    ).length;
    const churnRatePct =
      baseChurn > 0 ? (cancelamentosEsteMes / baseChurn) * 100 : 0;

    let vencendoEm7Dias = 0;
    for (const c of ativos) {
      const due = nextDueDate(c.dia_vencimento, hoje);
      if (due >= hoje && due <= limite7) vencendoEm7Dias += 1;
    }

    const inadimplentesCount = inadimplentesList.length;
    const ltvMedio = ticketMedio * 12;
    const totalEmpresas = props.empresas.length;

    return {
      mrr,
      ticketMedio,
      taxaInadimplenciaPct,
      projecao90,
      nAtivos,
      novosEsteMes,
      cancelamentosEsteMes,
      churnRatePct,
      vencendoEm7Dias,
      inadimplentesCount,
      ltvMedio,
      totalEmpresas,
    };
  }, [props.contratos, props.empresas, hoje, limite7]);

  const mrrPorMesChart = useMemo(() => {
    const now = new Date();
    const rows: { label: string; value: number }[] = [];
    for (let i = 5; i >= 0; i -= 1) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const y = d.getFullYear();
      const m = d.getMonth();
      const label = d.toLocaleDateString("pt-BR", {
        month: "short",
        year: "2-digit",
      });
      const value = props.contratos
        .filter((c) => {
          if (c.status !== "ativo") return false;
          const di = new Date(c.data_inicio);
          return di.getFullYear() === y && di.getMonth() === m;
        })
        .reduce((s, c) => s + Number(c.valor_mensal || 0), 0);
      rows.push({ label, value });
    }
    const max = Math.max(...rows.map((r) => r.value), 1);
    return { rows, max };
  }, [props.contratos]);

  const pct1 = useMemo(
    () =>
      new Intl.NumberFormat("pt-BR", {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      }),
    [],
  );

  useEffect(() => {
    setTransacoes(null);
    setResumo(null);
    setDiagnostico(null);
    setAcoes(null);
    setMensagens([]);
    setAbaEmpresa("upload");
  }, [empresaSelecionadaId]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [mensagens, chatLoading]);

  useEffect(() => {
    if (!empresaSelecionada) return;
    if (!transacoes || !resumo) return;
    if (mensagens.length) return;

    setMensagens([
      {
        id: crypto.randomUUID(),
        role: "assistant",
        content: `Olá! Sou seu assistente financeiro. Faça qualquer pergunta sobre os dados de ${empresaSelecionada.nome}.`,
      },
    ]);
  }, [empresaSelecionada, transacoes, resumo, mensagens.length]);

  async function onLogout() {
    setErro(null);
    await supabase.auth.signOut();
    router.replace("/login");
  }

  function irEscritorio(p: PaginaEscritorio) {
    setSecao("escritorio");
    setPaginaEscritorio(p);
  }

  function irEmpresa(id: string) {
    setEmpresaSelecionadaId(id);
    setSecao("empresa");
    setAbaEmpresa("upload");
  }

  async function salvarNovaEmpresa() {
    setErro(null);
    const nome = novaEmpresaNome.trim();
    if (!nome) {
      setErro("Nome da empresa é obrigatório.");
      return;
    }
    setSalvandoEmpresa(true);
    try {
      const cnpjDigits = novaEmpresaCnpj.replace(/\D/g, "");
      const { data, error } = await supabase
        .from("empresas")
        .insert({
          escritorio_id: props.escritorio.id,
          nome,
          cnpj: cnpjDigits.length ? cnpjDigits : null,
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      setModalEmpresa(false);
      setNovaEmpresaNome("");
      setNovaEmpresaCnpj("");
      router.refresh();
      if (data?.id) {
        setEmpresaSelecionadaId(data.id);
        setSecao("empresa");
        setAbaEmpresa("upload");
      }
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao criar empresa.");
    } finally {
      setSalvandoEmpresa(false);
    }
  }

  async function salvarNovoContrato() {
    setErro(null);
    if (!novoContratoEmpresaId) {
      setErro("Selecione uma empresa.");
      return;
    }
    const valor = Number(String(novoContratoValor).replace(",", "."));
    const dia = parseInt(novoContratoDia, 10);
    if (!Number.isFinite(valor) || valor <= 0) {
      setErro("Valor mensal inválido.");
      return;
    }
    if (!Number.isFinite(dia) || dia < 1 || dia > 31) {
      setErro("Dia de vencimento deve ser entre 1 e 31.");
      return;
    }
    if (!novoContratoInicio) {
      setErro("Informe a data de início.");
      return;
    }
    setSalvandoContrato(true);
    try {
      const { error } = await supabase.from("contratos").insert({
        empresa_id: novoContratoEmpresaId,
        valor_mensal: valor,
        dia_vencimento: dia,
        data_inicio: novoContratoInicio,
        status: "ativo",
      });
      if (error) throw new Error(error.message);
      setModalContrato(false);
      setNovoContratoEmpresaId("");
      setNovoContratoValor("");
      setNovoContratoDia("");
      setNovoContratoInicio("");
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao criar contrato.");
    } finally {
      setSalvandoContrato(false);
    }
  }

  async function atualizarStatusContrato(id: string, status: ContratoStatus) {
    setErro(null);
    const { error } = await supabase.from("contratos").update({ status }).eq("id", id);
    if (error) {
      setErro(error.message);
      return;
    }
    setEditingContratoId(null);
    router.refresh();
  }

  function openFilePicker() {
    fileInputRef.current?.click();
  }

  async function handleFile(file: File) {
    setErro(null);
    setUploadLoading(true);
    setUploadStatusMessage("");
    setDiagnostico(null);
    setAcoes(null);
    setMensagens([]);
    setExtratoHash(null);
    setPaginaTransacoes(1);
    try {
      const mime = file.type || "";
      const isText =
        mime === "text/csv" ||
        mime === "text/plain" ||
        file.name.toLowerCase().endsWith(".csv") ||
        file.name.toLowerCase().endsWith(".txt");

      const isPdf =
        mime === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");

      const isImage =
        mime === "image/png" ||
        mime === "image/jpeg" ||
        file.name.toLowerCase().endsWith(".png") ||
        file.name.toLowerCase().endsWith(".jpg") ||
        file.name.toLowerCase().endsWith(".jpeg");

      async function classificarPayload(payload: {
        extrato?: string;
        arquivo?: string;
        tipo?: string;
      }) {
        const res = await fetch("/api/classificador", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j?.erro ?? "Falha ao classificar extrato.");
        }
        return (await res.json()) as {
          transacoes: Transacao[];
          resumo: Resumo;
          extratoHash?: string | null;
        };
      }

      if (isText) {
        const text = await file.text();
        setUploadStatusMessage("Classificando com IA...");
        const data = await classificarPayload({ extrato: text });
        setTransacoes(data.transacoes);
        setResumo(data.resumo);
        setExtratoHash(data.extratoHash ?? null);
      } else if (isImage) {
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const result = reader.result as string;
            resolve(result.split(",")[1]);
          };
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        setUploadStatusMessage("Classificando com IA...");
        const data = await classificarPayload({
          arquivo: base64,
          tipo: mime || "image/jpeg",
        });
        setTransacoes(data.transacoes);
        setResumo(data.resumo);
      } else if (isPdf) {
        setUploadStatusMessage("Extraindo texto do PDF...");

        const dataBytes = new Uint8Array(await file.arrayBuffer());
        const task = pdfjsLib.getDocument({ data: dataBytes });
        const pdf = await task.promise;
        const pageCount = pdf.numPages;

        const extractRange = async (start: number, end: number) => {
          const pieces: string[] = [];
          for (let p = start; p <= end; p += 1) {
            const page = await pdf.getPage(p);
            const content = await page.getTextContent();
            const line = content.items
              .map((item) => ("str" in item ? item.str : ""))
              .join(" ");
            pieces.push(line);
          }
          return pieces.join("\n");
        };

        if (pageCount <= 2) {
          const texto = await extractRange(1, pageCount);
          if (!texto.trim()) {
            throw new Error(
              "Não foi possível extrair texto deste PDF. Tente outro arquivo ou use imagem/CSV.",
            );
          }
          setUploadStatusMessage("Classificando com IA...");
          const data = await classificarPayload({ extrato: texto });
          setTransacoes(data.transacoes);
          setResumo(data.resumo);
        } else {
          const chunkSize = 2;
          const chunks: Array<{ start: number; end: number; idx: number }> = [];
          for (let start = 1, idx = 0; start <= pageCount; start += chunkSize, idx += 1) {
            const end = Math.min(pageCount, start + chunkSize - 1);
            chunks.push({ start, end, idx });
          }

          const results: Array<{ transacoes: Transacao[]; resumo: Resumo } | null> = Array(
            chunks.length,
          ).fill(null);

          let next = 0;
          const worker = async () => {
            while (next < chunks.length) {
              const current = next;
              next += 1;
              const ch = chunks[current];
              setUploadStatusMessage(
                `Processando página ${ch.start}-${ch.end} de ${pageCount}...`,
              );
              const texto = await extractRange(ch.start, ch.end);
              const data = await classificarPayload({ extrato: texto });
              results[ch.idx] = { transacoes: data.transacoes, resumo: data.resumo };
            }
          };

          await Promise.all([worker(), worker()]);
          const merged = consolidarResultadosClassificador(
            results.filter(Boolean) as { transacoes: Transacao[]; resumo: Resumo }[],
          );
          setTransacoes(merged.transacoes);
          setResumo(merged.resumo);
        }
      } else {
        throw new Error("Formato não suportado. Envie PDF, CSV, TXT, PNG ou JPG.");
      }
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao processar arquivo.");
    } finally {
      setUploadLoading(false);
      setUploadStatusMessage("");
    }
  }

  async function onFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    await handleFile(file);
    e.target.value = "";
  }

  async function salvarEAnalisar() {
    setErro(null);
    if (!empresaSelecionada) {
      setErro("Selecione uma empresa.");
      return;
    }
    if (!transacoes || !resumo) {
      setErro("Nenhuma transação para salvar.");
      return;
    }

    setSalvarLoading(true);
    try {
      const payload = transacoes.map((t) => ({
        empresa_id: empresaSelecionada.id,
        data: t.data,
        descricao: t.descricao,
        valor: t.valor,
        tipo: t.tipo,
        categoria: t.categoria,
        ...(extratoHash ? { extrato_hash: extratoHash } : {}),
      }));

      const { error } = await supabase.from("transacoes").insert(payload as any);
      if (error) throw new Error(error.message);

      setAbaEmpresa("diagnostico");
      setDiagnostico(null);

      const res = await fetch("/api/analista", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dados: { transacoes, resumo } }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error ?? "Falha ao gerar diagnóstico.");
      }
      const j = (await res.json()) as { sucesso: boolean; data: Diagnostico };
      setDiagnostico(j.data);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao salvar e analisar.");
    } finally {
      setSalvarLoading(false);
    }
  }

  async function gerarAcoes() {
    setErro(null);
    if (!empresaSelecionada) {
      setErro("Selecione uma empresa.");
      return;
    }
    if (!diagnostico) {
      setErro("Gere um diagnóstico primeiro.");
      return;
    }

    setAcoesLoading(true);
    try {
      const res = await fetch("/api/orquestrador", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          diagnostico,
          empresa: empresaSelecionada,
          contato: { nome: empresaSelecionada.nome },
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error ?? "Falha ao gerar ações.");
      }
      const j = (await res.json()) as { sucesso: boolean; acoes: Acao[] };
      setAcoes(j.acoes ?? []);
      setAbaEmpresa("acoes");
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao gerar ações.");
    } finally {
      setAcoesLoading(false);
    }
  }

  async function enviarChat() {
    setErro(null);
    if (!transacoes || !resumo || !empresaSelecionada) {
      setErro("Importe um extrato para conversar sobre os dados.");
      return;
    }
    const pergunta = chatInput.trim();
    if (!pergunta) return;

    const msgUser: ChatMsg = {
      id: crypto.randomUUID(),
      role: "user",
      content: pergunta,
    };
    setMensagens((m) => [...m, msgUser]);
    setChatInput("");
    setChatLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pergunta, dados: { transacoes, resumo } }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error ?? "Falha ao responder chat.");
      }
      const j = (await res.json()) as { sucesso: boolean; resposta: string };
      setMensagens((m) => [
        ...m,
        { id: crypto.randomUUID(), role: "assistant", content: j.resposta },
      ]);
    } catch (e) {
      setMensagens((m) => [
        ...m,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content:
            "Não consegui responder agora. Tente novamente em alguns segundos.",
        },
      ]);
      setErro(e instanceof Error ? e.message : "Erro no chat.");
    } finally {
      setChatLoading(false);
    }
  }

  const empresaTabItems = useMemo(
    () =>
      [
        { key: "upload" as const, label: "Upload", icon: <ArrowUpIcon /> },
        { key: "diagnostico" as const, label: "Diagnóstico", icon: <ChartIcon /> },
        { key: "chat" as const, label: "Chat", icon: <ChatIcon /> },
        { key: "acoes" as const, label: "Ações", icon: <BoltIcon /> },
      ] as const,
    [],
  );

  const menuEscritorio = useMemo(
    () =>
      [
        { key: "visao-geral" as const, label: "Visão geral", icon: <GridIcon /> },
        { key: "clientes" as const, label: "Clientes", icon: <PeopleIcon /> },
        { key: "contratos" as const, label: "Contratos", icon: <DocumentIcon /> },
        { key: "cobrancas" as const, label: "Cobranças", icon: <DollarIcon /> },
      ] as const,
    [],
  );

  return (
    <div className="min-h-screen bg-[#080808] text-white flex">
      {modalEmpresa ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-4"
          style={{ background: "rgba(0,0,0,0.7)" }}
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-2xl border border-[#1D9E75]/20 bg-[#0d0d0d] p-6 shadow-xl">
            <div className="text-lg font-semibold">Nova empresa</div>
            <div className="mt-4 space-y-3">
              <div>
                <label className="block text-xs text-white/50 mb-1">Nome da empresa</label>
                <input
                  value={novaEmpresaNome}
                  onChange={(e) => setNovaEmpresaNome(e.target.value)}
                  className="w-full rounded-xl bg-black/30 border border-white/10 px-3 py-2 text-sm outline-none focus:border-[#5DCAA5]"
                  placeholder="Razão social"
                />
              </div>
              <div>
                <label className="block text-xs text-white/50 mb-1">CNPJ (opcional)</label>
                <input
                  value={novaEmpresaCnpj}
                  onChange={(e) => setNovaEmpresaCnpj(formatCnpjDigits(e.target.value))}
                  className="w-full rounded-xl bg-black/30 border border-white/10 px-3 py-2 text-sm outline-none focus:border-[#5DCAA5]"
                  placeholder="00.000.000/0000-00"
                />
              </div>
            </div>
            <div className="mt-6 flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setModalEmpresa(false)}
                className="rounded-xl border border-[#1D9E75]/20 px-4 py-2 text-sm font-semibold text-white/90 hover:bg-white/5"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={salvandoEmpresa}
                onClick={() => void salvarNovaEmpresa()}
                className="rounded-xl bg-[#1D9E75] px-4 py-2 text-sm font-semibold text-black hover:brightness-110 disabled:opacity-60"
              >
                {salvandoEmpresa ? "Salvando..." : "Adicionar"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {modalContrato ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-4"
          style={{ background: "rgba(0,0,0,0.7)" }}
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-2xl border border-[#1D9E75]/20 bg-[#0d0d0d] p-6 shadow-xl">
            <div className="text-lg font-semibold">Novo contrato</div>
            <div className="mt-4 space-y-3">
              <div>
                <label className="block text-xs text-white/50 mb-1">Empresa</label>
                <select
                  value={novoContratoEmpresaId}
                  onChange={(e) => setNovoContratoEmpresaId(e.target.value)}
                  className="w-full rounded-xl bg-[#080808] border border-[#1D9E75]/20 px-3 py-2 text-sm outline-none focus:border-[#5DCAA5]"
                >
                  <option value="">Selecione...</option>
                  {props.empresas.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.nome}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-white/50 mb-1">Valor mensal (R$)</label>
                <input
                  value={novoContratoValor}
                  onChange={(e) => setNovoContratoValor(e.target.value)}
                  className="w-full rounded-xl bg-black/30 border border-white/10 px-3 py-2 text-sm outline-none focus:border-[#5DCAA5]"
                  placeholder="1500,00"
                />
              </div>
              <div>
                <label className="block text-xs text-white/50 mb-1">Dia de vencimento</label>
                <input
                  type="number"
                  min={1}
                  max={31}
                  value={novoContratoDia}
                  onChange={(e) => setNovoContratoDia(e.target.value)}
                  className="w-full rounded-xl bg-black/30 border border-white/10 px-3 py-2 text-sm outline-none focus:border-[#5DCAA5]"
                  placeholder="10"
                />
              </div>
              <div>
                <label className="block text-xs text-white/50 mb-1">Data de início</label>
                <input
                  type="date"
                  value={novoContratoInicio}
                  onChange={(e) => setNovoContratoInicio(e.target.value)}
                  className="w-full rounded-xl bg-black/30 border border-white/10 px-3 py-2 text-sm outline-none focus:border-[#5DCAA5]"
                />
              </div>
            </div>
            <div className="mt-6 flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setModalContrato(false)}
                className="rounded-xl border border-[#1D9E75]/20 px-4 py-2 text-sm font-semibold text-white/90 hover:bg-white/5"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={salvandoContrato}
                onClick={() => void salvarNovoContrato()}
                className="rounded-xl bg-[#1D9E75] px-4 py-2 text-sm font-semibold text-black hover:brightness-110 disabled:opacity-60"
              >
                {salvandoContrato ? "Salvando..." : "Salvar"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <aside className="w-[220px] shrink-0 border-r border-[#1D9E75]/15 bg-[#080808] flex flex-col min-h-screen">
        <div className="px-5 pt-6">
          <div className="text-lg font-semibold tracking-[0.18em] text-[#1D9E75]">
            +CONTÁBIL
          </div>
          <div className="mt-2 text-xs text-white/50 truncate">{props.escritorio.nome}</div>
        </div>

        <div className="mt-5 px-5">
          <div className="text-[10px] uppercase tracking-wider text-white/30 font-medium">
            Meu escritório
          </div>
        </div>
        <nav className="mt-2 px-3 space-y-1">
          {menuEscritorio.map((it) => {
            const active = secao === "escritorio" && paginaEscritorio === it.key;
            return (
              <button
                key={it.key}
                type="button"
                onClick={() => irEscritorio(it.key)}
                className={clsx(
                  "w-full flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors",
                  active
                    ? "bg-[#1D9E75]/10 text-white border-l-2 border-[#1D9E75]"
                    : "text-white/40 hover:text-white/70 hover:bg-white/5",
                )}
              >
                <span className={clsx(active ? "text-white" : "text-white/60")}>{it.icon}</span>
                <span className="truncate text-left">{it.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="my-4 mx-5 h-px bg-[#1D9E75]/10" />

        <div className="px-5 flex items-center justify-between gap-2">
          <div className="text-[10px] uppercase tracking-wider text-white/30 font-medium">
            Empresas
          </div>
          <button
            type="button"
            onClick={() => setModalEmpresa(true)}
            className="h-7 w-7 shrink-0 rounded-lg border border-[#1D9E75]/30 text-[#5DCAA5] text-lg leading-none hover:bg-[#1D9E75]/10"
            aria-label="Adicionar empresa"
          >
            +
          </button>
        </div>
        <div className="mt-2 px-3 space-y-1 max-h-[40vh] overflow-y-auto">
          {props.empresas.map((e) => {
            const active = secao === "empresa" && empresaSelecionadaId === e.id;
            return (
              <button
                key={e.id}
                type="button"
                onClick={() => irEmpresa(e.id)}
                className={clsx(
                  "w-full text-left rounded-lg px-3 py-2 text-sm transition-colors truncate",
                  active
                    ? "bg-[#1D9E75]/10 text-white border-l-2 border-[#1D9E75]"
                    : "text-white/40 hover:text-white/70 hover:bg-white/5",
                )}
              >
                {e.nome}
              </button>
            );
          })}
          {!props.empresas.length ? (
            <div className="px-3 text-xs text-white/40">Nenhuma empresa.</div>
          ) : null}
        </div>

        <div className="mt-auto px-5 pb-5 pt-6">
          <button
            type="button"
            onClick={onLogout}
            className="w-full rounded-xl border border-[#1D9E75]/20 bg-white/5 px-4 py-2 text-sm font-semibold text-white hover:bg-[#1D9E75]/10 hover:border-[#1D9E75]/40"
          >
            Sair
          </button>
        </div>
      </aside>

      <main className="flex-1 min-w-0 bg-[#0d0d0d] overflow-x-hidden">
        <div className="p-6 md:p-8 max-w-6xl mx-auto w-full min-w-0">
          {erro ? (
            <div className="mb-4 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
              {erro}
            </div>
          ) : null}

          {secao === "escritorio" && paginaEscritorio === "visao-geral" ? (
            <section className="space-y-6">
              <div>
                <h1 className="text-2xl font-semibold">Visão geral</h1>
                <p className="mt-1 text-sm text-white/50">
                  Atualizado em{" "}
                  {new Date().toLocaleDateString("pt-BR", {
                    day: "2-digit",
                    month: "long",
                    year: "numeric",
                  })}
                </p>
              </div>

              <div>
                <h2 className="text-xs font-medium uppercase tracking-wide text-white/30 mb-2">
                  Financeiro
                </h2>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  <div className="rounded-2xl border border-[#1D9E75]/20 bg-white/5 p-4">
                    <div className="text-xs text-white/50">MRR</div>
                    <div className="mt-1 text-2xl font-semibold text-[#5DCAA5]">
                      {money.format(visaoGeralKpis.mrr)}
                    </div>
                    <div className="mt-1 text-xs text-white/40">
                      Receita mensal recorrente
                    </div>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <div className="text-xs text-white/50">Ticket médio</div>
                    <div className="mt-1 text-2xl font-semibold text-white">
                      {money.format(visaoGeralKpis.ticketMedio)}
                    </div>
                    <div className="mt-1 text-xs text-white/40">Por cliente ativo</div>
                  </div>
                  <div
                    className={clsx(
                      "rounded-2xl border bg-white/5 p-4",
                      visaoGeralKpis.taxaInadimplenciaPct > 10
                        ? "border-red-500/20"
                        : visaoGeralKpis.taxaInadimplenciaPct > 0
                          ? "border-[#EAB308]/20"
                          : "border-[#1D9E75]/20",
                    )}
                  >
                    <div className="text-xs text-white/50">Taxa de inadimplência</div>
                    <div
                      className={clsx(
                        "mt-1 text-2xl font-semibold",
                        visaoGeralKpis.taxaInadimplenciaPct > 10
                          ? "text-red-400"
                          : visaoGeralKpis.taxaInadimplenciaPct > 0
                            ? "text-[#EAB308]"
                            : "text-[#5DCAA5]",
                      )}
                    >
                      {pct1.format(visaoGeralKpis.taxaInadimplenciaPct)}%
                    </div>
                    <div className="mt-1 text-xs text-white/40">Do MRR em risco</div>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <div className="text-xs text-white/50">Projeção 90 dias</div>
                    <div className="mt-1 text-2xl font-semibold text-white">
                      {money.format(visaoGeralKpis.projecao90)}
                    </div>
                    <div className="mt-1 text-xs text-white/40">Receita projetada</div>
                  </div>
                </div>
              </div>

              <div>
                <h2 className="text-xs font-medium uppercase tracking-wide text-white/30 mb-2">
                  Carteira
                </h2>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  <div className="rounded-2xl border border-[#1D9E75]/20 bg-white/5 p-4">
                    <div className="text-xs text-white/50">Clientes ativos</div>
                    <div className="mt-1 text-2xl font-semibold text-[#5DCAA5]">
                      {visaoGeralKpis.nAtivos}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-[#1D9E75]/20 bg-white/5 p-4">
                    <div className="text-xs text-white/50">Novos este mês</div>
                    <div className="mt-1 text-2xl font-semibold text-[#5DCAA5]">
                      {visaoGeralKpis.novosEsteMes}
                    </div>
                    <div className="mt-1 text-xs text-white/40">Contratos iniciados</div>
                  </div>
                  <div
                    className={clsx(
                      "rounded-2xl border bg-white/5 p-4",
                      visaoGeralKpis.cancelamentosEsteMes > 0
                        ? "border-red-500/20"
                        : "border-white/10",
                    )}
                  >
                    <div className="text-xs text-white/50">Cancelamentos este mês</div>
                    <div
                      className={clsx(
                        "mt-1 text-2xl font-semibold",
                        visaoGeralKpis.cancelamentosEsteMes > 0
                          ? "text-red-400"
                          : "text-white",
                      )}
                    >
                      {visaoGeralKpis.cancelamentosEsteMes}
                    </div>
                    <div className="mt-1 text-xs text-white/40">Neste mês</div>
                  </div>
                  <div
                    className={clsx(
                      "rounded-2xl border bg-white/5 p-4",
                      visaoGeralKpis.churnRatePct > 5
                        ? "border-red-500/20"
                        : visaoGeralKpis.churnRatePct > 0
                          ? "border-[#EAB308]/20"
                          : "border-[#1D9E75]/20",
                    )}
                  >
                    <div className="text-xs text-white/50">Churn rate</div>
                    <div
                      className={clsx(
                        "mt-1 text-2xl font-semibold",
                        visaoGeralKpis.churnRatePct > 5
                          ? "text-red-400"
                          : visaoGeralKpis.churnRatePct > 0
                            ? "text-[#EAB308]"
                            : "text-[#5DCAA5]",
                      )}
                    >
                      {pct1.format(visaoGeralKpis.churnRatePct)}%
                    </div>
                    <div className="mt-1 text-xs text-white/40">Taxa de cancelamento</div>
                  </div>
                </div>
              </div>

              <div>
                <h2 className="text-xs font-medium uppercase tracking-wide text-white/30 mb-2">
                  Alertas
                </h2>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  <button
                    type="button"
                    onClick={() => irEscritorio("cobrancas")}
                    className={clsx(
                      "rounded-2xl border bg-white/5 p-4 text-left transition-colors cursor-pointer hover:border-[#1D9E75]/40",
                      visaoGeralKpis.vencendoEm7Dias > 0
                        ? "border-[#EAB308]/20"
                        : "border-[#1D9E75]/20",
                    )}
                  >
                    <div className="text-xs text-white/50">Vencendo em 7 dias</div>
                    <div
                      className={clsx(
                        "mt-1 text-2xl font-semibold",
                        visaoGeralKpis.vencendoEm7Dias > 0
                          ? "text-[#EAB308]"
                          : "text-[#5DCAA5]",
                      )}
                    >
                      {visaoGeralKpis.vencendoEm7Dias}
                    </div>
                    <div className="mt-1 text-xs text-white/40">Cobranças pendentes</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => irEscritorio("contratos")}
                    className={clsx(
                      "rounded-2xl border bg-white/5 p-4 text-left transition-colors cursor-pointer hover:border-[#1D9E75]/40",
                      visaoGeralKpis.inadimplentesCount > 0
                        ? "border-red-500/20"
                        : "border-[#1D9E75]/20",
                    )}
                  >
                    <div className="text-xs text-white/50">Inadimplentes</div>
                    <div
                      className={clsx(
                        "mt-1 text-2xl font-semibold",
                        visaoGeralKpis.inadimplentesCount > 0
                          ? "text-red-400"
                          : "text-[#5DCAA5]",
                      )}
                    >
                      {visaoGeralKpis.inadimplentesCount}
                    </div>
                    <div className="mt-1 text-xs text-white/40">Contratos em atraso</div>
                  </button>
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <div className="text-xs text-white/50">LTV médio</div>
                    <div className="mt-1 text-2xl font-semibold text-white">
                      {money.format(visaoGeralKpis.ltvMedio)}
                    </div>
                    <div className="mt-1 text-xs text-white/40">Valor anual por cliente</div>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <div className="text-xs text-white/50">Total sob gestão</div>
                    <div className="mt-1 text-2xl font-semibold text-white">
                      {visaoGeralKpis.totalEmpresas}
                    </div>
                    <div className="mt-1 text-xs text-white/40">Empresas na plataforma</div>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="text-sm font-medium text-white/80">MRR por mês de início</div>
                <p className="mt-1 text-xs text-white/40 mb-4">
                  Contratos ativos — soma do valor mensal por mês de{" "}
                  <span className="text-white/50">data_inicio</span> (últimos 6 meses)
                </p>
                <div className="flex items-end justify-between gap-2">
                  {mrrPorMesChart.rows.map((row) => {
                    const barH = Math.round(
                      Math.max(4, (row.value / mrrPorMesChart.max) * 120),
                    );
                    return (
                      <div
                        key={row.label}
                        className="flex flex-1 flex-col items-center gap-2 min-w-0"
                      >
                        <div className="h-[120px] w-full flex items-end justify-center">
                          <div
                            className="w-full max-w-[48px] rounded-t-md bg-[#1D9E75]/80 transition-all"
                            style={{ height: `${barH}px` }}
                            title={money.format(row.value)}
                          />
                        </div>
                        <span className="text-[10px] text-white/45 text-center leading-tight px-0.5">
                          {row.label}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/5 overflow-hidden">
                <div className="px-4 py-3 border-b border-white/10 text-sm font-medium text-white/70">
                  Últimos contratos
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-0">
                    <thead>
                      <tr className="text-left text-xs text-white/40 border-b border-white/10">
                        <th className="px-4 py-2 font-medium">Empresa</th>
                        <th className="px-4 py-2 font-medium">Valor</th>
                        <th className="px-4 py-2 font-medium">Vencimento</th>
                        <th className="px-4 py-2 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ultimosContratos.slice(0, 8).map((c) => {
                        const due = nextDueDate(c.dia_vencimento, hoje);
                        return (
                          <tr key={c.id} className="border-b border-white/5">
                            <td className="px-4 py-3 text-white/90 truncate max-w-[140px]">
                              {empresaNomePorId.get(c.empresa_id) ?? "—"}
                            </td>
                            <td className="px-4 py-3 text-white/80 whitespace-nowrap">
                              {money.format(Number(c.valor_mensal))}
                            </td>
                            <td className="px-4 py-3 text-white/60 whitespace-nowrap">
                              {due.toLocaleDateString("pt-BR")} (dia {c.dia_vencimento})
                            </td>
                            <td className="px-4 py-3">
                              <span
                                className={clsx(
                                  "inline-flex rounded-full border px-2 py-0.5 text-xs",
                                  statusBadgeClass(c.status),
                                )}
                              >
                                {c.status}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {!ultimosContratos.length ? (
                    <div className="px-4 py-8 text-center text-white/50 text-sm">
                      Nenhum contrato cadastrado.
                    </div>
                  ) : null}
                </div>
              </div>
            </section>
          ) : null}

          {secao === "escritorio" && paginaEscritorio === "clientes" ? (
            <section className="space-y-4">
              <div>
                <h1 className="text-2xl font-semibold">Clientes</h1>
                <p className="mt-1 text-sm text-white/50">Empresas e contratos</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 overflow-hidden overflow-x-auto">
                <table className="w-full text-sm min-w-[520px]">
                  <thead>
                    <tr className="text-left text-xs text-white/40 border-b border-white/10">
                      <th className="px-4 py-2 font-medium">Empresa</th>
                      <th className="px-4 py-2 font-medium">CNPJ</th>
                      <th className="px-4 py-2 font-medium">Status</th>
                      <th className="px-4 py-2 font-medium">Valor mensal</th>
                      <th className="px-4 py-2 font-medium" />
                    </tr>
                  </thead>
                  <tbody>
                    {props.empresas.map((emp) => {
                      const c = contratoMaisRecente(emp.id, props.contratos);
                      const status = c?.status ?? null;
                      return (
                        <tr key={emp.id} className="border-b border-white/5">
                          <td className="px-4 py-3 text-white/90">{emp.nome}</td>
                          <td className="px-4 py-3 text-white/60 text-xs">
                            {emp.cnpj
                              ? formatCnpjDigits(String(emp.cnpj))
                              : "—"}
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={clsx(
                                "inline-flex rounded-full border px-2 py-0.5 text-xs",
                                statusBadgeClass(status),
                              )}
                            >
                              {!status
                                ? "Sem contrato"
                                : status === "ativo"
                                  ? "Ativo"
                                  : status === "inadimplente"
                                    ? "Inadimplente"
                                    : "Cancelado"}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-white/80 whitespace-nowrap">
                            {c ? money.format(Number(c.valor_mensal)) : "—"}
                          </td>
                          <td className="px-4 py-3">
                            <button
                              type="button"
                              onClick={() => irEmpresa(emp.id)}
                              className="rounded-lg border border-[#1D9E75]/25 px-3 py-1.5 text-xs font-semibold text-[#5DCAA5] hover:bg-[#1D9E75]/10"
                            >
                              Ver empresa
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {!props.empresas.length ? (
                  <div className="px-4 py-8 text-center text-white/50 text-sm">
                    Nenhuma empresa cadastrada.
                  </div>
                ) : null}
              </div>
            </section>
          ) : null}

          {secao === "escritorio" && paginaEscritorio === "contratos" ? (
            <section className="space-y-4">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h1 className="text-2xl font-semibold">Contratos</h1>
                  <p className="mt-1 text-sm text-white/50">Gestão de contratos</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setNovoContratoEmpresaId(props.empresas[0]?.id ?? "");
                    setModalContrato(true);
                  }}
                  className="rounded-xl bg-[#1D9E75] px-4 py-2 text-sm font-semibold text-black hover:brightness-110"
                >
                  Novo contrato
                </button>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 overflow-hidden overflow-x-auto">
                <table className="w-full text-sm min-w-[640px]">
                  <thead>
                    <tr className="text-left text-xs text-white/40 border-b border-white/10">
                      <th className="px-4 py-2 font-medium">Empresa</th>
                      <th className="px-4 py-2 font-medium">Valor mensal</th>
                      <th className="px-4 py-2 font-medium">Dia venc.</th>
                      <th className="px-4 py-2 font-medium">Status</th>
                      <th className="px-4 py-2 font-medium">Início</th>
                      <th className="px-4 py-2 font-medium" />
                    </tr>
                  </thead>
                  <tbody>
                    {props.contratos.map((c) => (
                      <tr key={c.id} className="border-b border-white/5">
                        <td className="px-4 py-3 text-white/90 truncate max-w-[120px]">
                          {empresaNomePorId.get(c.empresa_id) ?? "—"}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          {money.format(Number(c.valor_mensal))}
                        </td>
                        <td className="px-4 py-3">{c.dia_vencimento}</td>
                        <td className="px-4 py-3">
                          {editingContratoId === c.id ? (
                            <select
                              value={c.status}
                              onChange={(e) =>
                                void atualizarStatusContrato(
                                  c.id,
                                  e.target.value as ContratoStatus,
                                )
                              }
                              className="rounded-lg bg-[#080808] border border-[#1D9E75]/30 px-2 py-1 text-xs outline-none"
                              autoFocus
                            >
                              <option value="ativo">ativo</option>
                              <option value="inadimplente">inadimplente</option>
                              <option value="cancelado">cancelado</option>
                            </select>
                          ) : (
                            <span
                              className={clsx(
                                "inline-flex rounded-full border px-2 py-0.5 text-xs",
                                statusBadgeClass(c.status),
                              )}
                            >
                              {c.status}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-white/60 whitespace-nowrap">
                          {formatDatePtBR(c.data_inicio)}
                        </td>
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            onClick={() =>
                              setEditingContratoId(
                                editingContratoId === c.id ? null : c.id,
                              )
                            }
                            className="text-xs font-semibold text-[#5DCAA5] hover:underline"
                          >
                            Editar status
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!props.contratos.length ? (
                  <div className="px-4 py-8 text-center text-white/50 text-sm">
                    Nenhum contrato.
                  </div>
                ) : null}
              </div>
            </section>
          ) : null}

          {secao === "escritorio" && paginaEscritorio === "cobrancas" ? (
            <section className="space-y-4">
              <div>
                <h1 className="text-2xl font-semibold">Cobranças</h1>
                <p className="mt-1 text-sm text-white/50">Vencimentos nos próximos 7 dias</p>
              </div>
              <div className="grid gap-3">
                {contratosCobranca.map(({ contrato: c, due, dias }) => (
                  <div
                    key={c.id}
                    className="rounded-2xl border border-[#1D9E75]/20 bg-white/5 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="font-semibold text-white truncate">
                        {empresaNomePorId.get(c.empresa_id) ?? "—"}
                      </div>
                      <div className="mt-1 text-sm text-white/60">
                        {money.format(Number(c.valor_mensal))} · Vence em{" "}
                        {due.toLocaleDateString("pt-BR")}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex rounded-full border border-[#EAB308]/30 bg-[#EAB308]/10 px-2 py-1 text-xs text-[#EAB308]">
                        {dias === 0 ? "Vence hoje" : `Vence em ${dias} dias`}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setAvisosEnviados((prev) => ({ ...prev, [c.id]: true }))
                        }
                        className="rounded-xl border border-[#1D9E75]/25 bg-[#1D9E75]/10 px-3 py-2 text-xs font-semibold text-[#5DCAA5] hover:bg-[#1D9E75]/15"
                      >
                        {avisosEnviados[c.id] ? "Aviso enviado!" : "Enviar aviso por email"}
                      </button>
                    </div>
                  </div>
                ))}
                {!contratosCobranca.length ? (
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-8 text-center text-white/50 text-sm">
                    Nenhum vencimento nos próximos 7 dias.
                  </div>
                ) : null}
              </div>
            </section>
          ) : null}

          {secao === "empresa" && !empresaSelecionada ? (
            <div className="rounded-2xl border border-white/10 bg-white/5 p-8 text-center text-white/60">
              Selecione uma empresa na barra lateral.
            </div>
          ) : null}

          {secao === "empresa" && empresaSelecionada ? (
            <>
              <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h1 className="text-xl font-semibold">{empresaSelecionada.nome}</h1>
                  <p className="mt-1 text-sm text-white/50">Painel da empresa</p>
                </div>
                <div className="flex flex-wrap gap-1 rounded-xl border border-white/10 bg-white/5 p-1">
                  {empresaTabItems.map((it) => {
                    const active = abaEmpresa === it.key;
                    return (
                      <button
                        key={it.key}
                        type="button"
                        onClick={() => setAbaEmpresa(it.key)}
                        className={clsx(
                          "inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs sm:text-sm transition-colors",
                          active
                            ? "bg-[#1D9E75]/15 text-white border border-[#1D9E75]/25"
                            : "text-white/50 hover:text-white/80",
                        )}
                      >
                        <span className="opacity-80">{it.icon}</span>
                        {it.label}
                      </button>
                    );
                  })}
                </div>
              </div>

          {abaEmpresa === "upload" ? (
            <section className="space-y-5">
              <div>
                <div className="text-2xl font-semibold">Importar extrato</div>
                <div className="mt-1 text-sm text-white/50">
                  Arraste o extrato aqui — PDF, CSV, imagem ou TXT
                </div>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.txt,.pdf,.png,.jpg,.jpeg,text/csv,text/plain,application/pdf,image/png,image/jpeg"
                className="hidden"
                onChange={onFileSelected}
              />

              <div
                role="button"
                tabIndex={0}
                onClick={openFilePicker}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") openFilePicker();
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  const file = e.dataTransfer.files?.[0];
                  if (file) void handleFile(file);
                }}
                className={clsx(
                  "rounded-xl border border-dashed px-6 py-10 cursor-pointer select-none transition-colors",
                  "bg-[#1D9E75]/[0.03] border-[#1D9E75]/30 hover:border-[#1D9E75]/60",
                  dragOver && "border-[#1D9E75]/60",
                )}
              >
                <div className="flex flex-col items-center text-center gap-3">
                  <UploadIcon />
                  <div className="text-sm text-white/80">
                    Arraste o extrato aqui — PDF, CSV, imagem ou TXT
                  </div>
                  <div className="text-xs text-white/40">
                    Aceita PDF, CSV, TXT, PNG e JPG
                  </div>
                </div>
              </div>

              {uploadLoading ? (
                <div className="flex items-center gap-3 text-sm text-white/70">
                  <Spinner />
                  <span>
                    {uploadStatusMessage || "Classificando com IA..."}
                  </span>
                </div>
              ) : null}

              {transacoes && resumo ? (
                <div className="space-y-5">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="rounded-2xl border border-[#1D9E75]/20 bg-white/5 p-4">
                      <div className="text-xs text-white/50">Total Entradas</div>
                      <div className="mt-2 text-xl font-semibold text-[#5DCAA5]">
                        {money.format(resumo.totalEntradas)}
                      </div>
                    </div>
                    <div className="rounded-2xl border border-red-500/20 bg-white/5 p-4">
                      <div className="text-xs text-white/50">Total Saídas</div>
                      <div className="mt-2 text-xl font-semibold text-red-400">
                        {money.format(resumo.totalSaidas)}
                      </div>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                      <div className="text-xs text-white/50">Saldo</div>
                      <div
                        className={clsx(
                          "mt-2 text-xl font-semibold",
                          resumo.saldo >= 0 ? "text-[#5DCAA5]" : "text-red-400",
                        )}
                      >
                        {money.format(resumo.saldo)}
                      </div>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-white/5 overflow-hidden">
                    <div className="px-4 py-3 border-b border-white/10 text-sm text-white/70">
                      Transações ({transacoes.length})
                    </div>
                    <div className="divide-y divide-white/10">
                      {(() => {
                        const totalPaginas = Math.max(
                          1,
                          Math.ceil(transacoes.length / TRANSACOES_POR_PAGINA),
                        );
                        const paginaAtual = Math.max(
                          1,
                          Math.min(paginaTransacoes, totalPaginas),
                        );
                        const inicio = (paginaAtual - 1) * TRANSACOES_POR_PAGINA;
                        const fim = paginaAtual * TRANSACOES_POR_PAGINA;
                        const pageItems = transacoes.slice(inicio, fim);

                        return (
                          <>
                            {pageItems.map((t, idx) => (
                        <div
                          key={`${t.data}-${inicio + idx}`}
                          className="px-4 py-3 grid grid-cols-12 gap-3 items-start"
                        >
                          <div className="col-span-4 md:col-span-2 text-xs text-white/60">
                            {formatDatePtBR(t.data)}
                          </div>
                          <div className="col-span-8 md:col-span-6 min-w-0">
                            <div className="text-sm text-white/90 truncate">
                              {t.descricao}
                            </div>
                          </div>
                          <div className="col-span-6 md:col-span-2">
                            <span
                              className={clsx(
                                "inline-flex items-center rounded-full border px-2 py-1 text-xs font-semibold",
                                t.tipo === "entrada"
                                  ? "bg-[#1D9E75]/15 text-[#5DCAA5] border-[#1D9E75]/25"
                                  : "bg-red-500/15 text-red-300 border-red-500/25",
                              )}
                            >
                              {money.format(t.valor)}
                            </span>
                          </div>
                          <div className="col-span-6 md:col-span-2 flex justify-end md:justify-start">
                            <span
                              className={clsx(
                                "inline-flex items-center rounded-full border px-2 py-1 text-xs",
                                categoriaPill(t.categoria),
                              )}
                            >
                              {t.categoria}
                            </span>
                          </div>
                        </div>
                            ))}

                            <div className="px-4 py-3 flex items-center justify-between gap-3 text-xs text-white/50">
                              <div>
                                Página {paginaAtual} de {totalPaginas} ·{" "}
                                {transacoes.length} transações total
                              </div>
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setPaginaTransacoes((p) => Math.max(1, p - 1))
                                  }
                                  disabled={paginaAtual <= 1}
                                  className={clsx(
                                    "rounded-lg border border-[#1D9E75]/20 px-3 py-2 text-white/70 hover:bg-[#1D9E75]/10",
                                    paginaAtual <= 1 && "opacity-40",
                                  )}
                                >
                                  ← Anterior
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setPaginaTransacoes((p) =>
                                      Math.min(totalPaginas, p + 1),
                                    )
                                  }
                                  disabled={paginaAtual >= totalPaginas}
                                  className={clsx(
                                    "rounded-lg border border-[#1D9E75]/20 px-3 py-2 text-white/70 hover:bg-[#1D9E75]/10",
                                    paginaAtual >= totalPaginas && "opacity-40",
                                  )}
                                >
                                  Próximo →
                                </button>
                              </div>
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  </div>

                  <div className="flex items-center justify-end">
                    <button
                      onClick={salvarEAnalisar}
                      disabled={salvarLoading}
                      className="rounded-xl bg-[#1D9E75] px-5 py-3 text-sm font-semibold text-black hover:brightness-110 disabled:opacity-60 inline-flex items-center gap-2"
                    >
                      {salvarLoading ? <Spinner /> : null}
                      Salvar e analisar
                    </button>
                  </div>
                </div>
              ) : null}
            </section>
          ) : null}

          {abaEmpresa === "diagnostico" ? (
            <section className="space-y-5">
              <div className="flex items-end justify-between gap-4 flex-wrap">
                <div>
                  <div className="text-2xl font-semibold">Diagnóstico</div>
                  <div className="mt-1 text-sm text-white/50">
                    Visão geral da saúde financeira
                  </div>
                </div>
              </div>

              {!diagnostico ? (
                salvarLoading ? (
                  <div className="rounded-2xl border border-[#1D9E75]/20 bg-white/5 p-8 text-center text-white/70">
                    Gerando diagnóstico...
                  </div>
                ) : (
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-8 text-center text-white/60">
                    Importe um extrato para ver o diagnóstico
                  </div>
                )
              ) : (
                <>
                  <div className="rounded-2xl border border-[#1D9E75]/20 bg-white/5 p-6">
                    <div className="flex flex-col items-center gap-3">
                      {(() => {
                        const s = Math.max(0, Math.min(100, diagnostico.score ?? 0));
                        const c = scoreColor(s);
                        return (
                          <>
                            <div
                              className="h-40 w-40 rounded-full flex items-center justify-center"
                              style={{
                                background: `conic-gradient(${c.ring} ${
                                  s * 3.6
                                }deg, rgba(255,255,255,0.08) 0deg)`,
                              }}
                            >
                              <div className="h-[136px] w-[136px] rounded-full bg-[#0d0d0d] border border-white/10 flex flex-col items-center justify-center">
                                <div className="text-4xl font-semibold">
                                  {Math.round(s)}
                                </div>
                                <div className="mt-1 text-xs text-white/50">
                                  Saúde financeira
                                </div>
                              </div>
                            </div>
                            <div
                              className="inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold text-black"
                              style={{ background: c.badgeBg }}
                            >
                              {c.badge}
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-[#1D9E75]/20 bg-white/5 p-6">
                    <div className="text-sm text-white/70 mb-2">Resumo</div>
                    <div className="text-sm leading-6 text-white/90 whitespace-pre-wrap">
                      {diagnostico.resumo}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="rounded-2xl border border-red-500/20 bg-white/5 p-6">
                      <div className="flex items-center gap-2 text-sm font-semibold text-white">
                        <span className="text-red-400">✕</span> Problemas
                      </div>
                      <ul className="mt-3 space-y-2 text-sm text-white/80">
                        {diagnostico.problemas?.length ? (
                          diagnostico.problemas.map((p, i) => (
                            <li key={i} className="flex gap-2">
                              <span className="text-red-400 mt-0.5">•</span>
                              <span className="min-w-0">{p}</span>
                            </li>
                          ))
                        ) : (
                          <li className="text-white/50">Nenhum problema destacado.</li>
                        )}
                      </ul>
                    </div>
                    <div className="rounded-2xl border border-[#1D9E75]/20 bg-white/5 p-6">
                      <div className="flex items-center gap-2 text-sm font-semibold text-white">
                        <span className="text-[#5DCAA5]">✓</span> Oportunidades
                      </div>
                      <ul className="mt-3 space-y-2 text-sm text-white/80">
                        {diagnostico.oportunidades?.length ? (
                          diagnostico.oportunidades.map((p, i) => (
                            <li key={i} className="flex gap-2">
                              <span className="text-[#5DCAA5] mt-0.5">•</span>
                              <span className="min-w-0">{p}</span>
                            </li>
                          ))
                        ) : (
                          <li className="text-white/50">
                            Nenhuma oportunidade destacada.
                          </li>
                        )}
                      </ul>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
                      <div className="text-sm font-semibold">Maiores gastos</div>
                      <div className="mt-4 space-y-3">
                        {(diagnostico.maiores_gastos ?? []).length ? (
                          diagnostico.maiores_gastos.map((g, i) => {
                            const pct = Math.max(0, Math.min(100, g.percentual ?? 0));
                            return (
                              <div key={i} className="space-y-1">
                                <div className="flex items-center justify-between gap-3 text-xs text-white/70">
                                  <span className="truncate">{g.categoria}</span>
                                  <span className="shrink-0">
                                    {money.format(g.valor)} ({Math.round(pct)}%)
                                  </span>
                                </div>
                                <div className="h-2 rounded-full bg-white/10 overflow-hidden">
                                  <div
                                    className="h-full bg-[#1D9E75]"
                                    style={{ width: `${pct}%` }}
                                  />
                                </div>
                              </div>
                            );
                          })
                        ) : (
                          <div className="text-sm text-white/50">
                            Sem dados de maiores gastos.
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
                      <div className="text-sm font-semibold">Sugestões</div>
                      <ul className="mt-3 space-y-2 text-sm text-white/80">
                        {diagnostico.sugestoes?.length ? (
                          diagnostico.sugestoes.map((s, i) => (
                            <li key={i} className="flex gap-2">
                              <span className="text-[#1D9E75] mt-0.5">•</span>
                              <span className="min-w-0">{s}</span>
                            </li>
                          ))
                        ) : (
                          <li className="text-white/50">Sem sugestões no momento.</li>
                        )}
                      </ul>
                    </div>
                  </div>

                  <div className="flex items-center justify-end">
                    <button
                      onClick={gerarAcoes}
                      disabled={acoesLoading}
                      className="rounded-xl bg-[#1D9E75] px-5 py-3 text-sm font-semibold text-black hover:brightness-110 disabled:opacity-60 inline-flex items-center gap-2"
                    >
                      {acoesLoading ? <Spinner /> : null}
                      Gerar ações
                    </button>
                  </div>
                </>
              )}
            </section>
          ) : null}

          {abaEmpresa === "chat" ? (
            <section className="space-y-4">
              <div>
                <div className="text-2xl font-semibold">Chat</div>
                <div className="mt-1 text-sm text-white/50">
                  Pergunte sobre os dados importados
                </div>
              </div>

              {!transacoes || !resumo ? (
                <div className="rounded-2xl border border-white/10 bg-white/5 p-8 text-center text-white/60">
                  Importe um extrato para conversar sobre os dados
                </div>
              ) : (
                <div className="rounded-2xl border border-white/10 bg-white/5 flex flex-col h-[70vh]">
                  <div className="flex-1 overflow-y-auto p-4 space-y-3">
                    {mensagens.map((m) => (
                      <div
                        key={m.id}
                        className={clsx(
                          "max-w-[85%] rounded-2xl border px-4 py-3 text-sm leading-6 whitespace-pre-wrap",
                          m.role === "user"
                            ? "ml-auto bg-[#1D9E75]/15 border-[#1D9E75]/20 text-white"
                            : "mr-auto bg-white/5 border-white/10 text-white/90",
                        )}
                      >
                        {m.content}
                      </div>
                    ))}
                    {chatLoading ? (
                      <div className="mr-auto max-w-[85%] rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/70 inline-flex items-center gap-2">
                        <span>Analisando</span> <Dots />
                      </div>
                    ) : null}
                    <div ref={chatEndRef} />
                  </div>

                  <div className="border-t border-white/10 p-3">
                    <div className="flex items-end gap-2">
                      <textarea
                        value={chatInput}
                        onChange={(e) => setChatInput(e.target.value)}
                        rows={2}
                        placeholder="Digite sua pergunta..."
                        className="flex-1 resize-none rounded-xl bg-black/30 border border-white/10 px-4 py-3 text-sm outline-none focus:border-[#5DCAA5]"
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            void enviarChat();
                          }
                        }}
                      />
                      <button
                        onClick={() => void enviarChat()}
                        disabled={chatLoading}
                        className="rounded-xl bg-[#1D9E75] px-4 py-3 text-sm font-semibold text-black hover:brightness-110 disabled:opacity-60"
                      >
                        Enviar
                      </button>
                    </div>
                    <div className="mt-2 text-xs text-white/40">
                      Enter envia • Shift+Enter quebra linha
                    </div>
                  </div>
                </div>
              )}
            </section>
          ) : null}

          {abaEmpresa === "acoes" ? (
            <section className="space-y-5">
              <div>
                <div className="text-2xl font-semibold">Ações</div>
                <div className="mt-1 text-sm text-white/50">
                  Mensagens prontas para executar
                </div>
              </div>

              {!acoes ? (
                <div className="rounded-2xl border border-white/10 bg-white/5 p-8 text-center text-white/60">
                  Gere um diagnóstico primeiro
                </div>
              ) : !acoes.length ? (
                <div className="rounded-2xl border border-white/10 bg-white/5 p-8 text-center text-white/60">
                  Nenhuma ação gerada.
                </div>
              ) : (
                <div className="space-y-3">
                  {acoes.map((a, i) => (
                    <AcaoCard key={i} acao={a} />
                  ))}
                </div>
              )}
            </section>
          ) : null}
            </>
          ) : null}
        </div>
      </main>
    </div>
  );
}

function AcaoCard({ acao }: { acao: Acao }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(acao.mensagem);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={clsx(
                "inline-flex items-center rounded-full border px-2 py-1 text-xs font-semibold",
                prioridadeColors(acao.prioridade),
              )}
            >
              {acao.prioridade}
            </span>
            <span className="text-sm text-white/60 truncate">
              Para: {acao.destinatario}
            </span>
          </div>
          <div className="mt-2 font-semibold text-white">{acao.assunto}</div>
        </div>
        <button
          onClick={() => void copy()}
          className="shrink-0 rounded-xl border border-[#1D9E75]/20 bg-[#1D9E75]/10 px-3 py-2 text-xs font-semibold text-white hover:bg-[#1D9E75]/15"
        >
          {copied ? "Copiado!" : "Copiar mensagem"}
        </button>
      </div>

      <div className="mt-3 text-sm text-white/80 whitespace-pre-wrap leading-6">
        {acao.mensagem}
      </div>
    </div>
  );
}

