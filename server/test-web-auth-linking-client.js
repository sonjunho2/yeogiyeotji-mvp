'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const appSource = fs.readFileSync('apps/web-prototype/app.js', 'utf8');
const dataStoreSource = fs.readFileSync('apps/web-prototype/data-store.js', 'utf8');

function createDomHarness() {
  function makeElement(id) { return { id, tagName: '', type: '', disabled: false, required: false, minlength: '', maxlength: '', autocomplete: '', textContent: '', value: '', onclick: null, onsubmit: null, classList: { add() {}, remove() {}, contains() { return false; } }, after() {}, addEventListener() {}, click() { this.onclick?.(); }, showModal() {}, close() {}, querySelector() { return null; } }; }
  const dynamicElements = new Map();
  const staticElements = new Map(['headerTitle', 'headerEyebrow', 'detailDialog', 'cancelCollectionButton', 'collectionDialog', 'collectionForm', 'profileButton', 'settingsDialog'].map(id => [id, makeElement(id)]));
  const view = makeElement('view');
  Object.defineProperty(view, 'innerHTML', { get: () => view._html || '', set(html) {
    view._html = String(html); dynamicElements.clear();
    for (const match of view._html.matchAll(/<(form|input|button)\b([^>]*)>/g)) {
      const attrs = match[2]; const id = attrs.match(/id="([^"]+)"/)?.[1]; const element = makeElement(id || 'anonymous');
      element.tagName = match[1].toUpperCase(); element.type = attrs.match(/type="([^"]+)"/)?.[1] || '';
      element.disabled = /\bdisabled\b/.test(attrs); element.required = /\brequired\b/.test(attrs);
      element.minlength = attrs.match(/minlength="([^"]+)"/)?.[1] || ''; element.maxlength = attrs.match(/maxlength="([^"]+)"/)?.[1] || ''; element.autocomplete = attrs.match(/autocomplete="([^"]+)"/)?.[1] || '';
      if (id) dynamicElements.set(id, element); else if (element.type === 'submit') { element.id = 'linkFormSubmit'; dynamicElements.set(element.id, element); }
    }
    for (const match of view._html.matchAll(/<button\b([^>]*)>([^<]*)<\/button>/g)) { const id = match[1].match(/id="([^"]+)"/)?.[1]; const element = id ? dynamicElements.get(id) : dynamicElements.get('linkFormSubmit'); if (element) element.textContent = match[2]; }
    const form = dynamicElements.get('linkForm'); if (form) { const submit = dynamicElements.get('linkFormSubmit'); form.querySelector = selector => selector === '[type=submit]' ? submit : null; }
  } });
  staticElements.set('view', view);
  const getElement = id => staticElements.get(id) || dynamicElements.get(id) || null;
  const document = { body: { classList: { add() {}, remove() {}, contains() { return false; } }, appendChild() {} }, querySelector: selector => selector === '#view' ? view : selector.startsWith('#') ? getElement(selector.slice(1)) : selector === '.toast' ? null : null, querySelectorAll: () => [], createElement: () => makeElement('created') };
  return { document, view, staticElements, dynamicElements, getElement };
}

function createUiContext() {
  const harness = createDomHarness(); const uiCalls = [];
  const uiController = { getState: () => ({ mode: 'otp-unlinked', pending: false, error: '' }), linkExistingAccount: (...args) => uiCalls.push(['linkExistingAccount', ...args]), cancelOtp: () => uiCalls.push(['cancelOtp']) };
  const testSource = appSource.replace(/\ninitializeApp\(\);\s*$/, '\nglobalThis.__setAuthViewState = value => { authViewState = { ...value }; };\nglobalThis.__renderOtpIssue = renderOtpIssue;\n');
  assert.notEqual(testSource, appSource);
  const appContext = { window: { YYJSupabaseAuth: { isEmailOtpEnabled: () => false }, YYJAuthController: { create: () => uiController } }, YYJSupabaseAuth: { isEmailOtpEnabled: () => false }, YYJDataStore: {}, document: harness.document, navigator: {}, console, setTimeout, clearTimeout }; appContext.globalThis = appContext;
  vm.runInNewContext(testSource, appContext, { filename: 'app.js' });
  return { harness, appContext, uiCalls, renderState: state => { appContext.__setAuthViewState(state); appContext.__renderOtpIssue(); return harness; } };
}

