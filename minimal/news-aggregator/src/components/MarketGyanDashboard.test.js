import { render, screen } from '@testing-library/react';
import MarketGyanDashboard from './MarketGyanDashboard';

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

beforeEach(() => {
  jest.restoreAllMocks();
});

test('shows the validation tab only when the local review API is enabled', async () => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      ...overviewPayload,
      data: {
        ...overviewPayload.data,
        reviewEnabled: true
      }
    })
  });

  render(<MarketGyanDashboard />);

  expect(await screen.findByRole('button', { name: 'Validate data' })).toBeInTheDocument();
});

test('shows a loading state while the overview request is pending', () => {
  global.fetch = jest.fn(() => new Promise(() => {}));

  render(<MarketGyanDashboard />);

  expect(screen.getByRole('status')).toHaveTextContent('Loading market overview');
});

test('shows empty foundation panels and the investment disclaimer', async () => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => overviewPayload
  });

  render(<MarketGyanDashboard />);

  expect(await screen.findByText('Market data is not available yet.')).toBeInTheDocument();
  expect(screen.getByText('Sector sentiment')).toBeInTheDocument();
  expect(screen.getByText('Evidence and market stories')).toBeInTheDocument();
  expect(screen.getByText('Daily market report')).toBeInTheDocument();
  expect(screen.getByRole('note')).toHaveTextContent('not investment advice');
});

test('shows an actionable error state when the API request fails', async () => {
  global.fetch = jest.fn().mockRejectedValue(new Error('Network unavailable'));

  render(<MarketGyanDashboard />);

  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Market overview could not be loaded'
  );
  expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
});
