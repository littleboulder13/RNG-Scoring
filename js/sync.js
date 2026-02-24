/* =============================================================
   Network Sync
   ============================================================= */
async function syncScores() {
    if (!navigator.onLine) return alert('Cannot sync while offline');
    const pending = await getPendingScores();
    if (!pending.length) return alert('No scores to sync');

    try {
        // TODO: Replace with your actual API endpoint
        const res = await fetch('https://your-api-endpoint.com/api/scores', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(pending)
        });
        if (!res.ok) throw new Error('Sync failed');
        for (const s of pending) await markAsSynced(s.id);
        alert(`Successfully synced ${pending.length} scores`);
        updateUI();
    } catch (err) {
        console.error('Sync error:', err);
        alert('Sync failed. Scores are saved locally and will sync when possible.');
    }
}
