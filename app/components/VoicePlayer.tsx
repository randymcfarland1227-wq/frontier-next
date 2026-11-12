'use client';

import { useEffect, useState } from 'react';
import type { CaptureAudio } from '../../lib/captures';
import { WORKER_BASE, syncKeyHeader } from '../../lib/cloudSync';

const FILES_URL = `${WORKER_BASE.replace(/\/$/, '')}/api/files`;

function clock(seconds: number) {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Play button for a voice memo capture. The recording is fetched (backup key) only when tapped. */
export function VoicePlayer({ audio }: { audio: CaptureAudio }) {
  const [url, setUrl] = useState<string | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [error, setError] = useState('');

  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);

  async function load() {
    setState('loading');
    try {
      const res = await fetch(`${FILES_URL}/${audio.fileId}`, { headers: syncKeyHeader(), cache: 'no-store' });
      if (!res.ok) throw new Error(res.status === 404 ? 'Recording is gone from the backup.' : res.status === 401 ? 'Link this device to your backup to play it.' : `Couldn’t load it (${res.status}).`);
      const blob = await res.blob();
      setUrl(URL.createObjectURL(new Blob([blob], { type: audio.type || blob.type })));
      setState('idle');
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      setError(!msg || msg === 'Failed to fetch' || msg === 'Load failed' ? 'Couldn’t reach the backup. Try again.' : msg);
      setState('error');
    }
  }

  if (url) {
    return (
      <span className="sk-voice">
        <audio className="sk-voice-audio" src={url} controls autoPlay preload="auto" />
      </span>
    );
  }
  return (
    <span className="sk-voice">
      <button type="button" className="sk-voice-play" onClick={() => void load()} disabled={state === 'loading'} aria-label={`Play voice memo, ${clock(audio.seconds)}`}>
        <span className="sk-voice-tri" aria-hidden="true">▶</span>
        {state === 'loading' ? 'Loading…' : `Play · ${clock(audio.seconds)}`}
      </button>
      {state === 'error' ? <span className="sk-voice-err">{error}</span> : null}
    </span>
  );
}
