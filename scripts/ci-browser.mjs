// Runs one group of browser suites in CI (preview.yml, job "browser"): builds the game once, then runs each suite's
// npm script without its own build, one after another, each with its own emulators so suites cannot touch each other.
// A failing suite does not stop the rest; the job fails at the end if any did. Screenshots of each suite are moved to
// test/out/<suite>/ so a failed group keeps them apart.
// Usage: node scripts/ci-browser.mjs <group>   (groups are in test/browser-suites.json)
//        node scripts/ci-browser.mjs --check   (every suite is in one group and its script exists)
import {readFileSync,appendFileSync,readdirSync,mkdirSync,renameSync,existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import path from 'node:path';

const BUILD='python3 build.py && ';
const suites=JSON.parse(readFileSync(new URL('../test/browser-suites.json',import.meta.url),'utf8'));
const scripts=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8')).scripts;
const arg=process.argv[2];

const problems=[];
const seen=new Set();
for(const s of suites){
  if(seen.has(s.suite))problems.push(`${s.suite} is listed twice`);seen.add(s.suite);
  if(!Number.isInteger(s.group)||s.group<1)problems.push(`${s.suite} has no group`);
  const cmd=scripts[s.script];
  if(!cmd)problems.push(`${s.suite}: package.json has no script ${s.script}`);
  else if(!cmd.startsWith(BUILD))problems.push(`${s.suite}: ${s.script} does not start with "${BUILD}"`);
}
if(problems.length||arg==='--check'){
  for(const p of problems)console.error('::error::'+p);
  if(!problems.length)console.log(`${suites.length} browser suites in ${new Set(suites.map(s=>s.group)).size} groups`);
  process.exit(problems.length?1:0);
}

const group=Number(arg),mine=suites.filter(s=>s.group===group);
if(!mine.length){console.error(`::error::no browser suites in group ${arg}`);process.exit(1);}
// like npm run: the project's own tools (firebase, playwright) come from node_modules/.bin
const env={...process.env,PATH:`${path.resolve('node_modules/.bin')}${path.delimiter}${process.env.PATH}`};
const sh=(cmd)=>spawnSync(cmd,{shell:'/bin/bash',stdio:'inherit',env}).status;
const pngs=()=>existsSync('test/out')?readdirSync('test/out').filter(f=>f.endsWith('.png')):[];

console.log(`::group::Build the game once for ${mine.length} suites`);
const built=sh('python3 build.py');
console.log('::endgroup::');
if(built!==0){console.error('::error::the build failed');process.exit(1);}

const results=[];
for(const s of mine){
  const t0=Date.now();
  console.log(`::group::${s.name}`);
  const code=sh(scripts[s.script].slice(BUILD.length));
  console.log('::endgroup::');
  const secs=Math.round((Date.now()-t0)/1000);
  const shots=pngs();
  if(shots.length){mkdirSync(`test/out/${s.suite}`,{recursive:true});for(const f of shots)renameSync(`test/out/${f}`,`test/out/${s.suite}/${f}`);}
  results.push({...s,ok:code===0,secs});
  if(code===0)console.log(`✔ ${s.name} (${secs}s)`);
  else console.error(`::error title=Browser suite failed::${s.name} (${s.script}) failed after ${secs}s`);
}

const failed=results.filter(r=>!r.ok);
const table=['| Suite | Result | Time |','|---|---|---|',...results.map(r=>`| ${r.name} | ${r.ok?'✅ passed':'❌ failed'} | ${r.secs}s |`)].join('\n');
console.log('\n'+results.map(r=>`${r.ok?'✔':'✖'} ${r.name} (${r.secs}s)`).join('\n'));
if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,`### Browser group ${group}\n\n${table}\n`);
if(failed.length){console.error(`::error::${failed.length} of ${results.length} suites failed: ${failed.map(r=>r.name).join('; ')}`);process.exit(1);}
