(() => {
  const apiOrigin = 'https://danestore-api.onrender.com';
  const $ = id => document.getElementById(id);
  const modal = $('authModal');
  const notice = $('authNotice');

  const message = text => {
    notice.textContent = text;
    notice.style.display = text ? 'block' : 'none';
  };
  const showLogin = () => {
    $('authTitle').textContent = 'Welcome back.';
    $('authSub').textContent = 'Sign in to view orders and save your favorites.';
    $('authForm').style.display = 'block';
    $('signupForm').style.display = 'none';
    message('');
  };
  const showSignup = () => {
    $('authTitle').textContent = 'Join Dane’s Store.';
    $('authSub').textContent = 'Create an account to order, review, and keep track of your favorites.';
    $('authForm').style.display = 'none';
    $('signupForm').style.display = 'block';
    message('');
  };
  const open = () => { showLogin(); modal.classList.add('open'); };
  const close = () => { modal.classList.remove('open'); history.replaceState(null, '', location.pathname + location.search); };
  const request = async (path, body) => {
    const response = await fetch(`${apiOrigin}/api${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Unable to complete this request.');
    return data;
  };
  const complete = session => {
    localStorage.setItem('danesToken', session.token);
    localStorage.setItem('danesUser', JSON.stringify(session.user));
    close();
    location.reload();
  };

  document.addEventListener('click', event => {
    const trigger = event.target.closest('[data-auth-open]');
    if (!trigger) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    open();
  }, true);
  $('closeAuth').addEventListener('click', close);
  $('showSignupButton').addEventListener('click', showSignup);
  $('showLoginButton').addEventListener('click', showLogin);
  $('googleButton').addEventListener('click', () => message('Google sign-in is not configured yet. Please create an account or sign in.'));
  $('signInButton').addEventListener('click', async () => {
    const identifier = $('loginId').value.trim();
    const password = $('loginPass').value;
    if (!identifier || !password) return message('Enter your sign-in details.');
    try { complete(await request('/auth/login', { identifier, password })); }
    catch (error) { message(error.message); }
  });
  $('signUpButton').addEventListener('click', async () => {
    const payload = { name: $('newName').value.trim(), email: $('newEmail').value.trim(), phone: $('newPhone').value.trim(), username: $('newUser').value.trim(), password: $('newPass').value };
    if (!payload.name || !payload.username || !payload.password || (!payload.email && !payload.phone)) return message('Please complete the required details.');
    if (payload.password.length < 8) return message('Password must be at least 8 characters.');
    try { complete(await request('/auth/register', payload)); }
    catch (error) { message(error.message); }
  });
})();
