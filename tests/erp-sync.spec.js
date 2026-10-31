import {test, expect} from '@playwright/test';
import {mockAuth, signIn, account} from './auth-fixture';

const ORG = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BRANCH = '11111111-1111-4111-8111-111111111111';
const BRANCH2 = '99999999-9999-4999-8999-999999999999';
const STUDENT = '22222222-2222-4222-8222-222222222222';
const INSTRUCTOR_RECORD = '33333333-3333-4333-8333-333333333333';
const COOWNER_USER = '44444444-4444-4444-8444-444444444444';
const ADMIN_USER = '55555555-5555-4555-8555-555555555555';
const INSTRUCTOR_USER = '66666666-6666-4666-8666-666666666666';
const ADMISSION = '77777777-7777-4777-8777-777777777777';
const ADMISSION_CODE = 'test-admission-code';

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
  await page.getByRole('dialog').getByLabel('Phone Number').fill('2222222222');
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
  await page.getByRole('button', {name: 'Branches & batches', exact: true}).click();
  await page.getByRole('button', {name: 'Add branch'}).click();
  await page.getByRole('dialog').getByLabel('Branch name').fill('Offline Branch');
  await page.getByRole('button', {name: 'Save branch'}).click();

  await page.getByRole('button', {name: 'Students', exact: true}).click();
  await page.getByRole('button', {name: 'Add student'}).click();
  const studentDialog = page.getByRole('dialog');
  await studentDialog.getByLabel('First Name').fill('Beatriz');
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
  await expect(page.locator('.app-error-toast')).toContainText('No confirmed account was found for that email');
  await expect(page.locator('.app-error-toast')).toContainText('What happened:');
  await expect(page.locator('.app-error-toast')).toContainText('Possible solution:');
  await expect(page.locator('.app-error-toast')).toContainText('Join an existing studio');
  await page.locator('.app-error-toast').getByRole('button', {name: 'Dismiss error'}).click();
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

test('owner manages co-owner, branch Admin and instructor sign-in access', async ({page}) => {
  page.on('pageerror', error => console.error('Browser page error:', error.message));
  await mockAuth(page);

  const server = emptySnapshot();
  server.branches.push(
    {id: BRANCH, name: 'Panvel', city: 'Panvel', address: '', phone: '', status: 'active', createdAt: '2026-01-01T00:00:00Z', syncVersion: 1},
    {id: BRANCH2, name: 'Nerul', city: 'Navi Mumbai', address: '', phone: '', status: 'active', createdAt: '2026-01-01T00:00:00Z', syncVersion: 1},
  );
  server.instructors.push({
    id: INSTRUCTOR_RECORD, branchId: BRANCH, fullName: 'Isha Rao', phone: '', email: 'isha-record@example.test',
    specialties: ['Hatha'], status: 'active', createdAt: '2026-01-01T00:00:00Z', syncVersion: 1,
  });
  const accessState = {
    actor: {
      userId: account.id, email: account.email, roles: ['owner'], primaryRole: 'owner', orgRole: 'owner',
      branchIds: [BRANCH, BRANCH2], adminBranchIds: [],
      canManageCoOwners: true, canManageAdmins: true, canManageInstructors: true, canManageStudents: true,
    },
    orgMembers: [{userId: account.id, email: account.email, role: 'owner', status: 'active', createdAt: '2026-01-01T00:00:00Z', isSelf: true}],
    adminAssignments: [],
    instructors: [{
      instructorId: INSTRUCTOR_RECORD, fullName: 'Isha Rao', contactEmail: 'isha-record@example.test', phone: '',
      branchId: BRANCH, recordStatus: 'active',
      accessStatus: 'none', accessEmail: '', accessUserId: null, accessBranchIds: [], batchBranchIds: [BRANCH],
    }],
  };
  const roleCalls = [];

  await page.route('https://auth.yoga-studio.test/rest/v1/rpc/**', async route => {
    const url = new URL(route.request().url());
    const name = url.pathname.split('/').pop();
    const body = route.request().postDataJSON() || {};
    const reply = (value, status = 200) => route.fulfill({status, contentType: 'application/json', body: JSON.stringify(value)});
    if (name === 'erp_get_context') {
      return reply({organizationId: ORG, organizationName: 'Yoga Studio', roles: ['owner'], primaryRole: 'owner', adminBranchIds: [], instructorId: null, studentId: null});
    }
    if (name === 'erp_get_snapshot') return reply(structuredClone(server));
    if (name === 'erp_sync_push') return reply({serverTime: new Date().toISOString(), results: []});
    if (name === 'erp_list_role_access') return reply(structuredClone(accessState));
    if (name === 'erp_grant_co_owner_access') {
      roleCalls.push({name, body: structuredClone(body)});
      accessState.orgMembers.push({userId: COOWNER_USER, email: body.p_email, role: 'co_owner', status: 'active', createdAt: '2026-10-30T00:00:00Z', isSelf: false});
      return reply({userId: COOWNER_USER, email: body.p_email, role: 'co_owner'});
    }
    if (name === 'erp_grant_admin_access') {
      roleCalls.push({name, body: structuredClone(body)});
      accessState.adminAssignments = body.p_branch_ids.map(branchId => ({
        userId: ADMIN_USER, email: body.p_email, role: 'admin', status: 'active', branchId,
        createdAt: '2026-10-30T00:00:00Z', isSelf: false,
      }));
      return reply({userId: ADMIN_USER, email: body.p_email, role: 'admin', branchIds: body.p_branch_ids});
    }
    if (name === 'erp_grant_instructor_access') {
      roleCalls.push({name, body: structuredClone(body)});
      Object.assign(accessState.instructors[0], {
        accessStatus: 'active', accessEmail: body.p_email, accessUserId: INSTRUCTOR_USER,
        accessBranchIds: body.p_branch_ids,
      });
      return reply({instructorId: body.p_instructor_id, userId: INSTRUCTOR_USER, email: body.p_email, role: 'instructor', branchIds: body.p_branch_ids, accessStatus: 'active'});
    }
    if (name === 'erp_revoke_instructor_access') {
      roleCalls.push({name, body: structuredClone(body)});
      Object.assign(accessState.instructors[0], {accessStatus: 'suspended', accessBranchIds: []});
      return reply({instructorId: body.p_instructor_id, email: 'instructor-login@example.test', accessStatus: 'suspended', linksSuspended: 1});
    }
    return reply({code: 'PGRST202', message: 'Function not mocked'}, 404);
  });

  await page.goto('/');
  await signIn(page);
  await page.getByRole('button', {name: 'Access', exact: true}).click();
  await expect(page.getByRole('heading', {name: /Access/})).toBeVisible();
  await expect(page.getByText('Role and branch authorization for every ERP sign-in.')).toBeVisible();
  await expect(page.getByRole('heading', {name: 'Your authorization'})).toBeVisible();

  await page.getByLabel('Co-owner sign-in email').fill('coowner@example.test');
  await page.getByRole('button', {name: 'Add Co-owner', exact: true}).click();
  await expect(page.getByRole('cell', {name: /coowner@example.test/})).toBeVisible();

  await page.getByLabel('Admin sign-in email').fill('admin@example.test');
  await page.getByRole('group', {name: 'New Admin branches'}).getByLabel('Nerul', {exact: true}).check();
  await page.getByRole('button', {name: 'Grant Admin access'}).click();
  const adminRow = page.getByRole('row', {name: /admin@example.test/});
  await expect(adminRow).toBeVisible();
  await expect(adminRow.getByLabel('Nerul for admin@example.test')).toBeChecked();

  await page.getByRole('row', {name: /Isha Rao/}).getByRole('button', {name: 'Sign-in access'}).click();
  const instructorDialog = page.getByRole('dialog', {name: 'Instructor sign-in access'});
  await instructorDialog.getByLabel('Instructor sign-in email').fill('instructor-login@example.test');
  await instructorDialog.getByLabel('Nerul for Isha Rao').check();
  await instructorDialog.getByRole('button', {name: 'Grant access'}).click();
  await expect(page.getByRole('row', {name: /Isha Rao.*instructor-login@example.test/})).toBeVisible();

  expect(roleCalls).toEqual([
    {name: 'erp_grant_co_owner_access', body: {p_email: 'coowner@example.test'}},
    {name: 'erp_grant_admin_access', body: {p_email: 'admin@example.test', p_branch_ids: [BRANCH2]}},
    {name: 'erp_grant_instructor_access', body: {p_instructor_id: INSTRUCTOR_RECORD, p_email: 'instructor-login@example.test', p_branch_ids: [BRANCH, BRANCH2]}},
  ]);

  await page.getByRole('row', {name: /Isha Rao/}).getByRole('button', {name: 'Sign-in access'}).click();
  await instructorDialog.getByRole('button', {name: 'Remove access'}).click();
  await instructorDialog.getByRole('button', {name: 'Yes, remove access'}).click();
  await expect(page.getByRole('row', {name: /Isha Rao.*Suspended/})).toBeVisible();
  expect(roleCalls.at(-1)).toEqual({name: 'erp_revoke_instructor_access', body: {p_instructor_id: INSTRUCTOR_RECORD}});

  await page.getByRole('button', {name: 'Settings', exact: true}).click();
  await expect(page.getByRole('heading', {name: 'Studio ERP data'})).toBeVisible();
});

