#!/bin/sh
set -eu

PROJECT_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
BLENDER_APP="/Applications/Blender.app/Contents/MacOS/Blender"
SOURCE_GLB="$PROJECT_ROOT/work/blender/export/journey-v15-source.glb"
EXTRACTED_GLTF="$PROJECT_ROOT/work/pbr/extracted/journey.gltf"
PBR_GLTF="$PROJECT_ROOT/work/pbr/extracted/journey-pbr.gltf"
KTX2_SOURCE_GLB="$PROJECT_ROOT/work/blender/export/journey-v16-pbr-ktx2-uncompressed.glb"
PUBLIC_GLB="$PROJECT_ROOT/public/journey/models/journey-v16-pbr-ktx2.glb"

"$BLENDER_APP" \
  --background \
  --factory-startup \
  --python "$PROJECT_ROOT/scripts/optimize_journey_glb.py"

cd "$PROJECT_ROOT"
mkdir -p "$PROJECT_ROOT/work/pbr/extracted" "$PROJECT_ROOT/public/basis"
npx gltf-transform copy "$SOURCE_GLB" "$EXTRACTED_GLTF"
node "$PROJECT_ROOT/scripts/generate_journey_pbr.mjs"

npx gltf-transform uastc \
  "$PBR_GLTF" \
  "$KTX2_SOURCE_GLB" \
  --jobs 1 \
  --level 2 \
  --zstd 12

npx gltf-transform meshopt \
  "$KTX2_SOURCE_GLB" \
  "$PUBLIC_GLB" \
  --level medium

cp "$PROJECT_ROOT/node_modules/three/examples/jsm/libs/basis/basis_transcoder.js" \
  "$PROJECT_ROOT/public/basis/basis_transcoder.js"
cp "$PROJECT_ROOT/node_modules/three/examples/jsm/libs/basis/basis_transcoder.wasm" \
  "$PROJECT_ROOT/public/basis/basis_transcoder.wasm"

npx gltf-transform inspect "$PUBLIC_GLB"
