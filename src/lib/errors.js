// Central, user-facing error translation.
//
// Raw Supabase/network/browser errors are converted into a small, stable
// shape that screens can render consistently:
//
//   {
//     kind, title, message, solution, code, status, technical,
//     retryable, severity, context, originalMessage
//   }
//
// The goal is that the person seeing the error understands:
//   1. what happened,
//   2. why it probably happened, and
//   3. what they can safely try next.
//
// Security-sensitive internals are not invented here. Known authorization
// failures stay explicit that access was denied; setup failures tell the
// studio owner exactly which owner-run SQL file must be applied.

const MAX_TECHNICAL_LENGTH = 1200;

function cleanText(value, fallback = '') {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text || fallback;
}

function truncate(text) {
  const value = cleanText(text);
  return value.length > MAX_TECHNICAL_LENGTH
    ? `${value.slice(0, MAX_TECHNICAL_LENGTH)}…`
    : value;
}

function stripCodePrefix(message) {
  return cleanText(message)
    .replace(/^[A-Z][A-Z0-9_]{2,}(?::|-)\s*/i, '')
    .replace(/^error\s*:\s*/i, '');
}

function collectErrorText(error) {
  if (!error) return '';
  if (typeof error === 'string') return error;
  return [
    error.code,
    error.name,
    error.message,
    error.details,
    error.hint,
    error.status,
    error.statusText,
  ].filter(Boolean).join(' ');
}

function technicalDetails(error, originalMessage) {
  if (!error) return originalMessage;
  if (typeof error === 'string') return truncate(error);
  const parts = [];
  if (error.name && error.name !== 'Error') parts.push(`Name: ${error.name}`);
  if (error.code) parts.push(`Code: ${error.code}`);
  if (error.status) parts.push(`Status: ${error.status}`);
  if (originalMessage) parts.push(`Message: ${originalMessage}`);
  if (error.details) parts.push(`Details: ${error.details}`);
  if (error.hint) parts.push(`Hint: ${error.hint}`);
  return truncate(parts.join('\n') || originalMessage);
}

function baseInfo(error, options, patch) {
  const context = cleanText(options.context || options.action || error?.context || '');
  const originalMessage = truncate(
    typeof error === 'string' ? error : (error?.originalMessage || error?.message || ''),
  );
  const message = stripCodePrefix(
    patch.message || originalMessage || options.fallbackMessage || 'Something went wrong while completing this action.',
  );
  return {
    kind: patch.kind || 'unknown',
    title: patch.title || 'Something went wrong',
    message,
    solution: patch.solution || 'Try again. If the same error repeats, copy the technical details and share them with the studio owner/support.',
    code: cleanText(patch.code || error?.code || ''),
    status: patch.status || error?.status || '',
    technical: patch.technical || technicalDetails(error, originalMessage || message),
    retryable: patch.retryable !== false,
    severity: patch.severity || 'error',
    context,
    originalMessage: originalMessage || message,
  };
}

