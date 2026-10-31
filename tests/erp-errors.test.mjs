import test from 'node:test';
import assert from 'node:assert/strict';
import {describeError, errorSummary, formatErrorDetails} from '../src/lib/errors.js';

test('missing Supabase RPCs become an actionable SQL setup error', () => {
  const info = describeError({code: 'PGRST202', message: 'Could not find the function'}, {context: 'Load admissions'});
  assert.equal(info.kind, 'setup');
  assert.match(info.title, /Database setup/);
  assert.match(info.solution, /supabase\/erp_setup\.sql/);
  assert.match(info.solution, /SQL v11/);
  assert.equal(info.code, 'PGRST202');
});

test('offline and fetch failures explain the safe next step', () => {
  const info = describeError(new TypeError('Failed to fetch'), {context: 'Sync studio data'});
  assert.equal(info.kind, 'offline');
  assert.equal(info.severity, 'warning');
  assert.match(info.solution, /Check Wi-Fi\/mobile data/);
  assert.match(info.solution, /queued on this device/);
});

test('authorization failures do not suggest bypassing access controls', () => {
  const info = describeError({code: '42501', message: 'FORBIDDEN: permission denied'}, {context: 'Record payment'});
  assert.equal(info.kind, 'permission');
  assert.equal(info.retryable, false);
  assert.match(info.message, /Nothing was changed/);
  assert.match(info.solution, /correct account/);
  assert.match(info.solution, /Do not use another person’s login/);
});

test('auth errors keep the safe user message and add recovery guidance', () => {
  const info = describeError({code: 'invalid_credentials', message: 'Invalid login credentials'}, {context: 'Sign in'});
  assert.equal(info.message, 'Email or password is incorrect. Please try again.');
  assert.match(info.solution, /Forgot password/);
});

test('validation and sync-conflict errors are separated clearly', () => {
  const validation = describeError({code: 'VALIDATION_FAILED', message: 'VALIDATION_FAILED: Phone is required'});
  assert.equal(validation.kind, 'validation');
  assert.equal(validation.message, 'Phone is required');

  const conflict = describeError({code: 'SYNC_CONFLICT_EXISTS', message: 'Version conflict'});
  assert.equal(conflict.kind, 'sync_conflict');
  assert.match(conflict.solution, /compare “mine” and “server”/);
});

test('admission branch errors tell the user to request a fresh studio link', () => {
  const info = describeError(new Error('ADMISSION_BRANCH_INVALID: branch is inactive'));
  assert.equal(info.kind, 'admission');
  assert.match(info.solution, /current studio or branch admission link/);
  assert.match(info.solution, /Do not edit the branch value/);
});

test('database constraint errors are translated into duplicate/link guidance', () => {
  const duplicate = describeError({code: '23505', message: 'duplicate key value violates unique constraint'});
  assert.equal(duplicate.kind, 'duplicate');
  assert.match(duplicate.solution, /Refresh and search/);
  assert.doesNotMatch(duplicate.message, /unique constraint/);

  const linked = describeError({code: '23503', message: 'foreign key constraint fails'});
  assert.equal(linked.kind, 'record_state');
  assert.match(linked.solution, /reselect/);
});

test('unknown errors preserve the message and support details are copyable', () => {
  const error = new Error('A very specific failure happened');
  error.code = 'EXAMPLE_CODE';
  const info = describeError(error, {context: 'Save student'});
  assert.equal(info.message, 'A very specific failure happened');
  assert.match(errorSummary(error, {context: 'Save student'}), /Possible solution:/);
  const details = formatErrorDetails(error, {context: 'Save student'});
  assert.match(details, /Screen\/action: Save student/);
  assert.match(details, /EXAMPLE_CODE/);
  assert.doesNotMatch(details, /\[object Object\]/);
});
