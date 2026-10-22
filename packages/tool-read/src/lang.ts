/**
 * Read-card language hints, mirrored from the host's shared table.
 *
 * The host persists a short `lang` id on the read card's `meta` so a replayed
 * session can highlight the body. This plugin must not import a host runtime
 * package (NFR-4), so the extension table is mirrored here and
 * `tests/unit/lang.spec.ts` asserts every entry against
 * `@deepseek-ai/dsh-util-code-language`'s `readLangHintForPath` (a test-only
 * dependency), which makes drift a build failure rather than a silent UI change.
 * Source: `@deepseek-ai/dsh-util-code-language` 0.2.1-rc.2 (same table the stock
 * read tool projects).
 * @module @dsh-tool-hashline/tool-read/lang
 */

/** Extension (lowercase, no dot) to the persisted short language id. */
const LANG_BY_EXTENSION = new Map<string, string>([
  ['ts', 'ts'],
  ['tsx', 'tsx'],
  ['mts', 'ts'],
  ['cts', 'ts'],
  ['js', 'js'],
  ['jsx', 'jsx'],
  ['mjs', 'js'],
  ['cjs', 'js'],
  ['sh', 'sh'],
  ['bash', 'sh'],
  ['zsh', 'sh'],
  ['fish', 'fish'],
  ['json', 'json'],
  ['jsonc', 'json'],
  ['jsonl', 'json'],
  ['ndjson', 'json'],
  ['ipynb', 'json'],
  ['csv', 'csv'],
  ['py', 'py'],
  ['pyw', 'py'],
  ['pyi', 'py'],
  ['rb', 'rb'],
  ['rake', 'rb'],
  ['gemspec', 'rb'],
  ['go', 'go'],
  ['rs', 'rs'],
  ['java', 'java'],
  ['c', 'c'],
  ['h', 'c'],
  ['cc', 'cpp'],
  ['cpp', 'cpp'],
  ['cxx', 'cpp'],
  ['hh', 'cpp'],
  ['hpp', 'cpp'],
  ['hxx', 'cpp'],
  ['cs', 'cs'],
  ['kt', 'kotlin'],
  ['kts', 'kotlin'],
  ['swift', 'swift'],
  ['php', 'php'],
  ['yaml', 'yaml'],
  ['yml', 'yaml'],
  ['toml', 'toml'],
  ['ini', 'ini'],
  ['conf', 'ini'],
  ['cfg', 'ini'],
  ['properties', 'ini'],
  ['env', 'env'],
  ['log', 'log'],
  ['diff', 'diff'],
  ['patch', 'diff'],
  ['http', 'http'],
  ['md', 'md'],
  ['markdown', 'md'],
  ['mdx', 'mdx'],
  ['rst', 'rst'],
  ['tex', 'tex'],
  ['sty', 'tex'],
  ['cls', 'tex'],
  ['bib', 'bib'],
  ['adoc', 'adoc'],
  ['html', 'html'],
  ['htm', 'html'],
  ['xhtml', 'html'],
  ['css', 'css'],
  ['scss', 'scss'],
  ['less', 'less'],
  ['sql', 'sql'],
  ['xml', 'xml'],
  ['xsd', 'xml'],
  ['xsl', 'xml'],
  ['xslt', 'xml'],
  ['plist', 'xml'],
  ['svg', 'xml'],
  ['lua', 'lua'],
  ['bat', 'bat'],
  ['cmd', 'bat'],
  ['ps1', 'ps1'],
  ['psm1', 'ps1'],
  ['psd1', 'ps1'],
  ['r', 'r'],
  ['jl', 'jl'],
  ['dart', 'dart'],
  ['scala', 'scala'],
  ['clj', 'clj'],
  ['cljs', 'clj'],
  ['edn', 'clj'],
  ['erl', 'erl'],
  ['hrl', 'erl'],
  ['ex', 'ex'],
  ['exs', 'ex'],
  ['hs', 'hs'],
  ['fs', 'fs'],
  ['fsi', 'fs'],
  ['fsx', 'fs'],
  ['vb', 'vb'],
  ['pl', 'pl'],
  ['pm', 'pl'],
  ['v', 'v'],
  ['sv', 'sv'],
  ['svh', 'sv'],
  ['graphql', 'graphql'],
  ['gql', 'graphql'],
  ['proto', 'proto'],
  ['tf', 'tf'],
  ['tfvars', 'tfvars'],
  ['hcl', 'hcl'],
  ['nix', 'nix'],
  ['vue', 'vue'],
  ['svelte', 'svelte'],
  ['makefile', 'make'],
  ['mk', 'make'],
  ['cmake', 'cmake'],
  ['gradle', 'gradle'],
  ['groovy', 'groovy'],
])

/**
 * Derive the read card's language hint from a path.
 *
 * Both separators are recognized, the extension is the text after the last dot
 * of the final segment (so `.env` works), and matching is case-insensitive. An
 * unrecognized or absent suffix yields `undefined` (plain-text card).
 * @param path - the model-facing path the read reported.
 * @returns the short language id, or `undefined`.
 */
export function readLangHint(path: string): string | undefined {
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  const base = path.slice(slash + 1)
  const dot = base.lastIndexOf('.')
  if (dot < 0) return undefined
  return LANG_BY_EXTENSION.get(base.slice(dot + 1).toLowerCase())
}
