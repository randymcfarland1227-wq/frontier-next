// Sunrise and sunset for Towson, MD, worked out on the device (NOAA "sunrise equation"), so the
// day ribbon's sun and moon are live and need no network call.
export const TOWSON = { lat: 39.4015, lon: -76.6019, tz: "America/New_York" };

const rad = (d: number) => (d * Math.PI) / 180;
const wrap = (d: number) => ((d % 360) + 360) % 360;

/** Local calendar date at Towson for an instant. */
function towsonDate(at: Date): { y: number; m: number; d: number } {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: TOWSON.tz,
      year: "numeric",
      month: "numeric",
      day: "numeric",
    })
      .formatToParts(at)
      .map((x) => [x.type, Number(x.value)]),
  );
  return { y: p.year, m: p.month, d: p.day };
}

/** Sunrise and sunset instants for Towson's calendar day containing `at`. */
export function sunTimes(at: Date = new Date()): { rise: Date; set: Date } {
  const { y, m, d } = towsonDate(at);
  const jd0 = Date.UTC(y, m - 1, d) / 86400000 + 2440587.5; // 00:00 UTC of that date
  const n = Math.ceil(jd0 - 2451545.0 + 0.0008);
  const jStar = n - TOWSON.lon / 360;
  const M = wrap(357.5291 + 0.98560028 * jStar);
  const C =
    1.9148 * Math.sin(rad(M)) +
    0.02 * Math.sin(rad(2 * M)) +
    0.0003 * Math.sin(rad(3 * M));
  const lambda = wrap(M + C + 180 + 102.9372);
  const transit =
    2451545.0 +
    jStar +
    0.0053 * Math.sin(rad(M)) -
    0.0069 * Math.sin(rad(2 * lambda));
  const sinDec = Math.sin(rad(lambda)) * Math.sin(rad(23.4397));
  const cosDec = Math.cos(Math.asin(sinDec));
  const cosW =
    (Math.sin(rad(-0.833)) - Math.sin(rad(TOWSON.lat)) * sinDec) /
    (Math.cos(rad(TOWSON.lat)) * cosDec);
  const w = (Math.acos(Math.max(-1, Math.min(1, cosW))) * 180) / Math.PI;
  const at2 = (j: number) => new Date((j - 2440587.5) * 86400000);
  return { rise: at2(transit - w / 360), set: at2(transit + w / 360) };
}

/** Time of day to show: Towson clock time, e.g. "7:19 AM". */
export const towsonTime = (d: Date) =>
  d.toLocaleTimeString("en-US", {
    timeZone: TOWSON.tz,
    hour: "numeric",
    minute: "2-digit",
  });
/** Hours past midnight on Towson's clock. */
export const towsonHours = (d: Date) => {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: TOWSON.tz,
      hour: "numeric",
      minute: "numeric",
      hourCycle: "h23",
    })
      .formatToParts(d)
      .map((x) => [x.type, Number(x.value)]),
  );
  return p.hour + p.minute / 60;
};
