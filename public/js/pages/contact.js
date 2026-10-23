setupForm('contact-form', '/contact', "Thanks! Your message was sent. We'll reply as soon as we can.");

clubInfo().then(info => {
    const items = [];
    if (info.contact_email) items.push(`<li>✉️ <a href="mailto:${escapeHtml(info.contact_email)}">${escapeHtml(info.contact_email)}</a></li>`);
    if (info.contact_phone) items.push(`<li>📞 <a href="tel:${escapeHtml(info.contact_phone.replace(/[^\d+]/g, ''))}">${escapeHtml(info.contact_phone)}</a></li>`);
    if (info.address) items.push(`<li>📍 ${escapeHtml(info.address)}</li>`);
    socialLinks(info).forEach(l => items.push(`<li>🔗 <a href="${escapeHtml(l.url)}" target="_blank" rel="noopener">${l.label}</a></li>`));
    if (!items.length) return;
    document.getElementById('club-info-list').innerHTML = items.join('');
    document.getElementById('club-info').classList.remove('hidden');
});
