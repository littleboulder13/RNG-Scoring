/**
 * =============================================================
 * Stilly Run 'N Gun — Google Apps Script (v114)
 *
 * Each event gets its own Google Spreadsheet in a Drive folder.
 * The master spreadsheet stores event metadata (Events tab) and
 * config (_Config tab with 'folderId' key for the Drive folder).
 *
 * Handles:
 *   POST 'syncScores'           — write scores to event's own spreadsheet
 *   POST 'pushEvent'            — save event config + create per-event spreadsheet
 *   POST 'archiveEvent'         — move to ArchivedEvents
 *   POST 'restoreEvent'         — restore from ArchivedEvents
 *   POST 'permanentlyDeleteEvent' — trash event spreadsheet + remove row
 *   POST/GET 'pullEvents'       — return all events as JSON
 *   POST/GET 'pullArchivedEvents'
 *   POST/GET 'pullDeletedEventIds'
 *   POST/GET 'pullConfig'
 *   POST 'pushConfig'
 *
 * SETUP:
 *   1. Create a Google Drive folder for event spreadsheets
 *   2. In the _Config tab, set key='folderId' value='<your folder ID>'
 *      (folder ID is the string after /folders/ in the Drive URL)
 *   3. Deploy → Web app → Execute as Me → Anyone → Deploy
 * =============================================================
 */

/* =============================================================
   Run this function manually from the editor to authorize
   DriveApp and SpreadsheetApp scopes. Select "testAuth" from
   the function dropdown and click ▶ Run.
   ============================================================= */
function testAuth() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  Logger.log('Spreadsheet: ' + ss.getName());
  var folder = _getEventsFolder(ss);
  Logger.log('Events folder: ' + folder.getName());
  // Create and immediately trash a test file to authorize all Drive operations
  var testSS = SpreadsheetApp.create('_auth_test_delete_me');
  var file = DriveApp.getFileById(testSS.getId());
  folder.addFile(file);
  var parents = file.getParents();
  while (parents.hasNext()) {
    var p = parents.next();
    if (p.getId() !== folder.getId()) p.removeFile(file);
  }
  file.setTrashed(true);
  Logger.log('Authorization complete — DriveApp and SpreadsheetApp are both authorized.');
}

function doPost(e) {
  try {
    var paramAction = (e && e.parameter && e.parameter.action) || '';
    if (paramAction === 'pullEvents') return _pullEvents();
    if (paramAction === 'pullConfig') return _pullConfig();
    if (paramAction === 'pullArchivedEvents') return _pullArchivedEvents();
    if (paramAction === 'pullDeletedEventIds') return _pullDeletedEventIds();

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

    return _syncScores(ss, data);

  } catch (err) {
    return _jsonResponse({ success: false, error: err.message });
  }
}

function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || 'status';
  if (action === 'pullEvents') return _pullEvents();
  if (action === 'pullConfig') return _pullConfig();
  if (action === 'pullArchivedEvents') return _pullArchivedEvents();
  if (action === 'pullDeletedEventIds') return _pullDeletedEventIds();
  return _jsonResponse({ status: 'ok', message: 'Stilly RNG sync endpoint is running' });
}

/* =============================================================
   Helper: Get the Google Drive folder for event spreadsheets.
   Reads 'folderId' from _Config. Falls back to Drive root.
   ============================================================= */
function _getEventsFolder(ss) {
  var folderId = _getConfig(ss, 'folderId');
  if (folderId) {
    try { return DriveApp.getFolderById(folderId); }
    catch (_) { /* folder not found — fall through */ }
  }
  return DriveApp.getRootFolder();
}

/* =============================================================
   Helper: Get or create the per-event spreadsheet.
   Looks up SpreadsheetId in the Events/ArchivedEvents row.
   If missing, creates a new spreadsheet in the events folder.
   ============================================================= */
