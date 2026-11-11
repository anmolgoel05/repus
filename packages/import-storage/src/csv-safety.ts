// eslint-disable-next-line no-control-regex -- Remove unsafe control characters from email and CSV content.
const FORMULA_PREFIX=/^[\u0000-\u0020\u007f\uFEFF]*[=+\-@]/;
const SAFE_NEGATIVE_NUMBER=/^-(?:0|[1-9]\d*)(?:\.\d+)?$/;
// eslint-disable-next-line no-control-regex -- Remove unsafe control characters from email and CSV content.
const LEADING_CONTROL=/^[\u0000-\u001f\u007f]/;

export function serializeCsvRow(values:string[]){
 return `${values.map(value=>{
  const safe=LEADING_CONTROL.test(value)||(FORMULA_PREFIX.test(value)&&!SAFE_NEGATIVE_NUMBER.test(value))?`'${value}`:value;
  return `"${safe.replace(/"/g,'""')}"`;
 }).join(',')}\r\n`;
}
