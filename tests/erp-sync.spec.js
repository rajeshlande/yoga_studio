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

test('owner grants and removes student portal access by registered email', async ({page}) => {
  page.on('pageerror', error => console.error('Browser page error:', error.message));
  await mockAuth(page);

  const server = emptySnapshot();
  server.branches.push({
    id: BRANCH, name: 'Main Branch', city: 'Panvel', address: '', phone: '',
    status: 'active', createdAt: '2026-01-01T00:00:00Z', syncVersion: 1,
  });
  server.students.push({
    id: STUDENT, branchId: BRANCH, fullName: 'Asha Patil', phone: '1111111111',
    email: 'contact@example.test', gender: '', dob: '', joiningDate: '2026-01-01',
    status: 'active', notes: '', createdAt: '2026-01-01T00:00:00Z', syncVersion: 1,
    portalAccessStatus: 'none', portalAccessEmail: '',
  });
  const grantCalls = [];
  const revokeCalls = [];

  await page.route('https://auth.yoga-studio.test/rest/v1/rpc/**', async route => {
    const url = new URL(route.request().url());
    const name = url.pathname.split('/').pop();
    const body = route.request().postDataJSON() || {};
    const reply = (value, status = 200) => route.fulfill({
      status, contentType: 'application/json', body: JSON.stringify(value),
    });
    if (name === 'erp_get_context') {
      return reply({
        organizationId: ORG, organizationName: 'Yoga Studio', roles: ['owner'],
        instructorId: null, studentId: null,
      });
    }
    if (name === 'erp_get_snapshot') return reply(structuredClone(server));
    if (name === 'erp_sync_push') return reply({serverTime: new Date().toISOString(), results: []});
    if (name === 'erp_grant_student_access') {
      grantCalls.push(structuredClone(body));
      if (body.p_email === 'missing@example.test') {
        return reply({code: 'P0001', message: 'STUDENT_ACCOUNT_NOT_FOUND'}, 400);
      }
      server.students[0].portalAccessStatus = 'active';
      server.students[0].portalAccessEmail = body.p_email;
      return reply({
        studentId: body.p_student_id,
        email: body.p_email,
        portalAccessStatus: 'active',
      });
    }
    if (name === 'erp_revoke_student_access') {
      revokeCalls.push(structuredClone(body));
      server.students[0].portalAccessStatus = 'suspended';
      return reply({
        studentId: body.p_student_id,
        email: server.students[0].portalAccessEmail,
        portalAccessStatus: 'suspended',
        linksSuspended: 1,
      });
    }
    return reply({code: 'PGRST202', message: 'Function not mocked'}, 404);
  });

  await page.goto('/');
  await signIn(page);
  await page.getByRole('button', {name: 'Students', exact: true}).click();
  const row = page.getByRole('row', {name: /Asha Patil/});
  await expect(row.getByText('No portal access')).toBeVisible();

  await row.getByRole('button', {name: /Portal access/}).click();
  const dialog = page.getByRole('dialog', {name: 'Student portal access'});
  await expect(dialog.getByText('The student must not create their own organization.')).toBeVisible();
  await dialog.getByLabel('Student sign-in email').fill('missing@example.test');
  await dialog.getByRole('button', {name: 'Grant access'}).click();
  await expect(page.locator('.toast')).toContainText('No usable Yoga Studio account uses that email yet');
  await expect(dialog).toBeVisible();

  await dialog.getByLabel('Student sign-in email').fill('asha-login@example.test');
  await dialog.getByRole('button', {name: 'Grant access'}).click();
  await expect(row.getByText('Portal active')).toBeVisible();
  await expect(row.getByText('asha-login@example.test')).toBeVisible();
  expect(grantCalls.at(-1)).toEqual({
    p_student_id: STUDENT,
    p_email: 'asha-login@example.test',
  });

  await row.getByRole('button', {name: /Portal access/}).click();
  await dialog.getByRole('button', {name: 'Remove access'}).click();
  await dialog.getByRole('button', {name: 'Yes, remove access'}).click();
  await expect(row.getByText('Portal suspended')).toBeVisible();
  expect(revokeCalls).toEqual([{p_student_id: STUDENT}]);
});

