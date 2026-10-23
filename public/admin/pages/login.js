if (currentAdmin()) location.href = 'index.html';

const form = document.getElementById('login-form');
const message = form.querySelector('.form-message');

if (new URLSearchParams(location.search).get('reason') === 'expired') {
    showMessage(message, 'error', 'Your session ended. Please log in again.');
}

form.addEventListener('submit', (e) => {
    e.preventDefault();
    const { username, password } = readForm(form);
    if (!username || !password) return showMessage(message, 'error', 'Please enter your username and password.');

    submitting(form, async () => {
        const { token } = await api('/admin/login', {
            method: 'POST',
            body: JSON.stringify({ username, password }),
        });
        storageSet(TOKEN_KEY, token);
        storageSet(NAME_KEY, username);
        location.href = 'index.html';
    });
});
