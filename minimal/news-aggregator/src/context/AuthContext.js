import React, { createContext, useContext, useState, useEffect } from 'react';
import { API_URL } from '../config';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    const [token, setToken] = useState(localStorage.getItem('token'));
    const [loading, setLoading] = useState(true);
    const [darkMode, setDarkMode] = useState(() => {
        const saved = localStorage.getItem('darkMode');
        return saved ? JSON.parse(saved) : false;
    });

    // Apply dark mode class to document
    useEffect(() => {
        if (darkMode) {
            document.documentElement.classList.add('dark');
        } else {
            document.documentElement.classList.remove('dark');
        }
        localStorage.setItem('darkMode', JSON.stringify(darkMode));
    }, [darkMode]);

    // Load user on mount if token exists
    useEffect(() => {
        const loadUser = async () => {
            if (token) {
                try {
                    const res = await fetch(`${API_URL}/auth/me`, {
                        headers: {
                            'Authorization': `Bearer ${token}`
                        }
                    });
                    const data = await res.json();
                    if (data.success) {
                        setUser(data.data);
                        // Sync dark mode from user preferences
                        if (data.data.darkMode !== undefined) {
                            setDarkMode(data.data.darkMode);
                        }
                    } else {
                        // Invalid token
                        localStorage.removeItem('token');
                        setToken(null);
                    }
                } catch (error) {
                    console.error('Error loading user:', error);
                }
            }
            setLoading(false);
        };

        loadUser();
    }, [token]);

    const login = async (email, password) => {
        const res = await fetch(`${API_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        const data = await res.json();

        if (data.success) {
            setUser(data.data);
            setToken(data.data.token);
            localStorage.setItem('token', data.data.token);
            if (data.data.darkMode !== undefined) {
                setDarkMode(data.data.darkMode);
            }
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
        const data = await res.json();

        if (data.success) {
            setUser(data.data);
            setToken(data.data.token);
            localStorage.setItem('token', data.data.token);
            return { success: true };
        }
        return { success: false, error: data.error };
    };

    const logout = () => {
        setUser(null);
        setToken(null);
        localStorage.removeItem('token');
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

    // Bookmark functions
    const addBookmark = async (articleId) => {
        if (!token) return { success: false, error: 'Not logged in' };

        const res = await fetch(`${API_URL}/user/bookmarks/${articleId}`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();

        if (data.success && user) {
            setUser({ ...user, bookmarks: data.bookmarks });
        }
        return data;
    };

    const removeBookmark = async (articleId) => {
        if (!token) return { success: false, error: 'Not logged in' };

        const res = await fetch(`${API_URL}/user/bookmarks/${articleId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();

        if (data.success && user) {
            setUser({ ...user, bookmarks: data.bookmarks });
        }
        return data;
    };

    const isBookmarked = (articleId) => {
        if (!user || !user.bookmarks) return false;
        return user.bookmarks.some(id => id === articleId || id._id === articleId);
    };

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
