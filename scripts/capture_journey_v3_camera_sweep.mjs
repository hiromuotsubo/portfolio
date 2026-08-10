import { spawn, execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const PROJECT_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const BASE_URL = 'http://127.0.0.1:4173'
const DEBUG_PORT = 9334
const VIEWPORT = { width: 1440, height: 900, deviceScaleFactor: 1 }
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const VITE_CLI = join(PROJECT_ROOT, 'node_modules/vite/bin/vite.js')
const JSON_PATH = join(
  PROJECT_ROOT,
  'docs/references/journey-v3/baselines/camera/cave-to-day-camera-sweep-1440x900.json',
)
const CONTACT_SHEET_PATH = join(
  PROJECT_ROOT,
  'docs/references/journey-v3/baselines/screenshots/cave-to-day-camera-sweep-contact-sheet.png',
)
const HEAD = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: PROJECT_ROOT,
  encoding: 'utf8',
}).trim()
const FINE_PROGRESS = Array.from(
  { length: Math.round((30 - 11.5) / 0.25) + 1 },
  (_, index) => 11.5 + index * 0.25,
)
const REQUIRED_ANCHORS = [11.5, 13.5, 20, 28.25, 30]
const REPRESENTATIVE_COUNT = 10

const wait = (milliseconds) =>
  new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds))

async function waitForResponse(url, parseJson = false, timeoutMs = 30000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url)
      if (response.ok) return parseJson ? response.json() : true
    } catch {
      // Local processes may still be starting.
    }
    await wait(150)
  }
  throw new Error(`Timed out waiting for ${url}`)
}

class CdpClient {
  constructor(url) {
    this.nextId = 1
    this.pending = new Map()
    this.socket = new WebSocket(url)
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      if (!message.id) return
      const request = this.pending.get(message.id)
      if (!request) return
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
    const id = this.nextId
    this.nextId += 1
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
    const details = result.exceptionDetails.exception?.description ??
      result.exceptionDetails.text ??
      'Browser evaluation failed'
    throw new Error(details)
  }
  return result.result.value
}

async function waitForCapture(client, timeoutMs = 90000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const status = await evaluate(
      client,
      'window.__JOURNEY_V3_CAPTURE__?.status ?? "missing"',
    )
    if (status === 'ready') return
    await wait(100)
  }
  throw new Error('Timed out waiting for Journey V3 camera capture')
}

const quaternionAngle = (left, right) => {
  const dot = Math.min(
    1,
    Math.abs(left.reduce((sum, value, index) => sum + value * right[index], 0)),
  )
  return 2 * Math.acos(dot)
}

const positionDistance = (left, right) => Math.hypot(
  left[0] - right[0],
  left[1] - right[1],
  left[2] - right[2],
)

const segmentMotion = (left, right) => ({
  positionDistance: positionDistance(left.camera.position, right.camera.position),
  quaternionAngleRadians: quaternionAngle(left.camera.quaternion, right.camera.quaternion),
  fovDeltaDegrees: Math.abs(left.camera.fov - right.camera.fov),
})

const motionScore = (motion) =>
  motion.positionDistance +
  motion.quaternionAngleRadians * 5 +
  motion.fovDeltaDegrees * 0.08

function selectRepresentatives(samples) {
  const cumulative = [0]
  for (let index = 1; index < samples.length; index += 1) {
    cumulative.push(cumulative[index - 1] + motionScore(segmentMotion(samples[index - 1], samples[index])))
  }

  const selected = new Set(
    REQUIRED_ANCHORS.map((anchor) =>
      samples.reduce((best, sample, index) =>
        Math.abs(sample.metadata.progress - anchor) <
        Math.abs(samples[best].metadata.progress - anchor)
          ? index
          : best,
      0),
    ),
  )

  while (selected.size < REPRESENTATIVE_COUNT) {
    const ordered = [...selected].sort((left, right) => left - right)
    let bestIndex = -1
    let bestGap = -1
    for (let pairIndex = 1; pairIndex < ordered.length; pairIndex += 1) {
      const left = ordered[pairIndex - 1]
      const right = ordered[pairIndex]
      if (right - left <= 1) continue
      const midpoint = (cumulative[left] + cumulative[right]) / 2
      for (let index = left + 1; index < right; index += 1) {
        const gap = Math.min(
          cumulative[index] - cumulative[left],
          cumulative[right] - cumulative[index],
        )
        const midpointBias = 1 / (1 + Math.abs(cumulative[index] - midpoint))
        const score = gap + midpointBias * 1e-6
        if (score > bestGap) {
          bestGap = score
          bestIndex = index
        }
      }
    }
    if (bestIndex < 0) break
    selected.add(bestIndex)
  }

  return [...selected]
    .sort((left, right) => left - right)
    .map((index) => ({
      fineSampleIndex: index,
      cumulativeMotionScore: cumulative[index],
      snapshot: samples[index],
    }))
}

const captureUrl = (progress) => {
  const query = new URLSearchParams({
    preview: 'cave-exit',
    neutralPointer: '1',
    captureCamera: '1',
    freezeRuntime: '1',
    captureProgress: String(progress),
    gitCommit: HEAD,
  })
  return `${BASE_URL}/journey-v3?${query}`
}

async function navigateAndRead(client, progress) {
  await client.send('Page.navigate', { url: captureUrl(progress) })
  await waitForCapture(client)
  const serialized = await evaluate(
    client,
    'JSON.stringify(window.__JOURNEY_V3_CAPTURE__.getSnapshot())',
  )
  return JSON.parse(serialized)
}