test('signed-in student sees a view-only portal for their own records', async ({page}) => {
  page.on('pageerror', error => console.error('Browser page error:', error.message));
  await mockAuth(page);

  const BATCH = '33333333-3333-4333-8333-333333333333';
  const ENROLLMENT = '44444444-4444-4444-8444-444444444444';
  const PLAN = '55555555-5555-4555-8555-555555555555';
  const MEMBERSHIP = '66666666-6666-4666-8666-666666666666';
  const server = {
    ...emptySnapshot(),
    branches: [{
      id: BRANCH, name: 'Main Branch', city: 'Panvel', address: '', phone: '',
      status: 'active', createdAt: '2026-01-01T00:00:00Z', syncVersion: 1,
    }],
    students: [{
      id: STUDENT, branchId: BRANCH, fullName: 'Asha Patil', phone: '1111111111',
      email: 'asha-login@example.test', gender: '', dob: '', joiningDate: '2026-01-01',
      status: 'active', notes: '', createdAt: '2026-01-01T00:00:00Z', syncVersion: 1,
      portalAccessStatus: 'hidden', portalAccessEmail: '',
    }],
    batches: [{
      id: BATCH, branchId: BRANCH, name: 'Morning Yoga', instructorId: '', days: [1, 3, 5],
      startTime: '07:00', durationMins: 60, capacity: 20, status: 'active',
      createdAt: '2026-01-01T00:00:00Z', syncVersion: 1,
    }],
    enrollments: [{
      id: ENROLLMENT, batchId: BATCH, studentId: STUDENT, joinedOn: '2026-01-01',
      status: 'active', createdAt: '2026-01-01T00:00:00Z', syncVersion: 1,
    }],
    attendance: [{
      id: '77777777-7777-4777-8777-777777777777', batchId: BATCH, studentId: STUDENT,
      classDate: '2026-10-28', status: 'present', updatedAt: '2026-10-28T00:00:00Z', syncVersion: 1,
    }],
    plans: [{
      id: PLAN, name: 'Monthly', amountPaise: 150000, durationMonths: 1, status: 'active',
      createdAt: '2026-01-01T00:00:00Z', syncVersion: 1,
    }],
    memberships: [{
      id: MEMBERSHIP, studentId: STUDENT, planId: PLAN, branchId: BRANCH,
      startDate: '2026-10-01', endDate: '2026-12-31', billingCycle: 'joining',
      durationMonths: 1, amountPaise: 150000, status: 'active',
      createdAt: '2026-10-01T00:00:00Z', syncVersion: 1,
    }],
    payments: [{
      id: '88888888-8888-4888-8888-888888888888', studentId: STUDENT,
      membershipId: MEMBERSHIP, branchId: BRANCH, amountPaise: 50000,
      method: 'upi', paidOn: '2026-10-02', note: '', receiptNo: 'YS-2026-0001',
      status: 'recorded', voidReason: '', createdAt: '2026-10-02T00:00:00Z', syncVersion: 1,
    }],
    billingSettings: [],
  };

  let accessGranted = true;
  await page.route('https://auth.yoga-studio.test/rest/v1/rpc/**', async route => {
    const url = new URL(route.request().url());
    const name = url.pathname.split('/').pop();
    const reply = value => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify(value),
    });
    if (name === 'erp_get_context') {
      return reply(accessGranted ? {
        organizationId: ORG, organizationName: 'Yoga Studio', roles: ['student'],
        instructorId: null, studentId: STUDENT,
      } : {
        organizationId: null, organizationName: '', roles: [],
        instructorId: null, studentId: null,
      });
    }
    if (name === 'erp_get_snapshot') {
      if (!accessGranted) {
        return route.fulfill({
          status: 400, contentType: 'application/json',
          body: JSON.stringify({code: 'P0001', message: 'NO_ORGANIZATION: create or join an organization first'}),
        });
      }
      return reply(structuredClone(server));
    }
    if (name === 'erp_sync_push') return reply({serverTime: new Date().toISOString(), results: []});
    return route.fulfill({
      status: 404, contentType: 'application/json',
      body: JSON.stringify({code: 'PGRST202', message: 'Function not mocked'}),
    });
  });

  await page.goto('/');
  await signIn(page);
  await expect(page.getByText('Supabase · Synced')).toBeVisible();
  await expect(page.getByRole('button', {name: 'Students', exact: true})).toHaveCount(0);
  await expect(page.getByRole('button', {name: 'Branches', exact: true})).toHaveCount(0);
  await expect(page.getByLabel('Signed-in student')).toBeDisabled();
  await expect(page.getByLabel('Signed-in student')).toHaveValue(STUDENT);
  await expect(page.getByText('My dues')).toBeVisible();

  await page.getByRole('button', {name: 'Batches', exact: true}).click();
  await expect(page.getByRole('cell', {name: /Morning Yoga/})).toBeVisible();
  await expect(page.getByRole('button', {name: /Add batch/})).toHaveCount(0);
  await expect(page.getByRole('button', {name: /Edit/})).toHaveCount(0);

  await page.getByRole('button', {name: 'Attendance', exact: true}).click();
  await expect(page.getByRole('heading', {name: 'My attendance'})).toBeVisible();
  await expect(page.getByRole('cell', {name: 'Morning Yoga'})).toBeVisible();

  await page.getByRole('button', {name: 'Fees', exact: true}).click();
  await expect(page.getByRole('tab', {name: 'Payment setup'})).toHaveCount(0);
  await expect(page.getByRole('button', {name: /Record payment/})).toHaveCount(0);
  await expect(page.getByRole('button', {name: /Invoice PDF/})).toBeVisible();
  await page.getByRole('tab', {name: 'Payments'}).click();
  await expect(page.getByText('YS-2026-0001')).toBeVisible();
  await expect(page.getByRole('button', {name: /Invoice PDF/})).toBeVisible();

  // Simulate an admin removing access while this student tab is open. The
  // next online sync must stop presenting the downloaded studio snapshot.
  accessGranted = false;
  await page.getByRole('button', {name: 'Sync now'}).click();
  await expect(page.getByText('This account is not connected to a studio yet.')).toBeVisible();
  await expect(page.getByText('YS-2026-0001')).toHaveCount(0);
});

