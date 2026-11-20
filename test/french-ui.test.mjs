import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
const src=readFileSync(new URL('../game/edictum.html',import.meta.url),'utf8');
const block=src.slice(src.indexOf('// ===== French interface'),src.indexOf("frStart();\n"));
const store={};globalThis.localStorage={getItem:k=>store[k]??null,setItem:(k,v)=>{store[k]=v}};
const load=(more)=>{let b=block;if(more){const a=b.indexOf('/*FR_MORE*/'),e=b.indexOf('/*FR_MORE_END*/')+15;b=b.slice(0,a)+'const FR_MORE='+JSON.stringify(more)+';'+b.slice(e);}
  return new Function(b+';return {uiLang,setUiLang,frText,frTr,frWalk,FR_UI,FR_MORE,frPats};')();};
test('French interface: setting, dictionary and text swap',()=>{
  assert.match(src,/data-act="ui-lang" data-v="\$\{v\}"/,'Settings › Display has the language buttons');
  assert.match(src,/\[\['en','English'\],\['fr','Français'\]\]/);
  const f=load();
  assert.equal(f.uiLang(),'en');f.setUiLang('fr');assert.equal(f.uiLang(),'fr');
  const n={nodeValue:'  Settings ',parentNode:null};f.frText(n);assert.equal(n.nodeValue,'  Paramètres ');
  const u={nodeValue:'my own words',parentNode:null};f.frText(u);assert.equal(u.nodeValue,'my own words');
  let sets=0;const same={parentNode:null};Object.defineProperty(same,'nodeValue',{get:()=>'Nation',set:()=>{sets++}});f.frText(same);assert.equal(sets,0,'a word that is the same in French is never rewritten (that looped forever)');
  for(const [k,v] of Object.entries(f.FR_UI))assert.ok(k.trim()&&v.trim(),k);
});
test('French interface: patterns for texts with numbers and names',()=>{
  const f=load({d:{'Red':'Rouge','Charter of foundation':'Charte de fondation','Name your country and set out its founding principles, then edicts start arriving on your desk, and each decision you make reshapes your nation.':'Nommez votre pays…'},
    p:[['Colour {n}: {t}','Couleur {n} : {t}'],['Edict {n1} of {n2} on your desk','Édit {n1} sur {n2} sur votre bureau'],['{n} million','{n} million{n?s}'],
       ['{n} crowns','{n} {n?couronne|couronnes}'],['{x} is on the map!','{x} est sur la carte !'],['{n} {x}','never']]});
  const tr=k=>f.frTr(k);
  assert.equal(tr('Colour 2: Red'),'Couleur 2 : Rouge','{t} is translated, and the colon gets its no-break space');
  assert.equal(tr('Colour 2: Mauve'),'Couleur 2 : Mauve','{t} without French stays as it was');
  assert.equal(tr('Edict 1 of 3 on your desk'),'Édit 1 sur 3 sur votre bureau');
  assert.equal(tr('5.00 million'),'5,00 millions','numbers are written the French way, with the plural from 2');
  assert.equal(tr('1.5 million'),'1,5 million');
  assert.equal(tr('21,213 crowns'),'21 213 couronnes');assert.equal(tr('1 crowns'),'1 couronne');
  assert.equal(tr('Testmark is on the map!'),'Testmark est sur la carte !','{x} keeps the name');
  assert.equal(tr('5 apples'),'','a pattern of slots alone is never used');
  assert.equal(f.frPats().length,5);
  // spaces folded, long texts swapped, leading and trailing space kept
  const n={nodeValue:'\n    Edict 2 of 3\n    on your desk ',parentNode:null};f.frText(n);assert.equal(n.nodeValue,'\n    Édit 2 sur 3 sur votre bureau ');
  const long={nodeValue:'Name your country and set out its founding principles, then edicts start arriving on your desk, and each decision you make reshapes your nation.',parentNode:null};
  f.frText(long);assert.equal(long.nodeValue,'Nommez votre pays…','texts over 120 characters are swapped too');
  // the swap leaves its own writing alone: one write, however often the observer calls back
  let sets=0;const node={parentNode:null,v:'Colour 1: Red'};Object.defineProperty(node,'nodeValue',{get(){return this.v},set(v){sets++;this.v=v}});
  f.frText(node);f.frText(node);f.frText(node);assert.equal(sets,1);assert.equal(node.v,'Couleur 1 : Rouge');
  node.v='Colour 3: Red';f.frText(node);assert.equal(node.v,'Couleur 3 : Rouge','a new English text is swapped again');
});
test('French interface: money in the nation’s own currency',()=>{
  globalThis.plural=w=>/s$/.test(w)?w:w+'s';globalThis.S={nation:{currency:'crown'}};
  try{
    const f=load({d:{},p:[['{n} {c}','{n} {c}'],['{n} billion {c}','{n} milliard{n?s} de {c}'],['{n} billion {c} a year','{n} milliard{n?s} de {c} par an']]});
    assert.equal(f.frTr('21,213 crowns'),'21 213 couronnes','the default crown is a couronne');
    assert.equal(f.frTr('106.1 billion crowns a year'),'106,1 milliards de couronnes par an');
    assert.equal(f.frTr('3 billion people'),'','only the nation’s own currency counts as money');
    S.nation.currency='zloty';
    assert.equal(f.frTr('1.5 billion zlotys'),'1,5 milliard de zlotys','a currency of the player’s own naming stays as named');
  }finally{delete globalThis.S;delete globalThis.plural;}
});
test('French interface: the everyday-screen dictionary is sound',()=>{
  const f=load(),M=f.FR_MORE;
  assert.equal(src.split('/*FR_MORE*/').length,2,'one FR_MORE block, which build.py cuts out');
  assert.match(src,/\/\*FR_MORE\*\/const FR_MORE=\{[\s\S]*?\};\/\*FR_MORE_END\*\//);
  for(const [k,v] of Object.entries(M.d)){assert.ok(v.trim()&&v!==k,k);assert.equal(k,k.replace(/\s+/g,' ').trim(),'a key with folded spaces: '+k);}
  for(const [en,fr] of M.p){
    const has=new Set(en.match(/\{[ntx]\d?\}/g)||[]);
    for(const s of fr.match(/\{[ntx]\d?(?:\?[^}]*)?\}/g)||[])assert.ok(has.has(s.replace(/\?.*\}/,'}')),`${fr}: ${s} is not in the English`);
    assert.ok(!/\{[ntx]\d?\}\{[ntx]\d?\}/.test(en),'two slots side by side: '+en);
  }
  assert.equal(f.frPats().length,M.p.length,'every pattern compiles and has words of its own');
  const py=readFileSync(new URL('../build.py',import.meta.url),'utf8');
  assert.match(py,/FR_MORE/,'build.py cuts the French into a file of its own');
  assert.match(py,/statehood\.lang\.v1/,'and loads it only in French');
});
