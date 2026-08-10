import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const BASE_URL = 'http://127.0.0.1:4176'
const DEBUG_PORT = 9336
const VIEWPORT = { width: 1440, height: 900, deviceScaleFactor: 1 }
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const VITE = join(ROOT, 'node_modules/vite/bin/vite.js')
const OUTPUT = join(ROOT, 'docs/references/journey-v3/baselines/art-direction-v004/browser')
const PROVENANCE = join(OUTPUT, 'cave-provenance')

const wait = (milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds))

async function waitFor(url, json = false, timeout = 30000) {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    try {
      const response = await fetch(url)
      if (response.ok) return json ? response.json() : true
    } catch {
      // Local services can still be starting.
    }
    await wait(150)
  }
  throw new Error(`Timed out waiting for ${url}`)
}

class CdpClient {
  constructor(url) {
    this.id = 1
    this.pending = new Map()
    this.socket = new WebSocket(url)
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      if (!message.id || !this.pending.has(message.id)) return
      const request = this.pending.get(message.id)
      this.pending.delete(message.id)
      if (message.error) request.reject(new Error(message.error.message))
      else request.resolve(message.result)
    })
  }

  async open() {
    if (this.socket.readyState === WebSocket.OPEN) return
    await new Promise((resolvePromise, reject) => {
      this.socket.addEventListener('open', resolvePromise, { once: true })
      this.socket.addEventListener('error', reject, { once: true })
    })
  }

  send(method, params = {}) {
    const id = this.id++
    return new Promise((resolvePromise, reject) => {
      this.pending.set(id, { resolve: resolvePromise, reject })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }

  close() {
    this.socket.close()
  }
}

async function evaluate(client, expression) {
  const result = await client.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  })
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
  }
  return result.result.value
}

async function screenshot(client, path) {
  const result = await client.send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false,
  })
  await writeFile(path, Buffer.from(result.data, 'base64'))
}

async function waitForCapture(client, timeout = 90000) {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    if (await evaluate(client, 'window.__JOURNEY_V3_CAPTURE__?.status === "ready"')) return
    await wait(200)
  }
  throw new Error('Timed out waiting for deterministic Journey V3 capture')
}

