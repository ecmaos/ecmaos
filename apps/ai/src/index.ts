#!ecmaos:bin:app:ai

import OpenAI from 'openai'
import type { ProcessEntryParams, Shell } from '@ecmaos/types'

const help = `
Usage: ai [options] [prompt]

If no prompt is provided, reads from stdin.

Options:
  --help       Show help
  --key        The API key to use (default: environment variable OPENAI_API_KEY)
  --max        The maximum number of messages to keep in the session (default: 50)
  --model      The model to use (default: gpt-4o)
  --no-stream  Disable streaming output (streaming is enabled by default)
  --session    The session to use (default: a new session)
  --url        The base URL to use (default: https://api.openai.com/v1)

Environment Variables:
  OPENAI_BASE_URL  The base URL to use (default: https://api.openai.com/v1)
  OPENAI_API_KEY   The API key to use (required or --key option)
  OPENAI_MODEL     The model to use (default: gpt-4o)

Examples:
  ai "Tell me a joke"
  cat prompt.txt | ai
  echo "Explain quantum computing" | ai --model gpt-4o
  ai --no-stream "Tell me a joke"
  ai --url https://openrouter.ai/api/v1 --key sk-or-v1-xxx --model openai/gpt-4o --session my-session "Tell me a joke"
`

type ParsedArgs = { options: Record<string, string | boolean>, params: string[] }

const DefaultSessionData = {
  messages: []
}

function parser(args: string[]): ParsedArgs {
  const options: Record<string, string | boolean> = {}
  const params: string[] = []
  for (let i = 0; i < args.length; i++) {
    const current = args[i]
    if (current === undefined) continue
    const arg = current
    if (!arg.startsWith('-')) {
      params.push(arg)
      continue
    }

    if (arg.includes('=')) {
      const idx = arg.indexOf('=')
      const key = arg.slice(0, idx)
      const value = arg.slice(idx + 1)
      if (key && value !== undefined) options[key.replace(/^-+/, '')] = value
      continue
    }

    const key = arg
    const next = args[i + 1]
    if (next !== undefined && !next.startsWith('-')) {
      options[key.replace(/^-+/, '')] = next
      i++
    } else {
      options[key.replace(/^-+/, '')] = true
    }
  }
  return { options, params }
}

async function loadSession(session: string, { shell }: { shell: Shell }) {
  const sessionExists = await shell.context.fs.promises.exists(`${shell.envObject.HOME}/.cache/ai/sessions/${session}`)
  if (!sessionExists) await shell.context.fs.promises.mkdir(`${shell.envObject.HOME}/.cache/ai/sessions/${session}`, { recursive: true })
  const sessionFileExists = await shell.context.fs.promises.exists(`${shell.envObject.HOME}/.cache/ai/sessions/${session}/session.json`)
  if (!sessionFileExists) await shell.context.fs.promises.writeFile(`${shell.envObject.HOME}/.cache/ai/sessions/${session}/session.json`, JSON.stringify(DefaultSessionData))
  const sessionData = await shell.context.fs.promises.readFile(`${shell.envObject.HOME}/.cache/ai/sessions/${session}/session.json`, 'utf-8')
  return JSON.parse(sessionData)
}

async function saveSession(session: string, data: any, { shell }: { shell: Shell }) {
  await shell.context.fs.promises.writeFile(`${shell.envObject.HOME}/.cache/ai/sessions/${session}/session.json`, JSON.stringify(data))
}

async function compressMessages(messages: Array<{ role: string, content: string }>, openai: OpenAI, model: string): Promise<string> {
  const summaryPrompt = `Please provide a concise summary of the following conversation history, preserving key information, decisions, and context that would be important for continuing the conversation:\n\n${messages.map(m => `${m.role}: ${m.content}`).join('\n\n')}`
  
  const response = await openai.chat.completions.create({
    model,
    temperature: 0.3,
    messages: [
      { role: 'system', content: 'You are a helpful assistant that summarizes conversation history while preserving important context and information with minimal tokens.' },
      { role: 'user', content: summaryPrompt }
    ]
  })
  
  return response.choices[0]?.message.content || ''
}

async function pruneMessages(session: { messages: Array<{ role: string, content: string }> }, maxMessages: number, openai: OpenAI, model: string, reserveSpace: number = 0) {
  const totalMessages = session.messages.length
  const targetMax = maxMessages - reserveSpace
  
  if (totalMessages <= targetMax) {
    return
  }
  
  const messagesToKeep = targetMax - 1
  const messagesToCompress = totalMessages - messagesToKeep
  
  const messagesToRemove = session.messages.slice(0, messagesToCompress)
  const messagesToKeepList = session.messages.slice(messagesToCompress)
  
  const existingSystemSummaryInKept = messagesToKeepList.find(m => m.role === 'system' && m.content?.startsWith('Previous conversation summary:'))
  
  if (messagesToRemove.length > 0) {
    const messagesForCompression = existingSystemSummaryInKept
      ? [existingSystemSummaryInKept, ...messagesToRemove]
      : messagesToRemove
    
    const summary = await compressMessages(messagesForCompression, openai, model)
    
    const messagesWithoutOldSummary = existingSystemSummaryInKept
      ? messagesToKeepList.filter(m => m !== existingSystemSummaryInKept)
      : messagesToKeepList
    
    session.messages = [
      { role: 'system', content: `Previous conversation summary: ${summary}` },
      ...messagesWithoutOldSummary
    ]
  }
}

