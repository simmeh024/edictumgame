// Package the exact trusted game model for the server clock. No browser or network is needed at runtime.
import {readFileSync,writeFileSync} from 'node:fs';
import {gzipSync} from 'node:zlib';
const html=readFileSync(new URL('../game/edictum.html',import.meta.url),'utf8'),boot="if(hot&&typeof hot.ready==='function')hot.ready(start);else start((hot&&hot.data)||{});";
let source=html.slice(html.indexOf('<script>')+8,html.lastIndexOf('</script>'));
if(!source.includes(boot))throw new Error('The server world boot marker changed.');
source=source.replace(boot,'/* Server world: never start, connect, render or save. */');
writeFileSync(new URL('../functions/exile-world-source.gz',import.meta.url),gzipSync(source,{level:9}));
console.log('Packaged the trusted server world model.');
