import {describe,expect,it} from 'vitest';
import {shouldPromoteProviderSuppression} from './suppression-precedence';

describe('provider suppression precedence',()=>{
 it('promotes an unsubscribe after a permanent bounce or complaint',()=>{
  expect(shouldPromoteProviderSuppression('unsubscribe','hard_bounce')).toBe(true);
  expect(shouldPromoteProviderSuppression('unsubscribe','complaint')).toBe(true);
 });
 it('promotes a hard bounce to a complaint but never downgrades a complaint',()=>{
  expect(shouldPromoteProviderSuppression('hard_bounce','complaint')).toBe(true);
  expect(shouldPromoteProviderSuppression('complaint','hard_bounce')).toBe(false);
 });
 it('keeps manual and unknown suppressions sticky',()=>{
  expect(shouldPromoteProviderSuppression('manual','complaint')).toBe(false);
  expect(shouldPromoteProviderSuppression('other','hard_bounce')).toBe(false);
 });
});
