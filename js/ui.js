/* =============================================================
   UI — Render Lists, Dropdowns, Display Helpers
   ============================================================= */

// --- Competitors List ---
function renderCompetitorsList() {
    const el = $('competitors-list');
    if (!el) return;
    const players = getPlayers();

    if (!players.length) {
        el.innerHTML = '<div class="empty-state">No competitors yet. Add names above to get started.</div>';
        return;
    }

    el.innerHTML = players.map(p => `
        <div class="competitor-item">
            <div class="stage-view">
                <div class="competitor-info">
                    <span class="competitor-name">${p.name}</span>
                    ${p.division ? `<span class="competitor-division-tag">${p.division}</span>` : ''}
                </div>
                <button class="btn-delete" data-name="${p.name}">Remove</button>
            </div>
        </div>
    `).join('');

    el.querySelectorAll('.btn-delete').forEach(btn =>
        btn.addEventListener('click', () => removePlayer(btn.dataset.name))
    );
}

// --- Player Dropdown ---
function populatePlayerDropdown() {
    const sel = $('player-name');
    if (!sel) return;
    const prev = sel.value;
    sel.innerHTML = '<option value="" disabled selected>Select shooter...</option>';
    const players = getPlayers();
    players.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.name;
        opt.textContent = p.name;
        sel.appendChild(opt);
    });
    if (prev && players.find(p => p.name === prev)) sel.value = prev;
}

// --- Stages List (with inline edit) ---
function renderStagesList() {
    const el = $('stages-list');
    if (!el) return;
    const stages = getStages();

    if (!stages.length) {
        el.innerHTML = '<div class="empty-state">No stages yet. Add stages above to get started.</div>';
        return;
    }

    el.innerHTML = stages.map(s => {
        const meta = [
            s.targets ? `${s.targets} targets` : '',
            s.par     ? `PAR: ${s.par}s`        : ''
        ].filter(Boolean).join(' · ');
        return `
        <div class="competitor-item" data-stage-name="${s.name}">
            <div class="stage-view">
                <span class="competitor-name">
                    ${s.name}${meta ? ` <em style="color:#888;font-size:0.85em">(${meta})</em>` : ''}
                </span>
                <div class="item-actions">
                    <button class="btn-edit" data-name="${s.name}">Edit</button>
                    <button class="btn-delete" data-name="${s.name}">Remove</button>
                </div>
            </div>
            <div class="stage-edit" style="display:none">
                <input type="text" class="edit-name" value="${s.name}" placeholder="Stage name">
                <input type="number" class="edit-targets" value="${s.targets}" placeholder="# of targets" min="0" style="width:110px">
                <input type="number" class="edit-par" value="${s.par}" placeholder="PAR (s)" min="0" step="0.01" style="width:110px">
                <div class="edit-actions">
                    <button class="btn-save-edit" data-name="${s.name}">Save</button>
                    <button class="btn-cancel-edit">Cancel</button>
                </div>
            </div>
        </div>`;
    }).join('');

    // Remove
    el.querySelectorAll('.btn-delete').forEach(btn =>
        btn.addEventListener('click', () => removeStage(btn.dataset.name))
    );

    // Edit → show inline form
    el.querySelectorAll('.btn-edit').forEach(btn => {
        btn.addEventListener('click', () => {
            const row = btn.closest('.competitor-item');
            row.querySelector('.stage-view').style.display = 'none';
            row.querySelector('.stage-edit').style.display = '';
            row.querySelector('.edit-name').focus();
        });
    });

    // Cancel edit
    el.querySelectorAll('.btn-cancel-edit').forEach(btn => {
        btn.addEventListener('click', () => {
            const row = btn.closest('.competitor-item');
            row.querySelector('.stage-view').style.display = '';
            row.querySelector('.stage-edit').style.display = 'none';
        });
    });

    // Save edit
    el.querySelectorAll('.btn-save-edit').forEach(btn => {
        btn.addEventListener('click', () => {
            const row     = btn.closest('.competitor-item');
            const newName = row.querySelector('.edit-name').value.trim();
            if (!newName) return;
            updateStage(
                btn.dataset.name,
                newName,
                row.querySelector('.edit-targets').value.trim(),
                row.querySelector('.edit-par').value.trim()
            );
        });
    });
}

