import {test}from "node:test";
import assert from "node:assert/strict";
import {entryProblems}from "../scripts/repo-policy.mjs";
const cron={path:"/api/internal/service-ecosystem/drain",schedule:"17 10 * * *"},sheet={path:"/api/internal/roster-sheet/sync",schedule:"40 9 * * *"},mail={path:"/api/internal/notifications/run",schedule:"5 14 * * *"},practice={path:"/api/internal/practice-calendar/sweep",schedule:"43 11 * * *"};
// The roster Sheet sync job was removed with the Sheet (Daniel, 2026-11-17); a config that still lists it is refused.
test("the exact reviewed daily cron config is permitted with ordinary JSON formatting and key order",()=>{
  for(const value of [{crons:[cron,mail,practice]},{crons:[cron,mail,practice].map(job=>({schedule:job.schedule,path:job.path}))}])assert.deepEqual(entryProblems("vercel.json",JSON.stringify(value,null,2)),[]);
  assert.ok(entryProblems("nested/vercel.json",JSON.stringify({crons:[cron]})).includes("data file outside reviewed allow-list"));
});
test("cron exception refuses secrets, data, extra keys/jobs, arbitrary paths/cadence and duplicate JSON members",()=>{
  const invalid=["", "null", "[]", "{}",JSON.stringify({crons:[cron,mail]}),JSON.stringify({crons:[cron,mail,{...practice,schedule:"43 * * * *"}]}),JSON.stringify({crons:[cron,mail,practice],env:{SYNTHETIC:"not-allowed"}}),JSON.stringify({crons:[cron,sheet,mail]}),JSON.stringify({crons:[cron,sheet]}),JSON.stringify({crons:[cron,{...mail,schedule:"5 * * * *"}]}),JSON.stringify({crons:[cron,mail,sheet]}),JSON.stringify({crons:[cron,cron]}),JSON.stringify({crons:[cron]}),JSON.stringify({crons:[sheet,cron]}),JSON.stringify({crons:[cron,sheet,sheet]}),JSON.stringify({crons:[{...cron,notes:"Synthetic student data"}]}),JSON.stringify({crons:[{...cron,path:"/api/other"}]}),JSON.stringify({crons:[{...cron,schedule:"* * * * *"}]}),JSON.stringify({crons:[null]}),`{"crons":[],"crons":[${JSON.stringify(cron)}]}`,`{"crons":[{"path":"synthetic-private-data","path":"${cron.path}","schedule":"${cron.schedule}"}]}`];
  invalid.push(JSON.stringify({crons:[cron,mail,{...practice,path:practice.path+"-copy"}]}),
    `{"crons":[${JSON.stringify(cron)},${JSON.stringify(mail)},{"path":"${practice.path}","schedule":"${practice.schedule}","schedule":"${practice.schedule}"}]}`);
  for(const value of invalid)assert.ok(entryProblems("vercel.json",value).includes("deployment config must contain only the reviewed daily jobs"));
});
