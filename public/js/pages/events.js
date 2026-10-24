let events = [];
let category = '';   // '' = all categories

function renderEvents() {
    const upcomingBox = document.getElementById('upcoming');
    const pastBox = document.getElementById('past');
    const shown = category ? events.filter(e => e.category === category) : events;
    const byDate = (a, b) => parseDate(a.date) - parseDate(b.date);
    const upcoming = shown.filter(e => isUpcoming(e.date)).sort(byDate);
    const past = shown.filter(e => !isUpcoming(e.date)).sort(byDate).reverse();
    const label = category ? `${category.toLowerCase()} ` : '';

    upcomingBox.innerHTML = upcoming.length
        ? upcoming.map(eventCard).join('')
        : `<div class="empty">No upcoming ${label}events right now. Stay tuned!</div>`;
    pastBox.innerHTML = past.length
        ? past.map(eventCard).join('')
        : `<div class="empty">No past ${label}events yet.</div>`;
}

// one chip per category that actually has events, plus "All"
function renderChips() {
    const box = document.getElementById('category-chips');
    const used = [...new Set(events.map(e => e.category).filter(Boolean))].sort();
    if (!used.length) {
        box.classList.add('hidden');
        return;
    }
    box.innerHTML = ['', ...used].map(c => `
        <button type="button" class="chip ${c === category ? 'active' : ''}" data-category="${escapeHtml(c)}" aria-pressed="${c === category}">
            ${c ? escapeHtml(c) : 'All'}
        </button>`).join('');
}

document.getElementById('category-chips').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-category]');
    if (!chip) return;
    category = chip.dataset.category;
    renderChips();
    renderEvents();
});

async function loadEvents() {
    try {
        events = await api('/events');
        renderChips();
        renderEvents();
    } catch (err) {
        document.getElementById('upcoming').innerHTML = `<div class="empty">Couldn't load events. ${escapeHtml(err.message)}</div>`;
        document.getElementById('past').innerHTML = '';
    }
}

loadEvents();
