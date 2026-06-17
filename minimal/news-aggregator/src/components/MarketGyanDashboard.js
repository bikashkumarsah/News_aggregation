import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  BarChart3,
  BookOpen,
  FileText,
  RefreshCw,
  ShieldAlert,
  TrendingUp
} from 'lucide-react';
import { API_URL } from '../config';
import MarketGyanReviewPanel from './MarketGyanReviewPanel';

const FALLBACK_DISCLAIMER =
  'Informational analysis based on public data, not investment advice.';

const EmptyPanel = ({ icon: Icon, title, message }) => (
  <section className="premium-card p-6">
    <div className="flex items-start gap-4">
      <div
        className="p-3 rounded-xl"
        style={{ backgroundColor: 'var(--background)', color: 'var(--text-muted)' }}
      >
        <Icon className="w-5 h-5" />
      </div>
      <div>
        <h2 className="text-lg font-bold" style={{ color: 'var(--text-main)' }}>
          {title}
        </h2>
        <p className="mt-2 text-sm leading-relaxed" style={{ color: 'var(--text-muted)' }}>
          {message}
        </p>
      </div>
    </div>
  </section>
);

const MarketGyanDashboard = () => {
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [activeTab, setActiveTab] = useState('overview');

  const loadOverview = useCallback(async (signal) => {
    setLoading(true);
    setError('');

    try {
      const response = await fetch(`${API_URL}/market-gyan/overview`, { signal });
      const payload = await response.json();

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || 'Market Gyan overview is unavailable');
      }

      setOverview(payload);
    } catch (requestError) {
      if (requestError.name !== 'AbortError') {
        setError(requestError.message || 'Market Gyan overview is unavailable');
      }
    } finally {
      if (!signal.aborted) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    loadOverview(controller.signal);
    return () => controller.abort();
  }, [loadOverview, reloadKey]);

  const data = overview?.data;
  const disclaimer = overview?.disclaimer || FALLBACK_DISCLAIMER;

  return (
    <div className="space-y-8 pb-12 animate-fade-in">
      <div className="flex flex-col xl:flex-row xl:items-end xl:justify-between gap-6">
        <div className="max-w-3xl">
          <div className="flex items-center gap-3 mb-4">
            <span className="px-3 py-1 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 text-xs font-bold uppercase tracking-wider">
              Data pipeline
            </span>
            <span className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
              NEPSE intelligence
            </span>
          </div>
          <h1 className="text-4xl lg:text-5xl font-black tracking-tight" style={{ color: 'var(--text-main)' }}>
            Market Gyan
          </h1>
          <p className="mt-4 text-lg leading-relaxed" style={{ color: 'var(--text-muted)' }}>
            A Nepal-focused market analysis workspace for daily NEPSE movement,
            financial evidence, sector sentiment, and grounded reports.
          </p>
        </div>

        <div
          role="note"
          className="max-w-xl flex gap-3 p-4 rounded-2xl border"
          style={{
            backgroundColor: 'var(--card)',
            borderColor: 'var(--border)',
            color: 'var(--text-muted)'
          }}
        >
          <ShieldAlert className="w-5 h-5 shrink-0 text-amber-500" />
          <p className="text-sm font-medium leading-relaxed">{disclaimer}</p>
        </div>
      </div>

      {!loading && !error && overview?.data?.reviewEnabled && (
        <div className="flex gap-2 border-b" style={{ borderColor: 'var(--border)' }}>
          <button
            type="button"
            onClick={() => setActiveTab('overview')}
            className={`px-4 py-3 font-bold border-b-2 ${activeTab === 'overview' ? 'text-blue-600 border-blue-600' : 'border-transparent'}`}
          >
            Overview
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('review')}
            className={`px-4 py-3 font-bold border-b-2 ${activeTab === 'review' ? 'text-blue-600 border-blue-600' : 'border-transparent'}`}
          >
            Validate data
          </button>
        </div>
      )}

      {loading && (
        <div
          role="status"
          className="premium-card p-10 flex items-center justify-center gap-3"
          style={{ color: 'var(--text-muted)' }}
        >
          <RefreshCw className="w-5 h-5 animate-spin" />
          <span className="font-semibold">Loading market overview...</span>
        </div>
      )}

      {!loading && error && (
        <div
          role="alert"
          className="premium-card p-8 flex flex-col sm:flex-row sm:items-center gap-5"
        >
          <div className="p-3 rounded-xl bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400">
            <AlertCircle className="w-6 h-6" />
          </div>
          <div className="flex-1">
            <h2 className="text-lg font-bold" style={{ color: 'var(--text-main)' }}>
              Market overview could not be loaded
            </h2>
            <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
              {error}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setReloadKey((value) => value + 1)}
            className="btn-primary flex items-center justify-center gap-2"
          >
            <RefreshCw className="w-4 h-4" />
            Retry
          </button>
        </div>
      )}

      {!loading && !error && data && activeTab === 'review' && data.reviewEnabled && (
        <MarketGyanReviewPanel />
      )}

      {!loading && !error && data && activeTab === 'overview' && (
        <>
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            <section className="premium-card p-6 xl:col-span-2">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-3 rounded-xl bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400">
                  <TrendingUp className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-lg font-bold" style={{ color: 'var(--text-main)' }}>
                    Daily market snapshot
                  </h2>
                  <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                    NEPSE close, turnover, market breadth, and leaders
                  </p>
                </div>
              </div>

              {data.snapshot ? (
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>NEPSE close</p>
                    <p className="mt-2 text-2xl font-black" style={{ color: 'var(--text-main)' }}>{data.snapshot.index?.close ?? 'N/A'}</p>
                  </div>
                  <div>
                    <p className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Change</p>
                    <p className="mt-2 text-2xl font-black" style={{ color: 'var(--text-main)' }}>{data.snapshot.index?.changePercent ?? 'N/A'}%</p>
                  </div>
                  <div>
                    <p className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Turnover</p>
                    <p className="mt-2 text-2xl font-black" style={{ color: 'var(--text-main)' }}>{data.snapshot.turnover?.amount ?? 'N/A'}</p>
                  </div>
                  <div>
                    <p className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Status</p>
                    <p className="mt-2 text-2xl font-black capitalize" style={{ color: 'var(--text-main)' }}>{data.snapshot.status ?? 'N/A'}</p>
                  </div>
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed p-8 text-center" style={{ borderColor: 'var(--border)' }}>
                  <p className="font-bold" style={{ color: 'var(--text-main)' }}>
                    Market data is not available yet.
                  </p>
                  <p className="mt-2 text-sm" style={{ color: 'var(--text-muted)' }}>
                    Run the deterministic market ingestion command to populate this area.
                  </p>
                </div>
              )}
            </section>

            <EmptyPanel
              icon={FileText}
              title="Daily market report"
              message={
                data.report
                  ? data.report.summary
                  : 'No report has been generated. Report automation remains outside this milestone.'
              }
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <section className="premium-card p-6">
              <div className="flex items-center gap-3 mb-5">
                <BarChart3 className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                <h2 className="text-lg font-bold" style={{ color: 'var(--text-main)' }}>
                  Sector sentiment
                </h2>
              </div>
              {data.sectors.length > 0 ? (
                <div className="space-y-3">
                  {data.sectors.map((sector) => (
                    <div key={sector.name} className="flex items-center justify-between border-b py-3 last:border-0" style={{ borderColor: 'var(--border)' }}>
                      <span className="font-semibold" style={{ color: 'var(--text-main)' }}>{sector.name}</span>
                      <span className="text-sm font-bold capitalize" style={{ color: 'var(--text-muted)' }}>{sector.sentiment}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                  Sector sentiment will appear after market data and finance documents are available.
                </p>
              )}
            </section>

            <section className="premium-card p-6">
              <div className="flex items-center gap-3 mb-5">
                <BookOpen className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                <h2 className="text-lg font-bold" style={{ color: 'var(--text-main)' }}>
                  Evidence and market stories
                </h2>
              </div>
              {data.stories.length > 0 ? (
                <div className="space-y-4">
                  {data.stories.map((story) => (
                    <a
                      key={story.url}
                      href={story.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block font-semibold hover:text-blue-600"
                      style={{ color: 'var(--text-main)' }}
                    >
                      {story.title}
                    </a>
                  ))}
                </div>
              ) : (
                <p className="text-sm leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                  Source-backed financial stories and regulatory evidence will be listed here after ingestion is implemented.
                </p>
              )}
            </section>
          </div>

          <section className="premium-card p-6 flex flex-col md:flex-row md:items-center gap-5">
            <div className="p-3 rounded-xl" style={{ backgroundColor: 'var(--background)', color: 'var(--text-muted)' }}>
              <AlertCircle className="w-5 h-5" />
            </div>
            <div className="flex-1">
              <h2 className="text-lg font-bold" style={{ color: 'var(--text-main)' }}>
                Interactive market questions
              </h2>
              <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
                Grounded question answering will be enabled after the finance retrieval index and evidence workflow are ready.
              </p>
            </div>
            <span className="px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider" style={{ backgroundColor: 'var(--background)', color: 'var(--text-muted)' }}>
              {data.queryEnabled ? 'Enabled' : 'Coming later'}
            </span>
          </section>
        </>
      )}
    </div>
  );
};

export default MarketGyanDashboard;
