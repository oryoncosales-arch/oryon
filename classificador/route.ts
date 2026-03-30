import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

export async function POST(req: NextRequest) {
  try {
    const { extrato } = await req.json()

    if (!extrato) {
      return NextResponse.json({ error: 'Extrato não enviado' }, { status: 400 })
    }

    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      messages: [
        {
          role: 'user',
          content: `Você é um classificador financeiro especializado em contabilidade brasileira.

Analise o extrato bancário abaixo e classifique cada transação.

Para cada transação, retorne um JSON com este formato exato:
{
  "transacoes": [
    {
      "data": "DD/MM/AAAA",
      "descricao": "descrição original",
      "valor": 0.00,
      "tipo": "entrada" ou "saída",
      "categoria": "categoria aqui",
      "subcategoria": "subcategoria aqui"
    }
  ],
  "resumo": {
    "total_entradas": 0.00,
    "total_saidas": 0.00,
    "saldo": 0.00
  }
}

Categorias possíveis: Receita Operacional, Impostos, Folha de Pagamento, Fornecedores, Aluguel, Serviços, Transferência, Taxa Bancária, Outros.

Retorne APENAS o JSON, sem texto adicional.

EXTRATO:
${extrato}`,
        },
      ],
    })

    const content = response.content[0]
    if (content.type !== 'text') {
      throw new Error('Resposta inválida do Claude')
    }

    const resultado = JSON.parse(content.text)
    return NextResponse.json({ sucesso: true, data: resultado })

  } catch (error) {
    console.error('Erro no classificador:', error)
    return NextResponse.json({ error: 'Erro ao classificar extrato' }, { status: 500 })
  }
}