test('waiting student can retry after an admin grants portal access', async ({page}) => {
  page.on('pageerror', error => console.error('Browser page error:', error.message));
  await mockAuth(page);
  let granted = false;
  const server = {
    ...emptySnapshot(),
    branches: [{
      id: BRANCH, name: 'Main Branch', city: 'Panvel', address: '', phone: '',
      status: 'active', createdAt: '2026-01-01T00:00:00Z', syncVersion: 1,
    }],
    students: [{
      id: STUDENT, branchId: BRANCH, fullName: 'Asha Patil', phone: '', email: 'qa@example.test',
      gender: '', dob: '', joiningDate: '2026-01-01', status: 'active', notes: '',
      createdAt: '2026-01-01T00:00:00Z', syncVersion: 1,
      portalAccessStatus: 'hidden', portalAccessEmail: '',
    }],
    billingSettings: [],
  };

  await page.route('https://auth.yoga-studio.test/rest/v1/rpc/**', async route => {
    const url = new URL(route.request().url());
    const name = url.pathname.split('/').pop();
    const reply = value => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify(value),
    });
    if (name === 'erp_get_context') {
      return reply(granted ? {
        organizationId: ORG, organizationName: 'Yoga Studio', roles: ['student'],
        instructorId: null, studentId: STUDENT,
      } : {
        organizationId: null, organizationName: '', roles: [],
        instructorId: null, studentId: null,
      });
    }
    if (name === 'erp_get_snapshot') {
      if (!granted) {
        return route.fulfill({
          status: 400, contentType: 'application/json',
          body: JSON.stringify({code: 'P0001', message: 'NO_ORGANIZATION: create or join an organization first'}),
        });
      }
      return reply(structuredClone(server));
    }
    if (name === 'erp_sync_push') return reply({serverTime: new Date().toISOString(), results: []});
    return route.fulfill({
      status: 404, contentType: 'application/json',
      body: JSON.stringify({code: 'PGRST202', message: 'Function not mocked'}),
    });
  });

  await page.goto('/');
  await signIn(page);
  await expect(page.getByText('This account is not connected to a studio yet.')).toBeVisible();
  await expect(page.getByText(/Student\? Do not create an organization/)).toBeVisible();

  granted = true;
  await page.getByRole('button', {name: 'Retry'}).click();
  await expect(page.getByLabel('Signed-in student')).toBeDisabled();
  await expect(page.getByLabel('Signed-in student')).toHaveValue(STUDENT);
  await expect(page.getByRole('button', {name: 'Students', exact: true})).toHaveCount(0);
  await expect(page.getByText('My dues')).toBeVisible();
});

