import {beforeEach,describe,expect,it,vi} from 'vitest';

const {createMany}=vi.hoisted(()=>({createMany:vi.fn()}));
vi.mock('@repus/database',()=>({prisma:{abuseReport:{createMany}},withPublicAbuseReport:async(fn:()=>Promise<unknown>)=>fn()}));
import {AbuseReportsService} from './abuse-reports';

describe('public abuse report intake',()=>{
 beforeEach(()=>vi.clearAllMocks());
 it('normalizes report fields and stores the report through the restricted public context',async()=>{
  createMany.mockResolvedValue({count:1});
  const result=await new AbuseReportsService().submit({senderEmail:'  SENDER@EXAMPLE.COM ',campaignReference:' spring offer ',messageId:' msg-123 ',contactEmail:' Reader@Example.com ',category:'unsolicited',details:' This marketing message was not requested by me. '});
  expect(result).toEqual({received:true});
  expect(createMany).toHaveBeenCalledWith({data:[{senderAddress:'sender@example.com',campaignReference:'spring offer',messageId:'msg-123',reporterEmail:'reader@example.com',category:'unsolicited',details:'This marketing message was not requested by me.'}]});
 });
 it('rejects blank explanations after trimming',async()=>{
  await expect(new AbuseReportsService().submit({senderEmail:'sender@example.com',category:'other',details:'                    '} as any)).rejects.toThrow('at least 20 characters');
  expect(createMany).not.toHaveBeenCalled();
 });
});
