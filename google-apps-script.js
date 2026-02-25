/**
 * =============================================================
 * Stilly Run 'N Gun — Google Apps Script
 *
 * Handles:
 *   POST action: 'syncScores'  — appends scores to event sheet
 *   POST action: 'pushEvent'   — saves event config to _Events sheet
 *   GET  action: 'pullEvents'  — returns all events as JSON
 *
 * SETUP: Deploy → Web app → Execute as Me → Anyone → Deploy
 * =============================================================
 */

function doPost(e) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var data = JSON.parse(e.postData.contents);
    var action = data.action || 'syncScores';

    if (action === 'pushEvent') {
      return _pushEvent(ss, data.event);
    }

    // Default: syncScores
    return _syncScores(ss, data);

  } catch (err) {
    return _jsonResponse({ success: false, error: err.message });
  }
}

function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || 'status';

  if (action === 'pullEvents') {
    return _pullEvents();
  }

  return _jsonResponse({ status: 'ok', message: 'Stilly RNG sync endpoint is running' });
}

/* --- Score Sync --- */
function _syncScores(ss, data) {
  var scores = Array.isArray(data.scores) ? data.scores : [];
  var eventName = data.eventName || 'Unknown Event';

  if (!scores.length) {
    return _jsonResponse({ success: false, error: 'No scores provided' });
  }

  var sheet = ss.getSheetByName(eventName);
  if (!sheet) {
    sheet = ss.insertSheet(eventName);
    var headers = [
      'Shooter', 'Division', 'Stage', 'Time', 'Wait Time',
      'Targets Not Neutralized', 'DNF', 'Notes', 'Recorded At', 'Synced At'
    ];
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length)
      .setFontWeight('bold')
      .setBackground('#2c5f2d')
      .setFontColor('#ffffff');
    sheet.setFrozenRows(1);
  }

  var syncedAt = new Date().toISOString();
  var rows = scores.map(function(s) {
    var waitMin = Math.floor((s.waitTime || 0) / 60);
    var waitSec = (s.waitTime || 0) % 60;
    var waitStr = waitMin + ':' + ('0' + waitSec).slice(-2);

    return [
      s.playerName || '',
      s.division || '',
      s.stage || '',
      s.dnf ? 'DNF' : (s.time || 0),
      waitStr,
      s.targetsNotNeutralized || 0,
      s.dnf ? 'Yes' : 'No',
      s.notes || '',
      s.timestamp || '',
      syncedAt
    ];
  });

  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length)
    .setValues(rows);

  for (var i = 1; i <= rows[0].length; i++) {
    sheet.autoResizeColumn(i);
  }

  return _jsonResponse({ success: true, count: rows.length });
}

/* --- Push Event Config --- */
function _pushEvent(ss, ev) {
  if (!ev || !ev.id) {
    return _jsonResponse({ success: false, error: 'No event data' });
  }

  var sheet = ss.getSheetByName('_Events');
  if (!sheet) {
    sheet = ss.insertSheet('_Events');
    var headers = ['EventID', 'Name', 'Date', 'Stages', 'Competitors', 'Updated'];
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length)
      .setFontWeight('bold')
      .setBackground('#1565c0')
      .setFontColor('#ffffff');
    sheet.setFrozenRows(1);
  }

  // Find existing row for this event ID
  var dataRange = sheet.getDataRange();
  var values = dataRange.getValues();
  var existingRow = -1;
  for (var r = 1; r < values.length; r++) {
    if (values[r][0] === ev.id) {
      existingRow = r + 1; // 1-indexed
      break;
    }
  }

  var row = [
    ev.id,
    ev.name || '',
    ev.date || '',
    JSON.stringify(ev.stages || []),
    JSON.stringify(ev.competitors || []),
    new Date().toISOString()
  ];

  if (existingRow > 0) {
    sheet.getRange(existingRow, 1, 1, row.length).setValues([row]);
  } else {
    sheet.getRange(sheet.getLastRow() + 1, 1, 1, row.length).setValues([row]);
  }

  for (var i = 1; i <= row.length; i++) {
    sheet.autoResizeColumn(i);
  }

  return _jsonResponse({ success: true, eventId: ev.id });
}

/* --- Pull Events --- */
function _pullEvents() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('_Events');

  if (!sheet || sheet.getLastRow() < 2) {
    return _jsonResponse({ events: [] });
  }

  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 6).getValues();
  var events = data.map(function(row) {
    return {
      id:          row[0],
      name:        row[1],
      date:        row[2],
      stages:      JSON.parse(row[3] || '[]'),
      competitors: JSON.parse(row[4] || '[]')
    };
  });

  return _jsonResponse({ events: events });
}

function _jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
