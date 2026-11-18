/**
 * Life Hub Packages — reads carrier / store shipping email and sends tracking status to Life Hub
 * (Dashboard › Packages). Runs inside syncStarredMail (10-minute trigger + Life Hub's ↻ Refresh).
 *
 * The Worker (/api/packages/mail) updates the package whose tracking number (or order number)
 * matches; status only moves forward. Numbers it can't match wait in a list for the daily routine.
 * Uses the Gmail access this project already has — no new setup.
 */

const LIFE_HUB_PACKAGES_URL = 'https://frontier-work-room.randymcfarland1227.workers.dev/api/packages/mail';

const LHP_QUERY = [
  'newer_than:21d -category:promotions -in:sent',
  '{from:(ups.com OR fedex.com OR usps.com OR informeddelivery.usps.com OR speedx.io OR heymistr.com OR calvinklein.com OR shop.app OR amazon.com)',
  'subject:(shipped OR delivered OR "out for delivery" OR "on its way" OR "on the way" OR tracking OR shipment OR "ship notification" OR "delivery" OR "ready for pickup")}',
  '-subject:("made the sale" OR "shipping label" OR "new home" OR "label is ready")',
].join(' ');

// Checked in this order; the first that matches wins. Subject is checked before the body text.
const LHP_STATUS = [
  ['delivered', /\b(has been|was|been|package|is) delivered\b|\bdelivered[:!]|^delivered\b|delivery (is )?complete|package delivered/i],
  ['out', /out for delivery/i],
  ['pickup', /ready for pick ?up|available for pick ?up/i],
  ['problem', /\bexception\b|unable to deliver|delivery attempt(ed)?\b|return(ed)? to sender|delivery (is )?delayed|package (is )?delayed/i],
  ['transit', /in transit|on (its|the) way|arriving|departed|arrived at|coming to you|package coming|inbound package/i],
  ['ordered', /thanks for your order|order (is )?(confirmed|received)|currently processing|received your order|order confirmation/i],
  ['shipped', /\bshipped\b|ship notification|shipping confirmation|label created|has shipped|shipment/i],
];

const LHP_MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/** Pushes packages found in recent mail; returns a short note for the sync log. */
function lhPushPackages_(key) {
  const threads = GmailApp.search(LHP_QUERY, 0, 60);
  const cutoff = Date.now() - 21 * 864e5;
  const msgs = [];
  threads.forEach(function (t) {
    t.getMessages().forEach(function (m) { if (m.getDate().getTime() >= cutoff) msgs.push(m); });
  });
  msgs.sort(function (a, b) { return a.getDate() - b.getDate(); });

  const best = {}; // tracking or "order:<n>" → update
  msgs.forEach(function (m) {
    lhpParseMessage_(m).forEach(function (u) {
      const k = u.tracking || 'order:' + u.order;
      const cur = best[k];
      // Later mail wins unless it would move the status backward.
      if (!cur || lhpRank_(u.status) >= lhpRank_(cur.status)) {
        best[k] = Object.assign({}, cur || {}, u, { eta: u.eta || (cur && cur.eta) });
      }
    });
  });
  const updates = Object.keys(best).map(function (k) { return best[k]; });
  if (!updates.length) return 'packages: none in mail';

  // Skip the POST when nothing changed since the last send (but resend at least hourly).
  const props = PropertiesService.getScriptProperties();
  const sig = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, JSON.stringify(updates)));
  const lastSig = props.getProperty('LHP_LAST_SIG') || '';
  const lastAt = Number(props.getProperty('LHP_LAST_AT') || 0);
  if (sig === lastSig && Date.now() - lastAt < 60 * 60 * 1000) return 'packages: ' + updates.length + ' unchanged';

  const res = UrlFetchApp.fetch(LIFE_HUB_PACKAGES_URL, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'X-Mail-Key': key },
    payload: JSON.stringify({ updates: updates }),
    muteHttpExceptions: true,
  });
  let reply = {};
  try { reply = JSON.parse(res.getContentText()); } catch (e) { reply = {}; }
  if (res.getResponseCode() === 200 && reply.ok) {
    props.setProperty('LHP_LAST_SIG', sig);
    props.setProperty('LHP_LAST_AT', String(Date.now()));
  }
  return 'packages HTTP ' + res.getResponseCode() + ' · ' + updates.length + ' found · ' +
    ((reply.changed || []).length) + ' changed · ' + (reply.unmatched || 0) + ' unmatched';
}

function lhpRank_(s) {
  return { ordered: 0, tosend: 0, shipped: 1, transit: 2, problem: 2, out: 3, pickup: 3, delivered: 4 }[s] || 0;
}

