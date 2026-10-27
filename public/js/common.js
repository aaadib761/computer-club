// Shared code for every page: header, footer, and small helpers.

const NAV_LINKS = [
    { href: 'index.html', label: 'Home' },
    { href: 'events.html', label: 'Events' },
    { href: 'gallery.html', label: 'Gallery' },
    { href: 'committee.html', label: 'Committee' },
    { href: 'about.html', label: 'About' },
    { href: 'contact.html', label: 'Contact' },
    { href: 'portal.html', label: 'Member Login' },
];

function renderHeader() {
    const header = document.getElementById('site-header');
    if (!header) return;

    const current = location.pathname.split('/').pop() || 'index.html';
    const links = NAV_LINKS.map(link =>
        `<a href="${link.href}" class="${link.href === current ? 'active' : ''}">${link.label}</a>`
    ).join('');

    header.className = 'site-header';
    header.innerHTML = `
        <div class="container">
            <a class="brand" href="index.html">
                <img src="images/logo.png" alt="NDUB Computer Club logo">
                <span><b>NDUB</b> Computer Club</span>
            </a>
            <button class="nav-toggle" aria-label="Open menu" aria-expanded="false">&#9776;</button>
            <nav class="site-nav">
                ${links}
                <a href="join.html" class="nav-cta ${current === 'join.html' ? 'active' : ''}">Join Us</a>
            </nav>
        </div>`;

    const toggle = header.querySelector('.nav-toggle');
    const nav = header.querySelector('.site-nav');
    toggle.addEventListener('click', () => {
        const open = nav.classList.toggle('open');
        toggle.setAttribute('aria-expanded', open);
    });
}

function renderFooter() {
    const footer = document.getElementById('site-footer');
    if (!footer) return;
    footer.className = 'site-footer';
    footer.innerHTML = `
        <div class="container">
            <span>&copy; ${new Date().getFullYear()} <b>NDUB</b> Computer Club &middot; Notre Dame University Bangladesh</span>
            <span><a href="contact.html">Contact us</a> &middot; <a href="join.html">Become a member</a> &middot; <a href="verify.html">Verify a card</a>
                <button class="term-open" title="Open the secret terminal (or press \`)" aria-label="Open terminal">&gt;_</button></span>
        </div>
        <div class="container footer-social hidden" id="footer-social"></div>
        <div class="container credits">
            Developed by <b>Abdullah Ahsan</b> &amp; <b>Aloyshius Ryan Gomes</b>
        </div>`;

    clubInfo().then(info => {
        const links = socialLinks(info);
        if (!links.length) return;
        const box = document.getElementById('footer-social');
        box.innerHTML = links.map(l => `<a href="${escapeHtml(l.url)}" target="_blank" rel="noopener">${l.label}</a>`).join('');
        box.classList.remove('hidden');
    });
}

// Club contact details and social links, edited in Admin > Settings. Fetched once per page.
let clubInfoPromise;
function clubInfo() {
    clubInfoPromise ??= api('/settings').catch(() => ({}));
    return clubInfoPromise;
}

const SOCIAL_LABELS = { facebook: 'Facebook', instagram: 'Instagram', linkedin: 'LinkedIn', github: 'GitHub', youtube: 'YouTube' };
function socialLinks(info) {
    return Object.entries(SOCIAL_LABELS)
        .filter(([key]) => info[key])
        .map(([key, label]) => ({ label, url: info[key] }));
}

// Department suggestions on the Join form and in Admin > Members. Add new departments here.
const DEPARTMENTS = ['CSE', 'BBA', 'English', 'Law', 'Economics', 'Microbiology'];

function fillDepartmentOptions(datalist, extra = []) {
    const all = [...new Set([...DEPARTMENTS, ...extra])].sort((a, b) => a.localeCompare(b));
    datalist.innerHTML = all.map(d => `<option value="${escapeHtml(d)}">`).join('');
}

