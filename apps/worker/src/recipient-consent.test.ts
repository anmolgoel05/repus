import {describe,expect,it} from 'vitest';
import {recipientConsentAllowsSend,type ContactConsentSnapshot} from './recipient-consent';

describe('campaign recipient consent binding',()=>{
 const consented:ContactConsentSnapshot={normalizedEmail:'alice@example.test',status:'SUBSCRIBED',consentAt:new Date('2026-01-01T00:00:00Z'),consentSource:'signup form',deletedAt:null};

 it('allows sends to the normalized consented contact address independent of casing and whitespace',()=>{
  expect(recipientConsentAllowsSend('  ALICE@example.test ',consented)).toBe(true);
 });

 it('rejects a queued campaign snapshot after the contact address changes',()=>{
  expect(recipientConsentAllowsSend('old@example.test',{...consented,normalizedEmail:'new@example.test'})).toBe(false);
 });

 it.each([
  ['unsubscribed', {...consented,status:'UNSUBSCRIBED'}],
  ['missing consent time', {...consented,consentAt:null}],
  ['missing consent source', {...consented,consentSource:null}],
  ['deleted profile', {...consented,deletedAt:new Date()}],
 ] as const)('rejects a recipient whose contact is %s',(_reason,contact)=>{
  expect(recipientConsentAllowsSend('alice@example.test',contact)).toBe(false);
 });

 it('rejects a missing contact',()=>{
  expect(recipientConsentAllowsSend('alice@example.test',null)).toBe(false);
 });
});