/** Every tracking number (and order number) in one message, with status / ETA read around it. */
function lhpParseMessage_(m) {
  const subject = m.getSubject() || '';
  const from = (m.getFrom() || '').toLowerCase();
  let body = '';
  try { body = m.getPlainBody() || ''; } catch (e) { body = ''; }
  body = body.replace(/<[^>]+>/g, ' ').replace(/[ \t ͏‌]+/g, ' ');
  if (body.length > 60000) body = body.slice(0, 60000);
  const text = subject + '\n' + body;
  const eventAt = m.getDate().toISOString();
  const subjStatus = lhpStatus_(subject);
  const out = [];
  const seen = {};

  lhpFindTracking_(text, from).forEach(function (hit) {
    if (seen[hit.tracking]) return;
    seen[hit.tracking] = true;
    const win = text.slice(Math.max(0, hit.index - 400), hit.index + 400);
    const status = subjStatus || lhpStatus_(win) || 'shipped';
    out.push(lhpClean_({
      tracking: hit.tracking,
      carrier: hit.carrier,
      status: status,
      eta: status === 'delivered' ? eventAt.slice(0, 10) : lhpEta_(win) || lhpEta_(subject + '\n' + body.slice(0, 3000)),
      last: subject.slice(0, 140),
      eventAt: eventAt,
      subject: subject.slice(0, 140),
      order: lhpOrder_(text),
    }));
  });

  // Store mail with an order number but no tracking yet (e.g. "Your order has shipped").
  if (!out.length) {
    const order = lhpOrder_(text);
    const st = subjStatus || lhpStatus_(body.slice(0, 3000));
    if (order && st) {
      out.push(lhpClean_({ order: order, status: st, eta: lhpEta_(text.slice(0, 4000)), last: subject.slice(0, 140), eventAt: eventAt, subject: subject.slice(0, 140) }));
    }
  }
  return out;
}

function lhpClean_(o) {
  Object.keys(o).forEach(function (k) { if (o[k] === undefined || o[k] === '') delete o[k]; });
  return o;
}

function lhpStatus_(s) {
  for (let i = 0; i < LHP_STATUS.length; i++) if (LHP_STATUS[i][1].test(s)) return LHP_STATUS[i][0];
  return '';
}

function lhpFindTracking_(text, from) {
  const hits = [];
  const add = function (re, carrier, check) {
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(text))) {
      const n = m[0].replace(/\s/g, '').toUpperCase();
      if (!check || check(n, m.index)) hits.push({ tracking: n, carrier: carrier, index: m.index });
    }
  };
  // UPS: 1Z + 16, sometimes shown in groups.
  add(/\b1Z(?: ?[0-9A-Z]){16}\b/gi, 'UPS');
  // USPS: 22 digits starting 92–95 (also 26-digit 92/93 forms), often spaced in fours.
  add(/\b9[2-5]\d{2}(?: ?\d{4}){4} ?\d{2}(?: ?\d{4})?\b/g, 'USPS', function (n) { return n.length === 22 || n.length === 26; });
  // SpeedX (Vinted / Temu labels).
  add(/\bSPX[A-Z]{0,6}\d{10,16}\b/gi, 'SpeedX');
  // FedEx: 12 / 15 / 20 digits, only when FedEx is named nearby.
  if (/fedex/i.test(text) || from.indexOf('fedex') >= 0) {
    add(/\b(\d{20}|\d{15}|\d{12})\b/g, 'FedEx', function (n, i) {
      if (/^9[2-5]/.test(n) && n.length === 20) return false;
      return /fedex|tracking/i.test(text.slice(Math.max(0, i - 120), i + 40));
    });
  }
  return hits;
}

function lhpOrder_(text) {
  const m = /order\s*(?:#|number|no\.?)\s*:?\s*#?\s*([A-Z0-9][A-Z0-9-]{4,24})/i.exec(text);
  return m ? m[1] : undefined;
}

/** First delivery-ish date in the text → YYYY-MM-DD. */
function lhpEta_(s) {
  if (!s) return undefined;
  const near = /(estimated|expected|scheduled|arriv|deliver(y|ed)? (by|on|date)|delivery date|get it by|by)[^\n]{0,60}/gi;
  let m;
  while ((m = near.exec(s))) {
    const d = lhpDate_(m[0]);
    if (d) return d;
  }
  return undefined;
}

function lhpDate_(s) {
  const now = new Date();
  let y, mo, d;
  let m = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/.exec(s);
  if (m) {
    mo = +m[1]; d = +m[2]; y = m[3] ? (+m[3] < 100 ? 2000 + +m[3] : +m[3]) : 0;
  } else {
    m = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?/i.exec(s) ||
      /\b(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*(?:\s+(\d{4}))?/i.exec(s);
    if (!m) return undefined;
    if (/^\d/.test(m[1])) { d = +m[1]; mo = LHP_MONTHS[m[2].slice(0, 3).toLowerCase()]; }
    else { mo = LHP_MONTHS[m[1].slice(0, 3).toLowerCase()]; d = +m[2]; }
    y = m[3] ? +m[3] : 0;
  }
  if (!mo || mo > 12 || !d || d > 31) return undefined;
  if (!y) {
    y = now.getFullYear();
    if (mo < now.getMonth() + 1 - 6) y++; // "Jan 3" seen in December
  }
  return y + '-' + ('0' + mo).slice(-2) + '-' + ('0' + d).slice(-2);
}

/** Run by hand in the editor to see what the parser finds (nothing is sent). */
function testLifeHubPackages() {
  const threads = GmailApp.search(LHP_QUERY, 0, 60);
  threads.forEach(function (t) {
    t.getMessages().forEach(function (m) {
      const u = lhpParseMessage_(m);
      if (u.length) Logger.log(m.getSubject() + ' → ' + JSON.stringify(u));
    });
  });
}
