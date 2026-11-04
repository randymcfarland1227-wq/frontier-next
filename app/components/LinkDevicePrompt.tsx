'use client';

import { useState } from 'react';
import { hasSyncKey, joinWithKey } from '../../lib/cloudSync';

/**
 * Shown only on a device that is not linked to the backup. Without the key, the Worker refuses the
 * private feeds (Radall sheet, TickTick writes, saved lists…), so a phone looks "stuck waiting".
 * Paste the "Link another device" link from the computer (More → Cloud backup) here.
 */
export function LinkDevicePrompt({ compact = false }: { compact?: boolean }) {
  const [linked, setLinked] = useState(hasSyncKey);
  const [value, setValue] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  if (linked) return null;
  const link = async () => {
    if (!value.trim()) return;
    setBusy(true);
    const r = await joinWithKey(value);
    setBusy(false);
    if (r.state === 'ok') {
      setLinked(true);
      setMsg('');
    } else setMsg(r.error === 'wrong_key' ? 'That key doesn’t match your backup.' : 'Couldn’t link — check the link and try again.');
  };
  return (
    <section className={`ldp${compact ? ' is-compact' : ''}`} aria-label="Link this device">
      <p>
        <b>This device isn’t linked to your backup.</b> Your saved lists, Money sheet and TickTick logging stay empty until you link it.
        On the computer open <i>Cloud backup → Link another device</i>, copy the link, and paste it here.
      </p>
      <div className="ldp-row">
        <input value={value} onChange={e => setValue(e.target.value)} placeholder="Paste the link or key" aria-label="Backup link or key" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
        <button type="button" className="sk-btn is-small" onClick={() => void link()} disabled={busy}>
          {busy ? 'Linking…' : 'Link'}
        </button>
      </div>
      {msg ? <p className="ldp-msg" role="alert">{msg}</p> : null}
    </section>
  );
}