export function describeError(error, options = {}) {
  if (error && typeof error === 'object' && error.title && error.message && error.solution) {
    return baseInfo(error, options, {
      kind: error.kind,
      title: error.title,
      message: error.message,
      solution: error.solution,
      code: error.code,
      status: error.status,
      technical: error.technical,
      retryable: error.retryable,
      severity: error.severity,
    });
  }

  const rawText = collectErrorText(error);
  const text = rawText.toLocaleLowerCase('en-IN');
  const originalMessage = typeof error === 'string' ? error : (error?.message || '');
  const code = cleanText(error?.code || '');
  const status = Number(error?.status || 0) || '';
  const context = cleanText(options.context || options.action || '');
  const browserOffline = options.online === false
    || (typeof navigator !== 'undefined' && navigator.onLine === false);

  const make = patch => baseInfo(error, options, patch);

  if (!error) {
    return make({
      kind: 'unknown',
      title: options.title || 'Something went wrong',
      message: options.fallbackMessage || 'The action could not be completed.',
      solution: 'Try again. If it repeats, refresh the page after checking that any offline changes are synced.',
    });
  }

  if (/pgrst202|40407|could not find the function|function .* does not exist|setup is not installed|needs the latest database setup|sql v11|erp_setup\.sql/.test(text)) {
    return make({
      kind: 'setup',
      title: 'Database setup needs updating',
      message: 'Yoga Studio could not find one or more database functions required by this screen. The app and the Supabase setup are probably on different versions.',
      solution: 'Ask the studio Owner to open Supabase → SQL Editor, run the full current supabase/erp_setup.sql file (SQL v11), wait for it to finish, then retry. Do not create tables/functions manually one by one.',
      retryable: true,
    });
  }

  if (/supabase is not configured|account access is currently unavailable|missing.*supabase|invalid project url|invalid api key/.test(text)) {
    return make({
      kind: 'configuration',
      title: 'Studio connection is not configured',
      message: 'This copy of Yoga Studio cannot connect to the configured studio database.',
      solution: 'Please contact the studio owner so they can check the public Supabase URL/publishable key configuration and the deployed app version. No password or record was saved by this failed attempt.',
      retryable: false,
    });
  }

  if (browserOffline || code === 'OFFLINE' || /failed to fetch|networkerror|network request failed|load failed|internet.*offline|you are offline|you appear to be offline/.test(text) || error instanceof TypeError && /fetch/.test(text)) {
    return make({
      kind: 'offline',
      title: 'Connection problem',
      message: 'Yoga Studio could not reach the internet or Supabase service.',
      solution: 'Check Wi-Fi/mobile data and try again. If you were saving ERP work, look for the offline/sync status before closing the app; supported changes remain queued on this device and sync when the connection returns. Sign-in, account access and admission actions still need an internet connection.',
      severity: 'warning',
      retryable: true,
    });
  }

  if (code === 'invalid_credentials' || /invalid login credentials|email or password is incorrect/.test(text)) {
    return make({
      kind: 'auth',
      title: 'Sign-in details did not match',
      message: 'Email or password is incorrect. Please try again.',
      solution: 'Check the email spelling and password, including Caps Lock. If you joined through a studio, use the exact email the studio linked to your role. Use “Forgot password?” if you cannot remember it.',
      retryable: true,
    });
  }

  if (code === 'email_not_confirmed' || /confirm your email|email.*not.*confirmed|account.*unconfirmed/.test(text)) {
    return make({
      kind: 'auth',
      title: 'Email confirmation is pending',
      message: 'This account exists, but its email address has not been confirmed yet.',
      solution: 'Open the confirmation email for this exact address (check spam/junk too), tap the confirmation link, then sign in or ask the studio to grant access again.',
      retryable: true,
    });
  }

  if (code === 'weak_password' || /password.*weak|password.*at least|stronger password/.test(text)) {
    return make({
      kind: 'validation',
      title: 'Password needs to be stronger',
      message: 'The password does not meet the account safety rules.',
      solution: 'Choose a longer, unique password that you do not use on other websites, then try again.',
      severity: 'warning',
    });
  }

  if (code === 'same_password' || /different from your current password|same.*password/.test(text)) {
    return make({
      kind: 'validation',
      title: 'Choose a different password',
      message: 'The new password is the same as the current password.',
      solution: 'Enter a new password that is different from the old one.',
      severity: 'warning',
    });
  }

  if (code === 'otp_expired' || code === 'bad_code_verifier' || code === 'flow_state_expired' || /link has expired|link is invalid|otp.*expired/.test(text)) {
    return make({
      kind: 'auth',
      title: 'This account link cannot be used',
      message: 'The confirmation or password-reset link has expired, was already used, or is incomplete.',
      solution: 'Request a fresh link and open the newest email on the same device/browser. Do not reuse an older reset or confirmation email.',
    });
  }

  if (status === 429 || /rate limit|too many attempts|over_.*limit/.test(text)) {
    return make({
      kind: 'rate_limit',
      title: 'Too many attempts for now',
      message: 'The service temporarily limited repeated requests to protect accounts.',
      solution: 'Wait a little while before trying again. Avoid repeatedly requesting emails or sign-ins during the wait.',
      severity: 'warning',
    });
  }

  if (/user already registered|user_already_exists|email_exists|already been registered|already exists.*email|email.*already/.test(text) && /auth|account|user|sign/.test(`${text} ${context.toLocaleLowerCase('en-IN')}`)) {
    return make({
      kind: 'auth',
      title: 'An account already uses this email',
      message: 'A Yoga Studio account already exists for this email address.',
      solution: 'Sign in with that account instead of creating another one. If the studio still needs to grant your role, ask them to link this exact confirmed email.',
    });
  }

  if (/unauthenticated|jwt.*expired|session.*expired|invalid.*jwt|sign in once while online|not authenticated/.test(text) || status === 401) {
    return make({
      kind: 'session',
      title: 'Your sign-in session needs attention',
      message: 'Yoga Studio could not confirm a current signed-in session for this online action.',
      solution: 'Reconnect to the internet and sign in again with the same account. Do not clear the device offline copy before checking whether changes are still waiting to sync.',
    });
  }

  if (/no_organization|not connected to a studio|no organization|create or join an organization/.test(text)) {
    return make({
      kind: 'access',
      title: 'No studio access is linked yet',
      message: 'This signed-in account does not yet have an ERP role in a studio organization, so studio records are hidden.',
      solution: 'If you are joining an existing studio, ask an Owner/Co-owner (or branch Admin for Instructor/Student access) to grant this exact confirmed email the correct role, then retry. Only the primary studio Owner should choose “Create organization”.',
      retryable: true,
    });
  }

  if (/admission_branch_invalid|branch admission link is not valid|branch is no longer active/.test(text)) {
    return make({
      kind: 'admission',
      title: 'Branch admission link is not valid',
      message: 'The branch in this admission link is missing, belongs to another studio, or is no longer active.',
      solution: 'Ask the studio to send the current studio or branch admission link from Students → Admission requests, then open the new link. Do not edit the branch value in the URL manually.',
    });
  }

  if (/admission_link_invalid|admission link is not valid/.test(text)) {
    return make({
      kind: 'admission',
      title: 'Admission link is not valid',
      message: 'Yoga Studio could not match this public admission link to an active studio admission code.',
      solution: 'Ask the studio for its current public admission link and open that exact link. If you are testing as an applicant, use a private/incognito window so a manager session does not hide the form.',
    });
  }

  if (/admission_email_mismatch|admission email must match/.test(text)) {
    return make({
      kind: 'admission',
      title: 'Admission account email does not match',
      message: 'The signed-in account email is different from the email on the admission request.',
      solution: 'Sign out and sign in with the same account that submitted the admission, or ask the studio to correct/review the existing request. The confirmed account is the one that receives Student portal access.',
    });
  }

  if (/admission_duplicate_pending|pending admission already exists/.test(text)) {
    return make({
      kind: 'duplicate',
      title: 'An admission is already waiting',
      message: 'A pending admission already exists for this email, so another pending request was not created.',
      solution: 'Ask the studio to review the existing request in Students → Admission requests. Do not create a second account just to submit again.',
      severity: 'warning',
    });
  }

  if (/admission_possible_duplicate|student record already uses this email|possible existing student|possible duplicate/.test(text)) {
    return make({
      kind: 'duplicate',
      title: 'Possible duplicate student',
      message: 'An existing student record appears to use the same contact details.',
      solution: 'Open and verify the existing student first. Use/link that record if it is the same person; create a new record only when you are sure it is a different person.',
      severity: 'warning',
    });
  }

  if (/admission_not_pending|already been reviewed|already.*confirmed.*admission|admission_already_confirmed/.test(text)) {
    return make({
      kind: 'admission',
      title: 'Admission status has already changed',
      message: 'This admission is no longer waiting in the same pending state shown on screen.',
      solution: 'Refresh/retry to load the latest status. If it was confirmed, open the Student portal or continue enrolment from Students; do not confirm the same request again.',
    });
  }

  if (/account.*not found|no usable .* account uses that email|access_account_not_found|student_account_not_found/.test(text)) {
    return make({
      kind: 'access',
      title: 'No confirmed account was found for that email',
      message: 'Yoga Studio could not find a usable account with the exact email entered.',
      solution: 'Ask the person to create an account with that exact email, confirm the email, and choose “Join an existing studio” (not “Create organization”). Then grant access again.',
    });
  }

  if (/already linked|already.*different student|already.*different sign-in|account.*role conflict|already has another active erp role|already has access to a different/.test(text)) {
    return make({
      kind: 'access',
      title: 'This account is already linked elsewhere',
      message: 'The sign-in account or record is already connected to another role, student, instructor, or studio organization.',
      solution: 'Verify the person and existing link in Access/Portal access. Remove or replace the old link only if an authorized manager confirms it is wrong; otherwise use a separate account for the new role.',
    });
  }

  if (code === '23505' || /duplicate key|unique constraint|duplicate.*record|record.*already exists/.test(text)) {
    return make({
      kind: 'duplicate',
      title: 'This record may already exist',
      message: 'Yoga Studio stopped because saving this information would create a duplicate or repeat an action that may already have saved.',
      solution: 'Refresh and search for the student, batch, plan, payment or access link before trying again. Open the existing record if it is the same item; do not repeat a payment until you confirm it is not already in Payments.',
      severity: 'warning',
    });
  }

  if (code === '23503' || /foreign key constraint|referenced.*record|linked record.*missing/.test(text)) {
    return make({
      kind: 'record_state',
      title: 'A linked record is missing or changed',
      message: 'One record connected to this action could not be found in the current studio data.',
      solution: 'Refresh the screen and reselect the branch, student, instructor, batch and plan. If the linked record was archived or moved, ask an authorized manager to correct it first.',
    });
  }

  if (['22P02', '22007', '22008', '23514'].includes(code)) {
    return make({
      kind: 'validation',
      title: 'One value is not in the expected format',
      message: 'Yoga Studio received a date, number, choice or other value that the database cannot accept in its current form.',
      solution: 'Check dates, amounts, phone/email fields and dropdown selections on this screen, then try again. If every field looks correct, copy the technical details for support.',
      severity: 'warning',
    });
  }

  if (/primary owner.*protected|cannot be removed/.test(text)) {
    return make({
      kind: 'permission',
      title: 'Primary Owner is protected',
      message: 'The primary Owner account cannot be removed or replaced through Role Access.',
      solution: 'Keep the primary Owner unchanged. Add a Co-owner for day-to-day help if needed; Co-owners cannot remove or transfer the primary Owner.',
      retryable: false,
    });
  }

  if (/inactive|archived/.test(text) && /(student|instructor|branch|batch|plan)/.test(text)) {
    return make({
      kind: 'record_state',
      title: 'The selected record is not active',
      message: stripCodePrefix(originalMessage) || 'One of the selected records is inactive or archived, so this action was stopped safely.',
      solution: 'Choose an active record, or ask an authorized manager to reactivate/restore the correct student, instructor, branch, batch or plan first. Refresh the screen after the status is corrected.',
    });
  }

  if (/forbidden|permission denied|not allowed|does not allow|only the owner|only.*can|row-level security|42501/.test(text) || status === 403) {
    return make({
      kind: 'permission',
      title: 'Access denied for this action',
      message: 'Your current Yoga Studio role, branch assignment, batch assignment, or own-record scope does not allow this action. Nothing was changed.',
      solution: 'Check that you are signed in with the correct account and working in the correct branch/batch. Ask an Owner/Co-owner or authorized branch Admin to review your role in Access if you believe this action should be allowed. Do not use another person’s login.',
      retryable: false,
    });
  }

  if (/sync_conflict|version conflict|sync conflict|expected version|was changed.*another|conflict.*review/.test(text) || status === 409) {
    return make({
      kind: 'sync_conflict',
      title: 'Sync conflict needs review',
      message: 'The same record was changed in Supabase after this device downloaded it. Yoga Studio stopped instead of overwriting either version.',
      solution: 'Open the sync/conflict review, compare “mine” and “server” carefully, then keep the correct version. Do not clear the offline copy until the conflict is resolved.',
      severity: 'warning',
    });
  }

  if (/batch.*full|no seats|capacity/.test(text)) {
    return make({
      kind: 'capacity',
      title: 'This batch has no available seat',
      message: stripCodePrefix(originalMessage) || 'The selected batch has reached its student capacity.',
      solution: 'Choose another suitable batch, or ask an authorized manager to review the roster/capacity. Do not remove a student just to force enrolment without manager approval.',
      severity: 'warning',
    });
  }

  if (/same branch|branch.*must|belongs to.*branch|different branch/.test(text)) {
    return make({
      kind: 'validation',
      title: 'Student and batch branches do not match',
      message: 'A student can be enrolled only in a batch from the same branch as the student record.',
      solution: 'Go back and choose a batch in the student’s branch. If the student has genuinely moved, an authorized manager should first update the student branch, then enrol them.',
      severity: 'warning',
    });
  }

  if (/payment|amount received|amount.*greater|choose a subscription/.test(text) && /(amount|payment|subscription|one-month|due)/.test(text)) {
    return make({
      kind: 'payment',
      title: 'Payment could not be recorded',
      message: stripCodePrefix(originalMessage) || 'The payment details could not be accepted.',
      solution: 'Verify the student, subscription/one-month pass, actual gross amount received, payment date and method. Record money only after it is received/verified. If a payment was already saved offline, check Payments/sync status before entering it again to avoid a duplicate.',
      severity: 'warning',
    });
  }

  if (/no longer available|not found|does not exist|404/.test(text) || status === 404) {
    return make({
      kind: 'not_found',
      title: 'That record is no longer available',
      message: 'The record may have been archived, removed from your scope, or changed after this screen loaded.',
      solution: 'Refresh the screen and search again. If you still cannot see it, ask an authorized manager to check the record status and your branch/role access.',
    });
  }

  if (/storage|quota|could not save.*device|localstorage|indexeddb|device.*save/.test(text)) {
    return make({
      kind: 'storage',
      title: 'This device could not save safely',
      message: 'The browser could not write the local offline copy or queued change.',
      solution: 'Free device/browser storage, avoid private/incognito mode for offline ERP work, then retry while online. Do not clear site data until you confirm important changes are synced or exported by an authorized manager.',
    });
  }

  if (/json|import.*file|backup|parse/.test(text) && /(invalid|could not|unexpected|parse|import)/.test(text)) {
    return make({
      kind: 'file',
      title: 'That file could not be imported',
      message: 'The selected file is not a valid Yoga Studio backup or its contents are damaged.',
      solution: 'Select the original exported Yoga Studio backup file without editing it. If every copy fails, keep the file unchanged and ask the studio owner/support to inspect it before trying recovery.',
    });
  }

  if (/dynamically imported module|chunk.*failed|loading chunk|failed to load.*module/.test(text)) {
    return make({
      kind: 'app_update',
      title: 'The app update did not finish loading',
      message: 'The browser could not load part of the current Yoga Studio app, often because a new version was deployed while this tab was open.',
      solution: 'Reconnect to the internet and reload the app. If you have unsynced ERP changes, check sync status after reload; the durable device queue should still be present for the same signed-in account.',
    });
  }

  if (code === 'VALIDATION_FAILED' || /validation_failed|required|please enter|please choose|enter a valid|enter your|enter the|choose .*required|check .*fields|invalid.*email|invalid.*phone|pin code|date of birth|must be/.test(text)) {
    return make({
      kind: 'validation',
      title: 'Please check the highlighted details',
      message: stripCodePrefix(originalMessage) || 'Some required information is missing or does not look valid.',
      solution: 'Correct the fields mentioned above and try again. Required names, branch/batch selections, dates, email/phone format and amounts are the most common causes.',
      severity: 'warning',
    });
  }

  if (status >= 500 || /internal server|service unavailable|bad gateway|timeout|timed out/.test(text)) {
    return make({
      kind: 'service',
      title: 'The service could not complete this request',
      message: 'Supabase or the network service returned a temporary server-side failure.',
      solution: 'Wait a moment and retry once. If it repeats, note the time and copy the technical details for the studio owner/support. Avoid repeating a payment or enrolment until you check whether the first attempt already saved.',
    });
  }

  return make({
    kind: 'unknown',
    title: options.title || (context ? `${context} could not be completed` : 'Something went wrong'),
    message: stripCodePrefix(originalMessage) || options.fallbackMessage || 'Yoga Studio could not complete this action.',
    solution: 'Check your connection and the details on this screen, then try once more. Before repeating a payment, enrolment or access change, refresh/search to confirm the first attempt did not already save. If it still fails, copy the technical details and share them with the studio owner/support.',
  });
}

export function errorSummary(error, options = {}) {
  const info = describeError(error, options);
  return `${info.title}: ${info.message} Possible solution: ${info.solution}`;
}

export function formatErrorDetails(error, options = {}) {
  const info = describeError(error, options);
  return [
    `Error: ${info.title}`,
    info.context ? `Screen/action: ${info.context}` : '',
    `What happened: ${info.message}`,
    `Possible solution: ${info.solution}`,
    info.code ? `Code: ${info.code}` : '',
    info.status ? `Status: ${info.status}` : '',
    info.technical ? `Technical details:\n${info.technical}` : '',
  ].filter(Boolean).join('\n');
}
