renderAdminLayout('events.html');

let events = [];
let editingId = null;

const list = document.getElementById('list');
const filter = document.getElementById('filter');
const dialog = document.getElementById('event-dialog');
const form = document.getElementById('event-form');

// "2026-11-15T15:00" -> { date: "2026-11-15", time: "15:00" }
function splitDate(value) {
    const match = String(value || '').match(/^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}))?/);
    return match ? { date: match[1], time: match[2] || '' } : { date: '', time: '' };
}

async function load() {
    try {
        events = await adminApi('/events');
        render();
    } catch (err) {
        list.innerHTML = `<div class="empty">${escapeHtml(err.message)}</div>`;
    }
}

function render() {
    const byDate = (a, b) => parseDate(a.date) - parseDate(b.date);
    let shown;
    if (filter.value === 'upcoming') shown = events.filter(e => isUpcoming(e.date)).sort(byDate);
    else if (filter.value === 'past') shown = events.filter(e => !isUpcoming(e.date)).sort(byDate).reverse();
    else shown = [...events].sort(byDate).reverse();

    if (!shown.length) {
        list.innerHTML = `<div class="empty">No ${filter.value === 'all' ? '' : filter.value + ' '}events.</div>`;
        return;
    }
    list.innerHTML = shown.map(e => `
        <div class="row">
            ${dateBadge(e.date)}
            <div class="row-main">
                <h3>${escapeHtml(e.title)}
                    ${e.category ? `<span class="badge badge-role">${escapeHtml(e.category)}</span>` : ''}
                    ${isUpcoming(e.date) ? '<span class="badge badge-upcoming">upcoming</span>' : ''}
                </h3>
                <p class="meta">${[
                    formatDate(e.date),
                    e.venue ? escapeHtml(e.venue) : '',
                    e.speaker ? `🎤 ${escapeHtml(e.speaker)}` : '',
                    !isUpcoming(e.date) ? `👥 ${e.attendees} attended` : '',
                    e.registration_open || e.registered ? `📝 ${e.registered}${e.capacity ? ` / ${e.capacity}` : ''} registered` : '',
                    eventCode(e.id),
                ].filter(Boolean).join(' · ')}</p>
                ${e.description ? `<p class="row-text">${escapeHtml(truncate(e.description, 160))}</p>` : ''}
            </div>
            <div class="btn-group">
                <a class="btn btn-sm" href="event.html?id=${encodeURIComponent(e.id)}">Attendance &amp; photos</a>
                <button class="btn btn-sm btn-ghost" data-action="edit" data-id="${e.id}">Edit</button>
                <button class="btn btn-sm btn-danger" data-action="delete" data-id="${e.id}">Delete</button>
            </div>
        </div>`).join('');
}

filter.addEventListener('change', render);

document.getElementById('add-btn').addEventListener('click', () => {
    editingId = null;
    document.getElementById('event-dialog-title').textContent = 'Add event';
    form.reset();
    openModal(dialog);
});

list.addEventListener('click', async (e) => {
    const button = e.target.closest('button[data-action]');
    if (!button) return;
    const event = events.find(ev => ev.id === Number(button.dataset.id));

    if (button.dataset.action === 'edit') {
        editingId = event.id;
        document.getElementById('event-dialog-title').textContent = 'Edit event';
        fillForm(form, { ...event, ...splitDate(event.date) });
        form.elements.registration_open.checked = !!event.registration_open;
        openModal(dialog);
    }

    if (button.dataset.action === 'delete') {
        if (!(await confirmBox({ title: `Delete "${event.title}"?`, message: 'Its attendance records and gallery photos will be deleted too.' }))) return;
        try {
            await adminApi(`/events/${event.id}`, { method: 'DELETE' });
            toast('Event deleted');
            load();
        } catch (err) {
            toast(err.message, 'error');
        }
    }
});

form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (form.querySelector(':invalid')) {
        return showMessage(form.querySelector('.form-message'), 'error', 'Please enter a title and a date.');
    }
    const data = readForm(form);
    const body = {
        title: data.title,
        description: data.description || null,
        date: data.time ? `${data.date}T${data.time}` : data.date,
        category: data.category || null,
        speaker: data.speaker || null,
        speaker_title: data.speaker_title || null,
        venue: data.venue || null,
        duration: data.duration || null,
        registration_open: form.elements.registration_open.checked,
        capacity: data.capacity ? Number(data.capacity) : null,
    };
    submitting(form, async () => {
        if (editingId) {
            await adminApi(`/events/${editingId}`, { method: 'PUT', body });
            toast('Event updated');
        } else {
            await adminApi('/events', { method: 'POST', body });
            toast('Event added');
        }
        dialog.close();
        load();
    });
});

load();
