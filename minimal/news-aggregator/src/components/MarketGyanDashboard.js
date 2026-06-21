import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  BarChart3,
  BookOpen,
  CheckCircle,
  Database,
  ExternalLink,
  FileText,
  MessageSquare,
  RefreshCw,
  Search,
  ShieldAlert,
  TrendingUp
} from 'lucide-react';
import { API_URL } from '../config';
import MarketGyanReviewPanel from './MarketGyanReviewPanel';

const FALLBACK_DISCLAIMER =
  'Informational analysis based on public data, not investment advice.';

const cleanFilters = (filters) => Object.fromEntries(
  Object.entries(filters).filter(([, value]) => String(value || '').trim())
);

const formatDateInput = (value = new Date()) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const localDate = new Date(date.getTime() - (date.getTimezoneOffset() * 60000));
  return localDate.toISOString().slice(0, 10);
};

const formatDate = (value) => {
  if (!value) return 'N/A';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'N/A' : date.toLocaleDateString();
};

const readJson = async (response, fallbackMessage) => {
  let payload = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }
  if (!response.ok || payload.success === false) {
    const error = new Error(payload.error || fallbackMessage);
    error.validationErrors = payload.validationErrors || [];
    throw error;
  }
  return payload;
};

const StatusPill = ({ active, label }) => (
  <span
    className={`px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider ${
      active
        ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400'
        : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
    }`}
  >
    {label}
  </span>
);

const SnapshotMetric = ({ label, value, variant = 'value' }) => (
  <div
    className="min-w-0 rounded-xl border p-4"
    style={{ borderColor: 'var(--border)', backgroundColor: 'var(--background)' }}
  >
    <p
      className="text-xs font-bold uppercase tracking-widest"
      style={{ color: 'var(--text-muted)' }}
    >
      {label}
    </p>
    {variant === 'status' ? (
      <span
        className="mt-3 inline-flex max-w-full rounded-full px-3 py-1 text-sm font-bold capitalize"
        style={{ backgroundColor: 'var(--card)', color: 'var(--text-main)' }}
      >
        {value ?? 'N/A'}
      </span>
    ) : (
      <p
        className="mt-2 min-w-0 break-words text-xl font-black leading-tight lg:text-2xl"
        style={{ color: 'var(--text-main)' }}
      >
        {value ?? 'N/A'}
      </p>
    )}
  </div>
);

const RuntimeNotice = ({ title, children }) => (
  <div
    role="alert"
    className="rounded-xl border p-4 flex gap-3"
    style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
  >
    <AlertCircle className="w-5 h-5 shrink-0 text-amber-500" />
    <div>
      <p className="font-bold" style={{ color: 'var(--text-main)' }}>
        {title}
      </p>
      <p className="mt-1 text-sm leading-relaxed">{children}</p>
    </div>
  </div>
);

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

const Field = ({ label, children }) => (
  <label className="block">
    <span className="block text-xs font-bold uppercase tracking-widest mb-2" style={{ color: 'var(--text-muted)' }}>
      {label}
    </span>
    {children}
  </label>
);

const inputClass =
  'w-full rounded-xl border px-4 py-3 bg-transparent outline-none focus:ring-2 focus:ring-blue-500/30';

