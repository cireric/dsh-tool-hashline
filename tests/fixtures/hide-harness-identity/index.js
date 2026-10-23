/**
 * Host half: make the model's system prompt carry no Harness brand.
 *
 * The preset owns the persona. This plugin owns one thing only:
 *
 * **Brand scrub.** The fixed `harness:identity` opener at order -1000 is
 * dropped by this bundle's patch (`includeHarnessIdentity: false`), and a
 * `system-prompt/assemble` waterfall listener neutralises any brand-naming
 * self-introduction sentence and then deletes the remaining brand wording,
 * across every section, every runtime-context paragraph, and every tool
 * description.
 *
 * It is a rewrite of rendered text: section names, tool names, tool schemas,
 * variables, and the session log are untouched. The one exception is a
 * runtime-context paragraph that was actually rewritten — it is renamed so
 * `refreshContext()` keeps the rewrite instead of re-resolving the provider
 * (see {@link hideFromRefresh}).
 *
 * **Why there is no per-agent persona override any more.** Up to 1.3.0 the
 * plugin registered a same-name `deployment:persona-prefix` section in each
 * agent scope, which shadowed the preset's persona. `SystemPrompt.assemble()`
 * merges scopes BEFORE the assemble waterfall, so the preset persona never
 * reached the waterfall at all: the model received the neutral one-liner and
 * lost Phase 0, the intent buckets, delegation rules, verification rules and
 * every other behavioral paragraph. A rewrite listener cannot recover a
 * section that was dropped upstream, so that layer is gone. `text` /
 * `complete` are rejected with a migration diagnostic instead of silently
 * doing nothing.
 *
 * `system-prompt.personaPrefix` in the bundle patch stays as the deployment
 * fallback for an assembly with NO preset persona; a preset scope still
 * shadows it, so it can never overwrite a preset's persona.
 *
 * Order matters. Scrubbing the brand alone would turn
 * `You are an AI agent powered by DeepSeek Harness.` into
 * `You are an AI agent powered by <another brand>.` — still a self-introduction
 * sentence naming a brand. Dropping that sentence first and scrubbing the
 * residue afterwards leaves no such sentence at all.
 *
 * Sentences are matched after resolving `{{variable}}` references with the
 * assembly's own variable map, because `assemble()` runs the waterfall before
 * `renderPrompt()` interpolates. Without that, the shipped persona's
 * `You are a coding agent powered by the {{model}} model.` would only name its
 * brand at render time and would escape the neutraliser.
 *
 * @module @local/hide-harness-identity
 */

/** Cordis plugin name. */
export const name = 'hide-harness-identity'

/** The agent registry drives the per-agent section lifecycle; the prompt registry hosts the scrub. */
export const inject = ['systemPrompt']

/**
 * Replacement used when the row supplies no `replace` list: delete the phrase
 * rather than swap in another brand. A brand-for-brand swap keeps the prompt
 * shaped like a third-party client's self-description, and it relabels every
 * model — including ones that have nothing to do with that brand.
 */
const DEFAULT_REPLACE = [{ from: 'DeepSeek Harness', to: '' }]

/** Sentence used when the row supplies no non-blank `neutralText`. */
const DEFAULT_NEUTRAL = 'You are a helpful AI assistant.'

/**
 * Brands whose self-introduction sentences are neutralised.
 *
 * Deliberately narrow: the DeepSeek/Harness brand only. A self-introduction
 * naming some other vendor is that vendor's business, and rewriting it here
 * would relabel models this bundle has no reason to touch. `DeepSeek` also
 * covers the model-name spelling the preset persona used
 * (`You are a coding agent powered by the deepseek-v4.1-flash model.`), which
 * the upstream check treated as the same fingerprint shape.
 */
const DEFAULT_BRANDS = ['DeepSeek Harness', 'DeepSeek', 'Harness']

/**
 * One validation issue in the shape Cordis' `resolveConfig()` aggregates.
 * @param path - config key that failed.
 * @param message - what was expected.
 * @returns the issue object.
 */
