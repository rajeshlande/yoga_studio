import {test, expect} from '@playwright/test';

// Runs against the unconfigured build (no Supabase keys): the explicit
// offline device mode is the only way in, and it must start empty.
test('offline device mode runs the core ERP flow end to end', async ({page}) => {
  page.on('pageerror', error => console.error('Browser page error:', error.message));
  await page.emulateMedia({colorScheme: 'light'});
  await page.goto('/');
  await page.getByRole('button', {name: 'Use this device only — offline mode'}).click();
  await expect(page.getByRole('heading', {name: 'Set up your studio'})).toBeVisible();
  await expect(page.locator('.connection-badge')).toContainText('Online · this device');

  // Theme from feature_development: quick toggle cycles system -> light -> dark and persists.
  const themeToggle = page.getByRole('button', {name: /Switch theme/});
  await themeToggle.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await themeToggle.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await page.evaluate(() => localStorage.getItem('ys-theme'))).toBe('dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', {name: 'Settings', exact: true}).click();
  await page.getByRole('radio', {name: 'System'}).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await page.evaluate(() => localStorage.getItem('ys-theme'))).toBe('system');
  await page.getByRole('button', {name: 'Dashboard', exact: true}).click();

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
  await expect(page.locator('.toast')).toContainText('Attendance saved');

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

  // A due invoice can be generated before setup, but it clearly warns that
  // Admin payment instructions are not configured yet.
  await page.getByRole('button', {name: /Invoice PDF/}).click();
  let invoiceDialog = page.getByRole('dialog', {name: 'Payment invoice'});
  await expect(invoiceDialog.getByText('UNPAID', {exact: true})).toBeVisible();
  await expect(invoiceDialog.getByText(/Payment instructions are not configured yet/)).toBeVisible();
  await expect(invoiceDialog.getByText('₹1,500.00').first()).toBeVisible();
  await invoiceDialog.getByRole('button', {name: 'Close', exact: true}).click();

  // Admin configures GST + manual UPI/bank + public gateway identifiers.
  // No gateway secret field exists; auto-confirmation remains not ready until
  // a trusted webhook is configured outside the browser.
  await page.getByRole('tab', {name: 'Payment setup'}).click();
  await page.getByLabel('Billing legal/business name').fill('Example Yoga LLP');
  await page.getByLabel('City').fill('Panvel');
  await page.getByLabel('PIN code').fill('410206');
  await page.getByLabel(/Show GST breakup/).check();
  await page.getByLabel('Seller GSTIN').fill('27AAAPL1234C1Z5');
  await page.getByLabel('SAC / HSN code').fill('9985');
  await page.getByLabel('UPI ID').fill('studio@okbank');
  await page.getByLabel('UPI payee name').fill('Example Yoga LLP');
  await page.getByLabel('Bank name').fill('Example Bank');
  await page.getByLabel('Account name').fill('Example Yoga LLP');
  await page.getByLabel('Account number').fill('123456789012');
  await page.getByLabel('IFSC').fill('HDFC0001234');
  await page.getByLabel('Provider').selectOption('razorpay');
  await page.getByLabel(/Razorpay Key ID/).fill('rzp_test_example123');
  await expect(page.getByText(/not ready for automatic payment confirmation/)).toBeVisible();
  await expect(page.getByLabel(/secret/i)).toHaveCount(0);
  await page.getByRole('button', {name: 'Save payment setup'}).click();
  await expect(page.locator('.toast')).toContainText('Payment & invoice settings saved.');

  // The same unpaid invoice now carries GST breakup, bank details and an
  // offline-generated dynamic UPI QR. Generating the browser PDF proves the
  // print stylesheet emits a real PDF document.
  await page.getByRole('tab', {name: 'Memberships & dues'}).click();
  await page.getByRole('button', {name: /Invoice PDF/}).click();
  invoiceDialog = page.getByRole('dialog', {name: 'Payment invoice'});
  await expect(invoiceDialog.getByText('Example Yoga LLP').first()).toBeVisible();
  await expect(invoiceDialog.getByText(/CGST \(9%\)/)).toBeVisible();
  await expect(invoiceDialog.getByText(/SGST \(9%\)/)).toBeVisible();
  await expect(invoiceDialog.getByText('₹1,271.19').first()).toBeVisible();
  await expect(invoiceDialog.getByText(/Account no\.: 123456789012/)).toBeVisible();
  await expect(invoiceDialog.getByRole('img', {name: /UPI QR code/})).toBeVisible();
  const duePdf = await page.pdf({format: 'A4', printBackground: true});
  expect(duePdf.subarray(0, 4).toString()).toBe('%PDF');
  await invoiceDialog.getByRole('button', {name: 'Close', exact: true}).click();

  await page.getByRole('button', {name: /Collect/}).click();
  await page.getByLabel('Note / transaction reference').fill('UPI-TEST-REF-001');
  await page.getByRole('button', {name: 'Save payment'}).click();
  await expect(page.getByRole('cell', {name: /YS-\d{4}-0001/})).toBeVisible();
  await page.getByRole('button', {name: /Invoice PDF/}).click();
  invoiceDialog = page.getByRole('dialog', {name: 'Payment invoice'});
  await expect(invoiceDialog.getByText('PAID', {exact: true})).toBeVisible();
  await expect(invoiceDialog.getByText(/Payment instructions and UPI QR are hidden/)).toBeVisible();
  await expect(invoiceDialog.getByRole('img', {name: /UPI QR code/})).toHaveCount(0);
  await expect(invoiceDialog.getByText('₹1,500.00').first()).toBeVisible();
  await expect(invoiceDialog.getByText('UPI-TEST-REF-001')).toBeVisible();
  await invoiceDialog.getByRole('button', {name: 'Close', exact: true}).click();

  // Data survives a reload (offline persistence) and fits a phone screen.
  await page.reload();
  await expect(page.getByRole('navigation')).toBeVisible();
  await page.setViewportSize({width: 390, height: 844});
  await page.getByRole('button', {name: 'Open menu'}).click();
  await page.getByRole('button', {name: 'Fees', exact: true}).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.context().setOffline(true);
  await expect(page.locator('.connection-badge')).toContainText('Offline · this device');
  await page.context().setOffline(false);
  await expect(page.locator('.connection-badge')).toContainText('Online · this device');
});
