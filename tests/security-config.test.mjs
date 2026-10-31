import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {isPublicKey,isProjectUrl} from '../src/lib/public-config.mjs';
const token=role=>['header',Buffer.from(JSON.stringify({role})).toString('base64url'),'signature'].join('.');
test('public configuration accepts publishable and legacy anon keys',()=>{
  assert.equal(isPublicKey('sb_publishable_test_only'),true);
  assert.equal(isPublicKey(token('anon')),true);
});
test('administrative keys and user session keys are rejected',()=>{
  assert.equal(isPublicKey('sb_'+'secret_'+'x'.repeat(24)),false);
  assert.equal(isPublicKey(token('service_role')),false);
  assert.equal(isPublicKey(token('authenticated')),false);
});
test('missing/malformed keys do not enable authentication',()=>{
  for(const key of [undefined,'','not-a-key'])assert.equal(isPublicKey(key),false);
});
test('endpoint must use HTTPS without embedded credentials',()=>{
  assert.equal(isProjectUrl('https://auth.yoga-studio.test'),true);
  for(const url of ['',undefined,'http://auth.yoga-studio.test','https://user:password@auth.yoga-studio.test'])assert.equal(isProjectUrl(url),false);
});
test('SQL role boundary keeps internal helpers private and portal snapshots least-privilege',()=>{
  const sql=readFileSync(new URL('../supabase/erp_setup.sql',import.meta.url),'utf8');
  const defined=[...sql.matchAll(/create or replace function public\.([a-z0-9_]+)\s*\(/gi)].map(match=>match[1]);
  const grantStart=sql.indexOf('foreach f in array array[');
  const grantBlock=sql.slice(grantStart,sql.indexOf('\n  loop',grantStart));
  const granted=[...grantBlock.matchAll(/'([a-z0-9_]+)\(/g)].map(match=>match[1]);
  const revoked=new Set([...sql.matchAll(/revoke all on function public\.([a-z0-9_]+)\(/gi)].map(match=>match[1]));

  assert.ok(granted.length>0);
  assert.equal(granted.some(name=>name.startsWith('erp__')),false);
  for(const helper of ['erp_current_org','erp_my_roles','erp_can_manage','erp_my_instructor_id','erp_my_student_id','erp__require_org','erp__require_manager','erp__log']){
    assert.equal(granted.includes(helper),false,`${helper} must not be browser-callable`);
    assert.equal(revoked.has(helper),true,`${helper} must be explicitly revoked`);
  }
  assert.deepEqual(defined.filter(name=>!granted.includes(name)&&!revoked.has(name)),[]);

  assert.equal(/vis\.full_record or vis\.instructor_enrolled then s\./.test(sql),false);
  assert.match(sql,/'phone', case when vis\.full_record then s\.phone/);
  assert.match(sql,/'phone', case when ivis\.full_record then i\.phone/);
  const plansBlock=sql.slice(sql.indexOf("'plans',"),sql.indexOf("'memberships',"));
  assert.match(plansBlock,/m\.plan_id = p\.id/);
  assert.match(plansBlock,/m\.student_id = v_student/);
});
