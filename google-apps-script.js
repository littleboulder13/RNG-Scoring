/**
 * =============================================================
 * Stilly Run 'N Gun — Google Apps Script
 *
 * Handles:
 *   POST action: 'syncScores'  — appends scores to event sheet
 *   POST action: 'pushEvent'   — saves event config to Events sheet
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

    if (action === 'pushConfig') {
      return _pushConfig(ss, data.config);
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

  if (action === 'pullConfig') {
    return _pullConfig();
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

  // Check for existing sheet (support both old and new name)
  var sheet = ss.getSheetByName('Events') || ss.getSheetByName('_Events');
  if (!sheet) {
    sheet = ss.insertSheet('Events');
    var headers = ['EventID', 'Name', 'Stages', 'Competitors', 'Updated'];
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
  var sheet = ss.getSheetByName('Events') || ss.getSheetByName('_Events');

  if (!sheet || sheet.getLastRow() < 2) {
    return _jsonResponse({ events: [] });
  }

  var numCols = sheet.getLastColumn();
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, numCols).getValues();

  // Read headers to find column positions
  var headers = sheet.getRange(1, 1, 1, numCols).getValues()[0];
  var colIdx = {};
  for (var c = 0; c < headers.length; c++) {
    colIdx[String(headers[c]).toLowerCase().replace(/\s+/g, '')] = c;
  }

  var events = data.map(function(row) {
    var idCol   = colIdx['eventid'] !== undefined ? colIdx['eventid'] : 0;
    var nameCol = colIdx['name'] !== undefined ? colIdx['name'] : 1;
    // Stages/Competitors could be at different positions depending on whether Date column exists
    var stagesCol = colIdx['stages'] !== undefined ? colIdx['stages'] : (numCols >= 6 ? 3 : 2);
    var compCol   = colIdx['competitors'] !== undefined ? colIdx['competitors'] : (numCols >= 6 ? 4 : 3);

    return {
      id:          row[idCol],
      name:        row[nameCol],
      stages:      JSON.parse(row[stagesCol] || '[]'),
      competitors: JSON.parse(row[compCol] || '[]')
    };
  });

  return _jsonResponse({ events: events });
}

function _jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* --- Config Storage (_Config sheet) --- */
function _getConfigSheet(ss) {
  var sheet = ss.getSheetByName('_Config');
  if (!sheet) {
    sheet = ss.insertSheet('_Config');
    sheet.getRange(1, 1, 1, 2).setValues([['Key', 'Value']]);
    sheet.getRange(1, 1, 1, 2)
      .setFontWeight('bold')
      .setBackground('#424242')
      .setFontColor('#ffffff');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function _getConfig(ss, key) {
  var sheet = _getConfigSheet(ss);
  if (sheet.getLastRow() < 2) return null;
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
  for (var i = 0; i < data.length; i++) {
    if (data[i][0] === key) return data[i][1];
  }
  return null;
}

function _setConfig(ss, key, value) {
  var sheet = _getConfigSheet(ss);
  if (sheet.getLastRow() >= 2) {
    var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
    for (var i = 0; i < data.length; i++) {
      if (data[i][0] === key) {
        sheet.getRange(i + 2, 2).setValue(value);
        return;
      }
    }
  }
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, 2).setValues([[key, value]]);
}

function _pushConfig(ss, config) {
  if (!config) return _jsonResponse({ success: false, error: 'No config data' });
  if (config.syncUrl) _setConfig(ss, 'syncUrl', config.syncUrl);
  return _jsonResponse({ success: true });
}

function _pullConfig() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var syncUrl = _getConfig(ss, 'syncUrl');
  return _jsonResponse({ syncUrl: syncUrl || '' });
}
