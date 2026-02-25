/* =============================================================
   Event Management (localStorage)
   
   Each event: { id, name, date, pin, stages[], competitors[] }
   Stages and competitors are stored per-event, not globally.
   ============================================================= */

function getEvents() {
    return JSON.parse(localStorage.getItem('rng_events') || '[]');
}

function saveEvents(list) {
    localStorage.setItem('rng_events', JSON.stringify(list));
}

function createEvent(name, date, pin) {
    const events = getEvents();
    const event = {
        id:          Date.now().toString(36) + Math.random().toString(36).substr(2, 6),
        name,
        date:        date || new Date().toISOString().slice(0, 10),
        pin:         pin || '',
        stages:      [],
        competitors: []
    };
    events.push(event);
    saveEvents(events);
    return event;
}

function deleteEvent(id) {
    saveEvents(getEvents().filter(e => e.id !== id));
    if (getActiveEventId() === id) clearActiveEvent();
}

function getActiveEventId() {
    return localStorage.getItem('rng_active_event') || '';
}

function setActiveEvent(id) {
    localStorage.setItem('rng_active_event', id);
}

function clearActiveEvent() {
    localStorage.removeItem('rng_active_event');
}

function getActiveEvent() {
    const id = getActiveEventId();
    if (!id) return null;
    return getEvents().find(e => e.id === id) || null;
}

function updateActiveEvent(updates) {
    const id = getActiveEventId();
    if (!id) return;
    const events = getEvents();
    const idx = events.findIndex(e => e.id === id);
    if (idx === -1) return;
    Object.assign(events[idx], updates);
    saveEvents(events);
}

/* --- Event-scoped score retrieval --- */
async function getEventScores() {
    const all = await getAllScores();
    const eventId = getActiveEventId();
    return eventId ? all.filter(s => s.eventId === eventId) : all;
}

/* --- Migration: move legacy global data into a default event --- */
function migrateToEvents() {
    if (getEvents().length > 0) return null;

    const oldPlayersRaw = localStorage.getItem('rng_players');
    const oldStagesRaw  = localStorage.getItem('rng_stages');
    if (!oldPlayersRaw && !oldStagesRaw) return null;

    const oldPlayers = oldPlayersRaw ? JSON.parse(oldPlayersRaw) : [];
    const oldStages  = oldStagesRaw  ? JSON.parse(oldStagesRaw)  : [];
    if (!oldPlayers.length && !oldStages.length) return null;

    const competitors = oldPlayers.map(p =>
        typeof p === 'string' ? { name: p, division: '' } : p
    );
    const stages = oldStages.map(s =>
        typeof s === 'string' ? { name: s, targets: '', par: '' } : s
    );

    const event = createEvent('Default Event', new Date().toISOString().slice(0, 10), '');
    const events = getEvents();
    const idx = events.findIndex(e => e.id === event.id);
    events[idx].competitors = competitors;
    events[idx].stages = stages;
    saveEvents(events);
    setActiveEvent(event.id);

    localStorage.removeItem('rng_players');
    localStorage.removeItem('rng_stages');

    return event.id;
}
