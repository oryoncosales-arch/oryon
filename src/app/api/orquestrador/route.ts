export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

export async function POST(req: NextRequest) {
  try {
    const { diagnostico, empresa, contato } = await req.json()

    if (!diagnostico) {
      return NextResponse.json({ error: 'Diagnóstico não enviado' }, { status: 400 })
    }
    if (!empresa) {
      return NextResponse.json({ error: 'Empresa não enviada' }, { status: 400 })
    }
    if (!contato) {
      return NextResponse.json({ error: 'Contato não enviado' }, { status: 400 })
    }

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 900,
      messages: [
        {
          role: 'user',
          content: `Você é um orquestrador financeiro especializado no mercado brasileiro.

Com base no diagnóstico financeiro, gere de 4 a 6 ações concretas e variadas.

As ações devem cobrir diferentes categorias:
- Obrigações tributárias (DAS, DARF, INSS, FGTS, ISS, IRPJ conforme regime da empresa)
- Controle de caixa e margem
- Categorização e organização financeira
- Alertas de compliance e regularização
- Oportunidades de economia tributária
- Comunicação com clientes ou fornecedores

Contexto tributário brasileiro obrigatório:
- MEI: DAS mensal até dia 20, limite de faturamento R$81k/ano
- Simples Nacional: DAS mensal, DEFIS anual, limite R$4,8M/ano
- Lucro Presumido: IRPJ + CSLL trimestral, PIS/COFINS mensal, ISS mensal
- Identifica o regime pelo perfil da empresa e adapta as ações
- Menciona prazos reais (ex: "DAS vence dia 20 de cada mês")

Regras:
- Responda em português do Brasil
- Mensagens prontas para copiar e enviar
- Seja específico com valores e prazos quando possível
- Nunca invente dados que não estão no diagnóstico

Retorne APENAS este JSON sem markdown:
{"acoes":[{"destinatario":"string","assunto":"string","mensagem":"string","prioridade":"alta"|"media"|"baixa"}]}

EMPRESA: ${JSON.stringify(empresa)}
CONTATO: ${JSON.stringify(contato)}
DIAGNÓSTICO: ${JSON.stringify(diagnostico)}`,
        },
      ],
    })

    const content = response.content[0]
    if (content.type !== 'text') {
      throw new Error('Resposta inválida do Claude')
    }

    const clean = content.text.replace(/```json|```/g, '').trim()
    const parsed = JSON.parse(clean) as { acoes?: unknown }
    const acoes = Array.isArray(parsed.acoes) ? (parsed.acoes as any[]) : []

    return NextResponse.json({ sucesso: true, acoes })
  } catch (error) {
    console.error('Erro no orquestrador:', error)
    return NextResponse.json({ error: 'Erro ao orquestrar ações' }, { status: 500 })
  }
}

