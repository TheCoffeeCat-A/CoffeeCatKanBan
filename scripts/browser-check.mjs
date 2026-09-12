import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { createServer } from 'node:http'
import { spawn, spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { resolve, join, relative, sep } from 'node:path'
import { setTimeout as pause } from 'node:timers/promises'
import { once } from 'node:events'

const browser = process.env.CCKB_BROWSER
assert.ok(browser, 'Set CCKB_BROWSER to a local Chromium/Edge executable; no browser is downloaded')
const workspace = resolve('.')
const temporaryRoot = resolve('.cache/tmp')
await mkdir(temporaryRoot, { recursive: true })
const profile = await mkdtemp(join(temporaryRoot, 'browser-'))
const artifacts = resolve('.cache', `browser-check-${Date.now()}`)
await mkdir(artifacts, { recursive: true })
const bundle = await build({ entryPoints: ['tests/fixtures/virtual-ui.ts'], bundle: true, write: false, format: 'iife',
  plugins: [{ name: 'host-controls', setup(builder) {
    builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'test' }))
    builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: 'export function setIcon(el, name) { el.setAttribute("data-icon", name) } export class Menu {}' }))
  } }], logLevel: 'silent' })
const css = await readFile('styles.css', 'utf8')
const html = `<!doctype html><meta charset="utf-8"><title>CoffeeCatKanBan render checks</title><style>
:root { --size-4-1:4px; --size-4-2:8px; --size-4-3:12px; --size-4-4:16px; --size-4-5:20px; --background-primary:#fff; --background-secondary:#f4f4f4; --background-modifier-border:#ccc; --text-normal:#222; --text-muted:#666; --text-accent:#6846c4; --interactive-accent:#6846c4; --font-ui-small:14px; --font-ui-smaller:12px; --font-ui-medium:16px; }
* { box-sizing:border-box } body { margin:0; font-family:system-ui } button { cursor:pointer } #root { min-height:100vh } ${css}</style><main id="root" class="cckb-prototype"></main><script src="/test.js"></script>`
const server = createServer((request, response) => {
  response.setHeader('Content-Type', request.url === '/test.js' ? 'application/javascript' : 'text/html; charset=utf-8')
  response.end(request.url === '/test.js' ? bundle.outputFiles[0].text : html)
})
server.listen(0, '127.0.0.1')
await once(server, 'listening')
const address = server.address()
const child = spawn(browser, ['--headless=new', '--disable-gpu', '--disable-background-networking', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' })
let socket
let nextId = 0
const pending = new Map()
const errors = []
const report = { browser: '', sizes: [], checks: [], measurements: [], errors }
async function call(method, params = {}) {
  const id = ++nextId
  return new Promise((resolveCall, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)) }, 20000)
    pending.set(id, { resolve: (result) => { clearTimeout(timer); resolveCall(result) }, reject: (error) => { clearTimeout(timer); reject(error) } })
    socket.send(JSON.stringify({ id, method, params }))
  })
}
async function evaluate(expression) {
  const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails))
  return result.result.value
}
const settle = () => evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve))))')
try {
  let port
  for (let attempt = 0; attempt < 100; attempt++) {
    try { port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break } catch { await pause(100) }
  }
  assert.ok(port, 'Browser did not expose its local debugging port')
  const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  socket = new WebSocket(pages.find((page) => page.type === 'page').webSocketDebuggerUrl)
  await once(socket, 'open')
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(String(data))
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails)
    const request = pending.get(message.id)
    if (request) { pending.delete(message.id); message.error ? request.reject(new Error(JSON.stringify(message.error))) : request.resolve(message.result) }
  })
  await call('Runtime.enable')
  report.browser = (await call('Browser.getVersion')).product
  await call('Page.navigate', { url: `http://127.0.0.1:${address.port}` })
  for (let attempt = 0; attempt < 100; attempt++) { if (await evaluate('Boolean(window.cckbTest)')) break; await pause(50) }
  for (const [width, height] of [[1440, 900], [640, 640], [360, 640]]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
    for (const mode of ['board', 'data', 'calendar']) {
      await evaluate(`cckbTest.render('${mode}', 5000)`)
      await settle()
      const before = await evaluate(`({ count: document.querySelectorAll('[data-task-id]').length, errors: document.querySelectorAll('.cckb-error').length })`)
      assert.equal(before.errors, 0)
      assert.ok(before.count < (mode === 'calendar' ? 2000 : 200), `${mode} mounted ${before.count} tasks`)
      await evaluate(`for (const viewport of document.querySelectorAll('.cckb-virtual-viewport')) viewport.scrollTop = viewport.scrollHeight`)
      await settle()
      await settle()
      const end = await evaluate(`({ count: document.querySelectorAll('[data-task-id]').length, ids: [...document.querySelectorAll('[data-task-id]')].map(el => el.dataset.taskId) })`)
      assert.ok(end.ids.includes('task-4999'), `${mode}: final task unreachable: ${JSON.stringify(end)}`)
      const finalBounds = await evaluate(`(() => {
        const last = document.querySelector('[data-task-id="task-4999"]');
        const viewport = last.closest('.cckb-virtual-viewport');
        return { bottom:last.getBoundingClientRect().bottom, viewportTop:viewport.getBoundingClientRect().top, viewportBottom:viewport.getBoundingClientRect().bottom, scrollTop:viewport.scrollTop, scrollHeight:viewport.scrollHeight, height:viewport.clientHeight };
      })()`)
      assert.ok(finalBounds.bottom <= finalBounds.viewportBottom + 2 && finalBounds.bottom > finalBounds.viewportTop, `${mode}: final row outside viewport: ${JSON.stringify(finalBounds)}`)
      const layoutErrors = await evaluate(`(() => { const errors=[]; for (const content of document.querySelectorAll('.cckb-virtual-content')) { const rows=[...content.children]; for (let i=1;i<rows.length;i++) if (rows[i].getBoundingClientRect().top < rows[i-1].getBoundingClientRect().bottom - 1) errors.push('overlap'); } return errors })()`)
      assert.deepEqual(layoutErrors, [])
      report.sizes.push({ width, height, mode, initialRows: before.count, endRows: end.count })
      if (width === 640) {
        const screenshot = await call('Page.captureScreenshot', { format: 'png' })
        await writeFile(join(artifacts, `${mode}-640.png`), Buffer.from(screenshot.data, 'base64'))
      }
    }
  }
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
  for (const count of [100, 1000, 5000]) {
    for (const mode of ['board', 'data', 'calendar']) {
      const times = []
      for (let sample = 0; sample < 20; sample++) {
        times.push((await evaluate(`cckbTest.render('${mode}', ${count}, '${sample % 2 ? '任务' : ''}')`)).elapsed)
        await settle()
      }
      times.sort((a, b) => a - b)
      report.measurements.push({ count, mode, samples: times.length, p95: Number(times[18].toFixed(2)), max: Number(times[19].toFixed(2)) })
    }
  }
  await evaluate("cckbTest.render('board', 5000)")
  await settle()
  // Real keyboard input crosses virtual row boundaries and retains focus while scrolling.
  const nextFocusedId = await evaluate(`(() => {
    const cards = [...document.querySelector('.cckb-virtual-viewport').querySelectorAll('.cckb-card')];
    const last = cards.at(-1);
    const nextId = 'task-' + (Number(last.dataset.taskId.slice(5)) + 3);
    if (document.querySelector('[data-task-id="' + nextId + '"]')) throw Error('Test must cross an unmounted row');
    last.querySelector('.cckb-task-link').focus();
    return nextId;
  })()`)
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
  assert.equal(await evaluate("document.activeElement.closest('[data-task-id]')?.dataset.taskId"), nextFocusedId)
  await evaluate("document.querySelector('.cckb-virtual-viewport').scrollTop = 30000")
  await settle()
  assert.equal(await evaluate("document.activeElement.closest('[data-task-id]')?.dataset.taskId"), nextFocusedId)
  report.checks.push('Tab crosses virtual rows; scrolling retains focused row')
  // Drag events use a real DOM/DataTransfer with production handlers; not OS pointer acceptance.
  await evaluate("cckbTest.render('board', 5000)")
  await settle()
  const action = await evaluate(`(() => {
    const source = document.querySelector('.cckb-card');
    const target = document.querySelector('[data-column-id="doing"]');
    const transfer = new DataTransfer();
    source.dispatchEvent(new DragEvent('dragstart', { bubbles:true, cancelable:true, dataTransfer:transfer }));
    const bounds = target.querySelector('.cckb-add-task').getBoundingClientRect();
    target.dispatchEvent(new DragEvent('drop', { bubbles:true, cancelable:true, dataTransfer:transfer, clientY:bounds.bottom+8 }));
    return cckbTest.actions()[0];
  })()`)
  assert.equal(action.action.columnId, 'doing')
  assert.equal(action.action.anchor, undefined)
  report.checks.push('Virtual board drop below add button appends without an offscreen anchor')
  await evaluate("cckbTest.render('board', 5000)")
  await settle()
  await evaluate(`(() => {
    const source = document.querySelector('.cckb-card');
    source.dispatchEvent(new DragEvent('dragstart', { bubbles:true, cancelable:true, dataTransfer:new DataTransfer() }));
    source.closest('.cckb-virtual-viewport').scrollTop = 30000;
  })()`)
  await settle()
  assert.equal(await evaluate("document.querySelector('[data-task-id=" + '"task-0"' + "]')?.classList.contains('cckb-dragging')"), true)
  await evaluate("document.querySelector('.cckb-dragging').dispatchEvent(new DragEvent('dragend', { bubbles:true }))")
  await settle()
  assert.equal(await evaluate("Boolean(document.querySelector('[data-task-id=" + '"task-0"' + "]'))"), false)
  report.checks.push('Drag source stays mounted until dragend, then releases outside the viewport')
  await evaluate('cckbTest.failingRow()')
  assert.equal(await evaluate("document.querySelectorAll('.cckb-error').length"), 1)
  assert.equal(await evaluate("[...document.querySelectorAll('button')].some(el => el.textContent === 'healthy-2')"), true)
  report.checks.push('One render failure leaves later rows available')
  await evaluate('cckbTest.dispose()')
  await settle()
  assert.deepEqual(errors, [])
  report.checks.push('No uncaught JavaScript errors')
  await writeFile(join(artifacts, 'results.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ artifacts, ...report }, null, 2))
} finally {
  socket?.close()
  for (const entry of pending.values()) entry.reject(new Error('Browser closed'))
  if (child.pid) {
    if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
    else child.kill()
  }
  server.close()
  const inside = relative(temporaryRoot, profile)
  assert.ok(inside && inside !== '..' && !inside.startsWith(`..${sep}`) && profile.startsWith(workspace + sep))
  await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
}
