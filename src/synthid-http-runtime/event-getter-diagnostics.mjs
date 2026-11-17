// Passive Node inspector observation of existing JSDOM getter functions. No
// source/prototype replacement, event dispatch, network port, or page global.
import { Session } from 'node:inspector';
import { createHash, randomUUID } from 'node:crypto';
import { parse, parseExpressionAt, tokenizer } from 'acorn';

export const eventGetterNames = ['timeStamp', 'clientX', 'clientY', 'movementX', 'movementY', 'target',
  'currentTarget', 'eventPhase', 'buttons', 'button', 'isTrusted', 'type', 'view', 'pageX', 'pageY', 'screenX', 'screenY'];
const CALLERS = ['official', 'officialStack', 'helper', 'jsdom', 'other', 'unknown'];
const PINNED_INTERPRETER_SHA256 = '231468acebdbbfd37651d9060ee7a7420065b3bf0e6fb2be0d8a2b7a5922bad2';
// Source-reviewed spans of the seven string literals in this exact public file.
// Their decoded values are joined by a newline by the original loader. The
// original loader also prepends a dynamic prefix; an embedded equality is not
// asserted merely because this fixed payload occurs somewhere in a script.
const PINNED_LITERAL_SPANS = [[4409,4655],[4657,4673],[4675,4677],[4679,4702],[4704,4742],[4744,4748],[4750,66375]];
const API_NAMES = [...eventGetterNames, 'Event', 'MouseEvent', 'PointerEvent', 'addEventListener', 'removeEventListener', 'dispatchEvent', 'preventDefault', 'stopPropagation', 'stopImmediatePropagation'];
const MAX_SOURCE_BYTES = 1048576;
const knownErrors = new Set(['INVALID_OPTIONS', 'GETTER_DISCOVERY_FAILED', 'INSPECTOR_SETUP_FAILED']);
export class EventGetterDiagnosticsError extends Error {
  constructor(code) { super('Event getter diagnostic failed: ' + (knownErrors.has(code) ? code : 'INSPECTOR_SETUP_FAILED')); this.name = 'EventGetterDiagnosticsError'; this.code = knownErrors.has(code) ? code : 'INSPECTOR_SETUP_FAILED'; }
}

