import { NextRequest, NextResponse } from "next/server";

type Transacao = {
  data: string;
  descricao: string;
  valor: number;
  tipo: "entrada" | "saida";
  categoria: string;
};

const CATEGORIAS: { padrao: RegExp; categoria: string }[] = [
  { padrao: /PAGAMENTO\s+CLIENTE|RECEBIMENTO|DEPOSITO|PIX\s+RECEBIDO/i, categoria: "Receita" },
  { padrao: /SALARIO|FOLHA|FUNCIONARIO|RH/i, categoria: "Folha de Pagamento" },
  { padrao: /BOLETO\s+FORNECEDOR|FORNECEDOR|COMPRA/i, categoria: "Fornecedores" },
  { padrao: /TAXA|TARIFA|IOF|JUROS|BANCARIA/i, categoria: "Taxas Bancárias" },
  { padrao: /ALUGUEL|CONDOMINIO/i, categoria: "Aluguel" },
  { padrao: /ENERGIA|AGUA|TELEFONE|INTERNET|LIGHT/i, categoria: "Utilities" },
  { padrao: /IMPOSTO|DAS|DARF|INSS|FGTS|TRIBUTO/i, categoria: "Impostos" },
  { padrao: /TRANSFERENCIA|TED|DOC/i, categoria: "Transferência" },
];

function classificarLinha(linha: string): Transacao | null {
  const linha_trim = linha.trim();
  if (!linha_trim) return null;

  // Formato esperado: DD/MM/AAAA DESCRICAO VALOR
  const match = linha_trim.match(
    /^(\d{2}\/\d{2}\/\d{4})\s+(.+?)\s+([-+]?\d+(?:[.,]\d{2})?)$/
  );
  if (!match) return null;

  const [, data, descricao, valorStr] = match;
  const valor = parseFloat(valorStr.replace(",", "."));

  let categoria = "Outros";
  for (const { padrao, categoria: cat } of CATEGORIAS) {
    if (padrao.test(descricao)) {
      categoria = cat;
      break;
    }
  }

  return {
    data,
    descricao: descricao.trim(),
    valor: Math.abs(valor),
    tipo: valor < 0 ? "saida" : "entrada",
    categoria,
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    if (!body.extrato || typeof body.extrato !== "string") {
      return NextResponse.json(
        { erro: 'Campo "extrato" é obrigatório e deve ser uma string.' },
        { status: 400 }
      );
    }

    const linhas = body.extrato.split("\n");
    const transacoes: Transacao[] = [];
    const naoClassificadas: string[] = [];

    for (const linha of linhas) {
      const transacao = classificarLinha(linha);
      if (transacao) {
        transacoes.push(transacao);
      } else if (linha.trim()) {
        naoClassificadas.push(linha.trim());
      }
    }

    const totalEntradas = transacoes
      .filter((t) => t.tipo === "entrada")
      .reduce((acc, t) => acc + t.valor, 0);

    const totalSaidas = transacoes
      .filter((t) => t.tipo === "saida")
      .reduce((acc, t) => acc + t.valor, 0);

    const resumoPorCategoria = transacoes.reduce<Record<string, number>>(
      (acc, t) => {
        acc[t.categoria] = (acc[t.categoria] || 0) + t.valor;
        return acc;
      },
      {}
    );

    return NextResponse.json({
      transacoes,
      resumo: {
        totalEntradas,
        totalSaidas,
        saldo: totalEntradas - totalSaidas,
        porCategoria: resumoPorCategoria,
      },
      naoClassificadas,
    });
  } catch {
    return NextResponse.json({ erro: "Erro ao processar o extrato." }, { status: 500 });
  }
}
