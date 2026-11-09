/**
 * Life Hub Money — sends the money tabs of the Radall sheet to Life Hub, and applies edits made on
 * Life Hub's Money page back to the sheet.
 *
 * Lives in the "Life Hub Mail Sync" Apps Script project (script id 1xOI9TUs…), next to Code.js:
 *   - syncStarredMail (10-minute trigger + Life Hub's Refresh) calls lhPushMoney_(key).
 *   - doPost routes { action: 'moneyEdit', edits } to lhMoneyEdit_(edits).
 *   - An edit { tab: 'Task List', appendTask: true, title, due, note } adds a Finance task row to the
 *     Task List tab (lhAppendTask_); then the Radall tasks are pushed again right away.
 *
 * The site does the reading (it finds each block by its heading), so this file only ships what
 * the tabs show: display values, which cells are crossed out, which hold formulas, and merges.
 * Edits are guarded: the tab must be on the list, the cell must still show what Life Hub showed
 * (`expect`), and formula cells are never written. Every change is logged on a "Life Hub edits" tab.
 */

var LH_MONEY = {
  WORKER_URL: 'https://frontier-work-room.randymcfarland1227.workers.dev/api/money/snapshot',
  SHEET_ID: '19rw8MAYTZ70Qy2GFAi0DaCGdsp7hQc67l8nkvw17jQk',
  TABS: ['Randy', 'Paylater', 'Restock/Purchases', 'Credit Matrix', 'Non-Credit', '🌟 CC/Savings Planner', 'Move Sav /COG Estimate'],
  LOG_TAB: 'Life Hub edits',
};

/** Everything Life Hub needs from the money tabs, as shown. */
function lhMoneySnapshot_() {
  var ss = SpreadsheetApp.openById(LH_MONEY.SHEET_ID);
  var tabs = {};
  LH_MONEY.TABS.forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (!sh) return;
    var rows = sh.getLastRow();
    var cols = sh.getLastColumn();
    if (!rows || !cols) return;
    var range = sh.getRange(1, 1, rows, cols);
    var v = range.getDisplayValues();
    var struck = [];
    range.getFontLines().forEach(function (r, i) {
      r.forEach(function (l, j) { if (l === 'line-through' && v[i][j] !== '') struck.push([i, j]); });
    });
    var formulas = [];
    range.getFormulas().forEach(function (r, i) {
      r.forEach(function (f, j) { if (f) formulas.push([i, j]); });
    });
    var merges = range.getMergedRanges().map(function (m) {
      return [m.getRow() - 1, m.getColumn() - 1, m.getLastRow() - 1, m.getLastColumn() - 1];
    });
    // Trim empty trailing columns per row to keep the snapshot small.
    var trimmed = v.map(function (r) {
      var end = r.length;
      while (end > 0 && r[end - 1] === '') end--;
      return r.slice(0, end);
    });
    tabs[name] = { gid: sh.getSheetId(), v: trimmed, s: struck, f: formulas, m: merges };
  });
  return {
    source: 'money',
    refreshedAt: new Date().toISOString(),
    sheetUrl: 'https://docs.google.com/spreadsheets/d/' + LH_MONEY.SHEET_ID + '/edit',
    tabs: tabs,
  };
}

/** Send the money snapshot to the Worker (called from syncStarredMail). */
function lhPushMoney_(key) {
  var snap = lhMoneySnapshot_();
  var res = UrlFetchApp.fetch(LH_MONEY.WORKER_URL, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'X-Mail-Key': key },
    payload: JSON.stringify(snap),
    muteHttpExceptions: true,
  });
  return 'money HTTP ' + res.getResponseCode() + ' · ' + Object.keys(snap.tabs).length + ' tabs';
}

