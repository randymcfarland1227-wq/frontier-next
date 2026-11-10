/** Device-only layout choices. These never change task or money data. */
export type DisplaySize = 'compact' | 'standard' | 'large';
export type DisplaySettings = { headers: DisplaySize; tabs: DisplaySize; spacing: 'compact' | 'standard' };
export const DISPLAY_KEY = 'lifehub-display';
export const DEFAULT_DISPLAY: DisplaySettings = { headers: 'compact', tabs: 'compact', spacing: 'compact' };
const size = (value: unknown): DisplaySize => value === 'standard' || value === 'large' ? value : 'compact';
export function displaySettings(value: unknown): DisplaySettings {
  const v = value && typeof value === 'object' ? value as Partial<DisplaySettings> : {};
  return { headers: size(v.headers), tabs: size(v.tabs), spacing: v.spacing === 'standard' ? 'standard' : 'compact' };
}
export function pageZoom(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(160, Math.max(60, Math.round(value / 10) * 10)) : null;
}
