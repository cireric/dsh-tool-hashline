/** Type surface for the runtime baseline collector (operations/baseline.mjs). */

export interface PatchMarker { file: string[]; marker: string }

export const HASHLINE_PATCH_MARKERS: PatchMarker[]

export const TOOL_EDIT_PATCH_MARKERS: PatchMarker[]

/**
 * One uncommitted input, bound to its CONTENT.
 *
 * `path` alone cannot tell v1 from v2 at the same dirty path, so the digest and
 * an explicit state are part of the record (R3/D10).
 */
export interface ChangedInput {
  path: string
  state: 'untracked' | 'modified' | 'added' | 'deleted' | 'renamed' | 'unmerged'
  kind: 'file' | 'symlink' | 'absent' | 'not-a-file'
  /** A hex SHA-256, or 'missing' / 'unreadable' — never an empty string. */
  sha256: string
  code: string
  from?: string
  detail?: string
}

export interface RepositoryState {
  commit: string
  dirty: string
  changedPaths: string[]
  changedInputs?: ChangedInput[]
  changedInputsProblem?: string
  lockfileSha256: string
  patchFiles: { path: string; sha256: string }[]
  detail?: string
}

export function readRepositoryState(repository: string | undefined, deps?: { execFileSync?: Function }): RepositoryState

export function readChangedInputs(repository: string, deps?: { execFileSync?: Function }): { inputs: ChangedInput[]; problem?: string }

export function realpathOf(requireFrom: NodeRequire, specifier: string): string

export interface ManifestFacts { version?: string; path?: string; detail?: string }

export interface PatchEvidence {
  status: 'patched' | 'unpatched' | 'partial' | 'unknown'
  packagePath?: string
  present?: string[]
  missing?: string[]
  detail?: string
  note?: string
}

export function readManifest(requireFrom: NodeRequire, specifier: string): ManifestFacts

export function patchEvidence(requireFrom: NodeRequire, specifier: string, markers: PatchMarker[]): PatchEvidence

export interface BaselineReport {
  tool: string
  version: number
  collectedAt: string
  roles: {
    installation: { root: string; packagePath: string }
    maintenanceRepository: string
    upgradeTarget: string
    note: string
  }
  versions: Record<string, string>
  resolvedPaths: Record<string, string>
  engines: {
    hashline: { version: string; patch: PatchEvidence }
    toolEdit: { version: string; patch: PatchEvidence }
  }
  realpaths: { hashline: string; toolEdit: string }
  repository: RepositoryState
  session: { provider: string; model: string; preset: string; presetSource: string }
  unknown: string[]
}

export function collectBaseline(options: {
  installationRoot: string
  maintenanceRepository?: string
  upgradeTarget?: string
  provider?: string
  model?: string
  presetId?: string
  presetSource?: string
  now?: string
}): BaselineReport