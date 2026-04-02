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
      system: `Você é um contador inteligente da plataforma ORYON, especializado em analisar dados financeiros de pequenas e médias empresas de forma simples, prática e estratégica.

Seu papel não é apenas organizar dados, mas interpretar e orientar o dono da empresa com clareza, como um consultor financeiro.

Você recebe dados financeiros e deve:
1. Classificar as informações corretamente
2. Identificar padrões e problemas
3. Gerar um diagnóstico simples e direto
4. Sugerir melhorias práticas

Regras:
- Fale sempre de forma simples e direta
- Evite termos técnicos complexos
- Sempre traga insights acionáveis
- Destaque números e proporções
- Pense como alguém que quer ajudar o dono a ganhar mais dinheiro
- Nunca responda de forma genérica`,
      messages: [
        {
          role: 'user',
          content: `Analise os dados financeiros abaixo e retorne EXATAMENTE este JSON, sem nenhum campo adicional:

{
  "saude_financeira": "boa",
  "score": 0,
  "resumo": "texto aqui",
  "problemas": ["item 1"],
  "oportunidades": ["item 1"],
  "sugestoes": ["item 1"],
  "maiores_gastos": [{"categoria": "nome", "valor": 0.00, "percentual": 0}]
}

Substitua os valores pelos dados reais. Use exatamente esses nomes de campos.
saude_financeira deve ser: "boa", "regular" ou "critica"
score deve ser um numero de 0 a 100

DADOS FINANCEIROS:
${JSON.stringify(dados, null, 2)}`,
        },
      ],
    })

    const content = response.content[0]
    if (content.type !== 'text') {
      throw new Error('Resposta invalida do Claude')
    }

    const clean = content.text.replace(/```json|```/g, '').trim()
    const resultado = JSON.parse(clean)
    return NextResponse.json({ sucesso: true, data: resultado })
  } catch (error) {
    console.error('Erro no analista:', error)
    return NextResponse.json({ error: 'Erro ao analisar dados' }, { status: 500 })
  }
}