async function captureCanvasPng(client) {
  await evaluate(
    client,
    `(() => {
      const style = document.createElement('style');
      style.id = 'journey-v3-canvas-only-capture';
      style.textContent = '.journey-3d > :not(.journey-scene-frame) { visibility: hidden !important; }';
      document.head.append(style);
      return true;
    })()`,
  )
  const result = await client.send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false,
  })
  return Buffer.from(result.data, 'base64')
}

async function buildContactSheet(frames) {
  const tileWidth = 360
  const imageHeight = 225
  const labelHeight = 34
  const columns = 2
  const rows = Math.ceil(frames.length / columns)
  const composites = []

  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index]
    const left = (index % columns) * tileWidth
    const top = Math.floor(index / columns) * (imageHeight + labelHeight)
    const thumbnail = await sharp(frame.png)
      .resize(tileWidth, imageHeight, { fit: 'fill' })
      .png()
      .toBuffer()
    composites.push({ input: thumbnail, left, top })
    const label = Buffer.from(
      `<svg width="${tileWidth}" height="${labelHeight}"><rect width="100%" height="100%" fill="#101418"/><text x="14" y="23" fill="#ffffff" font-family="monospace" font-size="15">${frame.label}</text></svg>`,
    )
    composites.push({ input: label, left, top: top + imageHeight })
  }

  await sharp({
    create: {
      width: columns * tileWidth,
      height: rows * (imageHeight + labelHeight),
      channels: 4,
      background: '#101418',
    },
  }).composite(composites).png().toFile(CONTACT_SHEET_PATH)
}

async function main() {
  await mkdir(join(PROJECT_ROOT, 'docs/references/journey-v3/baselines/camera'), { recursive: true })
  await mkdir(join(PROJECT_ROOT, 'docs/references/journey-v3/baselines/screenshots'), { recursive: true })
  const profile = await mkdtemp(join(tmpdir(), 'journey-v3-sweep-'))
  const vite = spawn(
    process.execPath,
    [VITE_CLI, '--host', '127.0.0.1', '--port', '4173', '--strictPort'],
    { cwd: PROJECT_ROOT, stdio: 'inherit' },
  )
  let chrome
  let client

  try {
    await waitForResponse(BASE_URL)
    chrome = spawn(
      CHROME,
      [
        '--headless=new',
        '--hide-scrollbars',
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        '--disable-features=CalculateNativeWinOcclusion',
        `--remote-debugging-port=${DEBUG_PORT}`,
        `--user-data-dir=${profile}`,
        'about:blank',
      ],
      { stdio: 'ignore' },
    )

    const targets = await waitForResponse(
      `http://127.0.0.1:${DEBUG_PORT}/json/list`,
      true,
    )
    const pageTarget = targets.find((target) => target.type === 'page')
    if (!pageTarget?.webSocketDebuggerUrl) {
      throw new Error('Chrome DevTools page target was not available')
    }
    client = new CdpClient(pageTarget.webSocketDebuggerUrl)
    await client.open()
    await client.send('Page.enable')
    await client.send('Runtime.enable')
    await client.send('Emulation.setDeviceMetricsOverride', {
      width: VIEWPORT.width,
      height: VIEWPORT.height,
      deviceScaleFactor: VIEWPORT.deviceScaleFactor,
      mobile: false,
    })

    const fineSamples = []
    for (const progress of FINE_PROGRESS) {
      fineSamples.push(await navigateAndRead(client, progress))
    }
    const representatives = selectRepresentatives(fineSamples)
    const contactFrames = []
    for (const representative of representatives) {
      const progress = representative.snapshot.metadata.progress
      await navigateAndRead(client, progress)
      await wait(150)
      contactFrames.push({
        label: `progress ${progress.toFixed(2)}`,
        png: await captureCanvasPng(client),
      })
    }
    await buildContactSheet(contactFrames)

    const fineSummary = fineSamples.map((sample, index) => ({
      progress: sample.metadata.progress,
      position: sample.camera.position,
      quaternion: sample.camera.quaternion,
      fov: sample.camera.fov,
      clipTime: sample.animation.evaluatedClipTime,
      cumulativeMotionScore: index === 0
        ? 0
        : null,
    }))
    let cumulative = 0
    for (let index = 1; index < fineSummary.length; index += 1) {
      cumulative += motionScore(segmentMotion(fineSamples[index - 1], fineSamples[index]))
      fineSummary[index].cumulativeMotionScore = cumulative
    }

    const output = {
      schemaVersion: 1,
      route: '/journey-v3',
      viewport: VIEWPORT,
      matrixElementOrder: 'Three.js Matrix4.elements order (column-major storage)',
      captureMode: {
        neutralPointer: true,
        freezeRuntime: true,
        finalRuntimeCameraAfterCorrections: true,
      },
      range: { startProgress: 11.5, endProgress: 30, fineStep: 0.25 },
      selection: {
        method: 'Actual path cumulative motion score with required cave/fog/vista transition anchors.',
        scoreFormula: 'positionDistance + quaternionAngleRadians * 5 + abs(fovDeltaDegrees) * 0.08',
        requiredAnchors: REQUIRED_ANCHORS,
        representativeCount: representatives.length,
      },
      currentGitCommit: HEAD,
      capturedAt: new Date().toISOString(),
      fineSamples: fineSummary,
      representatives,
    }
    await writeFile(JSON_PATH, `${JSON.stringify(output, null, 2)}\n`)
    console.log(`Camera sweep: ${representatives.map(({ snapshot }) => snapshot.metadata.progress).join(', ')}`)
  } finally {
    client?.close()
    chrome?.kill('SIGTERM')
    vite.kill('SIGTERM')
    await wait(250)
    await rm(profile, { recursive: true, force: true })
  }
}

await main()
