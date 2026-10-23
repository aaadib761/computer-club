async function loadEvents() {
    const upcomingBox = document.getElementById('upcoming');
    const pastBox = document.getElementById('past');
    try {
        const events = await api('/events');
        const byDate = (a, b) => parseDate(a.date) - parseDate(b.date);
        const upcoming = events.filter(e => isUpcoming(e.date)).sort(byDate);
        const past = events.filter(e => !isUpcoming(e.date)).sort(byDate).reverse();

        upcomingBox.innerHTML = upcoming.length
            ? upcoming.map(eventCard).join('')
            : '<div class="empty">No upcoming events right now. Stay tuned!</div>';
        pastBox.innerHTML = past.length
            ? past.map(eventCard).join('')
            : '<div class="empty">No past events yet.</div>';
    } catch (err) {
        const message = `<div class="empty">Couldn't load events. ${escapeHtml(err.message)}</div>`;
        upcomingBox.innerHTML = message;
        pastBox.innerHTML = '';
    }
}

loadEvents();
