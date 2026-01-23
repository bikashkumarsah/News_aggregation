import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Newspaper,
  Cpu,
  Briefcase,
  Trophy,
  Film,
  Activity,
  Microscope,
  LayoutGrid,
  ChevronRight,
  Clock,
  Sparkles,
  ArrowLeft,
  X,
  ExternalLink,
  MessageSquare,
  AlertCircle,
  CheckCircle,
  Loader,
  MapPin,
  Volume2,
  Pause,
  Search,
  SlidersHorizontal,
  Moon,
  Sun,
  Bookmark,
  BookmarkCheck,
  User,
  LogOut,
  History,
  Settings,
  Rss
} from 'lucide-react';
import { useAuth } from './context/AuthContext';
import AuthModal from './components/AuthModal';
import { API_URL, API_BASE_URL } from './config';


const Toast = ({ message, type, onClose }) => {
  useEffect(() => {
    const timer = setTimeout(() => {
      onClose();
    }, 5000);
    return () => clearTimeout(timer);
  }, [onClose]);

  return (
    <div className={`fixed bottom-4 right-4 z-[110] flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg border animate-fade-in ${type === 'error' ? 'bg-red-50 dark:bg-red-900/30 border-red-100 dark:border-red-800 text-red-800 dark:text-red-300' : 'bg-green-50 dark:bg-green-900/30 border-green-100 dark:border-green-800 text-green-800 dark:text-green-300'
      }`}>
      {type === 'error' ? <AlertCircle className="w-5 h-5" /> : <CheckCircle className="w-5 h-5" />}
      <p className="font-medium text-sm">{message}</p>
      <button onClick={onClose} className="p-1 hover:bg-black/5 dark:hover:bg-white/10 rounded-full transition-colors">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};

const NewsApp = () => {
  const { user, darkMode, toggleDarkMode, logout, addBookmark, removeBookmark, isBookmarked, addToHistory } = useAuth();

  const [selectedCategory, setSelectedCategory] = useState('all');
  const [articles, setArticles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selectedArticle, setSelectedArticle] = useState(null);
  const [summary, setSummary] = useState('');
  const [summarizing, setSummarizing] = useState(false);
  const [showSummaryModal, setShowSummaryModal] = useState(false);
  const [toast, setToast] = useState(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);

  // Advanced Search & Filtering (Topics + Semantic Search)
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTopics, setSelectedTopics] = useState([]);
  const [sourceFilter, setSourceFilter] = useState('');
  const [dateRange, setDateRange] = useState(''); // '', '24h', '7d', '30d'
  const [showFilters, setShowFilters] = useState(false);
  const [searchEngine, setSearchEngine] = useState(null); // 'qdrant' | 'mongo' | 'mongo_fallback'

  // TTS State
  const [isSynthesizing, setIsSynthesizing] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioUrl, setAudioUrl] = useState(null);
  const [audioError, setAudioError] = useState(null);

  // Track search state changes so we can reload when filters are cleared
  const prevHasSearchFiltersRef = useRef(false);
  const prevCategoryRef = useRef(selectedCategory);


  // Swipe to close state
  const [touchStart, setTouchStart] = useState(null);
  const [touchEnd, setTouchEnd] = useState(null);
  const minSwipeDistance = 50;

  const categories = [
    { id: 'all', name: 'All News', icon: <LayoutGrid className="w-5 h-5" /> },
    { id: 'local', name: 'Local News', icon: <MapPin className="w-5 h-5" /> },
    { id: 'technology', name: 'Technology', icon: <Cpu className="w-5 h-5" /> },
    { id: 'business', name: 'Business', icon: <Briefcase className="w-5 h-5" /> },
    { id: 'sports', name: 'Sports', icon: <Trophy className="w-5 h-5" /> },
    { id: 'entertainment', name: 'Entertainment', icon: <Film className="w-5 h-5" /> },
    { id: 'health', name: 'Health', icon: <Activity className="w-5 h-5" /> },
    { id: 'science', name: 'Science', icon: <Microscope className="w-5 h-5" /> }
  ];

  const topicOptions = [
    { id: 'finance', name: 'Finance' },
    { id: 'politics', name: 'Politics' },
    { id: 'international', name: 'International' },
    { id: 'culture', name: 'Culture' },
    { id: 'art', name: 'Art' },
    { id: 'sports', name: 'Sports' }
  ];

  const userMenuItems = [
    { id: 'bookmarks', name: 'My Bookmarks', icon: <Bookmark className="w-5 h-5" /> },
    { id: 'history', name: 'Reading History', icon: <History className="w-5 h-5" /> },
    { id: 'feeds', name: 'Custom Feeds', icon: <Rss className="w-5 h-5" /> },
    { id: 'settings', name: 'Settings', icon: <Settings className="w-5 h-5" /> }
  ];

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
  };

  const isSearchableCategory = !['bookmarks', 'history', 'local'].includes(selectedCategory);
  const hasSearchFilters = useMemo(() => {
    return Boolean(
      searchQuery.trim() ||
      selectedTopics.length > 0 ||
      sourceFilter.trim() ||
      dateRange
    );
  }, [searchQuery, selectedTopics, sourceFilter, dateRange]);

  const isSearchMode = isSearchableCategory && hasSearchFilters;

  const resultTopicCounts = useMemo(() => {
    const counts = {};
    for (const a of articles) {
      const topics = Array.isArray(a?.topics) ? a.topics : [];
      for (const t of topics) {
        counts[t] = (counts[t] || 0) + 1;
      }
    }
    return counts;
  }, [articles]);

  const toggleTopic = (topicId) => {
    setSelectedTopics((prev) =>
      prev.includes(topicId) ? prev.filter((t) => t !== topicId) : [...prev, topicId]
    );
  };

  const clearSearchAndFilters = () => {
    prevHasSearchFiltersRef.current = false;
    setSearchQuery('');
    setSelectedTopics([]);
    setSourceFilter('');
    setDateRange('');
    setSearchEngine(null);
    setShowFilters(false);
  };

  const getFromDateForRange = (range) => {
    const now = Date.now();
    if (range === '24h') return new Date(now - 24 * 60 * 60 * 1000);
    if (range === '7d') return new Date(now - 7 * 24 * 60 * 60 * 1000);
    if (range === '30d') return new Date(now - 30 * 24 * 60 * 60 * 1000);
    return null;
  };

  useEffect(() => {
    // Close filter panel on section change
    setShowFilters(false);
    setSearchEngine(null);

    if (selectedCategory === 'bookmarks' || selectedCategory === 'history') {
      loadUserContent();
    } else {
      setPage(1);
      setArticles([]);
      setHasMore(true);
      loadArticles(1, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCategory]);

  // Debounced reload when search query / filters change (including when cleared)
  useEffect(() => {
    const categoryChanged = prevCategoryRef.current !== selectedCategory;
    prevCategoryRef.current = selectedCategory;

    // If category changed, the selectedCategory effect already reloads.
    if (categoryChanged) {
      prevHasSearchFiltersRef.current = hasSearchFilters;
      return;
    }

    if (!isSearchableCategory) {
      prevHasSearchFiltersRef.current = false;
      return;
    }

    const shouldReload = hasSearchFilters || prevHasSearchFiltersRef.current;
    prevHasSearchFiltersRef.current = hasSearchFilters;

    if (!shouldReload) return;

    const timer = setTimeout(() => {
      setPage(1);
      setArticles([]);
      setHasMore(true);
      loadArticles(1, true);
    }, 350);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    searchQuery,
    selectedTopics,
    sourceFilter,
    dateRange,
    hasSearchFilters,
    isSearchableCategory,
    selectedCategory
  ]);

  const loadUserContent = async () => {
    if (!user) {
      showToast('Please login to view this section', 'error');
      setSelectedCategory('all');
      return;
    }

    setLoading(true);
    const token = localStorage.getItem('token');

    try {
      const endpoint = selectedCategory === 'bookmarks'
        ? `${API_URL}/user/bookmarks`
        : `${API_URL}/user/history`;

      const response = await fetch(endpoint, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const result = await response.json();

      if (result.success) {
        if (selectedCategory === 'history') {
          setArticles(result.data.map(item => item.article).filter(Boolean));
        } else {
          setArticles(result.data);
        }
        setHasMore(false);
      }
    } catch (error) {
      showToast('Failed to load content', 'error');
    } finally {
      setLoading(false);
    }
  };

  const loadArticles = async (pageNum = 1, isNewCategory = false) => {
    if (pageNum === 1) setLoading(true);
    else setLoadingMore(true);

    try {
      // Use advanced search endpoint when filters are active (semantic search + topic filters)
      if (isSearchMode) {
        const params = new URLSearchParams();
        params.set('page', pageNum.toString());
        params.set('limit', '12');

        if (searchQuery.trim()) params.set('q', searchQuery.trim());
        if (selectedTopics.length > 0) params.set('topics', selectedTopics.join(','));
        if (sourceFilter.trim()) params.set('source', sourceFilter.trim());

        // Use existing category as an additional filter (except "all")
        if (selectedCategory !== 'all') params.set('category', selectedCategory);

        const fromDate = getFromDateForRange(dateRange);
        if (fromDate) params.set('from', fromDate.toISOString());

        const response = await fetch(`${API_URL}/search?${params.toString()}`);
        const result = await response.json();

        if (result.success) {
          setSearchEngine(result.engine || 'mongo');

          if (isNewCategory) setArticles(result.data);
          else setArticles((prev) => [...prev, ...result.data]);

          // Qdrant doesn't return total; Mongo does. Fall back to "hasMore if we got a full page".
          if (typeof result.total === 'number') {
            const currentOffset = (pageNum - 1) * 12;
            setHasMore(currentOffset + (result.data?.length || 0) < result.total);
          } else {
            setHasMore((result.data || []).length === 12);
          }
        } else {
          showToast(result.error || 'Search failed', 'error');
        }
      } else {
        setSearchEngine(null);
        const response = await fetch(`${API_URL}/news?category=${selectedCategory}&page=${pageNum}&limit=12`);
        const result = await response.json();

        if (result.success) {
          if (isNewCategory) {
            setArticles(result.data);
          } else {
            setArticles(prev => [...prev, ...result.data]);
          }
          setHasMore(result.hasMore);
        } else {
          showToast(result.error || 'Failed to fetch articles', 'error');
        }
      }
    } catch (error) {
      console.error('Failed to fetch articles:', error);
      showToast('Connection error. Please try again.', 'error');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  const handleLoadMore = () => {
    const nextPage = page + 1;
    setPage(nextPage);
    loadArticles(nextPage);
  };

  const handleArticleClick = (article) => {
    setSelectedArticle(article);
    // Add to reading history if logged in
    if (user) {
      addToHistory(article._id);
    }
  };

  const handleBookmark = async (e, article) => {
    e.stopPropagation();

    if (!user) {
      showToast('Please login to bookmark articles', 'error');
      setShowAuthModal(true);
      return;
    }

    const bookmarked = isBookmarked(article._id);
    const result = bookmarked
      ? await removeBookmark(article._id)
      : await addBookmark(article._id);

    if (result.success) {
      showToast(bookmarked ? 'Bookmark removed' : 'Article bookmarked');
    } else {
      showToast(result.error || 'Failed to update bookmark', 'error');
    }
  };

  const handleSummarize = async (e, article) => {
    e.stopPropagation();
    setSummarizing(true);
    setSummary('');
    setShowSummaryModal(true);

    try {
      const response = await fetch(`${API_URL}/news/${article._id}/summarize`, {
        method: 'POST'
      });
      const result = await response.json();
      if (result.success) {
        setSummary(result.data);
      } else {
        setSummary('Error generating summary. Please try again.');
        showToast('Failed to generate summary', 'error');
      }
    } catch (error) {
      setSummary('Failed to reach backend server.');
      showToast('Connection error', 'error');
    } finally {
      setSummarizing(false);
    }
  };

  const handleTTS = async () => {
    if (audioUrl) {
      const audio = document.getElementById('tts-audio');
      if (isPlaying) {
        audio.pause();
        setIsPlaying(false);
      } else {
        audio.play();
        setIsPlaying(true);
      }
      return;
    }

    try {
      setIsSynthesizing(true);
      setAudioError(null);

      const response = await fetch(`${API_URL}/news/${selectedArticle._id}/tts`, {
        method: 'POST'
      });

      const data = await response.json();

      if (data.success) {
        setAudioUrl(`${API_BASE_URL}${data.audioUrl}`);
        setTimeout(() => {
          const audio = document.getElementById('tts-audio');
          if (audio) {
            audio.play();
            setIsPlaying(true);
          }
        }, 100);
      } else {
        setAudioError(data.error || 'TTS generation failed');
        showToast('TTS generation failed', 'error');
      }
    } catch (err) {
      setAudioError('Error connecting to TTS service');
      showToast('TTS connection error', 'error');
      console.error(err);
    } finally {
      setIsSynthesizing(false);
    }
  };


  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  const onTouchStart = (e) => {
    setTouchEnd(null);
    setTouchStart(e.targetTouches[0].clientY);
  };

  const onTouchMove = (e) => {
    setTouchEnd(e.targetTouches[0].clientY);
  };

  const onTouchEnd = () => {
    if (!touchStart || !touchEnd) return;
    const distance = touchStart - touchEnd;
    const isDownSwipe = distance < -minSwipeDistance;

    if (isDownSwipe) {
      setShowSummaryModal(false);
    }
  };

  const SkeletonCard = () => (
    <div className="premium-card p-5 animate-pulse">
      <div className="w-full h-48 rounded-xl mb-4" style={{ backgroundColor: 'var(--border)' }} />
      <div className="h-4 rounded w-2/3 mb-3" style={{ backgroundColor: 'var(--border)' }} />
      <div className="h-6 rounded w-full mb-3" style={{ backgroundColor: 'var(--border)' }} />
      <div className="h-4 rounded w-full mb-1" style={{ backgroundColor: 'var(--border)' }} />
      <div className="h-4 rounded w-4/5" style={{ backgroundColor: 'var(--border)' }} />
    </div>
  );

  return (
    <div className="min-h-screen flex" style={{ backgroundColor: 'var(--background)' }}>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      <AuthModal isOpen={showAuthModal} onClose={() => setShowAuthModal(false)} />

      {/* Sidebar */}
      <aside className="w-72 border-r hidden lg:flex flex-col sticky top-0 h-screen sidebar" style={{ backgroundColor: 'var(--sidebar-bg)', borderColor: 'var(--border)' }}>
        <div className="p-8 flex items-center gap-3">
          <div className="p-2 bg-blue-600 rounded-xl shadow-lg shadow-blue-500/30">
            <Newspaper className="w-6 h-6 text-white" />
          </div>
          <span className="text-xl font-bold tracking-tight gradient-text">Khabar AI</span>
        </div>

        <nav className="flex-1 px-4 space-y-2 overflow-y-auto">
          {/* Main Categories */}
          <p className="text-xs font-bold uppercase tracking-widest px-4 pt-2 pb-1" style={{ color: 'var(--text-muted)' }}>Categories</p>
          {categories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => {
                if (selectedCategory !== cat.id) {
                  setSelectedCategory(cat.id);
                  setSelectedArticle(null);
                }
              }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-all ${selectedCategory === cat.id
                ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 shadow-sm'
                : 'hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
              style={{ color: selectedCategory === cat.id ? undefined : 'var(--text-muted)' }}
            >
              {cat.icon}
              {cat.name}
              {selectedCategory === cat.id && <div className="ml-auto w-1.5 h-1.5 rounded-full bg-blue-600 dark:bg-blue-400" />}
            </button>
          ))}

          {/* User Section */}
          {user && (
            <>
              <div className="pt-4 pb-2">
                <p className="text-xs font-bold uppercase tracking-widest px-4" style={{ color: 'var(--text-muted)' }}>Your Library</p>
              </div>
              {userMenuItems.slice(0, 2).map((item) => (
                <button
                  key={item.id}
                  onClick={() => {
                    setSelectedCategory(item.id);
                    setSelectedArticle(null);
                  }}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-all ${selectedCategory === item.id
                    ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 shadow-sm'
                    : 'hover:bg-slate-50 dark:hover:bg-slate-800'
                    }`}
                  style={{ color: selectedCategory === item.id ? undefined : 'var(--text-muted)' }}
                >
                  {item.icon}
                  {item.name}
                </button>
              ))}
            </>
          )}
        </nav>

        {/* Bottom Section */}
        <div className="p-4 border-t" style={{ borderColor: 'var(--border)' }}>
          {/* Dark Mode Toggle */}
          <button
            onClick={toggleDarkMode}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-all hover:bg-slate-50 dark:hover:bg-slate-800"
            style={{ color: 'var(--text-muted)' }}
          >
            {darkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            {darkMode ? 'Light Mode' : 'Dark Mode'}
          </button>

          {/* User / Login */}
          {user ? (
            <div className="relative">
              <button
                onClick={() => setShowUserMenu(!showUserMenu)}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-all hover:bg-slate-50 dark:hover:bg-slate-800"
                style={{ color: 'var(--text-main)' }}
              >
                <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center text-white font-bold text-sm">
                  {user.name?.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 text-left">
                  <p className="text-sm font-semibold truncate">{user.name}</p>
                  <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>{user.email}</p>
                </div>
              </button>

              {showUserMenu && (
                <div className="absolute bottom-full left-0 right-0 mb-2 rounded-xl shadow-xl border p-2" style={{ backgroundColor: 'var(--card)', borderColor: 'var(--border)' }}>
                  <button
                    onClick={() => { logout(); setShowUserMenu(false); }}
                    className="w-full flex items-center gap-3 px-4 py-2 rounded-lg text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 font-medium transition-colors"
                  >
                    <LogOut className="w-4 h-4" />
                    Sign Out
                  </button>
                </div>
              )}
            </div>
          ) : (
            <button
              onClick={() => setShowAuthModal(true)}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-xl font-medium bg-blue-600 text-white hover:bg-blue-700 transition-all"
            >
              <User className="w-5 h-5" />
              Sign In
            </button>
          )}
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1">
        {/* Header (Mobile & Tablet) */}
        <header className="nav-blur p-4 lg:px-12 flex items-center justify-between">
          <div className="flex items-center gap-3 lg:hidden">
            <Newspaper className="w-7 h-7 text-blue-600" />
            <span className="text-lg font-bold gradient-text">Khabar AI</span>
          </div>
          <div className="hidden lg:block">
            <h2 className="text-sm font-semibold uppercase tracking-widest leading-none" style={{ color: 'var(--text-muted)' }}>
              {selectedArticle ? 'Reading Article' : `Feed / ${categories.find(c => c.id === selectedCategory)?.name || selectedCategory}`}
            </h2>
          </div>
          <div className="flex items-center gap-3">
            {/* Mobile Dark Mode Toggle */}
            <button
              onClick={toggleDarkMode}
              className="p-2 rounded-lg transition-colors lg:hidden"
              style={{ backgroundColor: 'var(--card)', color: 'var(--text-muted)' }}
            >
              {darkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </button>

            <div className="text-sm font-medium px-3 py-1.5 rounded-lg border flex items-center gap-2" style={{ backgroundColor: 'var(--card)', borderColor: 'var(--border)', color: 'var(--text-muted)' }}>
              <Clock className="w-4 h-4" />
              {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </div>

            {/* Mobile User Button */}
            {!user ? (
              <button
                onClick={() => setShowAuthModal(true)}
                className="p-2 rounded-lg bg-blue-600 text-white lg:hidden"
              >
                <User className="w-5 h-5" />
              </button>
            ) : (
              <button
                onClick={() => setShowUserMenu(!showUserMenu)}
                className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center text-white font-bold text-sm lg:hidden"
              >
                {user.name?.charAt(0).toUpperCase()}
              </button>
            )}
          </div>
        </header>

        <div className="p-4 lg:p-12 max-w-7xl mx-auto">
          {selectedArticle ? (
            /* Single Article View */
            <div className="animate-fade-in max-w-4xl mx-auto">
              <button
                onClick={() => setSelectedArticle(null)}
                className="flex items-center gap-2 hover:text-blue-600 mb-8 font-semibold transition-colors group"
                style={{ color: 'var(--text-muted)' }}
              >
                <ArrowLeft className="w-5 h-5 group-hover:-translate-x-1 transition-transform" />
                Back to Feed
              </button>

              <div className="space-y-8">
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="px-3 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 text-xs font-bold rounded-full uppercase tracking-wider">
                      {selectedArticle.category}
                    </span>
                    <span className="text-sm" style={{ color: 'var(--text-muted)' }}>{formatDate(selectedArticle.publishedAt)}</span>

                    {Array.isArray(selectedArticle.topics) && selectedArticle.topics.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {selectedArticle.topics.slice(0, 6).map((t) => (
                          <span
                            key={t}
                            className="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider"
                            style={{ backgroundColor: 'var(--background)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Bookmark Button */}
                    <button
                      onClick={(e) => handleBookmark(e, selectedArticle)}
                      className={`ml-auto p-2 rounded-lg transition-colors ${isBookmarked(selectedArticle._id) ? 'text-blue-600 bg-blue-50 dark:bg-blue-900/30' : 'hover:bg-slate-100 dark:hover:bg-slate-800'}`}
                      style={{ color: isBookmarked(selectedArticle._id) ? undefined : 'var(--text-muted)' }}
                    >
                      {isBookmarked(selectedArticle._id) ? <BookmarkCheck className="w-5 h-5" /> : <Bookmark className="w-5 h-5" />}
                    </button>
                  </div>
                  <h1 className="text-4xl lg:text-5xl font-extrabold leading-[1.15]" style={{ color: 'var(--text-main)' }}>
                    {selectedArticle.title}
                  </h1>
                  <div className="flex items-center gap-4 pt-4 border-t" style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}>
                    <span className="font-semibold" style={{ color: 'var(--text-main)' }}>{selectedArticle.source}</span>
                    {selectedArticle.author && <span>By {selectedArticle.author}</span>}
                  </div>
                </div>

                {selectedArticle.urlToImage && (
                  <div className="relative group">
                    <div className="absolute -inset-4 bg-blue-500/5 rounded-[2rem] blur-2xl opacity-0 group-hover:opacity-100 transition-opacity" />
                    <img
                      src={selectedArticle.urlToImage}
                      alt={selectedArticle.title}
                      className="w-full aspect-video object-cover rounded-[1.5rem] shadow-2xl relative"
                      onError={(e) => e.target.style.display = 'none'}
                    />
                  </div>
                )}

                <div className="prose prose-slate dark:prose-invert prose-lg max-w-none">
                  <p className="text-xl lg:text-2xl font-medium leading-relaxed mb-8" style={{ color: 'var(--text-muted)' }}>
                    {selectedArticle.description}
                  </p>

                  {selectedArticle.content && (
                    <div className="space-y-6">
                      {selectedArticle.content.split('\n\n').map((paragraph, index) => (
                        <p key={index} className="leading-[1.8]" style={{ color: 'var(--text-main)' }}>
                          {paragraph}
                        </p>
                      ))}
                    </div>
                  )}
                </div>

                <div className="sticky bottom-8 backdrop-blur-xl border p-4 rounded-2xl shadow-2xl flex gap-3 max-w-md mx-auto" style={{ backgroundColor: 'var(--glass)', borderColor: 'var(--border)' }}>
                  <button
                    onClick={(e) => handleSummarize(e, selectedArticle)}
                    className="flex-1 btn-primary flex items-center justify-center gap-2"
                  >
                    <Sparkles className="w-5 h-5" />
                    Summarize
                  </button>
                  <a
                    href={selectedArticle.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center w-14 h-12 rounded-xl transition-all font-bold"
                    style={{ backgroundColor: 'var(--card)', color: 'var(--text-main)', border: '1px solid var(--border)' }}
                  >
                    <ExternalLink className="w-5 h-5" />
                  </a>
                </div>
              </div>
            </div>
          ) : (
            /* Feed View */
            <div className="space-y-12 pb-12">
              {/* Category Header + Advanced Search */}
              <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6">
                <div>
                  <p className="text-blue-600 dark:text-blue-400 font-bold uppercase tracking-[0.2em] text-xs mb-3">
                    {selectedCategory === 'bookmarks' ? 'Saved Articles' : selectedCategory === 'history' ? 'Recently Read' : 'Trending Now'}
                  </p>
                  <h1 className="text-4xl lg:text-5xl font-black tracking-tight" style={{ color: 'var(--text-main)' }}>
                    {categories.find(c => c.id === selectedCategory)?.name ||
                      userMenuItems.find(i => i.id === selectedCategory)?.name ||
                      selectedCategory}
                  </h1>
                </div>

                {isSearchableCategory && (
                  <div className="w-full lg:max-w-md">
                    {/* Search Input */}
                    <div className="premium-card p-3 flex items-center gap-2">
                      <Search className="w-5 h-5" style={{ color: 'var(--text-muted)' }} />
                      <input
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search by topic, people, places..."
                        className="flex-1 bg-transparent outline-none text-sm font-semibold"
                        style={{ color: 'var(--text-main)' }}
                      />

                      {(searchQuery.trim() || selectedTopics.length > 0 || sourceFilter.trim() || dateRange) && (
                        <button
                          onClick={() => {
                            clearSearchAndFilters();
                            setPage(1);
                            setArticles([]);
                            setHasMore(true);
                            loadArticles(1, true);
                          }}
                          className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                          aria-label="Clear search"
                        >
                          <X className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
                        </button>
                      )}

                      <button
                        onClick={() => setShowFilters(!showFilters)}
                        className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                        aria-label="Toggle filters"
                        title="Filters"
                      >
                        <SlidersHorizontal className="w-4 h-4" style={{ color: showFilters ? 'var(--text-main)' : 'var(--text-muted)' }} />
                      </button>
                    </div>

                    {/* Filters Panel */}
                    {showFilters && (
                      <div className="mt-3 premium-card p-4 space-y-4">
                        <div>
                          <p className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
                            Topics
                          </p>
                          <div className="flex flex-wrap gap-2 mt-2">
                            {topicOptions.map((t) => {
                              const active = selectedTopics.includes(t.id);
                              return (
                                <button
                                  key={t.id}
                                  onClick={() => toggleTopic(t.id)}
                                  className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-colors ${active ? 'bg-blue-600 text-white border-blue-600' : 'hover:bg-slate-50 dark:hover:bg-slate-800'
                                    }`}
                                  style={{
                                    backgroundColor: active ? undefined : 'var(--card)',
                                    borderColor: active ? undefined : 'var(--border)',
                                    color: active ? undefined : 'var(--text-main)'
                                  }}
                                >
                                  {t.name}
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <label className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
                              Source
                            </label>
                            <input
                              value={sourceFilter}
                              onChange={(e) => setSourceFilter(e.target.value)}
                              placeholder="e.g. NASA"
                              className="mt-2 w-full px-3 py-2 rounded-xl border bg-transparent text-sm outline-none"
                              style={{ borderColor: 'var(--border)', color: 'var(--text-main)' }}
                            />
                          </div>
                          <div>
                            <label className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
                              Date
                            </label>
                            <select
                              value={dateRange}
                              onChange={(e) => setDateRange(e.target.value)}
                              className="mt-2 w-full px-3 py-2 rounded-xl border bg-transparent text-sm outline-none"
                              style={{ borderColor: 'var(--border)', color: 'var(--text-main)' }}
                            >
                              <option value="">Any time</option>
                              <option value="24h">Last 24 hours</option>
                              <option value="7d">Last 7 days</option>
                              <option value="30d">Last 30 days</option>
                            </select>
                          </div>
                        </div>

                        <div className="flex items-center justify-between">
                          <div className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                            {searchEngine ? `Engine: ${searchEngine}` : isSearchMode ? 'Engine: ...' : ''}
                          </div>
                          <button
                            onClick={() => {
                              clearSearchAndFilters();
                              setPage(1);
                              setArticles([]);
                              setHasMore(true);
                              loadArticles(1, true);
                            }}
                            className="px-4 py-2 rounded-xl font-bold text-sm border transition-colors hover:bg-slate-50 dark:hover:bg-slate-800"
                            style={{ borderColor: 'var(--border)', color: 'var(--text-main)' }}
                          >
                            Clear
                          </button>
                        </div>

                        {Object.keys(resultTopicCounts).length > 0 && (
                          <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                            <span className="font-bold">In results:</span>{' '}
                            {Object.entries(resultTopicCounts)
                              .sort((a, b) => b[1] - a[1])
                              .slice(0, 4)
                              .map(([t, c]) => `${t} (${c})`)
                              .join(' · ')}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                {articles.map((article, idx) => (
                  <article
                    key={article._id}
                    onClick={() => handleArticleClick(article)}
                    className={`premium-card p-5 cursor-pointer group animate-fade-in`}
                    style={{ animationDelay: `${(idx % 12) * 0.05}s` }}
                  >
                    <div className="relative mb-5 overflow-hidden rounded-xl aspect-[16/10]">
                      <img
                        src={article.urlToImage || 'https://images.unsplash.com/photo-1504711434969-e33886168f5c?q=80&w=1000&auto=format&fit=crop'}
                        alt=""
                        className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
                      />
                      <div className="absolute top-4 left-4">
                        <span className="px-3 py-1 bg-white/95 dark:bg-slate-900/90 backdrop-blur font-bold text-[10px] uppercase tracking-wider rounded-lg shadow-sm text-slate-900 dark:text-slate-100">
                          {article.source}
                        </span>
                      </div>
                      {/* Bookmark button on card */}
                      <button
                        onClick={(e) => handleBookmark(e, article)}
                        className={`absolute top-4 right-4 p-2 rounded-lg backdrop-blur transition-all ${isBookmarked(article._id) ? 'bg-blue-600 text-white' : 'bg-white/95 dark:bg-slate-900/90 hover:bg-white dark:hover:bg-slate-800 text-slate-900 dark:text-slate-100'}`}
                      >
                        {isBookmarked(article._id) ? <BookmarkCheck className="w-4 h-4" /> : <Bookmark className="w-4 h-4" />}
                      </button>
                    </div>

                    <div className="space-y-4">
                      <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
                        <Clock className="w-3.5 h-3.5" />
                        {formatDate(article.publishedAt)}
                      </div>

                      <h3 className="text-xl font-bold leading-tight group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors line-clamp-2" style={{ color: 'var(--text-main)' }}>
                        {article.title}
                      </h3>

                      <p className="text-sm leading-relaxed line-clamp-3" style={{ color: 'var(--text-muted)' }}>
                        {article.description}
                      </p>

                      {Array.isArray(article.topics) && article.topics.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {article.topics.slice(0, 4).map((t) => (
                            <span
                              key={t}
                              className="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider"
                              style={{ backgroundColor: 'var(--background)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}
                            >
                              {t}
                            </span>
                          ))}
                        </div>
                      )}

                      <div className="pt-4 flex items-center justify-between border-t mt-auto" style={{ borderColor: 'var(--border)' }}>
                        <button
                          onClick={(e) => handleSummarize(e, article)}
                          className="text-xs font-bold text-blue-600 dark:text-blue-400 flex items-center gap-1.5 hover:gap-2.5 transition-all"
                        >
                          <Sparkles className="w-3.5 h-3.5" />
                          AI SUMMARY
                          <ChevronRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </article>
                ))}

                {loading && [1, 2, 3].map(i => <SkeletonCard key={`skel-${i}`} />)}
              </div>

              {!loading && articles.length === 0 && (
                <div className="rounded-3xl p-20 text-center border border-dashed" style={{ backgroundColor: 'var(--card)', borderColor: 'var(--border)' }}>
                  <div className="w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6" style={{ backgroundColor: 'var(--background)' }}>
                    <Newspaper className="w-10 h-10" style={{ color: 'var(--text-muted)' }} />
                  </div>
                  <h3 className="text-2xl font-bold mb-2" style={{ color: 'var(--text-main)' }}>
                    {selectedCategory === 'bookmarks' ? 'No bookmarks yet' : selectedCategory === 'history' ? 'No reading history' : 'No stories found'}
                  </h3>
                  <p style={{ color: 'var(--text-muted)' }}>
                    {selectedCategory === 'bookmarks' ? 'Start saving articles to see them here.' : selectedCategory === 'history' ? 'Articles you read will appear here.' : "We couldn't find any articles in this category right now."}
                  </p>
                </div>
              )}

              {articles.length > 0 && hasMore && (
                <div className="flex justify-center pt-8">
                  <button
                    onClick={handleLoadMore}
                    disabled={loadingMore}
                    className="px-8 py-4 border font-bold rounded-xl shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                    style={{ backgroundColor: 'var(--card)', borderColor: 'var(--border)', color: 'var(--text-main)' }}
                  >
                    {loadingMore ? (
                      <>
                        <Loader className="w-5 h-5 animate-spin" />
                        Loading...
                      </>
                    ) : (
                      'Load More Articles'
                    )}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      {/* Summary Modal */}
      {showSummaryModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 lg:p-8">
          <div
            className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm transition-opacity"
            onClick={() => {
              setShowSummaryModal(false);
              setAudioUrl(null);
              setIsPlaying(false);
              setAudioError(null);
            }}
          />
          <div
            className="rounded-[2rem] w-full max-w-2xl shadow-2xl relative animate-fade-in flex flex-col max-h-[85vh]"
            style={{ backgroundColor: 'var(--card)' }}
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
          >
            {/* Drag Handle for Mobile */}
            <div className="w-full flex justify-center pt-3 pb-1 lg:hidden">
              <div className="w-12 h-1.5 rounded-full" style={{ backgroundColor: 'var(--border)' }} />
            </div>

            <div className="p-6 pt-2 flex items-center justify-between border-b" style={{ borderColor: 'var(--border)' }}>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/30">
                  <Sparkles className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h3 className="font-bold" style={{ color: 'var(--text-main)' }}>AI Quick Summary</h3>
                  <p className="text-[10px] font-bold text-blue-600 dark:text-blue-400 uppercase tracking-widest"></p>
                </div>
              </div>
              <button
                onClick={() => {
                  setShowSummaryModal(false);
                  setAudioUrl(null);
                  setIsPlaying(false);
                  setAudioError(null);
                }}
                className="p-2 rounded-lg transition-colors hover:bg-slate-200 dark:hover:bg-slate-700"
                aria-label="Close modal"
              >
                <X className="w-5 h-5" style={{ color: 'var(--text-muted)' }} />
              </button>
            </div>

            <div className="p-8 pb-10 overflow-y-auto custom-scrollbar">
              {summarizing ? (
                <div className="space-y-4 py-4">
                  <div className="h-4 rounded w-full animate-pulse" style={{ backgroundColor: 'var(--border)' }} />
                  <div className="h-4 rounded w-5/6 animate-pulse" style={{ backgroundColor: 'var(--border)' }} />
                  <div className="h-4 rounded w-full animate-pulse" style={{ backgroundColor: 'var(--border)' }} />
                  <div className="h-4 rounded w-4/6 animate-pulse" style={{ backgroundColor: 'var(--border)' }} />
                  <p className="text-center text-sm font-medium pt-8" style={{ color: 'var(--text-muted)' }}>
                    Synthesizing Article...
                  </p>
                </div>
              ) : (
                <div className="prose prose-slate dark:prose-invert max-w-none">
                  <div className="text-lg leading-relaxed p-6 rounded-2xl border" style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)', color: 'var(--text-main)' }}>
                    <MessageSquare className="w-8 h-8 mb-4" style={{ color: 'var(--text-muted)' }} />
                    <div className="space-y-4">
                      {summary.split('\n').filter(line => line.trim()).map((line, idx) => {
                        const isBullet = line.trim().startsWith('-') || line.trim().startsWith('*');
                        const content = isBullet ? line.trim().substring(1).trim() : line;
                        const parts = content.split(/(\*\*[^*]+\*\*)/g);

                        return (
                          <div key={idx} className={`flex gap-3 ${isBullet ? 'pl-2' : ''}`}>
                            {isBullet && <div className="w-1.5 h-1.5 rounded-full bg-blue-400 mt-2.5 shrink-0" />}
                            <p className="m-0">
                              {parts.map((part, i) => {
                                if (part.startsWith('**') && part.endsWith('**')) {
                                  return <strong key={i} className="font-bold" style={{ color: 'var(--text-main)' }}>{part.slice(2, -2)}</strong>;
                                }
                                return part;
                              })}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="p-6 flex flex-col sm:flex-row gap-3" style={{ backgroundColor: 'var(--background)' }}>
              {!summarizing && summary && (
                <div className="flex-1 flex flex-col gap-2">
                  <button
                    onClick={handleTTS}
                    disabled={isSynthesizing}
                    className={`w-full flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-bold transition-all ${isSynthesizing
                      ? 'bg-slate-200 dark:bg-slate-700 text-slate-400 cursor-not-allowed'
                      : isPlaying
                        ? 'bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/50 border border-red-100 dark:border-red-800'
                        : 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/50 border border-blue-100 dark:border-blue-800'
                      }`}
                  >
                    {isSynthesizing ? (
                      <Loader className="w-5 h-5 animate-spin" />
                    ) : isPlaying ? (
                      <Pause className="w-5 h-5" />
                    ) : (
                      <Volume2 className="w-5 h-5" />
                    )}
                    {isSynthesizing ? 'Creating Voice...' : isPlaying ? 'Pause Summary' : 'Listen to Summary'}
                  </button>

                  {audioError && (
                    <p className="text-xs font-semibold text-red-600 dark:text-red-400">
                      {audioError}
                    </p>
                  )}
                </div>
              )}

              {audioUrl && (
                <audio
                  id="tts-audio"
                  src={audioUrl}
                  onEnded={() => setIsPlaying(false)}
                  onPause={() => setIsPlaying(false)}
                  onPlay={() => setIsPlaying(true)}
                  className="hidden"
                />
              )}

              <button
                onClick={() => {
                  setShowSummaryModal(false);
                  setAudioUrl(null);
                  setIsPlaying(false);
                  setAudioError(null);
                }}
                className="btn-primary flex-1"
              >
                Got it, thanks!
              </button>
            </div>

          </div>
        </div>
      )}
    </div>
  );
};

export default NewsApp;