test('co-owner can set up instructor profiles and grant instructor portal access', async ({page}) => {
  page.on('pageerror', error => console.error('Browser page error:', error.message));
  await mockAuth(page);
  const server = emptySnapshot();
  server.branches.push({id: BRANCH, name: 'Panvel', city: 'Panvel', address: '', phone: '', status: 'active', createdAt: '2026-01-01T00:00:00Z', syncVersion: 1});
  server.instructors.push({id: INSTRUCTOR_RECORD, branchId: BRANCH, fullName: 'Isha Rao', phone: '', email: 'isha-record@example.test', specialties: [], status: 'active', createdAt: '2026-01-01T00:00:00Z', syncVersion: 1});
  const accessState = {
    actor: {
      userId: account.id, email: account.email, roles: ['co_owner'], primaryRole: 'co_owner', orgRole: 'co_owner',
      branchIds: [BRANCH], adminBranchIds: [],
      canManageCoOwners: false, canManageAdmins: true, canManageInstructors: true, canManageStudents: true,
    },
    orgMembers: [
      {userId: '11111111-1111-4111-8111-111111111111', email: 'owner@example.test', role: 'owner', status: 'active', createdAt: '2026-01-01T00:00:00Z', isSelf: false},
      {userId: account.id, email: account.email, role: 'co_owner', status: 'active', createdAt: '2026-01-01T00:00:00Z', isSelf: true},
    ],
    adminAssignments: [],
    instructors: [{instructorId: INSTRUCTOR_RECORD, fullName: 'Isha Rao', contactEmail: 'isha-record@example.test', phone: '', branchId: BRANCH, recordStatus: 'active', accessStatus: 'none', accessEmail: '', accessUserId: null, accessBranchIds: [], batchBranchIds: [BRANCH]}],
  };
  const instructorGrantCalls = [];

  await page.route('https://auth.yoga-studio.test/rest/v1/rpc/**', async route => {
    const name = new URL(route.request().url()).pathname.split('/').pop();
    const body = route.request().postDataJSON() || {};
    const reply = value => route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify(value)});
    if (name === 'erp_get_context') return reply({organizationId: ORG, organizationName: 'Yoga Studio', roles: ['co_owner'], primaryRole: 'co_owner', adminBranchIds: [], instructorId: null, studentId: null});
    if (name === 'erp_get_snapshot') return reply(structuredClone(server));
    if (name === 'erp_sync_push') return reply({serverTime: new Date().toISOString(), results: []});
    if (name === 'erp_list_role_access') return reply(structuredClone(accessState));
    if (name === 'erp_grant_instructor_access') {
      instructorGrantCalls.push(structuredClone(body));
      Object.assign(accessState.instructors[0], {
        accessStatus: 'active', accessEmail: body.p_email, accessUserId: INSTRUCTOR_USER,
        accessBranchIds: body.p_branch_ids,
      });
      return reply({instructorId: body.p_instructor_id, userId: INSTRUCTOR_USER, email: body.p_email, role: 'instructor', branchIds: body.p_branch_ids});
    }
    return route.fulfill({status: 404, contentType: 'application/json', body: JSON.stringify({code: 'PGRST202', message: 'Function not mocked'})});
  });

  await page.goto('/');
  await signIn(page);
  await page.getByRole('button', {name: 'Branches & batches', exact: true}).click();
  await page.getByRole('tab', {name: 'Instructor profiles'}).click();
  await expect(page.getByRole('heading', {name: 'Instructor profiles'})).toBeVisible();
  await expect(page.getByRole('button', {name: 'Add instructor'})).toBeVisible();
  await page.getByRole('button', {name: 'Portal access', exact: true}).click();
  await expect(page.getByRole('heading', {name: 'Instructor sign-ins'})).toBeVisible();
  await expect(page.getByRole('button', {name: 'Add Co-owner', exact: true})).toHaveCount(0);

  await page.getByRole('row', {name: /Isha Rao/}).getByRole('button', {name: 'Sign-in access'}).click();
  const instructorDialog = page.getByRole('dialog', {name: 'Instructor sign-in access'});
  await instructorDialog.getByLabel('Instructor sign-in email').fill('instructor-login@example.test');
  await instructorDialog.getByRole('button', {name: 'Grant access'}).click();
  await expect(page.getByRole('row', {name: /Isha Rao.*instructor-login@example.test/})).toBeVisible();
  expect(instructorGrantCalls).toEqual([{
    p_instructor_id: INSTRUCTOR_RECORD,
    p_email: 'instructor-login@example.test',
    p_branch_ids: [BRANCH],
  }]);

  await page.getByRole('button', {name: 'Settings', exact: true}).click();
  await expect(page.getByRole('heading', {name: 'Studio ERP data'})).toHaveCount(0);
});

test('branch Admin access page hides organization roles and owner-only setup actions', async ({page}) => {
  page.on('pageerror', error => console.error('Browser page error:', error.message));
  await mockAuth(page);
  const server = emptySnapshot();
  server.branches.push({id: BRANCH, name: 'Panvel', city: 'Panvel', address: '', phone: '', status: 'active', createdAt: '2026-01-01T00:00:00Z', syncVersion: 1});
  server.instructors.push({id: INSTRUCTOR_RECORD, branchId: BRANCH, fullName: 'Isha Rao', phone: '', email: 'isha-record@example.test', specialties: [], status: 'active', createdAt: '2026-01-01T00:00:00Z', syncVersion: 1});
  server.plans.push({id: '77777777-7777-4777-8777-777777777777', name: 'Monthly', amountPaise: 150000, durationMonths: 1, status: 'active', createdAt: '2026-01-01T00:00:00Z', syncVersion: 1});
  const accessState = {
    actor: {
      userId: account.id, email: account.email, roles: ['admin'], primaryRole: 'admin', orgRole: null,
      branchIds: [BRANCH], adminBranchIds: [BRANCH],
      canManageCoOwners: false, canManageAdmins: false, canManageInstructors: true, canManageStudents: true,
    },
    orgMembers: [], adminAssignments: [],
    instructors: [{instructorId: INSTRUCTOR_RECORD, fullName: 'Isha Rao', contactEmail: 'isha-record@example.test', phone: '', branchId: BRANCH, recordStatus: 'active', accessStatus: 'none', accessEmail: '', accessUserId: null, accessBranchIds: [], batchBranchIds: [BRANCH]}],
  };
  const instructorGrantCalls = [];

  await page.route('https://auth.yoga-studio.test/rest/v1/rpc/**', async route => {
    const name = new URL(route.request().url()).pathname.split('/').pop();
    const body = route.request().postDataJSON() || {};
    const reply = value => route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify(value)});
    if (name === 'erp_get_context') return reply({organizationId: ORG, organizationName: 'Yoga Studio', roles: ['admin'], primaryRole: 'admin', adminBranchIds: [BRANCH], instructorId: null, studentId: null});
    if (name === 'erp_get_snapshot') return reply(structuredClone(server));
    if (name === 'erp_sync_push') return reply({serverTime: new Date().toISOString(), results: []});
    if (name === 'erp_list_role_access') return reply(structuredClone(accessState));
    if (name === 'erp_grant_instructor_access') {
      instructorGrantCalls.push(structuredClone(body));
      Object.assign(accessState.instructors[0], {
        accessStatus: 'active', accessEmail: body.p_email, accessUserId: INSTRUCTOR_USER,
        accessBranchIds: body.p_branch_ids,
      });
      return reply({instructorId: body.p_instructor_id, userId: INSTRUCTOR_USER, email: body.p_email, role: 'instructor', branchIds: body.p_branch_ids});
    }
    return route.fulfill({status: 404, contentType: 'application/json', body: JSON.stringify({code: 'PGRST202', message: 'Function not mocked'})});
  });

  await page.goto('/');
  await signIn(page);
  await page.getByRole('button', {name: 'Access', exact: true}).click();
  await expect(page.getByRole('heading', {name: 'Instructor sign-ins'})).toBeVisible();
  await expect(page.getByRole('heading', {name: 'Owner & Co-owners'})).toHaveCount(0);
  await expect(page.getByRole('heading', {name: 'Branch Admins'})).toHaveCount(0);

  await page.getByRole('row', {name: /Isha Rao/}).getByRole('button', {name: 'Sign-in access'}).click();
  const instructorDialog = page.getByRole('dialog', {name: 'Instructor sign-in access'});
  await instructorDialog.getByLabel('Instructor sign-in email').fill('instructor-login@example.test');
  await instructorDialog.getByRole('button', {name: 'Grant access'}).click();
  await expect(page.getByRole('row', {name: /Isha Rao.*instructor-login@example.test/})).toBeVisible();
  expect(instructorGrantCalls).toEqual([{
    p_instructor_id: INSTRUCTOR_RECORD,
    p_email: 'instructor-login@example.test',
    p_branch_ids: [BRANCH],
  }]);

  await page.getByRole('button', {name: 'Subscriptions', exact: true}).click();
  await expect(page.getByRole('heading', {name: /^Subscriptions/, level: 1})).toBeVisible();
  await page.getByRole('tab', {name: 'Plans'}).click();
  await expect(page.getByRole('heading', {name: 'Plans', exact: true})).toBeVisible();
  await expect(page.getByRole('button', {name: 'Add plan'})).toHaveCount(0);
  await expect(page.getByRole('tab', {name: 'Payment setup'})).toHaveCount(0);
  await page.getByRole('button', {name: 'Payments', exact: true}).click();
  await expect(page.getByRole('tab', {name: 'Payment setup'})).toHaveCount(0);
  await page.getByRole('button', {name: 'Settings', exact: true}).click();
  await expect(page.getByRole('heading', {name: 'Studio ERP data'})).toBeVisible();
});

