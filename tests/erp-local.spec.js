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
  // 703 x 1032 CSS px is the printable area of A4 with the invoice's
  // 12 mm page margins. This catches the old failure where the invoice was
  // positioned inside the scrolling dialog and only a central strip printed.
  await page.setViewportSize({width: 703, height: 1032});
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
  expect(layout.invoice.right).toBeLessThanOrEqual(704);
  expect(layout.invoice.height).toBeLessThanOrEqual(1032);
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
  expect((pdf.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length).toBe(1);
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
  await page.getByRole('button', {name: 'Branches', exact: true}).click();
  await page.getByRole('button', {name: 'Add branch'}).click();
  expectAlignedPair(await fieldBoxes(page, '.erp-dialog .erp-form > .erp-field'));
  await page.getByLabel('Branch name').fill('Panvel');
  await page.getByLabel('City').fill('Panvel');
  await page.getByRole('button', {name: 'Save branch'}).click();
  await expect(page.getByRole('cell', {name: /Panvel/})).toBeVisible();

  // Student
  await page.getByRole('button', {name: 'Students', exact: true}).click();
  await page.getByRole('button', {name: 'Add student'}).click();
  expectAlignedPair(await fieldBoxes(page, '.erp-dialog .erp-form > .erp-field'));
  await page.getByLabel('Full name').fill('Asha Patil');
  await page.getByRole('dialog').getByLabel('Student branch').selectOption({label: 'Panvel'});
  await page.getByRole('button', {name: 'Save student'}).click();
  await expect(page.getByRole('cell', {name: /Asha Patil/})).toBeVisible();

  // Instructor + batch + enrollment
  await page.getByRole('button', {name: 'Batches', exact: true}).click();
  await page.getByRole('button', {name: 'Add instructor'}).click();
  expectAlignedPair(await fieldBoxes(page, '.erp-dialog .erp-form > .erp-field'));
  await page.getByLabel('Instructor name').fill('Meera Joshi');
  await page.getByRole('button', {name: 'Save instructor'}).click();
  await page.getByRole('button', {name: 'Add batch'}).click();
  // Regression: Branch used to sit 21px below Batch name because an
  // auth-only stacked-label margin leaked into ERP's two-column grids.
  expectAlignedPair(await fieldBoxes(page, '.erp-dialog .erp-form > .erp-field'));
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
  await page.getByRole('tab', {name: 'Memberships & dues'}).click();
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
