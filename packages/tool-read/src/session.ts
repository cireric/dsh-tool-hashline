/**
 * Session-scoped path helpers shared by the read tool and the (patched) edit
 * tool.
 *
 * Both tools take their working directory from the host's `workingDirectory`
 * owner — the same value the model is shown and that `cd` changes — so the
 * snapshot store key `path.resolve(cwd, authoredPath)` is byte-identical on
 * both sides. A Session's `header.cwd` is only its origin; it is not the
 * effective directory after a `working-directory/change`.
 * @module @dsh-tool-hashline/tool-read/session
 */

import * as path from 'node:path'

/**
 * Every store key a read of `inputPath` must record.
 *
 * The model may copy the returned show path back into `edit`, so the resolved
 * show path is recorded too whenever it differs from the input-key resolution
 * (a symlink alias or a backend that resolves to a different real path). Identical keys are recorded once.
 * @param cwd - the session's effective working directory.
 * @param inputPath - the model-authored `file_path`.
 * @param showPath - the model-facing path this read returned.
 * @returns one unique store key, or two distinct ones.
 */
export function snapshotKeys(cwd: string, inputPath: string, showPath: string): string[] {
  const inputKey = path.resolve(cwd, inputPath)
  const showKey = path.resolve(cwd, showPath)
  return showKey === inputKey ? [inputKey] : [inputKey, showKey]
}
