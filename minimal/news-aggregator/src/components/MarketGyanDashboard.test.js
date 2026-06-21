import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MarketGyanDashboard from './MarketGyanDashboard';

const citation = {
  documentId: 'doc-1',
  title: 'Daily market',
  url: 'https://example.com/market',
  excerpt: 'NEPSE closed higher after a mixed trading session.',
  score: 0.91,
  source: 'ShareSansar',
  publishedAt: '2026-06-13T00:00:00.000Z',
  chunkId: 'chunk-1',
  contentHash: 'hash-1',
  sentenceIds: ['S1'],
  sentences: [{ id: 'S1', text: 'NEPSE closed higher after a mixed trading session.' }]
};

const sampleReport = {
  status: 'published',
  reportDate: '2026-06-13T00:00:00.000Z',
  headline: 'Market closes mixed',
  summary: 'Turnover improved with mixed sector evidence.',
  sectorAnalysis: [{
    sector: 'Banking',
    sentiment: 'neutral',
    summary: 'Banking evidence was mixed.',
    confidence: 0.5,
    evidenceIndexes: [0]
  }],
  evidence: [{
    title: citation.title,
    sourceUrl: citation.url,
    excerpt: citation.excerpt,
    relevanceScore: citation.score,
    source: citation.source,
    publishedAt: citation.publishedAt,
    chunkId: citation.chunkId,
    contentHash: citation.contentHash,
    sentenceIds: citation.sentenceIds,
    sentences: citation.sentences
  }],
  model: { version: 'mock-rag-local' }
};

const overviewPayload = {
  success: true,
  phase: 'data-pipeline',
  data: {
    snapshot: null,
    sectors: [],
    stories: [],
    report: null,
    queryEnabled: false,
    reviewEnabled: false
  },
  disclaimer: 'Informational analysis based on public data, not investment advice.'
};

const runtimePayload = {
  success: true,
  data: {
    queryEnabled: false,
    reviewEnabled: false,
    localReportGenerationAllowed: false,
    agentTokenConfigured: false,
    qdrantCollection: 'market_gyan_documents',
    latestReportStatus: null,
    latestSnapshotStatus: null
  }
};

const ok = (payload) => Promise.resolve({
  ok: true,
  json: async () => payload
});

const failed = (payload, status = 503) => Promise.resolve({
  ok: false,
  status,
  json: async () => payload
});

const setupFetch = ({
  overview = overviewPayload,
  runtime = runtimePayload,
  query = { success: true, data: { answer: 'Grounded answer', citations: [citation], disclaimer: overviewPayload.disclaimer } },
  search = { success: true, data: [citation] },
  latest = { success: true, data: sampleReport },
  generate = { success: true, data: { report: sampleReport, reused: false } }
} = {}) => {
  global.fetch = jest.fn((url) => {
    const value = String(url);
    if (value.includes('/market-gyan/overview')) return ok(overview);
    if (value.includes('/market-gyan/runtime/status')) return ok(runtime);
    if (value.includes('/market-gyan/reports/generate')) return ok(generate);
    if (value.includes('/market-gyan/reports/latest')) return ok(latest);
    if (value.includes('/market-gyan/query')) return query.ok === false ? failed(query) : ok(query);
    if (value.includes('/market-gyan/search')) return search.ok === false ? failed(search) : ok(search);
    return ok({ success: true, data: null });
  });
};

beforeEach(() => {
  jest.restoreAllMocks();
});

test('shows all demo tabs and the validation tab only when local review is enabled', async () => {
  setupFetch({
    overview: {
      ...overviewPayload,
      data: { ...overviewPayload.data, reviewEnabled: true }
    },
    runtime: {
      ...runtimePayload,
      data: { ...runtimePayload.data, reviewEnabled: true }
    }
  });

  render(<MarketGyanDashboard />);

  expect(await screen.findByRole('tab', { name: 'Overview' })).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: 'Ask MarketGyan' })).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: 'Evidence Search' })).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: 'Reports' })).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: 'System' })).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: 'Validate data' })).toBeInTheDocument();
});

