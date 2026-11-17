// Read-only structural summary of the reviewed public finalizer's envelope.
// No interpreter execution, decryption, token modification, or content output.
import { Buffer } from 'node:buffer';

const MAX_BYTES=2*1024*1024, MAX_INPUT=MAX_BYTES*2+1, MAX_LAYOUT_STEPS=512;
const WORD=65536, MAX_DIAGNOSTICS=1000000;
const ERROR_CODES=[0,17,21,22,30,31,33,36];
const emptyRecords=()=>({tag15:0,tag104:0,tag126:0,tag10:0,tag250:0,tag27:0,tag153:0});

export function inspectTokenEnvelope(token) {
  const report={schemaVersion:1,primitiveString:typeof token==='string',base64url:false,hexFallback:false,fatalPrefix:false,
    encodingValid:false,inputLimitReached:false,decodedLength:null,headerPresent:false,saltRelationship:false,initialMarker:false,
    boundaryCandidates:0,layoutSteps:0,layoutLimitReached:false,matchedLayouts:0,complete:false,ambiguous:false,structuralMismatch:false,
    opaqueMainLength:null,supplementLength:null,recordCount:0,records:emptyRecords(),
    errorPresent:false,errorLength:null,errorSchema:false,errorCodeKnown:false,errorCode:null,
    counterPresent:false,counterLength:null,encryptedPayloadPresent:false,encryptedPayloadLength:null,
    paddingPresent:false,paddingLength:null,diagnosticsPresent:false,diagnosticsLength:null,diagnosticsLengthWrapped:false,oversizeMarkers:false};
  if(!report.primitiveString) return report;
  if(token.length>MAX_INPUT) {report.inputLimitReached=true;return report;}
  if(token.startsWith('E:')) {report.fatalPrefix=true;return report;}
  let bytes;
  try {
    if(token.startsWith('!')) {
      report.base64url=true;
      const encoded=token.slice(1);
      if(!encoded.length||encoded.length%4===1||!/^[A-Za-z0-9_-]+$/.test(encoded)) return report;
      if(Math.floor(encoded.length*3/4)>MAX_BYTES) {report.inputLimitReached=true;return report;}
      bytes=Buffer.from(encoded,'base64url');
      if(bytes.toString('base64url')!==encoded) return report;
    } else {
      if(!token.length||token.length%2||!/^[0-9a-f]+$/.test(token)) return report;
      report.hexFallback=true;
      if(token.length/2>MAX_BYTES) {report.inputLimitReached=true;return report;}
      bytes=Buffer.from(token,'hex');
    }
  } catch {return report;}
  report.encodingValid=true;report.decodedLength=bytes.length;
  report.headerPresent=bytes.length>=5;
  if(!report.headerPresent) {report.structuralMismatch=true;return report;}
  report.saltRelationship=bytes[1]===(bytes[0]^3);report.initialMarker=bytes[2]===165;
  if(!report.saltRelationship||!report.initialMarker) {report.structuralMismatch=true;return report;}
  const word=offset=>(bytes[offset]<<8)|bytes[offset+1];
  const firstBoundary=((bytes[3]^bytes[1])<<8)|(bytes[4]^bytes[1]);
  let matched;
  const stopped=()=>report.layoutLimitReached||report.matchedLayouts>1;
  function step() {
    if(stopped()) return false;
    if(report.layoutSteps>=MAX_LAYOUT_STEPS) {report.layoutLimitReached=true;return false;}
    report.layoutSteps++;return true;
  }
  function accept(boundary,error,payloadLength,paddingLength,diagnosticsLength,oversize) {
    report.matchedLayouts++;
    if(report.matchedLayouts>1) {report.ambiguous=true;matched=undefined;return;}
    const records=emptyRecords();
    records.tag104=1;if(error) records.tag15=1;if(payloadLength!==null) records.tag126=1;
    if(paddingLength!==null) records.tag10=1;if(diagnosticsLength!==null) records.tag153=1;
    if(oversize) {records.tag250=1;records.tag27=1;}
    matched={opaqueMainLength:boundary-5,supplementLength:bytes.length-boundary,records,
      recordCount:Object.values(records).reduce((sum,count)=>sum+count,0),
      errorPresent:!!error,errorLength:error?.length??null,errorSchema:error?.schema??false,errorCodeKnown:error?.known??false,errorCode:error?.code??null,
      counterPresent:true,counterLength:2,encryptedPayloadPresent:payloadLength!==null,encryptedPayloadLength:payloadLength,
      paddingPresent:paddingLength!==null,paddingLength,diagnosticsPresent:diagnosticsLength!==null,diagnosticsLength,
      diagnosticsLengthWrapped:diagnosticsLength!==null&&diagnosticsLength>=WORD,oversizeMarkers:oversize};
  }
  function tail(offset,boundary,error,payloadLength) {
    if(!step()) return;
    let paddingLength=null,paddingPrefixLength=null,diagnosticsLength=null,oversize=false;
    if(bytes[offset]===10) {
      if(offset+3>bytes.length) return;
      paddingLength=word(offset+1);
      paddingPrefixLength=offset-2;
      // Public padding is derived from a value masked with 2047, minus
      // existing lengths; a positive amount cannot wrap a BE16 field.
      if(paddingLength<1||paddingLength>2047||offset+3+paddingLength>bytes.length) return;
      offset+=3+paddingLength;
    }
    if(bytes[offset]===250) {
      if(bytes[offset+1]!==27) return;
      oversize=true;offset+=2;
    }
    if(bytes[offset]===153) {
      if(offset+3>bytes.length) return;
      diagnosticsLength=bytes.length-offset-3;
      // Tag 153 is the final record. Its actual remaining byte count resolves
      // the low-16-bit length, including the 1,000,000-byte truncation path.
      if(diagnosticsLength<=4||diagnosticsLength>MAX_DIAGNOSTICS||word(offset+1)!==diagnosticsLength%WORD) return;
      if(oversize&&diagnosticsLength!==MAX_DIAGNOSTICS) return;
      offset=bytes.length;
    } else if(oversize) return;
    if(paddingLength!==null&&(oversize||paddingLength+paddingPrefixLength+5+(diagnosticsLength===null?0:diagnosticsLength+3)>2047)) return;
    if(offset===bytes.length) accept(boundary,error,payloadLength,paddingLength,diagnosticsLength,oversize);
  }
  function counter(offset,boundary,error) {
    if(!step()||offset+3>bytes.length||bytes[offset]!==104) return;
    // Exactly two following bytes: one tagged value, then an untagged value.
    // Their contents are deliberately never read.
    offset+=3;
    if(bytes[offset]!==126) {tail(offset,boundary,error,null);return;}
    if(offset+3>bytes.length) return;
    const declared=word(offset+1),available=bytes.length-offset-3;
    for(let length=declared;length<=available&&!stopped();length+=WORD) {
      if(length<=4) continue;
      tail(offset+3+length,boundary,error,length);
    }
  }
  for(let boundary=firstBoundary<5?firstBoundary+WORD:firstBoundary;boundary+3<=bytes.length&&!stopped();boundary+=WORD) {
    report.boundaryCandidates++;
    if(!step()) break;
    if(bytes[boundary]!==15) {counter(boundary,boundary,null);continue;}
    if(boundary+3>bytes.length) continue;
    const declared=word(boundary+1),available=bytes.length-boundary-3;
    for(let length=declared;length<=available&&!stopped();length+=WORD) {
      if(length===0) continue;
      const schema=length===3||length===4;
      const known=schema&&ERROR_CODES.includes(bytes[boundary+3]);
      const error={length,schema,known,code:known?bytes[boundary+3]:null};
      counter(boundary+3+length,boundary,error);
    }
  }
  if(report.matchedLayouts===1&&!report.layoutLimitReached) {Object.assign(report,matched);report.complete=true;}
  else if(!report.ambiguous&&!report.layoutLimitReached) report.structuralMismatch=true;
  return report;
}