// Fetch JSON from our API; throws an Error with the server's message on failure.
// A FormData body (forms with a photo) is sent as-is; anything else is sent as JSON.
async function api(path, options = {}) {
    const isForm = options.body instanceof FormData;
    const res = await fetch(path, {
        ...options,
        headers: { ...(isForm ? {} : { 'Content-Type': 'application/json' }), ...(options.headers || {}) },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
    return data;
}

// Never put database text straight into innerHTML: escape it first.
function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Event dates are typed by admins ("2026-11-01" or "2026-11-01T18:00");
// created/posted times come from SQLite in UTC ("2026-10-22 04:23:51").
function parseDate(value, isUtc = false) {
    if (!value) return null;
    let text = String(value).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) text += 'T00:00';
    text = text.replace(' ', 'T');
    if (isUtc && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(text)) text += 'Z';
    const date = new Date(text);
    return isNaN(date) ? null : date;
}

function hasTime(value) {
    return /[T ]\d{2}:\d{2}/.test(String(value || ''));
}

function formatDate(value, { isUtc = false, withTime } = {}) {
    const date = parseDate(value, isUtc);
    if (!date) return escapeHtml(value);
    const showTime = withTime ?? hasTime(value);
    return date.toLocaleString('en-GB', {
        day: 'numeric', month: 'long', year: 'numeric',
        ...(showTime ? { hour: 'numeric', minute: '2-digit' } : {}),
    });
}

function dateBadge(value) {
    const date = parseDate(value);
    if (!date) return '<div class="date-badge"><span class="day">?</span></div>';
    return `<div class="date-badge">
        <span class="day">${date.getDate()}</span>
        <span class="mon">${date.toLocaleString('en-GB', { month: 'short' })}</span>
    </div>`;
}

function isUpcoming(value) {
    const date = parseDate(value);
    if (!date) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return date >= today;
}

// photo_path is stored like "uploads/wm-123.jpg"
function photoUrl(path) {
    return '/' + String(path).replace(/^\/+/, '');
}

function initials(name) {
    return String(name || '?').trim().split(/\s+/).slice(0, 2).map(part => part[0].toUpperCase()).join('');
}

// e.g. NDUBCC-EVT-0007, made from the event's id so it never needs typing
function eventCode(id) {
    return `NDUBCC-EVT-${String(id).padStart(4, '0')}`;
}

// Upcoming / Today / Completed, worked out from the date
function eventStatus(event) {
    const date = parseDate(event.date);
    if (!date) return { label: 'Scheduled', key: 'upcoming' };
    const today = new Date();
    if (date.toDateString() === today.toDateString()) return { label: 'Today', key: 'today' };
    return isUpcoming(event.date) ? { label: 'Upcoming', key: 'upcoming' } : { label: 'Completed', key: 'completed' };
}

function eventCard(event) {
    const past = !isUpcoming(event.date);
    const status = eventStatus(event);
    const details = [
        event.speaker ? `🎤 ${escapeHtml(event.speaker)}` : '',
        event.venue ? `📍 ${escapeHtml(event.venue)}` : '',
        past && event.attendees ? `👥 ${event.attendees} attended` : '',
    ].filter(Boolean).join(' · ');
    return `<a class="card event-card ${past ? 'past' : ''}" href="event.html?id=${encodeURIComponent(event.id)}">
        ${dateBadge(event.date)}
        <div>
            <div class="event-tags">
                ${event.category ? `<span class="tag">${escapeHtml(event.category)}</span>` : ''}
                <span class="tag tag-${status.key}">${status.label}</span>
            </div>
            <h3>${escapeHtml(event.title)}</h3>
            <div class="meta">${formatDate(event.date)}</div>
            ${details ? `<div class="meta">${details}</div>` : ''}
            ${event.description ? `<p>${escapeHtml(truncate(event.description, 140))}</p>` : ''}
        </div>
    </a>`;
}

function truncate(text, max) {
    text = String(text);
    return text.length > max ? text.slice(0, max - 1).trimEnd() + '…' : text;
}

function showMessage(element, type, text) {
    element.classList.remove('hidden', 'alert-success', 'alert-error');
    element.classList.add('alert', `alert-${type}`);
    element.textContent = text;
}

// Sends a public form (join / contact) to the API and shows the result.
// Forms with a file input (the Join photo) go as form-data, others as JSON.
function setupForm(formId, path, successText, { onSuccess } = {}) {
    const form = document.getElementById(formId);
    const message = form.querySelector('.form-message');
    const button = form.querySelector('button[type="submit"]');

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const invalid = form.querySelector(':invalid');
        if (invalid) {
            // a field can give its own message with data-error="..."
            const label = invalid.labels?.[0]?.childNodes[0]?.textContent.trim() || 'the highlighted field';
            const hasValue = invalid.type === 'file' ? invalid.files.length : invalid.value.trim();
            showMessage(message, 'error', invalid.dataset.error || (hasValue
                ? `Please check "${label}" — it doesn't look right.`
                : `Please fill in "${label}".`));
            message.scrollIntoView({ behavior: 'smooth', block: 'center' });
            invalid.focus({ preventScroll: true });
            return;
        }

        let body;
        if (form.querySelector('input[type="file"]')) {
            body = new FormData(form);
        } else {
            const data = Object.fromEntries(new FormData(form));
            Object.keys(data).forEach(key => { data[key] = data[key].trim(); });
            body = JSON.stringify(data);
        }

        button.disabled = true;
        button.textContent = 'Sending…';
        try {
            await api(path, { method: 'POST', body });
            showMessage(message, 'success', successText);
            form.reset();
            if (onSuccess) onSuccess();
        } catch (err) {
            showMessage(message, 'error', err.message);
        } finally {
            message.scrollIntoView({ behavior: 'smooth', block: 'center' });
            button.disabled = false;
            button.textContent = button.dataset.label;
        }
    });
    button.dataset.label = button.textContent;
}