function _getEventSpreadsheet(ss, eventId, eventName) {
  // Look up existing SpreadsheetId from the Events row
  var sheetId = _getEventSpreadsheetId(ss, eventId);
  if (sheetId) {
    try { return SpreadsheetApp.openById(sheetId); }
    catch (_) { /* spreadsheet was deleted — recreate below */ }
  }

  // Create a new spreadsheet for this event
  var newSS = SpreadsheetApp.create(eventName || 'Unnamed Event');
  var file = DriveApp.getFileById(newSS.getId());
  var folder = _getEventsFolder(ss);

  // Move into the events folder
  folder.addFile(file);
  var parents = file.getParents();
  while (parents.hasNext()) {
    var p = parents.next();
    if (p.getId() !== folder.getId()) p.removeFile(file);
  }

  // Delete the default "Sheet1" tab
  var defaultSheet = newSS.getSheetByName('Sheet1');
  if (defaultSheet && newSS.getSheets().length > 0) {
    // Can't delete if it's the only sheet; we'll add a stage tab first in _syncScores
    // For now just rename it
    defaultSheet.setName('_info');
    defaultSheet.getRange(1, 1).setValue('Event: ' + eventName);
    defaultSheet.getRange(2, 1).setValue('Created: ' + new Date().toISOString());
  }

  // Store the SpreadsheetId back in the Events row (non-fatal if row doesn't exist yet)
  try { _setEventSpreadsheetId(ss, eventId, newSS.getId()); }
  catch (_) { /* row may not exist yet — _pushEvent will write it */ }

  return newSS;
}

/* Look up SpreadsheetId column value for an event */
function _getEventSpreadsheetId(ss, eventId) {
  var sheet = ss.getSheetByName('Events') || ss.getSheetByName('_Events');
  if (!sheet || sheet.getLastRow() < 2) return null;
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var ssIdCol = -1;
  for (var c = 0; c < headers.length; c++) {
    if (String(headers[c]).toLowerCase().replace(/\s+/g, '') === 'spreadsheetid') { ssIdCol = c; break; }
  }
  if (ssIdCol === -1) return null;
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
  for (var r = 0; r < data.length; r++) {
    if (data[r][0] === eventId) return data[r][ssIdCol] || null;
  }
  return null;
}

/* Store SpreadsheetId in the Events row for an event */
function _setEventSpreadsheetId(ss, eventId, spreadsheetId) {
  var sheet = ss.getSheetByName('Events') || ss.getSheetByName('_Events');
  if (!sheet) return;
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var ssIdCol = -1;
  for (var c = 0; c < headers.length; c++) {
    if (String(headers[c]).toLowerCase().replace(/\s+/g, '') === 'spreadsheetid') { ssIdCol = c + 1; break; }
  }
  // If SpreadsheetId column doesn't exist, add it
  if (ssIdCol === -1) {
    ssIdCol = headers.length + 1;
    sheet.getRange(1, ssIdCol).setValue('SpreadsheetId');
    sheet.getRange(1, ssIdCol).setFontWeight('bold').setBackground('#1565c0').setFontColor('#ffffff');
  }
  // Guard: no data rows yet — nothing to update
  if (sheet.getLastRow() < 2) return;
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
  for (var r = 0; r < data.length; r++) {
    if (data[r][0] === eventId) {
      sheet.getRange(r + 2, ssIdCol).setValue(spreadsheetId);
      return;
    }
  }
}

/* =============================================================
   Score Sync — writes to the event's own spreadsheet.
   Each stage is a tab. Duplicate scores append to the right.
   ============================================================= */
