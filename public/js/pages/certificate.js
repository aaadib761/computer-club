// Certificate of participation: certificate.html?code=NDUBCC-6-12-1A2B3C4D5E
// Loading it from the server is also the proof that it's real.
const code = new URLSearchParams(location.search).get('code');
const status = document.getElementById('cert-status');

async function loadCertificate() {
    if (!code) {
        status.innerHTML = '<div class="alert alert-error">No certificate code given.</div>';
        return;
    }
    let cert;
    try {
        cert = await api(`/certificates/${encodeURIComponent(code)}`);
    } catch (err) {
        status.innerHTML = `<div class="alert alert-error">❌ ${escapeHtml(err.message)} If someone showed you this certificate, it may not be genuine.</div>`;
        return;
    }

    const { event } = cert;
    const kind = event.category ? event.category.toLowerCase() : 'event';
    const parts = [`participated in the ${escapeHtml(kind)} <b>“${escapeHtml(event.title)}”</b>`];
    parts.push(`held on <b>${formatDate(event.date, { withTime: false })}</b>`);
    if (event.venue) parts.push(`at ${escapeHtml(event.venue)}`);
    let text = parts.join(' ');
    if (event.speaker) text += `, conducted by ${escapeHtml(event.speaker)}`;

    document.title = `Certificate — ${cert.name} | NDUB Computer Club`;
    document.getElementById('cert-name').textContent = cert.name;
    document.getElementById('cert-text').innerHTML = `${text}.`;
    document.getElementById('sign-president').textContent = cert.president || '';
    document.getElementById('sign-moderator').textContent = cert.moderator || '';
    document.getElementById('cert-code').textContent = cert.code;
    document.getElementById('cert-qr').src = `/certificates/${encodeURIComponent(cert.code)}/qr`;

    status.innerHTML = `<div class="alert alert-success">✅ This certificate is authentic: it was issued by NDUB Computer Club to ${escapeHtml(cert.name)}.</div>`;
    document.getElementById('certificate').classList.remove('hidden');
    document.getElementById('print-btn').disabled = false;
}

document.getElementById('print-btn').addEventListener('click', () => window.print());

loadCertificate();
