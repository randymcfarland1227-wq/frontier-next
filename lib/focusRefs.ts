/**
 * References on a short-term focus card: links, documents and images.
 * Links live on the card. Files go to the Worker (/api/files, KV `file:<id>`, backup key
 * required, 10 MB cap); the card keeps only the file id, name, size and, for images, a
 * small thumbnail so the synced backup stays small.
 */
import { WORKER_BASE, syncKeyHeader } from './cloudSync';

export type FocusRef = {
  id: string;
  kind: 'link' | 'doc' | 'image';
  title: string;
  /** link: the address */
  url?: string;
  /** doc / image: the stored file on the Worker */
  fileId?: string;
  type?: string;
  size?: number;
  /** image: ~160px JPEG data URL for the card */
  thumb?: string;
  at: string;
};

export const MAX_REF_BYTES = 10_000_000;
const FILES_URL = `${WORKER_BASE.replace(/\/$/, '')}/api/files`;

/** Turn typed text into a web address, or null when it isn't one. */
export function normalizeUrl(raw: string): string | null {
  const t = raw.trim();
  if (!t || /\s/.test(t)) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(t) ? t : `https://${t}`;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (!u.hostname.includes('.') && u.hostname !== 'localhost') return null;
    return u.href;
  } catch {
    return null;
  }
}

/** A short name for a link with no label: host + first path bit. */
export function linkLabel(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    const part = u.pathname.split('/').filter(Boolean)[0];
    return part ? `${host}/${decodeURIComponent(part)}`.slice(0, 60) : host;
  } catch {
    return url.slice(0, 60);
  }
}

/** image (opens as a picture) or doc (anything else). */
export function fileKind(type: string, name: string): 'image' | 'doc' {
  if (/^image\/(png|jpe?g|gif|webp|heic|heif|avif|bmp)$/i.test(type)) return 'image';
  if (!type && /\.(png|jpe?g|gif|webp|heic|heif|avif|bmp)$/i.test(name)) return 'image';
  return 'doc';
}

export function formatSize(bytes?: number): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Short type tag for a doc row: PDF, DOCX, … */
export function docTag(name: string, type?: string): string {
  const ext = /\.([a-z0-9]{1,5})$/i.exec(name)?.[1];
  if (ext) return ext.toUpperCase();
  if (type === 'application/pdf') return 'PDF';
  return 'FILE';
}

/** Links first, then images, then documents; newest first inside each. */
export function sortRefs(refs: FocusRef[]): FocusRef[] {
  const rank = { link: 0, image: 1, doc: 2 } as const;
  return [...refs].sort((a, b) => rank[a.kind] - rank[b.kind] || b.at.localeCompare(a.at));
}

// ---- browser-only ---------------------------------------------------------

function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('not_an_image')); };
    img.src = url;
  });
}

function draw(img: HTMLImageElement, max: number): HTMLCanvasElement {
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.width * scale));
  c.height = Math.max(1, Math.round(img.height * scale));
  const ctx = c.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
  }
  return c;
}

const toBlob = (c: HTMLCanvasElement, q: number) =>
  new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', q));

/** Store a file on the Worker and return the reference for the card. */
export async function uploadRef(file: File): Promise<FocusRef> {
  const head = syncKeyHeader();
  if (!head['X-Sync-Key']) throw new Error('Turn on cloud backup (Settings) to attach files. Links work without it.');
  let kind = fileKind(file.type, file.name);
  let body: Blob = file;
  let type = file.type || 'application/octet-stream';
  let thumb: string | undefined;
  if (kind === 'image') {
    try {
      const img = await loadImage(file);
      thumb = draw(img, 160).toDataURL('image/jpeg', 0.7);
      // Big photos are shrunk to 2400px so they stay readable but small.
      if (file.size > 1_500_000 || Math.max(img.width, img.height) > 2400) {
        const b = await toBlob(draw(img, 2400), 0.85);
        if (b && b.size < file.size) { body = b; type = 'image/jpeg'; }
      }
      URL.revokeObjectURL(img.src);
    } catch {
      kind = 'doc'; // browser can't show it (e.g. HEIC on Chrome): keep it as a file
    }
  }
  if (body.size > MAX_REF_BYTES) throw new Error(`${file.name} is ${formatSize(body.size)}; files can be up to 10 MB. Add a link to it instead.`);
  const res = await fetch(FILES_URL, {
    method: 'PUT',
    headers: { ...head, 'Content-Type': type, 'X-File-Name': encodeURIComponent(file.name) },
    body,
  });
  const out = (await res.json().catch(() => ({}))) as { ok?: boolean; id?: string; error?: string };
  if (!res.ok || !out.id) throw new Error(out.error === 'wrong_key' ? 'This device’s backup key was refused.' : `Upload failed (${out.error || res.status}).`);
  return { id: crypto.randomUUID(), kind, title: file.name, fileId: out.id, type, size: body.size, thumb, at: new Date().toISOString() };
}

/** Fetch a stored file's bytes (backup key sent). */
export async function fetchRefBlob(ref: FocusRef): Promise<Blob> {
  const res = await fetch(`${FILES_URL}/${ref.fileId}`, { headers: syncKeyHeader(), cache: 'no-store' });
  if (!res.ok) throw new Error(res.status === 404 ? 'That file is gone from the backup.' : `Couldn’t open it (${res.status}).`);
  const blob = await res.blob();
  return ref.type ? new Blob([blob], { type: ref.type }) : blob;
}

/** Open a stored file in a new tab (opened first so pop-up blockers allow it). */
export async function openRef(ref: FocusRef): Promise<void> {
  if (ref.kind === 'link' && ref.url) {
    window.open(ref.url, '_blank', 'noopener');
    return;
  }
  if (!ref.fileId) return;
  const tab = window.open('', '_blank');
  try {
    const url = URL.createObjectURL(await fetchRefBlob(ref));
    if (tab) tab.location.href = url;
    else saveAs(url, ref.title); // pop-ups blocked: download it instead of leaving Life Hub
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (e) {
    tab?.close();
    throw e;
  }
}

/** Download a stored file with its own name. */
export async function downloadRef(ref: FocusRef): Promise<void> {
  if (!ref.fileId) return;
  const url = URL.createObjectURL(await fetchRefBlob(ref));
  saveAs(url, ref.title);
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function saveAs(url: string, name: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
}

/** Remove a stored file from the Worker (best effort). */
export function deleteRemote(ref: FocusRef): void {
  if (!ref.fileId) return;
  fetch(`${FILES_URL}/${ref.fileId}`, { method: 'DELETE', headers: syncKeyHeader() }).catch(() => {});
}
