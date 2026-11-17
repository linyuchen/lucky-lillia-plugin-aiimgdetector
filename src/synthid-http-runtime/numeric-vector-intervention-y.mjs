// One-shot diagnostic vector intervention at verified public/relocated sites.
import { Session } from 'node:inspector';
import { createHash, randomUUID } from 'node:crypto';
import { types } from 'node:util';
import { parse } from 'acorn';
import { inspectTokenEnvelope } from './token-envelope-inspector.mjs';

const SOURCE = '000c4d17cba5e9ae982e545746ca1a43cebae5d9353043a6d3f2aa259c3f6cd9';
const INNER = '45242a678180fc46d7bbbc5486f2a78ff9fb8b4e7adbf077e35586a92b9c4273';
const OK_HASH = '498b2968f883265940792db28523266ae0f0272f8e1c35f2c018d4c66c13a43f';
const N5_HASH = '8bba8bf45a81ed18d8f7efc99dad305922d6a9438a24e022bce87b560be4743b';
const FX_HASH = '3aeae764731137af71533a8614f41ab5c8db1a6caa2d65e549b0da86605cf615';
const HB_HASH = '735590861607bdea117f5311f4fb8a2ecaa7806e7159f602ddaeddaa238ccae5';
const ROUTE = 'snapshot-n5-ok143-untagged';
const WITNESS_ROUTE = 'snapshot-n5-ok143-untagged-cipher-observation';
const INITIAL_ROUTE = 'init-append143-untagged-cipher-observation';
const INITIAL_SOURCE_ROUTE = 'init-append143-source-cipher-observation';
const INITIAL_ORIGIN_ROUTE = 'init-append143-array-origin-cipher-observation';
const SETTERS = ['U', 'Y', 'uC'];
const PRODUCERS = ['arrayAssembly', 'propertyRead', 'encodedPropertyRead', 'callResult', 'evalResult'];
const MAX_ROWS = 256, MAX_WIDTH = 256, MAX_BYTES = 65536;
const MAX_PRIVATE_SOURCES = 16, MAX_SOURCE_UNITS = 262144, MAX_SOURCE_BYTES = 1048576, MAX_PARSE_NODES = 50000;
const hash = text => createHash('sha256').update(text).digest('hex');
const ARRAY_CONDITION = "typeof c === 'object' && c !== null", ARRAY_CONDITION_HASH = hash(ARRAY_CONDITION);
const PROTOCOL_OPERATIONS = ['Runtime.enable','Runtime.disable','Runtime.evaluate','Runtime.callFunctionOn','Runtime.getProperties','Runtime.releaseObjectGroup','Debugger.enable','Debugger.disable','Debugger.getScriptSource','Debugger.getPossibleBreakpoints','Debugger.setBreakpoint','Debugger.setInstrumentationBreakpoint','Debugger.removeBreakpoint','Debugger.evaluateOnCallFrame','Debugger.setVariableValue','Debugger.resume'];
const PROTOCOL_REJECTION_TEXT = ['NOT_PAUSED','CALL_FRAME','CONTEXT','OBJECT','SESSION','TERMINATED','OTHER'];
const activeCDP = new WeakSet(); let activeNode = false;
export class NumericVectorError extends Error {
  constructor(code) { super('Numeric vector: ' + code); this.name = 'NumericVectorError'; this.code = code; }
}
const error = code => new NumericVectorError(code);
function descriptor(object, name) { const d = Object.getOwnPropertyDescriptor(object, name); if (!d || !Object.hasOwn(d, 'value')) throw error('INVALID_PACKET'); return d; }
function denseArray(array, maximum, minimum = 0) {
  if (!array || types.isProxy(array) || !Array.isArray(array) || Object.getPrototypeOf(array) !== Array.prototype) throw error('INVALID_PACKET');
  const length = descriptor(array, 'length');
  if (!Number.isInteger(length.value) || length.value < minimum || length.value > maximum || !length.writable || Reflect.ownKeys(array).length !== length.value + 1) throw error('INVALID_PACKET');
  for (let i = 0; i < length.value; i++) { const d = descriptor(array, String(i)); if (!d.writable || !d.configurable) throw error('INVALID_PACKET'); }
  return length.value;
}
export function copyNumericVectorPacket(packet) {
  let rows = [], selectedOrdinals = [], rowOffsets = [], keyWords = [], cipherRows = [], rowSources = [], rowOrigins = [];
  try {
    if (!packet || typeof packet !== 'object' || types.isProxy(packet) || ![Object.prototype, null].includes(Object.getPrototypeOf(packet))) throw error('INVALID_PACKET');
    const keys = Reflect.ownKeys(packet), schemaVersion = descriptor(packet, 'schemaVersion').value;
    const expectedKeys = ['schemaVersion', 'sourcePin', 'route', 'rows', ...(schemaVersion === 2 ? ['selectedOrdinals'] : [3,4,5,6].includes(schemaVersion) ? ['rowOffsets', 'keyWords', 'cipherRows', ...([5,6].includes(schemaVersion) ? ['rowSources'] : []), ...(schemaVersion === 6 ? ['rowOrigins'] : [])] : [])];
    if (keys.length !== expectedKeys.length || !expectedKeys.every(k => keys.includes(k))) throw error('INVALID_PACKET');
    if (![1,2,3,4,5,6].includes(schemaVersion) || descriptor(packet, 'sourcePin').value !== SOURCE || descriptor(packet, 'route').value !== (schemaVersion === 6 ? INITIAL_ORIGIN_ROUTE : schemaVersion === 5 ? INITIAL_SOURCE_ROUTE : schemaVersion === 4 ? INITIAL_ROUTE : schemaVersion === 3 ? WITNESS_ROUTE : ROUTE)) throw error('INVALID_PACKET');
    const incoming = descriptor(packet, 'rows').value, count = denseArray(incoming, MAX_ROWS, 1); let total = 0;
    for (let i = 0; i < count; i++) {
      const row = descriptor(incoming, String(i)).value, width = denseArray(row, MAX_WIDTH, 1), copy = []; rows.push(copy);
      if ((total += width) > MAX_BYTES) throw error('INVALID_PACKET');
      for (let j = 0; j < width; j++) { const n = descriptor(row, String(j)).value; if (!Number.isInteger(n) || n < 0 || n > 255) throw error('INVALID_PACKET'); copy.push(n); }
    }
    if (schemaVersion === 2) {
      const input = descriptor(packet, 'selectedOrdinals').value, size = denseArray(input, count, 1); let previous = -1;
      for (let i = 0; i < size; i++) { const ordinal = descriptor(input, String(i)).value; if (!Number.isInteger(ordinal) || ordinal <= previous || ordinal >= count) throw error('INVALID_PACKET'); selectedOrdinals.push(ordinal); previous = ordinal; }
    }
    if ([3,4,5,6].includes(schemaVersion)) {
      const offsets = descriptor(packet, 'rowOffsets').value, keys = descriptor(packet, 'keyWords').value, ciphertext = descriptor(packet, 'cipherRows').value;
      if (denseArray(offsets, MAX_ROWS, 1) !== count || denseArray(keys, MAX_ROWS, 1) !== count || denseArray(ciphertext, MAX_ROWS, 1) !== count) throw error('INVALID_PACKET');
      let end = 4;
      for (let i = 0; i < count; i++) {
        const offset = descriptor(offsets, String(i)).value, words = descriptor(keys, String(i)).value, bytes = descriptor(ciphertext, String(i)).value;
        if (!Number.isSafeInteger(offset) || offset < end || offset + rows[i].length > 65535 || denseArray(words, 2, 2) !== 2 || denseArray(bytes, MAX_WIDTH, 1) !== rows[i].length) throw error('INVALID_PACKET');
        const wordCopy = [], byteCopy = []; rowOffsets.push(offset); keyWords.push(wordCopy); cipherRows.push(byteCopy); end = offset + rows[i].length;
        for (let j = 0; j < 2; j++) { const value = descriptor(words, String(j)).value; if (!Number.isInteger(value) || value < -2147483648 || value > 2147483647) throw error('INVALID_PACKET'); wordCopy.push(value); }
        for (let j = 0; j < rows[i].length; j++) { const value = descriptor(bytes, String(j)).value; if (!Number.isInteger(value) || value < 0 || value > 255) throw error('INVALID_PACKET'); byteCopy.push(value); }
      }
    }
    if ([5,6].includes(schemaVersion)) {
      const sources = descriptor(packet, 'rowSources').value;
      if (denseArray(sources, MAX_ROWS, 1) !== count) throw error('INVALID_PACKET');
      for (let i = 0; i < count; i++) {
        const tuple = descriptor(sources, String(i)).value;
        if (denseArray(tuple, 5, 5) !== 5) throw error('INVALID_PACKET');
        const copy = []; rowSources.push(copy);
        for (let j = 0; j < 5; j++) { const value = descriptor(tuple, String(j)).value; if (!Number.isSafeInteger(value) || value < 0 || value > (j === 0 ? 3 : j === 3 ? 16777216 : 65535)) throw error('INVALID_PACKET'); copy.push(value); }
        if (copy[0] === 0 && copy.slice(1).some(value => value !== 0)) throw error('INVALID_PACKET');
      }
    }
    if (schemaVersion === 6) {
      const origins = descriptor(packet, 'rowOrigins').value;
      if (denseArray(origins, MAX_ROWS, 1) !== count) throw error('INVALID_PACKET');
      for (let i = 0; i < count; i++) {
        const value = descriptor(origins, String(i)).value;
        if (!Number.isInteger(value) || Object.is(value,-0) || value < 0 || value > 7 || value !== 0 && (rowSources[i][0] !== 3 || rowSources[i][2] !== 3)) throw error('INVALID_PACKET');
        rowOrigins.push(value);
      }
    }
    return { schemaVersion, sourcePin: SOURCE, route: schemaVersion === 6 ? INITIAL_ORIGIN_ROUTE : schemaVersion === 5 ? INITIAL_SOURCE_ROUTE : schemaVersion === 4 ? INITIAL_ROUTE : schemaVersion === 3 ? WITNESS_ROUTE : ROUTE, rows, ...(schemaVersion === 2 ? {selectedOrdinals} : [3,4,5,6].includes(schemaVersion) ? {rowOffsets, keyWords, cipherRows, ...([5,6].includes(schemaVersion) ? {rowSources} : {}), ...(schemaVersion === 6 ? {rowOrigins} : {})} : {}) };
  } catch { wipeRows(rows); wipeRows(keyWords); wipeRows(cipherRows); wipeRows(rowSources); rowOrigins.fill(0); rowOrigins.length = 0; selectedOrdinals.fill(0); selectedOrdinals.length = 0; rowOffsets.fill(0); rowOffsets.length = 0; throw error('INVALID_PACKET'); }
}
export function clearNumericVectorPacket(packet) {
  let complete = true;
  try {
    if (!packet || typeof packet !== 'object' || types.isProxy(packet)) return false;
    // Erase observation fields independently, even if rows is malformed. No
    // accessor, proxy or user-supplied iterator is invoked during cleanup.
    const schema = Object.getOwnPropertyDescriptor(packet, 'schemaVersion');
    const witness = !!schema && Object.hasOwn(schema, 'value') && [3,4,5,6].includes(schema.value);
    const erase = (array, maximum, nestedMaximum) => {
      if (!array || types.isProxy(array) || !Array.isArray(array)) return false;
      const size = Object.getOwnPropertyDescriptor(array, 'length');
      if (!size || !Number.isInteger(size.value) || size.value < 0 || size.value > maximum) return false;
      let valid = true;
      for (let i = 0; i < size.value; i++) {
        const item = Object.getOwnPropertyDescriptor(array, String(i));
        if (!item || !Object.hasOwn(item, 'value')) { valid = false; continue; }
        if (nestedMaximum !== undefined) { if (!erase(item.value, nestedMaximum)) valid = false; }
        else if (item.writable) array[i] = 0; else valid = false;
      }
      if (size.writable) { try { array.length = 0; } catch { valid = false; } } else valid = false;
      return valid;
    };
    for (const [name, nested] of [['rowOffsets', undefined], ['keyWords', 2], ['cipherRows', MAX_WIDTH]]) {
      const field = Object.getOwnPropertyDescriptor(packet, name);
      if (!field) { if (witness) complete = false; continue; }
      if (!Object.hasOwn(field, 'value') || !erase(field.value, MAX_ROWS, nested)) complete = false;
    }
    const sources = Object.getOwnPropertyDescriptor(packet, 'rowSources');
    if (sources ? !Object.hasOwn(sources, 'value') || !erase(sources.value, MAX_ROWS, 5) : [5,6].includes(schema?.value)) complete = false;
    const origins = Object.getOwnPropertyDescriptor(packet, 'rowOrigins');
    if (origins ? !Object.hasOwn(origins, 'value') || !erase(origins.value, MAX_ROWS) : schema?.value === 6) complete = false;
    const outer = Object.getOwnPropertyDescriptor(packet, 'rows');
    if (!outer || !Object.hasOwn(outer, 'value')) return false;
    const rows = outer.value;
    if (!rows || types.isProxy(rows) || !Array.isArray(rows)) return false;
    const length = Object.getOwnPropertyDescriptor(rows, 'length');
    if (!length || !Number.isInteger(length.value) || length.value > MAX_ROWS) return false;
    for (let i = 0; i < length.value; i++) {
      const entry = Object.getOwnPropertyDescriptor(rows, String(i));
      if (!entry || !Object.hasOwn(entry, 'value')) { complete = false; continue; }
      const row = entry.value;
      if (!row || types.isProxy(row) || !Array.isArray(row)) { complete = false; continue; }
      const width = Object.getOwnPropertyDescriptor(row, 'length');
      if (!width || !Number.isInteger(width.value) || width.value > MAX_WIDTH) { complete = false; continue; }
      for (let j = 0; j < width.value; j++) { const d = Object.getOwnPropertyDescriptor(row, String(j)); if (d && Object.hasOwn(d, 'value') && d.writable) row[j] = 0; else complete = false; }
      if (width.writable) { try { row.length = 0; } catch { complete = false; } } else complete = false;
    }
    if (length.writable) { try { rows.length = 0; } catch { complete = false; } } else complete = false;
    const selection = Object.getOwnPropertyDescriptor(packet, 'selectedOrdinals');
    if (selection) {
      if (!Object.hasOwn(selection, 'value') || !Array.isArray(selection.value) || types.isProxy(selection.value)) complete = false;
      else {
        const mask = selection.value, size = Object.getOwnPropertyDescriptor(mask, 'length');
        if (!size || !Number.isInteger(size.value) || size.value > MAX_ROWS) complete = false;
        else { for (let i = 0; i < size.value; i++) { const d = Object.getOwnPropertyDescriptor(mask, String(i)); if (d && Object.hasOwn(d,'value') && d.writable) mask[i] = 0; else complete = false; } if (size.writable) { try { mask.length = 0; } catch { complete = false; } } else complete = false; }
      }
    }
  } catch { complete = false; }
  return complete;
}
export const eraseNumericVectorPacket = clearNumericVectorPacket;
function wipeRows(rows) { for (const row of rows) { row.fill(0); row.length = 0; } rows.length = 0; }
function visit(node, fn, parent) {
  if (!node || typeof node !== 'object') return;
  if (node.type) fn(node, parent);
  for (const [key, value] of Object.entries(node)) { if (key === 'start' || key === 'end') continue; if (Array.isArray(value)) for (const child of value) visit(child, fn, node); else if (value && typeof value === 'object') visit(value, fn, node); }
}
function referenceFor(source) {
  if (typeof source !== 'string' || source.length !== 66645 || hash(source) !== SOURCE) throw error('UNREVIEWED_SOURCE');
  const candidates = [];
  visit(parse(source, { ecmaVersion: 'latest' }), n => { if (n.type === 'ArrayExpression' && n.elements.every(e => e?.type === 'Literal' && typeof e.value === 'string') && n.elements.some(e => e.value.length > 50000)) candidates.push(n); });
  if (candidates.length !== 1) throw error('UNREVIEWED_SOURCE');
  const embedded = candidates[0].elements.map(e => e.value).join('\n');
  if (embedded.length !== 62054 || hash(embedded) !== INNER || hash(embedded.slice(21813, 22388)) !== OK_HASH || hash(embedded.slice(21419, 21498)) !== N5_HASH || embedded.slice(22351, 22359) !== 'c.length') throw error('UNREVIEWED_SITE');
  if (hash(embedded.slice(37785, 37946)) !== FX_HASH) throw error('UNREVIEWED_SITE');
  if (hash(embedded.slice(22911,23430)) !== HB_HASH) throw error('UNREVIEWED_SITE');
  const origins = {
    UStart:23550, UEntryStart:23566, UEntryEnd:23590,
    YStart:26957, YEntryStart:26973, YEntryEnd:26997,
    uCStart:41442, uCEntryStart:41458, uCEntryEnd:41482,
    arrayAssemblyStart:31891, propertyReadStart:36072, encodedPropertyReadStart:30475, callResultStart:33054, evalResultStart:36504,
  };
  return sourceReference(embedded, { fixture: false, length: 62054, hash: INNER, outerHash: SOURCE, outerLength: 66645, maxPrefix: 8192, okStart: 21813, okBody: 21840, okEnd: 22388, okHash: OK_HASH, ekStart:19322, ekBody:19349, ekEnd:19913, ekEntryStart:19880, ekEntryEnd:19888, n5Start: 21419, n5Body: 21436, n5End: 21498, n5Hash: N5_HASH, entryStart: 22351, entryEnd: 22359, callStart: 21437, callEnd: 21497, returnStart: 21497, returnEnd: 21498, wrapperStart: 38780, wrapperEnd: 38809, fxStart: 37785, fxBody: 37808, fxEnd: 37946, fxCallStart: 37902, fxCallEnd: 37924, fxEkCallStart:37936,fxEkCallEnd:37945, hbStart:22911,hbBody:22936,hbEnd:23430,hbCallStart:23127,hbCallEnd:23133,s1Start:36017,s4Start:33314,f3Start:35650,f4Start:35951, ...origins });
}
function fixtureReference(source) {
  if (typeof source !== 'string' || source.length > 65536 || !source.includes('numeric-vector-owned-fixture')) throw error('INVALID_FIXTURE');
  const found = {};
  visit(parse(source, { ecmaVersion: 'latest' }), (node, parent) => { if (node.type === 'FunctionExpression' && parent?.type === 'AssignmentExpression' && ['Ok', 'Ek', 'n5', 'wrapper', 'fx', 'HB', 's1', 's4', 'f3', 'f4', ...SETTERS, ...PRODUCERS].includes(parent.left.property?.name)) { const name = parent.left.property.name; if (found[name]) throw error('INVALID_FIXTURE'); found[name] = node; } });
  const ok = found.Ok, n5 = found.n5, ek = found.Ek;
  if (!ok || !n5 || ok.params.map(p => p.name).join(',') !== 'R,m,c,a,E,h,t,W,n' || n5.params.map(p => p.name).join(',') !== 'R,m,c,a') throw error('INVALID_FIXTURE');
  const ekEntries=[];if(ek){if(ek.params.map(p=>p.name).join(',')!=='R,m,c,a,E,h,t,W,n')throw error('INVALID_FIXTURE');visit(ek,n=>{if(n.type==='MemberExpression'&&n.object.name==='c'&&n.property.name==='length')ekEntries.push(n);});if(ekEntries.length!==1)throw error('INVALID_FIXTURE');}
  const entries = [], calls = [];
  visit(ok, n => { if (n.type === 'MemberExpression' && n.object.name === 'c' && n.property.name === 'length') entries.push(n); });
  visit(n5, n => { if (n.type === 'CallExpression' && n.callee.name === 'Ok') calls.push(n); });
  if (entries.length !== 1 || calls.length !== 1) throw error('INVALID_FIXTURE');
  const fxCalls = []; if (found.fx) visit(found.fx, n => { if (n.type === 'CallExpression' && n.callee.name === 'Ok') fxCalls.push(n); });
  if (found.fx && fxCalls.length !== 1) throw error('INVALID_FIXTURE');
  const extra={};for(const name of ['s1','s4','f3','f4'])if(found[name])extra[name+'Start']=found[name].start;
  for (const name of [...SETTERS,...PRODUCERS]) if(found[name]) {
    extra[name+'Start']=found[name].start;
    if (SETTERS.includes(name)) {
      const first=found[name].body.body[0];
      if(found[name].params.map(p=>p.name).join(',')!=='R,m,c'||first?.type!=='SwitchStatement')throw error('INVALID_FIXTURE');
      extra[name+'EntryStart']=first.start;extra[name+'EntryEnd']=first.discriminant.end;
    }
  }
  if(found.HB){const calls=[];visit(found.HB,n=>{if(n.type==='CallExpression'&&n.callee.name==='E')calls.push(n);});if(calls.length!==1)throw error('INVALID_FIXTURE');Object.assign(extra,{hbStart:found.HB.start,hbBody:found.HB.body.start,hbEnd:found.HB.end,hbCallStart:calls[0].start,hbCallEnd:calls[0].end});}
  if(found.fx){const calls=[];visit(found.fx,n=>{if(n.type==='CallExpression'&&n.callee.name==='Ek')calls.push(n);});if(calls.length===1)Object.assign(extra,{fxEkCallStart:calls[0].start,fxEkCallEnd:calls[0].end});}
  return sourceReference(source, { fixture: true, length: source.length, hash: hash(source), maxPrefix: 64, okStart: ok.start, okBody: ok.body.start, okEnd: ok.end, okHash: hash(source.slice(ok.start, ok.end)), ...(ek?{ekStart:ek.start,ekBody:ek.body.start,ekEnd:ek.end,ekEntryStart:ekEntries[0].start,ekEntryEnd:ekEntries[0].end}:{}), n5Start: n5.start, n5Body: n5.body.start, n5End: n5.end, n5Hash: hash(source.slice(n5.start, n5.end)), entryStart: entries[0].start, entryEnd: entries[0].end, callStart: calls[0].start, callEnd: calls[0].end, returnStart: n5.end - 1, returnEnd: n5.end, ...(found.wrapper ? { wrapperStart: found.wrapper.start, wrapperEnd: found.wrapper.end } : {}), ...(found.fx ? {fxStart: found.fx.start, fxBody: found.fx.body.start, fxEnd: found.fx.end, fxCallStart: fxCalls[0].start, fxCallEnd: fxCalls[0].end} : {}), ...extra });
}
function sourceReference(source, reference) {
  const definitions = {};
  visit(parse(source, { ecmaVersion: 'latest' }), node => {
    for (const name of ['ok', 'ek', 'n5', 'wrapper', 'fx', 'hb', 's1', 's4', 'f3', 'f4', ...SETTERS, ...PRODUCERS]) {
      if (node.start !== reference[name + 'Start'] || node.type !== 'FunctionExpression') continue;
      if (node.async || node.generator || node.params.some(p => p.type !== 'Identifier')) throw error('UNREVIEWED_HEADER');
      const body = node.body, first = body.body[0];
      const handlerCalls=[];if(['s1','s4','f3','f4'].includes(name))visit(node,n=>{if(n.type==='CallExpression'&&['n5','Fx','fx'].includes(n.callee.name))handlerCalls.push(n);});
      if(['s1','s4','f3','f4'].includes(name)&&handlerCalls.length!==1)throw error('UNREVIEWED_HEADER');
      const producerCalls=[];if(PRODUCERS.includes(name))visit(node,n=>{if(n.type==='CallExpression'&&SETTERS.includes(n.callee.name))producerCalls.push(n);});
      if(PRODUCERS.includes(name)&&producerCalls.length!==1||SETTERS.includes(name)&&node.params.map(p=>p.name).join(',')!=='R,m,c')throw error('UNREVIEWED_HEADER');
      definitions[name] = { name, start: node.start, body: body.start, end: node.end, functionOffset: node.start + 8, params: node.params.map(p => p.name), bodyText: source.slice(body.start, body.end), ...(handlerCalls.length?{callFrom:handlerCalls[0].start,callTo:handlerCalls[0].end}:{}), ...(producerCalls.length?{callFrom:producerCalls[0].start,callTo:producerCalls[0].end,setter:producerCalls[0].callee.name,origin:PRODUCERS.indexOf(name)+1}:{}), ...(name === 'wrapper' ? { wrapperFrom: first?.start, wrapperTo: first?.end } : {}) };
    }
  });
  if (!definitions.ok || !definitions.n5 || reference.wrapperStart !== undefined && !definitions.wrapper) throw error('UNREVIEWED_HEADER');
  return { ...reference, definitions };
}
function indexRelocatedSource(source, reference) {
  let ast, tokens = [], count = 0; const functions = new Map(), mapped = positions(source);
  try {
    ast = parse(source, { ecmaVersion: 'latest', onToken(token) { if (tokens.length >= MAX_PARSE_NODES) throw error('SOURCE_LIMIT'); tokens.push(token); } });
    visit(ast, (node, parent) => {
      if (++count > MAX_PARSE_NODES) throw error('SOURCE_LIMIT');
      if (!['FunctionExpression', 'FunctionDeclaration', 'ArrowFunctionExpression'].includes(node.type)) return;
      const matches = ['ok', 'ek', 'n5', 'fx', 'hb', 's1', 's4', 'f3', 'f4', ...SETTERS, ...PRODUCERS].filter(name => reference.definitions[name] && source.slice(node.body.start, node.body.end) === reference.definitions[name].bodyText);
      if (matches.length !== 1) return;
      const name = matches[0], expected = reference.definitions[name];
      const header = node.type !== 'ArrowFunctionExpression' && !node.async && !node.generator && !parent?.method && parent?.type !== 'MethodDefinition' && node.params.length === expected.params.length && node.params.every((p, i) => p.type === 'Identifier' && p.name === expected.params[i]);
      const functionOffset = node.type === 'ArrowFunctionExpression' ? node.start : tokens.find(t => t.start >= node.start && t.start < node.body.start && t.type.label === '(')?.start;
      if (!Number.isInteger(functionOffset)) throw error('FUNCTION_LOCATION');
      if (functions.has(functionOffset)) { functions.set(functionOffset, null); return; }
      // Only reviewed-body locations survive. No source, AST or unknown body is retained.
      functions.set(functionOffset, { name, start: node.start, body: node.body.start, end: node.body.end, functionOffset, header });
    });
    return { mapped, functions };
  } finally { ast = null; tokens.length = 0; tokens = null; }
}
function optionsFor(options) {
  if (!['capture', 'self', 'replace'].includes(options.mode)) throw error('INVALID_MODE');
  const maxDurationMs = options.maxDurationMs ?? 90000, maxHits = options.maxHits ?? 10000;
  if (!Number.isInteger(maxDurationMs) || maxDurationMs < 100 || maxDurationMs > 240000 || !Number.isInteger(maxHits) || maxHits < 1 || maxHits > 20000) throw error('INVALID_OPTIONS');
  if (options.observeInitPublicEntries !== undefined && typeof options.observeInitPublicEntries !== 'boolean') throw error('INVALID_OPTIONS');
  if (options.observeCipherWitness !== undefined && typeof options.observeCipherWitness !== 'boolean' || options.observeCipherWitness === true && options.mode !== 'capture') throw error('INVALID_OPTIONS');
  return { mode: options.mode, maxDurationMs, maxHits, observeInitPublicEntries: options.observeInitPublicEntries === true, observeCipherWitness: options.observeCipherWitness === true };
}
function makePrivateHelper() {
  'use strict';
  const getOwn = Object.getOwnPropertyDescriptor, getProto = Object.getPrototypeOf, isArray = Array.isArray, proto = Array.prototype, integer = Number.isInteger, finite = Number.isFinite;
  const Weak = WeakMap, weakGet = Function.call.bind(WeakMap.prototype.get), weakSet = Function.call.bind(WeakMap.prototype.set);
  let arrayOrigins = new Weak(), originObjects = 0, originObservations = 0, originDisabled = false;
  let owner = null, pending = null, witnessBuffer = null, witnessEnd = 4, committedCipher = null, earlyOwner = null, earlyBuffer = null;
  let early = [], earlyCipher = [], earlyTaken = false;
  let earlySeen=0,earlyDiscardedRows=0,earlyDiscardedBytes=0,earlyRepeatedSamples=0,earlyOverlapEvents=0;
  function length(array, min, max) { if (!isArray(array) || getProto(array) !== proto) throw Error('ARRAY'); const d = getOwn(array, 'length'); if (!d || !integer(d.value) || d.value < min || d.value > max) throw Error('LENGTH'); return d.value; }
  function copy(array) { const n = length(array, 1, 256), row = []; for (let i = 0; i < n; i++) { const d = getOwn(array, String(i)); if (!d || !('value' in d) || !integer(d.value) || d.value < 0 || d.value > 255) throw Error('BYTE'); row.push(d.value); } return row; }
  function same(array, row) { if (length(array, 1, 256) !== row.length) return false; for (let i = 0; i < row.length; i++) { const d = getOwn(array, String(i)); if (!d || !('value' in d) || d.value !== row[i]) return false; } return true; }
  function wipe(row) { if (!row) return; for (let i = 0; i < row.length; i++) row[i] = 0; row.length = 0; }
  function clearPending() { if (pending) { wipe(pending.original); wipe(pending.selected); wipe(pending.replacement); wipe(pending.keyWords); pending = null; } }
  function clearEarly(){for(const item of early){wipe(item.row);wipe(item.words);wipe(item.source);item.origin=0;}early.length=0;for(const row of earlyCipher)wipe(row);earlyCipher.length=0;}
  function clearOrigins(){arrayOrigins=new Weak();originObjects=originObservations=0;originDisabled=true;}
  function earlySummary(){return{discardedRows:earlyDiscardedRows,discardedBytes:earlyDiscardedBytes,repeatedSamples:earlyRepeatedSamples,overlapEvents:earlyOverlapEvents};}
  function discardEarlyFrom(offset,replacement){
    let overlapped=false;
    while(early.length){const item=early[early.length-1];if(item.offset+item.row.length<=offset)break;overlapped=true;early.pop();earlyDiscardedRows++;earlyDiscardedBytes+=item.row.length;
      if(replacement&&item.offset===offset&&item.row.length===replacement.row.length&&item.words[0]===replacement.words[0]&&item.words[1]===replacement.words[1]&&item.row.every((value,i)=>value===replacement.row[i]))earlyRepeatedSamples++;
      wipe(item.row);wipe(item.words);wipe(item.source);item.origin=0;
    }
    if(overlapped)earlyOverlapEvents++;
  }
  return {
    // Host rejects proxies by protocol metadata before passing the original
    // array. No elements, prototype, VM table or getter are read here.
    noteArray(array, origin) {
      if(!integer(origin)||origin<1||origin>7||origin===6)throw Error('ORIGIN_SHAPE');
      // V8 also reports arguments objects as subtype=array. Check only the
      // captured intrinsic; do not inspect any element, prototype or getter.
      if(!isArray(array))return{accepted:false,nonarray:true};
      if(originDisabled)return{accepted:false,limited:true};
      const previous=weakGet(arrayOrigins,array);
      if(++originObservations>4096||previous===undefined&&originObjects>=1024){clearOrigins();return{accepted:false,limited:true};}
      if(previous===undefined)originObjects++;
      weakSet(arrayOrigins,array,previous===undefined?origin:6);
      return{accepted:true,repeated:previous!==undefined,objects:originObjects,observations:originObservations};
    },
    arrayOrigin(array, consumed) {
      if(!isArray(array)||!isArray(consumed)||array!==consumed)throw Error('ORIGIN_IDENTITY');
      return originDisabled?0:weakGet(arrayOrigins,array)??0;
    },
    pin(vm) { if (pending || owner !== null && owner !== vm || earlyOwner !== null && earlyOwner !== vm) throw Error('OWNER_CHANGED'); owner = vm; return true; },
    noteEarly(vm, buffer, input, key, sourceTuple, origin = 0) {
      if(earlyTaken||early.length>=256||earlySeen>=512||earlyOwner!==null&&earlyOwner!==vm||earlyBuffer!==null&&earlyBuffer!==buffer)throw Error('EARLY_OWNER_CHANGED');
      let row,words,source;
      try{
        row=copy(input);const offset=length(buffer,4,65535);
        if(offset+row.length>65535)throw Error('EARLY_OVERFLOW');
        if(!isArray(key)||getProto(key)!==proto)throw Error('EARLY_KEY_SHAPE');
        words=[];for(const index of['1','2']){const d=getOwn(key,index);if(!d||!('value'in d)||typeof d.value!=='number'||!finite(d.value))throw Error('EARLY_KEY');words.push(d.value|0);}
        if(length(sourceTuple,5,5)!==5)throw Error('EARLY_SHAPE');
        source=[];for(let i=0;i<5;i++){const d=getOwn(sourceTuple,String(i));if(!d||!('value'in d)||!integer(d.value)||d.value<0||d.value>(i===0?3:i===3?16777216:65535))throw Error('EARLY_SHAPE');source.push(d.value);}
        if(source[0]===0&&source.slice(1).some(value=>value!==0))throw Error('EARLY_SHAPE');
        if(!integer(origin)||origin<0||origin>7||origin!==0&&(source[0]!==3||source[2]!==3))throw Error('EARLY_SHAPE');
        // Initialization may rewrite/truncate the same buffer. Keep only
        // nonoverlapping candidate rows; the final token independently checks
        // their retained cipher and known input. Dropped rows are not evidence.
        discardEarlyFrom(offset,{row,words});early.push({row,words,offset,source,origin});earlySeen++;earlyOwner=vm;earlyBuffer=buffer;return{accepted:true,...earlySummary()};
      }catch(failure){wipe(row);wipe(words);wipe(source);throw failure;}
    },
    takeEarly(){
      if(earlyTaken||!early.length||owner!==earlyOwner)throw Error('EARLY_STATE');earlyTaken=true;
      const end=length(earlyBuffer,4,65535);
      discardEarlyFrom(end);if(!early.length)throw Error('EARLY_STATE');
      for(const item of early){if(item.offset+item.row.length>end)throw Error('EARLY_RETENTION');const row=[];earlyCipher.push(row);for(let i=0;i<item.row.length;i++){const d=getOwn(earlyBuffer,String(item.offset+i));if(!d||!('value'in d)||!integer(d.value)||d.value<0||d.value>255)throw Error('EARLY_BYTE');row.push(d.value);}}
      return{rows:early.map(item=>item.row),rowOffsets:early.map(item=>item.offset),keyWords:early.map(item=>item.words),cipherRows:earlyCipher,rowSources:early.map(item=>item.source),rowOrigins:early.map(item=>item.origin),summary:earlySummary()};
    },
    releaseEarly(){clearEarly();clearOrigins();return true;},
    begin(vm, buffer, input, key, witness) {
      if (pending || owner !== null && owner !== vm) throw Error('PENDING_OR_OWNER');
      let original, words;
      try {
        original = copy(input); const preLength = length(buffer, 0, 1000000);
        if (witness) {
          if (witnessBuffer !== null && witnessBuffer !== buffer || earlyBuffer !== null && earlyBuffer !== buffer || preLength < witnessEnd || preLength + original.length > 65535 || !isArray(key) || getProto(key) !== proto) throw Error('WITNESS_SHAPE');
          words = [];
          for (const index of ['1', '2']) { const d = getOwn(key, index); if (!d || !('value' in d) || typeof d.value !== 'number' || !finite(d.value)) throw Error('WITNESS_KEY'); words.push(d.value | 0); }
          witnessBuffer = buffer;
        }
        owner = vm; pending = { vm, buffer, input, original, preLength, selected: null, replacement: null, confirmed: false, keyWords: words, witness: witness === true };
        return { valid: true, row: original, ...(witness ? { offset: preLength, keyWords: words } : {}) };
      } catch (failure) { wipe(original); wipe(words); throw failure; }
    },
    replace(values) {
      // values is a fresh by-value protocol argument, never the VM input.
      try {
        if (!pending || pending.replacement) throw Error('NO_PENDING');
        pending.selected = copy(values);
        if (pending.selected.length !== pending.original.length) throw Error('WIDTH');
        pending.replacement = copy(values); return pending.replacement;
      } finally { wipe(values); }
    },
    confirm(vm, buffer, input, capture) {
      if (!pending || pending.vm !== vm || pending.buffer !== buffer || length(buffer, 0, 1000000) !== pending.preLength || !same(pending.input, pending.original)) throw Error('IDENTITY');
      const exact = capture ? input === pending.input && same(input, pending.original) : input === pending.replacement && input !== pending.input && same(input, pending.selected);
      pending.confirmed = exact; return { valid: exact, originalUnchanged: true, destinationUnchanged: true, ownerUnchanged: true };
    },
    commit(vm) {
      const valid = !!pending && pending.confirmed && pending.vm === vm && same(pending.input, pending.original) && (!pending.replacement || same(pending.replacement, pending.selected)) && length(pending.buffer, 0, 1000000) === pending.preLength + pending.original.length;
      try {
        if (valid && pending.witness) {
          if (committedCipher || witnessBuffer !== pending.buffer) throw Error('WITNESS_COMMIT');
          committedCipher = [];
          for (let i = 0; i < pending.original.length; i++) { const d = getOwn(pending.buffer, String(pending.preLength + i)); if (!d || !('value' in d) || !integer(d.value) || d.value < 0 || d.value > 255) throw Error('WITNESS_CIPHER'); committedCipher.push(d.value); }
          witnessEnd = pending.preLength + pending.original.length;
          return { valid, cipherRow: committedCipher };
        }
        return { valid };
      } finally { clearPending(); }
    },
    releaseCommit() { wipe(committedCipher); committedCipher = null; return true; },
    widths(input, buffer) { return { inputLength: length(input, 0, 65535), destinationLength: length(buffer, 1, 65535) }; },
    clear() { clearPending(); clearEarly(); clearOrigins(); wipe(committedCipher); committedCipher = null; owner = null; earlyOwner = earlyBuffer = null; witnessBuffer = null; witnessEnd = 4; return true; },
  };
}
function positions(source) {
  const lines = [0]; for (let i = 0; i < source.length; i++) if (source.charCodeAt(i) === 10) lines.push(i + 1);
  return {
    location(offset, scriptId) { let lo = 0, hi = lines.length; while (lo + 1 < hi) { const mid = (lo + hi) >> 1; if (lines[mid] <= offset) lo = mid; else hi = mid; } return { scriptId, lineNumber: lo, columnNumber: offset - lines[lo] }; },
    offset(loc) { return loc && Number.isInteger(loc.lineNumber) && Number.isInteger(loc.columnNumber) && loc.lineNumber >= 0 && loc.lineNumber < lines.length ? lines[loc.lineNumber] + loc.columnNumber : -1; },
  };
}
function nodeTransport() {
  if (activeNode) throw error('ALREADY_ACTIVE'); const session = new Session(); activeNode = true;
  try { session.connect(); } catch { activeNode = false; throw error('CONNECT_FAILED'); } const listeners = [];
  return { sync: true, on(name, fn) { const wrapped = ({ params }) => fn(params); session.on(name, wrapped); listeners.push([name, wrapped]); },
    send(method, params) { let done = false, failure, result; session.post(method, params, (e, r) => { done = true; failure = e; result = r; }); if (!done || failure) throw protocolFailure(method, false); return result; },
    close() { for (const [name, fn] of listeners) session.off(name, fn); session.disconnect(); activeNode = false; },
  };
}
function protocolFailure(method, timedOut, rejected) {
  const failure=error('PROTOCOL_FAILED');
  failure.protocolOperation=PROTOCOL_OPERATIONS.includes(method)?method.replace('.', '_'):'OTHER';
  failure.protocolTimedOut=timedOut===true;
  // These are only fixed classifications of standard protocol error text,
  // not a recovered cause. Discard the original error and its text here.
  let message=typeof rejected?.message==='string'?rejected.message:'';
  failure.protocolRejectionText=message.includes('Can only perform operation while paused')?'NOT_PAUSED':message.includes('Could not find call frame')||message.includes('Could not find callFrame')?'CALL_FRAME':message.includes('Cannot find context with specified id')?'CONTEXT':message.includes('Could not find object with given id')||message.includes('Invalid remote object id')?'OBJECT':message.includes('Target page, context or browser has been closed')||message.includes('Session closed')?'SESSION':message.includes('Execution was terminated')?'TERMINATED':'OTHER';
  message='';
  return failure;
}
function cdpTransport(cdp) {
  if (!cdp || typeof cdp.send !== 'function' || typeof cdp.on !== 'function' || typeof cdp.off !== 'function') throw error('INVALID_CDP');
  if (activeCDP.has(cdp)) throw error('ALREADY_ACTIVE'); activeCDP.add(cdp); const listeners = [];let lateObserver,timeoutObserver;
  return { sync: false, on(name, fn) { cdp.on(name, fn); listeners.push([name, fn]); },
    setLateObserver(fn){lateObserver=fn;},
    setTimeoutObserver(fn){timeoutObserver=fn;},
    async send(method, params, deadlineMs=2000) { let timer, timedOut=false;
      const request=Promise.resolve().then(() => cdp.send(method, params));
      request.then(()=>{if(timedOut)lateObserver?.(method,false);},()=>{if(timedOut)lateObserver?.(method,true);});
      try { return await Promise.race([request, new Promise((_, reject) => { timer = setTimeout(() => {timedOut=true;timeoutObserver?.();reject(error('PROTOCOL_TIMEOUT'));}, deadlineMs); })]); } catch(rejected) { throw protocolFailure(method, timedOut, rejected); } finally { clearTimeout(timer); } },
    close() { for (const [name, fn] of listeners) cdp.off(name, fn); activeCDP.delete(cdp); },
  };
}
function runSync(iterator, transport) { let op = 'next', value; while (true) { const step = iterator[op](value); if (step.done) return step.value; try { value = transport.send(step.value.method, step.value.params, step.value.deadlineMs); op = 'next'; } catch (e) { value = e; op = 'throw'; } } }
async function runAsync(iterator, transport) { let op = 'next', value; while (true) { const step = iterator[op](value); if (step.done) return step.value; try { value = await transport.send(step.value.method, step.value.params, step.value.deadlineMs); op = 'next'; } catch (e) { value = e; op = 'throw'; } } }
async function createProbe(reference, options, transport) {
  const state = { diagnosticOnly: true, fixture: reference.fixture, captureMode: options.mode === 'capture', selfMode: options.mode === 'self', replaceMode: options.mode === 'replace', independentNodeSuccess: false, sourceSiteOnly: true, exactCalleeIdentityVerified: false, sourceModified: false, extraGlobalsAdded: false, failed: false, sourceVerified: false, sourceMatches: 0, sourceCandidates: 0, sourceMismatches: 0, installedBreakpoints: 0, removedBreakpoints: 0, pauses: 0, instrumentationPauses: 0, entryHits: 0, returnHits: 0, outOfPhaseHits: 0, selectedRows: 0, selectedBytes: 0, committedRows: 0, confirmedRows: 0, mutations: 0, vectorComplete: false, allSelectedAppendsCommitted: false, targetOwnCryptoStatePreserved: false, vectorConsumed: false, transferUsed: false, transferRows: 0, transferRowsConsumed: 0, setVectorCalls: 0, takeVectorCalls: 0, verificationCalls: 0, tokenVerified: false, envelopeComplete: false, sourceFailure: false, mutationFailed: false, commitmentFailed: false, pendingMismatch: false, widthMismatch: false, transferFailure: false, verificationFailed: false, targetLost: false, limitReached: false, durationReached: false, protocolFailed: false, cleanupFailed: false, privateRowsRetained: false, privateCopiesCleared: true, disposed: false, cleanupComplete: false };
  Object.assign(state, { wrapperHits: 0, snapshotWrapperHits: 0, wrapperOwnerPinned: false, bindingChecks: 0, bindingVerified: false, bindingChanges: 0, boundGeneratedDescendant: false, numericCallerVerified: false, callerGeneratedDescendant: false, sourceMappingFailures: 0, sourceAttributionFailures: 0, privateSourcesRequested: 0, privateSourcesIndexed: 0, relocatedEntryHits: 0, relocatedReturnHits: 0, reviewedNonNumericCalls: 0, subsetTransfer: false, selectedTransferRows: 0, appliedTransferRows: 0, transferSelectionVerified: false });
  Object.assign(state, { observeInitPublicEntries: options.observeInitPublicEntries, initPhaseClosed: false, initPublicEntryHits: 0, initTupleChecked: 0, initTupleMatches: 0, initN5Entries: 0, initN5InputBytes: 0, initFxEntries: 0, initFxInputBytes: 0, initUnknownTupleCallers: 0, initInvalidWidths: 0, initClassificationFailures: 0, initEntryInputsOnly: true, initOutputCommitmentObserved: false });
  Object.assign(state, { observeCipherWitness: options.observeCipherWitness, cipherWitnessComplete: false, cipherWitnessRows: 0, cipherWitnessBytes: 0, cipherWitnessOffsetsMonotone: false, cipherWitnessDestinationStable: false, initTaggedPublicEntries: 0, initTaggedTupleChecked: 0, initTagged143Entries: 0, initTagged143InputBytes: 0, initTagged143FirstLength: 0, initTagged143LastLength: 0, initTagged143Failures: 0 });
  Object.assign(state, { earlySourceCandidates: 0, earlySourceBytes: 0, earlyGeneratedBindings: 0, earlyDiscoveryUnavailable: false, earlyGeneratedEntryHits: 0, earlyGenerated143Entries: 0, earlyGenerated143InputBytes: 0, earlyGenerated143TagBytes: 0, earlyGenerated143Tag12Entries: 0, earlyGenerated143FirstLength: 0, earlyGenerated143EndLength: 0, earlyGenerated143Failures: 0 });
  const group = 'numeric-vector-' + randomUUID(), pauseGroup = group + '-pause';
  const helpers = new Map(), metadata = new Map(), checked = new Set(), breakpoints = new Map(), sourceIndexes = new Map();
  let captured = [], incoming = null, pending = null, phase = 'init', snapshotStarted = false, queue = Promise.resolve(), accepting = true, cleanupStarted = false, runtimeEnabled = false, debuggerEnabled = false, instrumentationId = null, armed = false, timer, selectedContext = null;
  let boundTarget = null, selectedCaller = null, privateSourceBytes = 0;
  const capturedOffsets = [], capturedKeys = [], capturedCipher = [];
  let earlyContext = null, earlyBoundSite = null, earlyEkSite = null;
  const earlySetters = new Set(), originChecked = new Set(), setterCopies = new Map();
  let initialPacket = null;
  Object.assign(state,{initialCipherCaptureComplete:false,initialCipherRows:0,initialCipherBytes:0,takeInitialVectorCalls:0});
  Object.assign(state,{earlyGenerated143OkEntries:0,earlyGenerated143EkEntries:0,earlyGenerated143OkInputBytes:0,earlyGenerated143EkInputBytes:0,earlyZeroWidthInputs:0});
  Object.assign(state,{initialDiscardedRows:0,initialDiscardedBytes:0,initialRepeatedSamples:0,initialOverlapEvents:0});
  for(const name of ['source','destination','context','frame','tag','width','private-capture','counters'])state['earlyFailureStage_'+name]=0;
  for(const name of ['ARRAY','LENGTH','BYTE','EARLY_OWNER_CHANGED','EARLY_SHAPE','EARLY_OVERFLOW','EARLY_OVERLAP','EARLY_KEY_SHAPE','EARLY_KEY','UNCLASSIFIED'])state['earlyHelperFailure_'+name]=0;
  Object.assign(state,{earlySnapshotContextMatched:false,earlySnapshotBindingMatched:false,snapshotAppenderScriptUnits:0});
  Object.assign(state,{initialSourceKnown:0,initialSourceUnknown:0,initialSourceQueued:0,initialSourceNoDispatcher:0,initialSourceFailures:0});
  Object.assign(state,{scriptMetadataEntries:0,scriptMetadataLimit:options.observeCipherWitness?8192:4096,scriptConditionMetadataSkipped:0});
  Object.assign(state,{arrayOriginCoverageComplete:false,arrayOriginPublicAndFirstGeneratedSettersOnly:false,arrayOriginWatchThroughInit:true,arrayOriginCandidates:0,arrayOriginSourceBytes:0,arrayOriginGeneratedBindings:0,arrayOriginGeneratedSites:0,arrayOriginBindingLimitReached:false,arrayOriginDiscoveryUnavailable:false,arrayOriginEntryHits:0,arrayOriginNonArrays:0,arrayOriginArrays:0,arrayOriginRepeated:0,arrayOriginObjects:0,arrayOriginFailures:0,arrayOriginLimitReached:false,arrayOriginQueries:0,arrayOriginMatches:0,arrayOriginQueryFailures:0,arrayOriginAllocationProven:false,arrayOriginContentsUnchangedProven:false});
  Object.assign(state,{arrayOriginCallerCandidates:0,arrayOriginCallerBytes:0,arrayOriginCallerLimitReached:false});
  for(const stage of ['header','value','helper','record'])state['arrayOriginFailure_'+stage]=0;
  Object.assign(state,{privateSourceBudgetRejected:0,privateSourceLimit:options.observeCipherWitness?MAX_PRIVATE_SOURCES:8,arrayOriginProtocolFailures:0,arrayOriginHelperExceptions:0});
  for(const code of ['SOURCE_LIMIT','FUNCTION_MAPPING','FRAME_VALUE','BINDING_TYPE','BINDING_LOCATION','BINDING_CONTEXT','WRAPPER_OWNER','WRAPPER_CONTEXT','HELPER_FAILED','EARLY_CAPTURE_INCOMPLETE','PROTOCOL_FAILED','OTHER'])state['pauseFailure_'+code]=0;
  Object.assign(state,{protocolTimeouts:0,protocolRejections:0,protocolOutstandingTimeouts:0,protocolUnsettledAtCleanup:false});
  for(const method of [...PROTOCOL_OPERATIONS,'OTHER'])for(const prefix of ['protocolFailure_','protocolTimeout_','protocolRejection_','protocolLateResponse_','protocolLateRejection_'])state[prefix+method.replace('.', '_')]=0;
  for(const kind of PROTOCOL_REJECTION_TEXT)state['protocolRejectionText_'+kind]=0;
  for(const stage of ['close','binding-value','binding-properties','binding-map','binding-install','owner-value','owner-pin','initial-capture'])state['wrapperFailure_'+stage]=0;
  // Fixed operation counters only: no protocol error text, IDs, arguments,
  // source locations, or private values are retained in this diagnostic.
  const send=transport.send.bind(transport);
  function noteProtocolFailure(failure){
    if(failure?.code!=='PROTOCOL_FAILED')return;
    const key='protocolFailure_'+failure.protocolOperation;
    state[Object.hasOwn(state,key)?key:'protocolFailure_OTHER']++;
    state[failure.protocolTimedOut?'protocolTimeouts':'protocolRejections']++;
    state[(failure.protocolTimedOut?'protocolTimeout_':'protocolRejection_')+(Object.hasOwn(state,key)?failure.protocolOperation:'OTHER')]++;
    if(!failure.protocolTimedOut)state['protocolRejectionText_'+(PROTOCOL_REJECTION_TEXT.includes(failure.protocolRejectionText)?failure.protocolRejectionText:'OTHER')]++;
  }
  transport.setTimeoutObserver?.(()=>{state.protocolOutstandingTimeouts++;});
  transport.setLateObserver?.((method,rejected)=>{const operation=PROTOCOL_OPERATIONS.includes(method)?method.replace('.', '_'):'OTHER';state[(rejected?'protocolLateRejection_':'protocolLateResponse_')+operation]++;state.protocolOutstandingTimeouts--;});
  transport.send=transport.sync?function(method,params,deadlineMs){try{return send(method,params,deadlineMs);}catch(failure){noteProtocolFailure(failure);throw failure;}}:async function(method,params,deadlineMs){try{return await send(method,params,deadlineMs);}catch(failure){noteProtocolFailure(failure);throw failure;}};
  function clearWitness() { capturedOffsets.fill(0); capturedOffsets.length = 0; wipeRows(capturedKeys); wipeRows(capturedCipher); }
  const command = (method, params = {}, deadlineMs) => ({ method, params, deadlineMs });
  function fail(field) { state.failed = true; state[field] = true; accepting = false; }
  function dispatch(iterator) { if (transport.sync) { try { return runSync(iterator, transport); } catch { fail('protocolFailed'); return undefined; } } const operation = queue.then(() => runAsync(iterator, transport)); queue = operation.catch(() => { fail('protocolFailed'); }); return operation; }
  function* helper(contextId) {
    if (helpers.has(contextId)) return helpers.get(contextId);
    if (!Number.isInteger(contextId) || helpers.size >= (reference.fixture ? 128 : 32)) throw error('CONTEXT_LIMIT');
    const result = yield command('Runtime.evaluate', { contextId, expression: '(' + makePrivateHelper.toString() + ')()', objectGroup: group, returnByValue: false, generatePreview: false, silent: true, disableBreaks: true, userGesture: false });
    if (result.exceptionDetails || !result.result?.objectId) throw error('HELPER_FAILED'); helpers.set(contextId, result.result.objectId); return result.result.objectId;
  }
  function* callHelper(contextId, method, args = [], byValue = true, objectGroup = pauseGroup) {
    const objectId = helpers.get(contextId); if (!objectId) throw error('HELPER_LOST');
    const methods = { pin: 'function(vm){return this.pin(vm)}', begin: 'function(vm,w,c,key,witness){return this.begin(vm,w,c,key,witness)}', replace: 'function(values){return this.replace(values)}', confirm: 'function(vm,w,c,capture){return this.confirm(vm,w,c,capture)}', commit: 'function(vm){return this.commit(vm)}', releaseCommit: 'function(){return this.releaseCommit()}', widths: 'function(c,w){return this.widths(c,w)}', clear: 'function(){return this.clear()}' };
    if(method==='noteEarly')methods.noteEarly='function(vm,w,c,key,source,origin){try{return this.noteEarly(vm,w,c,key,source,origin)}catch(e){const codes=["ARRAY","LENGTH","BYTE","EARLY_OWNER_CHANGED","EARLY_SHAPE","EARLY_OVERFLOW","EARLY_OVERLAP","EARLY_KEY_SHAPE","EARLY_KEY"];return{accepted:false,code:codes.includes(e.message)?e.message:"UNCLASSIFIED"}}}';
    if(method==='noteArray')methods.noteArray='function(array,origin){return this.noteArray(array,origin)}';
    if(method==='arrayOrigin')methods.arrayOrigin='function(array,consumed){return this.arrayOrigin(array,consumed)}';
    if(method==='takeEarly')methods.takeEarly='function(){return this.takeEarly()}';
    if(method==='releaseEarly')methods.releaseEarly='function(){return this.releaseEarly()}';
    const result = yield command('Runtime.callFunctionOn', { objectId, functionDeclaration: methods[method], arguments: args, objectGroup, returnByValue: byValue, generatePreview: false, silent: true, userGesture: false });
    if (result.exceptionDetails || !result.result) throw error('HELPER_FAILED'); return result.result;
  }
  function* evaluate(frame, expression, byValue = false, objectGroup = pauseGroup, firstWitnessBinding = false) {
    const extended=firstWitnessBinding&&options.observeCipherWitness&&!transport.sync;
    const result = yield command('Debugger.evaluateOnCallFrame', { callFrameId: frame.callFrameId, expression, objectGroup, returnByValue: byValue, generatePreview: false, silent: true, throwOnSideEffect: true, ...(extended?{timeout:6000}:{}) }, extended?8000:undefined);
    if (result.exceptionDetails || !result.result) throw error('FRAME_VALUE'); return result.result;
  }
  function* valuesAt(frame, witness = options.observeCipherWitness, ek = false) {
    const wrapper = yield* evaluate(frame, ek ? witness ? '({m:R,W:E,c,E:h})' : '({m:R,W:E,c})' : witness ? '({m,W,c,E})' : '({m,W,c})'); if (!wrapper.objectId) throw error('FRAME_VALUE');
    const result = yield command('Runtime.getProperties', { objectId: wrapper.objectId, ownProperties: true, accessorPropertiesOnly: false, generatePreview: false });
    const descriptors = result.result || [], picked = {};
    for (const name of ['m', 'W', 'c', ...(witness ? ['E'] : [])]) { const d = descriptors.find(d => d.name === name); if (!d || d.get || d.set || !d.value?.objectId) throw error('FRAME_DESCRIPTOR'); picked[name] = d.value; }
    if (picked.m.type !== 'object' || picked.m.subtype === 'proxy' || picked.W.subtype !== 'array' || picked.c.subtype !== 'array' || witness && picked.E.subtype !== 'array') throw error('FRAME_KIND');
    return picked;
  }
  function inHeader(frame, definition) {
    const loc = frame?.functionLocation;
    return loc?.scriptId === definition.scriptId && definition.mapped.offset(loc) === definition.fn.functionOffset;
  }
  function stackShape(frames) {
    if (!Array.isArray(frames) || frames.length < 1 || frames.length > 256) throw error('STACK_LIMIT');
    return frames.map((frame, i) => {
      const f = frame.functionLocation, l = frame.location;
      if (!l || !Number.isInteger(l.lineNumber) || !Number.isInteger(l.columnNumber)) throw error('STACK_LOCATION');
      return [f?.scriptId ?? null, f?.lineNumber ?? null, f?.columnNumber ?? null, ...(i ? [l.scriptId, l.lineNumber, l.columnNumber] : [])];
    });
  }
  function equalStack(left, right) { return left.length === right.length && left.every((row, i) => row.length === right[i].length && row.every((value, j) => value === right[i][j])); }
  function descendant(scriptId) {
    const seen = new Set(), todo = [[scriptId, 0]];
    while (todo.length) { const [id, depth] = todo.pop(); if (seen.has(id) || depth > 8) continue; seen.add(id); const meta = metadata.get(id); if (meta?.known) return true; for (const parent of meta?.parents || []) todo.push([parent, depth + 1]); }
    return false;
  }
  function definitionFor(index, scriptId, fn) { return { scriptId, contextId: metadata.get(scriptId)?.executionContextId, mapped: index.mapped, fn, generated: index.generated }; }
  function* relocatedIndex(scriptId) {
    if (sourceIndexes.has(scriptId)) return sourceIndexes.get(scriptId);
    if (!descendant(scriptId)) { state.sourceAttributionFailures++; throw error('UNATTRIBUTED_SOURCE'); }
    const meta = metadata.get(scriptId);
    if(state.privateSourcesRequested>=state.privateSourceLimit){state.privateSourceBudgetRejected++;throw error('SOURCE_LIMIT');}
    if (!Number.isInteger(meta?.length) || meta.length < 1 || meta.length > MAX_SOURCE_UNITS) throw error('SOURCE_LIMIT');
    state.privateSourcesRequested++; let source = '';
    try {
      source = (yield command('Debugger.getScriptSource', { scriptId })).scriptSource;
      if (typeof source !== 'string' || source.length !== meta.length || (privateSourceBytes += Buffer.byteLength(source, 'utf8')) > MAX_SOURCE_BYTES) throw error('SOURCE_LIMIT');
      const index = indexRelocatedSource(source, reference); index.generated = true; sourceIndexes.set(scriptId, index); state.privateSourcesIndexed++; return index;
    } finally { source = ''; }
  }
  function* mapFunction(location, name) {
    if (!location || typeof location.scriptId !== 'string' || !Number.isInteger(location.lineNumber) || !Number.isInteger(location.columnNumber)) throw error('FUNCTION_LOCATION');
    const index = yield* relocatedIndex(location.scriptId), fn = index.functions.get(index.mapped.offset(location));
    if (!fn || !(Array.isArray(name) ? name.includes(fn.name) : fn.name === name) || !fn.header) { state.sourceMappingFailures++; throw error('FUNCTION_MAPPING'); }
    return definitionFor(index, location.scriptId, fn);
  }
  function siteRange(definition, site) {
    const { fn } = definition, original = reference.definitions[fn.name], delta = fn.body - original.body;
    if (site === 'wrapper') return [fn.wrapperFrom, fn.wrapperTo];
    if (site === 'array') return [reference[fn.name+'EntryStart']+delta,reference[fn.name+'EntryEnd']+delta];
    if (fn.name === 'ek' && site === 'entry') return [reference.ekEntryStart + delta, reference.ekEntryEnd + delta];
    return site === 'entry' ? [reference.entryStart + delta, reference.entryEnd + delta] : [reference.returnStart + delta, reference.returnEnd + delta];
  }
  function* installSite(definition, site) {
    for (const installed of breakpoints.values()) if (installed.scriptId === definition.scriptId && installed.fn.functionOffset === definition.fn.functionOffset && installed.site === site) return installed;
    if (breakpoints.size >= (options.observeCipherWitness ? 40 : 8)) throw error('BREAKPOINT_LIMIT');
    const [from, to] = siteRange(definition, site), { mapped, scriptId } = definition;
    const candidates = (yield command('Debugger.getPossibleBreakpoints', { start: mapped.location(from, scriptId), end: mapped.location(to, scriptId), restrictToFunction: true })).locations || [];
    const location = candidates.filter(l => l.scriptId === scriptId && mapped.offset(l) >= from && mapped.offset(l) < to && (site === 'return' ? l.type === 'return' : l.type !== 'return')).sort((a, b) => mapped.offset(a) - mapped.offset(b))[0];
    if (!location) throw error('BREAKPOINT_UNAVAILABLE');
    const result = yield command('Debugger.setBreakpoint', { location, ...(site === 'array' ? {condition:ARRAY_CONDITION} : {}) });
    if (typeof result.breakpointId !== 'string') throw error('BREAKPOINT_FAILED');
    const installed = { ...definition, site, offset: mapped.offset(location) };
    breakpoints.set(result.breakpointId, installed); state.installedBreakpoints++;
    if (result.actualLocation?.scriptId !== scriptId || mapped.offset(result.actualLocation) !== installed.offset) throw error('BREAKPOINT_MOVED');
    return installed;
  }
  function* inspectScript(params) {
    if(accepting&&options.observeCipherWitness&&phase==='init'&&state.sourceVerified&&!state.arrayOriginDiscoveryUnavailable&&!originChecked.has(params.scriptId)&&descendant(params.scriptId)){
      const missing=SETTERS.filter(name=>reference.definitions[name]&&(setterCopies.get(name)||0)<8);
      const widths=missing.map(name=>reference.definitions[name].end-reference.definitions[name].start);
      if(widths.length&&Number.isInteger(params.length)&&params.length>=Math.min(...widths)&&params.length<=Math.max(...widths)+64){
        originChecked.add(params.scriptId);
        if(++state.arrayOriginCandidates>128)state.arrayOriginDiscoveryUnavailable=true;
        else{
          let source='';
          try{
            source=(yield command('Debugger.getScriptSource',{scriptId:params.scriptId})).scriptSource;
            if(typeof source!=='string'||source.length!==params.length||(state.arrayOriginSourceBytes+=Buffer.byteLength(source,'utf8'))>65536)throw error('ORIGIN_SOURCE_LIMIT');
            const index=indexRelocatedSource(source,reference),found=[...index.functions.values()].filter(fn=>fn&&missing.includes(fn.name)&&fn.header);
            if(found.length===1){
              index.generated=true;sourceIndexes.set(params.scriptId,index);
              yield* installSite(definitionFor(index,params.scriptId,found[0]),'array');
              const name=found[0].name,count=(setterCopies.get(name)||0)+1;
              setterCopies.set(name,count);earlySetters.add(name);state.arrayOriginGeneratedBindings=earlySetters.size;state.arrayOriginGeneratedSites++;
              if(count===8)state.arrayOriginBindingLimitReached=true;
            }
          }catch{state.arrayOriginDiscoveryUnavailable=true;}
          finally{source='';}
        }
      }
    }
    if (accepting && options.observeCipherWitness && phase === 'init' && state.sourceVerified && (!earlyBoundSite || reference.definitions.ek && !earlyEkSite) && !state.earlyDiscoveryUnavailable && !checked.has(params.scriptId) && descendant(params.scriptId)) {
      const widths = [reference.okEnd-reference.okStart,...(reference.definitions.ek?[reference.ekEnd-reference.ekStart]:[])], minWidth=Math.min(...widths), maxWidth=Math.max(...widths);
      if (Number.isInteger(params.length) && params.length >= minWidth && params.length <= maxWidth + 64) {
        checked.add(params.scriptId);
        if (++state.earlySourceCandidates > 32) state.earlyDiscoveryUnavailable = true;
        else {
          let source = '';
          try {
            source = (yield command('Debugger.getScriptSource', {scriptId:params.scriptId})).scriptSource;
            if (typeof source !== 'string' || source.length !== params.length || (state.earlySourceBytes += Buffer.byteLength(source,'utf8')) > 65536) throw error('EARLY_SOURCE_LIMIT');
            const index = indexRelocatedSource(source,reference), found = [...index.functions.values()].filter(fn=>fn&&['ok','ek'].includes(fn.name)&&fn.header);
            if (found.length === 1) {
              index.generated=true;sourceIndexes.set(params.scriptId,index);
              const site=yield* installSite(definitionFor(index,params.scriptId,found[0]),'entry');if(found[0].name==='ok')earlyBoundSite=site;else earlyEkSite=site;state.earlyGeneratedBindings=(earlyBoundSite?1:0)+(earlyEkSite?1:0);
            }
          } catch { state.earlyDiscoveryUnavailable=true; }
          finally { source=''; }
        }
      }
    }
    if(instrumentationId&&earlyBoundSite&&(!reference.definitions.ek||earlyEkSite)&&!SETTERS.some(name=>reference.definitions[name])){yield command('Debugger.removeBreakpoint',{breakpointId:instrumentationId});instrumentationId=null;}
    if (!accepting || checked.has(params.scriptId) || !Number.isInteger(params.length) || params.length < reference.length || params.length > reference.length + reference.maxPrefix) return;
    // Authored fixtures share one Node inspector process, whose old scripts
    // remain enumerable. Production keeps its original 32-candidate bound.
    checked.add(params.scriptId); if (++state.sourceCandidates > (reference.fixture ? 256 : 32)) { fail('limitReached'); return; }
    const source = (yield command('Debugger.getScriptSource', { scriptId: params.scriptId })).scriptSource;
    if (reference.outerHash && typeof source === 'string' && source.length === reference.outerLength && hash(source) === reference.outerHash) { metadata.get(params.scriptId).known = true; return; }
    const prefix = typeof source === 'string' ? source.length - reference.length : -1;
    if (prefix < 0 || prefix > reference.maxPrefix || !/^\n*$/.test(source.slice(0, prefix)) || hash(source.slice(prefix)) !== reference.hash) { state.sourceMismatches++; return; }
    if (state.sourceMatches || hash(source.slice(prefix + reference.okStart, prefix + reference.okEnd)) !== reference.okHash || hash(source.slice(prefix + reference.n5Start, prefix + reference.n5End)) !== reference.n5Hash) { fail('sourceFailure'); return; }
    const mapped = positions(source), index = { mapped, generated: false, functions: new Map() };
    for (const original of Object.values(reference.definitions)) {
      const fn = { name: original.name, header: true };
      for (const key of ['start', 'body', 'end', 'functionOffset', 'wrapperFrom', 'wrapperTo']) if (Number.isInteger(original[key])) fn[key] = prefix + original[key];
      index.functions.set(fn.functionOffset, fn);
    }
    sourceIndexes.set(params.scriptId, index); metadata.get(params.scriptId).known = true;
    for (const [name, site] of [['ok', 'entry'], ['n5', 'return'], ...(reference.definitions.wrapper ? [['wrapper', 'wrapper']] : [])]) {
      const fn = [...index.functions.values()].find(fn => fn.name === name);
      yield* installSite(definitionFor(index, params.scriptId, fn), site);
    }
    if(options.observeCipherWitness)for(const name of SETTERS){const fn=[...index.functions.values()].find(fn=>fn.name===name);if(fn)yield* installSite(definitionFor(index,params.scriptId,fn),'array');}
    state.sourceMatches++; state.sourceVerified = true;
    if (instrumentationId && !options.observeCipherWitness) { yield command('Debugger.removeBreakpoint', { breakpointId: instrumentationId }); instrumentationId = null; }
  }
  function* closeArrayDiscovery(){
    if(instrumentationId){yield command('Debugger.removeBreakpoint',{breakpointId:instrumentationId});instrumentationId=null;}
    for(const [id,site]of breakpoints)if(site.site==='array'){yield command('Debugger.removeBreakpoint',{breakpointId:id});breakpoints.delete(id);state.removedBreakpoints++;}
  }
  function* wrapper(params, definition) {
    let failureStage='close';
    try {
    if(phase!=='init')yield* closeArrayDiscovery();
    state.wrapperHits++; if (phase !== 'snapshot') { state.outOfPhaseHits++; return; } state.snapshotWrapperHits++;
    if (state.snapshotWrapperHits > 8 || pending || state.tokenVerified) throw error('WRAPPER_REENTRY');
    const frame = params.callFrames?.[0]; if (!inHeader(frame, definition)) throw error('WRAPPER_HEADER');
    // Retain the function object in the private group to reject binding changes.
    failureStage='binding-value';
    const value = yield* evaluate(frame, 'Ok', false, boundTarget ? pauseGroup : group, !boundTarget);
    if (value.type !== 'function' || value.subtype === 'proxy' || !value.objectId) throw error('BINDING_TYPE');
    if (boundTarget) { yield* sameBinding(value); }
    else {
    failureStage='binding-properties';
    const properties = yield command('Runtime.getProperties', { objectId: value.objectId, ownProperties: true, generatePreview: false });
    if (properties.exceptionDetails) throw error('BINDING_LOCATION');
    const location = properties.internalProperties?.find(p => p.name === '[[FunctionLocation]]')?.value?.value;
    failureStage='binding-map';
    const target = yield* mapFunction(location, 'ok');
    state.snapshotAppenderScriptUnits=metadata.get(location.scriptId)?.length||0;
    if (target.contextId !== definition.contextId) throw error('BINDING_CONTEXT');
    boundTarget = { ...target, objectId: value.objectId };
    failureStage='binding-install';
    yield* installSite(target, 'entry'); state.bindingVerified = true; state.boundGeneratedDescendant = target.generated;
    state.bindingChecks++;
    }
    failureStage='owner-value';
    const owner = yield* evaluate(frame, reference.fixture ? 'vm' : 'R');
    if (owner.type !== 'object' || owner.subtype === 'proxy' || !owner.objectId) throw error('WRAPPER_OWNER');
    if (selectedContext !== null && selectedContext !== definition.contextId) throw error('WRAPPER_CONTEXT'); selectedContext = definition.contextId;
    failureStage='owner-pin';
    yield* helper(selectedContext);
    if ((yield* callHelper(selectedContext, 'pin', [{ objectId: owner.objectId }])).value !== true) throw error('WRAPPER_OWNER');
    state.wrapperOwnerPinned = true;
    state.earlySnapshotContextMatched=earlyContext!==null&&earlyContext===selectedContext;
    state.earlySnapshotBindingMatched=!!earlyBoundSite&&earlyBoundSite.scriptId===boundTarget.scriptId&&earlyBoundSite.fn.functionOffset===boundTarget.fn.functionOffset;
    failureStage='initial-capture';
    if(options.observeCipherWitness&&state.earlyGenerated143Entries&&!state.initialCipherCaptureComplete){
      if(!state.earlySnapshotContextMatched||!state.earlySnapshotBindingMatched||state.earlyGenerated143Failures||state.earlyGenerated143TagBytes||state.earlyDiscoveryUnavailable||state.earlyGeneratedBindings!==(reference.definitions.ek?2:1))throw error('EARLY_CAPTURE_INCOMPLETE');
      const captured=(yield* callHelper(selectedContext,'takeEarly')).value;
      let packet;
      try{
        const {summary,...fields}=captured;
        packet={schemaVersion:6,sourcePin:SOURCE,route:INITIAL_ORIGIN_ROUTE,...fields};
        for(const [name,key] of [['initialDiscardedRows','discardedRows'],['initialDiscardedBytes','discardedBytes'],['initialRepeatedSamples','repeatedSamples'],['initialOverlapEvents','overlapEvents']]){if(!Number.isSafeInteger(summary?.[key])||summary[key]<0||summary[key]>65536)throw error('EARLY_CAPTURE_INCOMPLETE');state[name]=summary[key];}
        initialPacket=copyNumericVectorPacket(packet);
        if(initialPacket.rows.length!==state.earlyGenerated143Entries-state.initialDiscardedRows)throw error('EARLY_CAPTURE_INCOMPLETE');
        if((yield* callHelper(selectedContext,'releaseEarly')).value!==true)throw error('EARLY_RELEASE');
        state.initialCipherCaptureComplete=true;state.initialCipherRows=initialPacket.rows.length;state.initialCipherBytes=initialPacket.rows.reduce((n,row)=>n+row.length,0);state.privateCopiesCleared=false;state.privateRowsRetained=true;
      }finally{if(packet)clearNumericVectorPacket(packet);}
    }
    }catch(failure){state['wrapperFailure_'+failureStage]++;throw failure;}
  }
  function* sameBinding(value) {
    state.bindingChecks++;
    if (value.type !== 'function' || value.subtype === 'proxy' || !value.objectId) throw error('BINDING_TYPE');
    const result = yield command('Runtime.callFunctionOn', { objectId: boundTarget.objectId, functionDeclaration: 'function(other){return this===other}', arguments: [{ objectId: value.objectId }], returnByValue: true, generatePreview: false, silent: true });
    if (result.exceptionDetails || result.result?.value !== true) { state.bindingChanges++; throw error('BINDING_CHANGED'); }
  }
  function* initialPublicEntry(params, definition) {
    state.initPublicEntryHits++;
    try {
      const frame = params.callFrames?.[0], caller = params.callFrames?.[1];
      if (state.initPhaseClosed || !state.sourceVerified || definition.generated || !inHeader(frame, definition)) throw error('INIT_PUBLIC_SITE');
      const tuple = yield* evaluate(frame, 'R===143&&a===undefined', true);
      if (tuple.type !== 'boolean' || typeof tuple.value !== 'boolean') throw error('INIT_TUPLE');
      state.initTupleChecked++;
      if (!tuple.value) return;
      state.initTupleMatches++;
      // Lookup only: this diagnostic never expands generated-source coverage.
      const location = caller?.functionLocation, index = sourceIndexes.get(location?.scriptId);
      const fn = index && !index.generated ? index.functions.get(index.mapped.offset(location)) : undefined;
      const contextId = metadata.get(location?.scriptId)?.executionContextId;
      if (!fn?.header || !['n5', 'fx'].includes(fn.name) || !Number.isInteger(contextId) || contextId !== definition.contextId) { state.initUnknownTupleCallers++; return; }
      const delta = fn.body - reference.definitions[fn.name].body;
      const from = (fn.name === 'n5' ? reference.callStart : reference.fxCallStart) + delta;
      const to = (fn.name === 'n5' ? reference.callEnd : reference.fxCallEnd) + delta;
      const offset = index.mapped.offset(caller.location);
      if (caller.location?.scriptId !== location.scriptId || offset < from || offset >= to) { state.initUnknownTupleCallers++; return; }
      const count = fn.name === 'n5' ? 'initN5Entries' : 'initFxEntries', bytes = fn.name === 'n5' ? 'initN5InputBytes' : 'initFxInputBytes';
      state[count]++;
      if (state.initTupleMatches > MAX_ROWS) throw error('INIT_COUNT_LIMIT');
      // c remains local and is never enumerated or transferred by value. A
      // non-proxy array's length is a data property, read without a callback.
      const input = yield* evaluate(frame, 'c');
      if (input.type !== 'object' || input.subtype !== 'array' || !input.objectId) { state.initInvalidWidths++; return; }
      const width = yield* evaluate(frame, 'c.length', true);
      if (width.type !== 'number' || !Number.isInteger(width.value) || width.value < 0 || width.value > MAX_WIDTH) { state.initInvalidWidths++; return; }
      if (state.initN5InputBytes + state.initFxInputBytes + width.value > MAX_BYTES) throw error('INIT_BYTE_LIMIT');
      state[bytes] += width.value;
    } catch {
      // Observation failures invalidate these counters only. Snapshot vector
      // state and its existing verification/commitment rules stay untouched.
      state.initClassificationFailures++;
    }
  }
  function* taggedPublicEntry(params, definition) {
    state.initTaggedPublicEntries++;
    try {
      const frame = params.callFrames?.[0];
      if (state.initPhaseClosed || definition.generated || !state.sourceVerified || !inHeader(frame, definition)) throw error('INIT_PUBLIC_SITE');
      const tuple = yield* evaluate(frame, 'R===143&&a===12', true);
      if (tuple.type !== 'boolean') throw error('INIT_TUPLE');
      state.initTaggedTupleChecked++; if (!tuple.value) return;
      const values = yield* valuesAt(frame, false); yield* helper(definition.contextId);
      const widths = (yield* callHelper(definition.contextId, 'widths', [{ objectId: values.c.objectId }, { objectId: values.W.objectId }])).value;
      if (!Number.isInteger(widths?.inputLength) || !Number.isInteger(widths?.destinationLength) || state.initTagged143InputBytes + widths.inputLength > 65535) throw error('INIT_WIDTH');
      state.initTagged143Entries++; state.initTagged143InputBytes += widths.inputLength;
      if (state.initTagged143Entries === 1) state.initTagged143FirstLength = widths.destinationLength;
      state.initTagged143LastLength = widths.destinationLength;
    } catch { state.initTagged143Failures++; }
  }
  function* earlySource(params,definition,values,width){
    const unknown=()=>[0,0,0,0,0];
    try{
      const caller=params.callFrames?.[1],callee=yield* mapFunction(caller?.functionLocation,['n5','fx']);
      const name=callee.fn.name,delta=callee.fn.body-reference.definitions[name].body,ek=definition.fn.name==='ek';
      if(callee.contextId!==definition.contextId||ek&&name!=='fx')return unknown();
      const from=name==='n5'?reference.callStart:ek?reference.fxEkCallStart:reference.fxCallStart;
      const to=name==='n5'?reference.callEnd:ek?reference.fxEkCallEnd:reference.fxCallEnd;
      const position=callee.mapped.offset(caller.location);
      if(!Number.isInteger(from)||caller.location?.scriptId!==callee.scriptId||position<from+delta||position>=to+delta)return unknown();
      if((yield* evaluate(caller,name==='n5'?'a===143':'t===143',true)).value!==true)return unknown();
      const source=(yield* evaluate(caller,name==='n5'?'c':'h',true)).value;
      const mode=(yield* evaluate(caller,'R',true)).value;
      if(!Number.isSafeInteger(source)||source<0||source>65535||!Number.isSafeInteger(mode)||mode<0||mode>65535||name==='n5'&&mode!==width)return unknown();
      if(name==='fx'&&!ek&&width!==2)return unknown();
      // Only reviewed dispatcher bodies are read. No VM lookup or operand
      // reader is replayed; queued dispatch has no usable instruction cursor.
      const handlerFrame=params.callFrames?.[2],dispatch=params.callFrames?.[3];
      // The complete immediate chain must be appender -> serializer -> known
      // bound instruction -> HB. Never skip arbitrary intervening calls.
      const handler=yield* mapFunction(handlerFrame?.functionLocation,name==='n5'?['s1','s4']:['f3','f4']);
      const originalHandler=reference.definitions[handler.fn.name],handlerDelta=handler.fn.body-originalHandler.body;
      const handlerOffset=handler.mapped.offset(handlerFrame.location);
      if(handler.contextId!==definition.contextId||handlerFrame.location?.scriptId!==handler.scriptId||handlerOffset<originalHandler.callFrom+handlerDelta||handlerOffset>=originalHandler.callTo+handlerDelta)return unknown();
      const dispatcher=yield* mapFunction(dispatch?.functionLocation,'hb');
      if(!dispatcher){state.initialSourceNoDispatcher++;return unknown();}
      const offset=dispatcher.mapped.offset(dispatch.location),shift=dispatcher.fn.body-reference.definitions.hb.body;
      if(dispatcher.contextId!==definition.contextId||dispatch.location?.scriptId!==dispatcher.scriptId||offset<reference.hbCallStart+shift||offset>=reference.hbCallEnd+shift)return unknown();
      const opcode=(yield* evaluate(dispatch,'h',true)).value;
      if(opcode===undefined){state.initialSourceQueued++;return unknown();}
      const pc=(yield* evaluate(dispatch,'t',true)).value,limit=(yield* evaluate(dispatch,'W',true)).value;
      if(!Number.isSafeInteger(opcode)||opcode<0||opcode>65535||!Number.isSafeInteger(pc)||pc<0||!Number.isSafeInteger(limit)||limit>16777216||pc>=limit)return unknown();
      const owner=yield* evaluate(dispatch,'c');
      if(!owner.objectId||owner.subtype==='proxy')return unknown();
      const same=yield command('Runtime.callFunctionOn',{objectId:values.m.objectId,functionDeclaration:'function(other){return this===other}',arguments:[{objectId:owner.objectId}],returnByValue:true,silent:true,generatePreview:false});
      if(same.exceptionDetails||same.result?.value!==true)return unknown();
      return[name==='n5'?1:ek?3:2,source,mode,pc,opcode];
    }catch{state.initialSourceFailures++;return unknown();}
  }
  function* mapOriginProducer(location){
    if(!location||!descendant(location.scriptId))throw error('ORIGIN_CALLER');
    if(!sourceIndexes.has(location.scriptId)){
      const meta=metadata.get(location.scriptId),widths=PRODUCERS.filter(name=>reference.definitions[name]).map(name=>reference.definitions[name].end-reference.definitions[name].start);
      if(!widths.some(width=>Number.isInteger(meta?.length)&&meta.length>=width&&meta.length<=width+64))throw error('ORIGIN_CALLER');
      if(state.arrayOriginCallerCandidates>=64){state.arrayOriginCallerLimitReached=true;throw error('ORIGIN_CALLER_LIMIT');}
      state.arrayOriginCallerCandidates++;let source='';
      try{
        source=(yield command('Debugger.getScriptSource',{scriptId:location.scriptId})).scriptSource;
        if(typeof source!=='string'||source.length!==meta.length||(state.arrayOriginCallerBytes+=Buffer.byteLength(source,'utf8'))>65536){state.arrayOriginCallerLimitReached=true;throw error('ORIGIN_CALLER_LIMIT');}
        const index=indexRelocatedSource(source,reference);index.generated=true;sourceIndexes.set(location.scriptId,index);
      }finally{source='';}
    }
    return yield* mapFunction(location,PRODUCERS);
  }
  function* arrayEntry(params,definition){
    if(phase!=='init'||!options.observeCipherWitness)return;
    state.arrayOriginEntryHits++;
    let failureStage='header';
    try{
      const frame=params.callFrames?.[0];if(!inHeader(frame,definition))throw error('ORIGIN_HEADER');
      failureStage='value';
      const array=yield* evaluate(frame,'c');
      if(array.type!=='object'||array.subtype!=='array'||!array.objectId){state.arrayOriginNonArrays++;return;}
      let origin=7;
      try{
        const caller=params.callFrames?.[1],producer=yield* mapOriginProducer(caller?.functionLocation);
        const original=reference.definitions[producer.fn.name],delta=producer.fn.body-original.body,offset=producer.mapped.offset(caller.location);
        if(producer.contextId===definition.contextId&&original.setter===definition.fn.name&&caller.location?.scriptId===producer.scriptId&&offset>=original.callFrom+delta&&offset<original.callTo+delta)origin=original.origin;
      }catch{/* A verified setter with an unclassified immediate caller. */}
      failureStage='helper';yield* helper(definition.contextId);
      const observed=(yield* callHelper(definition.contextId,'noteArray',[{objectId:array.objectId},{value:origin}])).value;
      failureStage='record';
      if(observed?.accepted===false&&observed.nonarray===true){state.arrayOriginNonArrays++;return;}
      if(observed?.limited===true){state.arrayOriginLimitReached=true;return;}
      if(observed?.accepted!==true||!Number.isInteger(observed.objects)||observed.objects<1||observed.objects>1024)throw error('ORIGIN_RECORD');
      state.arrayOriginArrays++;state.arrayOriginObjects=Math.max(state.arrayOriginObjects,observed.objects);if(observed.repeated===true)state.arrayOriginRepeated++;
    }catch(failure){state.arrayOriginFailures++;state['arrayOriginFailure_'+failureStage]++;if(failure?.code==='PROTOCOL_FAILED')state.arrayOriginProtocolFailures++;if(failure?.code==='HELPER_FAILED')state.arrayOriginHelperExceptions++;}
  }
  function* consumedArrayOrigin(params,definition,values,source){
    if(source[0]!==3||source[2]!==3)return 0;
    state.arrayOriginQueries++;
    try{
      const array=yield* evaluate(params.callFrames[1],'E');
      if(array.type!=='object'||array.subtype!=='array'||!array.objectId)throw error('ORIGIN_ARRAY');
      const result=(yield* callHelper(definition.contextId,'arrayOrigin',[{objectId:array.objectId},{objectId:values.c.objectId}])).value;
      if(!Number.isInteger(result)||result<0||result>7)throw error('ORIGIN_RESULT');
      if(result!==0)state.arrayOriginMatches++;
      return result;
    }catch{state.arrayOriginQueryFailures++;return 0;}
  }
  function* earlyGeneratedEntry(params,definition){
    state.earlyGeneratedEntryHits++;
    let failureStage='source';
    try{
      const frame=params.callFrames?.[0];if(!inHeader(frame,definition)||!definition.generated)throw error('EARLY_SOURCE');
      failureStage='destination';
      const ek=definition.fn.name==='ek';if((yield* evaluate(frame,ek?'m===143':'R===143',true)).value!==true)return;
      failureStage='context';
      if(earlyContext!==null&&earlyContext!==definition.contextId)throw error('EARLY_CONTEXT');earlyContext=definition.contextId;
      failureStage='frame';
      const values=yield* valuesAt(frame,true,ek);yield* helper(definition.contextId);
      failureStage='tag';
      if((yield* evaluate(frame,'a===undefined',true)).value!==true)throw error('EARLY_TAG_UNSUPPORTED');
      failureStage='width';
      const widths=(yield* callHelper(definition.contextId,'widths',[{objectId:values.c.objectId},{objectId:values.W.objectId}])).value;
      if(!Number.isInteger(widths?.inputLength)||!Number.isInteger(widths?.destinationLength)||state.earlyGenerated143InputBytes+widths.inputLength>65535)throw error('EARLY_WIDTH');
      if(widths.inputLength===0)state.earlyZeroWidthInputs++;
      const source=yield* earlySource(params,definition,values,widths.inputLength);
      const origin=yield* consumedArrayOrigin(params,definition,values,source);
      state[source[0]===0?'initialSourceUnknown':'initialSourceKnown']++;
      failureStage='private-capture';
      const noted=(yield* callHelper(definition.contextId,'noteEarly',[{objectId:values.m.objectId},{objectId:values.W.objectId},{objectId:values.c.objectId},{objectId:values.E.objectId},{value:source},{value:origin}])).value;
      if(noted?.accepted!==true){const code=['ARRAY','LENGTH','BYTE','EARLY_OWNER_CHANGED','EARLY_SHAPE','EARLY_OVERFLOW','EARLY_OVERLAP','EARLY_KEY_SHAPE','EARLY_KEY'].includes(noted?.code)?noted.code:'UNCLASSIFIED';state['earlyHelperFailure_'+code]++;throw error('EARLY_OWNER');}
      failureStage='counters';
      state.earlyGenerated143Entries++;state.earlyGenerated143InputBytes+=widths.inputLength;
      state[ek?'earlyGenerated143EkEntries':'earlyGenerated143OkEntries']++;state[ek?'earlyGenerated143EkInputBytes':'earlyGenerated143OkInputBytes']+=widths.inputLength;
      if((yield* evaluate(frame,'!!a',true)).value===true)state.earlyGenerated143TagBytes++;
      if((yield* evaluate(frame,'a===12',true)).value===true)state.earlyGenerated143Tag12Entries++;
      if(state.earlyGenerated143Entries===1)state.earlyGenerated143FirstLength=widths.destinationLength;
      state.earlyGenerated143EndLength=widths.destinationLength+widths.inputLength;
    }catch{state.earlyGenerated143Failures++;state['earlyFailureStage_'+failureStage]++;}
  }
  function* entry(params, definition) {
    state.entryHits++;
    if(definition.fn.name==='ek'){if(phase==='init'&&options.observeCipherWitness)yield* earlyGeneratedEntry(params,definition);else state.outOfPhaseHits++;return;}
    if (phase !== 'snapshot') { state.outOfPhaseHits++; if (phase === 'init' && options.observeInitPublicEntries) yield* initialPublicEntry(params, definition); if (phase === 'init' && options.observeCipherWitness) { if(definition.generated)yield* earlyGeneratedEntry(params,definition);else yield* taggedPublicEntry(params, definition); } return; }
    const frames = params.callFrames, frame = frames?.[0], caller = frames?.[1];
    if (!inHeader(frame, definition)) throw error('APPENDER_HEADER');
    if (reference.definitions.wrapper) {
      if (!boundTarget || !state.wrapperOwnerPinned) throw error('UNARMED_SNAPSHOT');
      if (definition.scriptId !== boundTarget.scriptId || definition.fn.functionOffset !== boundTarget.fn.functionOffset) throw error('APPENDER_CHANGED');
    }
    if ((yield* evaluate(frame, 'R===143&&a===undefined', true)).value !== true) return;
    const callerDefinition = yield* mapFunction(caller?.functionLocation, ['n5', 'fx']), callerName = callerDefinition.fn.name, delta = callerDefinition.fn.body - reference.definitions[callerName].body;
    if (callerDefinition.contextId !== definition.contextId) throw error('CALLER_CONTEXT');
    const callerOffset = callerDefinition.mapped.offset(caller.location);
    const callStart = callerName === 'fx' ? reference.fxCallStart : reference.callStart, callEnd = callerName === 'fx' ? reference.fxCallEnd : reference.callEnd;
    if (caller.location?.scriptId !== callerDefinition.scriptId || callerOffset < callStart + delta || callerOffset >= callEnd + delta) throw error('CALLER_SITE');
    if (boundTarget) yield* sameBinding(yield* evaluate(caller, 'Ok'));
    // Fx writes a length prefix through the same appender tuple. It is a
    // separately reviewed route, outside the predeclared n5 vector.
    if (callerName === 'fx') { if (pending) throw error('PENDING_OTHER_ROUTE'); state.reviewedNonNumericCalls++; return; }
    if (selectedCaller && (selectedCaller.scriptId !== callerDefinition.scriptId || selectedCaller.fn.functionOffset !== callerDefinition.fn.functionOffset)) throw error('CALLER_CHANGED');
    // Install and confirm the actual caller return site before assignment/resume.
    const returnDefinition = yield* installSite(callerDefinition, 'return'); selectedCaller = callerDefinition;
    state.numericCallerVerified = true; state.callerGeneratedDescendant = callerDefinition.generated; if (definition.generated) state.relocatedEntryHits++;
    if (pending || state.tokenVerified) { fail('pendingMismatch'); return; }
    if (++state.selectedRows > MAX_ROWS || state.replaceMode && !incoming) { fail(state.replaceMode && !incoming ? 'transferFailure' : 'limitReached'); return; }
    if (selectedContext !== null && selectedContext !== definition.contextId) throw error('CONTEXT_CHANGED'); selectedContext = definition.contextId;
    yield* helper(selectedContext); const values = yield* valuesAt(frame);
    const begun = (yield* callHelper(selectedContext, 'begin', [{ objectId: values.m.objectId }, { objectId: values.W.objectId }, { objectId: values.c.objectId }, ...(options.observeCipherWitness ? [{objectId:values.E.objectId},{value:true}] : [])])).value;
    if (begun?.valid !== true || !Array.isArray(begun.row)) throw error('BEGIN_FAILED');
    const row = begun.row;
    // This private by-value row is never included in snapshot/report state.
    denseArray(row, MAX_WIDTH, 1); for (const byte of row) if (!Number.isInteger(byte) || byte < 0 || byte > 255) throw error('ROW_FAILED');
    pending = { contextId: selectedContext, row, stack: stackShape(frames.slice(1)), returnDefinition, ordinal: state.selectedRows - 1, ...(options.observeCipherWitness ? {offset:begun.offset,keyWords:begun.keyWords} : {}) }; state.privateCopiesCleared = false;
    if ((state.selectedBytes += row.length) > MAX_BYTES) { fail('limitReached'); return; }
    if (incoming && (!incoming.rows[pending.ordinal] || incoming.rows[pending.ordinal].length !== row.length)) { fail('widthMismatch'); return; }
    if (!state.captureMode) {
      pending.fromDonor = state.replaceMode && (!state.subsetTransfer || incoming.selectedOrdinals.includes(pending.ordinal));
      const selected = pending.fromDonor ? incoming.rows[pending.ordinal] : row;
      const clone = yield* callHelper(selectedContext, 'replace', [{ value: selected }], false);
      if (!clone.objectId || clone.subtype !== 'array') throw error('REPLACEMENT_FAILED');
      const scopeNumber = frame.scopeChain?.findIndex(scope => scope.type === 'local'); if (!Number.isInteger(scopeNumber) || scopeNumber < 0) throw error('LOCAL_SCOPE');
      yield command('Debugger.setVariableValue', { scopeNumber, variableName: 'c', newValue: { objectId: clone.objectId }, callFrameId: frame.callFrameId }); state.mutations++;
    }
    const after = yield* valuesAt(frame);
    const confirmed = (yield* callHelper(selectedContext, 'confirm', [{ objectId: after.m.objectId }, { objectId: after.W.objectId }, { objectId: after.c.objectId }, { value: state.captureMode }])).value;
    if (confirmed?.valid !== true || confirmed.originalUnchanged !== true || confirmed.destinationUnchanged !== true || confirmed.ownerUnchanged !== true) throw error('ASSIGNMENT_CONFIRMATION'); state.confirmedRows++;
  }
  function* returned(params, definition) {
    state.returnHits++; if (phase !== 'snapshot') { state.outOfPhaseHits++; return; }
    const frames = params.callFrames, frame = frames?.[0];
    if (!inHeader(frame, definition) || frame.returnValue?.type !== 'undefined') throw error('NORMAL_RETURN_REQUIRED');
    const selected = (yield* evaluate(frame, 'a===143', true)).value === true;
    if (!selected && !pending) return;
    if (!selected || !pending || pending.returnDefinition !== definition || !equalStack(pending.stack, stackShape(frames))) { fail('pendingMismatch'); return; }
    const vm = yield* evaluate(frame, 'm'); if (!vm.objectId || vm.type !== 'object' || vm.subtype === 'proxy') throw error('RETURN_VM');
    const result = (yield* callHelper(pending.contextId, 'commit', [{ objectId: vm.objectId }])).value;
    if (result?.valid !== true) { fail('commitmentFailed'); return; }
    if (options.observeCipherWitness) {
      pending.cipherRow = result.cipherRow;
      if (denseArray(pending.cipherRow, MAX_WIDTH, 1) !== pending.row.length || denseArray(pending.keyWords, 2, 2) !== 2) throw error('WITNESS_COMMIT');
      if ((yield* callHelper(pending.contextId, 'releaseCommit')).value !== true) throw error('WITNESS_COMMIT');
      capturedOffsets.push(pending.offset); capturedKeys.push(pending.keyWords); capturedCipher.push(pending.cipherRow);
      state.cipherWitnessRows++; state.cipherWitnessBytes += pending.row.length;
      state.cipherWitnessOffsetsMonotone = true; state.cipherWitnessDestinationStable = true;
    }
    if (state.captureMode) { captured.push(pending.row); state.privateRowsRetained = true; } else { pending.row.fill(0); pending.row.length = 0; }
    if (incoming) { const row = incoming.rows[pending.ordinal]; row.fill(0); row.length = 0; state.transferRowsConsumed++; if (pending.fromDonor) { state.transferUsed = true; state.appliedTransferRows++; } }
    pending = null; state.committedRows++; if (definition.generated) state.relocatedReturnHits++;
  }
  function clearHost() { if (pending) { for (const row of [pending.row, pending.keyWords, pending.cipherRow]) if (row) { row.fill(0); row.length = 0; } pending = null; } wipeRows(captured); clearWitness(); if(initialPacket){clearNumericVectorPacket(initialPacket);initialPacket=null;} if (incoming) { clearNumericVectorPacket(incoming); incoming = null; } state.privateRowsRetained = false; }
  function* clearPrivate() {
    clearHost(); let complete = true;
    for (const contextId of helpers.keys()) try { if ((yield* callHelper(contextId, 'clear', [], true, group)).value !== true) complete = false; } catch { complete = false; }
    state.privateCopiesCleared = complete; if (!complete) { state.cleanupFailed = true; state.failed = true; }
  }
  function* shutdown() {
    if (cleanupStarted) return; cleanupStarted = true; accepting = false; clearTimeout(timer);
    try {
      yield* clearPrivate();
      for (const id of [...breakpoints.keys()]) { try { yield command('Debugger.removeBreakpoint', { breakpointId: id }); state.removedBreakpoints++; } catch { state.cleanupFailed = true; } breakpoints.delete(id); }
      if (instrumentationId) { try { yield command('Debugger.removeBreakpoint', { breakpointId: instrumentationId }); } catch { state.cleanupFailed = true; } instrumentationId = null; }
      for (const objectGroup of [pauseGroup, group]) try { yield command('Runtime.releaseObjectGroup', { objectGroup }); } catch { state.cleanupFailed = true; }
      if (debuggerEnabled) { try { yield command('Debugger.disable'); } catch { state.cleanupFailed = true; } debuggerEnabled = false; }
      if (runtimeEnabled) { try { yield command('Runtime.disable'); } catch { state.cleanupFailed = true; } runtimeEnabled = false; }
    } finally { transport.close(); helpers.clear(); metadata.clear(); checked.clear(); originChecked.clear(); earlySetters.clear(); setterCopies.clear(); sourceIndexes.clear(); boundTarget = null; selectedCaller = null; state.disposed = true; if(state.protocolOutstandingTimeouts){state.protocolUnsettledAtCleanup=true;state.cleanupFailed=true;state.privateCopiesCleared=false;} state.cleanupComplete = !state.cleanupFailed && state.privateCopiesCleared && state.installedBreakpoints === state.removedBreakpoints; if (!state.cleanupComplete) state.failed = true; }
  }
  function* paused(params) {
    state.pauses++;
    try {
      if (state.pauses > options.maxHits) fail('limitReached');
      if (accepting && params.reason === 'instrumentation') { state.instrumentationPauses++; const verifiedBefore=state.sourceVerified,meta = metadata.get(params.data?.scriptId || params.callFrames?.[0]?.location?.scriptId); if (meta) yield* inspectScript(meta); if(!verifiedBefore)for (const other of metadata.values()) yield* inspectScript(other); }
      else if (accepting) {
        const definitions = (params.hitBreakpoints || []).map(id => breakpoints.get(id)).filter(Boolean);
        if (definitions.length > 1) fail('pendingMismatch');
        else if (definitions.length === 1) { const definition = definitions[0], frame = params.callFrames?.[0]; if (frame?.location?.scriptId !== definition.scriptId || definition.mapped.offset(frame.location) !== definition.offset) throw error('PAUSE_SITE'); if (definition.site === 'entry') yield* entry(params, definition); else if (definition.site === 'array') yield* arrayEntry(params,definition); else if (definition.site === 'wrapper') yield* wrapper(params, definition); else yield* returned(params, definition); }
      }
    } catch (failure) { const code=['SOURCE_LIMIT','FUNCTION_MAPPING','FRAME_VALUE','BINDING_TYPE','BINDING_LOCATION','BINDING_CONTEXT','WRAPPER_OWNER','WRAPPER_CONTEXT','HELPER_FAILED','EARLY_CAPTURE_INCOMPLETE','PROTOCOL_FAILED'].includes(failure?.code)?failure.code:'OTHER';state['pauseFailure_'+code]++;fail('mutationFailed'); }
    finally { if (params.reason !== 'instrumentation') try { yield command('Runtime.releaseObjectGroup', { objectGroup: pauseGroup }); } catch { fail('protocolFailed'); } try { yield command('Debugger.resume'); } catch { fail('protocolFailed'); } }
    if (state.failed) yield* shutdown();
  }
  transport.on('Runtime.executionContextCreated', params => { if (accepting && Number.isInteger(params.context?.id) && (transport.sync || !armed)) dispatch(helper(params.context.id))?.catch?.(() => {}); });
  transport.on('Runtime.executionContextDestroyed', params => { if (!cleanupStarted && (selectedContext === params.executionContextId || [...breakpoints.values()].some(b => b.contextId === params.executionContextId))) fail('targetLost'); helpers.delete(params.executionContextId); });
  transport.on('Runtime.executionContextsCleared', () => { if (!cleanupStarted && state.sourceVerified) fail('targetLost'); helpers.clear(); });
  transport.on('Debugger.scriptParsed', params => {
    if (!accepting) return;
    // V8 recompiles the fixed primitive condition on every setter call,
    // including filtered scalars. These exact, non-calling observer scripts
    // carry no official function definitions or descendant producer code.
    if(options.observeCipherWitness&&params.length===ARRAY_CONDITION.length&&params.hash===ARRAY_CONDITION_HASH&&[...breakpoints.values()].some(site=>site.site==='array')){state.scriptConditionMetadataSkipped++;return;}
    if (metadata.size >= state.scriptMetadataLimit) { fail('limitReached'); return; }
    metadata.set(params.scriptId, { scriptId: params.scriptId, length: params.length, executionContextId: params.executionContextId, parents: (params.stackTrace?.callFrames || []).slice(0, 16).map(f => f.scriptId), known: false }); state.scriptMetadataEntries=metadata.size;
    if (transport.sync) dispatch(inspectScript(params))?.catch?.(() => {});
  });
  transport.on('Debugger.paused', params => dispatch(paused(params))?.catch?.(() => {}));
  const controller = {
    snapshot() { return { ...state, initTagged143ClassificationComplete: options.observeCipherWitness && state.initPhaseClosed && state.sourceVerified && state.initTaggedPublicEntries > 0 && state.initTaggedTupleChecked === state.initTaggedPublicEntries && state.initTagged143Failures === 0, initClassificationComplete: options.observeInitPublicEntries && state.initPhaseClosed && phase !== 'init' && state.sourceVerified && !state.failed && state.initPublicEntryHits > 0 && state.initTupleChecked === state.initPublicEntryHits && state.initTupleMatches === state.initN5Entries + state.initFxEntries + state.initUnknownTupleCallers && state.initUnknownTupleCallers === 0 && state.initInvalidWidths === 0 && state.initClassificationFailures === 0 }; },
    setPhase(next) { if (!['init', 'events', 'snapshot'].includes(next)) throw error('INVALID_PHASE'); if (state.disposed || state.failed) throw error('UNAVAILABLE'); if (next === 'snapshot' && phase !== 'snapshot') { if (snapshotStarted) { fail('pendingMismatch'); throw error('SECOND_SNAPSHOT'); } snapshotStarted = true; } if ((options.observeInitPublicEntries || options.observeCipherWitness) && next !== 'init') state.initPhaseClosed = true; phase = next; if(next!=='init'&&options.observeCipherWitness&&state.sourceVerified)dispatch(closeArrayDiscovery())?.catch?.(()=>{}); },
    async flush() { let previous; do { previous = queue; await previous; } while (queue !== previous); },
    async setVector(packet) {
      state.setVectorCalls++;
      try { if (state.failed || state.disposed || state.captureMode || state.setVectorCalls !== 1 || snapshotStarted || state.selectedRows) throw error('TRANSFER_STATE'); incoming = copyNumericVectorPacket(packet); if ([3,4,5,6].includes(incoming.schemaVersion) || incoming.schemaVersion === 2 && !state.replaceMode) throw error('TRANSFER_STATE'); state.transferRows = incoming.rows.length; state.subsetTransfer = incoming.schemaVersion === 2; state.selectedTransferRows = state.replaceMode ? state.subsetTransfer ? incoming.selectedOrdinals.length : state.transferRows : 0; state.privateRowsRetained = true; state.privateCopiesCleared = false; return true; }
      catch { fail('transferFailure'); await dispatch(clearPrivate()); throw error('TRANSFER_REJECTED'); }
      finally { if (!clearNumericVectorPacket(packet)) { fail('transferFailure'); await dispatch(clearPrivate()); throw error('TRANSFER_CLEANUP_FAILED'); } }
    },
    async verifyToken(token) {
      await controller.flush(); state.verificationCalls++;
      try {
        if (state.failed || state.disposed || state.verificationCalls !== 1 || !state.sourceVerified || !snapshotStarted || pending || state.selectedRows < 1 || state.selectedRows !== state.committedRows || state.selectedRows !== state.confirmedRows || (state.captureMode ? state.mutations !== 0 : state.mutations !== state.selectedRows) || state.replaceMode && !incoming || incoming && (state.transferRowsConsumed !== state.transferRows || state.selectedRows !== state.transferRows)) throw error('INCOMPLETE_VECTOR');
        if (!state.numericCallerVerified || reference.definitions.wrapper && (!state.bindingVerified || !state.wrapperOwnerPinned || state.snapshotWrapperHits < 1)) throw error('INCOMPLETE_DISCOVERY');
        if (state.appliedTransferRows !== state.selectedTransferRows || state.replaceMode && state.appliedTransferRows < 1) throw error('INCOMPLETE_SELECTION');
        const envelope = inspectTokenEnvelope(token); state.envelopeComplete = envelope.complete === true;
        if (!envelope.complete || envelope.ambiguous || envelope.errorPresent) throw error('ENVELOPE_FAILED');
        if (options.observeCipherWitness) { if (capturedOffsets.length !== state.selectedRows || capturedKeys.length !== state.selectedRows || capturedCipher.length !== state.selectedRows || state.cipherWitnessBytes !== state.selectedBytes) throw error('WITNESS_INCOMPLETE'); state.cipherWitnessComplete = true; }
        state.vectorComplete = true; state.allSelectedAppendsCommitted = true; state.targetOwnCryptoStatePreserved = true; state.vectorConsumed = !!incoming && state.transferRowsConsumed === state.transferRows; state.tokenVerified = true; state.transferSelectionVerified = true;
        if (incoming) { clearNumericVectorPacket(incoming); incoming = null; }
        state.privateRowsRetained = state.captureMode && (captured.length > 0 || !!initialPacket); state.privateCopiesCleared = !state.privateRowsRetained; return true;
      } catch { fail('verificationFailed'); await dispatch(clearPrivate()); return false; }
    },
    async takeVector(initial=false) {
      if(typeof initial!=='boolean')throw error('TAKE_REJECTED');
      if(initial){
        await controller.flush();state.takeInitialVectorCalls++;
        if(state.failed||state.disposed||!state.captureMode||!state.tokenVerified||!state.initialCipherCaptureComplete||!initialPacket||state.takeInitialVectorCalls!==1){fail('transferFailure');await dispatch(clearPrivate());throw error('TAKE_REJECTED');}
        try{return copyNumericVectorPacket(initialPacket);}finally{clearNumericVectorPacket(initialPacket);initialPacket=null;state.privateRowsRetained=captured.length>0;state.privateCopiesCleared=!state.privateRowsRetained;}
      }
      await controller.flush(); state.takeVectorCalls++;
      if (state.failed || state.disposed || !state.captureMode || !state.tokenVerified || !state.vectorComplete || state.takeVectorCalls !== 1 || captured.length !== state.committedRows) { fail('transferFailure'); await dispatch(clearPrivate()); throw error('TAKE_REJECTED'); }
      let packet; try { packet = copyNumericVectorPacket(options.observeCipherWitness ? {schemaVersion:3,sourcePin:SOURCE,route:WITNESS_ROUTE,rows:captured,rowOffsets:capturedOffsets,keyWords:capturedKeys,cipherRows:capturedCipher} : { schemaVersion: 1, sourcePin: SOURCE, route: ROUTE, rows: captured }); return packet; } finally { wipeRows(captured); clearWitness(); state.privateRowsRetained = !!initialPacket; state.privateCopiesCleared = !state.privateRowsRetained; }
    },
    async dispose() { accepting = false; await dispatch(shutdown()); await controller.flush(); },
  };
  try {
    if (transport.sync) runSync((function* () { runtimeEnabled = true; yield command('Runtime.enable'); debuggerEnabled = true; yield command('Debugger.enable'); })(), transport);
    else { runtimeEnabled = true; await transport.send('Runtime.enable', {}); await controller.flush(); debuggerEnabled = true; await transport.send('Debugger.enable', {}); for (const meta of metadata.values()) await runAsync(inspectScript(meta), transport); armed = true; if (!state.sourceVerified) { const installed = await transport.send('Debugger.setInstrumentationBreakpoint', { instrumentation: 'beforeScriptExecution' }); if (typeof installed.breakpointId !== 'string') throw error('INSTRUMENTATION_FAILED'); instrumentationId = installed.breakpointId; } }
    await controller.flush(); if (state.failed) throw error('SETUP_FAILED');
  } catch { await controller.dispose(); throw error('SETUP_FAILED'); }
  timer = setTimeout(() => { fail('durationReached'); controller.dispose().catch(() => {}); }, options.maxDurationMs); timer.unref?.();
  return controller;
}
export async function createNumericVectorInspector({ originalInterpreter, ...options } = {}) { return createProbe(referenceFor(originalInterpreter), optionsFor(options), nodeTransport()); }
export async function createNumericVectorCDPInspector({ originalInterpreter, cdp, ...options } = {}) { return createProbe(referenceFor(originalInterpreter), optionsFor(options), cdpTransport(cdp)); }
export async function createNumericVectorInspectorFixture({ source, cdp, ...options } = {}) { return createProbe(fixtureReference(source), optionsFor(options), cdp ? cdpTransport(cdp) : nodeTransport()); }
