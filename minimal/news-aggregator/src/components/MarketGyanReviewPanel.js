import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Check,
  Download,
  ExternalLink,
  Flag,
  RefreshCw,
  RotateCcw,
  Save,
  Send,
  Upload,
  X
} from 'lucide-react';
import { API_URL } from '../config';

const FALLBACK_ONTOLOGY = {
  sectors: [],
  relevance: ['direct', 'indirect', 'not_relevant'],
  eventTypes: [
    'market_trading', 'earnings', 'capital_action', 'governance',
    'project_operations', 'credit_financing', 'regulation',
    'monetary_liquidity', 'fiscal_macroeconomic', 'sector_industry',
    'other', 'not_applicable'
  ],
  impactScopes: ['company', 'sector', 'market', 'none'],
  impactDirections: ['bullish', 'bearish', 'neutral', 'uncertain', 'not_applicable'],
  impactHorizons: ['immediate', 'short_term', 'medium_term', 'not_applicable'],
  impactMechanisms: [
    'earnings_cash_flow', 'ownership_supply', 'financing_liquidity',
    'regulation', 'demand_revenue', 'operations_capacity',
    'valuation_sentiment', 'market_flow', 'uncertain', 'none'
  ],
  confidenceBands: ['low', 'medium', 'high'],
  languages: ['en', 'ne', 'mixed']
};

const emptyStats = {
  targetAdjudicated: 500,
  total: 0,
  counts: {},
  annotationCounts: {},
  adjudicationCounts: {},
  assistantReviewed: 0,
  assistantCorrected: 0,
  revalidationAudit: {
    needsReview: 0,
    bySource: {}
  },
  reviewerRole: 'primary',
  gemmaFailures: 0
};

const cloneCandidate = (candidate = {}) => ({
  language: candidate.language || 'en',
  summary: candidate.summary || '',
  relevance: candidate.relevance || 'not_relevant',
  eventType: candidate.eventType || 'not_applicable',
  impactScope: candidate.impactScope || 'none',
  impactDirection: candidate.impactDirection || 'not_applicable',
  impactHorizon: candidate.impactHorizon || 'not_applicable',
  impactMechanism: candidate.impactMechanism || 'none',
  sectors: candidate.sectors || [],
  symbols: candidate.symbols || [],
  tags: candidate.tags || [],
  confidenceBand: candidate.confidenceBand || 'low',
  rationale: candidate.rationale || '',
  evidenceSentenceIds: candidate.evidenceSentenceIds || []
});

const applyRelevance = (candidate, relevance) => relevance === 'not_relevant'
  ? {
      ...candidate,
      relevance,
      eventType: 'not_applicable',
      impactScope: 'none',
      impactDirection: 'not_applicable',
      impactHorizon: 'not_applicable',
      impactMechanism: 'none',
      sectors: [],
      symbols: []
    }
  : {
      ...candidate,
      relevance,
      eventType: candidate.eventType === 'not_applicable' ? 'other' : candidate.eventType,
      impactScope: candidate.impactScope === 'none' ? 'market' : candidate.impactScope,
      impactDirection: candidate.impactDirection === 'not_applicable'
        ? 'uncertain'
        : candidate.impactDirection,
      impactHorizon: candidate.impactHorizon === 'not_applicable'
        ? 'short_term'
        : candidate.impactHorizon,
      impactMechanism: candidate.impactMechanism === 'none'
        ? 'uncertain'
        : candidate.impactMechanism
    };

const labelText = (value) => String(value || '')
  .replace(/([a-z])([A-Z])/g, '$1 $2')
  .replaceAll('_', ' ')
  .toLowerCase();

const Metric = ({ label, value }) => (
  <div className="rounded-xl border p-3" style={{ borderColor: 'var(--border)' }}>
    <p className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{label}</p>
    <p className="mt-1 text-xl font-black" style={{ color: 'var(--text-main)' }}>{value}</p>
  </div>
);

