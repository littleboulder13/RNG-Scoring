/**
 * =============================================================
 * Stilly Run 'N Gun — Scoring Logic (v110)
 *
 * Paste this as a separate file in the Apps Script editor
 * (e.g., "Scoring.gs"). All functions here share the same
 * global scope as the main Code.gs file.
 *
 * Scoring Methods:
 *   - percentile_dnf0: Percentile Scoring, DNF=0
 *     Formula: (fastest_time / shooter_time) × 100
 *     DNF = 0% for that stage
 *     Overall = sum of stage percentiles
 * =============================================================
 */

var SCORING_METHODS = {
  'percentile_dnf0': 'Percentile Scoring, DNF=0'
};

/* =============================================================
   Build Results tabs — one per division.
   Called from _syncScores after all stage tabs are written.
   ============================================================= */
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
    if (scoringMethod === 'percentile_dnf0') {
      _buildPercentileDnf0Tab(eventSS, div, divisionShooters[div], stageNames, allScores, methodLabel);
    }
    // Future scoring methods go here:
    // if (scoringMethod === 'some_other_method') { ... }
  }
}

/* =============================================================
   Percentile Scoring, DNF=0
   (fastest_time_in_division / shooter_time) × 100
   DNF = 0%.  Overall = sum of stage percentiles.
   ============================================================= */
function _buildPercentileDnf0Tab(eventSS, div, shooters, stageNames, allScores, methodLabel) {
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

  // Build headers: Rank | Shooter | Stage1 % | Stage1 Rank | … | Overall %
  var headers = ['Rank', 'Shooter'];
  for (var s4 = 0; s4 < stageNames.length; s4++) {
    headers.push(stageNames[s4] + ' %');
    headers.push(stageNames[s4] + ' Rank');
  }
  headers.push('Overall %');
  headers.push('Scoring Method');
  var totalCols = headers.length;

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