async function readStdin(stdin: ReadableStream<Uint8Array> | undefined, timeoutMs: number = 100): Promise<string> {
  if (!stdin) return ''
  
  const reader = stdin.getReader()
  const decoder = new TextDecoder()
  const chunks: string[] = []
  
  try {
    // First read with timeout to detect if stdin has data (pipe) or is interactive (terminal)
    const firstRead = reader.read()
    const timeout = new Promise<{ done: true, value: undefined }>((resolve) => 
      setTimeout(() => resolve({ done: true, value: undefined }), timeoutMs)
    )
    
    const first = await Promise.race([firstRead, timeout])
    if (first.done && !first.value) {
      // Timeout or empty stream - no piped input
      return ''
    }
    if (first.value) {
      chunks.push(decoder.decode(first.value, { stream: true }))
    }
    if (first.done) {
      chunks.push(decoder.decode())
      return chunks.join('').trim()
    }
    
    // Continue reading the rest of the stream
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(decoder.decode(value, { stream: true }))
    }
    // Flush any remaining bytes
    chunks.push(decoder.decode())
  } finally {
    reader.releaseLock()
  }
  
  return chunks.join('').trim()
}

async function main(processEntryParams: ProcessEntryParams) {
  const { args, shell, stdin, stdout, stderr, terminal } = processEntryParams
  const { options, params } = parser(args)

  const stdoutWriter = stdout?.getWriter()
  const stderrWriter = stderr?.getWriter()

  const print = async (text: string, type: 'stdout' | 'stderr' = 'stdout') => {
    if (type === 'stdout' && stdoutWriter) await stdoutWriter.write(new TextEncoder().encode(text))
    if (type === 'stderr' && stderrWriter) await stderrWriter.write(new TextEncoder().encode(text))
  }

  if (options.help) {
    await print(help)
    return 0
  }

  const OPENAI_BASE_URL = options.url as string || shell.envObject.OPENAI_BASE_URL || 'https://api.openai.com/v1'
  const OPENAI_API_KEY = options.key || shell.envObject.OPENAI_API_KEY
  if (!OPENAI_API_KEY) {
    await print('Error: OPENAI_API_KEY is not set\n', 'stderr')
    await print('Please set the OPENAI_API_KEY environment variable or use the --key option\n', 'stderr')
    return 1
  }

  const model = options.model as string || shell.envObject.OPENAI_MODEL || 'gpt-4o'
  const maxMessages = options.max ? parseInt(options.max as string, 10) : 10
  const useStreaming = !options['no-stream']
  const openai = new OpenAI({
    apiKey: OPENAI_API_KEY as string,
    baseURL: OPENAI_BASE_URL,
    dangerouslyAllowBrowser: true
  })

  try {
    // Get prompt from args or stdin
    let prompt = params[0]
    if (!prompt) prompt = await readStdin(stdin)
    
    if (!prompt) {
      await print(help)
      return 1
    }

    const sessionID = options.session ? options.session as string : Math.random().toString(36).slice(2)
    const session = await loadSession(sessionID, { shell })

    await pruneMessages(session, maxMessages, openai, model, 1)
    session.messages.push({ role: 'user', content: prompt })
    
    let responseContent = ''

    if (useStreaming) {
      // Streaming mode
      const stream = await openai.chat.completions.create({
        model,
        messages: session.messages,
        stream: true,
      })

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || ''
        if (content) {
          responseContent += content
          await print(content)
        }
      }
      await print('\n')
    } else {
      // Non-streaming mode
      const response = await openai.chat.completions.create({
        model,
        messages: session.messages,
      })
      responseContent = response.choices[0]?.message.content || ''
      await print(responseContent + '\n')
    }

    session.messages.push({ role: 'assistant', content: responseContent })
    
    await pruneMessages(session, maxMessages, openai, model, 0)
    
    await saveSession(sessionID, session, { shell })
    return 0
  } catch (error) {
    await print(`Error: ${error instanceof Error ? error.message : String(error)}\n`, 'stderr')
    return 1
  } finally {
    try {
      if (stdoutWriter) {
        if (stdout && terminal && stdout !== terminal.stdout) {
          try {
            await stdoutWriter.close()
          } catch {
            try {
              stdoutWriter.releaseLock()
            } catch {
            }
          }
        } else {
          stdoutWriter.releaseLock()
        }
      }
    } catch {
    }
    try {
      if (stderrWriter) {
        if (stderr && terminal && stderr !== terminal.stderr) {
          try {
            await stderrWriter.close()
          } catch {
            try {
              stderrWriter.releaseLock()
            } catch {
            }
          }
        } else {
          stderrWriter.releaseLock()
        }
      }
    } catch {
    }
  }
}

export default main
