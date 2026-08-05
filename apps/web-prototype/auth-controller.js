(function () {
  'use strict';
  const issueText = {
    auth_user_not_linked: '이 인증 계정은 아직 여기였지 계정에 연결되지 않았습니다. 기존 이메일과 비밀번호로 로그인해 주세요.',
    auth_identity_conflict: '현재 비밀번호 로그인과 다른 인증 계정입니다. 인증을 종료한 뒤 다시 시도해 주세요.'
  };
  function create({ supabaseAuth, dataStore, onChange = () => {}, onAuthenticated = () => {} }) {
    let state = { mode: 'login', otpEmail: '', notice: '', error: '', pending: false, issue: '' };
    const emit = () => onChange({ ...state });
    const setState = patch => { state = { ...state, ...patch }; emit(); };
    const serverCode = error => error && error.payload && error.payload.error || error && error.error || error && error.code;
    const run = async (operation, fallbackMessage) => {
      if (state.pending) return null;
      setState({ pending: true, error: '', notice: '' });
      try { return await operation(); } catch (error) {
        const code = serverCode(error);
        if (code === 'auth_user_not_linked' || code === 'auth_identity_conflict') setState({ mode: code === 'auth_user_not_linked' ? 'otp-unlinked' : 'otp-conflict', issue: code, error: issueText[code], pending: false });
        else setState({ mode: state.mode === 'otp-verify' ? 'otp-verify' : state.mode, error: fallbackMessage, pending: false });
        return null;
      }
    };
    async function requestOtp(email) { const result = await run(() => supabaseAuth.requestEmailOtp(email), '인증 코드를 보내지 못했습니다. 잠시 후 다시 시도해 주세요.'); if (result) setState({ pending: false, otpEmail: result.email, mode: 'otp-verify', notice: '인증 코드를 보냈습니다. 받은 편지함을 확인해 주세요.' }); }
    async function verifyOtp(token) { const result = await run(async () => { await supabaseAuth.verifyEmailOtp(state.otpEmail, token); const user = await dataStore.getCurrentUser(); const data = await dataStore.loadServerData(); return { user, data }; }, '인증 코드가 올바르지 않거나 만료되었습니다.'); if (result) { setState({ pending: false }); onAuthenticated(result.user, result.data.places, result.data.collections); } }
    async function resendOtp() { if (!state.otpEmail) { setState({ error: '이메일 주소를 입력해 주세요.' }); return; } await requestOtp(state.otpEmail); }
    async function cancelOtp() { if (state.pending) return; setState({ pending: true }); try { await supabaseAuth.signOut(); setState({ mode: 'login', otpEmail: '', notice: '', error: '', pending: false, issue: '' }); } catch { setState({ pending: false, error: '인증을 종료하지 못했습니다. 잠시 후 다시 시도해 주세요.' }); } }
    async function startGoogleOAuth() { if (state.mode !== 'login') return null; return run(async () => { const result = await supabaseAuth.signInWithGoogle(); setState({ pending: false, notice: 'Google 로그인 화면으로 이동합니다.' }); return result; }, 'Google 로그인을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.'); }
    function setMode(mode) { const allowed = ['login', 'register', 'otp-request', 'otp-verify', 'otp-unlinked', 'otp-conflict']; if (allowed.includes(mode) && !state.pending) setState({ mode, error: '', notice: '', issue: '' }); }
    function handleInitialIssue(issue) { if (issueText[issue]) setState({ mode: issue === 'auth_user_not_linked' ? 'otp-unlinked' : 'otp-conflict', issue, error: issueText[issue] }); }
    return { getState: () => ({ ...state }), setMode, requestOtp, verifyOtp, resendOtp, cancelOtp, handleInitialIssue, startGoogleOAuth };
  }
  window.YYJAuthController = { create };
})();
