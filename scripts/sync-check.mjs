/**
 * The public manual entry of the PTC-and-upstream sync check (ticket 01).
 *
 *   pnpm sync:check                     one check round with the saved source
 *   pnpm sync:check --set-checkout <p>  save the machine-local DSH source path
 *
 * No shebang on purpose: this module is imported by its integration test, and
 * Vite's SSR transform keeps a shebang in its output (see
 * tests/integration/README.md). It is always run as "node scripts/sync-check.mjs".
 *
 * The command is maintenance-only: it needs no model credentials, mounts no
 * preset and answers no session. It reads a named DSH source tree and this
 * repository's own declarations, and writes exactly one round under the
 * configured evidence directory.
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { stateDirectory } from '../presets/ptc-hashline/operations/config.mjs'
import { runSyncCheck, saveDshCheckout, settingsOf, SYNC_EXIT } from '../presets/ptc-hashline/operations/sync.mjs'

/** The flags this entry accepts; anything else is a usage refusal. */
export const SYNC_FLAGS = ['checkout', 'set-checkout', 'now', 'sources', 'decisions', 'help']

const USAGE = [
  'PTC 与上游能力同步检查（手动入口，只读）',
  '',
  '  pnpm sync:check [flags]        执行一轮检查，写出 report.md 与 sync.json',
  '',
  '  --checkout <绝对路径>          本次使用的 DSH 源码目录（最高优先级）',
  '  --now <ISO-8601>              固定检查时间戳（复现与测试用）',
  '  --now <ISO-8601>              固定检查时间戳（复现与测试用）',
  '  --sources <文件|JSON>          本轮引擎发布来源的固定响应（外部来源边界，仅用于复现与测试）',
  '  --decisions <文件>            审阅决定记录（默认 <证据目录>/sync/decisions.json）',
  '  --help                        打印这段说明',
  '',
  '来源优先级：--checkout > DSH_CHECKOUT > 本机配置。三者都没有时明确报缺少配置，',
  '既不扫描磁盘也不静默换用其它目录；高优先级目录不可用时同样直接报错。',
  '退出码：0 完整；2 已停止或不完整（报告已写出）；3 用法错误。',
  '',
].join('\n')

/**
 * Parse the entry's arguments.
 * @param {string[]} argv arguments after the script path
 * @returns {Record<string, string | true>} the parsed flags
 * @throws {Error} on a positional argument, an unknown flag or a missing value
 */
export function parseArgs(argv) {
  const flags = {}
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token.startsWith('--')) throw new Error('unexpected argument ' + JSON.stringify(token) + '; this entry takes flags only')
    const name = token.slice(2)
    if (!SYNC_FLAGS.includes(name)) throw new Error('unknown flag --' + name + '; accepted: ' + SYNC_FLAGS.map((entry) => '--' + entry).join(', '))
    if (name === 'help') { flags.help = true; continue }
    const value = argv[index + 1]
    if (value === undefined || value.startsWith('--')) throw new Error('--' + name + ' needs a value')
    flags[name] = value
    index += 1
  }
  return flags
}

/**
 * Read the release-source records for this run.
 *
 * This is the EXTERNAL SOURCE boundary: a file path or inline JSON that pins what
 * the registry answered, for reproduction and for tests. It never causes an
 * install, a download or a version switch.
 * @param {string} value a file path or inline JSON
 * @returns {object[]} the raw records
 * @throws {Error} when the value cannot be read as a record list
 */
export function readReleaseSources(value) {
  const trimmed = String(value).trim()
  const inline = trimmed.startsWith('{') || trimmed.startsWith('[')
  let text
  try {
    text = inline ? trimmed : readFileSync(trimmed, 'utf8')
  } catch (error) {
    throw new Error('--sources could not be read: ' + (error instanceof Error ? error.message : String(error)))
  }
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new Error('--sources is not valid JSON: ' + (error instanceof Error ? error.message : String(error)))
  }
  const records = Array.isArray(parsed) ? parsed : parsed?.records
  if (!Array.isArray(records)) throw new Error('--sources must be an array of records, or an object with a "records" array')
  return records
}

const out = (value) => process.stdout.write(JSON.stringify(value, null, 2) + '\n')
const warn = (error) => process.stderr.write((error instanceof Error ? error.message : String(error)) + '\n')

/**
 * The entry point.
 * @param {string[]} argv arguments after the script path
 * @param {object} [environment] injected host facts (tests pass fixtures)
 * @returns {Promise<number>} the process exit code
 */
export async function main(argv, environment = {}) {
  let flags
  try {
    flags = parseArgs(argv)
  } catch (error) {
    warn(error)
    return SYNC_EXIT.refused
  }
  if (flags.help === true) {
    process.stdout.write(USAGE)
    return SYNC_EXIT.ok
  }
  const env = environment.env ?? process.env
  if (typeof flags['set-checkout'] === 'string') {
    // An explicit assignment is the ONLY write this entry performs on the
    // machine-local configuration. Whether the path is usable is answered by the
    // next check, so an unavailable directory is reported, never replaced.
    const directory = environment.stateDir ?? stateDirectory(env.DSH_HOME ?? join(homedir(), '.dsh'))
    try {
      const described = await saveDshCheckout({ directory, dshCheckout: flags['set-checkout'] })
      out({
        command: 'sync config',
        saved: { dshCheckout: settingsOf(described).dshCheckout ?? null },
        configuration: { path: described.path, exists: described.exists },
        next: 'pnpm sync:check',
      })
      return SYNC_EXIT.ok
    } catch (error) {
      warn(error)
      return SYNC_EXIT.refused
    }
  }
  let result
  try {
    result = await runSyncCheck({
      ...environment,
      env,
      ...typeof flags.checkout === 'string' ? { checkout: flags.checkout } : {},
      ...typeof flags.now === 'string' ? { now: flags.now } : {},
      ...typeof flags.sources === 'string' ? { sources: readReleaseSources(flags.sources) } : {},
      ...typeof flags.decisions === 'string' ? { decisions: flags.decisions } : {},
    })
  } catch (error) {
    warn(error)
    return SYNC_EXIT.refused
  }
  out(result.value)
  return result.code
}

/* istanbul ignore next -- exercised through the tests as a child process and as an import. */
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2))
}