/**
 * Apply edits from Life Hub. Each edit is one of:
 *   { tab, r, c, expect, value }        set a cell (0-based row/col) — typed like you typed it
 *   { tab, addRows: true, title, width, moveWidth?, rows }  add rows to the end of a titled block (see lhAddRows_)
 *   { tab, r, c1, c2, expect, strike }  cross out / un-cross a row segment (first cell must match expect)
 *   { tab, r, c1, c2, expect, moveAfter } move a row segment to a new row inserted under row `moveAfter`
 *                                         (e.g. Needed Purchases → Wants); the old row is removed
 * Returns per-edit results and a fresh snapshot.
 */
function lhMoneyEdit_(edits) {
  var ss = SpreadsheetApp.openById(LH_MONEY.SHEET_ID);
  var appended = false;
  var results = (edits || []).slice(0, 20).map(function (e) {
    try {
      if (e && e.appendTask === true) {
        var res = lhAppendTask_(ss, e);
        if (res.ok && !res.existed) appended = true;
        return res;
      }
      if (!e || LH_MONEY.TABS.indexOf(e.tab) < 0) return { ok: false, error: 'tab not allowed' };
      var sh = ss.getSheetByName(e.tab);
      if (!sh) return { ok: false, error: 'no tab' };
      if (e.insertBalancing === true) {
        var lock = LockService.getScriptLock();
        if (!lock.tryLock(5000)) return { ok: false, error: 'busy' };
        try { return lhInsertBalancing_(ss, sh, e); }
        finally { SpreadsheetApp.flush(); lock.releaseLock(); }
      }
      if (e.addRows === true) {
        var lockA = LockService.getScriptLock();
        if (!lockA.tryLock(5000)) return { ok: false, error: 'busy' };
        try { return lhAddRows_(ss, sh, e); }
        finally { SpreadsheetApp.flush(); lockA.releaseLock(); }
      }
      if (e.deleteBalancing === true) {
        var lockD = LockService.getScriptLock();
        if (!lockD.tryLock(5000)) return { ok: false, error: 'busy' };
        try { return lhDeleteBalancing_(ss, sh, e); }
        finally { SpreadsheetApp.flush(); lockD.releaseLock(); }
      }
      var r = Number(e.r) + 1;
      var c = Number(e.c !== undefined ? e.c : e.c1) + 1;
      if (!(r >= 1 && c >= 1)) return { ok: false, error: 'bad cell' };
      var cell = sh.getRange(r, c);
      var now = cell.getDisplayValue();
      if (String(e.expect === undefined ? '' : e.expect) !== now) return { ok: false, error: 'changed', now: now };
      if (e.moveAfter !== undefined) return lhMoveRow_(ss, sh, e, r, c, now);
      if (e.strike !== undefined) {
        var c2 = Number(e.c2) + 1;
        if (!(c2 >= c && c2 - c < 12)) return { ok: false, error: 'bad range' };
        var seg = sh.getRange(r, c, 1, c2 - c + 1);
        seg.setFontLine(e.strike ? 'line-through' : 'none');
        lhMoneyLog_(ss, e.tab, seg.getA1Notation(), now, e.strike ? 'crossed out' : 'un-crossed');
        return { ok: true };
      }
      if (cell.getFormula()) return { ok: false, error: 'formula' };
      var value = String(e.value === undefined ? '' : e.value).slice(0, 200);
      if (/^[=+@]/.test(value)) return { ok: false, error: 'no formulas from Life Hub' };
      cell.setValue(value);
      lhMoneyLog_(ss, e.tab, cell.getA1Notation(), now, cell.getDisplayValue());
      return { ok: true, now: cell.getDisplayValue() };
    } catch (err) {
      return { ok: false, error: String(err).slice(0, 120) };
    }
  });
  SpreadsheetApp.flush();
  var radall;
  if (appended) {
    try {
      radall = syncRadallTasks(PropertiesService.getScriptProperties().getProperty('LIFEHUB_MAIL_KEY'));
    } catch (err) {
      radall = 'Radall not sent (' + String(err).slice(0, 80) + ')';
    }
  }
  return { ok: true, results: results, snapshot: lhMoneySnapshot_(), radall: radall };
}

