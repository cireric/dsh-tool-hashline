/** Type surface for the YAML subset reader (operations/sync-yaml.mjs). */

export class YamlSubsetError extends Error {
  name: string
  line?: number
  constructor(message: string, line?: number)
}

export function parseYamlSubset(text: string): unknown
