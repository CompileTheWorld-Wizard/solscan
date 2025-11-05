/**
 * Password Management Module
 */

/**
 * Validate password requirements
 * - At least 6 characters
 * - At least one uppercase letter
 * - At least one number
 */
export function validatePassword(password) {
    if (!password || password.length < 6) {
        return { valid: false, error: 'Password must be at least 6 characters long' };
    }
    
    if (!/[A-Z]/.test(password)) {
        return { valid: false, error: 'Password must contain at least one uppercase letter' };
    }
    
    if (!/[0-9]/.test(password)) {
        return { valid: false, error: 'Password must contain at least one number' };
    }
    
    return { valid: true, error: null };
}

/**
 * Open password change modal
 */
export function openPasswordChangeModal() {
    const modal = document.getElementById('passwordChangeModal');
    if (modal) {
        modal.classList.add('active');
        // Clear form
        document.getElementById('passwordChangeForm').reset();
        document.getElementById('passwordChangeError').textContent = '';
        document.getElementById('passwordChangeError').style.color = '#ef4444';
    }
}

/**
 * Close password change modal
 */
export function closePasswordChangeModal() {
    const modal = document.getElementById('passwordChangeModal');
    if (modal) {
        modal.classList.remove('active');
        // Clear form
        document.getElementById('passwordChangeForm').reset();
        document.getElementById('passwordChangeError').textContent = '';
    }
}

/**
 * Handle password change form submission
 */
export async function handlePasswordChange(event) {
    if (event) {
        event.preventDefault();
    }
    
    const currentPassword = document.getElementById('currentPassword').value.trim();
    const newPassword = document.getElementById('newPassword').value.trim();
    const confirmPassword = document.getElementById('confirmPassword').value.trim();
    const errorDiv = document.getElementById('passwordChangeError');
    const submitBtn = document.getElementById('passwordChangeBtn');
    
    // Clear previous error
    errorDiv.textContent = '';
    
    // Validate inputs
    if (!currentPassword || !newPassword || !confirmPassword) {
        errorDiv.textContent = '❌ All fields are required';
        return;
    }
    
    // Validate new password matches confirmation
    if (newPassword !== confirmPassword) {
        errorDiv.textContent = '❌ New password and confirmation do not match';
        return;
    }
    
    // Validate new password requirements
    const validation = validatePassword(newPassword);
    if (!validation.valid) {
        errorDiv.textContent = '❌ ' + validation.error;
        return;
    }
    
    // Disable button during request
    submitBtn.disabled = true;
    submitBtn.textContent = 'Changing...';
    
    try {
        const response = await fetch('/api/change-password', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            credentials: 'include',
            body: JSON.stringify({
                currentPassword,
                newPassword
            })
        });
        
        const data = await response.json();
        
        if (response.ok && data.success) {
            // Success
            errorDiv.textContent = '✅ Password changed successfully!';
            errorDiv.style.color = '#10b981';
            
            // Clear form
            document.getElementById('passwordChangeForm').reset();
            
            // Close modal after 1.5 seconds
            setTimeout(() => {
                closePasswordChangeModal();
            }, 1500);
        } else {
            // Error
            errorDiv.textContent = '❌ ' + (data.error || 'Failed to change password');
            errorDiv.style.color = '#ef4444';
            submitBtn.disabled = false;
            submitBtn.textContent = 'Change Password';
        }
    } catch (error) {
        console.error('Password change error:', error);
        errorDiv.textContent = '❌ Failed to change password. Please try again.';
        errorDiv.style.color = '#ef4444';
        submitBtn.disabled = false;
        submitBtn.textContent = 'Change Password';
    }
}

// Make functions available globally
window.openPasswordChangeModal = openPasswordChangeModal;
window.closePasswordChangeModal = closePasswordChangeModal;
window.handlePasswordChange = handlePasswordChange;

