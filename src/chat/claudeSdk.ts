// Claude, host-side and unjailed: the operator's seat with a UI. The session
// runs at the wiki root with the wiki's own committed settings and hooks, so
// the write guard, `op record` and the llm-wiki skills are all in force, and
// a job the agent asks for (`jobs request`) is composed into its own jail by
// the CLI, credentials and all. Nothing here handles a credential.
import { query } from '@anthropic-ai/claude-agent-sdk'
import { mapMessage } from './claudeMap'
import type { ChatBackend, ChatEvent, TurnContext } from './types'
import { summarizeTool } from './types'

export interface ClaudeSdkConfig {
  /** Absolute path of the user's own `claude` binary; the SDK's bundled one is not shipped. */
  claudePath: string
  /** The PATH the session runs with, which must reach `llm-wiki-ops`. */
  path: string
  model?: string
}

const APPEND = [
  'You are running inside Obsidian, in the root of an llm-wiki wiki that is also the open vault.',
  'Operate the wiki through `llm-wiki-ops` verbs; `llm-wiki-ops --help` lists them.',
  'A job the person asks for (fetch mail, run a channel) is `llm-wiki-ops jobs request <slug> wait=120`; the CLI runs it in its own jail.',
  'Never print a credential. Link pages as [[wikilinks]] by their vault path.',
].join(' ')

/** Verbs that would print a secret into a transcript. */
const CREDENTIAL_RULE = ' When a job or skill needs a credential, say which one and stop; never ask the person to paste a secret into this chat. The plugin\'s Set credential button stores it without the value ever reaching a transcript.'

const DENIED = [
  'Bash(llm-wiki-ops credentials get*)',
  'Bash(llm-wiki-cli wiki * credentials get*)',
  'Bash(* credentials get *)',
]

export class ClaudeSdkBackend implements ChatBackend {
  sessionId: string | undefined

  constructor(private readonly config: ClaudeSdkConfig, resume?: string) {
    this.sessionId = resume
  }

  reset(): void {
    this.sessionId = undefined
  }

  async *send(prompt: string, ctx: TurnContext): AsyncIterable<ChatEvent> {
    const abort = new AbortController()
    const onAbort = () => abort.abort()
    if (ctx.signal.aborted) onAbort()
    ctx.signal.addEventListener('abort', onAbort, { once: true })
    yield { type: 'start' }
    // "Allow for this turn" answers every later ask in the same turn.
    let allowTurn = false
    try {
      const q = query({
        prompt,
        options: {
          cwd: ctx.wiki.root,
          pathToClaudeCodeExecutable: this.config.claudePath,
          // Replaces the environment: the login shell's PATH, and the attendance
          // marker a protected write reads, because a person is watching this pane.
          env: {
            ...process.env,
            PATH: this.config.path,
            LLM_WIKI_SESSION_ATTENDED: '1',
            CLAUDE_AGENT_SDK_CLIENT_APP: 'llm-wiki-obsidian',
          },
          abortController: abort,
          includePartialMessages: true,
          settingSources: ['user', 'project', 'local'],
          systemPrompt: { type: 'preset', preset: 'claude_code', append: APPEND + CREDENTIAL_RULE },
          permissionMode: 'default',
          disallowedTools: DENIED,
          ...(this.sessionId ? { resume: this.sessionId } : {}),
          ...(this.config.model ? { model: this.config.model } : {}),
          canUseTool: async (toolName, input) => {
            if (allowTurn) return { behavior: 'allow', updatedInput: input }
            const decision = await ctx.askPermission({ tool: toolName, input, summary: summarizeTool(toolName, input) })
            if (decision.allow && decision.forTurn) allowTurn = true
            return decision.allow
              ? { behavior: 'allow', updatedInput: input }
              : { behavior: 'deny', message: decision.reason ?? 'Denied in Obsidian' }
          },
          stderr: (chunk) => ctx.onStderr?.(chunk),
        },
      })
      for await (const m of q) {
        const { sessionId, events } = mapMessage(m)
        if (sessionId) this.sessionId = sessionId
        for (const e of events) yield e
      }
    } catch (e) {
      if (!ctx.signal.aborted) yield { type: 'error', message: e instanceof Error ? e.message : String(e) }
    } finally {
      ctx.signal.removeEventListener('abort', onAbort)
    }
  }
}