function _syncScores(ss, data) {
  var scores = Array.isArray(data.scores) ? data.scores : [];
  var eventId = data.eventId || '';
  var eventName = data.eventName || 'Unknown Event';
  var scoringMethod = data.scoringMethod || 'percentile_dnf0';
  var competitors = Array.isArray(data.competitors) ? data.competitors : [];
  var stages = Array.isArray(data.stages) ? data.stages : [];

  if (!scores.length) {
    return _jsonResponse({ success: false, error: 'No scores provided' });
  }

  // Open (or create) the event's own spreadsheet
  var eventSS;
  if (eventId) {
    eventSS = _getEventSpreadsheet(ss, eventId, eventName);
  } else {
    // Fallback: no eventId sent — use the master spreadsheet (legacy)
    eventSS = ss;
  }

  var BASE_HEADERS = ['#', 'Shooter', 'Division'];
  var STD_SCORE_HEADERS = ['Time (s)', 'Targets Not Neutralized', 'Wait Time (m:ss)', 'Wait Time (s)', 'Notes'];
  var STD_SCORE_COLS = STD_SCORE_HEADERS.length;
  var RT_SCORE_HEADERS = ['Start Time (m:ss)', 'Start Time (s)', 'Finish Time (m:ss)', 'Finish Time (s)', 'Run Time (s)', 'Wait Time (m:ss)', 'Wait Time (s)', 'Notes'];
  var RT_SCORE_COLS = RT_SCORE_HEADERS.length;

  // Build stage name → type lookup
  var stageTypeMap = {};
  for (var st = 0; st < stages.length; st++) {
    var stObj = stages[st];
    var stName = stObj.name || stObj;
    stageTypeMap[stName] = (stObj.type || 'standard_rng');
  }

  function fmtWait(totalSec) {
    var m = Math.floor((totalSec || 0) / 60);
    var s = (totalSec || 0) % 60;
    return m + ':' + ('0' + s).slice(-2);
  }

  var scoresByStage = {};
  for (var i = 0; i < scores.length; i++) {
    var stageName = scores[i].stage || 'Unknown Stage';
    if (!scoresByStage[stageName]) scoresByStage[stageName] = [];
    scoresByStage[stageName].push(scores[i]);
  }

  var stageNames = [];
  var stageSet = {};
  for (var si = 0; si < stages.length; si++) {
    var sn = stages[si].name || stages[si];
    if (!stageSet[sn]) { stageNames.push(sn); stageSet[sn] = true; }
  }
  for (var key in scoresByStage) {
    if (!stageSet[key]) { stageNames.push(key); stageSet[key] = true; }
  }

  var allScores = {};   // allScores[stageName][playerName] = { time, division }
  var totalSynced = 0;

  for (var si2 = 0; si2 < stageNames.length; si2++) {
    var stage = stageNames[si2];
    var isRunTime = (stageTypeMap[stage] === 'run_time');
    var SCORE_HEADERS = isRunTime ? RT_SCORE_HEADERS : STD_SCORE_HEADERS;
    var SCORE_COLS = isRunTime ? RT_SCORE_COLS : STD_SCORE_COLS;
    // Tab name: just the stage name (no event prefix — it's already its own spreadsheet)
    var tabName = stage.substring(0, 100);

    var sheet = eventSS.getSheetByName(tabName);
    var isNew = false;
    if (!sheet) {
      sheet = eventSS.insertSheet(tabName);
      isNew = true;
    }

    var stageScores = scoresByStage[stage] || [];

    var existingMap = {};
    if (!isNew && sheet.getLastRow() >= 2) {
      var numCols = Math.max(sheet.getLastColumn(), BASE_HEADERS.length + SCORE_COLS);
      var existData = sheet.getRange(2, 1, sheet.getLastRow() - 1, numCols).getValues();
      for (var ex = 0; ex < existData.length; ex++) {
        var exName = String(existData[ex][1]).trim();
        if (!exName) continue;
        var exScores = [];
        for (var b = 0; b < 50; b++) {
          var off = BASE_HEADERS.length + b * SCORE_COLS;
          if (off >= numCols) break;
          var firstVal = existData[ex][off];
          if (firstVal === '' || firstVal === undefined || firstVal === null) break;
          if (isRunTime) {
            exScores.push({
              startTimeFmt: existData[ex][off] || '',
              startTimeSec: existData[ex][off + 1] || 0,
              finishTimeFmt: existData[ex][off + 2] || '',
              finishTimeSec: existData[ex][off + 3] || 0,
              runTime: existData[ex][off + 4] || 0,
              waitTime: existData[ex][off + 5] || '',
              waitTimeSec: existData[ex][off + 6] || 0,
              notes: existData[ex][off + 7] || ''
            });
          } else {
            exScores.push({
              time: firstVal,
              tnt: existData[ex][off + 1] || 0,
              waitTime: existData[ex][off + 2] || '',
              waitTimeSec: existData[ex][off + 3] || 0,
              notes: existData[ex][off + 4] || ''
            });
          }
        }
        existingMap[exName] = { division: existData[ex][2] || '', scores: exScores };
      }
    }

    for (var ns = 0; ns < stageScores.length; ns++) {
      var sc = stageScores[ns];
      var pn = sc.playerName || '';
      if (!pn) continue;
      var waitSec = sc.waitTime || 0;
      var newScore;
      if (isRunTime) {
        newScore = {
          startTimeFmt: sc.startTimeFormatted || fmtWait(sc.startTime || 0),
          startTimeSec: sc.startTime || 0,
          finishTimeFmt: sc.finishTimeFormatted || fmtWait(sc.finishTime || 0),
          finishTimeSec: sc.finishTime || 0,
          runTime: sc.time || 0,
          waitTime: fmtWait(waitSec),
          waitTimeSec: waitSec,
          notes: sc.notes || ''
        };
      } else {
        newScore = {
          time: sc.dnf ? 'DNF' : (sc.time || 0),
          tnt: sc.targetsNotNeutralized || 0,
          waitTime: fmtWait(waitSec),
          waitTimeSec: waitSec,
          notes: sc.notes || ''
        };
      }
      if (!existingMap[pn]) {
        existingMap[pn] = { division: sc.division || '', scores: [] };
      }
      existingMap[pn].scores.push(newScore);
    }

    // Collect latest score per player for results calculation
    if (!allScores[stage]) allScores[stage] = {};
    for (var emKey in existingMap) {
      var emEntry = existingMap[emKey];
      if (emEntry.scores.length > 0) {
        var latest = emEntry.scores[emEntry.scores.length - 1];
        var latestTime = isRunTime ? latest.runTime : latest.time;
        allScores[stage][emKey] = { time: latestTime, division: emEntry.division };
      }
    }

    var compList = [];
    var compSet = {};
    for (var ci = 0; ci < competitors.length; ci++) {
      var cn = competitors[ci].name || '';
      if (cn && !compSet[cn]) {
        compList.push({ name: cn, division: competitors[ci].division || '' });
        compSet[cn] = true;
      }
    }
    for (var sp in existingMap) {
      if (!compSet[sp]) {
        compList.push({ name: sp, division: existingMap[sp].division || '' });
        compSet[sp] = true;
      }
    }

    var maxBlocks = 1;
    for (var mb in existingMap) {
      if (existingMap[mb].scores.length > maxBlocks) {
        maxBlocks = existingMap[mb].scores.length;
      }
    }

    var headers = BASE_HEADERS.slice();
    for (var h = 0; h < maxBlocks; h++) {
      for (var sh = 0; sh < SCORE_HEADERS.length; sh++) {
        headers.push(h === 0 ? SCORE_HEADERS[sh] : SCORE_HEADERS[sh] + ' [' + (h + 1) + ']');
      }
    }
    var totalCols = headers.length;

    var rows = [];
    for (var ri = 0; ri < compList.length; ri++) {
      var comp = compList[ri];
      var entry = existingMap[comp.name];
      var row = [ri + 1, comp.name, comp.division];
      for (var sb = 0; sb < maxBlocks; sb++) {
        if (entry && sb < entry.scores.length) {
          var sc2 = entry.scores[sb];
          if (isRunTime) {
            row.push(sc2.startTimeFmt, sc2.startTimeSec, sc2.finishTimeFmt, sc2.finishTimeSec, sc2.runTime, sc2.waitTime, sc2.waitTimeSec, sc2.notes);
          } else {
            row.push(sc2.time, sc2.tnt, sc2.waitTime, sc2.waitTimeSec, sc2.notes);
          }
        } else {
          for (var pad = 0; pad < SCORE_COLS; pad++) row.push('');
        }
      }
      rows.push(row);
    }

    sheet.clear();
    sheet.getRange(1, 1, 1, totalCols).setValues([headers]);
    sheet.getRange(1, 1, 1, totalCols)
      .setFontWeight('bold')
      .setBackground('#2c5f2d')
      .setFontColor('#ffffff');
    sheet.setFrozenRows(1);

    if (rows.length) {
      sheet.getRange(2, 1, rows.length, totalCols).setValues(rows);
    }

    for (var col = 1; col <= totalCols; col++) {
      sheet.autoResizeColumn(col);
    }

    totalSynced += stageScores.length;
  }

  // Build results tabs per division
  _buildResultsTabs(eventSS, stageNames, allScores, competitors, scoringMethod);

  return _jsonResponse({ success: true, count: totalSynced });
}

