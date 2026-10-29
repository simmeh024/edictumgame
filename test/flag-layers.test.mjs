import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import assert from 'node:assert/strict';
const src=readFileSync(new URL('../game/edictum.html',import.meta.url),'utf8');
const plain=()=>({p:'plain',c:['#112233','#FFFFFF','#445566'],e:'star',ec:'#F2C230'});
const layer=(extra={})=>({k:'emblem',e:'star',x:50,y:50,w:24,h:36,r:0,c:'#F2C230',...extra});
const json=v=>JSON.parse(JSON.stringify(v));
function fixture(){
 const f=plain(),FG={hist:new WeakMap()},ctx=vm.createContext({FG,FID:0,FG_C4D:'#FFFFFF',FG_EP:['c','k','h','f'],PATTERNS:{plain:['Plain',1]},DEF_FLAG:plain(),EMBLEMS:{none:'None',star:'Star','e-eye':'Eye'},FG_PU:{},
  document:{addEventListener(){}},clamp:(v,a,b)=>Math.max(a,Math.min(b,v)),clone:json,czHas:(o,k)=>Object.hasOwn(o,k),safeColor:(v,d)=>typeof v==='string'&&/^#[0-9a-f]{6}$/i.test(v)?v:d,
  czU:e=>e==='e-eye'?{src:'set'}:null,czHolds:(n,e)=>n?.cz?.u?.includes(e),fgHeld:()=>false,fgSay:()=>{},fgDescribe:()=>'',fgTarget:()=>f,emblemSVG:(e,x,y,r,c)=>`<path data-emblem="${e}" fill="${c}"/>`});
 vm.runInContext(src.slice(src.indexOf('function fgOpt('),src.indexOf('NORM_HOOKS.push((n,d)=>{',src.indexOf('function fgOpt('))),ctx);
 vm.runInContext(src.slice(src.indexOf('function fgPush('),src.indexOf('function fgDone(')),ctx);
 vm.runInContext(src.slice(src.indexOf('const FGL_MAX='),src.indexOf('/* ── the Customise page: earned patterns',src.indexOf('const FGL_MAX='))),ctx);
 return {f,ctx};
}
function env(){const {f,ctx}=fixture();ctx.f=f;vm.runInContext('this.select=i=>FGL.sel.s=i;this.norm=fglNorm;this.art=fglArt;this.canon=fgCanon;this.edit=(a,v)=>fglEdit("s",a,v);this.undo=()=>flagEdit("s","undo");this.history=()=>FG.hist.get(f)||[];',ctx);return {f,c:ctx};}
test('legacy flags retain their canonical record and receive no extra SVG',()=>{const {f,c}=env(),old=json(f);assert.deepEqual(json(c.canon(f)),old);assert.equal(c.art(undefined),'');assert.equal(c.art([]),'');});
test('layer records reject unknown shapes, unknown emblems and injected attributes',()=>{const {c}=env();assert.equal(c.norm([{k:'__proto__'},{k:'emblem',e:'<script>'},null]).length,0);const a=c.norm([layer({c:'url(javascript:alert(1))',html:'<script>',onclick:'bad'})]);assert.deepEqual(Object.keys(a[0]),['k','e','x','y','w','h','r','c']);assert(!c.art(a).includes('javascript'));});
test('normalization bounds record size, coordinates, dimensions and rotations',()=>{const {c}=env();const a=c.norm(Array.from({length:100},()=>layer({x:-100,y:1000,w:0,h:999,r:999,c:'#123456'})));assert.equal(a.length,8);assert.deepEqual(json(a[0]),layer({x:0,y:100,w:2,h:150,r:180,c:'#123456'}));});
test('nonfinite values and numeric strings never reach SVG geometry',()=>{const {c}=env(),a=c.norm([layer({x:NaN,y:Infinity,w:'100',r:-Infinity})]);assert.equal(a[0].x,50);assert.equal(a[0].y,50);assert.equal(a[0].w,30);assert(!/NaN|Infinity/.test(c.art(a)));});
test('earned symbols are retained only for nations holding their unlock',()=>{const {c}=env(),a=[layer({e:'e-eye'})];assert.equal(c.norm(a,{cz:{u:[]}}).length,0);assert.equal(c.norm(a,{cz:{u:['e-eye']}}).length,1);});
test('rendering preserves stack order, clipping and independent transforms',()=>{const {c}=env();const svg=c.art([layer({k:'stripe',c:'#112233'}),layer({x:25,y:75,r:45,c:'#445566'})]);assert(svg.indexOf('#112233')<svg.indexOf('#445566'));assert(svg.includes('overflow="hidden"'));assert(svg.includes('translate(75 150) rotate(45)'));assert(svg.includes('scale(0.72 0.72)'));});
test('adding layers preserves the original pattern, colours and emblem',()=>{const {f,c}=env(),old=json(f);assert(c.edit('add','stripe'));assert.deepEqual(json(Object.fromEntries(Object.entries(f).filter(([k])=>k!=='layers'))),old);assert.equal(f.layers.length,1);assert(c.undo());assert.deepEqual(json(f),old);});
test('duplicate, reordering and removal undo as individual edits',()=>{const {f,c}=env();c.edit('add','emblem');c.edit('add','stripe');c.edit('back');assert.equal(f.layers[0].k,'stripe');c.edit('duplicate');assert.equal(f.layers.length,3);c.edit('remove');assert.equal(f.layers.length,2);c.undo();assert.equal(f.layers.length,3);c.undo();assert.equal(f.layers.length,2);c.undo();assert.equal(f.layers[1].k,'stripe');});
test('adding or duplicating a ninth layer is rejected without mutation',()=>{const {f,c}=env();for(let i=0;i<8;i++)c.edit('add','disc');const before=JSON.stringify(f);assert.equal(c.edit('add','border'),false);assert.equal(c.edit('duplicate'),false);assert.equal(JSON.stringify(f),before);});
test('precise movement stays within the flag and supports undo',()=>{const {f,c}=env();c.edit('add','emblem');c.edit('nudge',[-500,500]);assert.equal(f.layers[0].x,0);assert.equal(f.layers[0].y,100);c.undo();assert.equal(f.layers[0].x,50);});
test('alignment respects rotated layer dimensions',()=>{const {f,c}=env();c.edit('add','stripe');c.edit('set',{key:'r',v:90});c.edit('align','left');assert.equal(f.layers[0].x,5);c.edit('align','centre-x');assert.equal(f.layers[0].x,50);});
test('border alignment includes its stroke after rotation',()=>{const {f,c}=env();c.edit('add','border');c.edit('set',{key:'w',v:30});c.edit('set',{key:'h',v:30});c.edit('set',{key:'r',v:45});c.edit('align','left');const width=(90+3+60+3)/Math.sqrt(2);assert.equal(f.layers[0].x,Math.round(width/6*10)/10);});
test('invalid edits do not create empty layers or dirty a legacy flag',()=>{const {f,c}=env(),before=JSON.stringify(f);assert.equal(c.edit('add','bad'),false);assert.equal(c.edit('remove'),false);assert.equal(JSON.stringify(f),before);});
test('locked symbols cannot be applied through editor actions',()=>{const {f,c}=env();c.edit('add','emblem');assert.equal(c.edit('set',{key:'e',v:'e-eye'}),false);assert.equal(f.layers[0].e,'star');});
test('province flag tags and canonical round trips preserve every layer',()=>{const {f,c}=env();f.k='f';c.edit('add','border');c.edit('add','disc');const a=JSON.stringify(c.canon(f));assert.equal(JSON.stringify(c.canon(json(f))),a);assert.equal(f.k,'f');assert.equal(f.layers[0].b,3);});
