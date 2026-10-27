// All event photos, grouped into one album per event.
const albumsBox = document.getElementById('albums');
setupLightbox(albumsBox);

let photos = [];

// the filters live in the address (gallery.html?q=fest&year=2026), so a filtered view can be shared
const params = new URLSearchParams(location.search);
let category = params.get('category') || '';   // '' = all categories
const search = document.getElementById('search');
const yearFilter = document.getElementById('year-filter');
search.value = params.get('q') || '';

const photoYear = p => String(p.event_date || '').slice(0, 4);

function saveFiltersInAddress() {
    const next = new URLSearchParams();
    if (search.value.trim()) next.set('q', search.value.trim());
    if (category) next.set('category', category);
    if (yearFilter.value) next.set('year', yearFilter.value);
    history.replaceState(null, '', next.toString() ? `?${next}` : location.pathname);
}

function renderAlbums() {
    const q = search.value.trim().toLowerCase();
    const shown = photos.filter(p => (!category || p.category === category)
        && (!yearFilter.value || photoYear(p) === yearFilter.value)
        && (!q || [p.event_title, p.caption].some(v => (v || '').toLowerCase().includes(q))));
    const filtering = q || yearFilter.value || category;
    const count = document.getElementById('result-count');
    const albumCount = new Set(shown.map(p => p.event_id)).size;
    count.textContent = `${shown.length} photo${shown.length === 1 ? '' : 's'} from ${albumCount} event${albumCount === 1 ? '' : 's'}.`;
    count.classList.toggle('hidden', !filtering || !shown.length);
    saveFiltersInAddress();

    if (!shown.length) {
        albumsBox.innerHTML = `<div class="empty">${photos.length
            ? (q || yearFilter.value ? 'No photos match your search.' : 'No photos in this category yet.')
            : 'No photos yet. Check back after our next event!'}</div>`;
        return;
    }

    // photos arrive sorted by event date, so grouping keeps that order
    const albums = [];
    shown.forEach(p => {
        let album = albums.find(a => a.event_id === p.event_id);
        if (!album) albums.push(album = { event_id: p.event_id, title: p.event_title, date: p.event_date, photos: [] });
        album.photos.push(p);
    });

    albumsBox.innerHTML = albums.map(a => `
        <section class="album">
            <div class="section-title">
                <h2 style="font-size: 1.2rem;">${escapeHtml(a.title)}</h2>
                <a href="event.html?id=${encodeURIComponent(a.event_id)}">${formatDate(a.date, { withTime: false })} · Event details &rarr;</a>
            </div>
            <div class="gallery">
                ${a.photos.map(p => `
                    <figure>
                        <a href="${escapeHtml(photoUrl(p.photo_path))}" data-caption="${escapeHtml(p.caption || a.title)}">
                            <img src="${escapeHtml(photoUrl(p.photo_path))}" alt="${escapeHtml(p.caption || a.title)}" loading="lazy">
                        </a>
                        ${p.caption ? `<figcaption>${escapeHtml(p.caption)}</figcaption>` : ''}
                    </figure>`).join('')}
            </div>
        </section>`).join('');
}

function renderChips() {
    const box = document.getElementById('category-chips');
    const used = [...new Set(photos.map(p => p.category).filter(Boolean))].sort();
    if (used.length < 2) {
        box.classList.add('hidden');
        return;
    }
    box.innerHTML = ['', ...used].map(c => `
        <button type="button" class="chip ${c === category ? 'active' : ''}" data-category="${escapeHtml(c)}" aria-pressed="${c === category}">
            ${c ? escapeHtml(c) : 'All'}
        </button>`).join('');
}

// newest year first; hidden when every photo is from the same year
function renderYears() {
    const years = [...new Set(photos.map(photoYear).filter(y => /^\d{4}$/.test(y)))].sort().reverse();
    yearFilter.innerHTML = '<option value="">All years</option>' + years.map(y => `<option value="${y}">${y}</option>`).join('');
    yearFilter.value = years.includes(params.get('year')) ? params.get('year') : '';
    yearFilter.classList.toggle('hidden', years.length < 2);
}

document.getElementById('category-chips').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-category]');
    if (!chip) return;
    category = chip.dataset.category;
    renderChips();
    renderAlbums();
});
search.addEventListener('input', renderAlbums);
yearFilter.addEventListener('change', renderAlbums);

async function loadGallery() {
    try {
        photos = await api('/photos');
        if (category && !photos.some(p => p.category === category)) category = '';
        renderChips();
        renderYears();
        renderAlbums();
    } catch (err) {
        albumsBox.innerHTML = `<div class="empty">Couldn't load photos. ${escapeHtml(err.message)}</div>`;
    }
}

loadGallery();