test('signed-in instructor is locked to their linked instructor record', async ({page}) => {
  page.on('pageerror', error => console.error('Browser page error:', error.message));
  await mockAuth(page);
  const BATCH = '88888888-8888-4888-8888-888888888888';
  const CANDIDATE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const ENROLLMENT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const server = emptySnapshot();
  server.branches.push({id: BRANCH, name: 'Panvel', city: 'Panvel', address: '', phone: '', status: 'active', createdAt: '2026-01-01T00:00:00Z', syncVersion: 1});
  server.instructors.push({
    id: INSTRUCTOR_RECORD, branchId: BRANCH, fullName: 'Isha Rao', phone: '9876500000',
    email: 'isha-record@example.test', bio: 'Breath-led Hatha and restorative classes.',
    specialties: ['Hatha', 'Restorative'], qualifications: 'RYT-500', experienceYears: 9,
    joiningDate: '2023-06-01', status: 'active', createdAt: '2026-01-01T00:00:00Z', syncVersion: 1,
  });
  server.batches.push({id: BATCH, branchId: BRANCH, name: 'Morning Hatha', instructorId: INSTRUCTOR_RECORD, days: [1, 2, 3, 4, 5], startTime: '07:00', durationMins: 60, capacity: 20, status: 'active', createdAt: '2026-01-01T00:00:00Z', syncVersion: 1});
  server.students.push(
    {id: STUDENT, branchId: BRANCH, firstName: 'Asha', lastName: 'Patil', fullName: 'Asha Patil', phone: '1111111111', email: 'asha@example.test', gender: '', dob: '', joiningDate: '2026-01-01', status: 'active', notes: '', createdAt: '2026-01-01T00:00:00Z', syncVersion: 1},
    // SQL v11 still sends only roster identity fields for an Instructor's
    // same-branch student; private profile fields stay blank in this fixture.
    {id: CANDIDATE, branchId: BRANCH, firstName: 'Nikhil', lastName: 'Sharma', fullName: 'Nikhil Sharma', phone: '', email: '', gender: '', dob: '', joiningDate: '2026-02-01', status: 'active', notes: '', createdAt: '2026-01-01T00:00:00Z', syncVersion: 1},
  );
  server.enrollments.push({id: ENROLLMENT, batchId: BATCH, studentId: STUDENT, joinedOn: '2026-01-01', status: 'active', createdAt: '2026-01-01T00:00:00Z', syncVersion: 1});
  const PLAN = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const MEMBERSHIP = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  const CANDIDATE_MEMBERSHIP = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
  const PAYMENT = '12121212-1212-4121-8121-121212121212';
  server.plans.push({
    id: PLAN, name: 'Monthly Yoga', amountPaise: 150000, durationMonths: 1,
    planType: 'subscription', billingCycle: 'joining', renewalEnabledDefault: true,
    status: 'active', createdAt: '2026-01-01T00:00:00Z', syncVersion: 1,
  });
  server.memberships.push(
    {
      id: MEMBERSHIP, studentId: STUDENT, planId: PLAN, branchId: BRANCH,
      startDate: '2026-10-01', endDate: '2026-10-31', billingCycle: 'joining',
      durationMonths: 1, amountPaise: 150000, status: 'active', offeringType: 'subscription',
      autoRenew: true, previousMembershipId: '', renewalNumber: 0, totalPausedDays: 0,
      createdAt: '2026-01-01T00:00:00Z', syncVersion: 1,
    },
    {
      id: CANDIDATE_MEMBERSHIP, studentId: CANDIDATE, planId: PLAN, branchId: BRANCH,
      startDate: '2026-10-01', endDate: '2026-10-31', billingCycle: 'joining',
      durationMonths: 1, amountPaise: 150000, status: 'active', offeringType: 'subscription',
      autoRenew: true, previousMembershipId: '', renewalNumber: 0, totalPausedDays: 0,
      createdAt: '2026-01-01T00:00:00Z', syncVersion: 1,
    },
  );
  server.payments.push({
    id: PAYMENT, studentId: STUDENT, membershipId: MEMBERSHIP, branchId: BRANCH,
    amountPaise: 50000, method: 'upi', paidOn: '2026-10-02', note: 'First instalment',
    receiptNo: 'YS-2026-0009', status: 'recorded', createdAt: '2026-10-02T00:00:00Z', syncVersion: 1,
  });
  const syncRequests = [];

  await page.route('https://auth.yoga-studio.test/rest/v1/rpc/**', async route => {
    const name = new URL(route.request().url()).pathname.split('/').pop();
    const body = route.request().postDataJSON() || {};
    const reply = value => route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify(value)});
    if (name === 'erp_get_context') return reply({organizationId: ORG, organizationName: 'Yoga Studio', roles: ['instructor'], primaryRole: 'instructor', adminBranchIds: [], branchIds: [BRANCH], instructorId: INSTRUCTOR_RECORD, studentId: null});
    if (name === 'erp_get_snapshot') return reply(structuredClone(server));
    if (name === 'erp_get_admission_link_info') {
      return reply({organizationId: ORG, organizationName: 'Yoga Studio', admissionCode: 'instructor-share-code'});
    }
    if (name === 'erp_sync_push') {
      syncRequests.push(structuredClone(body));
      const results = (body.p_payload?.operations || []).map(op => {
        const list = server[op.entity];
        const index = list.findIndex(record => record.id === op.entityId);
        const record = {...op.payload, syncVersion: op.baseVersion ? op.baseVersion + 1 : 1};
        if (index >= 0) list[index] = {...list[index], ...record};
        else list.push(record);
        return {
          opId: op.opId, status: 'applied', entity: op.entity, entityId: op.entityId,
          serverEntityId: op.entityId, serverVersion: record.syncVersion,
        };
      });
      return reply({serverTime: new Date().toISOString(), results});
    }
    return route.fulfill({status: 404, contentType: 'application/json', body: JSON.stringify({code: 'PGRST202', message: 'Function not mocked'})});
  });

  await page.goto('/');
  await signIn(page);
  await expect(page.getByRole('button', {name: 'Access', exact: true})).toHaveCount(0);
  await expect(page.getByRole('button', {name: 'Subscriptions', exact: true})).toHaveCount(0);
  await expect(page.getByRole('button', {name: 'Students', exact: true})).toBeVisible();
  await expect(page.getByRole('button', {name: 'Payments', exact: true})).toBeVisible();
  await expect(page.getByRole('button', {name: 'Branches & batches', exact: true})).toHaveCount(0);

  await page.getByRole('button', {name: 'Payments', exact: true}).click();
  await expect(page.getByRole('heading', {name: 'My student payments'})).toBeVisible();
  await expect(page.getByRole('row', {name: /Asha Patil.*₹1,000/})).toBeVisible();
  await expect(page.getByText('Nikhil Sharma')).toHaveCount(0);
  await expect(page.getByRole('tab', {name: 'Payment setup'})).toHaveCount(0);
  await expect(page.getByRole('button', {name: 'Void'})).toHaveCount(0);
  await expect(page.getByRole('button', {name: 'Discard pending'})).toHaveCount(0);
  await page.getByRole('row', {name: /Asha Patil.*Monthly Yoga/}).getByRole('button', {name: /Collect/}).click();
  const instructorPayment = page.getByRole('dialog', {name: 'Record verified payment'});
  await expect(instructorPayment.getByLabel('Amount received (₹)')).toHaveValue('1000');
  await instructorPayment.getByLabel('Note / transaction reference').fill('UPI balance verified');
  await instructorPayment.getByRole('button', {name: 'Save payment'}).click();
  await expect(instructorPayment).toBeHidden();
  const instructorPaymentOps = syncRequests.flatMap(request => request.p_payload?.operations || [])
    .filter(op => op.type === 'payment_create');
  expect(instructorPaymentOps).toHaveLength(1);
  expect(instructorPaymentOps[0].payload).toEqual(expect.objectContaining({
    membershipId: MEMBERSHIP, studentId: STUDENT, branchId: BRANCH,
    amountPaise: 100000, method: 'upi', note: 'UPI balance verified',
  }));

  await page.getByRole('button', {name: 'Students', exact: true}).click();
  await expect(page.getByRole('heading', {name: 'My students'})).toBeVisible();
  await expect(page.getByRole('row', {name: /Asha Patil.*Morning Hatha/})).toBeVisible();
  await expect(page.getByText('Nikhil Sharma')).toHaveCount(0);
  await expect(page.getByRole('heading', {name: 'Admission requests'})).toHaveCount(0);
  await expect(page.getByRole('button', {name: /Portal access/})).toHaveCount(0);
  await expect(page.getByLabel('Studio admission link', {exact: true})).toHaveValue(/admission=instructor-share-code/);
  await expect(page.getByLabel('Studio admission link', {exact: true})).not.toHaveValue(/branch=/);
  await expect(page.getByLabel('Panvel admission link', {exact: true})).toHaveValue(new RegExp(`branch=${BRANCH}`));
  await page.getByRole('button', {name: 'New enrollment'}).first().click();
  const studentsWizard = page.getByRole('dialog', {name: 'Enroll student'});
  await expect(studentsWizard).toBeVisible();
  await expect(studentsWizard.getByRole('heading', {name: 'Who is enrolling?'})).toBeVisible();
  await expect(studentsWizard.getByRole('button', {name: /1\. Student/})).toBeVisible();
  await studentsWizard.getByRole('button', {name: /Continue to Batch/}).click();
  await expect(studentsWizard.getByRole('heading', {name: 'Choose the batch'})).toBeVisible();
  await expect(studentsWizard.getByLabel('Assign to batch')).toHaveValue(BATCH);
  await expect(studentsWizard.getByText(/Next class/)).toBeVisible();
  await studentsWizard.getByRole('button', {name: 'Cancel', exact: true}).click();
  await expect(studentsWizard).toBeHidden();

  await page.getByRole('button', {name: 'Batches', exact: true}).click();
  await expect(page.getByRole('heading', {name: 'Instructor profiles'})).toHaveCount(0);
  await expect(page.getByRole('button', {name: 'Add instructor'})).toHaveCount(0);
  await expect(page.getByRole('button', {name: 'Portal access'})).toHaveCount(0);

  await page.getByRole('button', {name: /Roster/}).click();
  const roster = page.getByRole('dialog', {name: 'Morning Hatha — roster'});
  await expect(roster).toContainText('This is your assigned batch');
  await roster.getByLabel('Add student to batch').selectOption({label: 'Nikhil Sharma'});
  await roster.getByRole('button', {name: 'Enroll student'}).click();
  await expect(roster.locator('.erp-att-row', {hasText: 'Nikhil Sharma'})).toBeVisible();
  await roster.locator('.erp-att-row', {hasText: 'Asha Patil'}).getByRole('button', {name: 'Remove'}).click();
  await expect(roster.locator('.erp-att-row', {hasText: 'Asha Patil'})).toHaveCount(0);
  await page.getByRole('button', {name: 'Close Morning Hatha — roster'}).click();
  const enrollmentOps = syncRequests.flatMap(request => request.p_payload?.operations || [])
    .filter(op => op.entity === 'enrollments');
  expect(enrollmentOps.map(op => [op.payload.studentId, op.payload.status])).toEqual([
    [CANDIDATE, 'active'],
    [STUDENT, 'ended'],
  ]);

  await page.getByRole('button', {name: 'Attendance', exact: true}).click();
  const instructorPicker = page.getByLabel('Signed-in instructor');
  await expect(instructorPicker).toBeDisabled();
  await expect(instructorPicker).toHaveValue(INSTRUCTOR_RECORD);
  await expect(page.getByLabel('Portal role')).toBeDisabled();
  await expect(page.getByLabel('Portal role')).toHaveValue('instructor');
  await expect(page.getByRole('combobox', {name: 'Attendance batch'})).toHaveValue(BATCH);

  await page.getByRole('button', {name: 'Profile', exact: true}).click();
  await expect(page.locator('.profile-detail-grid')).toContainText('Instructor');
  await expect(page.locator('.profile-detail-grid')).toContainText('Isha Rao');
  await expect(page.locator('.profile-linked-record')).toContainText('Breath-led Hatha');
  await expect(page.locator('.profile-linked-record')).toContainText('RYT-500');
  await expect(page.locator('.profile-linked-record')).toContainText('Morning Hatha');
  await page.getByRole('button', {name: 'Settings', exact: true}).click();
  await expect(page.getByRole('heading', {name: 'Studio ERP data'})).toHaveCount(0);
});

