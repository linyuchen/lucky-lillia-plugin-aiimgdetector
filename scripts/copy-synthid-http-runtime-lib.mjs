// Copies the collected runtime (modules, addons, generated entry) into lib/
// after tsc, so the published package resolves it next to the compiled JS.
import {cp,rm,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
const root=fileURLToPath(new URL('..',import.meta.url));
await rm(join(root,'lib','synthid-http-runtime'),{recursive:true,force:true});
await mkdir(join(root,'lib'),{recursive:true});
await cp(join(root,'src','synthid-http-runtime'),join(root,'lib','synthid-http-runtime'),{recursive:true});
console.log(JSON.stringify({copied:'lib/synthid-http-runtime'}));