const issue = (path, message) => ({ path: [path], message })

/**
 * Plugin config schema.
 *
 * Declared so Cordis validates the row before `apply()` runs. Without it
 * `resolveConfig()` passes the raw YAML through untouched, and a typo such as
 * `brands: DeepSeek` (a string, not a list) silently falls back to the defaults
 * — the plugin would appear to work while ignoring the setting.
 *
 * A pure shape validator: it rejects wrong shapes and passes accepted values
 * through unchanged, so every default lives in exactly one place, the
 * `DEFAULT_*` constants and the `normalize*` helpers below.
 *
 * Hand-written in the Standard Schema shape rather than built with
 * `@deepseek-ai/schemastery`: this bundle is linked from a workspace
 * directory, where that package does not resolve.
 */
export const Config = {
  '~standard': {
    version: 1,
    vendor: 'hide-harness-identity',
    /**
     * Validate one row's config shape.
     * @param raw - the row's `config` mapping.
     * @returns the config as given, or the collected issues.
     */
    validate(raw) {
      const issues = []
      const isMapping = value => value !== null && typeof value === 'object' && !Array.isArray(value)
      if (raw !== undefined && !isMapping(raw)) {
        issues.push(issue('config', 'expected a mapping'))
        return { issues }
      }
      const config = raw ?? {}
      const shapes = [
        ['text', value => typeof value === 'string', 'a string'],
        ['neutralText', value => typeof value === 'string', 'a string'],
        ['brands', value => Array.isArray(value) && value.every(entry => typeof entry === 'string'), 'an array of strings'],
        ['replace', value => Array.isArray(value) && value.every(entry =>
          isMapping(entry) && typeof entry.from === 'string'
          && (entry.to === undefined || typeof entry.to === 'string')), 'an array of { from, to } objects'],
        ['scrubTools', value => typeof value === 'boolean', 'a boolean'],
        ['complete', value => typeof value === 'boolean', 'a boolean'],
      ]
      for (const [key, accepts, expected] of shapes) {
        const value = config[key]
        if (value !== undefined && !accepts(value)) issues.push(issue(key, `expected ${expected}`))
      }
      // Migration, not a silent no-op: up to 1.3.0 `text` replaced the whole
      // `deployment:persona-prefix` section for every agent, which erased the
      // preset's behavioral rules. The preset owns the persona now. `text: ''`
      // used to fall back to the default, so it is NOT a way to disable the
      // override; both fields are rejected loudly.
      if (config.text !== undefined) {
        issues.push(issue('text', 'removed in 1.4.0: this plugin no longer replaces the preset persona; delete "text" and edit the preset persona instead'))
      }
      if (config.complete !== undefined) {
        issues.push(issue('complete', 'removed in 1.4.0: without a replacement persona there is nothing to complete; delete "complete"'))
      }
      return issues.length > 0 ? { issues } : { value: config }
    },
  },
}

/**
 * Self-introduction sentences naming a brand: `You are an AI agent powered by
 * DeepSeek Harness.`, `You are a coding agent powered by the <model> model.`,
 * `You are an AI assistant built on DeepSeek.`, `You are powered by ...`.
 *
 * This shape - not the bare brand word - is what the upstream channel check
 * matches, so rewriting the brand inside such a sentence is not enough: it
 * would still read `You are an AI agent powered by <another brand>.`.
 */
const INTRO_VERB = '(?:powered by|built on|built by|created by|developed by|made by|trained by)'
const INTRO_TAIL = `[^!?\\n]{0,100}?\\.(?=\\s|$)`
const SELF_INTRO = new RegExp(
  `\\bYou are (?:`
  + `(?:an? )?(?:[\\w-]+ ){0,4}?(?:agent|assistant|engineer|helper)\\b[^.!?\\n]{0,80}?${INTRO_VERB}`
  + `|${INTRO_VERB}`
  + `)${INTRO_TAIL}`,
  'giu',
)

/**
 * Validate one configured brand list.
 * @param raw - the row's `brands` value, of unknown shape.
 * @returns non-blank brand strings, defaulting to {@link DEFAULT_BRANDS}.
 */