test('instructor creates a basic walk-in student, enrolls them in an own batch and collects the plan payment', async ({page}) => {
  page.on('pageerror', error => console.error('Browser page error:', error.message));
  await mockAuth(page);
  const BATCH = '88888888-8888-4888-8888-888888888888';
  const PLAN = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const server = emptySnapshot();
  server.branches.push({id: BRANCH, name: 'Panvel', city: 'Panvel', address: '', phone: '', status: 'active', createdAt: '2026-01-01T00:00:00Z', syncVersion: 1});
  server.instructors.push({
    id: INSTRUCTOR_RECORD, branchId: BRANCH, fullName: 'Isha Rao', phone: '', email: '',
    specialties: [], status: 'active', createdAt: '2026-01-01T00:00:00Z', syncVersion: 1,
  });
  server.batches.push({
    id: BATCH, branchId: BRANCH, name: 'Morning Hatha', instructorId: INSTRUCTOR_RECORD,
    days: [1, 2, 3, 4, 5], startTime: '07:00', durationMins: 60, capacity: 20,
    status: 'active', createdAt: '2026-01-01T00:00:00Z', syncVersion: 1,
  });
  server.plans.push({
    id: PLAN, name: 'Monthly Yoga', amountPaise: 150000, durationMonths: 1,
    planType: 'subscription', billingCycle: 'joining', renewalEnabledDefault: true,
    status: 'active', createdAt: '2026-01-01T00:00:00Z', syncVersion: 1,
  });
  const syncRequests = [];
  let plansLoaded = false;
  let setupVersion = 10;

  await page.route('https://auth.yoga-studio.test/rest/v1/rpc/**', async route => {
    const name = new URL(route.request().url()).pathname.split('/').pop();
    const body = route.request().postDataJSON() || {};
    const reply = value => route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify(value)});
    if (name === 'erp_get_context') return reply({organizationId: ORG, organizationName: 'Yoga Studio', roles: ['instructor'], primaryRole: 'instructor', adminBranchIds: [], branchIds: [BRANCH], instructorId: INSTRUCTOR_RECORD, studentId: null, setupVersion});
    if (name === 'erp_get_snapshot') {
      const snapshot = structuredClone(server);
      if (!plansLoaded) snapshot.plans = [];
      return reply(snapshot);
    }
    if (name === 'erp_sync_push') {
      syncRequests.push(structuredClone(body));
      const results = (body.p_payload?.operations || []).map(op => {
        const list = server[op.entity];
        const index = list.findIndex(record => record.id === op.entityId);
        const record = {
          ...op.payload, id: op.entityId,
          syncVersion: op.baseVersion ? op.baseVersion + 1 : 1,
          ...(op.type === 'payment_create' ? {receiptNo: 'YS-2026-0010'} : {}),
        };
        if (index >= 0) list[index] = {...list[index], ...record};
        else list.push(record);
        return {
          opId: op.opId, status: 'applied', entity: op.entity, entityId: op.entityId,
          serverEntityId: op.entityId, serverVersion: record.syncVersion,
          ...(op.type === 'payment_create' ? {receiptNo: record.receiptNo} : {}),
        };
      });
      return reply({serverTime: new Date().toISOString(), results});
    }
    return route.fulfill({status: 404, contentType: 'application/json', body: JSON.stringify({code: 'PGRST202', message: 'Function not mocked'})});
  });

  await page.goto('/');
  await signIn(page);
  await page.getByRole('button', {name: 'Batches', exact: true}).click();
  await page.locator('.erp-batch-card', {hasText: 'Morning Hatha'})
    .getByRole('button', {name: 'Enroll', exact: true}).click();
  const wizard = page.getByRole('dialog', {name: 'Enroll student'});
  await expect(wizard).toBeVisible();
  await wizard.getByRole('button', {name: /New walk-in student/}).click();
  await wizard.getByLabel('First Name').fill('Walkin');
  await wizard.getByLabel('Last Name').fill('Student');
  await wizard.getByLabel('Phone Number').fill('9876543210');
  await wizard.getByRole('button', {name: /Continue to Batch/}).click();
  await expect(wizard.getByLabel('Assign to batch')).toHaveValue(BATCH);
  await expect(wizard.getByText(/Students enrolled/)).toBeVisible();
  await wizard.getByRole('button', {name: /Continue to Plan/}).click();
  await expect(wizard.getByText('Instructor plans need the SQL v11 update')).toBeVisible();
  await expect(wizard.getByText(/Owners could receive the plan list but Instructors received no plans/)).toBeVisible();
  await expect(wizard.getByRole('button', {name: 'Reload plans'})).toBeVisible();
  setupVersion = 11;
  plansLoaded = true;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(wizard.getByRole('combobox', {name: 'Plan', exact: true})).toHaveValue(PLAN);
  await expect(wizard.getByLabel(/Create subscription or one-month pass now/)).toBeChecked();
  await expect(wizard.getByLabel('Plan amount (₹)')).toHaveValue('1500');
  await expect(wizard.getByLabel('Plan amount (₹)')).toHaveAttribute('readonly', '');
  await expect(wizard.locator('.enrollment-plan-preview').getByText('Gross amount due')).toBeVisible();
  await wizard.getByRole('button', {name: /Continue to Payment & review/}).click();
  await expect(wizard.getByLabel('Amount received (₹)')).toHaveValue('1500');
  await expect(wizard.locator('.enrollment-payment-balance').getByText('Balance after payment')).toBeVisible();
  await expect(wizard.getByText('Review before saving')).toBeVisible();
  await expect(wizard.getByLabel('Medical / Physical issue')).toHaveCount(0);
  await wizard.getByRole('button', {name: /Enroll & collect ₹1,500/}).click();
  const completeDialog = page.getByRole('dialog', {name: 'Enrolment complete'});
  await expect(completeDialog).toBeVisible();
  await expect(completeDialog.getByText('YS-2026-0010')).toBeVisible();
  await completeDialog.getByRole('button', {name: 'View receipt'}).click();
  const receiptDialog = page.getByRole('dialog', {name: 'Payment invoice'});
  await expect(receiptDialog).toBeVisible();
  await expect(receiptDialog.getByText('PAYMENT RECEIPT')).toBeVisible();
  await receiptDialog.getByRole('button', {name: 'Close', exact: true}).click();
  await completeDialog.getByRole('button', {name: 'Done', exact: true}).click();
  await expect(completeDialog).toBeHidden();

  const ops = syncRequests.flatMap(request => request.p_payload?.operations || []);
  const studentOp = ops.find(op => op.entity === 'students');
  const enrollmentOp = ops.find(op => op.entity === 'enrollments');
  const membershipOp = ops.find(op => op.entity === 'memberships');
  const paymentOp = ops.find(op => op.type === 'payment_create');
  expect(studentOp?.payload).toEqual(expect.objectContaining({
    fullName: 'Walkin Student', branchId: BRANCH, walkInBatchId: BATCH,
    medicalPhysicalIssue: '', address: '', status: 'active',
  }));
  expect(enrollmentOp?.payload).toEqual(expect.objectContaining({
    batchId: BATCH, studentId: studentOp.entityId, status: 'active',
  }));
  expect(membershipOp?.payload).toEqual(expect.objectContaining({
    studentId: studentOp.entityId, planId: PLAN, branchId: BRANCH,
    amountPaise: 150000, billingCycle: 'joining', durationMonths: 1,
    offeringType: 'subscription', autoRenew: true, previousMembershipId: '', renewalNumber: 0,
  }));
  expect(paymentOp?.payload).toEqual(expect.objectContaining({
    membershipId: membershipOp.entityId, studentId: studentOp.entityId,
    branchId: BRANCH, amountPaise: 150000, method: 'upi',
  }));
  expect(server.students.some(student => student.fullName === 'Walkin Student')).toBeTruthy();
});

