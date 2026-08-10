import { spawn, execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PROJECT_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const BASE_URL = 'http://127.0.0.1:4173'
const DEBUG_PORT = 9333
const VIEWPORT = { width: 1440, height: 900, deviceScaleFactor: 1 }
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const VITE_CLI = join(PROJECT_ROOT, 'node_modules/vite/bin/vite.js')
const JSON_DIR = join(
  PROJECT_ROOT,
  'docs/references/journey-v3/baselines/camera',
)
const SCREENSHOT_DIR = join(
  PROJECT_ROOT,
  'docs/references/journey-v3/baselines/screenshots',
)
const HEAD = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: PROJECT_ROOT,
  encoding: 'utf8',
}).trim()

const CAPTURES = [
  {
    key: 'cave-exit',
    preview: 'cave-exit',
    progressSelectionReason:
      'Existing Journey V1 parity checkpoint at story progress 11.5.',
  },
  {
    key: 'day-clear-start',
    preview: 'day-clear',
    progressSelectionReason:
      'Existing Journey V1 parity Hero Frame checkpoint at story progress 30.',
  },
  {
    key: 'day-clear-late',
    preview: 'day-clear-late',
    progressSelectionReason:
      'Progress 37.9 is the final sampled point inside EXPERIENCE_PACE clear-valley chapter 20-38. VISUAL_TIMING begins the intentionally gradual sunset blend at 30, so the exact non-zero sunset blend is recorded rather than mislabelled as a pure pre-sunset frame.',
  },
]

const wait = (milliseconds) =>
  new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds))

async function waitForJson(url, timeoutMs = 30000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url)
      if (response.ok) return response.json()
    } catch {
      // The local process may still be starting.
    }
    await wait(150)
  }
  throw new Error(`Timed out waiting for ${url}`)
}

async function waitForText(url, timeoutMs = 30000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {
      // The local process may still be starting.
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
    throw new Error(result.exceptionDetails.text || 'Browser evaluation failed')
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
    await wait(200)
  }
  throw new Error('Timed out waiting for Journey V3 camera capture')
}

async function screenshot(client, outputPath) {
  const result = await client.send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false,
  })
  await writeFile(outputPath, Buffer.from(result.data, 'base64'))
}

async function main() {
  await mkdir(JSON_DIR, { recursive: true })
  await mkdir(SCREENSHOT_DIR, { recursive: true })
  const profile = await mkdtemp(join(tmpdir(), 'journey-v3-capture-'))
  const vite = spawn(
    process.execPath,
    [VITE_CLI, '--host', '127.0.0.1', '--port', '4173', '--strictPort'],
    { cwd: PROJECT_ROOT, stdio: 'inherit' },
  )
  let chrome
  let client

  try {
    await waitForText(BASE_URL)
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

    const targets = await waitForJson(`http://127.0.0.1:${DEBUG_PORT}/json/list`)
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

    for (const capture of CAPTURES) {
      const query = new URLSearchParams({
        preview: capture.preview,
        neutralPointer: '1',
        captureCamera: '1',
        freezeRuntime: '1',
        gitCommit: HEAD,
      })
      await client.send('Page.navigate', {
        url: `${BASE_URL}/journey-v3?${query}`,
      })
      await waitForCapture(client)
      // The camera snapshot is ready on the first deterministic frame. Wait
      // until the normal loader dismissal and story-message reveal have also
      // settled before recording the UI-inclusive screenshot.
      await wait(1800)

      const serialized = await evaluate(
        client,
        'JSON.stringify(window.__JOURNEY_V3_CAPTURE__.getSnapshot())',
      )
      const snapshot = JSON.parse(serialized)
      snapshot.metadata.captureKey = capture.key
      snapshot.metadata.progressSelectionReason =
        capture.progressSelectionReason
      await writeFile(
        join(JSON_DIR, `${capture.key}-1440x900.json`),
        `${JSON.stringify(snapshot, null, 2)}\n`,
      )

      await screenshot(
        client,
        join(SCREENSHOT_DIR, `${capture.key}-1440x900.png`),
      )
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
      await screenshot(
        client,
        join(SCREENSHOT_DIR, `${capture.key}-1440x900-canvas.png`),
      )
    }
  } finally {
    client?.close()
    chrome?.kill('SIGTERM')
    vite.kill('SIGTERM')
    await wait(250)
    await rm(profile, { recursive: true, force: true })
  }
}

await main()
