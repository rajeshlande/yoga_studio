import test from 'node:test';
import assert from 'node:assert/strict';
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
