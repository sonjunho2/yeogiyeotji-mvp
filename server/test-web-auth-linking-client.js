'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const appSource = fs.readFileSync('apps/web-prototype/app.js', 'utf8');
const dataStoreSource = fs.readFileSync('apps/web-prototype/data-store.js', 'utf8');

function createDomHarness() {
  const bodyClasses = new Set();
  function makeElement(id) { const elementClasses = new Set(); return { id, tagName: '', type: '', disabled: false, required: false, minlength: '', maxlength: '', autocomplete: '', textContent: '', value: '', onclick: null, onsubmit: null, classList: { add(name) { elementClasses.add(name); }, remove(name) { elementClasses.delete(name); }, contains(name) { return elementClasses.has(name); }, toggle(name, force) { const next = force === undefined ? !elementClasses.has(name) : force; if (next) elementClasses.add(name); else elementClasses.delete(name); } }, after() {}, addEventListener() {}, click() { this.onclick?.(); }, showModal() {}, close() {}, querySelector() { return null; } }; }
  const dynamicElements = new Map();
  const staticElements = new Map(['headerTitle', 'headerEyebrow', 'detailDialog', 'cancelCollectionButton', 'collectionDialog', 'collectionForm', 'profileButton', 'settingsDialog', 'mapViewTemplate', 'mapChips', 'realMap'].map(id => [id, makeElement(id)]));
  staticElements.get('mapViewTemplate').innerHTML = '<div id="realMap"></div><div id="mapChips"></div>';
  const view = makeElement('view');
  Object.defineProperty(view, 'innerHTML', { get: () => view._html || '', set(html) {
    view._html = String(html); dynamicElements.clear();
    for (const match of view._html.matchAll(/<(form|input|button|p)\b([^>]*)>/g)) {
      const attrs = match[2]; const id = attrs.match(/id="([^"]+)"/)?.[1]; const element = makeElement(id || 'anonymous');
      element.tagName = match[1].toUpperCase(); element.type = attrs.match(/type="([^"]+)"/)?.[1] || '';
      element.disabled = /\bdisabled\b/.test(attrs); element.required = /\brequired\b/.test(attrs);
      element.minlength = attrs.match(/minlength="([^"]+)"/)?.[1] || ''; element.maxlength = attrs.match(/maxlength="([^"]+)"/)?.[1] || ''; element.autocomplete = attrs.match(/autocomplete="([^"]+)"/)?.[1] || '';
      if (id) dynamicElements.set(id, element); else if (element.type === 'submit') { element.id = 'linkFormSubmit'; dynamicElements.set(element.id, element); }
    }
    for (const match of view._html.matchAll(/<button\b([^>]*)>([^<]*)<\/button>/g)) { const id = match[1].match(/id="([^"]+)"/)?.[1]; const element = id ? dynamicElements.get(id) : dynamicElements.get('linkFormSubmit'); if (element) element.textContent = match[2]; }
    for (const match of view._html.matchAll(/<p\b([^>]*)>([^<]*)<\/p>/g)) { const id = match[1].match(/id="([^"]+)"/)?.[1]; const element = id ? dynamicElements.get(id) : null; if (element) element.textContent = match[2]; }
    const form = dynamicElements.get('linkForm'); if (form) { const submit = dynamicElements.get('linkFormSubmit'); form.querySelector = selector => selector === '[type=submit]' ? submit : null; }
  } });
  staticElements.set('view', view);
  const getElement = id => staticElements.get(id) || dynamicElements.get(id) || null;
  const document = { body: { classList: { add(name) { bodyClasses.add(name); }, remove(name) { bodyClasses.delete(name); }, contains(name) { return bodyClasses.has(name); } }, appendChild() {} }, querySelector: selector => selector === '#view' ? view : selector.startsWith('#') ? getElement(selector.slice(1)) : selector === '.toast' ? null : null, querySelectorAll: () => [], createElement: () => makeElement('created') };
  return { document, view, staticElements, dynamicElements, getElement, bodyClasses };
}

