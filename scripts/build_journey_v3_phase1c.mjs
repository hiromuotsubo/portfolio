import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const BLENDER = '/Applications/Blender.app/Contents/MacOS/Blender'
const steps = [
  [BLENDER, ['--background', '--python', 'scripts/blender/build_journey_v3_macro_massing.py']],
  [process.execPath, ['scripts/build_journey_v3_massing_comparisons.mjs']],
]

for (const [command, args] of steps) {
  console.log(`\n> ${command} ${args.join(' ')}`)
  const result = spawnSync(command, args, { cwd: ROOT, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

console.log('\nJourney V3 Phase 1C macro massing regenerated successfully.')