/**
 * Add one Finance task (Task · Type · Note · Amount · Due Date) to the Task List tab, in the first
 * row after the last task (a row is inserted if that one isn't empty). A task with the same title
 * (ignoring case and spaces) is never added twice. Plain text only; due is YYYY-MM-DD.
 */
function lhAppendTask_(ss, e) {
  var TAB = 'Task List';
  if (e.tab !== TAB) return { ok: false, error: 'tab not allowed' };
  var title = String(e.title || '').trim().slice(0, 200);
  var note = String(e.note || '').trim().slice(0, 300);
  var due = String(e.due || '').trim();
  if (!title) return { ok: false, error: 'no title' };
  if (/^[=+@]/.test(title) || /^[=+@]/.test(note)) return { ok: false, error: 'no formulas from Life Hub' };
  if (due && !/^\d{4}-\d{2}-\d{2}$/.test(due)) return { ok: false, error: 'bad date' };
  var sh = ss.getSheetByName(TAB);
  if (!sh) return { ok: false, error: 'no tab' };
  var shown = sh.getRange(1, 1, Math.max(sh.getLastRow(), 1), 5).getDisplayValues();
  var header = shown.findIndex(function (r) { return String(r[0]).trim().toLowerCase() === 'task'; });
  if (header < 0) return { ok: false, error: 'no "Task" header row' };
  var cols = shown[header].map(function (h) { return String(h).trim().toLowerCase(); });
  var noteCol = cols.indexOf('note');
  var dueCol = cols.indexOf('due date');
  var norm = function (s) { return String(s).toLowerCase().replace(/\s+/g, ' ').trim(); };
  var last = header;
  for (var i = header + 1; i < shown.length; i++) {
    if (norm(shown[i][0]) === norm(title)) return { ok: true, existed: true, row: i + 1 };
    if (shown[i].some(function (v) { return String(v).trim() !== ''; })) last = i;
  }
  var row = last + 2;
  var target = sh.getRange(row, 1, 1, 5);
  if (target.getDisplayValues()[0].some(function (v) { return String(v).trim() !== ''; }) || target.getFormulas()[0].some(Boolean)) {
    sh.insertRowAfter(last + 1);
    target = sh.getRange(row, 1, 1, 5);
  }
  sh.getRange(row, 1).setValue(title);
  if (note && noteCol >= 0) sh.getRange(row, noteCol + 1).setValue(note);
  if (due && dueCol >= 0) {
    var p = due.split('-').map(Number);
    sh.getRange(row, dueCol + 1).setValue(new Date(p[0], p[1] - 1, p[2])).setNumberFormat('M/d/yyyy');
  }
  lhMoneyLog_(ss, TAB, target.getA1Notation(), '', [title, note, due].filter(Boolean).join(' · '));
  return { ok: true, row: row };
}

/** Insert only the Balancing columns; neighboring account/bill blocks stay in place. */
/**
 * Remove one line item from the Balancing and Planning list: only that block's cells move up
 * (other blocks on the same rows stay put). Guarded like the insert: the row must still show what
 * Life Hub showed, sit inside the contiguous list, and hold no formulas; the Cash On Hand /
 * Balanced Cash totals can't be removed. Formulas that sum the list shrink with it.
 */