test('signed-in student sees a view-only portal for their own records', async ({page}) => {
  page.on('pageerror', error => console.error('Browser page error:', error.message));
  await mockAuth(page);

  const BATCH = '33333333-3333-4333-8333-333333333333';
  const OTHER_BATCH = '99999999-9999-4999-8999-999999999999';
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
    }, {
      id: OTHER_BATCH, branchId: BRANCH, name: 'Evening Yoga', instructorId: '', days: [2, 4],
      startTime: '18:00', durationMins: 60, capacity: 15, status: 'active',
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
      autoRenew: true, previousMembershipId: '', renewalNumber: 0,
      pausedFrom: '', pausedUntil: '', pauseReason: '', totalPausedDays: 0,
      cancelledAt: null, cancelReason: '',
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
  await expect(page.getByLabel('Signed-in student')).toBeDisabled();
  await expect(page.getByLabel('Signed-in student')).toHaveValue(STUDENT);
  await expect(page.getByLabel('Portal role')).toBeDisabled();
  await expect(page.getByLabel('Portal role')).toHaveValue('student');
  await expect(page.getByText(/Supabase · Synced|Online · synced/)).toHaveCount(0);
  await expect(page.getByRole('button', {name: 'Sync now'})).toHaveCount(0);
  await expect(page.getByRole('button', {name: 'Students', exact: true})).toHaveCount(0);
  await expect(page.getByRole('button', {name: 'Branches & batches', exact: true})).toHaveCount(0);
  await expect(page.getByRole('button', {name: 'Access', exact: true})).toHaveCount(0);
  await expect(page.getByRole('heading', {name: 'My assigned batches'})).toBeVisible();
  await expect(page.getByRole('heading', {name: 'My subscription & passes'})).toBeVisible();
  await expect(page.getByRole('heading', {name: 'Recent attendance'})).toBeVisible();
  await expect(page.getByText('Morning Yoga').first()).toBeVisible();
  await expect(page.getByText('Evening Yoga')).toHaveCount(0);
  await expect(page.getByText('My dues')).toBeVisible();
  await expect(page.getByText('1 Jan 2027', {exact: true})).toBeVisible();
  await expect(page.getByText(/Renewal is confirmed by the studio; there is no automatic charge/)).toBeVisible();
  await expect(page.getByText(/Less rush|Collected this month|Active students|Set up your studio/)).toHaveCount(0);

  await page.getByRole('button', {name: 'Batches', exact: true}).click();
  const studentBatchCard = page.locator('.erp-batch-card', {hasText: 'Morning Yoga'});
  await expect(studentBatchCard).toBeVisible();
  await expect(studentBatchCard).toContainText('Enrolled');
  await expect(studentBatchCard).not.toContainText(/students|seat\(s\) available/i);
  await page.getByRole('button', {name: 'Schedule', exact: true}).click();
  await expect(page.locator('.erp-schedule-day', {hasText: 'Monday'})).toContainText('Morning Yoga');
  await expect(page.getByText(/seat\(s\) left/i)).toHaveCount(0);
  await page.getByRole('button', {name: 'List', exact: true}).click();
  await expect(page.getByText('Evening Yoga')).toHaveCount(0);
  await expect(page.getByRole('button', {name: /Roster/})).toHaveCount(0);
  await expect(page.getByRole('button', {name: /Add batch/})).toHaveCount(0);
  await expect(page.getByRole('heading', {name: 'Instructor profiles'})).toHaveCount(0);
  await expect(page.getByRole('button', {name: 'Add instructor'})).toHaveCount(0);
  await expect(page.getByRole('button', {name: 'Portal access'})).toHaveCount(0);
  await expect(page.getByRole('button', {name: /Edit/})).toHaveCount(0);

  await page.getByRole('button', {name: 'Attendance', exact: true}).click();
  await expect(page.getByRole('heading', {name: 'My attendance'})).toBeVisible();
  await expect(page.getByRole('cell', {name: 'Morning Yoga'})).toBeVisible();

  await page.getByRole('button', {name: 'Subscriptions', exact: true}).click();
  await expect(page.getByRole('heading', {name: 'Subscriptions & dues'})).toBeVisible();
  await expect(page.getByText('Next renewal 1 Jan 2027')).toBeVisible();
  await expect(page.getByRole('tab', {name: 'Payment setup'})).toHaveCount(0);
  await expect(page.getByRole('button', {name: /Record payment/})).toHaveCount(0);
  await expect(page.getByRole('button', {name: 'New subscription'})).toHaveCount(0);
  await expect(page.getByRole('button', {name: 'Pause', exact: true})).toHaveCount(0);
  await expect(page.getByRole('button', {name: 'Resume', exact: true})).toHaveCount(0);
  await expect(page.getByRole('button', {name: 'Renew', exact: true})).toHaveCount(0);
  await expect(page.getByRole('button', {name: 'Cancel subscription', exact: true})).toHaveCount(0);
  await expect(page.getByRole('button', {name: 'History'})).toBeVisible();
  await expect(page.getByRole('button', {name: /Invoice PDF/})).toBeVisible();
  await page.getByRole('button', {name: 'Payments', exact: true}).click();
  await expect(page.getByText('YS-2026-0001')).toBeVisible();
  await expect(page.getByRole('button', {name: /Invoice PDF/})).toBeVisible();

  await page.getByRole('button', {name: 'Settings', exact: true}).click();
  await expect(page.getByRole('heading', {name: 'Your settings'})).toBeVisible();
  await expect(page.getByRole('heading', {name: 'Studio ERP data'})).toHaveCount(0);
  await expect(page.getByRole('button', {name: 'Sync now'})).toHaveCount(0);
  await expect(page.getByText(/Supabase · Synced|Online · synced/)).toHaveCount(0);

  // Simulate an admin removing access while this student tab is open. The
  // next online load must stop presenting the downloaded studio snapshot.
  accessGranted = false;
  await page.reload();
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
  await page.getByLabel('Email address').fill(account.email);
  await page.getByLabel('Password', {exact: true}).fill('valid-test-password');
  await page.getByRole('button', {name: 'Sign in', exact: true}).click();
  await expect(page.getByRole('heading', {name: /Waiting for studio access/})).toBeVisible();
  await expect(page.getByText('This account is not connected to a studio yet.')).toBeVisible();
  await expect(page.getByText('Waiting for your studio to grant access.')).toBeVisible();
  await expect(page.getByRole('radio', {name: /Join an existing studio/})).toBeChecked();
  await expect(page.getByRole('navigation', {name: 'Main navigation'})).toHaveCount(0);
  await expect(page.getByRole('button', {name: 'Create organization'})).toHaveCount(0);
  await expect(page.getByLabel('Organization name')).toHaveCount(0);

  granted = true;
  await page.getByRole('button', {name: 'Retry'}).click();
  await expect(page.getByLabel('Signed-in student')).toBeDisabled();
  await expect(page.getByLabel('Signed-in student')).toHaveValue(STUDENT);
  await expect(page.getByRole('button', {name: 'Students', exact: true})).toHaveCount(0);
  await expect(page.getByText('My dues')).toBeVisible();
});

