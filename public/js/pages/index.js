const SHOW_FIRST = 3;

async function loadAnnouncements() {
    const box = document.getElementById('announcements');
    try {
        const announcements = await api('/announcements');
        if (announcements.length === 0) {
            box.innerHTML = '<div class="empty">No announcements yet. Check back soon!</div>';
            return;
        }
        const render = (list) => list.map(a => `
            <article class="card">
                <h3>${escapeHtml(a.title)}</h3>
                <div class="meta">${formatDate(a.posted_at, { isUtc: true, withTime: false })}</div>
                <p class="text-pre">${escapeHtml(a.body)}</p>
            </article>`).join('');

        box.innerHTML = render(announcements.slice(0, SHOW_FIRST));
        if (announcements.length > SHOW_FIRST) {
            const wrap = document.getElementById('announcements-more-wrap');
            wrap.classList.remove('hidden');
            document.getElementById('announcements-more').addEventListener('click', () => {
                box.innerHTML = render(announcements);
                wrap.classList.add('hidden');
            });
        }
    } catch (err) {
        box.innerHTML = `<div class="empty">Couldn't load announcements. ${escapeHtml(err.message)}</div>`;
    }
}

async function loadUpcoming() {
    const box = document.getElementById('upcoming');
    try {
        const events = await api('/events');
        const upcoming = events
            .filter(e => isUpcoming(e.date))
            .sort((a, b) => parseDate(a.date) - parseDate(b.date));
        box.innerHTML = upcoming.length
            ? upcoming.slice(0, 3).map(eventCard).join('')
            : '<div class="empty">No upcoming events right now. Stay tuned!</div>';
        if (upcoming.length) startCountdown(upcoming[0]);
    } catch (err) {
        box.innerHTML = `<div class="empty">Couldn't load events. ${escapeHtml(err.message)}</div>`;
    }
}

// live "Next up" timer in the hero for the soonest upcoming event
function startCountdown(event) {
    const box = document.getElementById('countdown');
    const timer = document.getElementById('countdown-timer');
    const start = parseDate(event.date);
    box.href = `event.html?id=${encodeURIComponent(event.id)}`;
    document.getElementById('countdown-title').textContent = event.title;
    box.classList.remove('hidden');

    const pad = n => String(n).padStart(2, '0');
    function update() {
        const ms = start - Date.now();
        if (ms <= 0) {
            timer.innerHTML = '<span class="unit"><b>Today!</b></span>';
            return;
        }
        const s = Math.floor(ms / 1000);
        const parts = [
            [Math.floor(s / 86400), 'd'],
            [pad(Math.floor(s / 3600) % 24), 'h'],
            [pad(Math.floor(s / 60) % 60), 'm'],
            [pad(s % 60), 's'],
        ];
        timer.innerHTML = parts.map(([value, unit]) => `<span class="unit"><b>${value}</b>${unit}</span>`).join('');
        setTimeout(update, 1000);
    }
    update();
}

async function loadStats() {
    try {
        const stats = await api('/stats');
        document.querySelectorAll('[data-stat]').forEach(el => {
            el.dataset.count = stats[el.dataset.stat] ?? 0;
            countUpWhenVisible(el);
        });
    } catch (err) {
        document.querySelector('.stats').classList.add('hidden');
    }
}

loadAnnouncements();
loadUpcoming();
loadStats();