test('shows loading, empty overview panels, and the investment disclaimer', async () => {
  setupFetch();

  render(<MarketGyanDashboard />);

  expect(screen.getByRole('status')).toHaveTextContent('Loading market overview');
  expect(await screen.findByText('Market data is not available yet.')).toBeInTheDocument();
  expect(screen.getByText('Sector sentiment')).toBeInTheDocument();
  expect(screen.getByText('Evidence and market stories')).toBeInTheDocument();
  expect(screen.getByText('Latest report')).toBeInTheDocument();
  expect(screen.getByRole('note')).toHaveTextContent('not investment advice');
});

test('shows an actionable error state when the overview request fails', async () => {
  global.fetch = jest.fn((url) => {
    if (String(url).includes('/market-gyan/overview')) {
      return failed({ success: false, error: 'Network unavailable' });
    }
    return ok(runtimePayload);
  });

  render(<MarketGyanDashboard />);

  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Market overview could not be loaded'
  );
  expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
});

test('runs a grounded query and renders citations', async () => {
  setupFetch({
    overview: {
      ...overviewPayload,
      data: { ...overviewPayload.data, queryEnabled: true }
    },
    runtime: {
      ...runtimePayload,
      data: { ...runtimePayload.data, queryEnabled: true }
    }
  });

  render(<MarketGyanDashboard />);

  await userEvent.click(await screen.findByRole('tab', { name: 'Ask MarketGyan' }));
  await userEvent.type(screen.getByLabelText('Question'), 'Why did NEPSE move?');
  await userEvent.click(screen.getByRole('button', { name: 'Ask with RAG' }));

  expect(await screen.findByText('Grounded answer')).toBeInTheDocument();
  expect(screen.getAllByText('NEPSE closed higher after a mixed trading session.').length).toBeGreaterThan(1);
  expect(screen.getByText(/Sentence anchors: S1/)).toBeInTheDocument();
});

test('shows query validation errors from the backend', async () => {
  setupFetch({
    overview: {
      ...overviewPayload,
      data: { ...overviewPayload.data, queryEnabled: true }
    },
    runtime: {
      ...runtimePayload,
      data: { ...runtimePayload.data, queryEnabled: true }
    },
    query: {
      ok: false,
      success: false,
      error: 'Agent returned an unsafe or invalid response',
      validationErrors: ['At least one evidence citation is required']
    }
  });

  render(<MarketGyanDashboard />);

  await userEvent.click(await screen.findByRole('tab', { name: 'Ask MarketGyan' }));
  await userEvent.type(screen.getByLabelText('Question'), 'Should I buy this?');
  await userEvent.click(screen.getByRole('button', { name: 'Ask with RAG' }));

  expect(await screen.findByRole('alert')).toHaveTextContent('unsafe or invalid');
  expect(screen.getByText('At least one evidence citation is required')).toBeInTheDocument();
});

test('fails closed when runtime status is unavailable even if overview is stale-enabled', async () => {
  global.fetch = jest.fn((url) => {
    const value = String(url);
    if (value.includes('/market-gyan/overview')) {
      return ok({
        ...overviewPayload,
        data: { ...overviewPayload.data, queryEnabled: true }
      });
    }
    if (value.includes('/market-gyan/runtime/status')) {
      return failed({ success: false, error: 'Runtime status unavailable' });
    }
    return ok({ success: true, data: null });
  });

  render(<MarketGyanDashboard />);

  await userEvent.click(await screen.findByRole('tab', { name: 'Ask MarketGyan' }));

  expect(screen.getByRole('alert')).toHaveTextContent('Grounded Q&A is locked');
  expect(screen.getByLabelText('Question')).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Ask with RAG' })).toBeDisabled();
});

