import React, {createContext, useContext, useEffect, useState} from 'react';
import * as authApi from '../api/auth';

const AuthContext = createContext({
  user: undefined,
  token: undefined,
  login: async () => {},
  logout: async () => {},
  setToken: () => {},
  setUser: () => {},
});

export function AuthProvider({children}) {
  const [token, setToken] = useState(undefined);
  const [user, setUser] = useState(undefined);

  useEffect(() => {
    let isMounted = true;

    async function hydrateAuth() {
      try {
        const [storedToken, storedUser] = await Promise.all([
          authApi.getToken(),
          authApi.getUser(),
        ]);

        if (!isMounted) {
          return;
        }

        setToken(storedToken || null);
        setUser(storedUser || null);
      } catch (error) {
        if (!isMounted) {
          return;
        }

        setToken(null);
        setUser(null);
      }
    }

    hydrateAuth();

    return () => {
      isMounted = false;
    };
  }, []);

  async function login(email, password, preAuthToken, preAuthUser) {
    if (preAuthToken && preAuthUser) {
      await authApi.persistAuth(preAuthToken, preAuthUser);
      setToken(preAuthToken);
      setUser(preAuthUser);
      return { token: preAuthToken, user: preAuthUser };
    }
    const auth = await authApi.login(email, password);
    setToken(auth.token);
    setUser(auth.user || null);
    return auth;
  }

  async function logout() {
    await authApi.logout();
    setToken(null);
    setUser(null);
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        login,
        logout,
        setToken,
        setUser,
      }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