/* =============================================================
   Build Results tabs — one per division with percentile scoring.
   Percentile = (fastest_time_in_division / shooter_time) × 100
   DNF = 0%.  Overall = sum of stage percentiles.
   ============================================================= */
var SCORING_METHODS = {
  'percentile_dnf0': 'Percentile Scoring, DNF=0'
};

function _buildResultsTabs(eventSS, stageNames, allScores, competitors, scoringMethod) {
  var methodLabel = SCORING_METHODS[scoringMethod] || SCORING_METHODS['percentile_dnf0'];
  // Build shooter → division map
  var shooterDiv = {};
  for (var i = 0; i < competitors.length; i++) {
    var cn = competitors[i].name || '';
    if (cn) shooterDiv[cn] = competitors[i].division || 'Unclassified';
  }
  // Include shooters from scores that aren't in the competitors list
  for (var si = 0; si < stageNames.length; si++) {
    var stg = stageNames[si];
    if (!allScores[stg]) continue;
    for (var nm in allScores[stg]) {
      if (!shooterDiv[nm]) shooterDiv[nm] = allScores[stg][nm].division || 'Unclassified';
    }
  }

  // Group shooters by division
  var divisionShooters = {};
  for (var nm2 in shooterDiv) {
    var dv = shooterDiv[nm2];
    if (!divisionShooters[dv]) divisionShooters[dv] = [];
    divisionShooters[dv].push(nm2);
  }

  // For each division, create/update a results tab
  for (var div in divisionShooters) {
    var shooters = divisionShooters[div];
    var tabName = ('Results \u2014 ' + div).substring(0, 100);

    // Fastest valid time per stage within this division
    var fastestPerStage = {};
    for (var s1 = 0; s1 < stageNames.length; s1++) {
      var stgName = stageNames[s1];
      var fastest = Infinity;
      for (var p1 = 0; p1 < shooters.length; p1++) {
        var sc = allScores[stgName] && allScores[stgName][shooters[p1]];
        if (sc && sc.time !== 'DNF' && typeof sc.time === 'number' && sc.time > 0 && sc.time < fastest) {
          fastest = sc.time;
        }
      }
      fastestPerStage[stgName] = fastest === Infinity ? 0 : fastest;
    }

    // Calculate percentile per stage per shooter
    var results = [];
    for (var p2 = 0; p2 < shooters.length; p2++) {
      var player = shooters[p2];
      var stageResults = [];
      var totalPct = 0;
      for (var s2 = 0; s2 < stageNames.length; s2++) {
        var pct = 0;
        var entry = allScores[stageNames[s2]] && allScores[stageNames[s2]][player];
        if (entry) {
          var f = fastestPerStage[stageNames[s2]];
          if (entry.time !== 'DNF' && typeof entry.time === 'number' && entry.time > 0 && f > 0) {
            pct = (f / entry.time) * 100;
          }
        }
        stageResults.push(pct);
        totalPct += pct;
      }
      results.push({ name: player, stageResults: stageResults, stageRanks: [], total: totalPct });
    }

    // Per-stage ranks (within this division)
    for (var s3 = 0; s3 < stageNames.length; s3++) {
      var idx = s3;
      var sorted = results.slice().sort(function(a, b) {
        return b.stageResults[idx] - a.stageResults[idx];
      });
      for (var ri = 0; ri < sorted.length; ri++) {
        sorted[ri].stageRanks[idx] = ri + 1;
      }
    }

    // Sort by overall total descending
    results.sort(function(a, b) { return b.total - a.total; });

    // Build headers: Rank | Shooter | Stage 1 Points | Stage 1 Rank | … | Total Points Scored
    var headers = ['Rank', 'Shooter'];
    for (var s4 = 0; s4 < stageNames.length; s4++) {
      headers.push('Stage ' + (s4 + 1) + ' Points');
      headers.push('Stage ' + (s4 + 1) + ' Rank');
    }
    headers.push('Total Points Scored');
    headers.push('Final %');
    headers.push('Scoring Method');
    var totalCols = headers.length;

    // Highest total in this division (results already sorted descending)
    var highestTotal = results.length > 0 ? results[0].total : 0;

    // Build rows
    var rows = [];
    for (var r = 0; r < results.length; r++) {
      var res = results[r];
      var row = [r + 1, res.name];
      for (var s5 = 0; s5 < stageNames.length; s5++) {
        row.push(Math.round(res.stageResults[s5] * 100) / 100);
        row.push(res.stageRanks[s5]);
      }
      row.push(Math.round(res.total * 100) / 100);
      var finalPct = highestTotal > 0 ? (res.total / highestTotal) * 100 : 0;
      row.push(Math.round(finalPct * 100) / 100);
      row.push(r === 0 ? methodLabel : '');  // Show scoring method label in first row only
      rows.push(row);
    }

    // Write to sheet
    var sheet = eventSS.getSheetByName(tabName);
    if (!sheet) sheet = eventSS.insertSheet(tabName);
    sheet.clear();

    sheet.getRange(1, 1, 1, totalCols).setValues([headers]);
    sheet.getRange(1, 1, 1, totalCols)
      .setFontWeight('bold')
      .setBackground('#1565c0')
      .setFontColor('#ffffff');
    sheet.setFrozenRows(1);

    if (rows.length) {
      sheet.getRange(2, 1, rows.length, totalCols).setValues(rows);
    }

    for (var col = 1; col <= totalCols; col++) {
      sheet.autoResizeColumn(col);
    }
  }
}

