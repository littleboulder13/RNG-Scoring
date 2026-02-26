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
    // Check URL query parameter first (reliable even if body is garbled)
    var paramAction = (e && e.parameter && e.parameter.action) || '';
    if (paramAction === 'pullEvents') return _pullEvents();
    if (paramAction === 'pullConfig') return _pullConfig();
    if (paramAction === 'pullArchivedEvents') return _pullArchivedEvents();

    // Parse body for actions that need data
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var data = JSON.parse(e.postData.contents);
    var action = data.action || 'syncScores';

    if (action === 'pushEvent') return _pushEvent(ss, data.event);
    if (action === 'pushConfig') return _pushConfig(ss, data.config);
    if (action === 'pullEvents') return _pullEvents();
    if (action === 'pullConfig') return _pullConfig();
    if (action === 'archiveEvent') return _archiveEvent(ss, data.eventId);
    if (action === 'restoreEvent') return _restoreEvent(ss, data.eventId);
    if (action === 'permanentlyDeleteEvent') return _permanentlyDeleteEvent(ss, data.eventId, data.eventName, data.stages);

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

  if (action === 'pullArchivedEvents') {
    return _pullArchivedEvents();
  }

  return _jsonResponse({ status: 'ok', message: 'Stilly RNG sync endpoint is running' });
}

