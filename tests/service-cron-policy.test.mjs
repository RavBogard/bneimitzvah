import {test}from "node:test";
import assert from "node:assert/strict";
import {entryProblems}from "../scripts/repo-policy.mjs";
const cron={path:"/api/internal/service-ecosystem/drain",schedule:"17 10 * * *"};
test("the exact reviewed daily cron config is permitted with ordinary JSON formatting and key order",()=>{
  for(const value of [{crons:[cron]},{crons:[{schedule:cron.schedule,path:cron.path}]}])assert.deepEqual(entryProblems("vercel.json",JSON.stringify(value,null,2)),[]);
  assert.ok(entryProblems("nested/vercel.json",JSON.stringify({crons:[cron]})).includes("data file outside reviewed allow-list"));
});
test("cron exception refuses secrets, data, extra keys/jobs, arbitrary paths/cadence and duplicate JSON members",()=>{
  const invalid=["", "null", "[]", "{}",JSON.stringify({crons:[cron],env:{SYNTHETIC:"not-allowed"}}),JSON.stringify({crons:[cron,cron]}),JSON.stringify({crons:[{...cron,notes:"Synthetic student data"}]}),JSON.stringify({crons:[{...cron,path:"/api/other"}]}),JSON.stringify({crons:[{...cron,schedule:"* * * * *"}]}),JSON.stringify({crons:[null]}),`{"crons":[],"crons":[${JSON.stringify(cron)}]}`,`{"crons":[{"path":"synthetic-private-data","path":"${cron.path}","schedule":"${cron.schedule}"}]}`];
  for(const value of invalid)assert.ok(entryProblems("vercel.json",value).includes("deployment config must contain only the reviewed daily service drain cron"));
});
