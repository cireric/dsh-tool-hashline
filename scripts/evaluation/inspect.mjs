/** Read-only identity and historical trace inspection; never starts a model. */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { captureIdentity } from './identity.mjs'
import { captureTools } from './host.mjs'
import { decodeTrace } from './evidence.mjs'

const [command, a, b, c, d] = process.argv.slice(2)
try {
  if (command === 'identity' && a && b && c) console.log(JSON.stringify({ dependencies: captureIdentity(path.resolve(a), b), tools: await captureTools(path.resolve(a), b, c, d ? JSON.parse(readFileSync(d, 'utf8')) : {}) }, null, 2))
  else if (command === 'trace' && a && b) console.log(JSON.stringify(decodeTrace(readFileSync(a), b), null, 2))
  else throw new Error('usage: inspect.mjs identity <disposable-profile> <provider-package> <credential-env-name> [provider-config.json] | trace <artifact> <session-id>')
} catch (e) { console.error(e.message); process.exitCode = 2 }
