import React, { useState } from 'react';
import { X, Mail, Lock, User, Eye, EyeOff, Loader } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const AuthModal = ({ isOpen, onClose }) => {
    const [isLogin, setIsLogin] = useState(true);
    const [showPassword, setShowPassword] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const [formData, setFormData] = useState({
        name: '',
        email: '',
        password: ''
    });

    const { login, register } = useAuth();

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        try {
            let result;
            if (isLogin) {
                result = await login(formData.email, formData.password);
            } else {
                result = await register(formData.name, formData.email, formData.password);
            }

            if (result.success) {
                onClose();
                setFormData({ name: '', email: '', password: '' });
            } else {
                setError(result.error || 'An error occurred');
            }
        } catch (err) {
            setError('Connection error. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    const handleChange = (e) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
        setError('');
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <div
                className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
                onClick={onClose}
            />

            <div className="relative w-full max-w-md animate-fade-in" style={{ backgroundColor: 'var(--card)' }}>
                <div className="rounded-2xl shadow-2xl border" style={{ borderColor: 'var(--border)' }}>
                    {/* Header */}
                    <div className="p-6 border-b flex items-center justify-between" style={{ borderColor: 'var(--border)' }}>
                        <div>
                            <h2 className="text-2xl font-bold" style={{ color: 'var(--text-main)' }}>
                                {isLogin ? 'Welcome Back' : 'Create Account'}
                            </h2>
                            <p style={{ color: 'var(--text-muted)' }} className="text-sm mt-1">
                                {isLogin ? 'Sign in to access your bookmarks' : 'Join to save articles and customize feeds'}
                            </p>
                        </div>
                        <button
                            onClick={onClose}
                            className="p-2 rounded-lg transition-colors hover:bg-slate-100 dark:hover:bg-slate-700"
                        >
                            <X className="w-5 h-5" style={{ color: 'var(--text-muted)' }} />
                        </button>
                    </div>

                    {/* Form */}
                    <form onSubmit={handleSubmit} className="p-6 space-y-4">
                        {error && (
                            <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
                                {error}
                            </div>
                        )}

                        {!isLogin && (
                            <div className="relative">
                                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5" style={{ color: 'var(--text-muted)' }} />
                                <input
                                    type="text"
                                    name="name"
                                    placeholder="Full Name"
                                    value={formData.name}
                                    onChange={handleChange}
                                    required={!isLogin}
                                    className="w-full pl-10 pr-4 py-3 rounded-xl border transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    style={{
                                        backgroundColor: 'var(--background)',
                                        borderColor: 'var(--border)',
                                        color: 'var(--text-main)'
                                    }}
                                />
                            </div>
                        )}

                        <div className="relative">
                            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5" style={{ color: 'var(--text-muted)' }} />
                            <input
                                type="email"
                                name="email"
                                placeholder="Email Address"
                                value={formData.email}
                                onChange={handleChange}
                                required
                                className="w-full pl-10 pr-4 py-3 rounded-xl border transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
                                style={{
                                    backgroundColor: 'var(--background)',
                                    borderColor: 'var(--border)',
                                    color: 'var(--text-main)'
                                }}
                            />
                        </div>

                        <div className="relative">
                            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5" style={{ color: 'var(--text-muted)' }} />
                            <input
                                type={showPassword ? 'text' : 'password'}
                                name="password"
                                placeholder="Password"
                                value={formData.password}
                                onChange={handleChange}
                                required
                                minLength={6}
                                className="w-full pl-10 pr-12 py-3 rounded-xl border transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
                                style={{
                                    backgroundColor: 'var(--background)',
                                    borderColor: 'var(--border)',
                                    color: 'var(--text-main)'
                                }}
                            />
                            <button
                                type="button"
                                onClick={() => setShowPassword(!showPassword)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 p-1"
                            >
                                {showPassword ? (
                                    <EyeOff className="w-5 h-5" style={{ color: 'var(--text-muted)' }} />
                                ) : (
                                    <Eye className="w-5 h-5" style={{ color: 'var(--text-muted)' }} />
                                )}
                            </button>
                        </div>

                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                        >
                            {loading ? (
                                <>
                                    <Loader className="w-5 h-5 animate-spin" />
                                    {isLogin ? 'Signing in...' : 'Creating account...'}
                                </>
                            ) : (
                                isLogin ? 'Sign In' : 'Create Account'
                            )}
                        </button>
                    </form>

                    {/* Footer */}
                    <div className="p-6 pt-0 text-center">
                        <p style={{ color: 'var(--text-muted)' }} className="text-sm">
                            {isLogin ? "Don't have an account? " : "Already have an account? "}
                            <button
                                type="button"
                                onClick={() => {
                                    setIsLogin(!isLogin);
                                    setError('');
                                }}
                                className="text-blue-600 font-semibold hover:underline"
                            >
                                {isLogin ? 'Sign Up' : 'Sign In'}
                            </button>
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default AuthModal;
