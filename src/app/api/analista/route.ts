import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

export async function POST(req: NextRequest) {
  try {
    const { dados } = await req.json()

    if (!dados) {
      return NextResponse.json({ error: 'Dados não enviados' }, { status: 400 })
    }

    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      messages: [
        {
          role: 'user',
          content: `Você é um analista financeiro especializado em pequenas empresas brasileiras.

Com base nos dados financeiros abaixo, gere um diagnóstico completo.

Retorne um JSON com este formato exato:
{
  "saude_financeira": "boa" | "regular" | "critica",
  "score": 0 a 100,
  "diagnostico": "texto direto de 2 a 3 frases explicando a situação",
  "pontos_positivos": ["ponto 1", "ponto 2"],
  "pontos_atencao": ["alerta 1", "alerta 2"],
  "recomendacoes": ["ação 1", "ação 2"],
  "maiores_gastos": [
    { "categoria": "nome", "valor": 0.00, "percentual": 0 }
  ]
}

Retorne APENAS o JSON, sem texto adicional.

DADOS FINANCEIROS:
${JSON.stringify(dados, null, 2)}`,
        },
      ],
    })

    const content = response.content[0]
    if (content.type !== 'text') {
      throw new Error('Resposta inválida do Claude')
    }

    const clean = content.text.replace(/```json|```/g, '').trim()
    const resultado = JSON.parse(clean)
    return NextResponse.json({ sucesso: true, data: resultado })
  } catch (error) {
    console.error('Erro no analista:', error)
    return NextResponse.json({ error: 'Erro ao analisar dados' }, { status: 500 })
  }
}

