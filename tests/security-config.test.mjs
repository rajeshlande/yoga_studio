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
  const publicGrantBlock=sql.slice(sql.indexOf('Public admission registration surface'),sql.indexOf('AFTER SETUP'));
  const publicGranted=[...publicGrantBlock.matchAll(/grant execute on function public\.([a-z0-9_]+)\(/g)].map(match=>match[1]);

  assert.ok(granted.length>0);
  assert.deepEqual(publicGranted.sort(),['erp_get_public_admission_target','erp_submit_admission']);
  assert.match(publicGrantBlock,/erp_get_public_admission_target\(text, uuid\) to anon, authenticated/);
  assert.match(publicGrantBlock,/erp_submit_admission\(text, jsonb, uuid\) to anon/);
  assert.equal(granted.some(name=>name.startsWith('erp__')),false);
  for(const helper of ['erp_current_org','erp_my_roles','erp_can_manage','erp_my_instructor_id','erp_my_student_id','erp__require_org','erp__require_manager','erp__log','erp__is_my_active_batch','erp__student_in_my_active_batch','erp__assert_instructor_walk_in_payload','erp__assert_instructor_initial_membership','erp__can_instructor_collect_membership','erp__instructor_branch_ids']){
    assert.equal(granted.includes(helper),false,`${helper} must not be browser-callable`);
    assert.equal(publicGranted.includes(helper),false,`${helper} must not be public-callable`);
    assert.equal(revoked.has(helper),true,`${helper} must be explicitly revoked`);
  }
  assert.deepEqual(defined.filter(name=>!granted.includes(name)&&!publicGranted.includes(name)&&!revoked.has(name)),[]);

  assert.equal(/vis\.full_record or vis\.instructor_enrolled then s\./.test(sql),false);
  assert.match(sql,/'phone', case when vis\.full_record then s\.phone/);
  assert.match(sql,/'phone', case when ivis\.full_record then i\.phone/);
  const plansBlock=sql.slice(sql.indexOf("'plans',"),sql.indexOf("'memberships',"));
  assert.match(plansBlock,/m\.plan_id = p\.id/);
  assert.match(plansBlock,/m\.student_id = v_student/);
  assert.match(plansBlock,/v_instructor is not null and \([\s\S]*p\.status = 'active'/);
  assert.match(sql,/'setupVersion', 12/);

  // SQL v12 keeps the unambiguous three-argument admission RPC pair and
  // adds only the guarded public-registration target/submit surface; the
  // SQL v10 overloads must be dropped and must not remain granted.
  assert.match(sql,/SQL version 12/);
  assert.match(sql,/drop function if exists public\.erp_get_my_admission\(text\)/);
  assert.match(sql,/drop function if exists public\.erp_submit_admission\(text, jsonb\)/);
  assert.ok(grantBlock.includes("'erp_get_my_admission(text, uuid)'"));
  assert.ok(grantBlock.includes("'erp_submit_admission(text, jsonb, uuid)'"));
  assert.equal(grantBlock.includes("'erp_get_my_admission(text)'"),false);
  assert.equal(grantBlock.includes("'erp_submit_admission(text, jsonb)'"),false);
  assert.match(sql,/ADMISSION_BRANCH_INVALID/);
  assert.match(sql,/v_is_manager and a\.branch_id = any\(v_admin_branches\)/);
  assert.match(sql,/v_instructor_branches\) > 0[\s\S]*a\.branch_id is null/);
  assert.match(sql,/raw_user_meta_data[\s\S]*admission_code/);
  assert.match(sql,/VALIDATION_FAILED: termsAccepted/);
  const admissionLinkInfoBlock=sql.slice(
    sql.indexOf('create or replace function public.erp_get_admission_link_info'),
    sql.indexOf('create or replace function public.erp_list_admissions'));
  assert.match(admissionLinkInfoBlock,/erp_can_manage\(\)[\s\S]*erp_my_instructor_id\(\) is null/);
  assert.equal(admissionLinkInfoBlock.includes('erp__require_manager'),false);
  const admissionListBlock=sql.slice(
    sql.indexOf('create or replace function public.erp_list_admissions'),
    sql.indexOf('create or replace function public.erp_review_admission'));
  assert.match(admissionListBlock,/erp__require_org\(\)/);
  assert.match(admissionListBlock,/erp__instructor_branch_ids\(v_org\)/);
  assert.match(admissionListBlock,/sensitiveDetailsHidden/);
  assert.equal(admissionListBlock.includes('erp__require_manager'),false);
  const admissionReviewBlock=sql.slice(
    sql.indexOf('create or replace function public.erp_review_admission'),
    sql.indexOf('-- Role access management'));
  assert.match(admissionReviewBlock,/v_instructor_branches/);
  assert.match(admissionReviewBlock,/insert into public\.erp_branch_members/);
  assert.equal(admissionReviewBlock.includes('erp_grant_student_access(v_student_id'),false);

  // The Instructor expansion is create-only and plan-exact; offline sync
  // must recheck the walk-in batch proof, active own-batch enrolment and the
  // payment target instead of trusting the client-side wizard.
  assert.match(sql,/walk-in basic fields only/);
  assert.match(sql,/medicalPhysicalIssue', ''\)\) <> ''/);
  assert.match(sql,/p_amount_paise is distinct from v_plan\.amount_paise/);
  assert.match(sql,/p_previous_membership_id is not null/);
  assert.match(sql,/erp__can_instructor_collect_membership\(v_org, v_membership\)/);
  assert.match(sql,/v_type = 'payment_create' and v_base = 0/);
  assert.match(sql,/\(v_op->'payload'\)->>'walkInBatchId'/);
  const membershipsBlock=sql.slice(sql.indexOf("'memberships',"),sql.indexOf("'payments',"));
  const paymentsBlock=sql.slice(sql.indexOf("'payments',"),sql.indexOf("'billingSettings',"));
  assert.match(membershipsBlock,/v_instructor is not null and exists/);
  assert.match(membershipsBlock,/bt\.instructor_id = v_instructor/);
  assert.match(paymentsBlock,/v_instructor is not null and p\.branch_id is not null and exists/);
  assert.match(paymentsBlock,/bt\.instructor_id = v_instructor/);
});
