// Direct carrier tracking (USPS APIs v3, FedEx Track API, UPS Track API) for the Packages panel.
// Each carrier is used only when both of its secrets are set; numbers it can't answer fall back to
// Track123 in handleTrack. OAuth tokens and results are cached in KV.

export interface CarrierEnv {
  LIFEHUB_STATE: KVNamespace;
  USPS_CLIENT_ID?: string;
  USPS_CLIENT_SECRET?: string;
  FEDEX_CLIENT_ID?: string;
  FEDEX_CLIENT_SECRET?: string;
  UPS_CLIENT_ID?: string;
  UPS_CLIENT_SECRET?: string;
}

export type Carrier = "usps" | "fedex" | "ups";
export type TrackItem = { number: string; status?: string; eta?: string; last?: string; carrier?: string; via?: string };

const UA = "frontier-life-hub/1.0";
const RESULT_TTL_MS = 20 * 60_000; // re-ask a carrier at most every 20 min per number
const CARRIER_NAME: Record<Carrier, string> = { usps: "USPS", fedex: "FedEx", ups: "UPS" };

/** Guess the carrier from the number's shape. */
export function detectCarrier(raw: string): Carrier | undefined {
  const n = raw.replace(/\s+/g, "").toUpperCase();
  if (/^1Z[0-9A-Z]{16}$/.test(n)) return "ups";
  if (/^(T\d{10}|\d{9}|K\d{10})$/.test(n)) return "ups"; // UPS Mail Innovations / freight / InfoNotice
  if (/^(92|93|94|95)\d{18,24}$/.test(n)) return "usps"; // IMpb 20–26 digits
  if (/^420\d{5}(\d{4})?9\d{19,25}$/.test(n)) return "usps"; // ZIP-prefixed IMpb
  if (/^(82|9[0-1])\d{8}$/.test(n)) return "usps";
  if (/^[A-Z]{2}\d{9}US$/.test(n)) return "usps"; // international (EA…US, LZ…US)
  if (/^(96\d{20}|\d{34})$/.test(n)) return "fedex"; // FedEx Ground 96… / SSCC barcode
  if (/^(\d{12}|\d{15}|\d{20})$/.test(n)) return "fedex";
  return undefined;
}

export function carrierEnabled(env: CarrierEnv, c: Carrier): boolean {
  if (c === "usps") return Boolean(env.USPS_CLIENT_ID && env.USPS_CLIENT_SECRET);
  if (c === "fedex") return Boolean(env.FEDEX_CLIENT_ID && env.FEDEX_CLIENT_SECRET);
  return Boolean(env.UPS_CLIENT_ID && env.UPS_CLIENT_SECRET);
}

const day = (v?: string | null) => {
  if (!v) return undefined;
  if (/^\d{8}$/.test(v)) return `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`; // UPS YYYYMMDD
  return /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : undefined;
};
const place = (...parts: Array<string | undefined>) => parts.filter(Boolean).join(", ");
const lastLine = (what?: string, where?: string, when?: string) => [what, where, day(when)].filter(Boolean).join(" · ") || undefined;

// ---- OAuth (client credentials), token cached in KV until shortly before it expires -------------

async function token(env: CarrierEnv, c: Carrier, raw: Record<string, string>): Promise<string> {
  const cacheKey = `carrier-token:${c}`;
  const cached = await env.LIFEHUB_STATE.get(cacheKey);
  if (cached) return cached;
  let res: Response;
  if (c === "usps") {
    res = await fetch("https://apis.usps.com/oauth2/v3/token", {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": UA },
      body: JSON.stringify({ grant_type: "client_credentials", client_id: env.USPS_CLIENT_ID, client_secret: env.USPS_CLIENT_SECRET }),
    });
  } else if (c === "fedex") {
    res = await fetch("https://apis.fedex.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA },
      body: new URLSearchParams({ grant_type: "client_credentials", client_id: env.FEDEX_CLIENT_ID!, client_secret: env.FEDEX_CLIENT_SECRET! }),
    });
  } else {
    res = await fetch("https://onlinetools.ups.com/security/v1/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${btoa(`${env.UPS_CLIENT_ID}:${env.UPS_CLIENT_SECRET}`)}`,
        "User-Agent": UA,
      },
      body: new URLSearchParams({ grant_type: "client_credentials" }),
    });
  }
  const text = await res.text();
  raw[`${c}-token`] = `${res.status} ${text.slice(0, 300)}`;
  if (!res.ok) throw new Error(`${c}_auth_${res.status}`);
  const body = JSON.parse(text) as { access_token?: string; expires_in?: number | string };
  if (!body.access_token) throw new Error(`${c}_auth_no_token`);
  const ttl = Math.max(60, Number(body.expires_in || 3600) - 120);
  await env.LIFEHUB_STATE.put(cacheKey, body.access_token, { expirationTtl: ttl });
  return body.access_token;
}

// ---- USPS APIs v3 --------------------------------------------------------------------------------