/* =============================================================
   Push Event Config — creates per-event spreadsheet if new
   ============================================================= */
function _pushEvent(ss, ev) {
  if (!ev || !ev.id) {
    return _jsonResponse({ success: false, error: 'No event data' });
  }

  var sheet = ss.getSheetByName('Events') || ss.getSheetByName('_Events');
  if (!sheet) {
    sheet = ss.insertSheet('Events');
    var headers = ['EventID', 'Name', 'Stages', 'Competitors', 'Updated', 'Password', 'SpreadsheetId', 'ScoringMethod'];
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length)
      .setFontWeight('bold')
      .setBackground('#1565c0')
      .setFontColor('#ffffff');
    sheet.setFrozenRows(1);
  }

  // Ensure SpreadsheetId column exists
  var hdrs = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var ssIdCol = -1;
  for (var c = 0; c < hdrs.length; c++) {
    if (String(hdrs[c]).toLowerCase().replace(/\s+/g, '') === 'spreadsheetid') { ssIdCol = c; break; }
  }
  if (ssIdCol === -1) {
    ssIdCol = hdrs.length;
    sheet.getRange(1, ssIdCol + 1).setValue('SpreadsheetId');
    sheet.getRange(1, ssIdCol + 1).setFontWeight('bold').setBackground('#1565c0').setFontColor('#ffffff');
    hdrs = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  }

  // Ensure ScoringMethod column exists
  var smCol = -1;
  for (var c2 = 0; c2 < hdrs.length; c2++) {
    if (String(hdrs[c2]).toLowerCase().replace(/\s+/g, '') === 'scoringmethod') { smCol = c2; break; }
  }
  if (smCol === -1) {
    smCol = sheet.getLastColumn();
    sheet.getRange(1, smCol + 1).setValue('ScoringMethod');
    sheet.getRange(1, smCol + 1).setFontWeight('bold').setBackground('#1565c0').setFontColor('#ffffff');
  }

  // Find existing row
  var dataRange = sheet.getDataRange();
  var values = dataRange.getValues();
  var existingRow = -1;
  var existingSsId = '';
  for (var r = 1; r < values.length; r++) {
    if (values[r][0] === ev.id) {
      existingRow = r + 1;
      existingSsId = values[r][ssIdCol] || '';
      break;
    }
  }

  // Create event spreadsheet if it doesn't exist yet
  if (!existingSsId) {
    var eventSS = _getEventSpreadsheet(ss, ev.id, ev.name || 'Unnamed Event');
    existingSsId = eventSS.getId();
  } else {
    // Rename existing spreadsheet if event name changed
    try {
      var existing = SpreadsheetApp.openById(existingSsId);
      if (existing.getName() !== (ev.name || '')) {
        existing.rename(ev.name || 'Unnamed Event');
      }
    } catch (_) { /* spreadsheet gone, recreate */ 
      var eventSS2 = _getEventSpreadsheet(ss, ev.id, ev.name || 'Unnamed Event');
      existingSsId = eventSS2.getId();
    }
  }

  // Build full row up to the last known column (smCol is furthest right)
  var totalEvtCols = Math.max(ssIdCol, smCol) + 1;
  var row = new Array(totalEvtCols);
  row[0] = ev.id;
  row[1] = ev.name || '';
  row[2] = JSON.stringify(ev.stages || []);
  row[3] = JSON.stringify(ev.competitors || []);
  row[4] = new Date().toISOString();
  row[5] = ev.password || '';
  row[ssIdCol] = existingSsId;
  row[smCol] = ev.scoringMethod || 'percentile_dnf0';
  // Fill any undefined slots
  for (var fi = 0; fi < row.length; fi++) { if (row[fi] === undefined) row[fi] = ''; }

  if (existingRow > 0) {
    sheet.getRange(existingRow, 1, 1, row.length).setValues([row]);
  } else {
    sheet.getRange(sheet.getLastRow() + 1, 1, 1, row.length).setValues([row]);
  }

  for (var i = 1; i <= row.length; i++) {
    sheet.autoResizeColumn(i);
  }

  return _jsonResponse({ success: true, eventId: ev.id, spreadsheetId: existingSsId });
}

