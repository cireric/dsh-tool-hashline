/** Type surface for the shipped operations session decoder (operations/session-log.mjs). */

export interface ZstdFrameRange { start: number; end: number }

export function scanZstdFrames(buffer: Buffer): { frames: ZstdFrameRange[]; tornStart?: number }

export function decodeArtifact(buffer: Buffer): { format: string; text: string; frames: number; tornStart?: number }

export function parseRecords(text: string): { records: Record<string, unknown>[]; failures: { line: number; message: string }[] }

export function encodeSegment(raw: string): string

export function projectKey(cwd: string): string

export function sessionDirectory(sessionsRoot: string, cwd: string, sessionId: string): string

export interface SessionArtifactRead {
  status: 'read'
  directory: string
  path: string
  generation: number
  compressed: boolean
  bytes: number
  format: string
  frames: number
  tornStart?: number
  text: string
  records: Record<string, unknown>[]
  failures: { line: number; message: string }[]
  buffer: Buffer
}

export interface SessionArtifactMiss {
  status: 'missing' | 'unsupported-generation'
  directory: string
  detail: string
  entries?: string[]
}

export function readSessionArtifact(options: { sessionsRoot: string; cwd: string; sessionId: string }): Promise<SessionArtifactRead | SessionArtifactMiss>
