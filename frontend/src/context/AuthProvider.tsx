// frontend/src/context/AuthProvider.tsx
import React, { createContext, useContext, useEffect, useState, useMemo, useCallback } from "react";
import { authAPI } from "../services/api";
import type { UserData, AuthResult } from "../types";

export interface AuthContextType {
  userData: UserData | null;
  setUserData: React.Dispatch<React.SetStateAction<UserData | null>>;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<AuthResult>;
  register: (email: string, password: string, firstName: string, role: string) => Promise<AuthResult>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextType | null>(null);

const AuthProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const [userData, setUserData] = useState<UserData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  // Memoize checkAuth so it doesn't change on every render
  const checkAuth = useCallback(async () => {
    // Never log tokens or user details here: anything in the console can end up
    // in screenshots, bug reports or browser extensions.
    const token = localStorage.getItem('accessToken');

    if (!token) {
      setIsLoading(false);
      setIsAuthenticated(false);
      return;
    }

    try {
      const response = await authAPI.getMe();
      const user = response.data.data;

      setUserData({
        role: user.role,
        data: user
      });
      setIsAuthenticated(true);
    } catch (error: unknown) {
      const err = error as { response?: { status?: number } };
      console.error('Auth check failed (status %s)', err.response?.status ?? 'network error');

      // Only clear tokens on 401 (invalid token). For other errors (e.g. the
      // backend is waking up) keep them, but show the login UI.
      if (err.response?.status === 401) {
        localStorage.clear();
      }
      setUserData(null);
      setIsAuthenticated(false);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Check authentication on mount
  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  // Memoize login
  const login = useCallback(async (email: string, password: string): Promise<AuthResult> => {
    try {
      const response = await authAPI.login({ email, password });
      const { user, accessToken, refreshToken } = response.data.data;

      localStorage.setItem('accessToken', accessToken);
      localStorage.setItem('refreshToken', refreshToken);

      setUserData({
        role: user.role,
        data: user
      });
      setIsAuthenticated(true);

      return { success: true, user };
    } catch (error: unknown) {
      console.error('Login failed:', error);
      const err = error as { response?: { data?: { error?: string } } };
      return {
        success: false,
        error: err.response?.data?.error || 'Login failed. Please try again.'
      };
    }
  }, []);

  // Memoize register
  const register = useCallback(async (email: string, password: string, firstName: string, role: string): Promise<AuthResult> => {
    try {
      const response = await authAPI.register({ email, password, firstName, role });
      const { user, accessToken, refreshToken } = response.data.data;

      localStorage.setItem('accessToken', accessToken);
      localStorage.setItem('refreshToken', refreshToken);

      setUserData({
        role: user.role,
        data: user
      });
      setIsAuthenticated(true);

      return { success: true, user };
    } catch (error: unknown) {
      console.error('Registration failed:', error);
      const err = error as { response?: { data?: { error?: string } } };
      return {
        success: false,
        error: err.response?.data?.error || 'Registration failed. Please try again.'
      };
    }
  }, []);

  // Memoize logout
  const logout = useCallback(async () => {
    try {
      await authAPI.logout();
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      setUserData(null);
      setIsAuthenticated(false);
      localStorage.clear();
    }
  }, []);

  // Memoize the entire context value
  const value = useMemo(() => ({
    userData,
    setUserData,
    isLoading,
    isAuthenticated,
    login,
    register,
    logout,
    checkAuth
  }), [userData, isLoading, isAuthenticated, login, register, logout, checkAuth]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export default AuthProvider;
