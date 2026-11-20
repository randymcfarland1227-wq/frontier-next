'use client';

import { FormEvent, useEffect, useState } from 'react';
import { hasSyncKey, joinWithKey, loginErrorText, signIn, SYNC_STATUS_EVENT } from '../../lib/cloudSync';

/**
 * Sign-in gate for a browser that lost its link to the cloud backup (cleared history/cookies, Safari's
 * 7-day storage purge, a new device). It covers the app so empty lists never look like real data.
 * Username + password is the main way back in: the browser's password manager keeps the password
 * through a wipe and fills it in. Pasting the relink link still works as a fallback.
 * Never offers "turn on backup", which would start a second, empty backup.
 */
export function BackupGuard() {
  const [linked, setLinked] = useState(hasSyncKey);
  const [settled, setSettled] = useState(false);
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const [link, setLink] = useState('');
  const [showLink, setShowLink] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    const check = () => setLinked(hasSyncKey());
    window.addEventListener(SYNC_STATUS_EVENT, check);
    // The "Relink Life Hub" bookmark opens #sync-key=… — on an already-open page that's only a hash change.
    const onHash = () => {
      const m = window.location.hash.match(/^#sync-key=([0-9a-f]{24,})$/i);
      if (!m) return;
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
      void joinWithKey(m[1]).then(check);
    };
    window.addEventListener('hashchange', onHash);
    // Give the automatic key recovery (cookie / IndexedDB copies) a moment before asking.
    const t = window.setTimeout(() => {
      check();
      setSettled(true);
    }, 2500);
    return () => {
      window.removeEventListener(SYNC_STATUS_EVENT, check);
      window.removeEventListener('hashchange', onHash);
      window.clearTimeout(t);
    };
  }, []);

  if (linked) return null;

  async function submitLogin(e: FormEvent) {
    e.preventDefault();
    if (!user.trim() || !password) return;
    setBusy(true);
    setMsg('Signing in…');
    const r = await signIn(user, password);
    setBusy(false);
    if (r.ok) {
      setMsg('');
      setLinked(true);
      return;
    }
    const left = r.error === 'wrong_login' && typeof r.left === 'number' && r.left <= 3 ? ` (${r.left} tries left)` : '';
    setMsg(loginErrorText(r.error) + left);
  }

  async function submitLink(e: FormEvent) {
    e.preventDefault();
    if (!link.trim()) return;
    setBusy(true);
    setMsg('Linking…');
    const r = await joinWithKey(link);
    setBusy(false);
    if (r.state === 'ok') {
      setMsg('');
      setLinked(true);
    } else setMsg(r.error === 'wrong_key' ? 'That link doesn’t match your backup.' : 'Couldn’t link — check the link and try again.');
  }

  return (
    <div className="lh-gate" role="dialog" aria-modal="true" aria-labelledby="lh-gate-title">
      <div className="lh-gate-card">
        {!settled ? (
          <p className="lh-gate-checking">Checking this browser’s link…</p>
        ) : (
          <>
            <h2 id="lh-gate-title">Sign in to your Life Hub</h2>
            <p className="lh-gate-safe">
              <b>Your data is safe in the cloud.</b> This browser lost its link (clearing history or cookies does that), so nothing shows until you sign in.
            </p>
            <form className="lh-gate-form" onSubmit={submitLogin} method="post" action="#">
              <label>
                Username
                <input name="username" autoComplete="username" value={user} onChange={e => setUser(e.target.value)} autoCapitalize="off" autoCorrect="off" spellCheck={false} />
              </label>
              <label>
                Password
                <input name="password" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} />
              </label>
              <button type="submit" className="lh-gate-go" disabled={busy}>
                {busy && !showLink ? 'Signing in…' : 'Sign in'}
              </button>
            </form>
            {msg ? <p className="lh-gate-msg" role="alert">{msg}</p> : null}
            <button type="button" className="lh-gate-alt" onClick={() => setShowLink(s => !s)}>
              {showLink ? 'Hide' : 'No password yet? Paste your relink link instead'}
            </button>
            {showLink ? (
              <form className="lh-gate-form is-link" onSubmit={submitLink}>
                <input value={link} onChange={e => setLink(e.target.value)} placeholder="Paste the relink link or key" aria-label="Relink link or key" autoComplete="off" spellCheck={false} />
                <button type="submit" className="lh-gate-go" disabled={busy}>Relink</button>
              </form>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
