// Event page: register for an upcoming event, or download a certificate afterwards.
// Members identify themselves with their club ID + student ID. Uses eventId from event.js.
const actionsBox = document.getElementById('event-actions');

// the two ID fields both forms use
const ID_FIELDS = `
    <div class="field-row">
        <div class="field">
            <label for="act-club-id">Club ID</label>
            <input id="act-club-id" name="club_id" required maxlength="30" placeholder="e.g. NDUBCC-001" autocomplete="off">
        </div>
        <div class="field">
            <label for="act-student-id">Student ID</label>
            <input id="act-student-id" name="student_id" required maxlength="30" autocomplete="off">
        </div>
    </div>`;

function idValues(form) {
    return { club_id: form.elements.club_id.value.trim(), student_id: form.elements.student_id.value.trim() };
}

function registrationBox(event) {
    const full = event.capacity && event.registered >= event.capacity;
    const seats = event.capacity
        ? `${event.registered} of ${event.capacity} seats taken${full ? '' : ` · ${event.capacity - event.registered} left`}`
        : `${event.registered} registered so far`;
    return `
        <form class="card action-card" id="register-form" novalidate>
            <h2>📝 Register for this event</h2>
            <p class="meta">${seats}</p>
            ${event.capacity ? `<div class="seat-bar"><span style="width:${Math.min(100, Math.round(event.registered / event.capacity * 100))}%"></span></div>` : ''}
            <div class="form-message hidden" role="status"></div>
            ${ID_FIELDS}
            <div class="btn-group">
                <button class="btn" type="submit" ${full ? 'disabled' : ''}>${full ? 'All seats taken' : 'Register'}</button>
                <button class="btn btn-ghost" type="button" id="unregister-btn">Cancel my registration</button>
            </div>
            <p class="meta" style="margin: 12px 0 0;">Not a member yet? <a href="join.html">Join the club</a> first.</p>
        </form>`;
}

function certificateBox() {
    return `
        <form class="card action-card" id="certificate-form" novalidate>
            <h2>🎓 Get your certificate</h2>
            <p class="meta">Attended this event? Enter your IDs to download your participation certificate.</p>
            <div class="form-message hidden" role="status"></div>
            ${ID_FIELDS}
            <button class="btn" type="submit">Get certificate</button>
        </form>`;
}

async function sendIds(form, path, button) {
    const message = form.querySelector('.form-message');
    const ids = idValues(form);
    if (!ids.club_id || !ids.student_id) {
        showMessage(message, 'error', 'Please enter both your club ID and student ID.');
        return null;
    }
    const label = button.textContent;
    button.disabled = true;
    button.textContent = 'Please wait…';
    try {
        return await api(path, { method: 'POST', body: JSON.stringify({ ...ids, event_id: Number(eventId) }) });
    } catch (err) {
        showMessage(message, 'error', err.message);
        return null;
    } finally {
        button.disabled = false;
        button.textContent = label;
    }
}

async function loadActions() {
    if (!eventId) return;
    let event;
    try {
        event = await api(`/events/${encodeURIComponent(eventId)}`);
    } catch {
        return;  // event.js already shows "Event not found"
    }
    const upcoming = isUpcoming(event.date) && eventStatus(event).key !== 'today';

    if (upcoming && event.registration_open) {
        actionsBox.innerHTML = registrationBox(event);
        const form = document.getElementById('register-form');
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const result = await sendIds(form, `/events/${encodeURIComponent(eventId)}/register`, form.querySelector('button[type="submit"]'));
            if (!result) return;
            await loadActions();
            showMessage(document.querySelector('#register-form .form-message'), 'success',
                result.already ? `${result.name}, you're already registered. See you there!` : `Done! ${result.name}, you're registered. See you there!`);
        });
        document.getElementById('unregister-btn').addEventListener('click', async (e) => {
            const result = await sendIds(form, `/events/${encodeURIComponent(eventId)}/unregister`, e.currentTarget);
            if (!result) return;
            await loadActions();
            showMessage(document.querySelector('#register-form .form-message'), 'success', `${result.name}, your registration was cancelled.`);
        });
    } else if (!upcoming) {
        actionsBox.innerHTML = certificateBox();
        const form = document.getElementById('certificate-form');
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const result = await sendIds(form, '/certificates/claim', form.querySelector('button[type="submit"]'));
            if (result) location.href = `certificate.html?code=${encodeURIComponent(result.code)}`;
        });
    }
}

loadActions();
