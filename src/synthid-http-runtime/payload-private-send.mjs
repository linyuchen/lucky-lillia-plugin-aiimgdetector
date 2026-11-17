// For trusted, validated private inspector packets. Only the mutable local
// byte arrays can be zeroed; JSON strings and OS pipe copies are transient.
export async function sendPrivatePayload(send,envelope){
 try{return await send(envelope);}
 finally{
  const records=envelope.result?.records;
  if(Array.isArray(records))for(let i=0;i<records.length;i++){
   const bytes=records[i]?.bytes;
   if(Array.isArray(bytes))for(let j=0;j<bytes.length;j++)bytes[j]=0;
  }
 }
}
