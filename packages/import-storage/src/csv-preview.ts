import {Readable} from 'node:stream';
import {readCsvRecords} from './csv-records';
export {serializeCsvRow} from './csv-safety';

export class CsvInspectionError extends Error {}
export type CsvPreview={headers:string[];preview:Array<Record<string,string>>;totalRows:number};
/** Stream a CSV once while retaining only its header and a handful of preview records. */
export async function inspectCsvPreview(input:Readable,maxRows=100_000):Promise<CsvPreview>{
 let headers:string[]=[];let headerSeen=false;let totalRows=0;const preview:Array<Record<string,string>>=[];
 for await(const raw of readCsvRecords(input)){
  const row=(raw as unknown[]).map(value=>String(value??''));
  if(!headerSeen){
   headerSeen=true;headers=row.map(value=>value.trim());
   if(headers.length===0||headers.length>100||headers.some(value=>!value||value.length>100)||new Set(headers.map(value=>value.toLowerCase())).size!==headers.length)throw new CsvInspectionError('The CSV needs a header row with unique, non-empty column names up to 100 characters (up to 100 columns).');
   continue;
  }
  totalRows++;
  if(totalRows>maxRows)throw new CsvInspectionError(`CSV files can contain up to ${maxRows.toLocaleString()} data rows.`);
  if(preview.length<5){const record=Object.create(null) as Record<string,string>;headers.forEach((header,index)=>record[header]=String(row[index]??''));preview.push(record);}
 }
 if(!headerSeen)throw new CsvInspectionError('The CSV is empty or has no header row.');
 return {headers,preview,totalRows};
}
