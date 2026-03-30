import { NextRequest, NextResponse } from 'next/server'

type TelegramUpdate = {
  update_id?: number
  message?: TelegramMessage
}

type TelegramMessage = {
  message_id: number
  chat: { id: number }
  from?: {
    id?: number
    is_bot?: boolean
    first_name?: string
    last_name?: string
    username?: string
    language_code?: string
  }
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
const PROJECT_BASE_URL = 'https://oryon-contabilizai.vercel.app'

function requiredEnv(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing env var: ${name}`)
  return v
}

type BotUsuario = {
  telegram_chat_id: number
  nome?: string | null
  empresa?: string | null
}

type Escritorio = {
  codigo: string
  nome?: string | null
  empresa?: string | null
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

async function telegramSendMessage(chatId: number, text: string) {
  await telegramApi('sendMessage', {
    chat_id: chatId,
    text,
  })
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

async function supabaseRequest(path: string, init?: RequestInit) {
  const url = requiredEnv('SUPABASE_URL').replace(/\/$/, '')
  const key = requiredEnv('SUPABASE_SERVICE_KEY')

  const res = await fetch(`${url}${path}`, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      ...(init?.headers ?? {}),
    },
  })

  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(`Supabase REST error (${path}): ${res.status} ${t}`)
  }

  const text = await res.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

async function getBotUsuario(chatId: number): Promise<BotUsuario | null> {
  const rows = (await supabaseRequest(
    `/rest/v1/bot_usuarios?telegram_chat_id=eq.${encodeURIComponent(String(chatId))}&select=telegram_chat_id,nome,empresa&limit=1`,
    { method: 'GET' },
  )) as BotUsuario[] | null

  if (!rows || !rows.length) return null
  return rows[0] ?? null
}

async function findEscritorioByCodigo(codigo: string): Promise<Escritorio | null> {
  const rows = (await supabaseRequest(
    `/rest/v1/escritorios?codigo=eq.${encodeURIComponent(codigo)}&select=codigo,nome,empresa&limit=1`,
    { method: 'GET' },
  )) as Escritorio[] | null

  if (!rows || !rows.length) return null
  return rows[0] ?? null
}

function buildNomeFromFrom(from?: TelegramMessage['from']) {
  const first = from?.first_name?.trim() ?? ''
  const last = from?.last_name?.trim() ?? ''
  const full = `${first} ${last}`.trim()
  if (full) return full
  if (from?.username) return from.username
  return 'Cliente'
}

async function createBotUsuario(params: { chatId: number; nome: string; empresa: string; codigo: string }) {
  // Mantém inserção simples e explícita para corresponder ao que você pediu.
  await supabaseRequest('/rest/v1/bot_usuarios', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({
      telegram_chat_id: params.chatId,
      nome: params.nome,
      empresa: params.empresa,
      escritorio_codigo: params.codigo,
    }),
  })
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
  empresa: string
}) {
  await supabaseRequest('/rest/v1/extratos', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({
      telegram_chat_id: params.telegramChatId,
      empresa: params.empresa,
      conteudo: params.texto,
      arquivo_nome: params.fileName ?? null,
      mime_type: params.mimeType ?? null,
      origem: 'telegram',
    }),
  })
}

async function callInternalJson(path: string, body: unknown) {
  const res = await fetch(`${PROJECT_BASE_URL}${path}`, {
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
    const texto = msg.text?.trim()

    // 1) /start
    if (texto === '/start' || texto?.startsWith('/start ')) {
      const usuario = await getBotUsuario(chatId)
      if (usuario?.telegram_chat_id) {
        const nome = usuario.nome ?? 'Cliente'
        const empresa = usuario.empresa ?? 'sua empresa'
        await telegramSendMessage(chatId, `Olá ${nome}! Pode enviar o extrato da ${empresa}.`)
      } else {
        await telegramSendMessage(chatId, 'Olá! Para começar, envie o código do escritório.')
      }
      return NextResponse.json({ ok: true })
    }

    // Documento ou foto (arquivo)
    const fileId =
      msg.document?.file_id ??
      (msg.photo && msg.photo.length ? msg.photo[msg.photo.length - 1].file_id : undefined)

    if (fileId) {
      const usuario = await getBotUsuario(chatId)
      if (!usuario?.telegram_chat_id) {
        await telegramSendMessage(chatId, 'Antes de enviar o extrato, por favor envie o código do escritório.')
        return NextResponse.json({ ok: true })
      }

      const empresa = usuario.empresa ?? 'sua empresa'
      const fileName = msg.document?.file_name
      const mimeType =
        msg.document?.mime_type ??
        (msg.photo ? 'image/jpeg' : undefined) ??
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
        await telegramSendMessage(
          chatId,
          'Não consegui extrair o texto do arquivo. Se puder, envie um CSV (ou texto) com as transações.',
        )
        return NextResponse.json({ ok: true })
      }

      await saveExtratoToSupabase({
        texto: extractedText,
        fileName,
        mimeType,
        telegramChatId: chatId,
        empresa,
      })

      const classificacao = await callInternalJson('/api/classificador', { extrato: extractedText })
      const analise = await callInternalJson('/api/analista', { dados: classificacao })

      const diagnostico = analise?.data
      const resposta = formatDiagnosticoPt(diagnostico)
      await telegramSendMessage(chatId, resposta)

      return NextResponse.json({ ok: true })
    }

    // 2) Texto que não é comando: cadastro por código do escritório
    if (texto && !texto.startsWith('/')) {
      const usuario = await getBotUsuario(chatId)
      if (usuario?.telegram_chat_id) {
        const nome = usuario.nome ?? 'Cliente'
        const empresa = usuario.empresa ?? 'sua empresa'
        await telegramSendMessage(chatId, `Olá ${nome}! Pode enviar o extrato da ${empresa}.`)
        return NextResponse.json({ ok: true })
      }

      const codigo = texto.trim()
      const escritorio = await findEscritorioByCodigo(codigo)
      if (!escritorio) {
        await telegramSendMessage(chatId, 'Código do escritório inválido. Verifique e tente novamente.')
        return NextResponse.json({ ok: true })
      }

      const nome = buildNomeFromFrom(msg.from)
      const empresa = (escritorio.empresa ?? escritorio.nome ?? '').trim() || 'sua empresa'

      await createBotUsuario({ chatId, nome, empresa, codigo })
      await telegramSendMessage(chatId, `Cadastro concluído, ${nome}! Pode enviar o extrato da ${empresa}.`)
      return NextResponse.json({ ok: true })
    }

    // Default
    await telegramSendMessage(chatId, 'Envie /start para começar, ou envie um arquivo (PDF, imagem ou CSV) com o extrato.')
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Erro no webhook telegram:', error)
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

