/**
 * Life Hub Mail Sync — sends Randy's starred Gmail threads to Life Hub every 10 minutes,
 * and unstars threads he marked Done on Life Hub.
 *
 * Also sends the Radall Finances "Task List" tab on the same 10-minute run,
 * and tracking status from shipping email (LifeHubPackages.js) for Dashboard › Packages.
 *
 * One-time setup: select setupLifeHubMail and press Run, then approve.
 * (Radall added later: run setupLifeHubRadall once to approve reading the Sheet.)
 */

const LIFE_HUB_GMAIL_URL = 'https://frontier-work-room.randymcfarland1227.workers.dev/api/gmail/snapshot';
const MAX_THREADS = 60;
const LIFE_HUB_RADALL_URL = 'https://frontier-work-room.randymcfarland1227.workers.dev/api/radall/snapshot';
const RADALL_SHEET_ID = '19rw8MAYTZ70Qy2GFAi0DaCGdsp7hQc67l8nkvw17jQk';
const RADALL_TAB = 'Task List';

function setupLifeHubMail() {
  PropertiesService.getScriptProperties().setProperty('LIFEHUB_MAIL_KEY', '3348860742a0880bdf5375fd3f2e9a0ba96a5e7f6cfa5069');
  // One 10-minute trigger (replace any earlier one).
  ScriptApp.getProjectTriggers()
    .filter(function (t) { return t.getHandlerFunction() === 'syncStarredMail'; })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('syncStarredMail').timeBased().everyMinutes(10).create();
  Logger.log('Life Hub mail sync result: ' + syncStarredMail());
}

function syncStarredMail() {
  const key = PropertiesService.getScriptProperties().getProperty('LIFEHUB_MAIL_KEY');
  if (!key) return 'no key stored — run setupLifeHubMail';
  const threads = GmailApp.search('is:starred', 0, MAX_THREADS);
  let unread = 0;
  const items = threads.map(function (thread) {
    const messages = thread.getMessages();
    const last = messages[messages.length - 1];
    if (thread.isUnread()) unread += 1;
    const body = (last.getPlainBody() || '').replace(/\s+/g, ' ').trim().slice(0, 180);
    return {
      id: thread.getId(),
      title: thread.getFirstMessageSubject() || '(no subject)',
      detail: body,
      from: last.getFrom(),
      unread: thread.isUnread(),
      originUrl: 'https://mail.google.com/mail/u/0/#all/' + thread.getId(),
    };
  });
  const snapshot = {
    source: 'gmail',
    metrics: { starred: items.length, unread: unread, action: items.length },
    featured: items.slice(0, 12).map(function (m) {
      return { id: m.id, title: m.title, detail: m.detail, meta: 'From ' + m.from, originUrl: m.originUrl, completable: true };
    }),
    tasks: items.map(function (m) {
      return { id: m.id, title: m.title, detail: m.detail, status: 'open', starred: true, originUrl: m.originUrl, kind: 'mail' };
    }),
    refreshedAt: new Date().toISOString(),
  };
  const res = UrlFetchApp.fetch(LIFE_HUB_GMAIL_URL, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'X-Mail-Key': key },
    payload: JSON.stringify(snapshot),
    muteHttpExceptions: true,
  });
  const text = res.getContentText();
  // Unstar threads marked Done on Life Hub.
  let unstarred = 0;
  try {
    (JSON.parse(text).unstar || []).forEach(function (id) {
      try {
        const thread = GmailApp.getThreadById(id);
        if (!thread) return;
        thread.getMessages().forEach(function (m) { if (m.isStarred()) m.unstar(); });
        unstarred += 1;
      } catch (e) {
        // Thread gone — skip.
      }
    });
  } catch (e) {
    // Malformed reply — ignore.
  }
  let radall = '';
  try {
    radall = ' · ' + syncRadallTasks(key);
  } catch (e) {
    radall = ' · Radall not sent (' + e + ')';
  }
  // Money tabs (LifeHubMoney.js) for the Money page + money calendar.
  let moneyNote = '';
  try {
    moneyNote = ' · ' + lhPushMoney_(key);
  } catch (e) {
    moneyNote = ' · money not sent (' + e + ')';
  }
  // Calendar + Bills (LifeHubSchedule.js) ride along on this trigger.
  let schedule = '';
  try {
    lhEnsureBillsTab_(SpreadsheetApp.openById(LH_SCHEDULE.FINANCE_SHEET_ID));
    const sent = pushLifeHubSchedule();
    schedule = ' · schedule ' + sent.events + ' events, ' + sent.bills + ' bills';
  } catch (e) {
    schedule = ' · schedule not sent (' + e + ')';
  }
  // Shipping email → Dashboard › Packages (LifeHubPackages.js).
  let pkgNote = '';
  try {
    pkgNote = ' · ' + lhPushPackages_(key);
  } catch (e) {
    pkgNote = ' · packages not sent (' + e + ')';
  }
  return 'HTTP ' + res.getResponseCode() + ' · ' + items.length + ' starred sent · ' + unstarred + ' unstarred' + radall + schedule + moneyNote + pkgNote;
}

