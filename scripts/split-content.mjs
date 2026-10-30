// Keep static fiction cached across code-only releases. Parse JavaScript rather than rewriting quoted
// source with a regex: escaped text stays identical, and predicates keep their original lexical scope.
import {parse} from 'acorn';
import {fileURLToPath} from 'node:url';
const CATALOGS=new Set(['ISSUES','REGIONS_EXTRA','NPCS_MER','NPC_VOICE','NPC_CULTURE','NPC_CITY_DEF']);
const FUNCTIONS=new Set(['FunctionExpression','FunctionDeclaration','ArrowFunctionExpression']);
export function splitContent(source){
  const tree=parse(source,{ecmaVersion:'latest'}),texts=[],index=new Map(),edits=[];
  const children=(node,visit)=>{for(const value of Object.values(node))if(Array.isArray(value)){for(const x of value)if(x&&typeof x.type==='string')visit(x,node);}else if(value&&typeof value.type==='string')visit(value,node);};
  function collect(node,parent){
    if(FUNCTIONS.has(node.type))return; // req() functions and other closures remain in the game.
    if(node.type==='TemplateLiteral'&&(node.expressions.length||parent?.type==='TaggedTemplateExpression'))return;
    const value=node.type==='Literal'&&typeof node.value==='string'?node.value:
      node.type==='TemplateLiteral'&&node.expressions.length===0?node.quasis[0].value.cooked:null;
    if(typeof value==='string'&&value.length>=80&&!(parent?.type==='Property'&&parent.key===node)){
      let id=index.get(value);if(id===undefined){id=texts.length;index.set(value,id);texts.push(value);}
      edits.push({start:node.start,end:node.end,text:'__edictumTexts['+id+']'});return;
    }
    children(node,collect);
  }
  function visit(node){
    if(node.type==='Identifier'&&node.name==='__edictumTexts')throw new Error('Reserved content-table identifier is already used');
    if(node.type==='VariableDeclarator'&&CATALOGS.has(node.id.name)&&node.init){collect(node.init,null);return;}
    children(node,visit);
  }
  visit(tree);
  // Join the pieces once: splicing each edit into the whole script copied it 13,000 times (about a minute).
  const parts=[];let at=0;
  for(const edit of edits.sort((a,b)=>a.start-b.start)){parts.push(source.slice(at,edit.start),edit.text);at=edit.end;}
  parts.push(source.slice(at));
  let code=parts.join('');
  code='(()=>{const __edictumTexts=window.__edictum&&window.__edictum.texts;'+
    'if(!Array.isArray(__edictumTexts)){if(window.__edictum&&window.__edictum.bootError)window.__edictum.bootError();return;}\n'+code+'\n})();';
  return {code,content:'window.__edictum.texts=Object.freeze('+JSON.stringify(texts)+');',count:texts.length};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
  process.stdin.setEncoding('utf8'); // Keep Unicode characters intact across input-buffer boundaries.
  let source='';for await(const chunk of process.stdin)source+=chunk;
  process.stdout.write(JSON.stringify(splitContent(source)));
}