const MarketFilters = ({ filters, onChange }) => {
  const update = (field, value) => onChange({ ...filters, [field]: value });
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-6 gap-3">
      <Field label="Sector">
        <input
          value={filters.sector || ''}
          onChange={(event) => update('sector', event.target.value)}
          className={inputClass}
          style={{ borderColor: 'var(--border)', color: 'var(--text-main)' }}
          placeholder="Banking"
        />
      </Field>
      <Field label="Source">
        <input
          value={filters.source || ''}
          onChange={(event) => update('source', event.target.value)}
          className={inputClass}
          style={{ borderColor: 'var(--border)', color: 'var(--text-main)' }}
          placeholder="ShareSansar"
        />
      </Field>
      <Field label="Type">
        <select
          value={filters.documentType || ''}
          onChange={(event) => update('documentType', event.target.value)}
          className={inputClass}
          style={{ borderColor: 'var(--border)', color: 'var(--text-main)' }}
        >
          <option value="">Any</option>
          <option value="financial_news">Financial news</option>
          <option value="regulatory_document">Regulatory document</option>
          <option value="archived_report">Archived report</option>
        </select>
      </Field>
      <Field label="Language">
        <select
          value={filters.language || ''}
          onChange={(event) => update('language', event.target.value)}
          className={inputClass}
          style={{ borderColor: 'var(--border)', color: 'var(--text-main)' }}
        >
          <option value="">Any</option>
          <option value="en">English</option>
          <option value="ne">Nepali</option>
        </select>
      </Field>
      <Field label="From">
        <input
          type="date"
          value={filters.from || ''}
          onChange={(event) => update('from', event.target.value)}
          className={inputClass}
          style={{ borderColor: 'var(--border)', color: 'var(--text-main)' }}
        />
      </Field>
      <Field label="To">
        <input
          type="date"
          value={filters.to || ''}
          onChange={(event) => update('to', event.target.value)}
          className={inputClass}
          style={{ borderColor: 'var(--border)', color: 'var(--text-main)' }}
        />
      </Field>
    </div>
  );
};

