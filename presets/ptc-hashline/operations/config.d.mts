/** Type surface for the operations configuration store (operations/config.mjs). */

export const CONFIG_FILE: 'config.json'

export const CONFIG_ROLES: readonly ['maintenanceRepository', 'evidenceDirectory']

export type ConfigRole = 'maintenanceRepository' | 'evidenceDirectory'

export interface RoleState {
  configured: boolean
  usable: boolean
  path?: string
  detail?: string
}

export interface DescribedConfig {
  path: string
  exists: boolean
  values: Record<string, unknown>
  roles: Record<ConfigRole, RoleState>
}

export function stateDirectory(dshHome: string): string

export function readConfig(directory: string): Promise<{ path: string; exists: boolean; values: Record<string, unknown> }>

export function probeDirectory(path: string): Promise<{ ok: boolean; detail?: string }>

export function saveConfig(options: {
  directory: string
  maintenanceRepository?: string
  evidenceDirectory?: string
  create?: boolean
}): Promise<DescribedConfig>

export function describeConfig(directory: string): Promise<DescribedConfig>

export function requireRole(described: DescribedConfig, role: ConfigRole): string