const INSTALL_AUDIT = String.raw`(async () => {
  const moduleUrl = performance.getEntriesByType('resource')
    .map((entry) => entry.name)
    .find((name) => name.includes('/node_modules/.vite/deps/@react-three_fiber.js'));
  if (!moduleUrl) throw new Error('React Three Fiber module URL not found');
  const fiber = await import(moduleUrl);
  const root = [...fiber._roots.values()][0];
  if (!root?.store) throw new Error('React Three Fiber root store not found');
  const state = root.store.getState();
  const oldEnvironmentNames = new Set([
    'TER_V13_FICTIONAL_NAGANO_MASSIF', 'MTN_V13_FAR_CENTRAL_RIDGE',
    'BAR_V13_LEFT_MID', 'BAR_V13_RIGHT_FOREGROUND',
    'RIV_V13_EMERALD_S_WATER.001', 'RIV_V13_VISIBLE_PEBBLE_BED.001',
    'FX_V13_WATER_RIPPLES', 'WEB_RIVERBANK_ROCKS_PLACED_00',
    'WEB_RIVERBANK_ROCKS_PLACED_01', 'P2_RIDGE_MID', 'P2_RIDGE_FAR',
    'P2_FOREST_MID_CANOPY', 'P2_SHORE_WET_LEFT', 'P2_SHORE_WET_RIGHT',
    'P2_CLOUD_FAR'
  ]);
  const records = [];
  state.scene.traverse((object) => {
    const materials = Array.isArray(object.material) ? object.material : object.material ? [object.material] : [];
    const identity = [object.name, ...materials.map((value) => value.name)].join(' ').toUpperCase();
    records.push({
      object,
      name: object.name,
      identity,
      visible: object.visible,
      materials: materials.map((material) => ({
        material,
        opacity: material.opacity,
        transparent: material.transparent,
        depthWrite: material.depthWrite,
        side: material.side,
      })),
    });
  });
  const originalFog = state.scene.fog;
  const domRecords = [...document.querySelectorAll('.cave-grade, [class*="mist"], [class*="fog"]')]
    .map((element) => ({ element, display: element.style.display, visibility: element.style.visibility }));
  const matches = {
    shell: (record) => record.identity.includes('CAVE_HQ_INTERIOR_SHELL'),
    ground: (record) => record.identity.includes('CAVE_HQ_GROUND') || record.identity.includes('CAVE_HQ_FLOOR_WATER'),
    debris: (record) => record.identity.includes('WEB_CAVE_HQ_DEBRIS'),
    allCave: (record) => record.identity.includes('CAVE_') || record.identity.includes('WEB_CAVE'),
    oldTerrain: (record) => oldEnvironmentNames.has(record.name),
    screenMist: (record) => /MIST|FOG|CLOUD/.test(record.identity),
  };
  function restore() {
    for (const record of records) {
      record.object.visible = record.visible;
      for (const value of record.materials) {
        value.material.opacity = value.opacity;
        value.material.transparent = value.transparent;
        value.material.depthWrite = value.depthWrite;
        value.material.side = value.side;
        value.material.needsUpdate = true;
      }
    }
    state.scene.fog = originalFog;
    for (const record of domRecords) {
      record.element.style.display = record.display;
      record.element.style.visibility = record.visibility;
    }
  }
  function hide(predicate) {
    for (const record of records) if (predicate(record)) record.object.visible = false;
  }
  function render() {
    state.scene.updateMatrixWorld(true);
    state.camera.updateMatrixWorld(true);
    state.gl.render(state.scene, state.camera);
  }
  window.__PHASE1C3_CAVE_AUDIT__ = {
    inventory: records.filter((record) => matches.allCave(record) || matches.oldTerrain(record)).map((record) => ({
      name: record.name,
      type: record.object.type,
      identity: record.identity,
      visible: record.visible,
      materialSides: record.materials.map((value) => value.side),
      materialOpacities: record.materials.map((value) => value.opacity),
    })),
    apply(variant) {
      restore();
      if (variant === 'no-cave-shell') hide(matches.shell);
      if (variant === 'no-cave-ground') hide(matches.ground);
      if (variant === 'no-cave-debris') hide(matches.debris);
      if (variant === 'no-all-cave') hide(matches.allCave);
      if (variant === 'no-old-terrain') hide(matches.oldTerrain);
      if (variant === 'no-screen-mist') hide(matches.screenMist);
      if (variant === 'front-side-only') {
        for (const record of records.filter(matches.allCave)) for (const value of record.materials) {
          value.material.side = 0; value.material.needsUpdate = true;
        }
      }
      if (variant === 'no-fog') state.scene.fog = null;
      if (variant === 'no-css-cave-grade') {
        for (const record of domRecords.filter((value) => value.element.matches('.cave-grade'))) record.element.style.display = 'none';
      }
      if (variant === 'no-dom-atmosphere') {
        for (const record of domRecords) record.element.style.display = 'none';
      }
      render();
      return {
        variant,
        visibleCave: records.filter((record) => matches.allCave(record) && record.object.visible).map((record) => record.name),
        visibleOldTerrain: records.filter((record) => matches.oldTerrain(record) && record.object.visible).map((record) => record.name),
        fog: state.scene.fog ? { type: state.scene.fog.type, density: state.scene.fog.density ?? null } : null,
      };
    },
    restore() { restore(); render(); return true; },
  };
  return {
    moduleUrl,
    rootCount: fiber._roots.size,
    camera: state.camera.name,
    inventory: window.__PHASE1C3_CAVE_AUDIT__.inventory,
  };
})()`

async function diffMetrics(baselinePath, variantPath) {
  const baseline = await sharp(baselinePath).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const variant = await sharp(variantPath).removeAlpha().raw().toBuffer()
  let changed = 0
  let sum = 0
  let max = 0
  let minX = baseline.info.width
  let minY = baseline.info.height
  let maxX = -1
  let maxY = -1
  for (let offset = 0; offset < baseline.data.length; offset += 3) {
    const delta = (
      Math.abs(baseline.data[offset] - variant[offset]) +
      Math.abs(baseline.data[offset + 1] - variant[offset + 1]) +
      Math.abs(baseline.data[offset + 2] - variant[offset + 2])
    ) / 3
    sum += delta
    max = Math.max(max, delta)
    if (delta <= 4) continue
    changed += 1
    const pixel = offset / 3
    const x = pixel % baseline.info.width
    const y = Math.floor(pixel / baseline.info.width)
    minX = Math.min(minX, x); minY = Math.min(minY, y)
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y)
  }
  const pixels = baseline.info.width * baseline.info.height
  return {
    changedPixels: changed,
    changedFraction: changed / pixels,
    meanAbsoluteChannelDifference: sum / pixels,
    maxAbsoluteChannelDifference: max,
    changedBounds: changed ? { minX, minY, maxX, maxY } : null,
  }
}

