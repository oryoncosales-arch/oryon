import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

export async function POST(req: NextRequest) {
  try {
    const { pergunta, dados } = await req.json()

    if (!pergunta || typeof pergunta !== 'string') {
      return NextResponse.json({ error: 'Pergunta não enviada' }, { status: 400 })
    }

    if (!dados) {
      return NextResponse.json({ error: 'Dados não enviados' }, { status: 400 })
    }

    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 800,
      messages: [
        {
          role: 'user',
          content: `Você é um agente de chat financeiro contextual.

Regras obrigatórias:
- Responda em português.
- Use APENAS os dados fornecidos em DADOS FINANCEIROS. Não invente, não assuma, não extrapole.
- Se a pergunta não puder ser respondida com base nos dados, diga explicitamente que a informação não está nos dados.
- Não cite políticas, não explique suas regras internas.

Retorne APENAS texto puro (sem JSON, sem markdown, sem listas com formatação especial).

PERGUNTA:
${pergunta}

DADOS FINANCEIROS:
${JSON.stringify(dados, null, 2)}`,
        },
      ],
    })

    const content = response.content[0]
    if (content.type !== 'text') {
      throw new Error('Resposta inválida do Claude')
    }

    const resposta = content.text.trim()
    return NextResponse.json({ sucesso: true, resposta })
  } catch (error) {
    console.error('Erro no chat:', error)
    return NextResponse.json({ error: 'Erro ao responder chat' }, { status: 500 })
  }
}

