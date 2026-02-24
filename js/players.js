/* =============================================================
   Local Storage — Player / Competitor Management
   ============================================================= */
function getPlayers() {
    const raw = localStorage.getItem('rng_players');
    if (!raw) return [];
    const arr = JSON.parse(raw);
    // Migrate old plain-string format → { name, division }
    if (arr.length && typeof arr[0] === 'string') {
        const migrated = arr.map(n => ({ name: n, division: '' }));
        localStorage.setItem('rng_players', JSON.stringify(migrated));
        return migrated;
    }
    return arr;
}

function savePlayers(list) {
    localStorage.setItem('rng_players', JSON.stringify(list));
}

function addPlayer(name, division = '') {
    const players = getPlayers();
    if (players.find(p => p.name === name)) return;
    players.push({ name, division });
    players.sort((a, b) => a.name.localeCompare(b.name));
    savePlayers(players);
    populatePlayerDropdown();
    renderCompetitorsList();
}

function removePlayer(name) {
    savePlayers(getPlayers().filter(p => p.name !== name));
    populatePlayerDropdown();
    renderCompetitorsList();
}

function getPlayerDivision(name) {
    const p = getPlayers().find(p => p.name === name);
    return p ? p.division || '' : '';
}
