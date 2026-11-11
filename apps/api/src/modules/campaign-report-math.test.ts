import {describe,expect,it} from 'vitest';
import {percentageOfAccepted} from './campaign-report-math';

describe('campaign reporting rates',()=>{
 it('calculates percentages to one decimal place against accepted sends',()=>{
  expect(percentageOfAccepted(1,3)).toBe(33.3);
  expect(percentageOfAccepted(8,10)).toBe(80);
 });
 it('does not invent a rate before any provider acceptance',()=>{
  expect(percentageOfAccepted(0,0)).toBeNull();
 });
});
