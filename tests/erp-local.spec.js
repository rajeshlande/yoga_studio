import {test, expect} from '@playwright/test';

async function fieldBoxes(page, selector, count = 2) {
  return page.evaluate(({selector, count}) => [...document.querySelectorAll(selector)].slice(0, count).map(field => {
    const control = field.querySelector('input,select,textarea');
    const fieldRect = field.getBoundingClientRect();
    const controlRect = control?.getBoundingClientRect();
    return {
      labelTop: Math.round(fieldRect.top),
      controlTop: controlRect ? Math.round(controlRect.top) : null,
      controlBottom: controlRect ? Math.round(controlRect.bottom) : null,
      controlHeight: controlRect ? Math.round(controlRect.height) : null,
      marginTop: getComputedStyle(field).marginTop,
    };
  }), {selector, count});
}

function expectAlignedPair(boxes) {
  expect(boxes).toHaveLength(2);
  expect(Math.abs(boxes[0].labelTop - boxes[1].labelTop)).toBeLessThanOrEqual(1);
  expect(Math.abs(boxes[0].controlTop - boxes[1].controlTop)).toBeLessThanOrEqual(1);
  expect(boxes.map(box => box.controlHeight)).toEqual([44, 44]);
  expect(boxes.map(box => box.marginTop)).toEqual(['0px', '0px']);
}