test('prospective owner explicitly chooses the studio creation path', async ({page}) => {
  page.on('pageerror', error => console.error('Browser page error:', error.message));
  await mockAuth(page);
  let created = false;
  const server = {...emptySnapshot(), billingSettings: []};

  await page.route('https://auth.yoga-studio.test/rest/v1/rpc/**', async route => {
    const url = new URL(route.request().url());
    const name = url.pathname.split('/').pop();
    const reply = value => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify(value),
    });
    if (name === 'erp_get_context') {
      return reply(created ? {
        organizationId: ORG, organizationName: 'New Yoga Studio', roles: ['owner'],
        instructorId: null, studentId: null,
      } : {
        organizationId: null, organizationName: '', roles: [],
        instructorId: null, studentId: null,
      });
    }
    if (name === 'erp_get_snapshot') {
      if (!created) {
        return route.fulfill({
          status: 400, contentType: 'application/json',
          body: JSON.stringify({code: 'P0001', message: 'NO_ORGANIZATION: create or join an organization first'}),
        });
      }
      return reply(structuredClone(server));
    }
    if (name === 'erp_bootstrap_organization') {
      created = true;
      return reply({organizationId: ORG, alreadyExisted: false});
    }
    if (name === 'erp_sync_push') return reply({serverTime: new Date().toISOString(), results: []});
    return route.fulfill({
      status: 404, contentType: 'application/json',
      body: JSON.stringify({code: 'PGRST202', message: 'Function not mocked'}),
    });
  });

  await page.goto('/');
  await page.getByLabel('Email address').fill(account.email);
  await page.getByLabel('Password', {exact: true}).fill('valid-test-password');
  await page.getByRole('button', {name: 'Sign in', exact: true}).click();
  await expect(page.getByRole('heading', {name: /Waiting for studio access/})).toBeVisible();
  await expect(page.getByRole('button', {name: 'Create organization'})).toHaveCount(0);

  await page.getByRole('radio', {name: /Create my own studio/}).check();
  await expect(page.getByRole('heading', {name: /Create your studio/})).toBeVisible();
  await page.getByLabel('Organization name').fill('New Yoga Studio');
  await page.getByRole('button', {name: 'Create organization'}).click();

  await expect(page.getByRole('heading', {name: /Welcome back, Test/})).toBeVisible();
  await expect(page.getByRole('heading', {name: 'Set up your studio'})).toBeVisible();
  await expect(page.getByText('Supabase · Synced')).toBeVisible();
});

test('applicant submits the account-first public admission form', async ({page}) => {
  page.on('pageerror', error => console.error('Browser page error:', error.message));
  const authCalls = await mockAuth(page);
  let admission = null;
  const getCalls = [];
  const submitCalls = [];

  await page.route('https://auth.yoga-studio.test/rest/v1/rpc/**', async route => {
    const name = new URL(route.request().url()).pathname.split('/').pop();
    const body = route.request().postDataJSON() || {};
    const reply = value => route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify(value)});
    if (name === 'erp_get_context') {
      return reply({organizationId: null, organizationName: '', roles: [], instructorId: null, studentId: null});
    }
    if (name === 'erp_get_snapshot') {
      return route.fulfill({
        status: 400, contentType: 'application/json',
        body: JSON.stringify({code: 'P0001', message: 'NO_ORGANIZATION: create or join an organization first'}),
      });
    }
    if (name === 'erp_get_my_admission') {
      getCalls.push(structuredClone(body));
      return reply({
        target: {
          organizationId: ORG, organizationName: 'Yoga Studio', admissionCode: ADMISSION_CODE,
          branchId: body.p_branch_id, branchName: body.p_branch_id ? 'Main Branch' : '',
          preferredBranchId: body.p_branch_id, preferredBranchName: body.p_branch_id ? 'Main Branch' : '',
        },
        applicantEmail: account.email,
        admission: admission ? structuredClone(admission) : null,
      });
    }
    if (name === 'erp_submit_admission') {
      submitCalls.push(structuredClone(body));
      admission = {
        id: ADMISSION, organizationId: ORG, applicantUserId: account.id,
        ...structuredClone(body.p_payload),
        fullName: `${body.p_payload.firstName} ${body.p_payload.lastName}`,
        status: 'pending', branchId: body.p_branch_id, branchName: body.p_branch_id ? 'Main Branch' : '', studentId: null,
        submittedAt: '2026-10-30T00:00:00Z', updatedAt: '2026-10-30T00:00:00Z',
        reviewedAt: null, reviewNote: '',
      };
      return reply(structuredClone(admission));
    }
    if (name === 'erp_sync_push') return reply({serverTime: new Date().toISOString(), results: []});
    return route.fulfill({status: 404, contentType: 'application/json', body: JSON.stringify({code: 'PGRST202', message: 'Function not mocked'})});
  });

  await page.goto(`/?admission=${ADMISSION_CODE}&branch=${BRANCH}`);
  await expect(page.getByText('You are applying for studio admission.')).toBeVisible();
  await expect(page.getByRole('radio', {name: /Create my own studio/})).toHaveCount(0);
  await page.getByRole('button', {name: 'Create an account'}).click();
  await expect(page.getByRole('radio', {name: /Create my own studio/})).toHaveCount(0);
  await page.getByLabel('Full name').fill('Asha Patil');
  await page.getByLabel('Email address').fill(account.email);
  await page.getByLabel('Password', {exact: true}).fill('valid-test-password');
  await page.getByRole('button', {name: 'Create your account'}).click();
  await expect(page.getByText(/complete the admission form/)).toBeVisible();
  const signupCall = authCalls.find(call => call.path.endsWith('/signup'));
  expect(signupCall?.data?.data).toEqual(expect.objectContaining({
    account_intent: 'member', admission_code: ADMISSION_CODE, admission_branch_id: BRANCH,
  }));
  await page.getByRole('button', {name: 'Back to sign in'}).click();
  await page.getByLabel('Email address').fill(account.email);
  await page.getByLabel('Password', {exact: true}).fill('valid-test-password');
  await page.getByRole('button', {name: 'Sign in', exact: true}).click();

  await expect(page.getByRole('heading', {name: /Admission form/})).toBeVisible();
  await expect(page.locator('.erp-banner', {hasText: 'Preferred branch:'})).toContainText('Main Branch');
  expect(getCalls.at(-1)).toEqual({p_code: ADMISSION_CODE, p_branch_id: BRANCH});
  await expect(page.getByRole('button', {name: 'Create organization'})).toHaveCount(0);
  await expect(page.getByLabel('Your Email')).toHaveValue(account.email);
  await expect(page.getByLabel('Your Email')).toHaveAttribute('readonly', '');
  await page.getByLabel('First Name').fill('Asha');
  await page.getByLabel('Last Name').fill('Patil');
  await page.getByLabel('Date Of Birth').fill('2000-01-02');
  await page.getByLabel('Phone Number').fill('9876543210');
  await page.getByLabel('Subject').fill('New Admission in Personal yoga session');
  await page.getByLabel('Address').fill('Panvel, Maharashtra');
  await page.getByLabel('Pin Code').fill('410206');
  await page.getByLabel('Reference by').fill('A friend');
  await page.getByRole('radio', {name: 'Less Experienced'}).check();
  await page.getByLabel('Medical / Physical issue').fill('Mild knee discomfort');
  await page.getByLabel('Reasons to join yoga').fill('Improve flexibility and focus');
  await page.getByRole('button', {name: 'Submit admission'}).click();

  await expect(page.getByText('Admission submitted — pending studio confirmation.')).toBeVisible();
  expect(submitCalls).toEqual([{
    p_code: ADMISSION_CODE,
    p_payload: {
      firstName: 'Asha', lastName: 'Patil', dob: '2000-01-02', phone: '9876543210',
      subject: 'New Admission in Personal yoga session', email: account.email,
      address: 'Panvel, Maharashtra', pinCode: '410206', referredBy: 'A friend',
      yogaExperience: 'less_experienced', medicalPhysicalIssue: 'Mild knee discomfort',
      reasonToJoin: 'Improve flexibility and focus',
    },
    p_branch_id: BRANCH,
  }]);
});

test('admission link takes precedence over a saved local-device session', async ({page}) => {
  page.on('pageerror', error => console.error('Browser page error:', error.message));
  await mockAuth(page);
  await page.addInitScript(() => localStorage.setItem('yoga-studio-local-session', '1'));
  await page.goto(`/?admission=${ADMISSION_CODE}`);
  await expect(page.getByText('You are applying for studio admission.')).toBeVisible();
  await expect(page.getByRole('button', {name: 'Sign in', exact: true})).toBeVisible();
  await expect(page.getByRole('button', {name: 'Dashboard', exact: true})).toHaveCount(0);
});

