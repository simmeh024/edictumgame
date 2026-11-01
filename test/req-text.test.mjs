// The game reads an edict's condition as text when it loads (which helpers it calls: geo, hasNb, leaderAge…), but the
// build minifies the game, which renames those helpers inside the function. So the build keeps each condition's text
// beside it (reqSrc) and the game reads it through reqText. Run with: node --test test/req-text.test.mjs
import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {parse} from 'acorn';
import {transformSync} from 'esbuild';
import {splitContent} from '../scripts/split-content.mjs';

const html=readFileSync(new URL('../game/edictum.html',import.meta.url),'utf8'),script=html.match(/<script>([\s\S]*)<\/script>\s*$/)[1];
const READER=script.match(/function reqText\(is\)\{.*\}/)[0];
/* as build.py minifies the game */
const minify=code=>transformSync(code,{loader:'js',minify:true,charset:'utf8',logLevel:'error'}).code;
const run=(code,content)=>{const ctx=vm.createContext({});ctx.window=ctx;ctx.__edictum={};if(content)vm.runInContext(content,ctx);vm.runInContext(code,ctx);return JSON.parse(JSON.stringify(ctx.result));};
const FUNCTIONS=new Set(['FunctionExpression','FunctionDeclaration','ArrowFunctionExpression']);
const key=p=>p.type==='Property'&&!p.computed&&(p.key.name||p.key.value);
function objects(code){const out=[],walk=n=>{if(n.type==='ObjectExpression')out.push(n);for(const v of Object.values(n))if(Array.isArray(v)){for(const x of v)if(x&&typeof x.type==='string')walk(x);}else if(v&&typeof v.type==='string')walk(v);};walk(parse(code,{ecmaVersion:'latest'}));return out;}

test('after minifying, a condition still reads as written, and the weight it earns survives',()=>{
  const src=`(()=>{function geo(n,t){return !!(n.geo&&n.geo[t]);}function hasNb(n){return !!n.nb;}${READER}
    const ISSUES=[{id:'shore',req:n=>geo(n,'coast'),o:[]},{id:'border',req:n=>hasNb(n),o:[]},{id:'plain',o:[]}];
    ISSUES.forEach(is=>{if(is.req&&/geo\\(|hasNb\\(/.test(reqText(is)))is.w=3;});
    window.result=ISSUES.map(is=>({id:is.id,w:is.w,text:reqText(is),raw:is.req?String(is.req):'',ok:is.req?is.req({geo:{coast:1},nb:1}):null}));})();`;
  const split=splitContent(src),[shore,border,plain]=run(minify(split.code),minify(split.content));
  assert.doesNotMatch(shore.raw,/geo\(/,'minifying renames the helper inside the condition');
  assert.deepEqual([shore.text,border.text,plain.text],["n=>geo(n,'coast')",'n=>hasNb(n)',''],'the text is the condition as written');
  assert.deepEqual([shore.w,border.w,plain.w],[3,3,undefined],'so the weight still follows the condition');
  assert.deepEqual([shore.ok,border.ok],[true,true],'and the conditions still work');
  assert.deepEqual(run(minify(src)).map(x=>x.w),[undefined,undefined,undefined],'without the kept text, minifying loses the weights');
});

test('every condition in the real catalogues keeps its text through the build',()=>{
  const reqs=code=>objects(code).map(o=>({o,req:o.properties.find(p=>key(p)==='req'&&FUNCTIONS.has(p.value.type))})).filter(x=>x.req);
  const split=splitContent(script),kept=reqs(split.code);
  assert(kept.length>600,'the catalogues have hundreds of conditions: '+kept.length);
  for(const {o,req} of kept){
    const src=o.properties.find(p=>key(p)==='reqSrc');
    assert(src&&src.value.type==='Literal','a condition keeps its text: '+split.code.slice(req.value.start,req.value.end));
    assert.equal(src.value.value,split.code.slice(req.value.start,req.value.end));
  }
  assert.equal(reqs(script).length,kept.length,'no condition outside a catalogue is counted');
  const built=minify(split.code);
  assert.equal(built.split('reqSrc:').length-1,kept.length,'every kept text survives minifying');
  assert(built.includes('reqSrc:"n=>hasNb(n)"')&&built.includes('reqSrc:"n=>leaderAge(n)>=72"'),'as written');
});

test('the game reads conditions only through reqText, which prefers the kept text',()=>{
  assert.doesNotMatch(script.replace(READER,''),/String\([\w.]+\.req\)|\.req\.toString\(|\.req\s*\+\s*''/,'every check goes through reqText');
  const ctx=vm.createContext({});vm.runInContext(READER,ctx);
  assert.equal(ctx.reqText({reqSrc:"n=>geo(n,'coast')",req:e=>G(e,'coast')}),"n=>geo(n,'coast')");
  assert.equal(ctx.reqText({req:n=>hasNb(n)}),'n=>hasNb(n)','an unbuilt game reads the function itself');
  assert.equal(ctx.reqText({}),'');
});