async function expectPrintableInvoice(page, {paid}) {
  const originalViewport = page.viewportSize();
  // 719 x 1047 CSS px is the printable area of A4 portrait with the
  // invoice's 10 mm page margins. This catches the old failure where the
  // invoice was positioned inside the scrolling dialog and only a central
  // strip printed.
  await page.setViewportSize({width: 719, height: 1047});
  await page.emulateMedia({media: 'print'});
  const layout = await page.evaluate(() => {
    const appRoot = document.querySelector('#root');
    const printRoot = document.querySelector('body > .erp-print-root');
    const invoice = printRoot?.querySelector('.erp-invoice');
    const header = invoice?.querySelector('.erp-invoice-seller');
    const footer = invoice?.querySelector('.erp-invoice-disclaimer');
    const rect = element => {
      const box = element?.getBoundingClientRect();
      return box ? {top: box.top, bottom: box.bottom, left: box.left, right: box.right, width: box.width, height: box.height} : null;
    };
    const qr = invoice?.querySelector('.erp-invoice-qr img');
    return {
      bodyClass: document.body.classList.contains('erp-invoice-open'),
      appDisplay: appRoot ? getComputedStyle(appRoot).display : '',
      printDisplay: printRoot ? getComputedStyle(printRoot).display : '',
      invoice: rect(invoice),
      header: rect(header),
      footer: rect(footer),
      invoiceScrollHeight: invoice?.scrollHeight || 0,
      invoiceClientHeight: invoice?.clientHeight || 0,
      text: invoice?.innerText || '',
      qrCount: invoice?.querySelectorAll('.erp-invoice-qr img').length || 0,
      qrNaturalWidth: qr?.naturalWidth || 0,
    };
  });
  expect(layout.bodyClass).toBeTruthy();
  expect(layout.appDisplay).toBe('none');
  expect(layout.printDisplay).toBe('block');
  expect(layout.invoice).not.toBeNull();
  expect(layout.invoice.left).toBeGreaterThanOrEqual(0);
  expect(layout.invoice.top).toBeGreaterThanOrEqual(0);
  expect(layout.invoice.right).toBeLessThanOrEqual(720);
  expect(layout.invoice.width).toBeGreaterThanOrEqual(710);
  expect(layout.invoice.height).toBeLessThanOrEqual(1047);
  expect(layout.invoice.height).toBeGreaterThanOrEqual(1035);
  expect(layout.header.top).toBeGreaterThanOrEqual(layout.invoice.top);
  expect(layout.footer.bottom).toBeLessThanOrEqual(layout.invoice.bottom + 1);
  expect(layout.invoiceScrollHeight).toBeLessThanOrEqual(layout.invoiceClientHeight + 1);
  expect(layout.text).toContain('Example Yoga LLP');
  expect(layout.text).toContain('Computer-generated from Yoga Studio ERP records.');
  if (paid) {
    expect(layout.text).toContain('PAID');
    expect(layout.text).not.toContain('Scan to pay');
    expect(layout.qrCount).toBe(0);
  } else {
    expect(layout.text).toContain('Account no.: 123456789012');
    expect(layout.text).toContain('Scan to pay');
    expect(layout.qrCount).toBe(1);
    expect(layout.qrNaturalWidth).toBeGreaterThan(0);
  }

  const pdf = await page.pdf({format: 'A4', printBackground: true, preferCSSPageSize: true});
  expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
  const pdfText = pdf.toString('latin1');
  expect((pdfText.match(/\/Type\s*\/Page\b/g) || []).length).toBe(1);
  const mediaBox = pdfText.match(/\/MediaBox\s*\[([^\]]+)\]/)?.[1].trim().split(/\s+/).map(Number);
  expect(mediaBox).toHaveLength(4);
  expect(Math.abs((mediaBox[2] - mediaBox[0]) - 595.28)).toBeLessThanOrEqual(2);
  expect(Math.abs((mediaBox[3] - mediaBox[1]) - 841.89)).toBeLessThanOrEqual(2);
  expect(mediaBox[3] - mediaBox[1]).toBeGreaterThan(mediaBox[2] - mediaBox[0]);
  await page.emulateMedia({media: 'screen'});
  if (originalViewport) await page.setViewportSize(originalViewport);
  return pdf;
}

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
  await page.getByRole('button', {name: 'Branches & batches', exact: true}).click();
  await expect(page.getByRole('tab', {name: 'Batches'})).toBeVisible();
  await expect(page.getByRole('tab', {name: 'Instructor profiles'})).toBeVisible();
  await page.getByRole('button', {name: 'Add branch'}).click();
  expectAlignedPair(await fieldBoxes(page, '.erp-dialog .erp-form > .erp-field'));
  await page.getByLabel('Branch name').fill('Panvel');
  await page.getByLabel('City').fill('Panvel');
  await page.getByRole('button', {name: 'Save branch'}).click();
  const branchCard = page.locator('.erp-branch-card', {hasText: 'Panvel'});
  await expect(branchCard).toBeVisible();
  await expect(branchCard).toContainText('Needs a batch');

  // Student
  await page.getByRole('button', {name: 'Students', exact: true}).click();
  await page.getByRole('button', {name: 'Add student'}).click();
  expectAlignedPair(await fieldBoxes(page, '.erp-dialog .erp-form > .erp-field'));
  await page.getByLabel('First Name').fill('Asha');
  await page.getByLabel('Last Name').fill('Patil');
  await page.getByRole('dialog').getByLabel('Student branch').selectOption({label: 'Panvel'});
  await page.getByRole('button', {name: 'Save student'}).click();
  await expect(page.getByRole('cell', {name: /Asha Patil/})).toBeVisible();

  // Instructor + batch + enrollment now live under Branches & batches.
  await page.getByRole('button', {name: 'Branches & batches', exact: true}).click();
  await page.getByRole('tab', {name: 'Instructor profiles'}).click();
  await page.getByRole('button', {name: 'Add instructor'}).click();
  expectAlignedPair(await fieldBoxes(page, '.erp-dialog .erp-form > .erp-field'));
  await page.getByLabel('Instructor name').fill('Meera Joshi');
  await page.getByLabel('Specialties / styles').fill('Hatha, Breathwork');
  await page.getByLabel('Experience (years)').fill('8');
  await page.getByLabel('Joining date').fill('2024-04-15');
  await page.getByLabel('Qualifications / certifications').fill('RYT-500 · Prenatal certificate');
  await page.getByLabel('Instructor bio').fill('Gentle morning classes with a breath-led pace.');
  await page.getByRole('button', {name: 'Save instructor'}).click();
  const instructorCard = page.locator('.erp-instructor-card', {hasText: 'Meera Joshi'});
  await expect(instructorCard).toContainText('Hatha');
  await expect(instructorCard).toContainText('RYT-500');
  await expect(instructorCard).toContainText('8 yrs');
  await expect(instructorCard).toContainText('15 Apr 2024');
  await instructorCard.getByRole('button', {name: 'Edit profile'}).click();
  await page.getByLabel('Specialties / styles').fill('Hatha, yin, Breathwork');
  await page.getByLabel('Instructor bio').fill('Gentle, breath-led morning and evening classes.');
  await page.getByRole('button', {name: 'Save instructor'}).click();
  await expect(instructorCard).toContainText('yin');
  await expect(instructorCard).toContainText('breath-led morning and evening');
  await page.getByRole('tab', {name: 'Batches'}).click();
  await page.getByRole('button', {name: 'Add batch'}).click();
  // Regression: Branch used to sit 21px below Batch name because an
  // auth-only stacked-label margin leaked into ERP's two-column grids.
  expectAlignedPair(await fieldBoxes(page, '.erp-dialog .erp-form > .erp-field'));
  await page.getByLabel('Batch name').fill('Morning Hatha');
  await page.getByRole('dialog').getByLabel('Batch branch').selectOption({label: 'Panvel'});
  await page.getByRole('dialog').getByLabel('Batch instructor').selectOption({label: 'Meera Joshi'});
  await page.getByRole('button', {name: 'Save batch'}).click();
  const batchCard = page.locator('.erp-batch-card', {hasText: 'Morning Hatha'});
  await expect(batchCard).toContainText('0/20 students');
  await expect(batchCard).toContainText('20 seat(s) available');
  await page.getByRole('button', {name: 'Schedule', exact: true}).click();
  const mondaySchedule = page.locator('.erp-schedule-day', {hasText: 'Monday'});
  await expect(mondaySchedule).toContainText('Morning Hatha');
  await page.getByRole('button', {name: 'List', exact: true}).click();
  await page.getByRole('button', {name: /Roster/}).click();
  await page.getByLabel('Add student to batch').selectOption({label: 'Asha Patil'});
  await page.getByRole('button', {name: 'Enroll student'}).click();
  await expect(page.getByRole('dialog').getByText('Asha Patil')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', {name: 'Close Morning Hatha — roster'}).click();

  // The signed-in/local Instructor role can add/remove existing students
  // only through the roster of a batch assigned to that instructor.
  await page.getByLabel('Portal role').selectOption('instructor');
  await page.getByLabel('Acting instructor').selectOption({label: 'Meera Joshi'});
  await expect(page.getByRole('button', {name: 'Branches & batches', exact: true})).toHaveCount(0);
  await page.getByRole('button', {name: 'Batches', exact: true}).click();
  await page.getByRole('button', {name: /Roster/}).click();
  const instructorRoster = page.getByRole('dialog', {name: 'Morning Hatha — roster'});
  await expect(instructorRoster).toContainText('This is your assigned batch');
  await instructorRoster.getByRole('button', {name: 'Remove'}).click();
  await expect(instructorRoster.locator('.erp-att-row')).toHaveCount(0);
  await instructorRoster.getByLabel('Add student to batch').selectOption({label: 'Asha Patil'});
  await instructorRoster.getByRole('button', {name: 'Enroll student'}).click();
  await expect(instructorRoster.locator('.erp-att-row')).toContainText('Asha Patil');
  await page.getByRole('button', {name: 'Close Morning Hatha — roster'}).click();
  await page.getByLabel('Portal role').selectOption('owner');

  // Attendance
  await page.getByRole('button', {name: 'Attendance', exact: true}).click();
  expectAlignedPair(await fieldBoxes(page, '.erp-panel-head.align-end .erp-field'));
  const attendanceControls = await page.evaluate(() => {
    const input = document.querySelector('.erp-panel-head.align-end .erp-field input')?.getBoundingClientRect();
    const buttons = [...document.querySelectorAll('.erp-panel-head.align-end button')];
    const button = buttons
      .find(element => element.textContent.includes('Save attendance'))?.getBoundingClientRect();
    return {
      inputBottom: input?.bottom || 0,
      buttonBottom: button?.bottom || 0,
      buttonHeights: buttons.map(element => Math.round(element.getBoundingClientRect().height)),
    };
  });
  expect(Math.abs(attendanceControls.inputBottom - attendanceControls.buttonBottom)).toBeLessThanOrEqual(1);
  expect(attendanceControls.buttonHeights).toEqual([44, 44]);
  await page.getByRole('group', {name: 'Attendance for Asha Patil'}).getByRole('button', {name: 'Present'}).click();
  await page.getByRole('button', {name: 'Save attendance'}).click();
  await expect(page.locator('.toast')).toContainText('Attendance saved');

  // Plan + membership + payment + receipt
  await page.getByRole('button', {name: 'Subscriptions', exact: true}).click();
  await page.getByRole('tab', {name: 'Plans'}).click();
  await page.getByRole('button', {name: 'Add plan'}).click();
  await page.getByLabel('Plan name').fill('Monthly');
  await page.getByLabel('Price (₹)').fill('1500');
  await page.getByRole('button', {name: 'Save plan'}).click();

  // Odoo-style templates can also be a distinct one-month-only offering.
  await page.getByRole('button', {name: 'Add plan'}).click();
  await page.getByLabel('Plan name').fill('One Month Only');
  await page.getByLabel('Plan type').selectOption('one_month');
  await page.getByLabel('Price (₹)').fill('1200');
  await expect(page.getByLabel('Billing period (months)')).toBeDisabled();
  await expect(page.getByText(/No renewal — each sale is one fixed month/)).toBeVisible();
  await page.getByRole('button', {name: 'Save plan'}).click();

  await page.getByRole('tab', {name: 'Subscriptions & dues'}).click();
  await page.getByRole('button', {name: 'New subscription'}).click();
  await page.getByRole('button', {name: 'Create subscription'}).click();
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
  await page.getByRole('button', {name: 'Payments', exact: true}).click();
  await page.getByRole('tab', {name: 'Payment setup'}).click();
  expectAlignedPair(await fieldBoxes(page, '.erp-panel .erp-form > .erp-field'));
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
  // offline-generated dynamic UPI QR. The print regression helper proves the
  // complete invoice fits one A4 page outside the scrolling dialog.
  await page.getByRole('button', {name: 'Subscriptions', exact: true}).click();
  await page.getByRole('tab', {name: 'Subscriptions & dues'}).click();
  await page.getByRole('button', {name: /Invoice PDF/}).click();
  invoiceDialog = page.getByRole('dialog', {name: 'Payment invoice'});
  await expect(invoiceDialog.getByText('Example Yoga LLP').first()).toBeVisible();
  await expect(invoiceDialog.getByText(/CGST \(9%\)/)).toBeVisible();
  await expect(invoiceDialog.getByText(/SGST \(9%\)/)).toBeVisible();
  await expect(invoiceDialog.getByText('₹1,271.19').first()).toBeVisible();
  await expect(invoiceDialog.getByText(/Account no\.: 123456789012/)).toBeVisible();
  await expect(invoiceDialog.getByRole('img', {name: /UPI QR code/})).toBeVisible();
  expectAlignedPair(await fieldBoxes(page, '.erp-dialog .erp-form > .erp-field'));
  await expectPrintableInvoice(page, {paid: false});
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
  await expectPrintableInvoice(page, {paid: true});
  await invoiceDialog.getByRole('button', {name: 'Close', exact: true}).click();

  // Device-only mode uses the same lifecycle rules: pause/resume the paid
  // period, then create a linked renewal from the current Plan.
  await page.getByRole('button', {name: 'Subscriptions', exact: true}).click();
  await page.getByRole('tab', {name: 'Subscriptions & dues'}).click();
  let localSubscriptionRow = page.getByRole('row', {name: /Asha Patil/});
  await localSubscriptionRow.getByRole('button', {name: 'Pause'}).click();
  let localDialog = page.getByRole('dialog', {name: 'Pause subscription'});
  await localDialog.getByLabel('Pause reason').fill('Device-only pause');
  await localDialog.getByRole('button', {name: 'Pause subscription', exact: true}).click();
  await expect(localSubscriptionRow.getByText('paused', {exact: true})).toBeVisible();
  await localSubscriptionRow.getByRole('button', {name: 'Resume'}).click();
  localDialog = page.getByRole('dialog', {name: 'Resume subscription'});
  await localDialog.getByRole('button', {name: 'Resume subscription', exact: true}).click();
  await expect(localSubscriptionRow.getByText('active', {exact: true})).toBeVisible();
  await localSubscriptionRow.getByRole('button', {name: 'Renew'}).click();
  localDialog = page.getByRole('dialog', {name: 'Renew subscription'});
  await expect(localDialog.getByLabel('Renewal amount (₹)')).toHaveValue('1500');
  await localDialog.getByRole('button', {name: 'Create renewal'}).click();
  await expect(page.getByRole('row', {name: /Renewal #1/})).toBeVisible();
  const localMemberships = await page.evaluate(() => JSON.parse(localStorage.getItem('yoga-studio-erp-v1')).memberships);
  expect(localMemberships).toHaveLength(2);
  expect(localMemberships.find(item => item.renewalNumber === 1)?.previousMembershipId)
    .toBe(localMemberships.find(item => item.renewalNumber === 0)?.id);
  expect(localMemberships.find(item => item.renewalNumber === 1)?.autoRenew).toBeTruthy();

  // A one-month pass is separate from subscriptions and has no pause, renew,
  // or history actions.
  await page.getByRole('tab', {name: 'One-month passes'}).click();
  await page.getByRole('button', {name: 'New one-month pass'}).click();
  await page.getByRole('button', {name: 'Create one-month pass'}).click();
  const oneMonthRow = page.getByRole('row', {name: /Asha Patil.*One-month pass/});
  await expect(oneMonthRow).toBeVisible();
  await expect(oneMonthRow.getByRole('button', {name: 'Pause'})).toHaveCount(0);
  await expect(oneMonthRow.getByRole('button', {name: 'Renew'})).toHaveCount(0);
  await expect(oneMonthRow.getByRole('button', {name: 'History'})).toHaveCount(0);
  const passMembership = await page.evaluate(() => JSON.parse(localStorage.getItem('yoga-studio-erp-v1'))
    .memberships.find(item => item.offeringType === 'one_month'));
  expect(passMembership?.durationMonths).toBe(1);
  expect(passMembership?.autoRenew).toBeFalsy();
  expect(passMembership?.previousMembershipId || '').toBe('');

  // Data survives a reload (offline persistence) and fits a phone screen.
  await page.reload();
  await expect(page.getByRole('navigation')).toBeVisible();
  await page.setViewportSize({width: 390, height: 844});
  await page.getByRole('button', {name: 'Open menu'}).click();
  await page.getByRole('button', {name: 'Subscriptions', exact: true}).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.context().setOffline(true);
  await expect(page.locator('.connection-badge')).toContainText('Offline · this device');
  await page.context().setOffline(false);
  await expect(page.locator('.connection-badge')).toContainText('Online · this device');
});
