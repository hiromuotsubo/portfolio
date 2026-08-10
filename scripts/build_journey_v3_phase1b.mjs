import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PROJECT_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const BLENDER = '/Applications/Blender.app/Contents/MacOS/Blender'
const STEPS = [
  [process.execPath, ['scripts/prepare_journey_v16_spatial_reference.mjs']],
  [process.execPath, ['scripts/build_journey_v3_camera_gltf.mjs']],
  [process.execPath, ['scripts/validate_journey_v3_camera_projection.mjs']],
  [
    BLENDER,
    [
      '--background',
      '--python',
      'scripts/blender/build_journey_v3_spatial_reference.py',
    ],
  ],
  [process.execPath, ['scripts/build_journey_v3_blender_comparisons.mjs']],
]

for (const [command, args] of STEPS) {
  console.log(`\n> ${command} ${args.join(' ')}`)
  const result = spawnSync(command, args, {
    cwd: PROJECT_ROOT,
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

console.log('\nJourney V3 Phase 1B spatial reference regenerated successfully.')