test('searches the evidence index and renders sentence anchors', async () => {
  setupFetch({
    overview: {
      ...overviewPayload,
      data: { ...overviewPayload.data, queryEnabled: true }
    },
    runtime: {
      ...runtimePayload,
      data: { ...runtimePayload.data, queryEnabled: true }
    }
  });

  render(<MarketGyanDashboard />);

  await userEvent.click(await screen.findByRole('tab', { name: 'Evidence Search' }));
  await userEvent.type(screen.getByLabelText('Search query'), 'market close');
  await userEvent.click(screen.getByRole('button', { name: 'Search evidence' }));

  expect(await screen.findByText('Daily market')).toBeInTheDocument();
  expect(screen.getByText(/Sentence anchors: S1/)).toBeInTheDocument();
});

test('shows a true no-results message after an empty evidence search', async () => {
  setupFetch({
    overview: {
      ...overviewPayload,
      data: { ...overviewPayload.data, queryEnabled: true }
    },
    runtime: {
      ...runtimePayload,
      data: { ...runtimePayload.data, queryEnabled: true }
    },
    search: { success: true, data: [] }
  });

  render(<MarketGyanDashboard />);

  await userEvent.click(await screen.findByRole('tab', { name: 'Evidence Search' }));
  expect(screen.getByText('Search results will appear here after Qdrant returns evidence chunks.')).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText('Search query'), 'unmatched topic');
  await userEvent.click(screen.getByRole('button', { name: 'Search evidence' }));

  expect(await screen.findByText('No evidence chunks matched this query and filter set.')).toBeInTheDocument();
});

test('keeps evidence search disabled when runtime search is locked', async () => {
  setupFetch();

  render(<MarketGyanDashboard />);

  await userEvent.click(await screen.findByRole('tab', { name: 'Evidence Search' }));

  expect(screen.getByRole('alert')).toHaveTextContent('Evidence search is locked');
  expect(screen.getByLabelText('Search query')).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Search evidence' })).toBeDisabled();
});

test('renders latest report with sector analysis and citations', async () => {
  setupFetch({
    overview: {
      ...overviewPayload,
      data: { ...overviewPayload.data, report: sampleReport }
    },
    latest: { success: true, data: sampleReport }
  });

  render(<MarketGyanDashboard />);

  await userEvent.click(await screen.findByRole('tab', { name: 'Reports' }));

  expect(screen.getByText('Market closes mixed')).toBeInTheDocument();
  expect(screen.getByText('Banking evidence was mixed.')).toBeInTheDocument();
  expect(screen.getByText('Report citations')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Generate Report' })).not.toBeInTheDocument();
});

test('generates a local report only when runtime status allows it', async () => {
  setupFetch({
    runtime: {
      ...runtimePayload,
      data: {
        ...runtimePayload.data,
        queryEnabled: true,
        reviewEnabled: true,
        localReportGenerationAllowed: true,
        agentTokenConfigured: true
      }
    }
  });

  render(<MarketGyanDashboard />);

  await userEvent.click(await screen.findByRole('tab', { name: 'Reports' }));
  expect(screen.getByRole('button', { name: 'Generate Report' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Generate Report' }));

  expect(await screen.findByText('Report generated and published.')).toBeInTheDocument();
  expect(screen.getByText('Market closes mixed')).toBeInTheDocument();
});

test('blocks future report dates before calling the generation endpoint', async () => {
  setupFetch({
    runtime: {
      ...runtimePayload,
      data: {
        ...runtimePayload.data,
        queryEnabled: true,
        reviewEnabled: true,
        localReportGenerationAllowed: true,
        agentTokenConfigured: true
      }
    }
  });

  render(<MarketGyanDashboard />);

  await userEvent.click(await screen.findByRole('tab', { name: 'Reports' }));
  fireEvent.change(screen.getByLabelText('Report date'), {
    target: { value: '2999-01-01' }
  });

  expect(screen.getByRole('button', { name: 'Generate Report' })).toBeDisabled();
  expect(screen.getByText('Reports can only be generated for today or an earlier date.')).toBeInTheDocument();
});