// --- Stage Dropdown ---
function populateStageDropdown() {
    const sel = $('stage');
    if (!sel) return;
    const prev = sel.value;
    sel.innerHTML = '<option value="" disabled selected>Select stage...</option>';
    const stages = getStages();
    stages.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.name;
        opt.textContent = s.name;
        sel.appendChild(opt);
    });
    if (prev && stages.find(s => s.name === prev)) sel.value = prev;
}

// --- Score Entry Helpers ---
function showStageInfo() {
    const display = $('stage-info-display');
    if (!display) return;
    const stage = getStages().find(s => s.name === $('stage')?.value);
    const parts = [
        stage?.targets ? `Targets: ${stage.targets}` : '',
        stage?.par     ? `PAR: ${stage.par}s`         : ''
    ].filter(Boolean);
    display.textContent = parts.join('  ·  ');
    display.style.display = parts.length ? 'block' : 'none';
}

function showShooterDivision() {
    const el = $('shooter-division-display');
    if (!el) return;
    const div = getPlayerDivision($('player-name').value);
    el.textContent = div ? `Division: ${div}` : '';
    el.style.display = div ? 'block' : 'none';
}

function toggleDNFFields() {
    const dnf = $('dnf').checked;
    if ($('time-row'))  $('time-row').style.display  = dnf ? 'none' : '';
    if ($('tnt-row'))   $('tnt-row').style.display   = dnf ? ''     : 'none';
    if ($('time'))      $('time').required = !dnf;
    if ($('dnf-group')) $('dnf-group').classList.toggle('dnf-active', dnf);
}

// --- Scores Display ---
async function updateUI() {
    const scores  = await getAllScores();
    const pending = scores.filter(s => !s.synced);

    $('pending-count').textContent = pending.length;

    const el = $('scores-container');
    if (!scores.length) {
        el.innerHTML = '<div class="empty-state">No scores yet. Add your first score above!</div>';
        return;
    }

    scores.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    // Detect duplicates (shooter+stage appearing more than once)
    const comboCounts = {};
    scores.forEach(s => {
        const key = `${s.playerName}||${s.stage}`;
        comboCounts[key] = (comboCounts[key] || 0) + 1;
    });

    el.innerHTML = scores.map(s => {
        const isDup = comboCounts[`${s.playerName}||${s.stage}`] > 1;
        return `
        <div class="score-item ${s.synced ? 'synced' : 'pending'}${isDup ? ' duplicate' : ''}">
            <div class="score-info">
                <h3>${s.playerName}${s.division ? ` <span class="score-division-tag">${s.division}</span>` : ''}${isDup ? ' <span class="duplicate-badge">⚠ Duplicate</span>' : ''}</h3>
                ${s.stage ? `<div class="score-stage-badge">${s.stage}</div>` : ''}
                <div class="score-meta">
                    ${new Date(s.timestamp).toLocaleString()}
                    ${s.notes ? `<br>📝 ${s.notes}` : ''}
                    <br><em>${s.synced ? '✓ Synced' : '⏳ Pending sync'}</em>
                </div>
            </div>
            <div class="score-details">
                <div class="score-value ${s.dnf ? 'dnf' : ''}">${s.dnf ? 'DNF' : s.time + 's'}</div>
                <div class="score-stats">
                    <span>Wait: ${formatWaitTime(s.waitTime)}</span>
                    <span>TNT: ${s.targetsNotNeutralized}</span>
                </div>
            </div>
        </div>`;
    }).join('');
}

// --- Online/Offline Status ---
function updateOnlineStatus() {
    const online = navigator.onLine;
    $('online-status').classList.toggle('online', online);
    $('online-status').classList.toggle('offline', !online);
    $('status-text').textContent = online ? 'Online' : 'Offline';
}
