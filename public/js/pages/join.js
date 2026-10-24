fillDepartmentOptions(document.getElementById('department-options'));

const STUDENT_EMAIL_DOMAIN = '@student.ndub.edu.bd';
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

// email must be an NDUB student address (checked again on the server)
const emailInput = document.getElementById('email');
emailInput.addEventListener('input', () => {
    const value = emailInput.value.trim().toLowerCase();
    emailInput.setCustomValidity(value && !value.endsWith(STUDENT_EMAIL_DOMAIN) ? 'NDUB student email required' : '');
});

// show the chosen photo, and refuse ones that are too big before uploading
const photoInput = document.getElementById('photo');
const preview = document.getElementById('photo-preview');
photoInput.addEventListener('change', () => {
    const file = photoInput.files[0];
    if (preview.src) URL.revokeObjectURL(preview.src);
    if (!file) {
        preview.classList.add('hidden');
        return;
    }
    photoInput.setCustomValidity(file.size > MAX_PHOTO_BYTES ? 'Photo too large' : '');
    photoInput.dataset.error = file.size > MAX_PHOTO_BYTES
        ? 'That photo is larger than 5 MB. Please choose a smaller one.'
        : 'Please add a recent photo of yourself (JPG, PNG or WEBP).';
    preview.src = URL.createObjectURL(file);
    preview.classList.remove('hidden');
});

// the fee amount comes from Admin > Settings > Club info
clubInfo().then(info => {
    if (info.membership_fee) document.getElementById('fee-amount').textContent = ` (${info.membership_fee})`;
});

setupForm('join-form', '/join-requests',
    "Thanks! Your application was sent. The committee will review it and contact you by email.",
    { onSuccess: () => preview.classList.add('hidden') });