function sourceKind(url) {
  if (!url) return 'anonymous';
  if (/(?:^|[/\\])google-botguard-interpreter\.js$/.test(url)) return 'official';
  if (/(?:^|[/\\])(?:synthid-lifecycle-realm|realm-pointer-diagnostic|event-getter-diagnostics)(?:\.selftest)?\.(?:js|mjs)$/.test(url)) return 'helper';
  if (/(?:^|[/\\])jsdom[/\\]lib[/\\]/.test(url)) return 'jsdom';
  return 'other';
}
function descriptorGetter(sample, name) {
  for (let current = sample, depth = 0; current && depth < 8; current = Object.getPrototypeOf(current), depth++) {
    const descriptor = Object.getOwnPropertyDescriptor(current, name);
    if (descriptor) return typeof descriptor.get === 'function' ? descriptor.get : undefined;
  }
}
function decodeLiteral(text) {
  const quote = text[0];
  if (!['"', "'"].includes(quote) || text.at(-1) !== quote) throw 0;
  let result = '';
  for (let index = 1; index < text.length - 1; index++) {
    const character = text[index];
    if (character !== '\\') { if (character === quote || character === '\r' || character === '\n') throw 0; result += character; continue; }
    const escape = text[++index];
    if (index >= text.length - 1) throw 0;
    if (escape === '\n') continue;
    if (escape === '\r') { if (text[index + 1] === '\n') index++; continue; }
    if (escape === 'x' || escape === 'u') {
      const length = escape === 'x' ? 2 : 4, digits = text.slice(index + 1, index + 1 + length);
      if (digits.length !== length || !/^[0-9a-f]+$/i.test(digits)) throw 0;
      result += String.fromCharCode(Number.parseInt(digits, 16)); index += length; continue;
    }
    const escapes = { n:'\n', r:'\r', t:'\t', b:'\b', f:'\f', v:'\v', '0':'\0' };
    if (escape === '0' && /[0-9]/.test(text[index + 1] || '')) throw 0;
    if (/[1-9]/.test(escape)) throw 0;
    result += Object.hasOwn(escapes, escape) ? escapes[escape] : escape;
  }
  return result;
}
function referencesFor(originalInterpreter) {
  const pinned = typeof originalInterpreter === 'string' && createHash('sha256').update(originalInterpreter).digest('hex') === PINNED_INTERPRETER_SHA256;
  let embedded;
  if (pinned) {
    try { embedded = PINNED_LITERAL_SPANS.map(([start,end]) => decodeLiteral(originalInterpreter.slice(start,end))).join('\n'); } catch {}
  }
  return { original: originalInterpreter, embedded, pinned };
}
function lengthBucket(length) {
  if (!length) return 'empty';
  for (const limit of [128,512,2048,8192,32768,131072,1048576]) if (length <= limit) return 'at-most-' + limit;
  return 'over-limit';
}
function sourcePatterns(source) {
  const output = { analysisKind:'conservative-lexical-patterns', parserUsed:false, inspected:false, complete:false,
    trustPropertyMention:false, negatedTrustPropertyPattern:false, trustComparisonPattern:false,
    directTrustReturnPattern:false, simpleTrustEarlyReturnPattern:false,
    eventApiMentions:Object.fromEntries(API_NAMES.map(name => [name,false])) };
  if (source.length > 8192) return output;
  output.inspected = true;
  // This deliberately limited scanner never evaluates source. Unsupported regex
  // or template syntax causes structural matching to fail closed, rather than
  // treating string contents as executable syntax. It is not a JS parser.
  const tokens = [];
  try {
    for (let index = 0; index < source.length;) {
      const character = source[index];
      if (/\s/.test(character)) { index++; continue; }
      if (source.startsWith('//',index)) { const end = source.indexOf('\n',index+2); index = end < 0 ? source.length : end; continue; }
      if (source.startsWith('/*',index)) { const end = source.indexOf('*/',index+2); if (end < 0) throw 0; index = end+2; continue; }
      if (character === '"' || character === "'") {
        let end = index+1;
        while (end < source.length && source[end] !== character) { if (source[end] === '\\') end++; end++; }
        if (end >= source.length) throw 0;
        tokens.push({ kind:'string', value:decodeLiteral(source.slice(index,end+1)) }); index=end+1; continue;
      }
      if (character === '`' || character === '/' || character === '\\') throw 0;
      const identifier = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(source.slice(index));
      if (identifier) { tokens.push({kind:'identifier',value:identifier[0]});index+=identifier[0].length;continue; }
      const number = /^[0-9]+(?:\.[0-9]+)?/.exec(source.slice(index));
      if (number) { tokens.push({kind:'number',value:''});index+=number[0].length;continue; }
      const operator = /^(?:===|!==|=>|==|!=|&&|\|\||\?\.)/.exec(source.slice(index));
      if (operator) { tokens.push({kind:'punctuation',value:operator[0]});index+=operator[0].length;continue; }
      if (!/[{}()[\].,;:!?+*%=<>|&^~-]/.test(character)) throw 0;
      tokens.push({kind:'punctuation',value:character});index++;
    }
    output.complete = true;
  } catch { return output; }
  const value = index => tokens[index]?.value;
  for (const token of tokens) if (API_NAMES.includes(token.value)) output.eventApiMentions[token.value]=true;
  for (let index=0;index<tokens.length;index++) {
    if (tokens[index]?.kind !== 'identifier') continue;
    let end;
    if (value(index+1)==='.' && tokens[index+2]?.kind==='identifier' && value(index+2)==='isTrusted') end=index+3;
    if (value(index+1)==='[' && tokens[index+2]?.kind==='string' && value(index+2)==='isTrusted' && value(index+3)===']') end=index+4;
    if (end===undefined) continue;
    output.trustPropertyMention=true;
    if (value(index-1)==='!') output.negatedTrustPropertyPattern=true;
    if (['===','!==','==','!='].includes(value(end))) output.trustComparisonPattern=true;
    if (['return','=>'].includes(value(index-1)) && (end===tokens.length || [';',')','}'].includes(value(end)))) output.directTrustReturnPattern=true;
    const before = value(index-1)==='!' ? index-2 : index-1;
    if (value(before)==='(' && value(before-1)==='if' && value(end)===')') {
      const next=value(end+1)==='{' ? end+2 : end+1;
      if (value(next)==='return') output.simpleTrustEarlyReturnPattern=true;
    }
  }
  return output;
}
const AST_KINDS = new Set(['Program', 'ExpressionStatement', 'ParenthesizedExpression', 'FunctionExpression',
  'FunctionDeclaration', 'ArrowFunctionExpression', 'BlockStatement', 'ReturnStatement', 'MemberExpression',
  'Identifier', 'Literal', 'CallExpression', 'NewExpression', 'SequenceExpression', 'UnaryExpression',
  'BinaryExpression', 'LogicalExpression', 'ConditionalExpression', 'AssignmentExpression', 'UpdateExpression',
  'ArrayExpression', 'ObjectExpression', 'Property', 'VariableDeclaration', 'VariableDeclarator', 'IfStatement',
  'ChainExpression', 'AwaitExpression', 'ThisExpression', 'EmptyStatement', 'SpreadElement', 'RestElement',
  'AssignmentPattern', 'ArrayPattern', 'ObjectPattern', 'ThrowStatement', 'TryStatement', 'CatchClause']);
const AST_OPERATORS = new Set(['!', '~', '+', '-', '*', '/', '%', '**', 'typeof', 'void', 'delete', 'in', 'instanceof',
  '==', '!=', '===', '!==', '<', '<=', '>', '>=', '<<', '>>', '>>>', '|', '&', '^', '&&', '||', '??',
  '=', '+=', '-=', '*=', '/=', '%=', '**=', '<<=', '>>=', '>>>=', '|=', '&=', '^=', '&&=', '||=', '??=', '++', '--']);