test('manager confirms an admission, creating the student and granting portal access', async ({page}) => {
  page.on('pageerror', error => console.error('Browser page error:', error.message));
  await mockAuth(page);
  const server = emptySnapshot();
  const BATCH = '88888888-8888-4888-8888-888888888888';
  const PLAN = '99999999-9999-4999-8999-999999999998';
  server.branches.push(
    {
      id: BRANCH, name: 'Main Branch', city: 'Panvel', address: '', phone: '',
      status: 'active', createdAt: '2026-01-01T00:00:00Z', syncVersion: 1,
    },
    {
      id: BRANCH2, name: 'Thane Branch', city: 'Thane', address: '', phone: '',
      status: 'active', createdAt: '2026-01-01T00:00:00Z', syncVersion: 1,
    },
  );
  server.batches.push({
    id: BATCH, branchId: BRANCH, name: 'Morning Hatha', instructorId: '', days: [1, 2, 3, 4, 5],
    startTime: '07:00', durationMins: 60, capacity: 20, status: 'active',
    createdAt: '2026-01-01T00:00:00Z', syncVersion: 1,
  });
  server.plans.push({
    id: PLAN, name: 'Monthly Yoga', amountPaise: 150000, durationMonths: 1,
    planType: 'subscription', billingCycle: 'joining', renewalEnabledDefault: true,
    status: 'active', createdAt: '2026-01-01T00:00:00Z', syncVersion: 1,
  });
  const admission = {
    id: ADMISSION, organizationId: ORG, applicantUserId: INSTRUCTOR_USER,
    firstName: 'Asha', lastName: 'Patil', fullName: 'Asha Patil', dob: '2000-01-02',
    phone: '9876543210', subject: 'New Admission in Personal yoga session',
    email: 'applicant@example.test', address: 'Panvel, Maharashtra', pinCode: '410206',
    referredBy: 'A friend', yogaExperience: 'less_experienced',
    medicalPhysicalIssue: 'Mild knee discomfort', reasonToJoin: 'Improve flexibility and focus',
    status: 'pending', branchId: BRANCH, branchName: 'Main Branch', studentId: null,
    submittedAt: '2026-10-30T00:00:00Z', updatedAt: '2026-10-30T00:00:00Z',
    reviewedAt: null, reviewNote: '', possibleDuplicateStudentId: null, possibleDuplicateStudentName: '',
  };
  const reviewCalls = [];
  const otherAccessCalls = [];
  const syncRequests = [];

  await page.route('https://auth.yoga-studio.test/rest/v1/rpc/**', async route => {
    const name = new URL(route.request().url()).pathname.split('/').pop();
    const body = route.request().postDataJSON() || {};
    const reply = value => route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify(value)});
    if (name === 'erp_get_context') {
      return reply({organizationId: ORG, organizationName: 'Yoga Studio', roles: ['owner'], instructorId: null, studentId: null});
    }
    if (name === 'erp_get_snapshot') return reply(structuredClone(server));
    if (name === 'erp_get_admission_link_info') {
      return reply({organizationId: ORG, organizationName: 'Yoga Studio', admissionCode: ADMISSION_CODE});
    }
    if (name === 'erp_list_admissions') {
      const admissions = body.p_status === 'all' || admission.status === body.p_status ? [structuredClone(admission)] : [];
      return reply({admissions});
    }
    if (name === 'erp_review_admission') {
      reviewCalls.push(structuredClone(body));
      admission.status = 'confirmed';
      admission.branchId = body.p_branch_id;
      admission.studentId = STUDENT;
      admission.reviewNote = body.p_review_note;
      server.students.push({
        id: STUDENT, branchId: body.p_branch_id, firstName: admission.firstName,
        lastName: admission.lastName, fullName: admission.fullName, phone: admission.phone,
        email: admission.email, gender: '', dob: admission.dob,
        joiningDate: body.p_joining_date, status: 'active', notes: '',
        address: admission.address, pinCode: admission.pinCode,
        admissionSubject: admission.subject, referredBy: admission.referredBy,
        yogaExperience: admission.yogaExperience,
        medicalPhysicalIssue: admission.medicalPhysicalIssue,
        reasonToJoin: admission.reasonToJoin,
        createdAt: '2026-10-30T00:00:00Z', syncVersion: 1,
        portalAccessStatus: 'active', portalAccessEmail: admission.email,
      });
      return reply({
        admissionId: ADMISSION, status: 'confirmed', studentId: STUDENT,
        email: admission.email, portalAccessStatus: 'active',
      });
    }
    if (name === 'erp_grant_student_access') {
      otherAccessCalls.push(structuredClone(body));
      return reply({studentId: STUDENT});
    }
    if (name === 'erp_sync_push') {
      syncRequests.push(structuredClone(body));
      const results = (body.p_payload?.operations || []).map(op => {
        const list = server[op.entity];
        const index = list.findIndex(record => record.id === op.entityId);
        const record = {
          ...op.payload, id: op.entityId,
          syncVersion: op.baseVersion ? op.baseVersion + 1 : 1,
          ...(op.type === 'payment_create' ? {receiptNo: 'YS-2026-0001'} : {}),
        };
        if (index >= 0) list[index] = {...list[index], ...record};
        else list.push(record);
        return {
          opId: op.opId, status: 'applied', entity: op.entity, entityId: op.entityId,
          serverEntityId: op.entityId, serverVersion: record.syncVersion,
          ...(op.type === 'payment_create' ? {receiptNo: record.receiptNo} : {}),
        };
      });
      return reply({serverTime: new Date().toISOString(), results});
    }
    return route.fulfill({status: 404, contentType: 'application/json', body: JSON.stringify({code: 'PGRST202', message: 'Function not mocked'})});
  });

  await page.goto('/');
  await signIn(page);
  await page.getByRole('button', {name: 'Students', exact: true}).click();
  await expect(page.getByRole('heading', {name: 'Admission requests'})).toBeVisible();
  await expect(page.getByLabel('Studio admission link', {exact: true})).toHaveValue(new RegExp(`admission=${ADMISSION_CODE}`));
  await expect(page.getByLabel('Studio admission link', {exact: true})).not.toHaveValue(/branch=/);
  await expect(page.getByLabel('Main Branch admission link', {exact: true})).toHaveValue(new RegExp(`branch=${BRANCH}`));
  await expect(page.getByLabel('Thane Branch admission link', {exact: true})).toHaveValue(new RegExp(`branch=${BRANCH2}`));
  const studioLinkCard = page.locator('.admission-link-card', {
    has: page.getByRole('heading', {name: 'Studio admission link'}),
  });
  await studioLinkCard.getByRole('button', {name: 'QR'}).click();
  const qrDialog = page.getByRole('dialog', {name: 'Studio admission link QR code'});
  await expect(qrDialog.getByRole('img', {name: 'QR code for Studio admission link'})).toBeVisible();
  await qrDialog.getByRole('button', {name: 'Done'}).click();

  await page.getByLabel('Search admission requests').fill('Personal yoga');
  await page.getByLabel('Admission branch filter').selectOption(BRANCH);
  const admissionCard = page.getByLabel('Asha Patil admission request');
  await expect(admissionCard).toBeVisible();
  await expect(admissionCard.getByRole('link', {name: /Call/})).toHaveAttribute('href', 'tel:9876543210');
  await expect(admissionCard.getByRole('link', {name: /WhatsApp/})).toHaveAttribute('href', /wa\.me\/919876543210/);
  await admissionCard.getByRole('button', {name: 'Review & enroll'}).click();
  const reviewDialog = page.getByRole('dialog', {name: 'Review admission'});
  await expect(reviewDialog.getByText('Mild knee discomfort')).toBeVisible();
  await expect(reviewDialog.getByText('Branch-link preference:')).toBeVisible();
  await reviewDialog.getByLabel('Admission branch').selectOption(BRANCH);
  await reviewDialog.getByLabel('Joining date').fill('2026-11-01');
  await expect(reviewDialog.getByLabel(/Continue to batch, plan & payment/)).toBeChecked();
  await reviewDialog.getByRole('button', {name: 'Confirm & continue enrolment'}).click();

  const enrollmentDialog = page.getByRole('dialog', {name: 'Complete enrolment'});
  await expect(enrollmentDialog).toBeVisible();
  await expect(enrollmentDialog.getByText('Student ready')).toBeVisible();
  await enrollmentDialog.getByRole('button', {name: /Continue to Batch/}).click();
  await enrollmentDialog.getByLabel('Assign to batch').selectOption(BATCH);
  await enrollmentDialog.getByRole('button', {name: /Continue to Plan/}).click();
  await enrollmentDialog.getByRole('combobox', {name: 'Plan', exact: true}).selectOption(PLAN);
  await enrollmentDialog.getByRole('button', {name: /Continue to Payment & review/}).click();
  await expect(enrollmentDialog.getByLabel('Amount received (₹)')).toHaveValue('1500');
  await expect(enrollmentDialog.getByText('Review before saving')).toBeVisible();
  await enrollmentDialog.getByRole('button', {name: /Enroll & collect ₹1,500/}).click();
  const completeDialog = page.getByRole('dialog', {name: 'Enrolment complete'});
  await expect(completeDialog).toBeVisible();
  await expect(completeDialog.getByText('YS-2026-0001')).toBeVisible();
  await completeDialog.getByRole('button', {name: 'View receipt'}).click();
  const receiptDialog = page.getByRole('dialog', {name: 'Payment invoice'});
  await expect(receiptDialog).toBeVisible();
  await receiptDialog.getByRole('button', {name: 'Close', exact: true}).click();
  await completeDialog.getByRole('button', {name: 'Done', exact: true}).click();
  await expect(completeDialog).toBeHidden();

  await expect(page.getByRole('row', {name: /Asha Patil.*Morning Hatha.*Portal active/})).toBeVisible();
  const syncOps = syncRequests.flatMap(request => request.p_payload?.operations || []);
  expect(syncOps.find(op => op.entity === 'enrollments')?.payload).toEqual(expect.objectContaining({
    batchId: BATCH, studentId: STUDENT, status: 'active',
  }));
  expect(syncOps.find(op => op.entity === 'memberships')?.payload).toEqual(expect.objectContaining({
    studentId: STUDENT, planId: PLAN, branchId: BRANCH, amountPaise: 150000,
  }));
  expect(syncOps.find(op => op.type === 'payment_create')?.payload).toEqual(expect.objectContaining({
    studentId: STUDENT, branchId: BRANCH, amountPaise: 150000, method: 'upi',
  }));
  expect(reviewCalls).toEqual([{
    p_admission_id: ADMISSION, p_action: 'confirm', p_branch_id: BRANCH,
    p_joining_date: '2026-11-01', p_review_note: '',
  }]);
  expect(otherAccessCalls).toEqual([]);

  await page.getByRole('row', {name: /Asha Patil.*Portal active/}).getByRole('button', {name: /Edit/}).click();
  const studentDialog = page.getByRole('dialog', {name: 'Edit student'});
  await expect(studentDialog.getByLabel('First Name')).toHaveValue('Asha');
  await expect(studentDialog.getByLabel('Last Name')).toHaveValue('Patil');
  await expect(studentDialog.getByLabel('Address')).toHaveValue('Panvel, Maharashtra');
  await expect(studentDialog.getByLabel('Medical / Physical issue')).toHaveValue('Mild knee discomfort');
});

