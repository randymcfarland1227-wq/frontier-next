'use client';

import { FormEvent, useEffect, useState } from 'react';
import {
  buildDataFile,
  buildRecoverySheet,
  restoreDataFile,
  deviceLink,
  disableBackup,
  enableBackup,
  getSyncStatus,
  joinWithKey,
  loginInfo,
  setLoginPassword,
  type LoginInfo,
  syncNow,
  SYNC_STATUS_EVENT,
  type SyncStatus,
} from '../../lib/cloudSync';
import { Group } from '../sticker/kit';

function ago(iso?: string) {
  if (!iso) return '';
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  return hours < 24 ? `${hours} hr ago` : new Date(iso).toLocaleDateString();
}

const ERRORS: Record<string, string> = {
  wrong_key: "That key doesn't match your backup.",
  offline: "Couldn't reach the backup — will retry.",
};

export function CloudBackup() {
  const [status, setStatus] = useState<SyncStatus>(() => getSyncStatus());
  const [joining, setJoining] = useState(false);
  const [key, setKey] = useState('');
  const [copied, setCopied] = useState(false);
  const [, tick] = useState(0);

  useEffect(() => {
    const onStatus = (e: Event) => setStatus({ ...(e as CustomEvent<SyncStatus>).detail });
    window.addEventListener(SYNC_STATUS_EVENT, onStatus);
    const timer = window.setInterval(() => tick(n => n + 1), 30000);
    return () => {
      window.removeEventListener(SYNC_STATUS_EVENT, onStatus);
      window.clearInterval(timer);
    };
  }, []);

  async function copyLink() {
    const link = deviceLink();
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      window.prompt('Open this link on your other device:', link);
    }
  }

  function download(name: string, text: string, type: string) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  const stamp = () => new Date().toISOString().slice(0, 10);
  const [fileMsg, setFileMsg] = useState('');

  async function saveData() {
    download(`life-hub-data-${stamp()}.json`, await buildDataFile(), 'application/json');
    setFileMsg('Data file downloaded — keep it somewhere safe (Drive, email to yourself).');
  }

  function saveSheet() {
    const sheet = buildRecoverySheet();
    if (sheet) download(`life-hub-recovery-${stamp()}.txt`, sheet, 'text/plain');
    setFileMsg('Recovery sheet downloaded — it holds your key, so store it privately (password manager).');
  }

  async function restore(file?: File) {
    if (!file) return;
    const r = restoreDataFile(await file.text());
    setFileMsg(r.ok ? `Restored — ${r.added} item${r.added === 1 ? '' : 's'} brought back.` : r.error || 'Could not restore.');
  }

  const [login, setLogin] = useState<LoginInfo | null>(null);
  const [pwOpen, setPwOpen] = useState(false);
  const [pwUser, setPwUser] = useState('');
  const [pw1, setPw1] = useState('');
  const [pw2, setPw2] = useState('');
  const [pwMsg, setPwMsg] = useState('');
  const linkedNow = status.state !== 'off';
  useEffect(() => {
    if (!linkedNow) return;
    void loginInfo().then(info => {
      setLogin(info);
      if (info?.user) setPwUser(info.user);
    });
  }, [linkedNow]);
  async function savePassword(event: FormEvent) {
    event.preventDefault();
    if (!pwUser.trim()) return setPwMsg('Pick a username.');
    if (pw1.length < 8) return setPwMsg('Use at least 8 characters.');
    if (pw1 !== pw2) return setPwMsg('The two passwords don’t match.');
    setPwMsg('Saving…');
    const r = await setLoginPassword(pwUser, pw1);
    if (!r.ok) return setPwMsg(r.error === 'offline' ? 'Couldn’t reach the backup — try again.' : 'Couldn’t save it — try again.');
    setLogin({ set: true, user: pwUser.trim().toLowerCase(), at: new Date().toISOString() });
    setPw1('');
    setPw2('');
    setPwOpen(false);
    setPwMsg('Saved. Let your browser save this password when it asks; after a wipe it fills it in for you.');
  }
  const relink = deviceLink();

  async function join(event: FormEvent) {
    event.preventDefault();
    if (!key.trim()) return;
    const result = await joinWithKey(key);
    if (result.state === 'ok') {
      setJoining(false);
      setKey('');
    }
  }

  const on = status.state !== 'off';
  const c = status.counts;

  return (
    <Group tone="paper" title="Cloud Backup" className={`sk-backup is-${status.state}`}>
    <div aria-live="polite">
      {status.notice ? <p className="sk-sec sk-notice">✓ {status.notice}</p> : null}
      <div className="sk-bk-row">
        <p className="sk-rs">
          <strong>
            {status.state === 'off' && '○ Backup off'}
            {status.state === 'syncing' && '◌ Backing up…'}
            {status.state === 'ok' && '● Backed up'}
            {status.state === 'error' && '▲ Backup problem'}
          </strong>{' '}
          {status.state === 'off' &&
            'Your history lives only in this browser, and live TickTick, Gmail and Role Hub updates need backup on here (turn it on, or open your device link).'}
          {status.state === 'ok' &&
            `${ago(status.at)}${c ? ` · ${c.completions} completions, ${c.captures} ideas, ${c.self} Self items` : ''}`}
          {status.state === 'error' && (ERRORS[status.error || ''] || status.error)}
        </p>
        <div className="sk-bk-actions">
          {!on ? (
            <>
              <button type="button" className="sk-btn is-small" onClick={() => void enableBackup()}>
                Turn On Backup
              </button>
              <button type="button" className="sk-btn is-small is-quiet" onClick={() => setJoining(j => !j)}>
                I Have a Link or Key
              </button>
            </>
          ) : (
            <>
              <button type="button" className="sk-btn is-small is-quiet" onClick={() => void copyLink()}>
                {copied ? 'Link copied' : 'Link Another Device'}
              </button>
              {status.state === 'error' ? (
                <button type="button" className="sk-btn is-small is-quiet" onClick={() => void syncNow()}>
                  Retry
                </button>
              ) : null}
              <button
                type="button"
                className="sk-btn is-small is-quiet"
                onClick={() => {
                  if (window.confirm('Stop backing up this browser? Your saved backup stays in the cloud.')) disableBackup();
                }}
              >
                Turn Off
              </button>
            </>
          )}
        </div>
      </div>
      {on ? (
        <div className="sk-bk-row">
          <div className="sk-rs">
            <strong>Sign-in password</strong>{' '}
            {login?.set
              ? `On · username “${login.user}”. If this browser ever loses its link, you just sign in.`
              : 'Not set. Set a username and password so a cleared browser only needs a sign-in, not your link.'}
            {pwMsg ? <> {pwMsg}</> : null}
            {pwOpen ? (
              <form className="sk-login-form" onSubmit={savePassword} method="post" action="#">
                <input name="username" autoComplete="username" placeholder="Username" aria-label="Username" value={pwUser} onChange={e => setPwUser(e.target.value)} autoCapitalize="off" autoCorrect="off" spellCheck={false} />
                <input name="new-password" type="password" autoComplete="new-password" placeholder="New password" aria-label="New password" value={pw1} onChange={e => setPw1(e.target.value)} />
                <input name="confirm-password" type="password" autoComplete="new-password" placeholder="Same password again" aria-label="Confirm password" value={pw2} onChange={e => setPw2(e.target.value)} />
                <button type="submit" className="sk-btn is-small">Save Password</button>
              </form>
            ) : null}
          </div>
          <div className="sk-bk-actions">
            <button type="button" className="sk-btn is-small is-quiet" onClick={() => { setPwOpen(o => !o); setPwMsg(''); }}>
              {pwOpen ? 'Cancel' : login?.set ? 'Change Password' : 'Set Password'}
            </button>
            {relink ? (
              <a
                className="sk-btn is-small is-quiet"
                href={relink}
                title="Drag this to your bookmarks bar. Bookmarks survive clearing history and cookies; click it to relink."
                onClick={e => { e.preventDefault(); setPwMsg('Drag the “Relink Life Hub” button to your bookmarks bar — clicking it later relinks this browser.'); }}
              >
                Relink Life Hub
              </a>
            ) : null}
          </div>
        </div>
      ) : null}
      <div className="sk-bk-row">
        <p className="sk-rs">
          <strong>Safe copies</strong> that don&apos;t depend on any device: {fileMsg || 'download a data file and a recovery sheet, and keep them in Drive or a password manager.'}
        </p>
        <div className="sk-bk-actions">
          <button type="button" className="sk-btn is-small is-quiet" onClick={() => void saveData()}>Download Data File</button>
          {on ? <button type="button" className="sk-btn is-small is-quiet" onClick={saveSheet}>Download Recovery Sheet</button> : null}
          <label className="sk-btn is-small is-quiet">
            Restore From File
            <input type="file" accept=".json,application/json" hidden onChange={e => { void restore(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
        </div>
      </div>
      {joining && !on ? (
        <form className="sk-form is-inline" onSubmit={join}>
          <input
            value={key}
            onChange={e => setKey(e.target.value)}
            placeholder="Paste the link (or key) from your other device"
            aria-label="Backup key"
            autoComplete="off"
            spellCheck={false}
          />
          <button type="submit" className="sk-btn is-small">
            Link
          </button>
        </form>
      ) : null}
    </div>
    </Group>
  );
}