const AST_API_NAMES = new Set([...API_NAMES, 'arguments', 'Object', 'Reflect', 'toString', 'valueOf',
  'getOwnPropertyDescriptor', 'getOwnPropertyDescriptors', 'getOwnPropertyNames', 'getPrototypeOf', 'ownKeys',
  'defineProperty', 'hasOwnProperty', 'navigator', 'document', 'window', 'parent', 'self', 'top']);
const AST_OPTIONS = { ecmaVersion: 'latest', sourceType: 'script', preserveParens: true };
function callerAstShape(source) {
  const result = { parser: 'acorn', maximumSourceLength: 128, withinLimit: source.length <= 128,
    attempted: false, parseSuccess: false, parseMode: 'unparsed', complete: false, truncated: false,
    bindingAnalysisPerformed: false, parameterMatchesAreSyntactic: true,
    nodeCount: 0, functionCount: 0, returnCount: 0, directiveCount: 0, numericLiteralCount: 0,
    stringLiteralCount: 0, parenthesizedWrappers: 0, callExpressions: 0, sequenceExpressions: 0,
    unsupportedNodes: 0, rootKinds: [], functions: [], topology: null };
  if (!result.withinLimit) return result;
  result.attempted = true;
  let root;
  try { root = parse(source, AST_OPTIONS); result.parseMode = 'script'; }
  catch {
    // The parser can also describe an anonymous function expression returned
    // as a standalone caller source. No synthetic code wrapper is evaluated.
    try {
      root = parseExpressionAt(source, 0, AST_OPTIONS);
      if (tokenizer(source.slice(root.end), AST_OPTIONS).getToken().type.label !== 'eof') return result;
      result.parseMode = 'expression';
    } catch { return result; }
  }
  result.parseSuccess = true;
  const kind = node => AST_KINDS.has(node?.type) ? node.type : 'other';
  const api = value => typeof value === 'string' && AST_API_NAMES.has(value) ? value : 'other';
  const reference = (node, scopes) => {
    if (node?.type === 'Identifier') for (let depth = 0; depth < scopes.length; depth++) {
      const index = scopes[depth].indexOf(node.name);
      if (index >= 0) return { parameterIndex: index, parameterDepth: depth };
    }
    return { parameterIndex: -1, parameterDepth: -1 };
  };
  function visit(node, scopes = [], depth = 0, propertyName = false) {
    if (!node) return null;
    if (result.nodeCount >= 128 || depth >= 40) { result.truncated = true; return { kind: 'limit' }; }
    result.nodeCount++;
    const shape = { kind: kind(node) };
    const child = (value, named = false) => visit(value, scopes, depth + 1, named);
    const children = values => values.map(value => child(value));
    switch (node.type) {
      case 'Program': case 'BlockStatement': shape.body = children(node.body); break;
      case 'ExpressionStatement':
        shape.directive = typeof node.directive === 'string';
        if (shape.directive) result.directiveCount++;
        shape.expression = child(node.expression); break;
      case 'ParenthesizedExpression': result.parenthesizedWrappers++; shape.expression = child(node.expression); break;
      case 'FunctionDeclaration': case 'FunctionExpression': case 'ArrowFunctionExpression': {
        result.functionCount++;
        shape.parameterCount = node.params.length;
        shape.parameterKinds = node.params.map(kind);
        shape.named = !!node.id; shape.async = !!node.async; shape.generator = !!node.generator;
        shape.expressionBody = node.body.type !== 'BlockStatement';
        shape.bodyNodeKinds = shape.expressionBody ? [kind(node.body)] : node.body.body.map(kind);
        // Name arrays stay private. A syntactic match is not lexical binding
        // resolution; local declarations/shadowing are preserved in topology.
        const innerScopes = [node.params.map(parameter => parameter.type === 'Identifier' ? parameter.name : null), ...scopes];
        if (result.functions.length < 8) result.functions.push({ kind: shape.kind, parameterCount: shape.parameterCount,
          parameterKinds: [...shape.parameterKinds], named: shape.named, async: shape.async, generator: shape.generator,
          expressionBody: shape.expressionBody, bodyNodeKinds: [...shape.bodyNodeKinds] });
        else result.truncated = true;
        shape.parameters = node.params.map(parameter => visit(parameter, innerScopes, depth + 1));
        shape.body = visit(node.body, innerScopes, depth + 1); break;
      }
      case 'ReturnStatement': result.returnCount++; shape.argument = child(node.argument); break;
      case 'MemberExpression':
        shape.computed = !!node.computed; shape.optional = !!node.optional;
        shape.objectParameter = reference(node.object, scopes);
        shape.propertyParameter = node.computed ? reference(node.property, scopes) : reference(null, scopes);
        shape.fixedPropertyApi = !node.computed && node.property.type === 'Identifier' ? api(node.property.name) :
          node.computed && node.property.type === 'Literal' ? api(node.property.value) : 'other';
        shape.object = child(node.object); shape.property = child(node.property, !node.computed); break;
      case 'Identifier':
        Object.assign(shape, propertyName ? reference(null, scopes) : reference(node, scopes));
        shape.fixedApi = api(node.name); break;
      case 'Literal':
        shape.literalKind = node.regex ? 'regexp' : node.bigint !== undefined ? 'bigint' : node.value === null ? 'null' :
          ['string', 'number', 'boolean'].includes(typeof node.value) ? typeof node.value : 'other';
        if (shape.literalKind === 'number') result.numericLiteralCount++;
        if (shape.literalKind === 'string') result.stringLiteralCount++;
        break;
      case 'CallExpression': case 'NewExpression':
        result.callExpressions++; shape.optional = !!node.optional; shape.argumentCount = node.arguments.length;
        shape.callee = child(node.callee); shape.arguments = children(node.arguments); break;
      case 'SequenceExpression': result.sequenceExpressions++; shape.expressions = children(node.expressions); break;
      case 'UnaryExpression': case 'UpdateExpression':
        shape.operator = AST_OPERATORS.has(node.operator) ? node.operator : 'other';
        shape.prefix = !!node.prefix; shape.argument = child(node.argument); break;
      case 'BinaryExpression': case 'LogicalExpression': case 'AssignmentExpression':
        shape.operator = AST_OPERATORS.has(node.operator) ? node.operator : 'other';
        shape.left = child(node.left); shape.right = child(node.right); break;
      case 'ConditionalExpression': case 'IfStatement':
        shape.test = child(node.test); shape.consequent = child(node.consequent); shape.alternate = child(node.alternate); break;
      case 'ArrayExpression': case 'ArrayPattern': shape.elements = children(node.elements); break;
      case 'ObjectExpression': case 'ObjectPattern': shape.properties = children(node.properties); break;
      case 'Property':
        shape.computed = !!node.computed; shape.shorthand = !!node.shorthand; shape.method = !!node.method;
        shape.propertyKind = ['init', 'get', 'set'].includes(node.kind) ? node.kind : 'other';
        shape.key = child(node.key, !node.computed); shape.value = child(node.value); break;
      case 'VariableDeclaration':
        shape.declarationKind = ['var', 'let', 'const'].includes(node.kind) ? node.kind : 'other';
        shape.declarations = children(node.declarations); break;
      case 'VariableDeclarator': shape.binding = child(node.id); shape.init = child(node.init); break;
      case 'AssignmentPattern': shape.left = child(node.left); shape.right = child(node.right); break;
      case 'AwaitExpression': case 'SpreadElement': case 'RestElement': case 'ThrowStatement': shape.argument = child(node.argument); break;
      case 'ChainExpression': shape.expression = child(node.expression); break;
      case 'TryStatement': shape.block = child(node.block); shape.handler = child(node.handler); shape.finalizer = child(node.finalizer); break;
      case 'CatchClause': shape.binding = child(node.param); shape.body = child(node.body); break;
      case 'ThisExpression': case 'EmptyStatement': break;
      default: result.unsupportedNodes++; break;
    }
    return shape;
  }
  result.rootKinds = root.type === 'Program' ? root.body.map(kind) : [kind(root)];
  result.topology = visit(root);
  result.complete = !result.truncated && result.unsupportedNodes === 0;
  return result;
}
// Exported only for offline fixtures. The return value contains a fixed schema;
// no caller source, identifier, URL, argument, literal value or ID is returned.
export function summarizeEventGetterCallerSource(source, { originalInterpreter } = {}) {
  if (typeof source !== 'string' || (originalInterpreter !== undefined && (typeof originalInterpreter !== 'string' || originalInterpreter.length > MAX_SOURCE_BYTES))) throw new EventGetterDiagnosticsError('INVALID_OPTIONS');
  const references = referencesFor(originalInterpreter);
  return summarizeSource(source,references);
}
function summarizeSource(source,references) {
  const withinLimit=source.length<=MAX_SOURCE_BYTES;
  const embedded=references.embedded;
  const tailMatch=withinLimit && typeof embedded==='string' && source.endsWith(embedded);
  const prefix=tailMatch?source.slice(0,source.length-embedded.length):undefined;
  return { lengthBucket:lengthBucket(source.length), withinLimit, originalReferenceProvided:typeof references.original==='string',
    pinnedOriginalReference:references.pinned, embeddedReferenceAvailable:typeof embedded==='string',
    exactOriginalMatch:withinLimit && typeof references.original==='string' && source===references.original,
    exactEmbeddedMatch:withinLimit && typeof embedded==='string' && source===embedded,
    embeddedExactTailMatch:tailMatch, embeddedTailPrefixWhitespaceOnly:prefix!==undefined && /^\s*$/.test(prefix),
    patterns:sourcePatterns(withinLimit?source:' '.repeat(8193)), astShape:callerAstShape(source) };
}