function lhDeleteBalancing_(ss, sh, e) {
  if (e.tab !== 'Randy') return { ok: false, error: 'tab not allowed' };
  var r = e.r + 1;
  var c = e.startCol + 1;
  if (!Number.isInteger(e.r) || !Number.isInteger(e.startCol) || r < 1 || c < 1 || !Array.isArray(e.expectRow)) return { ok: false, error: 'bad range' };
  var heading = sh.getDataRange().createTextFinder('Balancing and Planning').matchEntireCell(true).findNext();
  if (!heading) return { ok: false, error: 'changed' };
  var merges = heading.getMergedRanges();
  var title = merges.length ? merges[0] : heading;
  var width = title.getNumColumns();
  var first = title.getRow() + 2;
  if (c !== title.getColumn() || width < 2 || width > 12 || e.expectRow.length !== width || r < first || r > sh.getLastRow()) return { ok: false, error: 'bad range' };
  var above = sh.getRange(first, c, r - first + 1, width).getDisplayValues();
  if (above.some(function (row) { return !row[0].trim() || /^(cash on hand|balanced cash)/i.test(row[0].trim()); })) return { ok: false, error: 'changed' };
  var target = sh.getRange(r, c, 1, width);
  var now = target.getDisplayValues()[0];
  if (now.some(function (v, i) { return v.trim() !== String(e.expectRow[i]).trim(); })) return { ok: false, error: 'changed' };
  if (target.getFormulas()[0].some(Boolean) || target.getMergedRanges().length) return { ok: false, error: 'formula' };
  var a1 = target.getA1Notation();
  target.deleteCells(SpreadsheetApp.Dimension.ROWS);
  lhMoneyLog_(ss, e.tab, a1, JSON.stringify(now), 'deleted');
  return { ok: true };
}

function lhInsertBalancing_(ss, sh, e) {
  if (e.tab !== 'Randy') return { ok: false, error: 'tab not allowed' };
  var r = e.r + 1;
  var c = e.startCol + 1;
  if (!Number.isInteger(e.r) || !Number.isInteger(e.startCol) || r < 1 || c < 1 ||
      !Array.isArray(e.values) || !Array.isArray(e.expectRow)) return { ok: false, error: 'bad range' };
  var heading = sh.getDataRange().createTextFinder('Balancing and Planning').matchEntireCell(true).findNext();
  if (!heading) return { ok: false, error: 'changed' };
  var merges = heading.getMergedRanges();
  var title = merges.length ? merges[0] : heading;
  var width = title.getNumColumns();
  var first = title.getRow() + 2;
  if (c !== title.getColumn() || width < 2 || width > 12 || e.values.length !== width || e.expectRow.length !== width || r < first || r > sh.getLastRow()) return { ok: false, error: 'bad range' };
  // The anchor must still belong to the contiguous list, not a later block or a summary.
  var previous = sh.getRange(first, c, r - first + 1, width).getDisplayValues();
  if (previous.slice(0, -1).some(function (row) { return !row[0].trim() || /^(cash on hand|balanced cash)/i.test(row[0].trim()); })) return { ok: false, error: 'changed' };
  var target = sh.getRange(r, c, 1, width);
  var now = target.getDisplayValues()[0];
  if (now.some(function (v, i) { return v.trim() !== String(e.expectRow[i]); }) || /^(cash on hand|balanced cash)/i.test(now[0].trim())) return { ok: false, error: 'changed' };
  if (target.getFormulas()[0].some(Boolean) || target.getMergedRanges().length) return { ok: false, error: 'formula' };
  var values = e.values.map(function (v) { return String(v).trim(); });
  if (!values[0] || values.some(function (v) { return v.length > 200 || /^[=+@]/.test(v); }) ||
      values.slice(1).some(function (v) { return v && !/^-?\d+(\.\d+)?$/.test(v); })) return { ok: false, error: 'bad value' };
  // For an empty or single-item list, insertion is at its first row. Remember local
  // ranges starting there so their first bound includes the newly inserted item.
  var formulas = r === first ? sh.getDataRange().getFormulas() : [];
  var colName = function (n) { var out = ''; for (; n; n = Math.floor((n - 1) / 26)) out = String.fromCharCode(65 + (n - 1) % 26) + out; return out; };
  var columns = Array.from({ length: width }, function (_, i) { return colName(c + i); }).join('|');
  var startRange = new RegExp('(^|[^!A-Za-z0-9_])((?:\\$?(?:' + columns + ')\\$?))' + (r + 1) + '(:\\$?(?:' + columns + ')\\$?\\d+)', 'g');
  target.insertCells(SpreadsheetApp.Dimension.ROWS);
  target = sh.getRange(r, c, 1, width);
  target.setValues([values]).setFontLine('none');
  formulas.forEach(function (row, ri) {
    row.forEach(function (formula, ci) {
      if (!formula) return;
      var shifted = ci + 1 >= c && ci + 1 < c + width && ri + 1 >= r ? ri + 2 : ri + 1;
      var cell = sh.getRange(shifted, ci + 1);
      var after = cell.getFormula();
      var expanded = after.replace(startRange, function (_, prefix, col, end) { return prefix + col + r + end; });
      if (expanded !== after) cell.setFormula(expanded);
    });
  });
  lhMoneyLog_(ss, e.tab, target.getA1Notation(), '', JSON.stringify(values));
  return { ok: true };
}

