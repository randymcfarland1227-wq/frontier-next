'use client';

/**
 * Weather for where you are right now: the browser's location → Open-Meteo (free, no key).
 * Only the rounded coordinates leave the device. The last reading is kept for 30 minutes so the
 * header doesn't ask again on every load.
 */

import { useCallback, useEffect, useState } from 'react';
import { readSaved, writeSaved } from './storage';

const KEY = 'lifehub-weather';
const FRESH_MS = 30 * 60 * 1000;

export type Weather = { temp: number; high: number; low: number; code: number; day: boolean; at: number };
type Saved = { lat: number; lon: number; reading?: Weather } | null;

/** WMO weather code → a glyph and a couple of words. */
export function describe(code: number, day: boolean): { icon: string; label: string } {
  if (code === 0) return { icon: day ? '☀️' : '🌙', label: day ? 'Sunny' : 'Clear' };
  if (code === 1 || code === 2) return { icon: day ? '🌤️' : '☁️', label: 'Partly cloudy' };
  if (code === 3) return { icon: '☁️', label: 'Cloudy' };
  if (code === 45 || code === 48) return { icon: '🌫️', label: 'Foggy' };
  if (code >= 51 && code <= 57) return { icon: '🌦️', label: 'Drizzle' };
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return { icon: '🌧️', label: 'Rain' };
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { icon: '❄️', label: 'Snow' };
  if (code >= 95) return { icon: '⛈️', label: 'Storms' };
  return { icon: '🌡️', label: '' };
}

async function fetchWeather(lat: number, lon: number): Promise<Weather> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    '&current=temperature_2m,weather_code,is_day&daily=temperature_2m_max,temperature_2m_min' +
    '&temperature_unit=fahrenheit&timezone=auto&forecast_days=1';
  const res = await fetch(url);
  if (!res.ok) throw new Error(`weather ${res.status}`);
  const j = (await res.json()) as {
    current: { temperature_2m: number; weather_code: number; is_day: number };
    daily: { temperature_2m_max: number[]; temperature_2m_min: number[] };
  };
  return {
    temp: Math.round(j.current.temperature_2m),
    high: Math.round(j.daily.temperature_2m_max[0]),
    low: Math.round(j.daily.temperature_2m_min[0]),
    code: j.current.weather_code,
    day: j.current.is_day === 1,
    at: Date.now(),
  };
}

export function useWeather() {
  const [reading, setReading] = useState<Weather | null>(() => readSaved<Saved>(KEY, null)?.reading ?? null);
  const [state, setState] = useState<'idle' | 'loading' | 'denied' | 'error'>('idle');

  const load = useCallback((force = false) => {
    const saved = readSaved<Saved>(KEY, null);
    if (!force && saved?.reading && Date.now() - saved.reading.at < FRESH_MS) {
      setReading(saved.reading);
      return;
    }
    const run = async (lat: number, lon: number) => {
      try {
        const next = await fetchWeather(lat, lon);
        writeSaved(KEY, { lat, lon, reading: next });
        setReading(next);
        setState('idle');
      } catch {
        setState('error');
      }
    };
    setState('loading');
    if (!navigator.geolocation) {
      if (saved) void run(saved.lat, saved.lon);
      else setState('error');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      pos => void run(Math.round(pos.coords.latitude * 100) / 100, Math.round(pos.coords.longitude * 100) / 100),
      err => {
        if (saved) void run(saved.lat, saved.lon);
        else setState(err.code === 1 ? 'denied' : 'error');
      },
      { timeout: 10000, maximumAge: 60 * 60 * 1000 },
    );
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => load(), 0);
    return () => window.clearTimeout(t);
  }, [load]);

  return { reading, state, retry: () => load(true) };
}
