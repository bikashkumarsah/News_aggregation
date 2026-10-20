import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { API_URL } from '../config';

const AuthContext = createContext(null);

const readStorage = (key) => {
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
};

const writeStorage = (key, value) => {
    try {
        if (value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
    } catch {
        // Storage can be unavailable (private mode); the session still works in memory.
    }
};

// Parse a JSON API response without throwing on proxy error pages.
const readJson = async (res) => {
    try {
        return await res.json();
    } catch {
        return { success: false, error: `Unexpected server response (${res.status})` };
    }
};

const bookmarkId = (item) => String(item?._id || item);

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    const [token, setToken] = useState(() => readStorage('token'));
    const [loading, setLoading] = useState(true);
    const [darkMode, setDarkMode] = useState(() => {
        try {
            return JSON.parse(readStorage('darkMode')) === true;
        } catch {
            return false;
        }
    });

    // Apply dark mode class to document
    useEffect(() => {
        if (darkMode) {
            document.documentElement.classList.add('dark');
        } else {
            document.documentElement.classList.remove('dark');
        }
        writeStorage('darkMode', JSON.stringify(darkMode));
    }, [darkMode]);

    const clearSession = useCallback(() => {
        setUser(null);
        setToken(null);
        writeStorage('token', null);
    }, []);

    // Load user on mount and whenever the token changes
    useEffect(() => {
        let cancelled = false;

        const loadUser = async () => {
            if (!token) {
                setLoading(false);
                return;
            }
            try {
                const res = await fetch(`${API_URL}/auth/me`, {
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                });
                const data = await readJson(res);
                if (cancelled) return;
                if (data.success) {
                    setUser(data.data);
                    // Sync dark mode from user preferences
                    if (typeof data.data.darkMode === 'boolean') {
                        setDarkMode(data.data.darkMode);
                    }
                } else if (res.status === 401 || res.status === 404) {
                    // Token expired or account removed
                    clearSession();
                }
            } catch (error) {
                // Network error: keep the token and retry on the next load.
                console.error('Error loading user:', error);
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        loadUser();
        return () => {
            cancelled = true;
        };
    }, [token, clearSession]);

    const startSession = (data) => {
        setUser(data);
        setToken(data.token);
        writeStorage('token', data.token);
        if (typeof data.darkMode === 'boolean') {
            setDarkMode(data.darkMode);
        }
    };

    const login = async (email, password) => {
        const res = await fetch(`${API_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        const data = await readJson(res);

        if (data.success) {
            startSession(data.data);
            return { success: true };
        }
        return { success: false, error: data.error };
    };

    const register = async (name, email, password) => {
        const res = await fetch(`${API_URL}/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, email, password })
        });
        const data = await readJson(res);

        if (data.success) {
            startSession(data.data);
            return { success: true };
        }
        return { success: false, error: data.error };
    };

    const logout = () => {
        clearSession();
    };

    const toggleDarkMode = async () => {
        const newValue = !darkMode;
        setDarkMode(newValue);

        // Sync to backend if logged in
        if (token) {
            try {
                await fetch(`${API_URL}/auth/profile`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({ darkMode: newValue })
                });
            } catch (error) {
                console.error('Error syncing dark mode:', error);
            }
        }
    };

    const updateBookmarks = async (articleId, method) => {
        if (!token) return { success: false, error: 'Not logged in' };

        try {
            const res = await fetch(`${API_URL}/user/bookmarks/${articleId}`, {
                method,
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await readJson(res);

            if (data.success) {
                setUser((current) => (current ? { ...current, bookmarks: data.bookmarks } : current));
            }
            return data;
        } catch (error) {
            return { success: false, error: 'Connection error. Please try again.' };
        }
    };

    // Bookmark functions
    const addBookmark = (articleId) => updateBookmarks(articleId, 'POST');
    const removeBookmark = (articleId) => updateBookmarks(articleId, 'DELETE');

    const bookmarkedIds = useMemo(
        () => new Set((user?.bookmarks || []).map(bookmarkId)),
        [user]
    );

    const isBookmarked = (articleId) => bookmarkedIds.has(String(articleId));

    // Reading history
    const addToHistory = async (articleId) => {
        if (!token) return;

        try {
            await fetch(`${API_URL}/user/history/${articleId}`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
        } catch (error) {
            console.error('Error adding to history:', error);
        }
    };

    const value = {
        user,
        token,
        loading,
        darkMode,
        login,
        register,
        logout,
        toggleDarkMode,
        addBookmark,
        removeBookmark,
        isBookmarked,
        addToHistory
    };

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

export default AuthContext;
