// The week the weekly letters (the Regional Gazette) belong to begins on Monday at 08:00 UTC, and is never in the future.
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
const src=readFileSync(new URL('../game/edictum.html',import.meta.url),'utf8');
const line=src.split('\n').find(l=>l.startsWith('const weekStart='));
const weekStart=new Function(line+';return weekStart;')();
const U=(y,m,d,h,mi=0)=>Date.UTC(y,m-1,d,h,mi);
test('the week begins on Monday at 08:00 UTC',()=>{
  assert.equal(weekStart(U(2026,11,11,12)),U(2026,11,9,8),'a Wednesday belongs to that Monday');
  assert.equal(weekStart(U(2026,11,15,23,59)),U(2026,11,9,8),'and so does the Sunday night');
  assert.equal(weekStart(U(2026,11,9,8)),U(2026,11,9,8),'Monday at 08:00 begins the week');
});
test('early on a Monday, before 08:00 UTC, it is still last week (never a start in the future)',()=>{
  for(const h of [0,3,7])assert.equal(weekStart(U(2026,11,9,h,30)),U(2026,11,2,8),`Monday ${h}:30`);
  for(let t=U(2026,1,1,0);t<U(2026,12,31,0);t+=3600e3*5+60e3)assert.ok(weekStart(t)<=t&&t-weekStart(t)<7*864e5);
});
