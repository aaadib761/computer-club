if (currentAdmin()) location.href = 'index.html';

const form = document.getElementById('login-form');
const message = form.querySelector('.form-message');
const codeForm = document.getElementById('code-form');
const codeMessage = codeForm.querySelector('.form-message');

if (new URLSearchParams(location.search).get('reason') === 'expired') {
    showMessage(message, 'error', 'Your session ended. Please log in again.');
}

// set after a correct password when the account uses 2-step login; only good for the code step
let ticket = null;
let loginName = '';

function loggedIn(token) {
    storageSet(TOKEN_KEY, token);
    storageSet(NAME_KEY, loginName);
    location.href = 'index.html';
}

form.addEventListener('submit', (e) => {
    e.preventDefault();
    const { username, password } = readForm(form);
    if (!username || !password) return showMessage(message, 'error', 'Please enter your username and password.');

    submitting(form, async () => {
        const result = await api('/admin/login', {
            method: 'POST',
            body: JSON.stringify({ username, password }),
        });
        loginName = username;
        if (!result.twoFactor) return loggedIn(result.token);
        ticket = result.ticket;
        form.reset();
        form.classList.add('hidden');
        codeForm.classList.remove('hidden');
        codeForm.elements.code.focus();
    });
});

codeForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const code = codeForm.elements.code.value.trim();
    if (!code) return showMessage(codeMessage, 'error', 'Please type the code from your app.');
    submitting(codeForm, async () => {
        try {
            const { token } = await api('/admin/login/2fa', { method: 'POST', body: JSON.stringify({ ticket, code }) });
            loggedIn(token);
        } catch (err) {
            codeForm.elements.code.value = '';
            // the ticket only lasts 5 minutes; after that, start again from the password
            if (/took too long/.test(err.message)) backToPassword(err.message);
            throw err;
        }
    });
});

function backToPassword(notice) {
    ticket = null;
    codeForm.reset();
    codeForm.classList.add('hidden');
    form.classList.remove('hidden');
    if (notice) showMessage(message, 'error', notice);
    form.elements.username.focus();
}
document.getElementById('code-back').addEventListener('click', () => backToPassword());