function tinyCallerCallee(source) {
  if (typeof source !== 'string' || source.length > 128) return;
  const unwrap = node => { while (node?.type === 'ParenthesizedExpression') node = node.expression; return node; };
  const parsed = parse(source, AST_OPTIONS);
  if (parsed.body.length !== 1 || parsed.body[0].type !== 'ExpressionStatement') return;
  let fn = unwrap(parsed.body[0].expression);
  if (fn?.type === 'SequenceExpression') fn = unwrap(fn.expressions.at(-1));
  if (!['FunctionExpression', 'ArrowFunctionExpression'].includes(fn?.type) || fn.body.type !== 'BlockStatement') return;
  const body = fn.body.body;
  if (body.length !== 1 || body[0].type !== 'ExpressionStatement') return;
  const call = unwrap(body[0].expression);
  if (call?.type !== 'CallExpression' || call.callee.type !== 'Identifier') return;
  let first = unwrap(call.arguments[0]);
  if (first?.type === 'SequenceExpression') first = unwrap(first.expressions.at(-1));
  return { name: call.callee.name, parameterCount: fn.params.length, argumentCount: call.arguments.length,
    firstArgumentEndsInComputedRead: first?.type === 'MemberExpression' && first.computed === true };
}
function sourceOffset(source, location) {
  if (!Number.isInteger(location?.lineNumber) || !Number.isInteger(location.columnNumber) || location.lineNumber < 0 || location.columnNumber < 0) return;
  let line = 0, start = 0;
  for (let index = 0; index < source.length && line < location.lineNumber; index++) {
    const code = source.charCodeAt(index);
    if (code === 13) { if (source.charCodeAt(index + 1) === 10) index++; line++; start = index + 1; }
    else if (code === 10 || code === 0x2028 || code === 0x2029) { line++; start = index + 1; }
  }
  const offset = start + location.columnNumber;
  if (line === location.lineNumber && offset <= source.length) return offset;
}
function functionAtLocation(source, offset) {
  const ast = parse(source, AST_OPTIONS), stack = [ast];
  let inspected = 0;
  while (stack.length && inspected++ < 60000) {
    const node = stack.pop();
    if (!node || typeof node !== 'object') continue;
    if (['FunctionExpression', 'FunctionDeclaration', 'ArrowFunctionExpression'].includes(node.type) && node.start <= offset && offset < node.body.start) {
      // V8's [[FunctionLocation]] for an ordinary function is the opening
      // parameter parenthesis, not the function keyword or first parameter.
      let matched = node.type === 'ArrowFunctionExpression' && offset === node.start;
      const tokens = tokenizer(source.slice(node.start, Math.min(node.body.start, node.start + 2048)), AST_OPTIONS);
      for (let index = 0; !matched && index < 32; index++) {
        const token = tokens.getToken();
        if (token.type.label === '(') { matched = node.start + token.start === offset; break; }
        if (token.type.label === 'eof') break;
      }
      if (matched) return node;
    }
    for (const value of Object.values(node)) if (Array.isArray(value)) stack.push(...value); else if (value && typeof value === 'object') stack.push(value);
  }
}

