/**
 * Authentication module - uses server-side sessions
 */

/**
 * Check if user is authenticated (via API)
 */
export async function isAuthenticated() {
    try {
        const response = await fetch('/api/auth/status', {
            credentials: 'include'
        });
        if (response.ok) {
            const data = await response.json();
            return data.authenticated === true;
        }
        return false;
    } catch (error) {
        console.error('Auth check failed:', error);
        return false;
    }
}

/**
 * Handle login form submission
 */
export async function handleLogin(event) {
    if (event) {
        event.preventDefault();
    }
    
    const passwordInput = document.getElementById('passwordInput');
    const loginError = document.getElementById('loginError');
    const loginBtn = document.getElementById('loginBtn');
    
    if (!passwordInput || !loginError || !loginBtn) {
        return;
    }
    
    const password = passwordInput.value.trim();
    
    // Clear previous error
    loginError.textContent = '';
    loginBtn.disabled = true;
    loginBtn.textContent = 'Logging in...';
    
    try {
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            credentials: 'include',
            body: JSON.stringify({ password })
        });
        
        const data = await response.json();
        
        if (response.ok && data.success) {
            // Success - redirect to main app
            passwordInput.value = '';
            window.location.href = '/';
        } else {
            // Wrong password
            loginError.textContent = '❌ ' + (data.error || 'Incorrect password. Please try again.');
            passwordInput.value = '';
            passwordInput.focus();
            loginBtn.disabled = false;
            loginBtn.textContent = '🔓 Login';
        }
    } catch (error) {
        console.error('Login error:', error);
        loginError.textContent = '❌ Login failed. Please try again.';
        passwordInput.value = '';
        passwordInput.focus();
        loginBtn.disabled = false;
        loginBtn.textContent = '🔓 Login';
    }
}

/**
 * Logout function
 */
export async function logout() {
    try {
        await fetch('/api/logout', {
            method: 'POST',
            credentials: 'include'
        });
    } catch (error) {
        console.error('Logout error:', error);
    }
    // Redirect to login page
    window.location.href = '/login.html';
}

/**
 * Initialize authentication on login page
 */
function initializeLoginPage() {
    // Server handles redirects - just make handleLogin available globally
    window.handleLogin = handleLogin;
}

// Initialize when DOM is ready (only on login page)
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeLoginPage);
} else {
    initializeLoginPage();
}

