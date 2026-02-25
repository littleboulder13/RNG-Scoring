/* =============================================================
   Player / Competitor Management (Event-scoped)
   
   Reads and writes to the active event's competitors array.
   ============================================================= */

function getPlayers() {
    const event = getActiveEvent();
    if (!event) return [];
    return (event.competitors || []).map(p =>
        typeof p === 'string' ? { name: p, division: '' } : p
    );
}

function savePlayers(list) {
    updateActiveEvent({ competitors: list });
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
