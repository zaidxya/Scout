// Shared by the two leader pages: the leader area / settings (leader.html) and scout management (scouts.html).
// Handles the session, login, logout and the little message line; each page supplies what happens after login.
const $ = (id) => document.getElementById(id);
const session = { me: '', role: 'leader', troop: null };
const isAdmin = () => session.role === 'admin' || session.role === 'super_admin';
const isSuper = () => session.role === 'super_admin';

const msg = (text, ok) => { $('toast').textContent = text || ''; $('toast').className = 'error' + (ok ? ' ok' : ''); };
function show(authed) {
  $('loginForm').classList.toggle('hidden', authed);
  $('app').classList.toggle('hidden', !authed);
  $('logoutBtn').classList.toggle('hidden', !authed);
  $('meName').textContent = authed && session.me ? session.me : '';
  $('meName').style.display = authed && session.me ? '' : 'none';
}
const fail = (e) => { if (e.status === 401 && e.code === 'unauthorized') show(false); msg(errText(e)); };

// enter(): load and draw the page once logged in; leave(): clear page data after logout; redraw(): language changed
function startAuth({ enter, leave, redraw }) {
  const begin = async (r) => {
    session.me = r.username; session.role = r.role || 'leader'; session.troop = r.troop_id ?? null;
    show(true);
    await enter();
  };
  $('loginForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = new FormData(ev.target);
    try {
      const r = await api('/api/login', 'POST', { username: f.get('username'), password: f.get('password') });
      $('loginErr').textContent = ''; ev.target.reset(); await begin(r);
    } catch (e) { $('loginErr').textContent = errText(e); }
  });
  $('logoutBtn').addEventListener('click', async () => {
    await api('/api/logout', 'POST');
    if (leave) leave();
    show(false);
  });
  document.addEventListener('langchange', () => { if (!$('app').classList.contains('hidden')) redraw(); });
  (async () => {
    const [, r] = await Promise.all([initLang(), api('/api/me').catch(() => null)]); // language + session check at the same time
    if (r) await begin(r); else show(false);
  })();
}
