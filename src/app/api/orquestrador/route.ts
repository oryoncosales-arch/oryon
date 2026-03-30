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
      model: 'claude-sonnet-4-6',
      max_tokens: 1200,
      messages: [
        {
          role: 'user',
          content: `Você é um orquestrador financeiro operacional para pequenas empresas brasileiras.

Objetivo: com base no DIAGNÓSTICO FINANCEIRO, detectar pendências e prazos críticos e gerar uma lista de ações de comunicação/execução a disparar.

Regras obrigatórias:
- Responda em português.
- Use APENAS o que estiver no diagnóstico e nos dados de empresa/contato. Não invente datas, prazos, impostos, valores, dívidas, fornecedores ou qualquer informação não presente.
- Se faltarem informações para criar uma ação confiável, crie uma ação de prioridade "media" pedindo a informação faltante ao contato.
- Seja direto, com mensagens prontas para enviar.

Retorne um JSON com este formato exato:
{
  "acoes": [
    {
      "destinatario": "string",
      "assunto": "string",
      "mensagem": "string",
      "prioridade": "baixa" | "media" | "alta"
    }
  ]
}

Retorne APENAS o JSON, sem texto adicional.

EMPRESA:
${JSON.stringify(empresa, null, 2)}

CONTATO:
${JSON.stringify(contato, null, 2)}

DIAGNÓSTICO FINANCEIRO:
${JSON.stringify(diagnostico, null, 2)}`,
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