export function normalizeBrands(raw) {
  const list = Array.isArray(raw) ? raw : DEFAULT_BRANDS
  const brands = []
  for (const entry of list) {
    if (typeof entry !== 'string') continue
    const brand = entry.trim()
    if (brand !== '') brands.push(brand)
  }
  return brands
}

/**
 * Validate and freeze one configured replacement list.
 *
 * Entries with a blank `from` are dropped: `String.prototype.replaceAll` with an
 * empty needle inserts the replacement between every character, which would
 * corrupt the prompt rather than rewrite it.
 * @param raw - the row's `replace` value, of unknown shape.
 * @returns usable `{ from, to }` pairs, in the configured order.
 */
export function normalizeReplacements(raw) {
  const list = Array.isArray(raw) ? raw : DEFAULT_REPLACE
  const rules = []
  for (const entry of list) {
    if (entry === null || typeof entry !== 'object') continue
    const from = typeof entry.from === 'string' ? entry.from : ''
    const to = typeof entry.to === 'string' ? entry.to : ''
    if (from === '') continue
    rules.push({ from, to })
  }
  return rules
}

/**
 * Apply every replacement to one string. Exported so a probe can test the
 * rewrite without a running Host.
 * @param text - the text to rewrite.
 * @param rules - normalized replacements.
 * @returns the rewritten text, or the input when no rule matches.
 */
export function scrubText(text, rules) {
  if (typeof text !== 'string' || text === '') return text
  let out = text
  for (const rule of rules) {
    if (rule.to === '') {
      // Deleting a phrase that sat between two spaces would leave a double
      // space behind; consume one neighbour first. Only spaces and tabs are
      // touched, so indentation and line structure survive.
      out = out.split(`${rule.from} `).join('')
      out = out.split(` ${rule.from}`).join('')
      out = out.split(rule.from).join('')
      continue
    }
    out = out.split(rule.from).join(rule.to)
  }
  return out
}

/**
 * Expand complete `{{name}}` references from an assembly's variable map.
 *
 * Unknown references are left verbatim: the renderer still owns strictness, and
 * leaving them visible keeps an unresolved variable from accidentally matching
 * a brand.
 * @param text - text that may contain `{{name}}` references.
 * @param variables - the assembly's resolved variables.
 * @returns the text with known references substituted.
 */
function expandVariables(text, variables) {
  if (variables === undefined) return text
  return text.replace(/\{\{([^{}]+)\}\}/gu, (whole, name) => {
    const value = variables[name.trim()]
    return typeof value === 'string' ? value : whole
  })
}

/**
 * Replace every brand-naming self-introduction sentence with `neutralText`.
 *
 * Only a sentence that both has the `You are ... powered by / built on ...`
 * shape and names one of `brands` is touched, so ordinary prose that merely
 * mentions the product survives. Exported so a probe can test it without a
 * running Host.
 *
 * The brand test runs on the sentence with `{{variable}}` references expanded,
 * because the assembly waterfall sees unresolved text; the replacement itself
 * keeps the original sentence boundaries.
 * @param text - the text to rewrite.
 * @param brands - brand names that make a self-introduction sentence a fingerprint.
 * @param neutralText - replacement sentence.
 * @param variables - assembly variables used only for the brand test.
 * @returns the rewritten text.
 */
export function neutralizeSelfIntro(text, brands = DEFAULT_BRANDS, neutralText = DEFAULT_NEUTRAL, variables) {
  if (typeof text !== 'string' || text === '') return text
  // No brands means no rule: neutralising every self-introduction would
  // rewrite other products' personas for no benefit.
  if (brands.length === 0) return text
  const named = new RegExp(brands.map(escapeRegExp).join('|'), 'iu')
  return text.replace(SELF_INTRO, sentence => named.test(expandVariables(sentence, variables)) ? neutralText : sentence)
}

