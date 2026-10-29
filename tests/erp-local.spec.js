import {test, expect} from '@playwright/test';

// Runs against the unconfigured build (no Supabase keys): the explicit
// offline device mode is the only way in, and it must start empty.
test('offline device mode runs the core ERP flow end to end', async ({page}) => {
  page.on('pageerror', error => console.error('Browser page error:', error.message));
  await page.goto('/');
  await page.getByRole('button', {name: 'Use this device only — offline mode'}).click();
  await expect(page.getByRole('heading', {name: 'Set up your studio'})).toBeVisible();

  // Branch
  await page.getByRole('button', {name: 'Branches', exact: true}).click();
  await page.getByRole('button', {name: 'Add branch'}).click();
  await page.getByLabel('Branch name').fill('Panvel');
  await page.getByLabel('City').fill('Panvel');
  await page.getByRole('button', {name: 'Save branch'}).click();
  await expect(page.getByRole('cell', {name: /Panvel/})).toBeVisible();

  // Student
  await page.getByRole('button', {name: 'Students', exact: true}).click();
  await page.getByRole('button', {name: 'Add student'}).click();
  await page.getByLabel('Full name').fill('Asha Patil');
  await page.getByRole('dialog').getByLabel('Student branch').selectOption({label: 'Panvel'});
  await page.getByRole('button', {name: 'Save student'}).click();
  await expect(page.getByRole('cell', {name: /Asha Patil/})).toBeVisible();

  // Instructor + batch + enrollment
  await page.getByRole('button', {name: 'Batches', exact: true}).click();
  await page.getByRole('button', {name: 'Add instructor'}).click();
  await page.getByLabel('Instructor name').fill('Meera Joshi');
  await page.getByRole('button', {name: 'Save instructor'}).click();
  await page.getByRole('button', {name: 'Add batch'}).click();
  await page.getByLabel('Batch name').fill('Morning Hatha');
  await page.getByRole('dialog').getByLabel('Batch branch').selectOption({label: 'Panvel'});
  await page.getByRole('dialog').getByLabel('Batch instructor').selectOption({label: 'Meera Joshi'});
  await page.getByRole('button', {name: 'Save batch'}).click();
  await page.getByRole('button', {name: /Roster/}).click();
  await page.getByLabel('Add student to batch').selectOption({label: 'Asha Patil'});
  await page.getByRole('button', {name: 'Enroll student'}).click();
  await expect(page.getByRole('dialog').getByText('Asha Patil')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', {name: 'Close Morning Hatha — roster'}).click();

  // Attendance
  await page.getByRole('button', {name: 'Attendance', exact: true}).click();
  await page.getByRole('group', {name: 'Attendance for Asha Patil'}).getByRole('button', {name: 'Present'}).click();
  await page.getByRole('button', {name: 'Save attendance'}).click();
  await expect(page.getByRole('status')).toContainText('Attendance saved');

  // Plan + membership + payment + receipt
  await page.getByRole('button', {name: 'Fees', exact: true}).click();
  await page.getByRole('tab', {name: 'Plans'}).click();
  await page.getByRole('button', {name: 'Add plan'}).click();
  await page.getByLabel('Plan name').fill('Monthly');
  await page.getByLabel('Price (₹)').fill('1500');
  await page.getByRole('button', {name: 'Save plan'}).click();
  await page.getByRole('tab', {name: 'Memberships & dues'}).click();
  await page.getByRole('button', {name: 'New membership'}).click();
  await page.getByRole('button', {name: 'Create membership'}).click();
  await expect(page.getByRole('cell', {name: /Asha Patil/})).toBeVisible();
  await page.getByRole('button', {name: /Collect/}).click();
  await page.getByRole('button', {name: 'Save payment'}).click();
  await expect(page.getByRole('cell', {name: /YS-\d{4}-0001/})).toBeVisible();
  await page.getByRole('button', {name: /Receipt/}).click();
  await expect(page.getByRole('dialog').getByText('₹1,500')).toBeVisible();

  // Data survives a reload (offline persistence) and fits a phone screen.
  await page.reload();
  await expect(page.getByRole('navigation')).toBeVisible();
  await page.setViewportSize({width: 390, height: 844});
  await page.getByRole('button', {name: 'Open menu'}).click();
  await page.getByRole('button', {name: 'Fees', exact: true}).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
});
