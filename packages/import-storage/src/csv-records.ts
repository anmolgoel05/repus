import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {parse} from 'csv-parse';

/** Own both streams so source errors and early consumer exits cannot leave an import running. */
export async function* readCsvRecords(input:Readable):AsyncGenerator<unknown[]>{
 const parser=parse({bom:true,skip_empty_lines:true,trim:true,relax_column_count:true});
 const completion=pipeline(input,parser);
 // Observe a pipeline rejection immediately while the iterator receives the same failure.
 void completion.catch(()=>{});
 try{
  for await(const record of parser)yield record as unknown[];
  await completion;
 }finally{
  input.destroy();
  parser.destroy();
  await completion.catch(()=>{});
 }
}