test('manager pauses, resumes, renews and cancels a subscription at the current plan price', async ({page}) => {
  page.on('pageerror', error => console.error('Browser page error:', error.message));
  await mockAuth(page);
  const PLAN = '88888888-8888-4888-8888-888888888888';
  const MEMBERSHIP = '99999999-9999-4999-8999-999999999998';
  const server = emptySnapshot();
  server.branches.push({
    id: BRANCH, name: 'Main Branch', city: 'Panvel', address: '', phone: '',
    status: 'active', createdAt: '2026-01-01T00:00:00Z', syncVersion: 1,
  });
  server.students.push({
    id: STUDENT, branchId: BRANCH, firstName: 'Asha', lastName: 'Patil',
    fullName: 'Asha Patil', phone: '9876543210', email: 'asha@example.test',
    gender: '', dob: '', joiningDate: '2026-10-01', status: 'active', notes: '',
    createdAt: '2026-01-01T00:00:00Z', syncVersion: 1,
  });
  server.plans.push({
    id: PLAN, name: 'Monthly Yoga', amountPaise: 200000, durationMonths: 2,
    status: 'active', createdAt: '2026-01-01T00:00:00Z', syncVersion: 1,
  });
  server.memberships.push({
    id: MEMBERSHIP, studentId: STUDENT, planId: PLAN, branchId: BRANCH,
    startDate: '2026-10-01', endDate: '2026-10-31', billingCycle: 'joining',
    durationMonths: 1, amountPaise: 150000, status: 'active',
    autoRenew: true, previousMembershipId: '', renewalNumber: 0,
    pausedFrom: '', pausedUntil: '', pauseReason: '', totalPausedDays: 0,
    cancelledAt: null, cancelReason: '',
    createdAt: '2026-10-01T00:00:00Z', syncVersion: 1,
  });
  const membershipOps = [];
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
    const name = new URL(route.request().url()).pathname.split('/').pop();
    const body = route.request().postDataJSON() || {};
    const reply = value => route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify(value)});
    if (name === 'erp_get_context') {
      return reply({organizationId: ORG, organizationName: 'Yoga Studio', roles: ['owner'], instructorId: null, studentId: null});
    }
    if (name === 'erp_get_snapshot') return reply(structuredClone(server));
    if (name === 'erp_sync_push') {
      const operations = body.p_payload?.operations || [];
      membershipOps.push(...structuredClone(operations.filter(op => op.entity === 'memberships')));
      return reply({serverTime: new Date().toISOString(), results: operations.map(applyOperation)});
    }
    return route.fulfill({status: 404, contentType: 'application/json', body: JSON.stringify({code: 'PGRST202', message: 'Function not mocked'})});
  });

  await page.goto('/');
  await signIn(page);
  await page.getByRole('button', {name: 'Subscriptions', exact: true}).click();
  await expect(page.getByRole('heading', {name: 'Subscriptions & dues'})).toBeVisible();
  await expect(page.getByText('Monthly recurring revenue')).toBeVisible();
  let subscriptionRow = page.getByRole('row', {name: /Asha Patil/});
  await expect(subscriptionRow.getByText('Next renewal 1 Nov 2026')).toBeVisible();

  await subscriptionRow.getByRole('button', {name: 'Pause'}).click();
  let dialog = page.getByRole('dialog', {name: 'Pause subscription'});
  await dialog.getByLabel('Pause from').fill('2026-10-10');
  await dialog.getByLabel('Expected resume date').fill('2026-10-20');
  await dialog.getByLabel('Pause reason').fill('Travel');
  await dialog.getByRole('button', {name: 'Pause subscription', exact: true}).click();
  await expect(page.getByText('Supabase · Synced')).toBeVisible();
  subscriptionRow = page.getByRole('row', {name: /Asha Patil/});
  await expect(subscriptionRow.getByText('paused', {exact: true})).toBeVisible();

  await subscriptionRow.getByRole('button', {name: 'Resume'}).click();
  dialog = page.getByRole('dialog', {name: 'Resume subscription'});
  await dialog.getByLabel('Resume date').fill('2026-10-20');
  await dialog.getByRole('button', {name: 'Resume subscription', exact: true}).click();
  await expect(page.getByText('Supabase · Synced')).toBeVisible();
  subscriptionRow = page.getByRole('row', {name: /1 Oct 2026.*10 Nov 2026/});
  await expect(subscriptionRow).toBeVisible();

  await subscriptionRow.getByRole('button', {name: 'Renew'}).click();
  dialog = page.getByRole('dialog', {name: 'Renew subscription'});
  await expect(dialog.getByLabel('Renewal plan')).toHaveValue(PLAN);
  await expect(dialog.getByLabel('Renewal start date')).toHaveValue('2026-11-11');
  await expect(dialog.getByLabel('Renewal amount (₹)')).toHaveValue('2000');
  await dialog.getByRole('button', {name: 'Create renewal'}).click();
  await expect(page.getByText('Supabase · Synced')).toBeVisible();
  const renewalRow = page.getByRole('row', {name: /11 Nov 2026.*10 Jan 2027/});
  await expect(renewalRow.getByText('Renewal #1')).toBeVisible();
  await expect(renewalRow.getByText('₹2,000').first()).toBeVisible();
  await expect(subscriptionRow.getByRole('button', {name: 'Pause'})).toHaveCount(0);

  subscriptionRow = page.getByRole('row', {name: /1 Oct 2026.*10 Nov 2026/});
  await subscriptionRow.getByRole('button', {name: 'History'}).click();
  dialog = page.getByRole('dialog', {name: 'Subscription history'});
  await expect(dialog.getByText('Original subscription')).toBeVisible();
  await expect(dialog.getByText('Renewal #1')).toBeVisible();
  await dialog.getByRole('button', {name: 'Close Subscription history'}).click();

  await renewalRow.getByRole('button', {name: 'Cancel subscription', exact: true}).click();
  dialog = page.getByRole('dialog', {name: 'Cancel subscription'});
  await dialog.getByLabel('Cancellation reason').fill('Student requested cancellation');
  await dialog.getByRole('button', {name: 'Cancel subscription', exact: true}).click();
  await expect(page.getByText('Supabase · Synced')).toBeVisible();
  await expect(page.getByRole('row', {name: /11 Nov 2026.*cancelled/})).toBeVisible();
  await expect(subscriptionRow.getByRole('button', {name: 'Renew'})).toBeVisible();

  const payloads = membershipOps.map(op => op.payload);
  expect(payloads.some(payload => payload.id === MEMBERSHIP && payload.status === 'paused'
    && payload.pausedFrom === '2026-10-10' && payload.pauseReason === 'Travel')).toBeTruthy();
  expect(payloads.some(payload => payload.id === MEMBERSHIP && payload.status === 'active'
    && payload.totalPausedDays === 10 && payload.endDate === '2026-11-10')).toBeTruthy();
  expect(payloads.some(payload => payload.previousMembershipId === MEMBERSHIP
    && payload.amountPaise === 200000 && payload.durationMonths === 2
    && payload.startDate === '2026-11-11' && payload.endDate === '2027-01-10')).toBeTruthy();
  expect(payloads.some(payload => payload.status === 'cancelled'
    && payload.cancelReason === 'Student requested cancellation')).toBeTruthy();
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
  await page.getByRole('button', {name: 'Payments', exact: true}).click();
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