export async function createEventGetterDiagnostics(window, { maxHits = 4000, maxDurationMs = 10000,
  maxUnknownSources = 4, originalInterpreter, deferActivation = false } = {}) {
  if (!window || !Number.isInteger(maxHits) || maxHits < 1 || maxHits > 50000
    || !Number.isInteger(maxDurationMs) || maxDurationMs < 100 || maxDurationMs > 60000
    || !Number.isInteger(maxUnknownSources) || maxUnknownSources < 1 || maxUnknownSources > 8
    || typeof deferActivation !== 'boolean'
    || (originalInterpreter !== undefined && (typeof originalInterpreter !== 'string' || originalInterpreter.length > MAX_SOURCE_BYTES))) throw new EventGetterDiagnosticsError('INVALID_OPTIONS');
  let functions;
  try {
    // JSDOM caches the unforgeable isTrusted getter per realm. An undispatched
    // ordinary sample exposes that original getter without changing any event.
    const sample = new window.MouseEvent('mousemove');
    functions = new Map(eventGetterNames.map(name => [name, descriptorGetter(sample, name)]));
  } catch { throw new EventGetterDiagnosticsError('GETTER_DISCOVERY_FAILED'); }
  const state = { diagnosticOnly: true, sourceModified: false, prototypesModified: false, valuesRecorded: false,
    getterAvailable: Object.fromEntries([...functions].map(([name, fn]) => [name, !!fn])),
    reads: Object.fromEntries(eventGetterNames.map(name => [name, { total: 0, ...Object.fromEntries(CALLERS.map(kind => [kind, 0])) }])),
    pauses: 0, unexpectedPauses: 0, maxHits, limitReached: false, durationReached: false,
    installedBreakpoints: 0, removedBreakpoints: 0, inspectorErrors: 0, scriptLimitReached: false, disposed: false,
    deferredActivation:deferActivation, activated:false, scriptParseNotifications:0,
    callerSourceSelection:'unknown-or-anonymous', callerSourceInspections:[], callerSourceLimitReached:false,
    sourceInspectionErrors:0, sourceInspectionPending:0, calleeInspection: null };
  const session = new Session();
  const breakpoints = new Map(), scripts = new Map();
  const unknownSources = new Map(), pendingSources = new Set();
  let references = referencesFor(originalInterpreter);
  const registryKey = '__synthid_event_getters_' + randomUUID().replaceAll('-', '');
  const objectGroup = 'synthid-event-getters-' + randomUUID();
  let active = false, connected = false, disposed = false, cleanupPromise, activationPromise, timer, registryPresent = false;
  let removals = Promise.resolve();
  const post = (method, params = {}) => new Promise((resolve, reject) => {
    const deadline = setTimeout(() => reject(new EventGetterDiagnosticsError('INSPECTOR_SETUP_FAILED')), 1000);
    try { session.post(method, params, (error, result) => { clearTimeout(deadline);error ? reject(error) : resolve(result); }); }
    catch (error) { clearTimeout(deadline);reject(error); }
  });
  const resume = () => {
    if (!connected) return;
    try { session.post('Debugger.resume', {}, error => { if (error && !disposed) state.inspectorErrors++; }); }
    catch { if (!disposed) state.inspectorErrors++; }
  };
  function immediate(method, params) {
    let completed = false, failure, response;
    session.post(method, params, (error, result) => { completed = true; failure = error; response = result; });
    if (!completed || failure || response?.exceptionDetails) throw new EventGetterDiagnosticsError('INSPECTOR_SETUP_FAILED');
    return response;
  }
  function parsed({ params }) {
    // Only fixed classifications and private graph IDs are retained. No URLs,
    // function names, script source, expressions, arguments or property values.
    if (scripts.size >= 6000 && !scripts.has(params.scriptId)) { state.scriptLimitReached = true; return; }
    state.scriptParseNotifications=Math.min(1000000,state.scriptParseNotifications+1);
    const parents = (params.stackTrace?.callFrames || []).slice(0, 24).map(frame => frame.scriptId).filter(Boolean);
    scripts.set(params.scriptId, { kind: sourceKind(params.url), parents, length: params.length });
  }
  function kindFor(scriptId, seen = new Set()) {
    if (!scriptId || seen.size > 32 || seen.has(scriptId)) return 'unknown';
    seen.add(scriptId);
    const entry = scripts.get(scriptId);
    if (!entry) return 'unknown';
    if (entry.kind !== 'anonymous') return entry.kind;
    return entry.parents.some(id => kindFor(id, seen) === 'official') ? 'official' : 'unknown';
  }
  function callerKind(frames) {
    // The first frame is the getter where V8 paused. Classify its immediate read
    // caller; deeper official frames are separately marked, never overclaimed.
    const caller = frames?.[1];
    const direct = kindFor(caller?.location?.scriptId);
    if (direct === 'official' || direct === 'helper' || direct === 'jsdom' || direct === 'other') return direct;
    if ((frames || []).slice(2, 26).some(frame => kindFor(frame.location?.scriptId) === 'official')) return 'officialStack';
    return 'unknown';
  }
  function inspectActualCallee(frames, names, kind) {
    if (state.calleeInspection || !names.includes('isTrusted') || !['official', 'officialStack'].includes(kind)) return;
    const result = state.calleeInspection = { attempted: true, callerEligible: true, callerSourceWithinLimit: false,
      callShapeMatched: false, callerParameterCount: 0, callArgumentCount: 0, firstArgumentEndsInComputedRead: false,
      scopeCount: 0, descriptorCount: 0, scopeLimitReached: false, descriptorLimitReached: false,
      accessorBindingBlocked: false, unsupportedScope: false, bindingFound: false, bindingScope: 'unresolved',
      bindingType: 'unresolved', functionLocationAvailable: false, sameAsGetterCallerScript: false,
      targetProvenance: 'unknown', targetSourceRetrieved: false, targetSourceTooLarge: false,
      exactProvidedOriginalSource: false, pinnedOriginalReference: references.pinned,
      pinnedOuterSource: false, pinnedEmbeddedSource: false, exactPinnedMMLocation: false,
      functionLocationMatched: false, calleeParameterCount: 0, calleeBodyNodeKinds: [], calleeAstShape: null,
      functionBodyKindLimitReached: false, functionsInvoked: 0, propertyTargetReadsIntroduced: 0,
      callFrameEvaluationsUsed: 0, calleeOperandStackObserved: false, inspectionFailed: false };
    let callerSource;
    try {
      const caller = frames?.[1], callerScript = caller?.location?.scriptId;
      if (!callerScript) throw 0;
      if (Number.isInteger(scripts.get(callerScript)?.length) && scripts.get(callerScript).length > 128) return;
      callerSource = immediate('Debugger.getScriptSource', { scriptId: callerScript }).scriptSource;
      if (typeof callerSource !== 'string' || callerSource.length > 128) return callerSource;
      result.callerSourceWithinLimit = true;
      const callee = tinyCallerCallee(callerSource);
      if (!callee) return callerSource;
      result.callShapeMatched = true; result.callerParameterCount = callee.parameterCount;
      result.callArgumentCount = callee.argumentCount; result.firstArgumentEndsInComputedRead = callee.firstArgumentEndsInComputedRead;
      const scopeKinds = ['local', 'closure', 'script', 'global', 'block', 'catch', 'eval', 'module'];
      const scopes = caller.scopeChain || [];
      let fn;
      for (const scope of scopes.slice(0, 16)) {
        if (!scopeKinds.includes(scope.type) || !scope.object?.objectId) { result.unsupportedScope = true; break; }
        result.scopeCount++;
        const properties = immediate('Runtime.getProperties', { objectId: scope.object.objectId, ownProperties: true,
          accessorPropertiesOnly: false, generatePreview: false }).result;
        if (!Array.isArray(properties)) throw 0;
        if (properties.length > 4096) { result.descriptorLimitReached = true; break; }
        result.descriptorCount += properties.length;
        const descriptor = properties.find(property => property.name === callee.name);
        if (!descriptor) continue;
        result.bindingFound = true; result.bindingScope = scope.type;
        if (!Object.hasOwn(descriptor, 'value')) { result.accessorBindingBlocked = true; break; }
        const value = descriptor.value;
        result.bindingType = ['undefined', 'object', 'boolean', 'number', 'bigint', 'string', 'symbol', 'function'].includes(value?.type) ? value.type : 'other';
        if (value?.type === 'function' && value.objectId) fn = value;
        break;
      }
      if (!result.bindingFound && scopes.length > 16) result.scopeLimitReached = true;
      if (!fn) return callerSource;
      const properties = immediate('Runtime.getProperties', { objectId: fn.objectId, ownProperties: true, generatePreview: false });
      const location = properties.internalProperties?.find(property => property.name === '[[FunctionLocation]]')?.value?.value;
      if (!location || typeof location.scriptId !== 'string') return callerSource;
      result.functionLocationAvailable = true; result.sameAsGetterCallerScript = location.scriptId === callerScript;
      result.targetProvenance = kindFor(location.scriptId);
      if (Number.isInteger(scripts.get(location.scriptId)?.length) && scripts.get(location.scriptId).length > 131072) {
        result.targetSourceTooLarge = true; return callerSource;
      }
      const source = immediate('Debugger.getScriptSource', { scriptId: location.scriptId }).scriptSource;
      if (typeof source !== 'string') throw 0;
      if (source.length > 131072) { result.targetSourceTooLarge = true; return callerSource; }
      result.targetSourceRetrieved = true;
      const summary = summarizeSource(source, references), offset = sourceOffset(source, location);
      result.exactProvidedOriginalSource = summary.exactOriginalMatch;
      result.pinnedOuterSource = references.pinned && summary.exactOriginalMatch;
      result.pinnedEmbeddedSource = references.pinned && summary.embeddedExactTailMatch && summary.embeddedTailPrefixWhitespaceOnly;
      const anchor = 'mM=function(l,C,F){', anchorIndex = source.indexOf(anchor);
      result.exactPinnedMMLocation = result.pinnedEmbeddedSource && anchorIndex >= 0 &&
        source.indexOf(anchor, anchorIndex + 1) < 0 && offset === anchorIndex + 'mM=function'.length;
      if (offset === undefined) return callerSource;
      const definition = functionAtLocation(source, offset);
      if (!definition) return callerSource;
      result.functionLocationMatched = true; result.calleeParameterCount = definition.params.length;
      const bodyNodes = definition.body.type === 'BlockStatement' ? definition.body.body : [definition.body];
      result.functionBodyKindLimitReached = bodyNodes.length > 16;
      result.calleeBodyNodeKinds = bodyNodes.slice(0, 16).map(node => AST_KINDS.has(node.type) ? node.type : 'other');
      result.calleeAstShape = callerAstShape(source.slice(definition.start, definition.end));
    } catch { result.inspectionFailed = true; }
    return callerSource;
  }
  function inspectUnknownCaller(frames,names,kind,knownSource) {
    // One private lookup per bounded unknown script. Script IDs are private map
    // keys only; no callFrame object, source, URL or arbitrary value is retained.
    const scriptId=frames?.[1]?.location?.scriptId;
    const entry=scripts.get(scriptId);
    if (!scriptId || (kind!=='unknown' && entry?.kind!=='anonymous')) return;
    let record=unknownSources.get(scriptId);
    if (record) { record.hits=Math.min(maxHits,record.hits+1);return; }
    if (unknownSources.size>=maxUnknownSources) { state.callerSourceLimitReached=true;return; }
    record={ firstGetter:names.find(name=>eventGetterNames.includes(name)) || 'other', hits:1, initialCallerKind:kind,
      parseNotificationSeen:!!entry, parentFramesObserved:!!entry?.parents?.length,
      officialParentObserved:!!entry?.parents.some(id=>kindFor(id)==='official'),
      helperParentObserved:!!entry?.parents.some(id=>kindFor(id)==='helper'),
      sourceRetrieved:false, inspectionFailed:false };
    unknownSources.set(scriptId,record);state.callerSourceInspections.push(record);
    if (typeof knownSource === 'string') { record.sourceRetrieved = true; record.source = summarizeSource(knownSource, references); return; }
    state.sourceInspectionPending++;
    const pending=post('Debugger.getScriptSource',{scriptId}).then(result=>{
      if (typeof result?.scriptSource!=='string') throw 0;
      if (!disposed) { record.sourceRetrieved=true;record.source=summarizeSource(result.scriptSource,references); }
    }).catch(()=>{ if (!disposed) {record.inspectionFailed=true;state.sourceInspectionErrors++;} }).finally(()=>{
      pendingSources.delete(pending);state.sourceInspectionPending--;
    });
    pendingSources.add(pending);
  }
  function removeOwnBreakpoints() {
    const pending = [...breakpoints.keys()];
    breakpoints.clear();
    // Issue all removals synchronously while still in the pause callback. A
    // Promise-only deferred loop would leave later getter breakpoints active
    // until the running event handler returned and could cause excessive pauses.
    const batch = pending.map(breakpointId => post('Debugger.removeBreakpoint', { breakpointId })
      .then(() => { state.removedBreakpoints++; }, () => { state.inspectorErrors++; }));
    removals = Promise.all([removals, ...batch]).then(() => {});
    return removals;
  }
  const paused = ({ params }) => {
    try {
      const names = (params.hitBreakpoints || []).flatMap(id => breakpoints.get(id) || []);
      if (!names.length) { state.unexpectedPauses++; return; }
      if (!active || disposed) return;
      state.pauses++;
      const kind = callerKind(params.callFrames);
      for (const name of new Set(names)) { state.reads[name].total++; state.reads[name][kind]++; }
      const callerSource = inspectActualCallee(params.callFrames, names, kind);
      inspectUnknownCaller(params.callFrames,names,kind,callerSource);
      if (state.pauses >= maxHits) {
        active = false; state.limitReached = true;
        void removeOwnBreakpoints();
      }
    } catch { state.inspectorErrors++; }
    finally { resume(); }
  };
  async function dispose() {
    if (cleanupPromise) return cleanupPromise;
    active = false;
    cleanupPromise = (async () => {
      clearTimeout(timer);
      await activationPromise?.catch(()=>{});
      await removeOwnBreakpoints();
      await Promise.all([...pendingSources]);
      if (registryPresent) { delete globalThis[registryKey]; registryPresent = false; }
      if (connected) {
        await post('Runtime.releaseObjectGroup', { objectGroup }).catch(() => { state.inspectorErrors++; });
        await post('Debugger.disable').catch(() => { state.inspectorErrors++; });
        // Keep auto-resume installed until our debugger has been disabled.
        session.off('Debugger.paused', paused); session.off('Debugger.scriptParsed', parsed);
        try { session.disconnect(); } catch { state.inspectorErrors++; }
        connected = false;
      }
      scripts.clear(); functions.clear(); unknownSources.clear(); references={}; disposed = true; state.disposed = true;
    })();
    return cleanupPromise;
  }
  async function start() {
    if (disposed || cleanupPromise) throw new EventGetterDiagnosticsError('INVALID_OPTIONS');
    if (!activationPromise) activationPromise=(async()=>{
    Object.defineProperty(globalThis, registryKey, { value: Object.fromEntries(functions), configurable: true });
    registryPresent = true;
    const byFunction = new Map();
    for (const [name, fn] of functions) if (fn) {
      const names = byFunction.get(fn) || []; names.push(name); byFunction.set(fn, names);
    }
    for (const names of byFunction.values()) {
      if (cleanupPromise) throw new EventGetterDiagnosticsError('INSPECTOR_SETUP_FAILED');
      const response = await post('Runtime.evaluate', { expression: 'globalThis[' + JSON.stringify(registryKey) + '][' + JSON.stringify(names[0]) + ']',
        returnByValue: false, silent: true, objectGroup });
      if (cleanupPromise) throw new EventGetterDiagnosticsError('INSPECTOR_SETUP_FAILED');
      if (response.exceptionDetails || !response.result?.objectId) throw new EventGetterDiagnosticsError('INSPECTOR_SETUP_FAILED');
      const breakpoint = await post('Debugger.setBreakpointOnFunctionCall', { objectId: response.result.objectId });
      if (typeof breakpoint.breakpointId !== 'string') throw new EventGetterDiagnosticsError('INSPECTOR_SETUP_FAILED');
      breakpoints.set(breakpoint.breakpointId, names);state.installedBreakpoints++;
    }
    delete globalThis[registryKey]; registryPresent = false;
    await post('Runtime.releaseObjectGroup', { objectGroup });
    if (disposed || cleanupPromise) throw new EventGetterDiagnosticsError('INVALID_OPTIONS');
    active = true;state.activated=true;
    })().catch(()=>{ throw new EventGetterDiagnosticsError('INSPECTOR_SETUP_FAILED'); });
    try { return await activationPromise; }
    catch { await dispose(); throw new EventGetterDiagnosticsError('INSPECTOR_SETUP_FAILED'); }
  }
  try {
    session.connect(); connected = true;
    session.on('Debugger.paused', paused); session.on('Debugger.scriptParsed', parsed);
    await post('Debugger.enable');
    // Bound the complete inspector lease, including a deferred initialization.
    timer = setTimeout(() => { state.durationReached = true; void dispose(); }, maxDurationMs);
    timer.unref?.();
    if (!deferActivation) await start();
  } catch {
    await dispose();
    throw new EventGetterDiagnosticsError('INSPECTOR_SETUP_FAILED');
  }
  return { snapshot() { return JSON.parse(JSON.stringify(state)); }, start,
    async flush() { await Promise.all([...pendingSources]); }, dispose };
}