const FieldSelect = ({ label, value, values, onChange, ariaLabel }) => (
  <label className="text-sm font-semibold">
    {label}
    <select
      aria-label={ariaLabel || label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="mt-1 w-full rounded-lg border bg-transparent p-2"
      style={{ borderColor: 'var(--border)' }}
    >
      {values.map((option) => (
        <option key={option} value={option}>{labelText(option)}</option>
      ))}
    </select>
  </label>
);

const MarketGyanReviewPanel = () => {
  const [items, setItems] = useState([]);
  const [stats, setStats] = useState(emptyStats);
  const [ontology, setOntology] = useState(FALLBACK_ONTOLOGY);
  const [filters, setFilters] = useState({
    schemaVersion: '2',
    status: 'pending_review',
    source: '',
    language: '',
    relevance: '',
    eventType: '',
    direction: '',
    sector: '',
    adjudicationStatus: 'pending',
    secondReview: false,
    needsRevalidation: false,
    includeReviewed: false,
    hasErrors: false
  });
  const [candidate, setCandidate] = useState(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [auditImporting, setAuditImporting] = useState(false);
  const [auditMessage, setAuditMessage] = useState('');
  const [error, setError] = useState('');

  const query = useMemo(() => {
    const params = new URLSearchParams({ limit: '50' });
    Object.entries(filters).forEach(([key, value]) => {
      if (value) params.set(key, String(value));
    });
    return params.toString();
  }, [filters]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [queueResponse, statsResponse, ontologyResponse] = await Promise.all([
        fetch(`${API_URL}/market-gyan/review/queue?${query}`),
        fetch(`${API_URL}/market-gyan/review/stats?schemaVersion=2`),
        fetch(`${API_URL}/market-gyan/review/ontology`)
      ]);
      const [queuePayload, statsPayload, ontologyPayload] = await Promise.all([
        queueResponse.json(),
        statsResponse.json(),
        ontologyResponse.json()
      ]);
      if (!queueResponse.ok || !queuePayload.success) {
        throw new Error(queuePayload.error || 'Review queue is unavailable');
      }
      if (!statsResponse.ok || !statsPayload.success) {
        throw new Error(statsPayload.error || 'Review statistics are unavailable');
      }
      if (!ontologyResponse.ok || !ontologyPayload.success) {
        throw new Error(ontologyPayload.error || 'Market ontology is unavailable');
      }
      const nextItems = queuePayload.data.items || [];
      const firstCandidate = nextItems[0]?.currentAnnotation?.annotation
        || nextItems[0]?.candidate;
      setItems(nextItems);
      setStats(statsPayload.data || emptyStats);
      setOntology({ ...FALLBACK_ONTOLOGY, ...(ontologyPayload.data || {}) });
      setCandidate(firstCandidate ? cloneCandidate(firstCandidate) : null);
      setRejectionReason('');
    } catch (requestError) {
      setError(requestError.message || 'Review queue is unavailable');
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    load();
  }, [load]);

  const item = items[0];
  const relevant = candidate && candidate.relevance !== 'not_relevant';

  const mutate = async (path, body) => {
    if (!item) return;
    setSaving(true);
    setError('');
    try {
      const response = await fetch(`${API_URL}/market-gyan/review/items/${item._id}${path}`, {
        method: path ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {})
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) {
        const details = payload.validationErrors?.length
          ? `: ${payload.validationErrors.join('; ')}`
          : '';
        throw new Error(`${payload.error || 'Review update failed'}${details}`);
      }
      await load();
    } catch (requestError) {
      setError(requestError.message || 'Review update failed');
    } finally {
      setSaving(false);
    }
  };

  const importAudit = async () => {
    setAuditImporting(true);
    setAuditMessage('');
    setError('');
    try {
      const response = await fetch(`${API_URL}/market-gyan/review/audit/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ schemaVersion: 2 })
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || 'Audit import failed');
      }
      const imported = payload.data?.imported || 0;
      const missing = payload.data?.missing?.length || 0;
      setAuditMessage(`Loaded ${imported} audit-priority records${missing ? `; ${missing} IDs were not found in MongoDB` : ''}.`);
      setFilters((current) => ({
        ...current,
        status: '',
        adjudicationStatus: '',
        needsRevalidation: true,
        includeReviewed: true
      }));
    } catch (requestError) {
      setError(requestError.message || 'Audit import failed');
    } finally {
      setAuditImporting(false);
    }
  };

  const setList = (field, value) => {
    setCandidate((current) => ({
      ...current,
      [field]: value.split(',').map((entry) => entry.trim()).filter(Boolean)
    }));
  };

  const toggleValue = (field, value) => {
    setCandidate((current) => ({
      ...current,
      [field]: current[field].includes(value)
        ? current[field].filter((entry) => entry !== value)
        : [...current[field], value]
    }));
  };

  return (
    <div className="space-y-6">
      <section className="premium-card p-5">
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
          <Metric label="Adjudicated target" value={`${stats.adjudicationCounts.adjudicated || 0}/${stats.targetAdjudicated}`} />
          <Metric label="Pending candidates" value={stats.counts.pending_review || 0} />
          <Metric label="Submitted reviews" value={stats.annotationCounts.submitted || 0} />
          <Metric label="Excluded" value={stats.adjudicationCounts.excluded || 0} />
          <Metric label="Gemma failures" value={stats.gemmaFailures || 0} />
          <Metric label="Need revalidation" value={stats.revalidationAudit?.needsReview || 0} />
          <Metric label="Codex reviewed" value={stats.assistantReviewed || 0} />
          <Metric label="Codex corrected" value={stats.assistantCorrected || 0} />
          <Metric label="Reviewer role" value={stats.reviewerRole || 'primary'} />
        </div>
      </section>

      <section className="premium-card p-5">
        <div className="flex flex-wrap items-end gap-3">
          <FieldSelect label="Status" ariaLabel="Status filter" value={filters.status} values={['', 'pending_review', 'approved', 'rejected', 'failed']} onChange={(value) => setFilters({ ...filters, status: value })} />
          <label className="text-sm font-semibold">Source
            <input aria-label="Source filter" value={filters.source} onChange={(event) => setFilters({ ...filters, source: event.target.value })} className="mt-1 block rounded-lg border bg-transparent p-2" style={{ borderColor: 'var(--border)' }} />
          </label>
          <FieldSelect label="Language" ariaLabel="Language filter" value={filters.language} values={['', ...ontology.languages]} onChange={(value) => setFilters({ ...filters, language: value })} />
          <FieldSelect label="Relevance" ariaLabel="Relevance filter" value={filters.relevance} values={['', ...ontology.relevance]} onChange={(value) => setFilters({ ...filters, relevance: value })} />
          <FieldSelect label="Event" ariaLabel="Event filter" value={filters.eventType} values={['', ...ontology.eventTypes]} onChange={(value) => setFilters({ ...filters, eventType: value })} />
          <FieldSelect label="Direction" ariaLabel="Direction filter" value={filters.direction} values={['', ...ontology.impactDirections]} onChange={(value) => setFilters({ ...filters, direction: value })} />
          <FieldSelect label="Adjudication" ariaLabel="Adjudication filter" value={filters.adjudicationStatus} values={['', 'pending', 'adjudicated', 'excluded']} onChange={(value) => setFilters({ ...filters, adjudicationStatus: value })} />
          <label className="flex items-center gap-2 pb-2 text-sm font-semibold">
            <input type="checkbox" checked={filters.secondReview} onChange={(event) => setFilters({ ...filters, secondReview: event.target.checked })} />
            Second-review subset
          </label>
          <label className="flex items-center gap-2 pb-2 text-sm font-semibold">
            <input
              type="checkbox"
              checked={filters.needsRevalidation}
              onChange={(event) => setFilters({
                ...filters,
                needsRevalidation: event.target.checked,
                includeReviewed: event.target.checked ? true : filters.includeReviewed,
                status: event.target.checked ? '' : filters.status,
                adjudicationStatus: event.target.checked ? '' : filters.adjudicationStatus
              })}
            />
            Needs revalidation
          </label>
          <label className="flex items-center gap-2 pb-2 text-sm font-semibold">
            <input type="checkbox" checked={filters.includeReviewed} onChange={(event) => setFilters({ ...filters, includeReviewed: event.target.checked })} />
            Show submitted
          </label>
          <div className="ml-auto flex gap-2">
            <button disabled={auditImporting} type="button" onClick={importAudit} className="btn-secondary flex items-center gap-2">
              <Upload className="w-4 h-4" /> {auditImporting ? 'Loading audit...' : 'Load error audit'}
            </button>
            <a href={`${API_URL}/market-gyan/review/export?schemaVersion=2`} className="btn-secondary flex items-center gap-2">
              <Download className="w-4 h-4" /> Gold export
            </a>
            <button type="button" onClick={load} className="btn-secondary flex items-center gap-2">
              <RefreshCw className="w-4 h-4" /> Refresh
            </button>
          </div>
        </div>
      </section>

      {auditMessage && (
        <div role="status" className="premium-card border-emerald-300 p-4 text-sm text-emerald-700 dark:text-emerald-300">
          <Flag className="inline w-5 h-5 mr-2" />{auditMessage}
        </div>
      )}

      {error && (
        <div role="alert" className="premium-card border-red-300 p-4 text-red-700 dark:text-red-300">
          <AlertCircle className="inline w-5 h-5 mr-2" />{error}
        </div>
      )}

      {loading && (
        <div role="status" className="premium-card p-10 text-center" style={{ color: 'var(--text-muted)' }}>
          Loading NEPSE-Impact-500 review queue...
        </div>
      )}

      {!loading && !item && (
        <div className="premium-card p-10 text-center">
          <h2 className="text-xl font-bold" style={{ color: 'var(--text-main)' }}>No generated v2 candidates match these filters.</h2>
          <p className="mt-2 text-sm" style={{ color: 'var(--text-muted)' }}>Run the v2 structuring worker or change the filters. Gold labels cannot be created without a generated candidate.</p>
        </div>
      )}

      {!loading && item && !candidate && (
        <section className="premium-card p-6 space-y-4">
          <h2 className="text-xl font-black" style={{ color: 'var(--text-main)' }}>{item.input.title}</h2>
          <div role="alert" className="rounded-xl border border-red-300 p-4 text-sm text-red-700 dark:text-red-300">
            <p className="font-bold">No valid v2 candidate is available.</p>
            <p className="mt-1">{item.lastError || 'Gemma returned a response that did not pass validation.'}</p>
          </div>
          <button disabled={saving} type="button" onClick={() => mutate('/regenerate')} className="btn-secondary flex items-center gap-2">
            <RotateCcw className="w-4 h-4" /> Regenerate
          </button>
        </section>
      )}

      {!loading && item && candidate && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <section className="premium-card p-6 space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                  {item.input.sourceName} | {item.input.selectionBucket || 'unclassified'}
                </p>
                <h2 className="mt-2 text-xl font-black" style={{ color: 'var(--text-main)' }}>{item.input.title}</h2>
                {item.assistantReview?.reviewedAt && (
                  <p className="mt-2 text-xs font-bold text-emerald-700 dark:text-emerald-300">
                    {item.assistantReview.changedFields?.length
                      ? `Codex-corrected suggestion: ${item.assistantReview.changedFields.map(labelText).join(', ')}`
                    : 'Codex review confirmed the generated candidate without changes.'}
                  </p>
                )}
                {item.revalidationAudit?.needsReview && (
                  <div role="note" className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                    <p className="font-black">
                      Needs revalidation: priority {item.revalidationAudit.priorityScore || 0}
                    </p>
                    {item.revalidationAudit.models?.length > 0 && (
                      <p className="mt-1">Models: {item.revalidationAudit.models.join(', ')}</p>
                    )}
                    {item.revalidationAudit.reasons?.length > 0 && (
                      <p className="mt-1">Reason: {item.revalidationAudit.reasons.join('; ')}</p>
                    )}
                  </div>
                )}
              </div>
              <a href={item.input.sourceUrl} target="_blank" rel="noopener noreferrer" aria-label="Open source" className="p-2 rounded-lg border" style={{ borderColor: 'var(--border)' }}>
                <ExternalLink className="w-4 h-4" />
              </a>
            </div>
            <div className="space-y-2">
              {(item.input.sentences || []).map((sentence) => {
                const selected = candidate.evidenceSentenceIds.includes(sentence.id);
                return (
                  <button
                    key={sentence.id}
                    type="button"
                    aria-label={`Evidence ${sentence.id}`}
                    onClick={() => toggleValue('evidenceSentenceIds', sentence.id)}
                    className={`w-full rounded-lg border p-3 text-left text-sm leading-6 ${selected ? 'bg-amber-100 dark:bg-amber-900/40' : ''}`}
                    style={{ borderColor: 'var(--border)' }}
                  >
                    <span className="mr-2 font-black">{sentence.id}</span>{sentence.text}
                  </button>
                );
              })}
            </div>
          </section>

          <section className="premium-card p-6 space-y-5">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-blue-600">Stage 1</p>
              <h3 className="text-lg font-black">NEPSE relevance</h3>
              <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-2">
                {ontology.relevance.map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-label={`Relevance ${value}`}
                    onClick={() => setCandidate((current) => applyRelevance(current, value))}
                    className={`rounded-lg border p-3 text-sm font-bold ${candidate.relevance === value ? 'bg-blue-600 text-white' : ''}`}
                    style={{ borderColor: 'var(--border)' }}
                  >
                    {labelText(value)}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <FieldSelect label="Language" value={candidate.language} values={ontology.languages} onChange={(value) => setCandidate({ ...candidate, language: value })} />
              <FieldSelect label="Confidence" value={candidate.confidenceBand} values={ontology.confidenceBands} onChange={(value) => setCandidate({ ...candidate, confidenceBand: value })} />
            </div>
            <label className="block text-sm font-semibold">Source-language summary
              <textarea aria-label="Candidate summary" rows="3" value={candidate.summary} onChange={(event) => setCandidate({ ...candidate, summary: event.target.value })} className="mt-1 w-full rounded-lg border bg-transparent p-3" style={{ borderColor: 'var(--border)' }} />
            </label>

            {relevant && (
              <div className="space-y-4 border-t pt-5" style={{ borderColor: 'var(--border)' }}>
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-blue-600">Stage 2</p>
                  <h3 className="text-lg font-black">Event and potential impact</h3>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <FieldSelect label="Event type" value={candidate.eventType} values={ontology.eventTypes.filter((value) => value !== 'not_applicable')} onChange={(value) => setCandidate({ ...candidate, eventType: value })} />
                  <FieldSelect label="Impact scope" value={candidate.impactScope} values={ontology.impactScopes.filter((value) => value !== 'none')} onChange={(value) => setCandidate({ ...candidate, impactScope: value })} />
                  <FieldSelect label="Direction" ariaLabel="Candidate direction" value={candidate.impactDirection} values={ontology.impactDirections.filter((value) => value !== 'not_applicable')} onChange={(value) => setCandidate({ ...candidate, impactDirection: value })} />
                  <FieldSelect label="Horizon" value={candidate.impactHorizon} values={ontology.impactHorizons.filter((value) => value !== 'not_applicable')} onChange={(value) => setCandidate({ ...candidate, impactHorizon: value })} />
                  <FieldSelect label="Mechanism" value={candidate.impactMechanism} values={ontology.impactMechanisms.filter((value) => value !== 'none')} onChange={(value) => setCandidate({ ...candidate, impactMechanism: value })} />
                </div>
                <div>
                  <p className="text-sm font-semibold mb-2">Sectors</p>
                  <div className="flex flex-wrap gap-2">
                    {ontology.sectors.map((sector) => (
                      <button key={sector} type="button" onClick={() => toggleValue('sectors', sector)} className={`px-3 py-1.5 rounded-full border text-xs font-bold ${candidate.sectors.includes(sector) ? 'bg-blue-600 text-white' : ''}`} style={{ borderColor: 'var(--border)' }}>{sector}</button>
                    ))}
                  </div>
                </div>
                <label className="block text-sm font-semibold">NEPSE symbols
                  <input aria-label="Candidate symbols" value={candidate.symbols.join(', ')} onChange={(event) => setList('symbols', event.target.value)} className="mt-1 w-full rounded-lg border bg-transparent p-2" style={{ borderColor: 'var(--border)' }} />
                </label>
              </div>
            )}

            <label className="block text-sm font-semibold">Tags
              <input aria-label="Candidate tags" value={candidate.tags.join(', ')} onChange={(event) => setList('tags', event.target.value)} className="mt-1 w-full rounded-lg border bg-transparent p-2" style={{ borderColor: 'var(--border)' }} />
            </label>
            <label className="block text-sm font-semibold">Source-language rationale
              <textarea aria-label="Candidate rationale" rows="4" value={candidate.rationale} onChange={(event) => setCandidate({ ...candidate, rationale: event.target.value })} className="mt-1 w-full rounded-lg border bg-transparent p-3" style={{ borderColor: 'var(--border)' }} />
            </label>
            <p className="text-sm">
              Evidence selected: <strong>{candidate.evidenceSentenceIds.join(', ') || 'none'}</strong>
            </p>
            <label className="block text-sm font-semibold">Rejection or adjudication note
              <input aria-label="Rejection reason" value={rejectionReason} onChange={(event) => setRejectionReason(event.target.value)} className="mt-1 w-full rounded-lg border bg-transparent p-2" style={{ borderColor: 'var(--border)' }} />
            </label>

            <div className="flex flex-wrap gap-2 pt-2">
              <button disabled={saving} type="button" onClick={() => mutate('', { action: 'submit', candidate })} className="btn-primary flex items-center gap-2"><Send className="w-4 h-4" /> Submit annotation</button>
              <button disabled={saving} type="button" onClick={() => mutate('', { action: 'save', candidate })} className="btn-secondary flex items-center gap-2"><Save className="w-4 h-4" /> Save draft</button>
              <button disabled={saving} type="button" onClick={() => mutate('', { action: 'reject', reason: rejectionReason })} className="btn-secondary flex items-center gap-2 text-red-600"><X className="w-4 h-4" /> Reject item</button>
              {stats.reviewerRole === 'adjudicator' && (
                <button disabled={saving} type="button" onClick={() => mutate('/adjudicate', { action: 'adjudicate', candidate, reason: rejectionReason })} className="btn-secondary flex items-center gap-2 text-green-700"><Check className="w-4 h-4" /> Adjudicate gold</button>
              )}
              <button disabled={saving} type="button" onClick={() => mutate('/regenerate')} className="btn-secondary flex items-center gap-2"><RotateCcw className="w-4 h-4" /> Regenerate</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
};

export default MarketGyanReviewPanel;
