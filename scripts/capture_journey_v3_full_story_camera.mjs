import { spawn, execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PROJECT_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const BASE_URL = 'http://127.0.0.1:4173'
const DEBUG_PORT = 9337
const VIEWPORT = { width: 1440, height: 900, deviceScaleFactor: 1 }
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const VITE_CLI = join(PROJECT_ROOT, 'node_modules/vite/bin/vite.js')
const OUTPUT_DIR = join(
  PROJECT_ROOT,
  'docs/references/journey-v3/baselines/volumetric',
)
const OUTPUT = join(OUTPUT_DIR, 'full-story-camera-baselines-1440x900.json')
const HEAD = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: PROJECT_ROOT,
  encoding: 'utf8',
}).trim()

const PREVIEWS = [
  'sunset',
  'night',
  'river-hold',
  'milky-way',
  'seated-figure',
  'final-wide',
  'ending',
]

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
    throw new Error(
      result.exceptionDetails.exception?.description ??
      result.exceptionDetails.text ??
      'Browser evaluation failed',
    )
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
    await wait(150)
  }
  throw new Error('Timed out waiting for Journey V3 full-story capture')
}

const captureUrl = (preview) => {
  const query = new URLSearchParams({
    preview,
    neutralPointer: '1',
    captureCamera: '1',
    freezeRuntime: '1',
    gitCommit: HEAD,
  })
  return `${BASE_URL}/journey-v3?${query}`
}

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true })
  const profile = await mkdtemp(join(tmpdir(), 'journey-v3-full-story-'))
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

    const captures = []
    for (const preview of PREVIEWS) {
      await client.send('Page.navigate', { url: captureUrl(preview) })
      await waitForCapture(client)
      const serialized = await evaluate(
        client,
        'JSON.stringify(window.__JOURNEY_V3_CAPTURE__.getSnapshot())',
      )
      captures.push(JSON.parse(serialized))
    }
    const report = {
      schemaVersion: 1,
      phase: 'Journey V3 Phase 1C.2 full-story browser-final cameras',
      route: '/journey-v3',
      viewport: VIEWPORT,
      currentGitCommit: HEAD,
      deterministicCapture: {
        neutralPointer: true,
        freezeRuntime: true,
        walkingBob: false,
        runtimeTimeSeconds: 0,
      },
      captures,
    }
    await writeFile(OUTPUT, `${JSON.stringify(report, null, 2)}\n`)
    console.log(JSON.stringify({
      output: OUTPUT,
      captures: captures.map((snapshot) => ({
        preview: snapshot.metadata.preview,
        progress: snapshot.metadata.progress,
        fov: snapshot.camera.fov,
      })),
    }, null, 2))
  } finally {
    client?.close()
    chrome?.kill('SIGTERM')
    vite.kill('SIGTERM')
    await rm(profile, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
