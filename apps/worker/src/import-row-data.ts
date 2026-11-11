export function safeImportRowData(fields:Record<string,string>){
// eslint-disable-next-line no-control-regex -- Remove unsafe control characters from email and CSV content.
 return Object.fromEntries(Object.entries(fields).map(([key,value])=>[key,value.replace(/\u0000/g,'�').slice(0,500)]));
}