/* =============================================================
   Pull Events
   ============================================================= */
function _pullEvents() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Events') || ss.getSheetByName('_Events');

  if (!sheet || sheet.getLastRow() < 2) {
    return _jsonResponse({ events: [] });
  }

  var numCols = sheet.getLastColumn();
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, numCols).getValues();
  var headers = sheet.getRange(1, 1, 1, numCols).getValues()[0];
  var colIdx = {};
  for (var c = 0; c < headers.length; c++) {
    colIdx[String(headers[c]).toLowerCase().replace(/\s+/g, '')] = c;
  }

  function safeParse(val, fallback) {
    if (!val || typeof val !== 'string') return fallback;
    try { return JSON.parse(val); }
    catch (_) { return fallback; }
  }

  var events = data.map(function(row) {
    var idCol     = colIdx['eventid'] !== undefined ? colIdx['eventid'] : 0;
    var nameCol   = colIdx['name'] !== undefined ? colIdx['name'] : 1;
    var stagesCol = colIdx['stages'] !== undefined ? colIdx['stages'] : 2;
    var compCol   = colIdx['competitors'] !== undefined ? colIdx['competitors'] : 3;
    var pwCol     = colIdx['password'] !== undefined ? colIdx['password'] : 5;
    var ssIdCol   = colIdx['spreadsheetid'] !== undefined ? colIdx['spreadsheetid'] : -1;
    var smCol     = colIdx['scoringmethod'] !== undefined ? colIdx['scoringmethod'] : -1;

    return {
      id:            row[idCol],
      name:          row[nameCol],
      stages:        safeParse(row[stagesCol], []),
      competitors:   safeParse(row[compCol], []),
      password:      row[pwCol] || '',
      spreadsheetId: ssIdCol >= 0 ? (row[ssIdCol] || '') : '',
      scoringMethod: smCol >= 0 ? (row[smCol] || 'percentile_dnf0') : 'percentile_dnf0'
    };
  });

  return _jsonResponse({ events: events });
}

