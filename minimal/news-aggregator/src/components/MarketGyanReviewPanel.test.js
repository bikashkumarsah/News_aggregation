import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MarketGyanReviewPanel from './MarketGyanReviewPanel';

const candidate = {
  language: 'en',
  summary: 'Nabil Bank reported higher quarterly profit.',
  relevance: 'direct',
  eventType: 'earnings',
  impactScope: 'company',
  impactDirection: 'bullish',
  impactHorizon: 'short_term',
  impactMechanism: 'earnings_cash_flow',
  sectors: ['Banking'],
  symbols: ['NABIL'],
  tags: ['quarterly results'],
  confidenceBand: 'high',
  rationale: 'The reported profit increase can improve expected company cash flow.',
  evidenceSentenceIds: ['S1']
};

const queuePayload = {
  success: true,
  data: {
    items: [{
      _id: 'label-1',
      status: 'pending_review',
      input: {
        title: 'Nabil Bank quarterly result',
        sourceName: 'ShareSansar',
        sourceUrl: 'https://example.com/notice',
        selectionBucket: 'direct',
        sentences: [
          { id: 'S1', text: 'Nabil Bank reported higher quarterly profit.' },
          { id: 'S2', text: 'The board proposed a cash dividend.' }
        ]
      },
      candidate,
      assistantReview: {
        candidate,
        changedFields: ['impactDirection'],
        reviewer: 'codex',
        reviewedAt: '2026-06-15T00:00:00.000Z'
      },
      currentAnnotation: null
    }],
    total: 1,
    page: 1,
    pages: 1
  }
};

const statsPayload = {
  success: true,
  data: {
    targetAdjudicated: 500,
    total: 1,
    counts: { pending_review: 1 },
    annotationCounts: {},
    adjudicationCounts: { pending: 1 },
    assistantReviewed: 1,
    assistantCorrected: 1,
    reviewerRole: 'primary',
    gemmaFailures: 0
  }
};

const ontologyPayload = {
  success: true,
  data: {
    sectors: ['Banking', 'Hydropower'],
    relevance: ['direct', 'indirect', 'not_relevant'],
    eventTypes: ['earnings', 'regulation', 'not_applicable'],
    impactScopes: ['company', 'sector', 'market', 'none'],
    impactDirections: ['bullish', 'bearish', 'neutral', 'uncertain', 'not_applicable'],
    impactHorizons: ['immediate', 'short_term', 'medium_term', 'not_applicable'],
    impactMechanisms: ['earnings_cash_flow', 'regulation', 'uncertain', 'none'],
    confidenceBands: ['low', 'medium', 'high'],
    languages: ['en', 'ne', 'mixed']
  }
};

const responseFor = (url) => {
  if (url.includes('/stats')) return statsPayload;
  if (url.includes('/ontology')) return ontologyPayload;
  return queuePayload;
};

beforeEach(() => {
  jest.restoreAllMocks();
});

test('renders two-stage v2 review with numbered evidence selected', async () => {
  global.fetch = jest.fn((url) => Promise.resolve({
    ok: true,
    json: async () => responseFor(url)
  }));

  render(<MarketGyanReviewPanel />);

  expect(await screen.findByText('Nabil Bank quarterly result')).toBeInTheDocument();
  expect(screen.getByText('NEPSE relevance')).toBeInTheDocument();
  expect(screen.getByText('Event and potential impact')).toBeInTheDocument();
  expect(screen.getByLabelText('Candidate direction')).toHaveValue('bullish');
  expect(screen.getByText(/Evidence selected:/)).toHaveTextContent('S1');
  expect(screen.getByText(/Codex-corrected suggestion/)).toHaveTextContent('impact direction');
  expect(screen.queryByRole('button', { name: /create/i })).not.toBeInTheDocument();
});

test('submits an edited independent annotation and advances to the next queue item', async () => {
  let mutationBody;
  let queueReads = 0;
  const nextQueuePayload = {
    ...queuePayload,
    data: {
      ...queuePayload.data,
      items: [{
        ...queuePayload.data.items[0],
        _id: 'label-2',
        input: {
          ...queuePayload.data.items[0].input,
          title: 'Next NEPSE review candidate'
        }
      }]
    }
  };
  global.fetch = jest.fn((url, options = {}) => {
    if (options.method === 'PATCH') {
      mutationBody = JSON.parse(options.body);
      return Promise.resolve({
        ok: true,
        json: async () => ({ success: true, data: {} })
      });
    }
    if (url.includes('/queue')) {
      const payload = queueReads === 0 ? queuePayload : nextQueuePayload;
      queueReads += 1;
      return Promise.resolve({
        ok: true,
        json: async () => payload
      });
    }
    return Promise.resolve({
      ok: true,
      json: async () => responseFor(url)
    });
  });

  render(<MarketGyanReviewPanel />);

  const summary = await screen.findByLabelText('Candidate summary');
  fireEvent.change(summary, {
    target: { value: 'Reviewed summary of the quarterly result and its market relevance.' }
  });
  await userEvent.click(screen.getByRole('button', { name: 'Submit annotation' }));

  await waitFor(() => expect(mutationBody).toBeDefined());
  expect(mutationBody.action).toBe('submit');
  expect(mutationBody.candidate.relevance).toBe('direct');
  expect(mutationBody.candidate.summary).toContain('Reviewed summary');
  expect(await screen.findByText('Next NEPSE review candidate')).toBeInTheDocument();
  expect(screen.queryByText('Nabil Bank quarterly result')).not.toBeInTheDocument();
});

test('hard-negative selection hides impact fields and clears symbols', async () => {
  global.fetch = jest.fn((url) => Promise.resolve({
    ok: true,
    json: async () => responseFor(url)
  }));

  render(<MarketGyanReviewPanel />);

  await screen.findByText('Nabil Bank quarterly result');
  await userEvent.click(screen.getByRole('button', { name: 'Relevance not_relevant' }));

  expect(screen.queryByText('Event and potential impact')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Candidate symbols')).not.toBeInTheDocument();
});

test('shows an explicit empty state without manual gold creation', async () => {
  global.fetch = jest.fn((url) => Promise.resolve({
    ok: true,
    json: async () => url.includes('/queue')
      ? { ...queuePayload, data: { items: [], total: 0, page: 1, pages: 1 } }
      : responseFor(url)
  }));

  render(<MarketGyanReviewPanel />);

  expect(await screen.findByText('No generated v2 candidates match these filters.')).toBeInTheDocument();
  expect(screen.getByText(/cannot be created without a generated candidate/i)).toBeInTheDocument();
});

test('shows review API failures without exposing an editor', async () => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: false,
    json: async () => ({ success: false, error: 'Review tools are not available' })
  });

  render(<MarketGyanReviewPanel />);

  expect(await screen.findByRole('alert')).toHaveTextContent('Review tools are not available');
  expect(screen.queryByLabelText('Candidate summary')).not.toBeInTheDocument();
});
