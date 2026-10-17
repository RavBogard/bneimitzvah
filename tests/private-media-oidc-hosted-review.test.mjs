import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PRIVATE_MEDIA_PROBE as P,runPrivateMediaOidcProbe as probe} from '../scripts/private-media-oidc-probe.mjs';

const now=Date.UTC(2026,9,17,12),seconds=now/1000;
const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
function environment(mode='production-allow',changed={}){
  const scope=mode==='production-allow'?'production':mode==='preview-deny'?'preview':'development';
  const claims={iss:`https://oidc.vercel.com/${P.teamSlug}`,aud:`https://vercel.com/${P.teamSlug}`,
    sub:`owner:${P.teamSlug}:project:${P.projectName}:environment:${scope}`,owner:P.teamSlug,owner_id:P.teamId,
    project:P.projectName,project_id:P.projectId,environment:scope,iat:seconds-1,nbf:seconds-1,exp:seconds+300};
  return {PRIVATE_MEDIA_OIDC_PROBE_MODE:mode,PRIVATE_MEDIA_OIDC_PROBE_STORE_ID:P.storeId,
    PRIVATE_MEDIA_OIDC_PROBE_RUN_ID:'33333333-3333-4333-8333-333333333333',VERCEL:'1',VERCEL_ENV:scope,
    VERCEL_TARGET_ENV:scope,VERCEL_PROJECT_ID:P.projectId,VERCEL_ORG_ID:P.teamId,
    VERCEL_OIDC_TOKEN:`${encode({typ:'JWT',alg:'RS256',kid:'synthetic-review'})}.${encode({...claims,...changed})}.${encode('synthetic-signature')}`};
}
class BlobError extends Error{}
class BlobOidcEnvironmentNotAllowedError extends BlobError{}
function inaccessibleOptions(env){
  let reads=0;Object.defineProperty(env,'NODE_OPTIONS',{get(){reads++;throw Error('must not inspect startup options');}});
  return ()=>reads;
}
const isFailure=value=>{assert.equal(value.ok,false);assert.equal(value.outcome,'failed');
  assert.deepEqual(Object.keys(value).sort(),['environmentMatch','expectation','mode','ok','outcome']);};

test('native trust never inspects options, while complete current identity is still required before SDK access',async()=>{
  for(const mode of ['production-allow','preview-deny']){
    const env=environment(mode),reads=inaccessibleOptions(env);let imports=0,requests=0;
    const result=await probe(env,{now:()=>now,loadSdk:async()=>{imports++;return {BlobError,list:async()=>{
      requests++;if(mode==='preview-deny')throw new BlobOidcEnvironmentNotAllowedError();return {blobs:[],hasMore:false};
    }};}});
    assert.equal(result.ok,true);assert.equal(result.environmentMatch,true);assert.equal(imports,1);assert.equal(requests,1);assert.equal(reads(),0);
  }
  const invalid=[environment('production-allow',{owner_id:'other'}),environment('production-allow',{exp:seconds}),
    {...environment(),VERCEL:undefined},{...environment(),VERCEL_PROJECT_ID:'other'},
    {...environment(),VERCEL_OIDC_TOKEN:undefined},{...environment(),VERCEL_ENV:'development'}];
  for(const env of invalid){let imports=0;const reads=inaccessibleOptions(env);
    isFailure(await probe(env,{now:()=>now,loadSdk:async()=>{imports++;throw 0;}}));
    assert.equal(imports,0);assert.equal(reads(),0);
  }
  const disabled={};const reads=inaccessibleOptions(disabled);assert.equal(await probe(disabled),null);assert.equal(reads(),0);
});

test('hosted options exception cannot turn a late native-identity change into permission evidence',async()=>{
  for(const mutation of [env=>{env.VERCEL='0';},env=>{env.VERCEL_ORG_ID='other';},env=>{env.VERCEL_OIDC_TOKEN+='a';}]){
    const env=environment(),reads=inaccessibleOptions(env);let requests=0;const diagnostics=[];
    const result=await probe(env,{now:()=>now,onDiagnostic:r=>diagnostics.push(r),loadSdk:async()=>({BlobError,list:async()=>{
      requests++;mutation(env);return {blobs:[],hasMore:false};
    }})});
    isFailure(result);assert.equal(result.environmentMatch,true);assert.equal(requests,1);assert.equal(reads(),0);
    assert.equal(diagnostics.length,1);assert.equal(diagnostics[0].phase,'post-identity');
  }
});

test('Development options and other hosted transport overrides remain closed without reading identity prematurely',async()=>{
  const dev=environment('development-deny');dev.NODE_OPTIONS='synthetic-sensitive';let imports=0;const records=[];
  isFailure(await probe(dev,{now:()=>now,onDiagnostic:r=>records.push(r),loadSdk:async()=>{imports++;throw 0;}}));
  assert.equal(imports,0);assert.deepEqual(records,[{schema:'private-media-oidc-diagnostic/v1',phase:'environment-guard',check:'node-options'}]);
  for(const [key,value] of [['DEBUG','synthetic-sensitive'],['NODE_EXTRA_CA_CERTS','synthetic-sensitive'],['NODE_TLS_REJECT_UNAUTHORIZED','0']]){
    const env={...environment(),[key]:value};let tokenReads=0;
    Object.defineProperty(env,'VERCEL_OIDC_TOKEN',{get(){tokenReads++;throw 0;}});
    isFailure(await probe(env,{loadSdk:async()=>{imports++;throw 0;}}));assert.equal(tokenReads,0);
  }
  assert.equal(imports,0);
});
