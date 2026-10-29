import test from 'node:test';
import assert from 'node:assert/strict';
import {applyTheme, nextTheme, readStoredTheme, resolveTheme, systemPrefersDark} from '../src/lib/theme.js';

test('theme defaults to system when storage is unavailable', () => {
  assert.equal(readStoredTheme(), 'system');
  assert.equal(systemPrefersDark(), false);
});

test('explicit themes resolve without consulting the OS preference', () => {
  assert.equal(resolveTheme('light'), 'light');
  assert.equal(resolveTheme('dark'), 'dark');
  assert.equal(resolveTheme('system'), 'light');
  assert.equal(applyTheme('dark'), 'dark');
});

test('quick toggle cycles light, dark, then system', () => {
  assert.equal(nextTheme('light'), 'dark');
  assert.equal(nextTheme('dark'), 'system');
  assert.equal(nextTheme('system'), 'light');
});