/* =============================================================
   Archive Event — carries SpreadsheetId to archive row
   ============================================================= */
function _archiveEvent(ss, eventId) {
  if (!eventId) return _jsonResponse({ success: false, error: 'No eventId' });

  var sheet = ss.getSheetByName('Events') || ss.getSheetByName('_Events');
  if (!sheet || sheet.getLastRow() < 2) {
    return _jsonResponse({ success: false, error: 'Events sheet not found or empty' });
  }

  // Find SpreadsheetId column
  var hdrs = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var ssIdCol = -1;
  for (var c = 0; c < hdrs.length; c++) {
    if (String(hdrs[c]).toLowerCase().replace(/\s+/g, '') === 'spreadsheetid') { ssIdCol = c; break; }
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
    var headers = ['EventID', 'Name', 'Stages', 'Competitors', 'Updated', 'Password', 'SpreadsheetId', 'ScoringMethod', 'ArchivedAt'];
    archiveSheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    archiveSheet.getRange(1, 1, 1, headers.length)
      .setFontWeight('bold')
      .setBackground('#795548')
      .setFontColor('#ffffff');
    archiveSheet.setFrozenRows(1);
  }

  // Find ScoringMethod column
  var smCol = -1;
  for (var c2 = 0; c2 < hdrs.length; c2++) {
    if (String(hdrs[c2]).toLowerCase().replace(/\s+/g, '') === 'scoringmethod') { smCol = c2; break; }
  }

  var archiveRow = [
    rowData[0],                          // EventID
    rowData[1],                          // Name
    rowData[2],                          // Stages
    rowData[3],                          // Competitors
    rowData[4],                          // Updated
    rowData[5],                          // Password
    ssIdCol >= 0 ? (rowData[ssIdCol] || '') : '',  // SpreadsheetId
    smCol >= 0 ? (rowData[smCol] || 'percentile_dnf0') : 'percentile_dnf0',  // ScoringMethod
    new Date().toISOString()             // ArchivedAt
  ];
  archiveSheet.getRange(archiveSheet.getLastRow() + 1, 1, 1, archiveRow.length).setValues([archiveRow]);
  sheet.deleteRow(rowIndex);

  return _jsonResponse({ success: true, eventId: eventId });
}

/* =============================================================
   Restore Event — carries SpreadsheetId back
   ============================================================= */
function _restoreEvent(ss, eventId) {
  if (!eventId) return _jsonResponse({ success: false, error: 'No eventId' });

  var archiveSheet = ss.getSheetByName('ArchivedEvents');
  if (!archiveSheet || archiveSheet.getLastRow() < 2) {
    return _jsonResponse({ success: false, error: 'ArchivedEvents sheet not found or empty' });
  }

  // Find SpreadsheetId column in archive
  var archHdrs = archiveSheet.getRange(1, 1, 1, archiveSheet.getLastColumn()).getValues()[0];
  var archSsIdCol = -1;
  for (var c = 0; c < archHdrs.length; c++) {
    if (String(archHdrs[c]).toLowerCase().replace(/\s+/g, '') === 'spreadsheetid') { archSsIdCol = c; break; }
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
    var headers = ['EventID', 'Name', 'Stages', 'Competitors', 'Updated', 'Password', 'SpreadsheetId', 'ScoringMethod'];
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length)
      .setFontWeight('bold')
      .setBackground('#1565c0')
      .setFontColor('#ffffff');
    sheet.setFrozenRows(1);
  }

  // Find ScoringMethod column in archive
  var archSmCol = -1;
  for (var c2 = 0; c2 < archHdrs.length; c2++) {
    if (String(archHdrs[c2]).toLowerCase().replace(/\s+/g, '') === 'scoringmethod') { archSmCol = c2; break; }
  }

  var restoreRow = [
    rowData[0],                                           // EventID
    rowData[1],                                           // Name
    rowData[2],                                           // Stages
    rowData[3],                                           // Competitors
    new Date().toISOString(),                             // Updated
    rowData[5],                                           // Password
    archSsIdCol >= 0 ? (rowData[archSsIdCol] || '') : '', // SpreadsheetId
    archSmCol >= 0 ? (rowData[archSmCol] || 'percentile_dnf0') : 'percentile_dnf0'  // ScoringMethod
  ];
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, restoreRow.length).setValues([restoreRow]);
  archiveSheet.deleteRow(rowIndex);

  return _jsonResponse({ success: true, eventId: eventId });
}

