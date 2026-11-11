export function canStoreImage(usedBytes:number,incomingBytes:number,limitBytes:number){
 return Number.isSafeInteger(usedBytes)&&Number.isSafeInteger(incomingBytes)&&Number.isSafeInteger(limitBytes)&&usedBytes>=0&&incomingBytes>0&&limitBytes>=0&&usedBytes+incomingBytes<=limitBytes;
}