function createUiContext() {
  const harness = createDomHarness(); const uiCalls = [];
  const uiController = { getState: () => ({ mode: 'otp-unlinked', pending: false, error: '' }), linkExistingAccount: (...args) => uiCalls.push(['linkExistingAccount', ...args]), cancelOtp: () => uiCalls.push(['cancelOtp']) };
  const callbackCapture = {};
  let testSource = appSource.replace(/\ninitializeApp\(\);\s*$/, '\nglobalThis.__setAuthViewState = value => { authViewState = { ...value }; };\nglobalThis.__renderOtpIssue = renderOtpIssue;\nglobalThis.__completeAuthentication = completeAuthentication;\nglobalThis.__getAppState = () => state;\nglobalThis.__ensureAuthController = ensureAuthController;\nglobalThis.__seedPrivateState = values => Object.assign(state, values);\nglobalThis.__getClearPrivateStateCalls = () => globalThis.__clearPrivateStateCalls || 0;\n');
  testSource = testSource.replace('function clearPrivateState() {', 'function clearPrivateState() { globalThis.__clearPrivateStateCalls = (globalThis.__clearPrivateStateCalls || 0) + 1;');
  assert.notEqual(testSource, appSource);
  const appContext = { window: { YYJSupabaseAuth: { isEmailOtpEnabled: () => false }, YYJAuthController: { create: options => { callbackCapture.onChange = snapshot => { callbackCapture.onChangeCalls = (callbackCapture.onChangeCalls || 0) + 1; return options.onChange(snapshot); }; callbackCapture.onAuthenticated = options.onAuthenticated; return uiController; } } }, YYJSupabaseAuth: { isEmailOtpEnabled: () => false }, YYJDataStore: {}, document: harness.document, navigator: {}, console, setTimeout, clearTimeout }; appContext.globalThis = appContext;
  vm.runInNewContext(testSource, appContext, { filename: 'app.js' });
  appContext.__ensureAuthController();
  return { harness, appContext, uiCalls, callbackCapture, renderState: state => { appContext.__setAuthViewState(state); appContext.__renderOtpIssue(); return harness; } };
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
function assertUiStaticSecurity() { assert.equal((appSource.match(/\/api\/auth\/link-supabase/g) || []).length, 0); assert.equal((appSource.match(/__YYJ_SKIP_INIT|__setAuthViewState|__renderOtpIssue|__completeAuthentication|__getAppState|__ensureAuthController|__seedPrivateState/g) || []).length, 0); assert.equal((appSource.match(/function\s+renderOtpIssue\s*\(/g) || []).length, 1); assert.equal((appSource.match(/계정 연결 필요/g) || []).length, 0); assert.equal((appSource.match(/conflict\s*\?\s*'인증 종료 후 다시 시도'\s*:\s*'인증 종료'/g) || []).length, 1); assert.equal((dataStoreSource.match(/\/api\/auth\/link-supabase/g) || []).length, 1); const linkStart = dataStoreSource.indexOf('async function linkSupabaseAccount'); assert.notEqual(linkStart, -1); const nextFunction = dataStoreSource.indexOf('\n  async function ', linkStart + 1); const linkFunctionSource = dataStoreSource.slice(linkStart, nextFunction === -1 ? dataStoreSource.length : nextFunction); assert.match(linkFunctionSource, /\/api\/auth\/link-supabase/); assert.match(linkFunctionSource, /JSON\.stringify\(\{\s*password\s*\}\)/); for (const forbidden of ['email', 'authUserId', 'userId', 'accessToken', 'refreshToken', 'providerToken', 'claims']) assert.equal((linkFunctionSource.match(new RegExp(forbidden)) || []).length, 0); }

function assertClearPrivateStateHookSecurity() { for (const hook of ['__clearPrivateStateCalls', '__getClearPrivateStateCalls']) assert.equal(appSource.includes(hook), false); }

function assertAuthenticationRecovery() {
  for (const rawError of ['SYNC_NAV_RAW_SENTINEL', 'RENDER_RAW_SENTINEL']) {
    const ui = createUiContext(); let calls = 0;
    let mapRemoves = 0; let pickerMapRemoves = 0;
    ui.appContext.__seedPrivateState({ user: { id: 'private-user' }, places: [{ id: 'private-place' }], collections: [{ id: 'private-collection' }], selectedId: 'private-selected', pendingImage: 'PRIVATE_IMAGE_SENTINEL', pendingLat: 37.123, pendingLng: 127.456, map: { remove() { mapRemoves += 1; } }, pickerMap: { remove() { pickerMapRemoves += 1; } } });
    ui.renderState({ mode: 'otp-unlinked', otpEmail: '', notice: '', error: '', pending: false, issue: '' });
    const previousEmailInput = ui.harness.getElement('linkEmail'); const previousPasswordInput = ui.harness.getElement('linkPassword');
    previousEmailInput.value = 'existing@example.com'; previousPasswordInput.value = 'PASSWORD_SECRET_SENTINEL_5_3';
    ui.harness.document.querySelectorAll = () => { calls += 1; if (rawError === 'SYNC_NAV_RAW_SENTINEL' && calls === 1) throw new Error(rawError); return []; };
    if (rawError === 'RENDER_RAW_SENTINEL') { const originalQuery = ui.harness.document.querySelector; ui.harness.document.querySelector = selector => { if (selector === '#mapViewTemplate') throw new Error(rawError); return originalQuery(selector); }; }
    assert.throws(() => ui.callbackCapture.onAuthenticated({ id: 'private-user' }, [{ id: 'private-place' }], [{ id: 'private-collection' }]), error => error.message === rawError);
    assert.equal(ui.harness.bodyClasses.has('auth-visible'), true); assert.equal(ui.appContext.__getClearPrivateStateCalls(), 1);
    const state = ui.appContext.__getAppState(); assert.equal(state.user, null); assert.equal(state.places.length, 0); assert.equal(state.collections.length, 0); assert.equal(state.selectedId, '');
    assert.equal(state.pendingImage, ''); assert.equal(state.pendingLat, null); assert.equal(state.pendingLng, null); assert.equal(state.map, null); assert.equal(state.pickerMap, null); assert.equal(mapRemoves, 1); assert.equal(pickerMapRemoves, 1);
    const publicError = '\uacc4\uc815\uc744 \uc5f0\uacb0\ud558\uc9c0 \ubabb\ud588\uc2b5\ub2c8\ub2e4. \uc7a0\uc2dc \ud6c4 \ub2e4\uc2dc \uc2dc\ub3c4\ud574 \uc8fc\uc138\uc694.';
    const publicSnapshot = { mode: 'otp-unlinked', otpEmail: '', notice: '', error: publicError, pending: false, issue: '' };
    ui.callbackCapture.onChange(publicSnapshot);
    const nextEmailInput = ui.harness.getElement('linkEmail'); const nextPasswordInput = ui.harness.getElement('linkPassword'); assert.notEqual(nextEmailInput, previousEmailInput); assert.notEqual(nextPasswordInput, previousPasswordInput); assert.equal(previousEmailInput.value, 'existing@example.com'); assert.equal(previousPasswordInput.value, 'PASSWORD_SECRET_SENTINEL_5_3');
    assert.equal(ui.harness.getElement('authError').textContent, publicError); assert.equal(ui.harness.view.innerHTML.includes(publicError), true); assert.equal(ui.callbackCapture.onChangeCalls, 1); assert.equal(JSON.stringify(publicSnapshot).match(/SYNC_NAV_RAW_SENTINEL|RENDER_RAW_SENTINEL|existing@example\.com|PASSWORD_SECRET_SENTINEL_5_3|PRIVATE_IMAGE_SENTINEL|private-user|private-place|private-collection|private-selected/g), null);
    assert.doesNotMatch(ui.harness.view.innerHTML, /existing@example\.com|PASSWORD_SECRET_SENTINEL_5_3|private-user|private-place|private-collection|private-selected|SYNC_NAV_RAW_SENTINEL|RENDER_RAW_SENTINEL|PRIVATE_IMAGE_SENTINEL/);
    assert.doesNotMatch(JSON.stringify(ui.appContext.__getAppState()), /existing@example\.com|PASSWORD_SECRET_SENTINEL_5_3|private-user|private-place|private-collection|private-selected|PRIVATE_IMAGE_SENTINEL/); assert.equal(nextEmailInput.value, ''); assert.equal(nextPasswordInput.value, '');
  }
  const ui = createUiContext();
  ui.callbackCapture.onAuthenticated({ id: 'normal-user' }, [{ id: 'place-1' }], [{ id: 'collection-1' }]); assert.equal(ui.appContext.__getClearPrivateStateCalls(), 0); const state = ui.appContext.__getAppState(); assert.equal(ui.harness.bodyClasses.has('auth-visible'), false); assert.deepEqual(state.user, { id: 'normal-user' }); assert.deepEqual(state.places, [{ id: 'place-1' }]); assert.deepEqual(state.collections, [{ id: 'collection-1' }]); assert.equal(state.selectedId, 'place-1'); assert.equal(state.tab, 'map'); assert.doesNotMatch(ui.harness.view.innerHTML, /RAW_SENTINEL/);
}

async function run() { const ui = createUiContext(); ui.harness.getElement('view').classList.add('ordinary-class'); assert.equal(ui.harness.bodyClasses.has('ordinary-class'), false); assert.equal(ui.harness.document.querySelector('#definitelyMissingElement'), null); await assertUnlinkedUi(ui); assertPendingUi(ui); assertConflictUi(ui); assertUiEscapingAndSensitiveData(ui); assertUiStaticSecurity(); assertClearPrivateStateHookSecurity(); assertAuthenticationRecovery(); console.log('Web auth linking client tests passed'); }
run().catch(error => { console.error(error); process.exitCode = 1; });
