import { NextRequest, NextResponse } from 'next/server'

type TelegramUpdate = {
  update_id?: number
  message?: TelegramMessage
}

type TelegramMessage = {
  message_id: number
  chat: { id: number }
  text?: string
  document?: {
    file_id: string
    file_name?: string
    mime_type?: string
  }
  photo?: Array<{
    file_id: string
  }>
  caption?: string
}

const TELEGRAM_API = 'https://api.telegram.org'
const TELEGRAM_FILE_API = 'https://api.telegram.org/file'

function requiredEnv(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing env var: ${name}`)
  return v
}

async function telegramApi(method: string, body: unknown) {
  const token = requiredEnv('TELEGRAM_BOT_TOKEN')
  const res = await fetch(`${TELEGRAM_API}/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(`Telegram API error (${method}): ${res.status} ${t}`)
  }
  return await res.json().catch(() => ({}))
}

async function telegramGetFile(fileId: string): Promise<{ file_path: string }> {
  const token = requiredEnv('TELEGRAM_BOT_TOKEN')
  const res = await fetch(
    `${TELEGRAM_API}/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`,
  )
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(`Telegram getFile error: ${res.status} ${t}`)
  }
  const json = (await res.json()) as { ok: boolean; result?: { file_path?: string } }
  const file_path = json.result?.file_path
  if (!file_path) throw new Error('Telegram getFile: file_path ausente')
  return { file_path }
}

async function telegramDownloadFile(filePath: string): Promise<Buffer> {
  const token = requiredEnv('TELEGRAM_BOT_TOKEN')
  const res = await fetch(`${TELEGRAM_FILE_API}/bot${token}/${filePath}`)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(`Telegram download error: ${res.status} ${t}`)
  }
  const ab = await res.arrayBuffer()
  return Buffer.from(ab)
}

function bufferToBase64(buf: Buffer) {
  return buf.toString('base64')
}

function sniffIsProbablyBinaryUtf8(text: string) {
  let zeros = 0
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 0) zeros++
  return zeros > 0
}

async function anthropicExtractTextFromMedia(params: {
  mediaType: string
  base64Data: string
  hint?: string
}) {
  const apiKey = requiredEnv('ANTHROPIC_API_KEY')

  const contentBlocks: any[] = [
    {
      type: 'text',
      text: `Extraia o texto do arquivo enviado (sem inventar nada).

Regras:
- Retorne APENAS o texto extraído, sem JSON e sem markdown.
- Preserve linhas/colunas quando fizer sentido (ex.: CSV).
- Se não for possível extrair, diga: "NAO_FOI_POSSIVEL_EXTRAIR_TEXTO".

Dica de contexto (se houver):
${params.hint ?? ''}`.trim(),
    },
  ]

  if (params.mediaType.startsWith('image/')) {
    contentBlocks.push({
      type: 'image',
      source: { type: 'base64', media_type: params.mediaType, data: params.base64Data },
    })
  } else {
    contentBlocks.push({
      type: 'document',
      source: { type: 'base64', media_type: params.mediaType, data: params.base64Data },
    })
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1800,
      messages: [{ role: 'user', content: contentBlocks }],
    }),
  })

  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(`Anthropic extract error: ${res.status} ${t}`)
  }

  const json = (await res.json()) as { content?: Array<any> }
  const first = json.content?.[0]
  if (!first || first.type !== 'text') throw new Error('Resposta inválida do Claude (extract)')
  return String(first.text).trim()
}

async function saveExtratoToSupabase(params: {
  texto: string
  fileName?: string
  mimeType?: string
  telegramChatId: number
  telegramMessageId: number
}) {
  const url = requiredEnv('SUPABASE_URL')
  const key = requiredEnv('SUPABASE_SERVICE_KEY')
  const endpoint = `${url.replace(/\/$/, '')}/rest/v1/extratos`

  const candidates: Record<string, unknown>[] = [
    {
      conteudo: params.texto,
      arquivo_nome: params.fileName ?? null,
      mime_type: params.mimeType ?? null,
      origem: 'telegram',
      telegram_chat_id: params.telegramChatId,
      telegram_message_id: params.telegramMessageId,
      metadata: {
        telegram_chat_id: params.telegramChatId,
        telegram_message_id: params.telegramMessageId,
        arquivo_nome: params.fileName ?? null,
        mime_type: params.mimeType ?? null,
      },
    },
    { conteudo: params.texto },
    { texto: params.texto },
    { raw_text: params.texto },
    { content: params.texto },
  ]

  let lastErr = ''
  for (const payload of candidates) {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify(payload),
    })
    if (res.ok) return { ok: true }
    lastErr = await res.text().catch(() => res.statusText)
  }
  throw new Error(`Falha ao salvar no Supabase (extratos). Último erro: ${lastErr}`)
}

async function callInternalJson(req: NextRequest, path: string, body: unknown) {
  const baseUrl = new URL(req.url).origin
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`Erro em ${path}: ${res.status} ${text}`)
  return JSON.parse(text) as any
}