test('payment setup saved offline stays local, warns before close, then auto-syncs', async ({page}) => {
  page.on('pageerror', error => console.error('Browser page error:', error.message));
  await mockAuth(page);
  const server = {...emptySnapshot(), billingSettings: []};
  const pushed = [];

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
      const operations = body.p_payload?.operations || [];
      pushed.push(...structuredClone(operations));
      const results = operations.map(op => {
        const list = server[op.entity];
        const record = {...op.payload, syncVersion: op.baseVersion ? op.baseVersion + 1 : 1};
        const index = list.findIndex(item => item.id === op.entityId);
        if (index >= 0) list[index] = {...list[index], ...record};
        else list.push(record);
        return {
          opId: op.opId, status: 'applied', entity: op.entity, entityId: op.entityId,
          serverEntityId: op.entityId, serverVersion: record.syncVersion,
        };
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
  await expect(page.locator('.connection-badge')).toContainText('Online · synced');

  await page.context().setOffline(true);
  await expect(page.locator('.connection-badge')).toContainText('Offline · local copy');
  await page.getByRole('button', {name: 'Fees', exact: true}).click();
  await page.getByRole('tab', {name: 'Payment setup'}).click();
  await page.getByLabel('UPI ID').fill('offline@okbank');
  await page.getByLabel('UPI payee name').fill('Yoga Studio');
  await page.getByRole('button', {name: 'Save payment setup'}).click();
  await expect(page.locator('.connection-badge')).toContainText('Offline · 1 saved locally');
  await expect(page.getByText('Saved on this device · waiting to sync')).toBeVisible();

  // The browser-close guard is armed only while device-only work remains.
  const closeWasBlocked = await page.evaluate(() => {
    const event = new Event('beforeunload', {cancelable: true});
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(closeWasBlocked).toBeTruthy();

  // Sensitivity check: the mirrored backup key exists alongside the primary
  // sync-state key, but the browser test asserts only counts/fields—not the
  // full local snapshot—in logs.
  const backupQueueLength = await page.evaluate(userId => {
    const key = Object.keys(localStorage).find(name => name.includes(`yoga-studio-erp-sync-v1:${userId}:`) && name.endsWith(':backup'));
    return key ? JSON.parse(localStorage.getItem(key)).outbox.length : -1;
  }, account.id);
  expect(backupQueueLength).toBe(1);

  await page.context().setOffline(false);
  await expect(page.getByText('Supabase · Synced')).toBeVisible();
  await expect(page.locator('.connection-badge')).toContainText('Online · synced');
  expect(pushed.some(op => op.entity === 'billingSettings' && op.payload.upiId === 'offline@okbank')).toBeTruthy();
  expect(server.billingSettings[0].upiId).toBe('offline@okbank');

  const closeAllowedAfterSync = await page.evaluate(() => {
    const event = new Event('beforeunload', {cancelable: true});
    window.dispatchEvent(event);
    return !event.defaultPrevented;
  });
  expect(closeAllowedAfterSync).toBeTruthy();
});