async function contactSheet(variants) {
  const thumbWidth = 480
  const thumbHeight = 300
  const labelHeight = 38
  const columns = 3
  const rows = Math.ceil(variants.length / columns)
  const composites = []
  for (const [index, variant] of variants.entries()) {
    const image = await sharp(join(PROVENANCE, `${variant}.png`)).resize(thumbWidth, thumbHeight).png().toBuffer()
    composites.push({ input: image, left: (index % columns) * thumbWidth, top: Math.floor(index / columns) * (thumbHeight + labelHeight) })
    const label = Buffer.from(`<svg width="${thumbWidth}" height="${labelHeight}"><rect width="100%" height="100%" fill="#13242b"/><text x="18" y="26" fill="white" font-size="20" font-family="Arial">${variant}</text></svg>`)
    composites.push({ input: label, left: (index % columns) * thumbWidth, top: Math.floor(index / columns) * (thumbHeight + labelHeight) + thumbHeight })
  }
  await sharp({ create: { width: columns * thumbWidth, height: rows * (thumbHeight + labelHeight), channels: 3, background: '#13242b' } })
    .composite(composites)
    .png()
    .toFile(join(PROVENANCE, 'cave-frame-provenance-contact-sheet.png'))
}

async function main() {
  await mkdir(PROVENANCE, { recursive: true })
  const profile = await mkdtemp(join(tmpdir(), 'journey-v3-phase1c3-browser-'))
  const vite = spawn(process.execPath, [VITE, '--host', '127.0.0.1', '--port', '4176', '--strictPort'], { cwd: ROOT, stdio: 'ignore' })
  let chrome
  let client
  try {
    await waitFor(BASE_URL)
    chrome = spawn(CHROME, [
      '--headless=new', '--hide-scrollbars', '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding', '--disable-features=CalculateNativeWinOcclusion',
      `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profile}`, 'about:blank',
    ], { stdio: 'ignore' })
    const targets = await waitFor(`http://127.0.0.1:${DEBUG_PORT}/json/list`, true)
    const target = targets.find((value) => value.type === 'page')
    client = new CdpClient(target.webSocketDebuggerUrl)
    await client.open()
    await client.send('Page.enable')
    await client.send('Runtime.enable')
    await client.send('Emulation.setDeviceMetricsOverride', { ...VIEWPORT, mobile: false })
    const query = new URLSearchParams({ preview: 'cave-exit', neutralPointer: '1', captureCamera: '1', freezeRuntime: '1' })
    await client.send('Page.navigate', { url: `${BASE_URL}/journey-v3?${query}` })
    await waitForCapture(client)
    await wait(1600)
    const installation = await evaluate(client, INSTALL_AUDIT)
    const variants = [
      'baseline', 'no-cave-shell', 'no-cave-ground', 'no-cave-debris', 'no-all-cave',
      'no-old-terrain', 'front-side-only', 'no-fog', 'no-screen-mist',
      'no-css-cave-grade', 'no-dom-atmosphere',
    ]
    const states = {}
    const baselinePath = join(PROVENANCE, 'baseline.png')
    for (const variant of variants) {
      states[variant] = await evaluate(client, `window.__PHASE1C3_CAVE_AUDIT__.apply(${JSON.stringify(variant)})`)
      await wait(80)
      await screenshot(client, join(PROVENANCE, `${variant}.png`))
    }
    const diffs = {}
    for (const variant of variants.slice(1)) {
      diffs[variant] = await diffMetrics(baselinePath, join(PROVENANCE, `${variant}.png`))
    }
    await contactSheet(variants)
    await writeFile(join(PROVENANCE, 'cave-frame-provenance.json'), `${JSON.stringify({
      schemaVersion: 1,
      route: '/journey-v3',
      progress: 11.5,
      viewport: VIEWPORT,
      installation,
      states,
      diffs,
    }, null, 2)}\n`)
    console.log(JSON.stringify({ installation, diffs }, null, 2))
  } finally {
    client?.close(); chrome?.kill('SIGTERM'); vite.kill('SIGTERM')
    await wait(250)
    await rm(profile, { recursive: true, force: true })
  }
}

await main()