type UspsEvent = { eventType?: string; eventTimestamp?: string; eventCity?: string; eventState?: string };
async function trackUsps(env: CarrierEnv, num: string, raw: Record<string, string>): Promise<TrackItem | undefined> {
  const t = await token(env, "usps", raw);
  const res = await fetch(`https://apis.usps.com/tracking/v3/tracking/${encodeURIComponent(num)}?expand=DETAIL`, {
    headers: { Authorization: `Bearer ${t}`, accept: "application/json", "User-Agent": UA },
  });
  const text = await res.text();
  raw[`usps-${num}`] = `${res.status} ${text.slice(0, 600)}`;
  if (!res.ok) return undefined;
  const b = JSON.parse(text) as {
    statusCategory?: string; status?: string; statusSummary?: string;
    expectedDeliveryTimeStamp?: string; expectedDeliveryDate?: string; trackingEvents?: UspsEvent[];
  };
  const ev = b.trackingEvents?.[0]; // newest first
  const words = `${b.statusCategory || ""} ${b.status || ""}`.toLowerCase();
  let status: string | undefined;
  if (/delivered/.test(words) && !/not delivered|undeliver/.test(words)) status = "delivered";
  else if (/out for delivery/.test(words)) status = "out";
  else if (/pickup|pick up|available for/.test(words)) status = "pickup";
  else if (/alert|exception|return|undeliver|not delivered/.test(words)) status = "problem";
  else if (/pre-shipment|label|shipping label|pre-ship/.test(words)) status = "shipped";
  else if (/transit|accepted|arrived|departed|processed|moving/.test(words)) status = "transit";
  return {
    number: num,
    status,
    eta: status === "delivered" ? day(ev?.eventTimestamp) : day(b.expectedDeliveryTimeStamp || b.expectedDeliveryDate),
    last: lastLine(ev?.eventType || b.status, place(ev?.eventCity, ev?.eventState), ev?.eventTimestamp),
    carrier: "USPS",
  };
}

// ---- FedEx Track API (up to 30 numbers per call) -------------------------------------------------

type FedexResult = {
  trackingNumberInfo?: { trackingNumber?: string };
  latestStatusDetail?: { code?: string; derivedCode?: string; description?: string; statusByLocale?: string; scanLocation?: { city?: string; stateOrProvinceCode?: string } };
  dateAndTimes?: Array<{ type?: string; dateTime?: string }>;
  estimatedDeliveryTimeWindow?: { window?: { ends?: string; begins?: string } };
  scanEvents?: Array<{ date?: string; eventDescription?: string; scanLocation?: { city?: string; stateOrProvinceCode?: string } }>;
  error?: { code?: string };
};
const FEDEX_CODE: Record<string, string> = {
  DL: "delivered", OD: "out", HL: "pickup", HP: "pickup", PU: "transit", IT: "transit", AR: "transit", DP: "transit",
  AF: "transit", IN: "transit", OW: "transit", PL: "transit", CC: "transit", CD: "transit", OC: "shipped", PX: "shipped",
  DE: "problem", SE: "problem", CA: "problem", RS: "problem", DY: "transit", DD: "transit",
};
async function trackFedex(env: CarrierEnv, nums: string[], raw: Record<string, string>): Promise<TrackItem[]> {
  if (!nums.length) return [];
  const t = await token(env, "fedex", raw);
  const res = await fetch("https://apis.fedex.com/track/v1/trackingnumbers", {
    method: "POST",
    headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json", "X-locale": "en_US", "User-Agent": UA },
    body: JSON.stringify({ includeDetailedScans: true, trackingInfo: nums.slice(0, 30).map((n) => ({ trackingNumberInfo: { trackingNumber: n } })) }),
  });
  const text = await res.text();
  raw.fedex = `${res.status} ${text.slice(0, 900)}`;
  if (!res.ok) return [];
  const b = JSON.parse(text) as { output?: { completeTrackResults?: Array<{ trackingNumber?: string; trackResults?: FedexResult[] }> } };
  const out: TrackItem[] = [];
  for (const r of b.output?.completeTrackResults || []) {
    const tr = r.trackResults?.[0];
    if (!tr || tr.error) continue;
    const s = tr.latestStatusDetail || {};
    const status = FEDEX_CODE[s.derivedCode || s.code || ""] || FEDEX_CODE[s.code || ""];
    const when = (type: string) => tr.dateAndTimes?.find((d) => d.type === type)?.dateTime;
    const ev = tr.scanEvents?.[0];
    out.push({
      number: String(r.trackingNumber || tr.trackingNumberInfo?.trackingNumber || ""),
      status,
      eta: status === "delivered" ? day(when("ACTUAL_DELIVERY")) : day(when("ESTIMATED_DELIVERY") || tr.estimatedDeliveryTimeWindow?.window?.ends),
      last: lastLine(ev?.eventDescription || s.statusByLocale || s.description, place(ev?.scanLocation?.city || s.scanLocation?.city, ev?.scanLocation?.stateOrProvinceCode || s.scanLocation?.stateOrProvinceCode), ev?.date),
      carrier: "FedEx",
    });
  }
  return out;
}

// ---- UPS Track API -------------------------------------------------------------------------------

