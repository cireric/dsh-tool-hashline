/**
 * In-process TypeScript PTC carrier for the acceptance tier.
 *
 * Implements the production `PtcRuntime` contract (source language, program
 * format, binding namespaces, result taxonomy) without a child process. The
 * point of this tier is the *contract*: the registry generates the SDK from the
 * tool schemas, hands the program the bindings, receives the canonical
 * `value`, and routes every inner call back through the same registry pipeline
 * (including `tools/pre-execute`). Process isolation, sandboxing and timeouts
 * are the node runtime's job and are not claimed here.
 * @module dsh-tool-hashline/tests/ptc/carrier
 */

import { PtcRuntime } from '@deepseek-ai/dsh-ptc-runtime'
import type { Context } from '@deepseek-ai/cordis'
import type { PtcRunRequest, PtcRunResult, PtcRunSpec } from '@deepseek-ai/dsh-ptc-runtime'

/** Program-visible console sink; the real runtimes capture the same channels. */
interface CapturedConsole {
  log: (...args: unknown[]) => void
  info: (...args: unknown[]) => void
  warn: (...args: unknown[]) => void
  error: (...args: unknown[]) => void
}

const format = (args: unknown[]): string => args.map(value => typeof value === 'string' ? value : JSON.stringify(value)).join(' ')

export class InProcessPtcRuntime extends PtcRuntime {
  readonly language = 'typescript'
  readonly isolation = 'in-process-test'

  constructor(ctx: Context) {
    super(ctx)
  }

  resolve(request: PtcRunRequest): PtcRunSpec {
    return { ...request, cwd: request.cwd ?? process.cwd(), timeoutMs: request.timeoutMs ?? null }
  }

  async run(spec: PtcRunSpec): Promise<PtcRunResult> {
    const logs: string[] = []
    const sink: CapturedConsole = {
      log: (...args) => { logs.push(format(args)) },
      info: (...args) => { logs.push(format(args)) },
      warn: (...args) => { logs.push(format(args)) },
      error: (...args) => { logs.push(format(args)) },
    }
    const globals: Record<string, unknown> = {}
    for (const namespace of spec.bindings) {
      globals[namespace.global] = { ...namespace.functions }
      if (namespace.errorClass !== undefined) {
        globals[namespace.errorClass.name] = namespace.errorClass
      }
    }
    const names = Object.keys(globals)
    try {
      const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (...args: string[]) => (...values: unknown[]) => Promise<unknown>
      const program = new AsyncFunction(...names, 'console', spec.program)
      const value = await program(...names.map(name => globals[name]), sink)
      return { logs, ...value === undefined ? {} : { value: value as never } }
    } catch (error) {
      return { logs, error: { kind: 'exception', message: error instanceof Error ? (error.stack ?? error.message) : String(error) } }
    }
  }
}

export const name = 'ptc-runtime-in-process'