const CitationList = ({ citations = [] }) => {
  if (!citations.length) {
    return (
      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
        No citations were returned. MarketGyan should fail closed before using uncited output.
      </p>
    );
  }
  return (
    <div className="space-y-4">
      {citations.map((citation, index) => {
        const url = citation.url || citation.sourceUrl;
        const score = citation.score ?? citation.relevanceScore;
        return (
          <article
            key={`${url || citation.title}-${index}`}
            className="rounded-2xl border p-4"
            style={{ borderColor: 'var(--border)', backgroundColor: 'var(--background)' }}
          >
            <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
              <div>
                <h3 className="font-bold" style={{ color: 'var(--text-main)' }}>
                  {citation.title || 'Untitled evidence'}
                </h3>
                <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
                  {[citation.source, formatDate(citation.publishedAt)].filter(Boolean).join(' • ')}
                  {score !== undefined ? ` • score ${Number(score).toFixed(2)}` : ''}
                </p>
              </div>
              {url && (
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm font-bold text-blue-600"
                >
                  Source
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}
            </div>
            <p className="mt-3 text-sm leading-relaxed" style={{ color: 'var(--text-main)' }}>
              {citation.excerpt || citation.text || 'No excerpt available.'}
            </p>
            {citation.sentenceIds?.length > 0 && (
              <div className="mt-3 text-xs" style={{ color: 'var(--text-muted)' }}>
                Sentence anchors: {citation.sentenceIds.join(', ')}
              </div>
            )}
            {citation.sentences?.length > 0 && (
              <div className="mt-3 space-y-2">
                {citation.sentences.map((sentence) => (
                  <blockquote
                    key={sentence.id}
                    className="border-l-4 pl-3 text-sm"
                    style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
                  >
                    <strong>{sentence.id}:</strong> {sentence.text}
                  </blockquote>
                ))}
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
};

const ReportPanel = ({ report }) => {
  if (!report) {
    return (
      <EmptyPanel
        icon={FileText}
        title="Latest report"
        message="No published report is available yet. Use local report generation after Qdrant and the agent service are running."
      />
    );
  }
  return (
    <section className="premium-card p-6 space-y-5">
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black" style={{ color: 'var(--text-main)' }}>
            {report.headline || 'MarketGyan report'}
          </h2>
          <p className="mt-2 text-sm" style={{ color: 'var(--text-muted)' }}>
            {formatDate(report.reportDate)} • {report.status || 'unknown'} • {report.model?.version || report.model?.name || 'model unknown'}
          </p>
        </div>
        <StatusPill active={report.status === 'published'} label={report.status || 'unknown'} />
      </div>
      <p className="text-base leading-relaxed" style={{ color: 'var(--text-main)' }}>
        {report.summary || 'No summary was stored for this report.'}
      </p>
      <div>
        <h3 className="font-bold mb-3" style={{ color: 'var(--text-main)' }}>
          Sector analysis
        </h3>
        {report.sectorAnalysis?.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {report.sectorAnalysis.map((sector) => (
              <div
                key={sector.sector}
                className="rounded-xl border p-4"
                style={{ borderColor: 'var(--border)' }}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-bold" style={{ color: 'var(--text-main)' }}>
                    {sector.sector}
                  </span>
                  <span className="text-sm font-bold capitalize" style={{ color: 'var(--text-muted)' }}>
                    {sector.sentiment}
                  </span>
                </div>
                <p className="mt-2 text-sm" style={{ color: 'var(--text-muted)' }}>
                  {sector.summary || 'No sector summary.'}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            Sector analysis is unavailable for this report.
          </p>
        )}
      </div>
      <div>
        <h3 className="font-bold mb-3" style={{ color: 'var(--text-main)' }}>
          Report citations
        </h3>
        <CitationList citations={report.evidence || []} />
      </div>
    </section>
  );
};

const RuntimeChecklist = ({ status }) => {
  const items = [
    ['Query API enabled', status?.queryEnabled],
    ['Review tools enabled locally', status?.reviewEnabled],
    ['Local report generation allowed', status?.localReportGenerationAllowed],
    ['Agent token configured', status?.agentTokenConfigured],
    ['Latest snapshot available', Boolean(status?.latestSnapshotStatus)],
    ['Latest report available', Boolean(status?.latestReportStatus)]
  ];
  return (
    <section className="premium-card p-6">
      <h2 className="text-xl font-black mb-4" style={{ color: 'var(--text-main)' }}>
        RAG runtime readiness
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {items.map(([label, ok]) => (
          <div
            key={label}
            className="flex items-center gap-3 rounded-xl border p-4"
            style={{ borderColor: 'var(--border)' }}
          >
            {ok ? (
              <CheckCircle className="w-5 h-5 text-emerald-600" />
            ) : (
              <AlertCircle className="w-5 h-5 text-amber-500" />
            )}
            <span className="font-semibold" style={{ color: 'var(--text-main)' }}>
              {label}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-5 text-sm leading-relaxed" style={{ color: 'var(--text-muted)' }}>
        Qdrant collection: <strong>{status?.qdrantCollection || 'unknown'}</strong>.
        This checklist reports safe configuration state only. Runtime still fails closed when Qdrant,
        FastAPI, local generation, or citations are unavailable during an action.
      </div>
    </section>
  );
};

const MarketGyanDashboard = () => {
  const [overview, setOverview] = useState(null);
  const [runtimeStatus, setRuntimeStatus] = useState(null);
  const [latestReport, setLatestReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [activeTab, setActiveTab] = useState('overview');

  const [question, setQuestion] = useState('');
  const [queryFilters, setQueryFilters] = useState({});
  const [queryLoading, setQueryLoading] = useState(false);
  const [queryError, setQueryError] = useState('');
  const [queryValidationErrors, setQueryValidationErrors] = useState([]);
  const [queryResult, setQueryResult] = useState(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchFilters, setSearchFilters] = useState({});
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchSubmitted, setSearchSubmitted] = useState(false);

  const [reportDate, setReportDate] = useState(() => formatDateInput());
  const [forceReport, setForceReport] = useState(false);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState('');
  const [reportMessage, setReportMessage] = useState('');

  const loadOverview = useCallback(async (signal) => {
    setLoading(true);
    setError('');

    try {
      const response = await fetch(`${API_URL}/market-gyan/overview`, { signal });
      const payload = await readJson(response, 'Market Gyan overview is unavailable');
      setOverview(payload);
      setLatestReport(payload.data?.report || null);

      try {
        const statusResponse = await fetch(`${API_URL}/market-gyan/runtime/status`, { signal });
        const statusPayload = await readJson(statusResponse, 'Runtime status is unavailable');
        setRuntimeStatus(
          statusPayload.data && typeof statusPayload.data === 'object' && !Array.isArray(statusPayload.data)
            ? statusPayload.data
            : null
        );
      } catch (statusError) {
        if (statusError.name !== 'AbortError') {
          setRuntimeStatus(null);
        }
      }
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
  const queryEnabled = Boolean(runtimeStatus?.queryEnabled);
  const reviewEnabled = Boolean(runtimeStatus?.reviewEnabled);
  const reportGenerationAllowed = Boolean(runtimeStatus?.localReportGenerationAllowed);
  const todayInputDate = formatDateInput();
  const reportDateInvalid = !reportDate || reportDate > todayInputDate;
  const tabs = useMemo(() => ([
    { id: 'overview', label: 'Overview' },
    { id: 'ask', label: 'Ask MarketGyan' },
    { id: 'search', label: 'Evidence Search' },
    { id: 'reports', label: 'Reports' },
    { id: 'system', label: 'System' },
    ...(reviewEnabled ? [{ id: 'review', label: 'Validate data' }] : [])
  ]), [reviewEnabled]);

  useEffect(() => {
    if (!tabs.some((tab) => tab.id === activeTab)) {
      setActiveTab('overview');
    }
  }, [activeTab, tabs]);

  const submitQuery = async (event) => {
    event.preventDefault();
    if (!queryEnabled) {
      setQueryError('MarketGyan query is disabled by runtime configuration');
      return;
    }
    setQueryLoading(true);
    setQueryError('');
    setQueryValidationErrors([]);
    setQueryResult(null);
    try {
      const response = await fetch(`${API_URL}/market-gyan/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question,
          filters: cleanFilters(queryFilters)
        })
      });
      const payload = await readJson(response, 'MarketGyan query failed');
      setQueryResult(payload.data);
    } catch (requestError) {
      setQueryError(requestError.message || 'MarketGyan query failed');
      setQueryValidationErrors(requestError.validationErrors || []);
    } finally {
      setQueryLoading(false);
    }
  };

  const submitSearch = async (event) => {
    event.preventDefault();
    if (!queryEnabled) {
      setSearchError('MarketGyan evidence search is disabled by runtime configuration');
      return;
    }
    setSearchLoading(true);
    setSearchError('');
    setSearchResults([]);
    setSearchSubmitted(true);
    try {
      const params = new URLSearchParams({
        q: searchQuery,
        ...cleanFilters(searchFilters)
      });
      const response = await fetch(`${API_URL}/market-gyan/search?${params.toString()}`);
      const payload = await readJson(response, 'MarketGyan evidence search failed');
      setSearchResults(payload.data || []);
    } catch (requestError) {
      setSearchError(requestError.message || 'MarketGyan evidence search failed');
    } finally {
      setSearchLoading(false);
    }
  };

  const refreshLatestReport = async () => {
    setReportLoading(true);
    setReportError('');
    setReportMessage('');
    try {
      const response = await fetch(`${API_URL}/market-gyan/reports/latest`);
      const payload = await readJson(response, 'Latest report could not be loaded');
      setLatestReport(payload.data || null);
      setReportMessage(payload.data ? 'Latest report refreshed.' : 'No published report is available yet.');
    } catch (requestError) {
      setReportError(requestError.message || 'Latest report could not be loaded');
    } finally {
      setReportLoading(false);
    }
  };

  const generateReport = async (event) => {
    event.preventDefault();
    if (reportDateInvalid) {
      setReportError('Choose today or an earlier market date before generating a report.');
      return;
    }
    setReportLoading(true);
    setReportError('');
    setReportMessage('');
    try {
      const response = await fetch(`${API_URL}/market-gyan/reports/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: reportDate,
          force: forceReport
        })
      });
      const payload = await readJson(response, 'MarketGyan report generation failed');
      setLatestReport(payload.data?.report || null);
      setReportMessage(payload.data?.reused ? 'Published report reused.' : 'Report generated and published.');
      setReloadKey((value) => value + 1);
    } catch (requestError) {
      setReportError(requestError.message || 'MarketGyan report generation failed');
      if (requestError.validationErrors?.length) {
        setReportError(`${requestError.message}: ${requestError.validationErrors.join('; ')}`);
      }
    } finally {
      setReportLoading(false);
    }
  };

  return (
    <div className="market-gyan-dashboard space-y-8 pb-12 animate-fade-in">
      <div className="flex flex-col xl:flex-row xl:items-end xl:justify-between gap-6">
        <div className="max-w-3xl">
          <div className="flex items-center gap-3 mb-4">
            <span className="px-3 py-1 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 text-xs font-bold uppercase tracking-wider">
              RAG demo
            </span>
            <span className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
              NEPSE intelligence
            </span>
          </div>
          <h1 className="text-4xl lg:text-5xl font-black tracking-tight" style={{ color: 'var(--text-main)' }}>
            Market Gyan
          </h1>
          <p className="mt-4 text-lg leading-relaxed" style={{ color: 'var(--text-muted)' }}>
            A Nepal-focused market analysis workspace for evidence search,
            grounded questions, daily reports, and citation-backed market context.
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

      {!loading && !error && data && (
        <div
          role="tablist"
          aria-label="MarketGyan workspace"
          className="flex flex-wrap gap-2 border-b"
          style={{ borderColor: 'var(--border)' }}
        >
          {tabs.map((tab) => (
            <button
              key={tab.id}
              id={`market-gyan-tab-${tab.id}`}
              role="tab"
              aria-selected={activeTab === tab.id}
              aria-controls={`market-gyan-panel-${tab.id}`}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-3 font-bold border-b-2 ${activeTab === tab.id ? 'text-blue-600 border-blue-600' : 'border-transparent'}`}
            >
              {tab.label}
            </button>
          ))}
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

      {!loading && !error && data && activeTab === 'review' && reviewEnabled && (
        <div
          id="market-gyan-panel-review"
          role="tabpanel"
          aria-labelledby="market-gyan-tab-review"
        >
          <MarketGyanReviewPanel />
        </div>
      )}

      {!loading && !error && data && activeTab === 'overview' && (
        <div
          id="market-gyan-panel-overview"
          role="tabpanel"
          aria-labelledby="market-gyan-tab-overview"
          className="space-y-6"
        >
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
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  <SnapshotMetric label="NEPSE close" value={data.snapshot.index?.close} />
                  <SnapshotMetric
                    label="Change"
                    value={data.snapshot.index?.changePercent != null
                      ? `${data.snapshot.index.changePercent}%`
                      : undefined}
                  />
                  <SnapshotMetric label="Turnover" value={data.snapshot.turnover?.amount} />
                  <SnapshotMetric label="Status" value={data.snapshot.status} variant="status" />
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed p-8 text-center" style={{ borderColor: 'var(--border)' }}>
                  <p className="font-bold" style={{ color: 'var(--text-main)' }}>
                    Market data is not available yet.
                  </p>
                  <p className="mt-2 text-sm" style={{ color: 'var(--text-muted)' }}>
                    Run deterministic market ingestion before generating a daily report.
                  </p>
                </div>
              )}
            </section>

            <EmptyPanel
              icon={FileText}
              title="Latest report"
              message={
                latestReport
                  ? latestReport.summary
                  : 'No report has been generated yet. Local generation is available only when the runtime checklist passes.'
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
                    <div key={sector.name || sector.sector} className="flex items-center justify-between border-b py-3 last:border-0" style={{ borderColor: 'var(--border)' }}>
                      <span className="font-semibold" style={{ color: 'var(--text-main)' }}>{sector.name || sector.sector}</span>
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
                      key={story.url || story.id}
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
                  Source-backed financial stories and regulatory evidence will appear after ingestion and indexing.
                </p>
              )}
            </section>
          </div>
        </div>
      )}

      {!loading && !error && data && activeTab === 'ask' && (
        <section
          id="market-gyan-panel-ask"
          role="tabpanel"
          aria-labelledby="market-gyan-tab-ask"
          className="premium-card p-6 space-y-6"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <MessageSquare className="w-5 h-5 text-blue-600" />
                <h2 className="text-xl font-black" style={{ color: 'var(--text-main)' }}>
                  Ask MarketGyan
                </h2>
              </div>
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                Answers must come with citations and the MarketGyan disclaimer.
              </p>
            </div>
            <StatusPill active={queryEnabled} label={queryEnabled ? 'Enabled' : 'Disabled'} />
          </div>

          {!queryEnabled && (
            <RuntimeNotice title="Grounded Q&A is locked">
              Set <code>MARKET_GYAN_QUERY_ENABLED=true</code>, run Qdrant, index MarketGyan evidence,
              and start the FastAPI agent service. Until then this form is disabled instead of
              sending a request that could invent an uncited answer.
            </RuntimeNotice>
          )}

          <form onSubmit={submitQuery} className="space-y-4">
            <fieldset disabled={!queryEnabled || queryLoading} className="space-y-4 disabled:opacity-60">
              <Field label="Question">
                <textarea
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  className={`${inputClass} min-h-[120px]`}
                  style={{ borderColor: 'var(--border)', color: 'var(--text-main)' }}
                  placeholder="Why did banking stocks move today?"
                  required
                />
              </Field>
              <MarketFilters filters={queryFilters} onChange={setQueryFilters} />
              <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                Ask factual questions only. MarketGyan will return citations or reject the response.
              </p>
              <button
                type="submit"
                disabled={!queryEnabled || queryLoading || !question.trim()}
                className="btn-primary inline-flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {queryLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <MessageSquare className="w-4 h-4" />}
                Ask with RAG
              </button>
            </fieldset>
          </form>

          {queryError && (
            <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">
              <p className="font-bold">{queryError}</p>
              {queryValidationErrors.length > 0 && (
                <ul className="mt-2 list-disc pl-5 text-sm">
                  {queryValidationErrors.map((item) => <li key={item}>{item}</li>)}
                </ul>
              )}
            </div>
          )}

          {queryResult && (
            <div className="space-y-5">
              <div className="rounded-2xl border p-5" style={{ borderColor: 'var(--border)' }}>
                <h3 className="font-bold mb-2" style={{ color: 'var(--text-main)' }}>
                  Answer
                </h3>
                <p className="leading-relaxed" style={{ color: 'var(--text-main)' }}>
                  {queryResult.answer}
                </p>
                <p className="mt-4 text-sm font-semibold" style={{ color: 'var(--text-muted)' }}>
                  {queryResult.disclaimer || disclaimer}
                </p>
              </div>
              <h3 className="font-bold" style={{ color: 'var(--text-main)' }}>
                Citations used
              </h3>
              <CitationList citations={queryResult.citations || []} />
            </div>
          )}
        </section>
      )}

      {!loading && !error && data && activeTab === 'search' && (
        <section
          id="market-gyan-panel-search"
          role="tabpanel"
          aria-labelledby="market-gyan-tab-search"
          className="premium-card p-6 space-y-6"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <Search className="w-5 h-5 text-blue-600" />
                <h2 className="text-xl font-black" style={{ color: 'var(--text-main)' }}>
                  Evidence Search
                </h2>
              </div>
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                Search the MarketGyan Qdrant collection and inspect retrieved sentence anchors.
              </p>
            </div>
            <StatusPill active={queryEnabled} label={queryEnabled ? 'Enabled' : 'Disabled'} />
          </div>

          {!queryEnabled && (
            <RuntimeNotice title="Evidence search is locked">
              Start Qdrant, index MarketGyan documents, and enable <code>MARKET_GYAN_QUERY_ENABLED</code>.
              The search form remains disabled because retrieved evidence is the only acceptable source for
              downstream answers and reports.
            </RuntimeNotice>
          )}

          <form onSubmit={submitSearch} className="space-y-4">
            <fieldset disabled={!queryEnabled || searchLoading} className="space-y-4 disabled:opacity-60">
              <Field label="Search query">
                <input
                  value={searchQuery}
                  onChange={(event) => {
                    setSearchQuery(event.target.value);
                    setSearchSubmitted(false);
                  }}
                  className={inputClass}
                  style={{ borderColor: 'var(--border)', color: 'var(--text-main)' }}
                  placeholder="NRB liquidity policy"
                  required
                />
              </Field>
              <MarketFilters filters={searchFilters} onChange={setSearchFilters} />
              <button
                type="submit"
                disabled={!queryEnabled || searchLoading || !searchQuery.trim()}
                className="btn-primary inline-flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {searchLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Database className="w-4 h-4" />}
                Search evidence
              </button>
            </fieldset>
          </form>

          {searchError && (
            <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">
              {searchError}
            </div>
          )}

          {searchResults.length > 0 ? (
            <CitationList citations={searchResults} />
          ) : (
            !searchLoading && (
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                {searchSubmitted
                  ? 'No evidence chunks matched this query and filter set.'
                  : 'Search results will appear here after Qdrant returns evidence chunks.'}
              </p>
            )
          )}
        </section>
      )}

      {!loading && !error && data && activeTab === 'reports' && (
        <div
          id="market-gyan-panel-reports"
          role="tabpanel"
          aria-labelledby="market-gyan-tab-reports"
          className="space-y-6"
        >
          <section className="premium-card p-6 space-y-4">
            <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
              <div>
                <h2 className="text-xl font-black" style={{ color: 'var(--text-main)' }}>
                  Report generation
                </h2>
                <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
                  Local report generation is available only in non-production loopback review mode.
                </p>
              </div>
              <StatusPill active={reportGenerationAllowed} label={reportGenerationAllowed ? 'Local enabled' : 'Locked'} />
            </div>

            {reportGenerationAllowed ? (
              <form onSubmit={generateReport} className="grid grid-cols-1 md:grid-cols-[1fr_auto_auto] gap-3 md:items-end">
                <Field label="Report date">
                  <input
                    type="date"
                    value={reportDate}
                    max={todayInputDate}
                    onChange={(event) => setReportDate(event.target.value)}
                    className={inputClass}
                    style={{ borderColor: 'var(--border)', color: 'var(--text-main)' }}
                  />
                </Field>
                <label className="flex items-center gap-2 rounded-xl border px-4 py-3 font-semibold" style={{ borderColor: 'var(--border)', color: 'var(--text-main)' }}>
                  <input
                    type="checkbox"
                    checked={forceReport}
                    onChange={(event) => setForceReport(event.target.checked)}
                  />
                  Force regenerate
                </label>
                <button
                  type="submit"
                  disabled={reportLoading || reportDateInvalid}
                  className="btn-primary inline-flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {reportLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
                  Generate Report
                </button>
                {reportDateInvalid && (
                  <p className="md:col-span-3 text-sm text-red-600">
                    Reports can only be generated for today or an earlier date.
                  </p>
                )}
              </form>
            ) : (
              <RuntimeNotice title="Report generation is locked">
                Enable local review mode from loopback and keep runtime inference enabled. The public dashboard
                can view reports, but report creation remains local-only to prevent accidental publication.
              </RuntimeNotice>
            )}
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={refreshLatestReport}
                disabled={reportLoading}
                className="px-4 py-2 rounded-xl border font-bold disabled:opacity-60"
                style={{ borderColor: 'var(--border)', color: 'var(--text-main)' }}
              >
                Refresh latest report
              </button>
            </div>
            {reportError && (
              <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">
                {reportError}
              </div>
            )}
            {reportMessage && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-700">
                {reportMessage}
              </div>
            )}
          </section>
          <ReportPanel report={latestReport} />
        </div>
      )}

      {!loading && !error && data && activeTab === 'system' && (
        <div
          id="market-gyan-panel-system"
          role="tabpanel"
          aria-labelledby="market-gyan-tab-system"
        >
          <RuntimeChecklist status={runtimeStatus} />
        </div>
      )}
    </div>
  );
};

export default MarketGyanDashboard;