/**
 * Escape one literal for use inside a regular expression.
 * @param value - the literal text.
 * @returns the escaped text.
 */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Suffix that marks a context as no longer owned by its original provider. */
const HIDDEN_SUFFIX = '#brand-scrubbed'

/**
 * Rename a rewritten runtime context so the loop's refresh keeps the rewrite.
 *
 * `SystemPrompt.refreshContext()` (called before every request) re-resolves
 * every context whose NAME still has a registered provider, and its fresh text
 * overwrites whatever an `system-prompt/assemble` listener wrote. A name no
 * provider owns takes the other branch — `provider === undefined ? accepted` —
 * and the accepted text survives. Sections need no such trick: `refreshContext`
 * never touches them.
 *
 * The name is idempotent, so a second scrub over an already-renamed context
 * does not grow the suffix.
 * @param name - the context's registered name.
 * @returns the provider-less name to report.
 */
function hideFromRefresh(name) {
  return name.endsWith(HIDDEN_SUFFIX) ? name : `${name}${HIDDEN_SUFFIX}`
}

/**
 * Rewrite one assembled prompt: sections, runtime-context paragraphs, and
 * (optionally) tool descriptions.
 *
 * A fresh assembly is returned instead of mutating the input, so a listener
 * earlier in the waterfall keeps the assembly it produced.
 * @param assembly - the assembly produced by `next()`.
 * @param rules - normalized replacements.
 * @param options - `brands` (brand names to neutralise, defaulting to
 *   {@link DEFAULT_BRANDS}), `neutralText` (replacement sentence),
 *   `variables` (assembly variables used only for the brand test), and
 *   `tools: false` to leave tool descriptions alone.
 * @returns the rewritten assembly.
 */
export function scrubAssembly(assembly, rules, options = {}) {
  const brands = options.brands ?? DEFAULT_BRANDS
  const neutralText = options.neutralText ?? DEFAULT_NEUTRAL
  const scrubTools = options.tools !== false
  const variables = options.variables ?? assembly.variables ?? {}
  if (rules.length === 0 && brands.length === 0) return assembly
  // Neutralise the sentence first, then scrub the brand residue: the other
  // order would leave `You are an AI agent powered by <another brand>.` behind.
  const rewrite = text => scrubText(neutralizeSelfIntro(text, brands, neutralText, variables), rules)
  return {
    ...assembly,
    sections: assembly.sections.map(section => ({ ...section, text: rewrite(section.text) })),
    // A rewritten context is renamed (see {@link hideFromRefresh}), so the
    // rewrite survives the loop's per-request refresh.
    contexts: assembly.contexts.map(context => {
      const text = rewrite(context.text)
      return text === context.text ? context : { ...context, name: hideFromRefresh(context.name), text }
    }),
    tools: scrubTools
      ? assembly.tools.map(tool => typeof tool.description === 'string'
        ? { ...tool, description: rewrite(tool.description) }
        : tool)
      : assembly.tools,
  }
}

/**
 * Register the brand scrub over every assembled prompt.
 * @param ctx - Host root context.
 * @param config - row config: `neutralText`, `brands`, `replace`,
 *   `scrubTools`. `text` / `complete` are rejected by {@link Config}.
 */
export function apply(ctx, config) {
  // `Config` above normalizes the row; the fallbacks keep a direct call (a probe,
  // a hand-mounted row) working with the same defaults.
  const rules = normalizeReplacements(config?.replace)
  const brands = normalizeBrands(config?.brands)
  const neutralText = typeof config?.neutralText === 'string' && config.neutralText.trim() !== '' ? config.neutralText : DEFAULT_NEUTRAL
  const scrubTools = config?.scrubTools !== false

  // Unscoped listener: a listener with no scope tag receives every scope's
  // assemblies, so subagents and future agents are covered without per-agent
  // registration. `ctx.on` already owns its listener on this plugin's fiber, so
  // disabling the bundle removes it.
  ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
    const resolved = await next()
    return scrubAssembly(resolved, rules, {
      brands,
      neutralText,
      tools: scrubTools,
      variables: resolved.variables,
    })
  })
}