/**
 * { tab, addRows: true, title, under?, width, moveWidth?, wholeRows?, rows } adds rows to the end of a titled block
 * (title cell, header row, then data — e.g. "Cash Advances" on Randy, "Full Ledger" / "Klarna Sum" on Paylater).
 * The block ends at the first row whose first two cells are blank (a total row counts as the end).
 * If that spot isn't free (a total row, or the next block right under it), only the block's own columns
 * (moveWidth wide) shift down, never whole sheet rows, so blocks to the left/right stay put. The new rows
 * take the format of the row above, and SUM-style ranges that ended on the old last row grow to include them.
 */
function lhAddRows_(ss, sh, e) {
  var title = String(e.title || '').trim();
  var width = Number(e.width);
  var span = Number(e.moveWidth || e.width);
  var rows = e.rows;
  if (!title || !(width >= 2 && width <= 8) || !(span >= width && span <= 12) || !Array.isArray(rows) || !rows.length || rows.length > 12) return { ok: false, error: 'bad range' };
  var clean = [];
  for (var i = 0; i < rows.length; i++) {
    if (!Array.isArray(rows[i]) || rows[i].length !== width) return { ok: false, error: 'bad value' };
    var out = [];
    for (var j = 0; j < width; j++) {
      var v = String(rows[i][j] === undefined || rows[i][j] === null ? '' : rows[i][j]).trim();
      if (v.length > 200 || /^[=+@]/.test(v)) return { ok: false, error: 'bad value' };
      var iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
      out.push(iso ? new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])) : /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v);
    }
    if (out[1] === '' || out[1] === undefined) return { ok: false, error: 'bad value' };
    clean.push(out);
  }
  // Same title elsewhere (e.g. "Klarna Sum" in the Paylater summary): `under` = the text right below the real one.
  var under = String(e.under || '').trim().toLowerCase();
  var at = sh.getDataRange().createTextFinder(title).matchEntireCell(true).findAll().filter(function (cell) {
    return !under || String(cell.offset(1, 0).getDisplayValue()).trim().toLowerCase() === under;
  })[0];
  if (!at) return { ok: false, error: 'no block' };
  var c = at.getColumn();
  var start = at.getRow() + 2;
  var k = clean.length;
  var lastRow = Math.max(sh.getLastRow(), start);
  var look = sh.getRange(start, c, Math.max(Math.min(lastRow - start + 1 + k + 2, sh.getMaxRows() - start + 1), 1), span).getDisplayValues();
  var blank = function (i) { return !look[i] || look[i].every(function (x) { return String(x).trim() === ''; }); };
  var at0 = 0;
  while (at0 < look.length && (String(look[at0][0]).trim() !== '' || String(look[at0][1]).trim() !== '')) at0++;
  var r = start + at0;
  // Room = k free rows plus one spacer row under them.
  var free = true;
  for (var f = 0; f <= k; f++) if (!blank(at0 + f)) free = false;
  if (!free) {
    // Shift this block's columns from r down to the first run of k+1 empty rows (or the end of the sheet).
    var q = at0 + 1;
    while (q < look.length) {
      var ok = true;
      for (var g = 0; g <= k; g++) if (!blank(q + g)) ok = false;
      if (ok) break;
      q++;
    }
    if (e.wholeRows === true) {
      // Whole sheet rows: everything under r moves together, so side-by-side old tables stay lined up.
      sh.insertRowsBefore(r, k);
    } else {
    var height = q - at0;
    var need = r + height + k - 1 - sh.getMaxRows();
    if (need > 0) sh.insertRowsAfter(sh.getMaxRows(), need);
    sh.getRange(r, c, height, span).moveTo(sh.getRange(r + k, c));
    }
  }
  var target = sh.getRange(r, c, k, width);
  if (target.getFormulas().some(function (row) { return row.some(Boolean); })) return { ok: false, error: 'formula' };
  if (r - 1 >= start) sh.getRange(r - 1, c, 1, width).copyTo(target, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
  target.setValues(clean).setFontLine('none');
  // Grow ranges in these columns that ended on the old last row (e.g. =SUM(U4:U6) -> =SUM(U4:U7)).
  var colNum = function (s) { var n = 0; for (var x = 0; x < s.length; x++) n = n * 26 + s.charCodeAt(x) - 64; return n; };
  var re = /(^|[^!A-Za-z0-9_$])(\$?)([A-Z]{1,3})(\$?)(\d+):(\$?)([A-Z]{1,3})(\$?)(\d+)(?![\d(A-Za-z_])/g;
  var data = sh.getDataRange();
  var formulas = data.getFormulas();
  formulas.forEach(function (row, ri) {
    row.forEach(function (formula, ci) {
      if (!formula) return;
      var next = formula.replace(re, function (m, pre, d1, c1, d2, r1, d3, c2, d4, r2) {
        var a = colNum(c1), b = colNum(c2);
        if (Number(r2) !== r - 1 || Number(r1) < start - 1 || a < c || b > c + span - 1) return m;
        return pre + d1 + c1 + d2 + r1 + ':' + d3 + c2 + d4 + (r + k - 1);
      });
      if (next !== formula) sh.getRange(ri + 1, ci + 1).setFormula(next);
    });
  });
  lhMoneyLog_(ss, e.tab, target.getA1Notation(), '', 'added ' + JSON.stringify(rows));
  return { ok: true, row: r - 1 };
}

/** One row per change on the "Life Hub edits" tab, so anything can be undone by hand. */
function lhMoneyLog_(ss, tab, a1, before, after) {
  var log = ss.getSheetByName(LH_MONEY.LOG_TAB);
  if (!log) {
    log = ss.insertSheet(LH_MONEY.LOG_TAB);
    log.getRange(1, 1, 1, 5).setValues([['When', 'Tab', 'Cell', 'Before', 'After']]).setFontWeight('bold');
    log.setFrozenRows(1);
  }
  log.appendRow([new Date(), tab, a1, "'" + before, "'" + after]);
}

/**
 * Move one item (row segment c1..c2) to a fresh row inserted right under `moveAfter` — the last row
 * of the list it's going to — so both lists stay together with their blank separators. The old row
 * is deleted when nothing else sits on it; otherwise only its segment is cleared.
 */
function lhMoveRow_(ss, sh, e, r, c, now) {
  var c2 = Number(e.c2) + 1;
  var after = Number(e.moveAfter) + 1;
  if (!(c2 >= c && c2 - c < 12 && after >= 1 && after <= sh.getMaxRows())) return { ok: false, error: 'bad range' };
  if (after === r) return { ok: false, error: 'same place' };
  var width = c2 - c + 1;
  sh.insertRowAfter(after);
  var target = after + 1;
  var from = r > after ? r + 1 : r; // the insert pushed the source down if it was below
  sh.getRange(from, c, 1, width).copyTo(sh.getRange(target, c, 1, width));
  var lastCol = sh.getLastColumn();
  var row = sh.getRange(from, 1, 1, lastCol).getValues()[0];
  var elsewhere = row.some(function (v, i) { return (i + 1 < c || i + 1 > c2) && v !== '' && v !== null; });
  if (elsewhere) sh.getRange(from, c, 1, width).clear();
  else sh.deleteRow(from);
  lhMoneyLog_(ss, e.tab, 'row ' + r + ' → under row ' + after, now, 'moved');
  return { ok: true };
}
