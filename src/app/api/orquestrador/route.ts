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
      max_tokens: 800,
      messages: [
        {
          role: 'user',
          content: `Orquestrador financeiro: no máximo 3 ações (2–3) a partir do diagnóstico. Português, mensagens curtas e executáveis.

JSON único, sem markdown:
{"acoes":[{"destinatario":"string","assunto":"string","mensagem":"string","prioridade":"alta"|"media"|"baixa"}]}

EMPRESA: ${JSON.stringify(empresa)}
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

