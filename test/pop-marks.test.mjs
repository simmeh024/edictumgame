import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
const src=fs.readFileSync(new URL('../game/edictum.html',import.meta.url),'utf8');
const pick=h=>src.split('\n').find(l=>l.startsWith(h));
const ctx={};vm.createContext(ctx);vm.runInContext(pick('function popMarkCredits(')+'\n'+pick('function popMarkNext(')+'\nthis.f=popMarkCredits;this.g=popMarkNext;',ctx);
test('population marks',()=>{const f=ctx.f;
  assert.equal(f(9.9),0);assert.equal(f(10),2);assert.equal(f(20),6);assert.equal(f(30),12);
  assert.equal(f(100),110);assert.equal(f(124),110);assert.equal(f(125),112);assert.equal(f(150),114);assert.equal(f(1000),110+2*36);
  assert.deepEqual({...ctx.g(5)},{p:10,c:2});assert.deepEqual({...ctx.g(95)},{p:100,c:20});assert.deepEqual({...ctx.g(100)},{p:125,c:2});});