type UpsActivity = { date?: string; status?: { type?: string; description?: string; code?: string }; location?: { address?: { city?: string; stateProvince?: string } } };
async function trackUps(env: CarrierEnv, num: string, raw: Record<string, string>): Promise<TrackItem | undefined> {
  const t = await token(env, "ups", raw);
  const res = await fetch(`https://onlinetools.ups.com/api/track/v1/details/${encodeURIComponent(num)}?locale=en_US&returnSignature=false`, {
    headers: { Authorization: `Bearer ${t}`, transId: crypto.randomUUID().replace(/-/g, "").slice(0, 32), transactionSrc: "lifehub", accept: "application/json", "User-Agent": UA },
  });
  const text = await res.text();
  raw[`ups-${num}`] = `${res.status} ${text.slice(0, 600)}`;
  if (!res.ok) return undefined;
  const b = JSON.parse(text) as {
    trackResponse?: { shipment?: Array<{ package?: Array<{ currentStatus?: { description?: string; code?: string }; deliveryDate?: Array<{ type?: string; date?: string }>; activity?: UpsActivity[] }> }> };
  };
  const p = b.trackResponse?.shipment?.[0]?.package?.[0];
  if (!p) return undefined;
  const ev = p.activity?.[0];
  const type = ev?.status?.type || "";
  const desc = `${p.currentStatus?.description || ""} ${ev?.status?.description || ""}`.toLowerCase();
  let status: string | undefined;
  if (type === "D" || /^delivered/.test(desc.trim())) status = "delivered";
  else if (/out for delivery/.test(desc)) status = "out";
  else if (/access point|ready for pickup|pick up/.test(desc)) status = "pickup";
  else if (type === "X" || /exception|returned|delay/.test(desc)) status = "problem";
  else if (type === "M" || /label created|shipper created/.test(desc)) status = "shipped";
  else if (type === "I" || type === "P") status = "transit";
  const dd = p.deliveryDate?.find((d) => d.type === (status === "delivered" ? "DEL" : "SDD")) || p.deliveryDate?.[0];
  return {
    number: num,
    status,
    eta: day(dd?.date),
    last: lastLine(ev?.status?.description, place(ev?.location?.address?.city, ev?.location?.address?.stateProvince), ev?.date),
    carrier: "UPS",
  };
}

// ---- Entry point ---------------------------------------------------------------------------------

/**
 * Track every number whose carrier has secrets set. Returns the answers plus the numbers it could
 * not answer (unknown carrier, carrier off, carrier error) so the caller can try Track123.
 */
export async function trackDirect(env: CarrierEnv, nums: string[], force = false): Promise<{ items: TrackItem[]; rest: string[]; raw: Record<string, string>; used: Carrier[] }> {
  const raw: Record<string, string> = {};
  const items: TrackItem[] = [];
  const rest: string[] = [];
  const groups: Record<Carrier, string[]> = { usps: [], fedex: [], ups: [] };
  for (const n of nums) {
    const c = detectCarrier(n);
    if (c && carrierEnabled(env, c)) groups[c].push(n);
    else rest.push(n);
  }
  const used = (Object.keys(groups) as Carrier[]).filter((c) => groups[c].length);

  // Cached answers first (delivered ones stay cached for a week, others 20 min).
  const todo: Record<Carrier, string[]> = { usps: [], fedex: [], ups: [] };
  for (const c of used) {
    for (const n of groups[c]) {
      const hit = force ? null : ((await env.LIFEHUB_STATE.get(`carrier-track:${n}`, "json")) as { at: number; item: TrackItem } | null);
      if (hit && (hit.item.status === "delivered" || Date.now() - hit.at < RESULT_TTL_MS)) items.push({ ...hit.item, via: "cache" });
      else todo[c].push(n);
    }
  }

  const fresh: TrackItem[] = [];
  const safe = async <T>(c: Carrier, fn: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await fn();
    } catch (err) {
      raw[`${c}-error`] = String(err).slice(0, 200);
      return fallback;
    }
  };
  await Promise.all([
    safe("usps", async () => { for (const n of todo.usps) { const r = await trackUsps(env, n, raw); if (r) fresh.push(r); } }, undefined),
    safe("ups", async () => { for (const n of todo.ups) { const r = await trackUps(env, n, raw); if (r) fresh.push(r); } }, undefined),
    safe("fedex", async () => { fresh.push(...(await trackFedex(env, todo.fedex, raw))); }, undefined),
  ]);
  for (const it of fresh) {
    if (!it.number) continue;
    items.push({ ...it, via: CARRIER_NAME[detectCarrier(it.number) || "usps"] });
    await env.LIFEHUB_STATE.put(`carrier-track:${it.number}`, JSON.stringify({ at: Date.now(), item: it }), {
      expirationTtl: it.status === "delivered" ? 7 * 86400 : 3 * 86400,
    });
  }
  const answered = new Set(items.map((i) => i.number));
  for (const c of used) for (const n of groups[c]) if (!answered.has(n)) rest.push(n);
  return { items, rest, raw, used };
}
