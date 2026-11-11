import {Readable, type Writable} from 'node:stream';
import {pipeline} from 'node:stream/promises';

export type CsvDownloadResponse={setHeader:(name:string,value:string)=>unknown};

export function setPrivateCsvDownloadHeaders(response:CsvDownloadResponse,filename:string){
 const safeFilename=filename.replace(/[^a-zA-Z0-9._-]/g,'_');
 response.setHeader('Content-Type','text/csv; charset=utf-8');
 response.setHeader('Content-Disposition',`attachment; filename="${safeFilename}"`);
 response.setHeader('Cache-Control','private, no-store, max-age=0');
 response.setHeader('Pragma','no-cache');
 response.setHeader('X-Content-Type-Options','nosniff');
}
export async function streamCsvDownload(rows: AsyncIterable<string>, response: Writable) {
 try {
  await pipeline(Readable.from(rows), response);
 } catch (error) {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  if (response.destroyed && (code === 'ERR_STREAM_PREMATURE_CLOSE' || code === 'ECONNRESET')) return;
  throw error;
 }
}
