import assert from 'node:assert/strict'
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'

const [reportPath, destination] = process.argv.slice(2)
assert(reportPath && destination, 'Usage: node scripts/check-pack.mjs <npm-pack.json> <output-directory>')
const manifest = JSON.parse(readFileSync('package.json', 'utf8'))
const reports = JSON.parse(readFileSync(reportPath, 'utf8'))
assert.equal(reports.length, 1, 'Expected one npm package')
const pack = reports[0]
assert.equal(pack.name, manifest.name)
assert.equal(pack.version, manifest.version)
assert.equal(pack.filename, basename(pack.filename), 'Expected a local tarball filename')

const files = new Set(pack.files.map(({ path }) => path))
const required = [
  'package.json',
  'README.md',
  manifest.main,
  manifest.exports['.'].development,
  manifest.llbot.webui,
  manifest.llbot.icon,
  'assets/synthid-login-check.jpg',
  'assets/synthid-native-click.ps1',
  'assets/synthid-native-select.ps1',
  ...['src', 'lib'].flatMap(root => [
    `${root}/synthid-http.${root === 'src' ? 'ts' : 'js'}`,
    ...['entry.mjs', 'lifecycle-client.mjs', 'lifecycle-worker.mjs', 'realm-init.js',
      'realm-pointer-diagnostic.js', 'realm-activation-diagnostic.js', 'realm-focus-diagnostic.js',
      'runtime-javascript-bindings.mjs',
    ].map(file => `${root}/synthid-http-runtime/${file}`),
  ]),
  ...(manifest.llbot.details === undefined ? [] : [manifest.llbot.details]),
  ...manifest.llbot.screenshots.map(screenshot => typeof screenshot === 'string' ? screenshot : screenshot.src),
]
for (const path of required) {
  assert(typeof path === 'string' && path.length > 0, `Invalid package asset path: ${path}`)
  assert(files.has(path.replace(/^\.\//, '')), `Package is missing ${path}`)
}
for (const path of files) {
  assert(!/\.(?:node|wasm|exe|dll|so|dylib)$/i.test(path), `Package contains a native binary: ${path}`)
  assert(!/(^|\/)(?:node_modules|output|test|scripts|\.github|\.playwright-cli)(\/|$)/.test(path), `Unexpected packaged file: ${path}`)
  assert(!/(^|\/)\.env(?:\.|$)/.test(path), `Unexpected environment file: ${path}`)
  if (/\.(?:mjs|cjs|js|mts|cts|ts|tsx|jsx|json|ps1|svg)$/i.test(path)) {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(readFileSync(path))
    assert(!/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text), `Package contains unreadable control characters: ${path}`)
  }
}

mkdirSync(destination, { recursive: true })
copyFileSync(pack.filename, join(destination, 'package.tgz'))
console.log(`Verified ${pack.name}@${pack.version}: ${files.size} files, ${pack.integrity}`)