/* --- Score Sync (one tab per stage, all competitors listed) --- */
function _syncScores(ss, data) {
  var scores = Array.isArray(data.scores) ? data.scores : [];
  var eventName = data.eventName || 'Unknown Event';
  var competitors = Array.isArray(data.competitors) ? data.competitors : [];
  var stages = Array.isArray(data.stages) ? data.stages : [];

  if (!scores.length) {
    return _jsonResponse({ success: false, error: 'No scores provided' });
  }

  var headers = ['#', 'Shooter', 'Division', 'Time (s)', 'Wait Time (m:ss)',
                 'Targets Not Neutralized', 'Notes'];

  // Helper: format wait time
  function fmtWait(totalSec) {
    var m = Math.floor((totalSec || 0) / 60);
    var s = (totalSec || 0) % 60;
    return m + ':' + ('0' + s).slice(-2);
  }

  // Group scores by stage name
  var scoresByStage = {};
  for (var i = 0; i < scores.length; i++) {
    var stageName = scores[i].stage || 'Unknown Stage';
    if (!scoresByStage[stageName]) scoresByStage[stageName] = [];
    scoresByStage[stageName].push(scores[i]);
  }

  // Collect all stage names we need tabs for (event stages + any in scores)
  var stageNames = [];
  var stageSet = {};
  for (var si = 0; si < stages.length; si++) {
    var sn = stages[si].name || stages[si];
    if (!stageSet[sn]) { stageNames.push(sn); stageSet[sn] = true; }
  }
  for (var key in scoresByStage) {
    if (!stageSet[key]) { stageNames.push(key); stageSet[key] = true; }
  }

  var totalSynced = 0;

  for (var si2 = 0; si2 < stageNames.length; si2++) {
    var stage = stageNames[si2];
    var tabName = (eventName + ' - ' + stage).substring(0, 100);

    var sheet = ss.getSheetByName(tabName);
    var isNew = false;
    if (!sheet) {
      sheet = ss.insertSheet(tabName);
      isNew = true;
    }

    // Build score lookup: playerName → score (first occurrence wins)
    var stageScores = scoresByStage[stage] || [];

    // Read existing scores already in the sheet (rows 2+)
    var existingMap = {};
    if (!isNew && sheet.getLastRow() >= 2) {
      var existData = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();
      for (var ex = 0; ex < existData.length; ex++) {
        var exName = String(existData[ex][1]).trim();
        if (exName && existData[ex][3] !== '') {
          existingMap[exName] = {
            time: existData[ex][3],
            waitTime: existData[ex][4],
            tnt: existData[ex][5],
            notes: existData[ex][6]
          };
        }
      }
    }

    // Merge new scores into lookup (new scores overwrite)
    var scoreMap = {};
    // Start with existing
    for (var ek in existingMap) { scoreMap[ek] = existingMap[ek]; }
    // Overlay new scores
    for (var ns = 0; ns < stageScores.length; ns++) {
      var sc = stageScores[ns];
      var pn = sc.playerName || '';
      if (pn) {
        scoreMap[pn] = {
          time: sc.dnf ? 'DNF' : (sc.time || 0),
          waitTime: fmtWait(sc.waitTime),
          tnt: sc.targetsNotNeutralized || 0,
          notes: sc.notes || ''
        };
      }
    }

    // Build full competitor list (event competitors + anyone with scores)
    var compList = [];
    var compSet = {};
    for (var ci = 0; ci < competitors.length; ci++) {
      var cn = competitors[ci].name || '';
      if (cn && !compSet[cn]) {
        compList.push({ name: cn, division: competitors[ci].division || '' });
        compSet[cn] = true;
      }
    }
    // Add any scored players not in the competitor list
    for (var sp in scoreMap) {
      if (!compSet[sp]) {
        compList.push({ name: sp, division: '' });
        compSet[sp] = true;
      }
    }

    // Build rows
    var rows = [];
    for (var ri = 0; ri < compList.length; ri++) {
      var comp = compList[ri];
      var s = scoreMap[comp.name];
      if (s) {
        rows.push([ri + 1, comp.name, comp.division, s.time, s.waitTime, s.tnt, s.notes]);
      } else {
        rows.push([ri + 1, comp.name, comp.division, '', '', '', '']);
      }
    }

    // Write the sheet (clear and rewrite to keep it clean)
    sheet.clear();
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length)
      .setFontWeight('bold')
      .setBackground('#2c5f2d')
      .setFontColor('#ffffff');
    sheet.setFrozenRows(1);

    if (rows.length) {
      sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
    }

    for (var col = 1; col <= headers.length; col++) {
      sheet.autoResizeColumn(col);
    }

    totalSynced += stageScores.length;
  }

  return _jsonResponse({ success: true, count: totalSynced });
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
    var headers = ['EventID', 'Name', 'Stages', 'Competitors', 'Updated', 'Password'];
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length)
      .setFontWeight('bold')
      .setBackground('#1565c0')
      .setFontColor('#ffffff');
    sheet.setFrozenRows(1);
  }

  // Always ensure headers are correct (fixes column drift)
  var correctHeaders = ['EventID', 'Name', 'Stages', 'Competitors', 'Updated', 'Password'];
  sheet.getRange(1, 1, 1, correctHeaders.length).setValues([correctHeaders]);

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
    new Date().toISOString(),
    ev.password || ''
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

  // Safe JSON parse helper — returns fallback if value isn't valid JSON
  function safeParse(val, fallback) {
    if (!val || typeof val !== 'string') return fallback;
    try { return JSON.parse(val); }
    catch (_) { return fallback; }
  }

  var events = data.map(function(row) {
    var idCol   = colIdx['eventid'] !== undefined ? colIdx['eventid'] : 0;
    var nameCol = colIdx['name'] !== undefined ? colIdx['name'] : 1;
    // Stages/Competitors could be at different positions depending on whether Date column exists
    var stagesCol = colIdx['stages'] !== undefined ? colIdx['stages'] : (numCols >= 6 ? 3 : 2);
    var compCol   = colIdx['competitors'] !== undefined ? colIdx['competitors'] : (numCols >= 6 ? 4 : 3);

    var pwCol = colIdx['password'] !== undefined ? colIdx['password'] : 5;
    return {
      id:          row[idCol],
      name:        row[nameCol],
      stages:      safeParse(row[stagesCol], []),
      competitors: safeParse(row[compCol], []),
      password:    row[pwCol] || ''
    };
  });

  return _jsonResponse({ events: events });
}

/* --- Archive Event (move from Events → ArchivedEvents) --- */
function _archiveEvent(ss, eventId) {
  if (!eventId) return _jsonResponse({ success: false, error: 'No eventId' });

  var sheet = ss.getSheetByName('Events') || ss.getSheetByName('_Events');
  if (!sheet || sheet.getLastRow() < 2) {
    return _jsonResponse({ success: false, error: 'Events sheet not found or empty' });
  }

  var values = sheet.getDataRange().getValues();
  var rowIndex = -1;
  var rowData = null;
  for (var r = 1; r < values.length; r++) {
    if (values[r][0] === eventId) {
      rowIndex = r + 1;
      rowData = values[r];
      break;
    }
  }
  if (rowIndex === -1) return _jsonResponse({ success: false, error: 'Event not found' });

  var archiveSheet = ss.getSheetByName('ArchivedEvents');
  if (!archiveSheet) {
    archiveSheet = ss.insertSheet('ArchivedEvents');
    var headers = ['EventID', 'Name', 'Stages', 'Competitors', 'Updated', 'Password', 'ArchivedAt'];
    archiveSheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    archiveSheet.getRange(1, 1, 1, headers.length)
      .setFontWeight('bold')
      .setBackground('#795548')
      .setFontColor('#ffffff');
    archiveSheet.setFrozenRows(1);
  }

  var archiveRow = rowData.slice(0, 6);
  archiveRow.push(new Date().toISOString());
  archiveSheet.getRange(archiveSheet.getLastRow() + 1, 1, 1, archiveRow.length).setValues([archiveRow]);
  sheet.deleteRow(rowIndex);

  return _jsonResponse({ success: true, eventId: eventId });
}

