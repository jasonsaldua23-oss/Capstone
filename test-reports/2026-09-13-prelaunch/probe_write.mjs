// Audit: execute the production write wrapper with an ambiguous post-commit disconnect.
import { apiWrite } from '../../src/lib/api-write.ts';
let commits=0;
const response=await apiWrite(async()=>{
  commits++;
  if(commits===1) throw new TypeError('Simulated response lost after commit');
  return Response.json({success:true});
},{retryDelayMs:0});
console.log(JSON.stringify({probe:'write_replayed_after_commit',commits,status:response.status}));
