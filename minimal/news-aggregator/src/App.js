import React, { useState, useEffect } from 'react';
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
  Play
} from 'lucide-react';


const Toast = ({ message, type, onClose }) => {
  useEffect(() => {
    const timer = setTimeout(() => {
      onClose();
    }, 5000);
    return () => clearTimeout(timer);
  }, [onClose]);

  return (
    <div className={`fixed bottom-4 right-4 z-[110] flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg border animate-fade-in ${type === 'error' ? 'bg-red-50 border-red-100 text-red-800' : 'bg-green-50 border-green-100 text-green-800'
      }`}>
      {type === 'error' ? <AlertCircle className="w-5 h-5" /> : <CheckCircle className="w-5 h-5" />}
      <p className="font-medium text-sm">{message}</p>
      <button onClick={onClose} className="p-1 hover:bg-black/5 rounded-full transition-colors">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};

const NewsApp = () => {
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

  // TTS State
  const [isSynthesizing, setIsSynthesizing] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioUrl, setAudioUrl] = useState(null);
  const [audioError, setAudioError] = useState(null);


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

  useEffect(() => {
    setPage(1);
    setArticles([]);
    setHasMore(true);
    // Initial load
    loadArticles(1, true);
  }, [selectedCategory]);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
  };

  const loadArticles = async (pageNum = 1, isNewCategory = false) => {
    if (pageNum === 1) setLoading(true);
    else setLoadingMore(true);

    try {
      const response = await fetch(`http://localhost:5001/api/news?category=${selectedCategory}&page=${pageNum}&limit=12`);
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

  const handleSummarize = async (e, article) => {
    e.stopPropagation();
    setSummarizing(true);
    setSummary('');
    setShowSummaryModal(true);

    try {
      const response = await fetch(`http://localhost:5001/api/news/${article._id}/summarize`, {
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

      const response = await fetch(`http://localhost:5001/api/news/${selectedArticle._id}/tts`, {
        method: 'POST'
      });

      const data = await response.json();

      if (data.success) {
        setAudioUrl(`http://localhost:5001${data.audioUrl}`);
        // Auto play after synthesis
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
      <div className="w-full h-48 bg-slate-100 rounded-xl mb-4" />
      <div className="h-4 bg-slate-100 rounded w-2/3 mb-3" />
      <div className="h-6 bg-slate-100 rounded w-full mb-3" />
      <div className="h-4 bg-slate-100 rounded w-full mb-1" />
      <div className="h-4 bg-slate-100 rounded w-4/5" />
    </div>
  );

  return (
    <div className="min-h-screen flex bg-slate-50/50">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {/* Sidebar */}
      <aside className="w-72 bg-white border-r border-slate-200 hidden lg:flex flex-col sticky top-0 h-screen">
        <div className="p-8 flex items-center gap-3">
          <div className="p-2 bg-blue-600 rounded-xl shadow-lg shadow-blue-500/30">
            <Newspaper className="w-6 h-6 text-white" />
          </div>
          <span className="text-xl font-bold tracking-tight gradient-text">Khabar AI</span>
        </div>

        <nav className="flex-1 px-4 space-y-2">
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
                ? 'bg-blue-50 text-blue-600 shadow-sm'
                : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'
                }`}
            >
              {cat.icon}
              {cat.name}
              {selectedCategory === cat.id && <div className="ml-auto w-1.5 h-1.5 rounded-full bg-blue-600" />}
            </button>
          ))}
        </nav>


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
            <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-widest leading-none">
              {selectedArticle ? 'Reading Article' : `Feed / ${categories.find(c => c.id === selectedCategory).name}`}
            </h2>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-sm font-medium text-slate-500 bg-slate-100 px-3 py-1.5 rounded-lg border border-slate-200 flex items-center gap-2">
              <Clock className="w-4 h-4" />
              {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </div>
          </div>
        </header>

        <div className="p-4 lg:p-12 max-w-7xl mx-auto">
          {selectedArticle ? (
            /* Single Article View */
            <div className="animate-fade-in max-w-4xl mx-auto">
              <button
                onClick={() => setSelectedArticle(null)}
                className="flex items-center gap-2 text-slate-500 hover:text-blue-600 mb-8 font-semibold transition-colors group"
              >
                <ArrowLeft className="w-5 h-5 group-hover:-translate-x-1 transition-transform" />
                Back to Feed
              </button>

              <div className="space-y-8">
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <span className="px-3 py-1 bg-blue-100 text-blue-700 text-xs font-bold rounded-full uppercase tracking-wider">
                      {selectedArticle.category}
                    </span>
                    <span className="text-slate-400 text-sm">{formatDate(selectedArticle.publishedAt)}</span>
                  </div>
                  <h1 className="text-4xl lg:text-5xl font-extrabold text-slate-900 leading-[1.15]">
                    {selectedArticle.title}
                  </h1>
                  <div className="flex items-center gap-4 text-slate-500 pt-4 border-t border-slate-100">
                    <span className="font-semibold text-slate-900">{selectedArticle.source}</span>
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

                <div className="prose prose-slate prose-lg max-w-none">
                  <p className="text-xl lg:text-2xl text-slate-600 font-medium leading-relaxed mb-8">
                    {selectedArticle.description}
                  </p>

                  {selectedArticle.content && (
                    <div className="space-y-6">
                      {selectedArticle.content.split('\n\n').map((paragraph, index) => (
                        <p key={index} className="text-slate-800 leading-[1.8]">
                          {paragraph}
                        </p>
                      ))}
                    </div>
                  )}
                </div>

                <div className="sticky bottom-8 bg-white/80 backdrop-blur-xl border border-slate-200/50 p-4 rounded-2xl shadow-2xl flex gap-3 max-w-md mx-auto">
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
                    className="flex items-center justify-center w-14 h-12 bg-slate-100 text-slate-700 rounded-xl hover:bg-slate-200 transition-all font-bold"
                  >
                    <ExternalLink className="w-5 h-5" />
                  </a>
                </div>
              </div>
            </div>
          ) : (
            /* Feed View */
            <div className="space-y-12 pb-12">
              {/* Category Header */}
              <div className="flex items-end justify-between">
                <div>
                  <p className="text-blue-600 font-bold uppercase tracking-[0.2em] text-xs mb-3">Trending Now</p>
                  <h1 className="text-4xl lg:text-5xl font-black text-slate-900 tracking-tight">
                    {categories.find(c => c.id === selectedCategory).name}
                  </h1>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                {articles.map((article, idx) => (
                  <article
                    key={article._id}
                    onClick={() => setSelectedArticle(article)}
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
                        <span className="px-3 py-1 bg-white/90 backdrop-blur font-bold text-[10px] uppercase tracking-wider rounded-lg shadow-sm">
                          {article.source}
                        </span>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div className="flex items-center gap-2 text-slate-400 text-[11px] font-bold uppercase tracking-widest">
                        <Clock className="w-3.5 h-3.5" />
                        {formatDate(article.publishedAt)}
                      </div>

                      <h3 className="text-xl font-bold text-slate-900 leading-tight group-hover:text-blue-600 transition-colors line-clamp-2">
                        {article.title}
                      </h3>

                      <p className="text-slate-500 text-sm leading-relaxed line-clamp-3">
                        {article.description}
                      </p>

                      <div className="pt-4 flex items-center justify-between border-t border-slate-50 mt-auto">
                        <button
                          onClick={(e) => handleSummarize(e, article)}
                          className="text-xs font-bold text-blue-600 flex items-center gap-1.5 hover:gap-2.5 transition-all"
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
                <div className="bg-white rounded-3xl p-20 text-center border border-dashed border-slate-200">
                  <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-6">
                    <Newspaper className="w-10 h-10 text-slate-300" />
                  </div>
                  <h3 className="text-2xl font-bold text-slate-900 mb-2">No stories found</h3>
                  <p className="text-slate-500">We couldn't find any articles in this category right now.</p>
                </div>
              )}

              {articles.length > 0 && hasMore && (
                <div className="flex justify-center pt-8">
                  <button
                    onClick={handleLoadMore}
                    disabled={loadingMore}
                    className="px-8 py-4 bg-white border border-slate-200 text-slate-700 font-bold rounded-xl shadow-sm hover:bg-slate-50 hover:border-slate-300 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
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
            onClick={() => setShowSummaryModal(false)}
          />
          <div
            className="bg-white rounded-[2rem] w-full max-w-2xl shadow-2xl relative animate-fade-in flex flex-col max-h-[85vh]"
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
          >
            {/* Drag Handle for Mobile */}
            <div className="w-full flex justify-center pt-3 pb-1 lg:hidden">
              <div className="w-12 h-1.5 bg-slate-300 rounded-full" />
            </div>

            <div className="p-6 pt-2 flex items-center justify-between bg-white border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/30">
                  <Sparkles className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900">AI Quick Summary</h3>
                  <p className="text-[10px] font-bold text-blue-600 uppercase tracking-widest">Powered by Gemma 3</p>
                </div>
              </div>
              <button
                onClick={() => setShowSummaryModal(false)}
                className="p-2 hover:bg-slate-200 rounded-lg transition-colors"
                aria-label="Close modal"
              >
                <X className="w-5 h-5 text-slate-500" />
              </button>
            </div>

            <div className="p-8 pb-10 overflow-y-auto custom-scrollbar">
              {summarizing ? (
                <div className="space-y-4 py-4">
                  <div className="h-4 bg-slate-100 rounded w-full animate-pulse" />
                  <div className="h-4 bg-slate-100 rounded w-5/6 animate-pulse" />
                  <div className="h-4 bg-slate-100 rounded w-full animate-pulse" />
                  <div className="h-4 bg-slate-100 rounded w-4/6 animate-pulse" />
                  <p className="text-center text-slate-400 text-sm font-medium pt-8">
                    Synthesizing Article...
                  </p>
                </div>
              ) : (
                <div className="prose prose-slate max-w-none">
                  <div className="text-slate-800 text-lg leading-relaxed bg-blue-50/50 p-6 rounded-2xl border border-blue-100/50">
                    <MessageSquare className="w-8 h-8 text-blue-200 mb-4" />
                    <div className="space-y-4">
                      {summary.split('\n').filter(line => line.trim()).map((line, idx) => {
                        // Check if line is a bullet point
                        const isBullet = line.trim().startsWith('-') || line.trim().startsWith('*');
                        const content = isBullet ? line.trim().substring(1).trim() : line;

                        // Parse bold text (**text**)
                        const parts = content.split(/(\*\*[^*]+\*\*)/g);

                        return (
                          <div key={idx} className={`flex gap-3 ${isBullet ? 'pl-2' : ''}`}>
                            {isBullet && <div className="w-1.5 h-1.5 rounded-full bg-blue-400 mt-2.5 shrink-0" />}
                            <p className="m-0">
                              {parts.map((part, i) => {
                                if (part.startsWith('**') && part.endsWith('**')) {
                                  return <strong key={i} className="font-bold text-slate-900">{part.slice(2, -2)}</strong>;
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

            <div className="p-6 bg-slate-50/50 flex flex-col sm:flex-row gap-3">
              {!summarizing && summary && (
                <button
                  onClick={handleTTS}
                  disabled={isSynthesizing}
                  className={`flex-1 flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-bold transition-all ${isSynthesizing
                      ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                      : isPlaying
                        ? 'bg-red-50 text-red-600 hover:bg-red-100 border border-red-100'
                        : 'bg-blue-50 text-blue-600 hover:bg-blue-100 border border-blue-100'
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