/* =============================================================
   Permanently Delete — trashes the event's spreadsheet
   ============================================================= */
function _permanentlyDeleteEvent(ss, eventId, eventName, stageNames) {
  if (!eventId) return _jsonResponse({ success: false, error: 'No eventId' });

  var archiveSheet = ss.getSheetByName('ArchivedEvents');
  if (!archiveSheet || archiveSheet.getLastRow() < 2) {
    return _jsonResponse({ success: false, error: 'ArchivedEvents sheet not found or empty' });
  }

  // Find SpreadsheetId column in archive
  var archHdrs = archiveSheet.getRange(1, 1, 1, archiveSheet.getLastColumn()).getValues()[0];
  var archSsIdCol = -1;
  for (var c = 0; c < archHdrs.length; c++) {
    if (String(archHdrs[c]).toLowerCase().replace(/\s+/g, '') === 'spreadsheetid') { archSsIdCol = c; break; }
  }

  var values = archiveSheet.getDataRange().getValues();
  var rowToDelete = -1;
  var spreadsheetId = '';
  for (var r = 1; r < values.length; r++) {
    if (values[r][0] === eventId) {
      rowToDelete = r + 1;
      if (!eventName) eventName = values[r][1];
      if (archSsIdCol >= 0) spreadsheetId = values[r][archSsIdCol] || '';
      break;
    }
  }
  if (rowToDelete === -1) return _jsonResponse({ success: false, error: 'Archived event not found' });

  // Trash the event's spreadsheet
  var trashedSpreadsheet = false;
  if (spreadsheetId) {
    try {
      DriveApp.getFileById(spreadsheetId).setTrashed(true);
      trashedSpreadsheet = true;
    } catch (_) { /* already gone */ }
  }

  archiveSheet.deleteRow(rowToDelete);
  _recordDeletedEvent(ss, eventId);

  return _jsonResponse({ success: true, eventId: eventId, trashedSpreadsheet: trashedSpreadsheet });
}

/* =============================================================
   Deleted-Event Tracking
   ============================================================= */
function _recordDeletedEvent(ss, eventId) {
  var sheet = ss.getSheetByName('_DeletedEvents');
  if (!sheet) {
    sheet = ss.insertSheet('_DeletedEvents');
    sheet.getRange(1, 1, 1, 2).setValues([['EventID', 'DeletedAt']]);
    sheet.getRange(1, 1, 1, 2)
      .setFontWeight('bold')
      .setBackground('#b71c1c')
      .setFontColor('#ffffff');
    sheet.setFrozenRows(1);
  }
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, 2)
    .setValues([[eventId, new Date().toISOString()]]);
}

function _pullDeletedEventIds() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('_DeletedEvents');
  if (!sheet || sheet.getLastRow() < 2) {
    return _jsonResponse({ deletedEventIds: [] });
  }
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
  var ids = data.map(function(row) { return row[0]; }).filter(Boolean);
  return _jsonResponse({ deletedEventIds: ids });
}

/* =============================================================
   Pull Archived Events
   ============================================================= */
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

/* =============================================================
   JSON Response Helper
   ============================================================= */
function _jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* =============================================================
   Config Storage (_Config sheet)
   ============================================================= */
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
  var keyLower = key.toLowerCase();
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][0]).toLowerCase() === keyLower) return data[i][1];
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
  if (config.folderId) _setConfig(ss, 'folderId', config.folderId);
  return _jsonResponse({ success: true });
}

function _pullConfig() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var syncUrl = _getConfig(ss, 'syncUrl');
  var folderId = _getConfig(ss, 'folderId');
  return _jsonResponse({ syncUrl: syncUrl || '', folderId: folderId || '' });
}
