// Collects the transitive closure of relative-imported runtime modules from
// the research directory into src/synthid-http-runtime/ for production use,
// copies the Windows addon binaries, and applies the three production-layout
// adaptations. Idempotent; run from the plugin root.
import {readFile,writeFile,mkdir,cp,rm,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('..',import.meta.url));
const source=join(root,'output','node-verification');
const target=join(root,'src','synthid-http-runtime');
const entries=[
  'node-protocol-runtime.mjs',
  'lifecycle-client.mjs',
  'lifecycle-worker.mjs',
  'lifecycle-web-session.mjs',
  'independent-request-reference.mjs',
  'challenge-lifecycle.mjs',
  'complete-protocol.mjs',
  'web-session.mjs',
];
const binaries=[
  ['native-display-frames/build/Release/native_display_frames.node'],
  ['native-timer-resolution/build/Release/native_timer_resolution.node'],
  ['native-webidl-bridge/build/Release/native_webidl_bridge.node'],
];
const importPattern=/from\s+'(\.[^']+)'/g;
const dynamicPattern=/import\(\s*'(\.[^']+)'/g;
const seen=new Set(),queue=[...entries],order=[];
while(queue.length){
  const name=queue.shift();
  if(seen.has(name))continue;
  seen.add(name);
  let text='';
  try{text=await readFile(join(source,name),'utf8');}catch{order.push({name,missing:true});continue;}
  order.push({name});
  for(const pattern of [importPattern,dynamicPattern]){
    pattern.lastIndex=0;
    let hit;
    while((hit=pattern.exec(text))){
      const spec=hit[1];
      const resolved=spec.replace(/^\.\//,'');
      if(/\.mjs$|\.js$|\.json$/.test(resolved)){
        try{await stat(join(source,resolved));}catch{continue;}
        if(!seen.has(resolved))queue.push(resolved);
      }else{
        for(const candidate of [resolved+'.mjs',resolved+'.js',resolved+'/index.mjs']){
          try{await stat(join(source,candidate));if(!seen.has(candidate))queue.push(candidate);break;}catch{}
        }
      }
    }
  }
}
const missing=order.filter(item=>item.missing).map(item=>item.name);
const files=order.filter(item=>!item.missing).map(item=>item.name);
// The worker reads its bootstrap through readFile, not an import.
for(const resource of ['realm-init.js','realm-pointer-diagnostic.js','realm-focus-diagnostic.js','realm-activation-diagnostic.js','realm-private-bootstrap.js']) {
  if(!files.includes(resource))files.push(resource);
}
await rm(target,{recursive:true,force:true});
await mkdir(target,{recursive:true});
for(const name of files)await cp(join(source,name),join(target,name));
for(const [[binary]] of binaries.map(item=>[item])){
  const to=join(target,binary);
  await mkdir(join(to,'..'),{recursive:true});
  await cp(join(source,binary),to);
}
// ---- Production-layout adaptations (idempotent) ----
const patch=async (name,from,to,tag)=>{
  const file=join(target,name);
  let text=await readFile(file,'utf8');
  if(text.includes(tag))return false;
  if(!text.includes(from))throw Error('PATCH_ANCHOR_MISSING:'+name);
  await writeFile(file,text.replace(from,to));
  return true;
};
const applied=[];
if(await patch('lifecycle-client.mjs',
  "import { spawn } from 'node:child_process';",
  "import { spawn } from 'node:child_process';\nimport { createRequire } from 'node:module';",
  "import { createRequire } from 'node:module'"))applied.push('client-dependency-resolver');
// 1. Worker: allow the plugin root's node_modules for jsdom resolution.
if(await patch('lifecycle-client.mjs',
  "    if(nativePluginGetters&&workerExecutable!==process.execPath)allowedPaths.push('engine-canary/native-webidl-bridge','engine-canary/package.json');",
  "    if(nativePluginGetters&&workerExecutable!==process.execPath)allowedPaths.push('engine-canary/native-webidl-bridge','engine-canary/package.json');\n    // Production layout: permit both the local dependency link and its resolved tree.\n    allowedPaths.push('../../node_modules', resolve(dirname(createRequire(import.meta.url).resolve('jsdom/package.json')), '..'));",
  "Production layout: jsdom"))applied.push('client-node-modules');
// 2. Preload: resolve jsdom's generated directory through package resolution.
if(await patch('webidl-brand-errors-preload.mjs',
  "import {registerHooks} from 'node:module';\nimport {parse} from 'acorn';",
  "import {registerHooks,createRequire} from 'node:module';\nimport {dirname} from 'node:path';\nimport {pathToFileURL} from 'node:url';\nimport {parse} from 'acorn';",
  "import {pathToFileURL} from 'node:url'"))applied.push('preload-imports');
if(await patch('webidl-brand-errors-preload.mjs',
  "const prefix=new URL('./node_modules/jsdom/lib/jsdom/living/generated/',import.meta.url).href;",
  "const brandRequire=createRequire(import.meta.url);\nconst prefix=pathToFileURL(dirname(brandRequire.resolve('jsdom/package.json'))+'/lib/jsdom/living/generated/').href;",
  'brandRequire.resolve'))applied.push('preload-prefix');
// Native compatibility is part of the accepted profile. Fail explicitly when
// it cannot load, rather than silently submitting a different configuration.
// ---- Generated production entry (stable typed surface for src/synthid-http.ts) ----
await writeFile(join(target,'entry.mjs'), `// Generated by scripts/collect-synthid-http-runtime.mjs — do not edit.
export { createLifecycleClient } from './lifecycle-client.mjs'
export { createLifecycleWebSession } from './lifecycle-web-session.mjs'
export { attachWebXsrf } from './web-session.mjs'
export { createIndependentRequestReference } from './independent-request-reference.mjs'
export { parseOfficialChallenge, normalizeOfficialExperimentState } from './complete-protocol.mjs'
`);
await writeFile(join(target,'entry.d.mts'), `// Generated by scripts/collect-synthid-http-runtime.mjs — do not edit.
export interface RuntimeInitialization { success: boolean; [key: string]: unknown }
export interface RuntimeSnapshot { success: boolean; bgToken?: string; [key: string]: unknown }
export interface LifecycleClient {
  initialize(input: Record<string, unknown>): Promise<RuntimeInitialization>
  dispatchPointerDiagnostics(): Promise<{ success: boolean; [key: string]: unknown }>
  snapshot(blobref: string, options?: { signal?: AbortSignal }): Promise<RuntimeSnapshot>
  dispose(): Promise<{ success: boolean; [key: string]: unknown }>
  readonly telemetry: Record<string, unknown>
}
export interface LifecycleClientOptions {
  timeouts?: { init?: number; snapshot?: number; [key: string]: number | undefined }
  maxLifetimeMs?: number
  signal?: AbortSignal
  webidlBrandErrors?: boolean
  nativePluginGetters?: boolean
  nativeTimerResolution?: boolean
  nativeDisplayFrames?: boolean
  workerExecutable?: string
}
export interface WebSession {
  config: Record<string, string>
  environment(): Promise<Record<string, unknown>>
  request(url: string, init?: Record<string, unknown>): Promise<Response>
  nextRequestId(): string
  readonly summary: Record<string, unknown>
}
export interface RequestReference {
  userAgent: string
  stages: Record<string, { headers: Record<string, string> }>
}
export interface OfficialChallenge {
  program: string
  globalName: string
  clientExperimentsStateBlob?: string
  interpreterUrl?: { privateDoNotAccessOrElseTrustedResourceUrlWrappedValue?: string }
  interpreterJavascript?: { privateDoNotAccessOrElseSafeScriptWrappedValue?: string }
  [key: string]: unknown
}
export declare function createLifecycleClient(options?: LifecycleClientOptions): LifecycleClient
export declare function createLifecycleWebSession(options: { fetch: (url: string, init?: Record<string, unknown>) => Promise<Response> }, userAgent: string, settings?: { networkMeasurements?: boolean; collapseConnectionTiming?: boolean }): Promise<WebSession>
export declare function attachWebXsrf(body: unknown, config: Record<string, string>): URLSearchParams
export declare function createIndependentRequestReference(options: { userAgent: string; clientHints?: Record<string, string> }): RequestReference
export declare function parseOfficialChallenge(raw: unknown): OfficialChallenge
export declare function normalizeOfficialExperimentState(blob: string | undefined): string
`);
console.log(JSON.stringify({copied:files.length,missing:[...new Set(missing)],binaries:binaries.length,applied,entry:true}));
