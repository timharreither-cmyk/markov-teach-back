// =====================================================================
// Google Apps Script: stores study logs in the Google Sheet it is bound to.
// Sheet "events":   one row per event (every chat message, phase change, …)
// Sheet "sessions": one row per participant session, updated in place
// Setup: SETUP.md step 2. Change TOKEN to a long random string and use the
// same value as LOG_TOKEN in the Cloudflare Worker.
// =====================================================================

const TOKEN = 'CHANGE-ME-to-a-long-random-string';

const EVENT_COLS = ['ts', 'pid', 'group', 'sid', 'type', 'phase', 'part', 'role', 'turn', 'move',
  'assessment', 'hint_count', 'covered', 'misconceptions', 'text', 'latency_ms', 'model', 'flag', 'extra'];

function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return out({ ok: false, error: 'bad json' }); }
  if (body.token !== TOKEN) return out({ ok: false, error: 'unauthorized' });

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const evSheet = sheet(ss, 'events', EVENT_COLS);
    const rows = [];
    (body.events || []).forEach(function (ev) {
      if (ev.type === 'summary') {
        upsertSession(ss, JSON.parse(ev.summary || '{}'));
        return;
      }
      const extra = {};
      Object.keys(ev).forEach(function (k) { if (EVENT_COLS.indexOf(k) < 0) extra[k] = ev[k]; });
      rows.push(EVENT_COLS.map(function (c) {
        if (c === 'extra') return Object.keys(extra).length ? JSON.stringify(extra) : '';
        const v = ev[c];
        return v === undefined || v === null ? '' : String(v).slice(0, 45000);
      }));
    });
    if (rows.length) evSheet.getRange(evSheet.getLastRow() + 1, 1, rows.length, EVENT_COLS.length).setValues(rows);
    return out({ ok: true, stored: rows.length });
  } finally {
    lock.releaseLock();
  }
}

function upsertSession(ss, s) {
  if (!s.sid) return;
  const sh = ss.getSheetByName('sessions') || ss.insertSheet('sessions');
  let header = sh.getLastRow() ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0] : [];
  // add any new columns
  const keys = Object.keys(s);
  const missing = keys.filter(function (k) { return header.indexOf(k) < 0; });
  if (missing.length) {
    header = header.concat(missing);
    sh.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  const sidCol = header.indexOf('sid') + 1;
  let row = 0;
  if (sh.getLastRow() > 1) {
    const sids = sh.getRange(2, sidCol, sh.getLastRow() - 1, 1).getValues();
    for (let i = 0; i < sids.length; i++) if (sids[i][0] === s.sid) { row = i + 2; break; }
  }
  if (!row) row = sh.getLastRow() + 1;
  const values = header.map(function (h) { return s[h] === undefined ? '' : s[h]; });
  sh.getRange(row, 1, 1, header.length).setValues([values]);
}

function sheet(ss, name, cols) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function out(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// Run this once from the editor (select "testSetup" → Run) to create the
// sheets and check that everything works.
function testSetup() {
  const fake = { postData: { contents: JSON.stringify({ token: TOKEN, events: [
    { ts: new Date().toISOString(), pid: 'TEST', group: 'ai', sid: 'test-sid', type: 'session_start', phase: 'consent' },
    { type: 'summary', summary: JSON.stringify({ pid: 'TEST', group: 'ai', sid: 'test-sid', phase_now: 'consent' }) }
  ] }) } };
  Logger.log(doPost(fake).getContent());
}
