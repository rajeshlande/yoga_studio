import {test, expect} from '@playwright/test';
import {mockAuth, signIn, account} from './auth-fixture';

const ORG = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BRANCH = '11111111-1111-4111-8111-111111111111';
const STUDENT = '22222222-2222-4222-8222-222222222222';

const emptySnapshot = () => ({
  branches: [], students: [], instructors: [], batches: [], enrollments: [],
  attendance: [], plans: [], memberships: [], payments: [],
});

test('signed-in Supabase mode saves offline, reports a version conflict, and syncs after review', async ({page}) => {
  page.on('pageerror', error => console.error('Browser page error:', error.message));
  await mockAuth(page);

  const server = emptySnapshot();
  server.branches.push({
    id: BRANCH, name: 'Main Branch', city: 'Panvel', address: '', phone: '',
    status: 'active', createdAt: '2026-01-01T00:00:00Z', syncVersion: 1,
  });
  server.students.push({
    id: STUDENT, branchId: BRANCH, fullName: 'Asha Patil', phone: '1111111111',
    email: 'old@example.test', gender: '', dob: '', joiningDate: '2026-01-01',
    status: 'active', notes: '', createdAt: '2026-01-01T00:00:00Z', syncVersion: 1,
  });

  const syncRequests = [];
  let returnStudentConflict = true;
  const applyOperation = op => {
    const list = server[op.entity];
    const index = list.findIndex(record => record.id === op.entityId);
    const record = {...op.payload, syncVersion: op.baseVersion ? op.baseVersion + 1 : 1};
    if (index >= 0) list[index] = {...list[index], ...record};
    else list.push(record);
    return {
      opId: op.opId, status: 'applied', entity: op.entity, entityId: op.entityId,
      serverEntityId: op.entityId, serverVersion: record.syncVersion,
    };
  };

  await page.route('https://auth.yoga-studio.test/rest/v1/rpc/**', async route => {
    const url = new URL(route.request().url());
    const name = url.pathname.split('/').pop();
    const body = route.request().postDataJSON() || {};
    const reply = value => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify(value),
    });
    if (name === 'erp_get_context') {
      return reply({
        organizationId: ORG, organizationName: 'Yoga Studio', roles: ['owner'],
        instructorId: null, studentId: null,
      });
    }
    if (name === 'erp_get_snapshot') return reply(structuredClone(server));
    if (name === 'erp_sync_push') {
      syncRequests.push(structuredClone(body));
      const results = (body.p_payload?.operations || []).map(op => {
        if (returnStudentConflict && op.entity === 'students' && op.entityId === STUDENT) {
          returnStudentConflict = false;
          return {
            opId: op.opId, status: 'conflict', entity: op.entity, entityId: op.entityId,
            serverEntityId: STUDENT, serverVersion: 2, code: 'VERSION_CONFLICT',
            message: 'This student changed in Supabase after it was copied to this device.',
          };
        }
        return applyOperation(op);
      });
      return reply({serverTime: new Date().toISOString(), results});
    }
    return route.fulfill({
      status: 404, contentType: 'application/json',
      body: JSON.stringify({code: 'PGRST202', message: 'Function not mocked'}),
    });
  });

  await page.goto('/');
  await signIn(page);
  await expect(page.getByText('Supabase · Synced')).toBeVisible();

  // Edit an existing student with no network. The change is durable in the
  // device outbox and visible immediately, but clearly marked as waiting.
  await page.context().setOffline(true);
  await page.getByRole('button', {name: 'Students', exact: true}).click();
  await page.getByRole('row', {name: /Asha Patil/}).getByRole('button', {name: /Edit/}).click();
  await page.getByRole('dialog').getByLabel('Phone').fill('2222222222');
  await page.getByRole('button', {name: 'Save student'}).click();
  await expect(page.getByRole('row', {name: /2222222222/})).toBeVisible();
  await expect(page.getByText('Supabase · 1 waiting')).toBeVisible();

  const queued = await page.evaluate(userId => {
    const key = Object.keys(localStorage).find(name => name.includes(`yoga-studio-erp-sync-v1:${userId}:`)
      && !name.endsWith(':last-organization') && !name.endsWith(':lock'));
    return key ? JSON.parse(localStorage.getItem(key)) : null;
  }, account.id);
  expect(queued.outbox).toHaveLength(1);
  expect(queued.outbox[0].baseVersion).toBe(1);

  // Another user changes a different field online while this device is away.
  server.students[0] = {
    ...server.students[0], email: 'new@example.test', syncVersion: 2,
  };
  await page.context().setOffline(false);
  await expect(page.getByRole('button', {name: /Review conflicts \(1\)/})).toBeVisible();

  await page.getByRole('button', {name: /Review conflicts \(1\)/}).click();
  const conflictDialog = page.getByRole('dialog', {name: 'Review sync conflicts'});
  await expect(conflictDialog.getByText('2222222222')).toBeVisible();
  await expect(conflictDialog.getByText('1111111111')).toBeVisible();
  await expect(conflictDialog.getByText('new@example.test')).toBeVisible();
  await conflictDialog.getByRole('button', {name: 'Keep mine'}).click();

  await expect(page.getByText('Supabase · Synced')).toBeVisible();
  const resolutionPush = syncRequests
    .flatMap(request => request.p_payload.operations)
    .find(op => op.entity === 'students' && op.baseVersion === 2);
  expect(resolutionPush.payload.phone).toBe('2222222222');
  // Field-level rebase preserves the other user's email change.
  expect(resolutionPush.payload.email).toBe('new@example.test');
  expect(server.students[0].phone).toBe('2222222222');
  expect(server.students[0].email).toBe('new@example.test');

  // Create a branch and then a student in that branch while offline. The
  // student operation depends on the branch, so sync sends it in a later wave.
  syncRequests.length = 0;
  await page.context().setOffline(true);
  await page.getByRole('button', {name: 'Branches', exact: true}).click();
  await page.getByRole('button', {name: 'Add branch'}).click();
  await page.getByRole('dialog').getByLabel('Branch name').fill('Offline Branch');
  await page.getByRole('button', {name: 'Save branch'}).click();

  await page.getByRole('button', {name: 'Students', exact: true}).click();
  await page.getByRole('button', {name: 'Add student'}).click();
  const studentDialog = page.getByRole('dialog');
  await studentDialog.getByLabel('Full name').fill('Beatriz');
  await studentDialog.getByLabel('Student branch').selectOption({label: 'Offline Branch'});
  await page.getByRole('button', {name: 'Save student'}).click();
  await expect(page.getByText('Supabase · 2 waiting')).toBeVisible();

  await page.context().setOffline(false);
  await expect(page.getByText('Supabase · Synced')).toBeVisible();
  const operationWaves = syncRequests.map(request => request.p_payload.operations.map(op => op.entity));
  expect(operationWaves).toContainEqual(['branches']);
  expect(operationWaves).toContainEqual(['students']);
  expect(server.branches.some(branch => branch.name === 'Offline Branch')).toBeTruthy();
  expect(server.students.some(student => student.fullName === 'Beatriz')).toBeTruthy();

  await page.reload();
  await expect(page.getByRole('heading', {name: 'Welcome back, Test.'})).toBeVisible();
  await page.getByRole('button', {name: 'Students', exact: true}).click();
  await expect(page.getByRole('cell', {name: /Beatriz/})).toBeVisible();
});
