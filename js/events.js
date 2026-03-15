/* =============================================================
   Event Management (localStorage)
   
   Each event: { id, name, eventType, pin, stages[], competitors[] }
   Stages and competitors are stored per-event, not globally.
   ============================================================= */

/* --- Event Type Configuration --- */
const EVENT_TYPE_CONFIG = {
    run_n_gun:    { label: "Run N' Gun",    stageTypes: ['standard_rng', 'run_time'], defaultStages: [{ name: 'Run Time', type: 'run_time', targets: '', par: '' }] },
    two_gun:      { label: 'Two Gun',       stageTypes: ['standard_rng'],             defaultStages: [] },
    pistol_match: { label: 'Pistol Match',  stageTypes: ['standard_rng'],             defaultStages: [] }
};

function getEventTypeConfig(eventType) {
    return EVENT_TYPE_CONFIG[eventType] || EVENT_TYPE_CONFIG['run_n_gun'];
}

/* --- Global Admin PIN --- */
function getAdminPin() {
    return localStorage.getItem('rng_admin_pin') || '';
}

function setAdminPin(pin) {
    localStorage.setItem('rng_admin_pin', pin);
}

function hasAdminPin() {
    return !!getAdminPin();
}

function verifyAdminPin(entered) {
    return entered === getAdminPin();
}

/* --- Admin Session (sessionStorage-based) --- */
function isAdminLoggedIn() {
    return sessionStorage.getItem('rng_admin_session') === '1';
}
function adminLogin() {
    sessionStorage.setItem('rng_admin_session', '1');
}
function adminLogout() {
    sessionStorage.removeItem('rng_admin_session');
}

function promptAdminPin(actionLabel) {
    const entered = prompt(`Enter admin PIN to ${actionLabel}:`);
    if (entered === null) return false;        // cancelled
    if (verifyAdminPin(entered)) return true;   // correct
    alert('Incorrect PIN.');
    return false;
}

function getEvents() {
    return JSON.parse(localStorage.getItem('rng_events') || '[]');
}

function saveEvents(list) {
    localStorage.setItem('rng_events', JSON.stringify(list));
}

function createEvent(name, scoringMethod, eventType) {
    const events = getEvents();
    const type = eventType || 'run_n_gun';
    const config = getEventTypeConfig(type);
    const event = {
        id:          Date.now().toString(36) + Math.random().toString(36).substr(2, 6),
        name,
        eventType:     type,
        scoringMethod: scoringMethod || 'percentile_dnf0',
        stages:        config.defaultStages.map(s => ({ ...s })),
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

/* --- Archived (Old) Events --- */
function getArchivedEvents() {
    return JSON.parse(localStorage.getItem('rng_archived_events') || '[]');
}

function saveArchivedEvents(list) {
    localStorage.setItem('rng_archived_events', JSON.stringify(list));
}

function archiveEvent(id) {
    const events = getEvents();
    const ev = events.find(e => e.id === id);
    if (!ev) return null;
    // Move to archive
    const archived = getArchivedEvents();
    archived.push(ev);
    saveArchivedEvents(archived);
    // Remove from active events
    saveEvents(events.filter(e => e.id !== id));
    if (getActiveEventId() === id) clearActiveEvent();
    return ev;
}

function restoreEvent(id) {
    const archived = getArchivedEvents();
    const ev = archived.find(e => e.id === id);
    if (!ev) return null;
    // Move back to active events
    const events = getEvents();
    events.push(ev);
    saveEvents(events);
    // Remove from archive
    saveArchivedEvents(archived.filter(e => e.id !== id));
    return ev;
}

function permanentlyDeleteEvent(id) {
    saveArchivedEvents(getArchivedEvents().filter(e => e.id !== id));
}

function updateEvent(id, updates) {
    const events = getEvents();
    const idx = events.findIndex(e => e.id === id);
    if (idx === -1) return;
    Object.assign(events[idx], updates);
    saveEvents(events);
}

function getEventById(id) {
    return getEvents().find(e => e.id === id) || null;
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

    const event = createEvent('Default Event');
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