async function assertUnlinkedUi(ui) {
  ui.renderState({ mode: 'otp-unlinked', pending: false, error: '' }); const { view, getElement } = ui.harness;
  assert.match(view.innerHTML, /기존 계정 연결/); assert.match(view.innerHTML, /기존 여기였지 계정의 이메일과 비밀번호를 입력하면 저장한 장소와 컬렉션을 그대로 연결합니다\./);
  const form = getElement('linkForm'); const email = getElement('linkEmail'); const password = getElement('linkPassword'); const submit = getElement('linkFormSubmit'); const cancel = getElement('otpIssueCancel');
  assert.ok(form && email && password && submit && cancel); assert.equal(email.type, 'email'); assert.equal(email.maxlength, '254'); assert.equal(email.autocomplete, 'email'); assert.equal(email.required, true); assert.equal(email.disabled, false);
  assert.equal(password.type, 'password'); assert.equal(password.minlength, '8'); assert.equal(password.maxlength, '128'); assert.equal(password.autocomplete, 'current-password'); assert.equal(password.required, true); assert.equal(password.disabled, false);
  assert.equal(submit.textContent, '기존 계정 연결하기'); assert.equal(submit.disabled, false); assert.equal(cancel.textContent, '인증 종료'); assert.equal(cancel.disabled, false);
  email.value = 'existing@example.com'; password.value = 'PASSWORD_SECRET_SENTINEL_5_3'; form.onsubmit({ preventDefault() {} }); assert.deepEqual(ui.uiCalls, [['linkExistingAccount', 'existing@example.com', 'PASSWORD_SECRET_SENTINEL_5_3']]); cancel.click(); assert.equal(ui.uiCalls.filter(call => call[0] === 'cancelOtp').length, 1);
}

function assertPendingUi(ui) { ui.renderState({ mode: 'otp-unlinked', pending: true, error: '' }); const { getElement } = ui.harness; assert.equal(getElement('linkEmail').disabled, true); assert.equal(getElement('linkPassword').disabled, true); assert.equal(getElement('linkFormSubmit').disabled, true); assert.equal(getElement('otpIssueCancel').disabled, true); assert.equal(getElement('linkFormSubmit').textContent, '연결 중…'); }
function assertConflictUi(ui) { ui.renderState({ mode: 'otp-conflict', pending: false, error: '계정을 연결할 수 없습니다. 인증을 종료한 뒤 다시 시도해 주세요.' }); const { view, getElement } = ui.harness; assert.match(view.innerHTML, /인증 계정 충돌/); assert.equal(getElement('linkForm'), null); assert.equal(getElement('linkEmail'), null); assert.equal(getElement('linkPassword'), null); assert.equal(getElement('linkFormSubmit'), null); assert.equal(getElement('otpIssueCancel').textContent, '인증 종료 후 다시 시도'); assert.equal(getElement('otpIssueCancel').disabled, false); const beforeCancel = ui.uiCalls.filter(call => call[0] === 'cancelOtp').length; getElement('otpIssueCancel').click(); assert.equal(ui.uiCalls.filter(call => call[0] === 'cancelOtp').length, beforeCancel + 1); }
function assertUiEscapingAndSensitiveData(ui) { ui.renderState({ mode: 'otp-conflict', pending: false, error: '<script>UI_ESCAPE_SENTINEL</script>' }); assert.doesNotMatch(ui.harness.view.innerHTML, /<script>UI_ESCAPE_SENTINEL<\/script>/); assert.match(ui.harness.view.innerHTML, /&lt;script&gt;UI_ESCAPE_SENTINEL&lt;\/script&gt;/); ui.renderState({ mode: 'otp-unlinked', pending: false, error: '' }); ui.harness.getElement('linkPassword').value = 'PASSWORD_SECRET_SENTINEL_5_3'; ui.renderState({ mode: 'otp-conflict', pending: false, error: '' }); assert.doesNotMatch(ui.harness.view.innerHTML, /PASSWORD_SECRET_SENTINEL_5_3/); }
function assertUiStaticSecurity() { assert.equal((appSource.match(/\/api\/auth\/link-supabase/g) || []).length, 0); assert.equal((appSource.match(/__YYJ_SKIP_INIT|__setAuthViewState|__renderOtpIssue/g) || []).length, 0); assert.equal((appSource.match(/function\s+renderOtpIssue\s*\(/g) || []).length, 1); assert.equal((appSource.match(/계정 연결 필요/g) || []).length, 0); assert.equal((appSource.match(/conflict\s*\?\s*'인증 종료 후 다시 시도'\s*:\s*'인증 종료'/g) || []).length, 1); assert.equal((dataStoreSource.match(/\/api\/auth\/link-supabase/g) || []).length, 1); const linkStart = dataStoreSource.indexOf('async function linkSupabaseAccount'); assert.notEqual(linkStart, -1); const nextFunction = dataStoreSource.indexOf('\n  async function ', linkStart + 1); const linkFunctionSource = dataStoreSource.slice(linkStart, nextFunction === -1 ? dataStoreSource.length : nextFunction); assert.match(linkFunctionSource, /\/api\/auth\/link-supabase/); assert.match(linkFunctionSource, /JSON\.stringify\(\{\s*password\s*\}\)/); for (const forbidden of ['email', 'authUserId', 'userId', 'accessToken', 'refreshToken', 'providerToken', 'claims']) assert.equal((linkFunctionSource.match(new RegExp(forbidden)) || []).length, 0); }

async function run() { const ui = createUiContext(); await assertUnlinkedUi(ui); assertPendingUi(ui); assertConflictUi(ui); assertUiEscapingAndSensitiveData(ui); assertUiStaticSecurity(); console.log('Web auth linking client tests passed'); }
run().catch(error => { console.error(error); process.exitCode = 1; });
