import {describe,expect,it} from 'vitest';
import {hasDmarcPolicyRecord,hasSesSpfRecord} from './dns-readiness';

describe('sending domain DNS readiness',()=>{
 it('accepts one SPF record with the exact case-insensitive SES include mechanism',()=>{
  expect(hasSesSpfRecord([['V=SPF1 INCLUDE:AMAZONSES.COM ~ALL']])).toBe(true);
  expect(hasSesSpfRecord([['v=spf1 include:amazonses.com. ~all']])).toBe(true);
  expect(hasSesSpfRecord([['v=spf1 include:amazonses.com ~all'],['v=spf1 include:other.example ~all']])).toBe(false);
 });
 it('rejects SPF lookalike domains and malformed version tokens',()=>{
  expect(hasSesSpfRecord([['v=spf1 include:notamazonses.com ~all']])).toBe(false);
  expect(hasSesSpfRecord([['v=spf10 include:amazonses.com ~all']])).toBe(false);
  expect(hasSesSpfRecord([['v=spf1 include:amazonses.com.example ~all']])).toBe(false);
 });
 it('requires one valid DMARC policy with a supported p tag',()=>{
  expect(hasDmarcPolicyRecord([['V=DMARC1; p=none; rua=mailto:reports@example.com']])).toBe(true);
  expect(hasDmarcPolicyRecord([['v=DMARC1; p=quarantine']])).toBe(true);
  expect(hasDmarcPolicyRecord([['v=DMARC1; p=']])).toBe(false);
  expect(hasDmarcPolicyRecord([['v=DMARC1; p=none'],['v=DMARC1; p=reject']])).toBe(false);
 });
 it('rejects duplicate and malformed DMARC tags',()=>{
  expect(hasDmarcPolicyRecord([['v=DMARC1; p=none; p=reject']])).toBe(false);
  expect(hasDmarcPolicyRecord([['v=DMARC1; reporting=true']])).toBe(false);
  expect(hasDmarcPolicyRecord([['v=DMARC1x; p=none']])).toBe(false);
 });
});