/* --- Restore Event (move from ArchivedEvents → Events) --- */
function _restoreEvent(ss, eventId) {
  if (!eventId) return _jsonResponse({ success: false, error: 'No eventId' });

  var archiveSheet = ss.getSheetByName('ArchivedEvents');
  if (!archiveSheet || archiveSheet.getLastRow() < 2) {
    return _jsonResponse({ success: false, error: 'ArchivedEvents sheet not found or empty' });
  }

  var values = archiveSheet.getDataRange().getValues();
  var rowIndex = -1;
  var rowData = null;
  for (var r = 1; r < values.length; r++) {
    if (values[r][0] === eventId) {
      rowIndex = r + 1;
      rowData = values[r];
      break;
    }
  }
  if (rowIndex === -1) return _jsonResponse({ success: false, error: 'Archived event not found' });

  var sheet = ss.getSheetByName('Events') || ss.getSheetByName('_Events');
  if (!sheet) {
    sheet = ss.insertSheet('Events');
    var headers = ['EventID', 'Name', 'Stages', 'Competitors', 'Updated', 'Password'];
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length)
      .setFontWeight('bold')
      .setBackground('#1565c0')
      .setFontColor('#ffffff');
    sheet.setFrozenRows(1);
  }

  var restoreRow = rowData.slice(0, 6);
  restoreRow[4] = new Date().toISOString();
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, restoreRow.length).setValues([restoreRow]);
  archiveSheet.deleteRow(rowIndex);

  return _jsonResponse({ success: true, eventId: eventId });
}

/* --- Permanently Delete Archived Event --- */
function _permanentlyDeleteEvent(ss, eventId, eventName, stageNames) {
  if (!eventId) return _jsonResponse({ success: false, error: 'No eventId' });

  var archiveSheet = ss.getSheetByName('ArchivedEvents');
  if (!archiveSheet || archiveSheet.getLastRow() < 2) {
    return _jsonResponse({ success: false, error: 'ArchivedEvents sheet not found or empty' });
  }

  var values = archiveSheet.getDataRange().getValues();
  var rowToDelete = -1;
  for (var r = 1; r < values.length; r++) {
    if (values[r][0] === eventId) {
      rowToDelete = r + 1;
      if (!eventName) eventName = values[r][1];
      if (!stageNames || !stageNames.length) {
        try { stageNames = JSON.parse(values[r][2]).map(function(s) { return s.name || s; }); }
        catch (_) { stageNames = []; }
      }
      break;
    }
  }
  if (rowToDelete === -1) return _jsonResponse({ success: false, error: 'Archived event not found' });

  var deletedTabs = [];
  if (eventName && stageNames && stageNames.length) {
    for (var i = 0; i < stageNames.length; i++) {
      var tabName = (eventName + ' - ' + stageNames[i]).substring(0, 100);
      var scoreSheet = ss.getSheetByName(tabName);
      if (scoreSheet) {
        ss.deleteSheet(scoreSheet);
        deletedTabs.push(tabName);
      }
    }
  }

  archiveSheet.deleteRow(rowToDelete);

  return _jsonResponse({ success: true, eventId: eventId, deletedTabs: deletedTabs });
}

/* --- Pull Archived Events --- */
function _pullArchivedEvents() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('ArchivedEvents');

  if (!sheet || sheet.getLastRow() < 2) {
    return _jsonResponse({ events: [] });
  }

  var numCols = sheet.getLastColumn();
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, numCols).getValues();

  function safeParse(val, fallback) {
    if (!val || typeof val !== 'string') return fallback;
    try { return JSON.parse(val); }
    catch (_) { return fallback; }
  }

  return _jsonResponse({
    events: data.map(function(row) {
      return {
        id:          row[0],
        name:        row[1],
        stages:      safeParse(row[2], []),
        competitors: safeParse(row[3], [])
      };
    })
  });
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
