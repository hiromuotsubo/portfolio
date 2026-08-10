import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const blender = process.env.BLENDER_BIN ?? '/Applications/Blender.app/Contents/MacOS/Blender'
const skipRuntimeCapture = process.argv.includes('--skip-runtime-capture')

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

run(blender, [
  '--background',
  '--python',
  'scripts/blender/build_journey_v3_macro_massing_v002.py',
  '--',
  '--selected',
  'V002',
])

if (!skipRuntimeCapture) {
  run(process.execPath, ['scripts/capture_journey_v3_phase1c1_cave.mjs'])
}

run(process.execPath, ['scripts/build_journey_v3_phase1c1_comparisons.mjs'])
console.log('Journey V3 Phase 1C.1 v002 regenerated')
