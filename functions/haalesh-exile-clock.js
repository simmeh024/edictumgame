import {onSchedule} from 'firebase-functions/v2/scheduler';
import {getFirestore} from 'firebase-admin/firestore';
import {logger} from 'firebase-functions';
import {runExileTimer} from './haalesh-exile.js';
import {settleAssemblyRegion} from './civic.js';
export const haaleshExileClock=process.env.EDICTUM_SCHEDULES==='off'?undefined:onSchedule({schedule:'* * * * *',timeZone:'Etc/UTC',region:'europe-west1',memory:'512MiB',timeoutSeconds:240,maxInstances:1,concurrency:1,retryCount:0},async()=>{
 const result=await runExileTimer(getFirestore(),{settle:settleAssemblyRegion});logger.info('Haalesh exile server clock',result);
});
