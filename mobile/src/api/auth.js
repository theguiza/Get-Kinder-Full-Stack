import * as Keychain from 'react-native-keychain';

const AUTH_KEYCHAIN_SERVICE = 'getkinder.auth';
const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';

async function readStoredAuth() {
  const credentials = await Keychain.getGenericPassword({
    service: AUTH_KEYCHAIN_SERVICE,
  });

  if (!credentials) {
    return {token: null, user: null};
  }

  try {
    const parsed = JSON.parse(credentials.password);
    return {
      token: parsed?.token || null,
      user: parsed?.user || null,
    };
  } catch (error) {
    await Keychain.resetGenericPassword({service: AUTH_KEYCHAIN_SERVICE});
    return {token: null, user: null};
  }
}

export async function login(email, password) {
  const response = await fetch(`${API_BASE_URL}/api/auth/mobile-login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({email, password}),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.token) {
    throw new Error(data?.error || 'mobile_login_failed');
  }

  await persistAuth(data.token, data.user || null);

  return {
    token: data.token,
    user: data.user || null,
  };
}

export async function persistAuth(token, user) {
  await Keychain.setGenericPassword(
    'auth',
    JSON.stringify({
      token,
      user: user || null,
    }),
    {service: AUTH_KEYCHAIN_SERVICE},
  );
}

export async function logout() {
  await Keychain.resetGenericPassword({service: AUTH_KEYCHAIN_SERVICE});
}

export async function getToken() {
  const auth = await readStoredAuth();
  return auth.token;
}

export async function getUser() {
  const auth = await readStoredAuth();
  return auth.user;
}

export {API_BASE_URL, AUTH_KEYCHAIN_SERVICE, Keychain};
