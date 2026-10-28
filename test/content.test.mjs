import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {parse} from 'acorn';
import {splitContent} from '../scripts/split-content.mjs';
const LONG='A long story with accents: naïve, forêt, € and 🦁. '.repeat(4);
const run=(source,content)=>{
  const ctx=vm.createContext({});ctx.window=ctx;ctx.__edictum={bootError:()=>{ctx.failed=true;}};
  if(content)vm.runInContext(content,ctx);vm.runInContext(source,ctx);return ctx;
};
test('catalog text preserves escapes, Unicode, templates and private predicate closures',()=>{
  const src=`(()=>{const helper=n=>n+1;const ISSUES=[{q:${JSON.stringify(LONG+'\n"quoted" \\')},t:\`${LONG}\`,req:n=>helper(n),key:${JSON.stringify(LONG)}}];const later=n=>n*2;window.result={q:ISSUES[0].q,t:ISSUES[0].t,key:ISSUES[0].key,answer:ISSUES[0].req(later(3))};})();`;
  const split=splitContent(src),a=run(src),b=run(split.code,split.content);
  assert.deepEqual(JSON.parse(JSON.stringify(a.result)),JSON.parse(JSON.stringify(b.result)));
  assert.equal(split.count,2);assert.ok(Object.isFrozen(b.__edictum.texts));
});
test('code-only updates retain the exact cached content file; story-only updates can retain code',()=>{
  const src=`(()=>{const ISSUES=[{q:${JSON.stringify(LONG)}}];window.result=1;})();`;
  const a=splitContent(src),b=splitContent(src.replace('result=1','result=2')),c=splitContent(src.replace('naïve','clever'));
  assert.equal(a.content,b.content);assert.notEqual(a.code,b.code);
  assert.notEqual(a.content,c.content);assert.equal(a.code,c.code);
});
test('text in predicates, computed templates and ordinary UI code is left in its original scope',()=>{
  const src=`(()=>{const helper=()=>${JSON.stringify(LONG)};const ISSUES=[{req:n=>helper()+${JSON.stringify(LONG)},q:\`value \${helper()}\`,raw:String.raw\`${LONG}\\n\`}];window.result=ISSUES[0].req(1)+ISSUES[0].q+ISSUES[0].raw;})();`;
  const a=splitContent(src);assert.equal(a.count,0);
  assert.equal(run(src).result,run(a.code,a.content).result);
});
test('missing content stops safely before the game runs',()=>{
  const split=splitContent(`const ISSUES=[{q:${JSON.stringify(LONG)}}];window.result='started';`),ctx=run(split.code);
  assert.equal(ctx.failed,true);assert.equal(ctx.result,undefined);
});
test('all production predicates remain byte-for-byte unchanged by content extraction',()=>{
  const html=readFileSync(new URL('../game/edictum.html',import.meta.url),'utf8'),source=html.match(/<script>([\s\S]*)<\/script>\s*$/)[1],split=splitContent(source);
  const functions=src=>{const out=[],walk=n=>{if(['FunctionExpression','ArrowFunctionExpression','FunctionDeclaration'].includes(n.type))out.push(src.slice(n.start,n.end));for(const v of Object.values(n))if(Array.isArray(v)){for(const x of v)if(x&&typeof x.type==='string')walk(x);}else if(v&&typeof v.type==='string')walk(v);};walk(parse(src,{ecmaVersion:'latest'}));return out;};
  // The outer game function contains the edited catalogs; compare its leaf functions instead.
  const leaves=xs=>xs.filter(s=>!s.includes('const ISSUES = [')&&!s.startsWith('()=>{const __edictumTexts='));
  assert.deepEqual(leaves(functions(source)),leaves(functions(split.code)));
  assert.ok(split.count>2000,'a substantial story catalog is cached separately');
});