/** Run once after this was added, to approve reading the Radall Sheet. */
function setupLifeHubRadall() {
  const key = PropertiesService.getScriptProperties().getProperty('LIFEHUB_MAIL_KEY');
  Logger.log('Life Hub Radall result: ' + (key ? syncRadallTasks(key) : 'no key stored — run setupLifeHubMail'));
}

/** Rows under the "Task" header on the Task List tab → Life Hub tasks. */
function syncRadallTasks(key) {
  const sheet = SpreadsheetApp.openById(RADALL_SHEET_ID).getSheetByName(RADALL_TAB);
  if (!sheet) return 'no "' + RADALL_TAB + '" tab';
  const range = sheet.getDataRange();
  const shown = range.getDisplayValues();
  const raw = range.getValues();
  const header = shown.findIndex(function (r) { return String(r[0]).trim().toLowerCase() === 'task'; });
  if (header < 0) return 'no "Task" header row';
  const cols = shown[header].map(function (h) { return String(h).trim().toLowerCase(); });
  const col = function (name) { return cols.indexOf(name); };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const weekOut = new Date(today.getTime() + 7 * 86400000);
  const tasks = [];
  let dueSoon = 0;
  for (let i = header + 1; i < shown.length; i++) {
    const title = String(shown[i][0] || '').trim();
    if (!title) continue;
    const get = function (name) { const c = col(name); return c >= 0 ? String(shown[i][c] || '').trim() : ''; };
    const dueCol = col('due date');
    const dueRaw = dueCol >= 0 ? raw[i][dueCol] : '';
    let due = '';
    if (dueRaw instanceof Date && !isNaN(dueRaw)) {
      due = Utilities.formatDate(dueRaw, Session.getScriptTimeZone(), 'yyyy-MM-dd');
      if (dueRaw <= weekOut) dueSoon += 1;
    }
    const detail = [get('type'), get('note'), get('amount'), !due && get('due date') ? 'Due ' + get('due date') : '']
      .filter(Boolean)
      .join(' · ');
    const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, title.toLowerCase());
    const id = 'radall-' + digest.slice(0, 6).map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join('');
    tasks.push({
      id: id,
      title: title,
      detail: detail,
      status: 'open',
      due: due || undefined,
      originUrl: 'https://docs.google.com/spreadsheets/d/' + RADALL_SHEET_ID + '/edit#gid=' + sheet.getSheetId(),
    });
  }
  const snapshot = {
    source: 'radall',
    metrics: { open: tasks.length, dueSoon: dueSoon, done: 0 },
    featured: [],
    tasks: tasks,
    refreshedAt: new Date().toISOString(),
  };
  const res = UrlFetchApp.fetch(LIFE_HUB_RADALL_URL, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'X-Mail-Key': key },
    payload: JSON.stringify(snapshot),
    muteHttpExceptions: true,
  });
  return 'Radall HTTP ' + res.getResponseCode() + ' · ' + tasks.length + ' tasks';
}

/**
 * Life Hub's Refresh button (through the Worker's /api/sync/now) runs the same sync on demand.
 * Deployed as a web app that runs as Randy; the body must carry the Worker key.
 */
function doPost(e) {
  const out = function (o) {
    return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
  };
  const key = PropertiesService.getScriptProperties().getProperty('LIFEHUB_MAIL_KEY');
  let body = {};
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}') || {};
  } catch (err) {
    body = {};
  }
  const sent = body.key || '';
  if (!key || sent !== key) return out({ ok: false, error: 'wrong_key' });
  if (body.action === 'readRadall') return out({ ok: true, sheets: readRadallAll_() });
  if (body.action === 'moneySnapshot') return out({ ok: true, snapshot: lhMoneySnapshot_() });
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return out({ ok: false, error: 'busy', result: 'already syncing' });
  try {
    if (body.action === 'moneyEdit') return out(lhMoneyEdit_(body.edits));
    return out({ ok: true, result: syncStarredMail() });
  } finally {
    lock.releaseLock();
  }
}

/** Read-only: every tab of the Radall sheet as shown (values, crossed-out cells, merges, notes). */
function readRadallAll_() {
  return SpreadsheetApp.openById(RADALL_SHEET_ID).getSheets().map(function (sh) {
    const rows = sh.getLastRow();
    const cols = sh.getLastColumn();
    if (!rows || !cols) return { name: sh.getName(), values: [] };
    const range = sh.getRange(1, 1, rows, cols);
    const lines = range.getFontLines();
    const struck = [];
    lines.forEach(function (r, i) {
      r.forEach(function (l, j) { if (l === 'line-through') struck.push([i, j]); });
    });
    const notes = [];
    range.getNotes().forEach(function (r, i) {
      r.forEach(function (n, j) { if (n) notes.push([i, j, n]); });
    });
    return {
      name: sh.getName(),
      values: range.getDisplayValues(),
      formulas: range.getFormulas(),
      struck: struck,
      notes: notes,
      merges: range.getMergedRanges().map(function (m) { return m.getA1Notation(); }),
    };
  });
}
