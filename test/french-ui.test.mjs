import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
const src=readFileSync(new URL('../game/edictum.html',import.meta.url),'utf8');
const block=src.slice(src.indexOf('// ===== French interface'),src.indexOf("frStart();\n"));
test('French interface: setting, dictionary and text swap',()=>{
  assert.match(src,/data-act="ui-lang" data-v="\$\{v\}"/,'Settings › Display has the language buttons');
  assert.match(src,/\[\['en','English'\],\['fr','Français'\]\]/);
  const store={};globalThis.localStorage={getItem:k=>store[k]??null,setItem:(k,v)=>{store[k]=v}};
  const f=new Function(block+';return {uiLang,setUiLang,frText,FR_UI};')();
  assert.equal(f.uiLang(),'en');f.setUiLang('fr');assert.equal(f.uiLang(),'fr');
  const n={nodeValue:'  Settings ',parentNode:null};f.frText(n);assert.equal(n.nodeValue,'  Paramètres ');
  const u={nodeValue:'my own words',parentNode:null};f.frText(u);assert.equal(u.nodeValue,'my own words');
  let sets=0;const same={parentNode:null};Object.defineProperty(same,'nodeValue',{get:()=>'Nation',set:()=>{sets++}});f.frText(same);assert.equal(sets,0,'a word that is the same in French is never rewritten (that looped forever)');
  for(const [k,v] of Object.entries(f.FR_UI))assert.ok(k.trim()&&v.trim(),k);
});
