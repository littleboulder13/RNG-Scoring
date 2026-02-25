/* =============================================================
   Excel — Import & Export
   ============================================================= */

// --- Helpers ---
function formatWaitTime(totalSeconds) {
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
}

// --- Import Competitors from Excel ---
async function importFromExcel(file) {
    const data = await file.arrayBuffer();
    const wb   = XLSX.read(data);
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });

    const players     = getPlayers();
    const headerNames = new Set(['name', 'shooter', 'competitor']);
    let imported = 0;

    for (const row of rows) {
        const name     = String(row[0] || '').trim();
        const division = String(row[1] || '').trim();
        if (!name || headerNames.has(name.toLowerCase())) continue;
        if (players.find(p => p.name === name)) continue;
        players.push({ name, division });
        imported++;
    }

    if (!imported) {
        alert('No new competitors found to import.\n\nMake sure:\n• Column A = Name\n• Column B = Division\n• First sheet is the competitor list');
        return;
    }

    players.sort((a, b) => a.name.localeCompare(b.name));
    savePlayers(players);
    populatePlayerDropdown();
    alert(`Successfully imported ${imported} competitor(s).`);
}

// --- Import Competitors directly into a specific event ---
async function importCompetitorsToEvent(file, eventId) {
    const ev = getEventById(eventId);
    if (!ev) return;
    const data = await file.arrayBuffer();
    const wb   = XLSX.read(data);
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });

    const competitors = ev.competitors || [];
    const headerNames = new Set(['name', 'shooter', 'competitor']);
    let imported = 0;

    for (const row of rows) {
        const name     = String(row[0] || '').trim();
        const division = String(row[1] || '').trim();
        if (!name || headerNames.has(name.toLowerCase())) continue;
        if (competitors.find(p => p.name === name)) continue;
        competitors.push({ name, division });
        imported++;
    }

    if (!imported) {
        alert('No new competitors found to import.\n\nMake sure:\n• Column A = Name\n• Column B = Division\n• First sheet is the competitor list');
        return;
    }

    competitors.sort((a, b) => a.name.localeCompare(b.name));
    updateEvent(eventId, { competitors });
    alert(`Successfully imported ${imported} competitor(s).`);
}

// --- Export Scores to Excel ---
async function exportToExcel() {
    const allScores = await getEventScores();
    const players   = getPlayers();
    const stages    = getStages();

    if (!stages.length)  return alert('No stages found. Add stages first.');
    if (!players.length) return alert('No competitors found. Add competitors first.');

    allScores.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    const wb      = XLSX.utils.book_new();
    const headers = ['#', 'Shooter', 'Division', 'Time (s)', 'Wait Time (m:ss)', 'Targets Not Neutralized', 'Notes'];

    // Helper: build one row for a competitor
    const buildRow = (i, name, division, score) => score
        ? [i + 1, name, division, score.dnf ? 'DNF' : score.time,
           formatWaitTime(score.waitTime), score.targetsNotNeutralized, score.notes || '']
        : [i + 1, name, division, '', '', '', ''];

    // One sheet per stage — every competitor listed
    for (const stage of stages) {
        const scoreMap = {};
        allScores.filter(s => s.stage === stage.name).forEach(s => {
            if (!scoreMap[s.playerName]) scoreMap[s.playerName] = s;
        });
        const rows = players.map((p, i) => buildRow(i, p.name, p.division || '', scoreMap[p.name]));
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([headers, ...rows]), stage.name.substring(0, 31));
    }

    // Orphan scores (recorded against stages no longer in the list)
    const knownNames = new Set(stages.map(s => s.name));
    const orphans    = allScores.filter(s => s.stage && !knownNames.has(s.stage));
    for (const stageName of [...new Set(orphans.map(s => s.stage))]) {
        const rows = orphans.filter(s => s.stage === stageName)
            .map((s, i) => buildRow(i, s.playerName || '', s.division || '', s));
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([headers, ...rows]), stageName.substring(0, 31));
    }

    // Duplicates sheet
    const comboCounts = {};
    allScores.forEach(s => {
        const key = `${s.playerName}||${s.stage}`;
        comboCounts[key] = (comboCounts[key] || 0) + 1;
    });

    const dupeScores = allScores.filter(s => comboCounts[`${s.playerName}||${s.stage}`] > 1);

    if (dupeScores.length) {
        const instanceCounter = {};
        const dupeHeaders = ['#', 'Shooter', 'Division', 'Stage', 'Run #', 'Time (s)', 'Wait Time (m:ss)', 'Targets Not Neutralized', 'Notes'];
        const dupeRows = dupeScores.map((s, i) => {
            const key = `${s.playerName}||${s.stage}`;
            instanceCounter[key] = (instanceCounter[key] || 0) + 1;
            return [
                i + 1,
                s.playerName || '',
                s.division || '',
                s.stage || '',
                instanceCounter[key],
                s.dnf ? 'DNF' : s.time,
                formatWaitTime(s.waitTime),
                s.targetsNotNeutralized,
                s.notes || ''
            ];
        });
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([dupeHeaders, ...dupeRows]), 'Duplicates');
    }

    const event = getActiveEvent();
    const eventSlug = event ? event.name.replace(/[^a-zA-Z0-9 ]/g, '').trim().replace(/\s+/g, '-') : 'rng';
    XLSX.writeFile(wb, `${eventSlug}-scores-${new Date().toISOString().slice(0, 10)}.xlsx`);
}
