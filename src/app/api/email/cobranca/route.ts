export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";

type Body = {
  destinatario?: string;
  nomeEmpresa?: string;
  valorMensal?: number;
  dataVencimento?: string;
  nomeEscritorio?: string;
};

const money = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

function safeStr(v: unknown) {
  return typeof v === "string" ? v.trim() : "";
}

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { erro: "RESEND_API_KEY não configurada." },
        { status: 500 },
      );
    }

    const body = (await req.json()) as Body;
    const destinatario = safeStr(body.destinatario);
    const nomeEmpresa = safeStr(body.nomeEmpresa);
    const nomeEscritorio = safeStr(body.nomeEscritorio);
    const dataVencimento = safeStr(body.dataVencimento);
    const valorMensal =
      typeof body.valorMensal === "number" && Number.isFinite(body.valorMensal)
        ? body.valorMensal
        : null;

    if (!destinatario || !nomeEmpresa || !nomeEscritorio || !dataVencimento || valorMensal === null) {
      return NextResponse.json({ erro: "Dados incompletos." }, { status: 400 });
    }

    const html = `
      <div style="font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial; color: #111; background: #fff; padding: 24px;">
        <div style="background:#1D9E75; color:#fff; padding: 14px 16px; border-radius: 12px; font-weight: 800; letter-spacing: .16em;">
          +CONTÁBIL
        </div>
        <div style="padding: 18px 6px 6px 6px;">
          <p style="margin: 0 0 10px 0; font-size: 16px;">
            Aviso de cobrança — <strong>${nomeEmpresa}</strong>
          </p>
          <p style="margin: 0 0 10px 0; font-size: 14px; line-height: 1.5;">
            Valor mensal: <strong>${money.format(valorMensal)}</strong><br/>
            Data de vencimento: <strong>${dataVencimento}</strong>
          </p>
          <p style="margin: 16px 0 0 0; font-size: 12px; color: #555;">
            Enviado por <strong>${nomeEscritorio}</strong> via +Contábil
          </p>
        </div>
      </div>
    `;

    const resend = new Resend(apiKey);
    const { error } = await resend.emails.send({
      from: "onboarding@resend.dev",
      to: destinatario,
      subject: `Aviso de cobrança — ${nomeEmpresa}`,
      html,
    });

    if (error) {
      return NextResponse.json({ erro: error.message }, { status: 422 });
    }

    return NextResponse.json({ sucesso: true });
  } catch (e) {
    console.error("POST /api/email/cobranca:", e);
    return NextResponse.json({ erro: "Erro ao enviar email." }, { status: 500 });
  }
}

