let events = [];

// the filters live in the address (events.html?q=python&category=Workshop&year=2026), so a filtered list can be shared
const params = new URLSearchParams(location.search);
let category = params.get('category') || '';   // '' = all categories
const search = document.getElementById('search');
const yearFilter = document.getElementById('year-filter');
search.value = params.get('q') || '';

function eventYear(event) {
    return String(event.date || '').slice(0, 4);
}

function matchesSearch(event, q) {
    return !q || [event.title, event.description, event.speaker, event.speaker_title, event.venue, event.category]
        .some(v => (v || '').toLowerCase().includes(q));
}

function saveFiltersInAddress() {
    const next = new URLSearchParams();
    if (search.value.trim()) next.set('q', search.value.trim());
    if (category) next.set('category', category);
    if (yearFilter.value) next.set('year', yearFilter.value);
    history.replaceState(null, '', next.toString() ? `?${next}` : location.pathname);
}

function renderEvents() {
    const upcomingBox = document.getElementById('upcoming');
    const pastBox = document.getElementById('past');
    const q = search.value.trim().toLowerCase();
    const shown = events.filter(e => (!category || e.category === category)
        && (!yearFilter.value || eventYear(e) === yearFilter.value)
        && matchesSearch(e, q));
    const byDate = (a, b) => parseDate(a.date) - parseDate(b.date);
    const upcoming = shown.filter(e => isUpcoming(e.date)).sort(byDate);
    const past = shown.filter(e => !isUpcoming(e.date)).sort(byDate).reverse();
    const label = category ? `${category.toLowerCase()} ` : '';
    const filtering = q || yearFilter.value;

    const count = document.getElementById('result-count');
    count.textContent = `${shown.length} of ${events.length} events match.`;
    count.classList.toggle('hidden', !filtering && !category);

    upcomingBox.innerHTML = upcoming.length
        ? upcoming.map(eventCard).join('')
        : `<div class="empty">${filtering ? 'No upcoming events match your search.' : `No upcoming ${label}events right now. Stay tuned!`}</div>`;
    pastBox.innerHTML = past.length
        ? past.map(eventCard).join('')
        : `<div class="empty">${filtering ? 'No past events match your search.' : `No past ${label}events yet.`}</div>`;
    saveFiltersInAddress();
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

// newest year first; only years that have events
function renderYears() {
    const years = [...new Set(events.map(eventYear).filter(y => /^\d{4}$/.test(y)))].sort().reverse();
    yearFilter.innerHTML = '<option value="">All years</option>' + years.map(y => `<option value="${y}">${y}</option>`).join('');
    yearFilter.value = years.includes(params.get('year')) ? params.get('year') : '';
    yearFilter.classList.toggle('hidden', years.length < 2);
}

document.getElementById('category-chips').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-category]');
    if (!chip) return;
    category = chip.dataset.category;
    renderChips();
    renderEvents();
});
search.addEventListener('input', renderEvents);
yearFilter.addEventListener('change', renderEvents);

// webcal:// makes calendar apps (Apple Calendar, Outlook) subscribe instead of importing once
document.getElementById('subscribe-link').href = `webcal://${location.host}/calendar.ics`;

async function loadEvents() {
    try {
        events = await api('/events');
        if (category && !events.some(e => e.category === category)) category = '';
        renderChips();
        renderYears();
        renderEvents();
    } catch (err) {
        document.getElementById('upcoming').innerHTML = `<div class="empty">Couldn't load events. ${escapeHtml(err.message)}</div>`;
        document.getElementById('past').innerHTML = '';
    }
}

loadEvents();