function formatDiagnosticoPt(diag: any) {
  if (!diag || typeof diag !== 'object') return 'Não foi possível gerar um diagnóstico com os dados fornecidos.'
  const saude = diag.saude_financeira ?? '—'
  const score = typeof diag.score === 'number' ? diag.score : '—'
  const diagnostico = diag.diagnostico ?? ''
  const pontos_positivos = Array.isArray(diag.pontos_positivos) ? diag.pontos_positivos : []
  const pontos_atencao = Array.isArray(diag.pontos_atencao) ? diag.pontos_atencao : []
  const recomendacoes = Array.isArray(diag.recomendacoes) ? diag.recomendacoes : []
  const maiores_gastos = Array.isArray(diag.maiores_gastos) ? diag.maiores_gastos : []

  const gastos = maiores_gastos
    .slice(0, 5)
    .map((g: any) => {
      const cat = g?.categoria ?? '—'
      const valor = typeof g?.valor === 'number' ? g.valor.toFixed(2) : '—'
      const pct = typeof g?.percentual === 'number' ? `${g.percentual}%` : '—'
      return `- ${cat}: R$ ${valor} (${pct})`
    })
    .join('\n')

  const pp = pontos_positivos.slice(0, 5).map((x: any) => `- ${String(x)}`).join('\n')
  const pa = pontos_atencao.slice(0, 5).map((x: any) => `- ${String(x)}`).join('\n')
  const rec = recomendacoes.slice(0, 5).map((x: any) => `- ${String(x)}`).join('\n')

  return [
    `Diagnóstico financeiro`,
    `Saúde: ${saude}`,
    `Score: ${score}`,
    diagnostico ? `\n${diagnostico}` : '',
    pontos_positivos.length ? `\nPontos positivos:\n${pp}` : '',
    pontos_atencao.length ? `\nPontos de atenção:\n${pa}` : '',
    recomendacoes.length ? `\nRecomendações:\n${rec}` : '',
    maiores_gastos.length ? `\nMaiores gastos:\n${gastos}` : '',
  ]
    .filter((s) => s.trim() !== '')
    .join('\n')
}

export async function GET() {
  return NextResponse.json({ ok: true })
}

export async function POST(req: NextRequest) {
  try {
    const update = (await req.json()) as TelegramUpdate
    const msg = update.message
    if (!msg?.chat?.id || !msg.message_id) return NextResponse.json({ ok: true })

    const chatId = msg.chat.id

    const fileId =
      msg.document?.file_id ??
      (msg.photo && msg.photo.length ? msg.photo[msg.photo.length - 1].file_id : undefined)

    if (!fileId) {
      await telegramApi('sendMessage', {
        chat_id: chatId,
        text: 'Envie um arquivo (PDF, imagem ou CSV) para eu analisar. Se preferir, mande um CSV com as transações.',
      })
      return NextResponse.json({ ok: true })
    }

    const fileName = msg.document?.file_name
    const mimeType =
      msg.document?.mime_type ??
      (fileName?.toLowerCase().endsWith('.csv') ? 'text/csv' : undefined)

    const { file_path } = await telegramGetFile(fileId)
    const fileBuf = await telegramDownloadFile(file_path)

    let extractedText = ''

    if (mimeType === 'text/csv' || mimeType?.startsWith('text/')) {
      extractedText = fileBuf.toString('utf8').trim()
    } else if (mimeType === 'application/pdf') {
      const maybeText = fileBuf.toString('utf8')
      if (maybeText && !sniffIsProbablyBinaryUtf8(maybeText)) extractedText = maybeText.trim()
      else {
        extractedText = await anthropicExtractTextFromMedia({
          mediaType: 'application/pdf',
          base64Data: bufferToBase64(fileBuf),
          hint: fileName,
        })
      }
    } else if (mimeType?.startsWith('image/')) {
      extractedText = await anthropicExtractTextFromMedia({
        mediaType: mimeType,
        base64Data: bufferToBase64(fileBuf),
        hint: msg.caption,
      })
    } else {
      const maybeText = fileBuf.toString('utf8').trim()
      if (maybeText && !sniffIsProbablyBinaryUtf8(maybeText)) extractedText = maybeText
      else {
        extractedText = await anthropicExtractTextFromMedia({
          mediaType: mimeType ?? 'application/octet-stream',
          base64Data: bufferToBase64(fileBuf),
          hint: fileName,
        })
      }
    }

    if (!extractedText || extractedText.includes('NAO_FOI_POSSIVEL_EXTRAIR_TEXTO')) {
      await telegramApi('sendMessage', {
        chat_id: chatId,
        text: 'Não consegui extrair o texto do arquivo. Se puder, envie um CSV (ou texto) com as transações.',
      })
      return NextResponse.json({ ok: true })
    }

    await saveExtratoToSupabase({
      texto: extractedText,
      fileName,
      mimeType,
      telegramChatId: chatId,
      telegramMessageId: msg.message_id,
    })

    const classificacao = await callInternalJson(req, '/api/classificador', { extrato: extractedText })
    const analise = await callInternalJson(req, '/api/analista', { dados: classificacao })

    const diagnostico = analise?.data
    const resposta = formatDiagnosticoPt(diagnostico)

    await telegramApi('sendMessage', { chat_id: chatId, text: resposta })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Erro no webhook telegram:', error)
    // Telegram normalmente aceita 200 mesmo com falhas pontuais, mas aqui retornamos 500 com detalhes em dev.
    return NextResponse.json(
      {
        ok: true,
        error: 'Erro ao processar webhook',
        details:
          process.env.NODE_ENV !== 'production'
            ? error instanceof Error
              ? error.message
              : String(error)
            : undefined,
      },
      { status: 200 },
    )
  }
}

