/* =============================================================
   Local Storage — Stage Management
   ============================================================= */
function getStages() {
    const raw = localStorage.getItem('rng_stages');
    if (!raw) return [];
    // Migrate old plain-string format → { name, targets, par }
    return JSON.parse(raw).map(s =>
        typeof s === 'string' ? { name: s, targets: '', par: '' } : s
    );
}

function saveStages(list) {
    localStorage.setItem('rng_stages', JSON.stringify(list));
}

function addStage(name, targets = '', par = '') {
    const stages = getStages();
    if (stages.find(s => s.name === name)) return;
    stages.push({ name, targets, par });
    saveStages(stages);
    populateStageDropdown();
    renderStagesList();
}

function removeStage(name) {
    saveStages(getStages().filter(s => s.name !== name));
    populateStageDropdown();
    renderStagesList();
}

function updateStage(oldName, newName, targets, par) {
    const stages = getStages();
    const idx = stages.findIndex(s => s.name === oldName);
    if (idx === -1) return;
    if (newName !== oldName && stages.find(s => s.name === newName)) {
        alert(`A stage named "${newName}" already exists.`);
        return;
    }
    stages[idx] = { name: newName, targets, par };
    saveStages(stages);
    populateStageDropdown();
    renderStagesList();
}
