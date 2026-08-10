import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const BASE_URL = 'http://127.0.0.1:4173'
const DEBUG_PORT = 9341
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const VITE = join(ROOT, 'node_modules/vite/bin/vite.js')
const OUTPUT = join(ROOT, 'work/blender/journey-v3/phase1c/cave-runtime')
const PROGRESS = [11.5, 13.5, 16, 20, 30]

const wait = (milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds))

async function waitForResponse(url, json = false, timeoutMs = 30000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url)
      if (response.ok) return json ? response.json() : true
    } catch {
      // Local Vite/Chrome process may still be starting.
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
      const pending = this.pending.get(message.id)
      if (!pending) return
      this.pending.delete(message.id)
      if (message.error) pending.reject(new Error(message.error.message))
      else pending.resolve(message.result)
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
    const id = this.id
    this.id += 1
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
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text ?? 'Browser evaluation failed')
  return result.result.value
}

async function captureAt(client, progress) {
  const query = new URLSearchParams({
    preview: 'cave-exit',
    neutralPointer: '1',
    captureCamera: '1',
    freezeRuntime: '1',
    captureProgress: String(progress),
  })
  await client.send('Page.navigate', { url: `${BASE_URL}/journey-v3?${query}` })
  const started = Date.now()
  while (Date.now() - started < 90000) {
    if (await evaluate(client, 'window.__JOURNEY_V3_CAPTURE__?.status ?? "missing"') === 'ready') break
    await wait(100)
  }
  await evaluate(client, `(() => {
    const style = document.createElement('style');
    style.textContent = '.journey-3d > :not(.journey-scene-frame) { visibility: hidden !important; }';
    document.head.append(style);
    return true;
  })()`)
  await wait(180)
  const result = await client.send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false,
  })
  const slug = progress.toFixed(2).replace('.', '_')
  await writeFile(join(OUTPUT, `journey-v1-cave-p${slug}.png`), Buffer.from(result.data, 'base64'))
}

async function main() {
  await mkdir(OUTPUT, { recursive: true })
  const profile = await mkdtemp(join(tmpdir(), 'journey-v3-phase1c1-cave-'))
  const vite = spawn(process.execPath, [VITE, '--host', '127.0.0.1', '--port', '4173', '--strictPort'], {
    cwd: ROOT,
    stdio: 'inherit',
  })
  let chrome
  let client
  try {
    await waitForResponse(BASE_URL)
    chrome = spawn(CHROME, [
      '--headless=new',
      '--hide-scrollbars',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-features=CalculateNativeWinOcclusion',
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=${profile}`,
      'about:blank',
    ], { stdio: 'ignore' })
    const targets = await waitForResponse(`http://127.0.0.1:${DEBUG_PORT}/json/list`, true)
    const page = targets.find((target) => target.type === 'page')
    client = new CdpClient(page.webSocketDebuggerUrl)
    await client.open()
    await client.send('Page.enable')
    await client.send('Runtime.enable')
    await client.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    })
    for (const progress of PROGRESS) await captureAt(client, progress)
    console.log(`Captured Journey V1 cave/story frames: ${PROGRESS.join(', ')}`)
  } finally {
    client?.close()
    chrome?.kill('SIGTERM')
    vite.kill('SIGTERM')
    await wait(250)
    await rm(profile, { recursive: true, force: true })
  }
}

await main()