// ---------- animations ----------

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Cards slide in the first time they scroll into view. Pages render cards
// after loading data, so new cards are picked up automatically.
const revealObserver = 'IntersectionObserver' in window
    ? new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (!entry.isIntersecting) return;
            const el = entry.target;
            el.classList.add('revealed');
            revealObserver.unobserve(el);
            // once it has appeared, drop the animation styles so hover effects stay snappy
            el.addEventListener('transitionend', () => {
                el.classList.remove('reveal', 'revealed');
                el.style.transitionDelay = '';
            }, { once: true });
        });
    }, { threshold: 0.12 })
    : null;

function revealCards(root) {
    if (!revealObserver || prefersReducedMotion) return;
    root.querySelectorAll('.card:not([data-revealed]), .stat:not([data-revealed]), .gallery figure:not([data-revealed])').forEach((el, i) => {
        el.dataset.revealed = '';
        el.classList.add('reveal');
        el.style.transitionDelay = `${Math.min(i % 6, 5) * 70}ms`;
        revealObserver.observe(el);
    });
}

function watchForCards() {
    const main = document.querySelector('main');
    if (!main) return;
    revealCards(main);
    new MutationObserver(() => revealCards(main)).observe(main, { childList: true, subtree: true });
}

// Counts a number up from 0 to element.dataset.count once it's visible.
function countUpWhenVisible(element) {
    const target = Number(element.dataset.count) || 0;
    const run = () => {
        if (prefersReducedMotion || target === 0) {
            element.textContent = target;
            return;
        }
        const duration = 1200;
        const startTime = performance.now();
        const step = (now) => {
            const progress = Math.min((now - startTime) / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 3);
            element.textContent = Math.round(target * eased);
            if (progress < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
    };
    if (!('IntersectionObserver' in window)) return run();
    const observer = new IntersectionObserver(([entry]) => {
        if (!entry.isIntersecting) return;
        observer.disconnect();
        run();
    });
    observer.observe(element);
}

renderHeader();
renderFooter();

// admin pages reuse the helpers above but skip the public-site extras
if (!document.body.classList.contains('admin')) {
    watchForCards();

    // the secret terminal lives in its own file, loaded on every public page
    const terminalScript = document.createElement('script');
    terminalScript.src = '/js/terminal.js';
    document.body.appendChild(terminalScript);
}
