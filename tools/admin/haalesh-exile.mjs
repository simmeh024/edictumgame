import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {armExile} from '../../functions/haalesh-exile.js';
const require=createRequire(new URL('../../functions/package.json',import.meta.url));
const {initializeApp,applicationDefault}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore');
if(process.argv[1]&&fileURLToPath(import.meta.url)===fs.realpathSync(process.argv[1])){
 const args=process.argv.slice(2),value=k=>{const i=args.indexOf(k);return i<0?null:args[i+1];},project=value('--project'),publishAt=Date.parse(value('--publish-at')||'');
 if(!project||!Number.isFinite(publishAt))throw new Error('Usage: node tools/admin/haalesh-exile.mjs --project PROJECT --publish-at ISO_TIMESTAMP [--apply]');
 if(!process.env.FIRESTORE_EMULATOR_HOST&&!process.env.GOOGLE_APPLICATION_CREDENTIALS)throw new Error('Set GOOGLE_APPLICATION_CREDENTIALS.');
 initializeApp({projectId:project,...(!process.env.FIRESTORE_EMULATOR_HOST?{credential:applicationDefault()}:{})});
 console.log(JSON.stringify(await armExile(getFirestore(),{publishAt,apply:args.includes('--apply')}),null,2));
}
