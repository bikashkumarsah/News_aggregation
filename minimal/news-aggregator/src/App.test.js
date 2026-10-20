import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { AuthProvider } from './context/AuthContext';

const jsonResponse = (body, ok = true, status = 200) => Promise.resolve({
  ok,
  status,
  json: async () => body
});

const marketGyanOverview = {
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

const article = (id, title, extra = {}) => ({
  _id: id,
  title,
  description: `${title} description`,
  content: `${title} content`,
  category: 'technology',
  source: 'Test Source',
  url: `https://example.com/${id}`,
  publishedAt: '2026-10-15T00:00:00.000Z',
  topics: [],
  ...extra
});

const renderApp = () => render(
  <AuthProvider>
    <App />
  </AuthProvider>
);

afterEach(() => {
  jest.restoreAllMocks();
  localStorage.clear();
});

test('opens the Market Gyan dashboard from the Khabar sidebar', async () => {
  global.fetch = jest.fn((url) => {
    if (url.includes('/market-gyan/overview')) return jsonResponse(marketGyanOverview);
    return jsonResponse({ success: true, data: [], hasMore: false });
  });

  renderApp();

  const sidebar = screen.getByRole('navigation', { name: 'Primary' });
  await userEvent.click(within(sidebar).getByRole('button', { name: /Market Gyan/i }));

  expect(await screen.findByRole('heading', { name: 'Market Gyan' })).toBeInTheDocument();
  expect(screen.getByRole('note')).toHaveTextContent('not investment advice');
});

test('mobile section navigation switches categories', async () => {
  global.fetch = jest.fn(() => jsonResponse({ success: true, data: [], hasMore: false }));

  renderApp();

  const sections = screen.getByRole('navigation', { name: 'Sections' });
  await userEvent.click(within(sections).getByRole('button', { name: /Sports/i }));

  await waitFor(() => {
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/news?category=sports'));
  });
  expect(within(sections).getByRole('button', { name: /Sports/i })).toHaveAttribute('aria-current', 'page');
});

test('summaries requested from a feed card can be played and rated for that article', async () => {
  const story = article('a1', 'Budget approved');
  global.fetch = jest.fn((url, options = {}) => {
    if (url.includes('/news/a1/summarize')) {
      return jsonResponse({ success: true, data: 'The **budget** was approved.' });
    }
    if (url.includes('/news/a1/tts')) {
      return jsonResponse({ success: true, audioUrl: '/audio/a1-hash.wav' });
    }
    if (url.includes('/news?')) return jsonResponse({ success: true, data: [story], hasMore: false });
    return jsonResponse({ success: false, error: `unexpected ${options.method || 'GET'} ${url}` }, false, 404);
  });
  jest.spyOn(window.HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
  jest.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});

  renderApp();

  await userEvent.click(await screen.findByRole('button', { name: /AI SUMMARY/i }));
  const dialog = await screen.findByRole('dialog', { name: /AI Quick Summary/i });
  expect(await within(dialog).findByText('budget')).toBeInTheDocument();
  expect(within(dialog).getByText('Budget approved')).toBeInTheDocument();

  await userEvent.click(within(dialog).getByRole('button', { name: /Listen to Summary/i }));
  await waitFor(() => {
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/news/a1/tts'),
      expect.objectContaining({ method: 'POST' })
    );
  });
});

test('a failed summary shows the error without offering playback or rating', async () => {
  const story = article('b1', 'Market update');
  global.fetch = jest.fn((url) => {
    if (url.includes('/summarize')) {
      return jsonResponse({ success: false, error: 'Could not generate a summary right now' }, false, 502);
    }
    return jsonResponse({ success: true, data: [story], hasMore: false });
  });

  renderApp();

  await userEvent.click(await screen.findByRole('button', { name: /AI SUMMARY/i }));
  const dialog = await screen.findByRole('dialog', { name: /AI Quick Summary/i });
  expect(await within(dialog).findByRole('alert')).toHaveTextContent('Could not generate a summary right now');
  expect(within(dialog).queryByRole('button', { name: /Listen to Summary/i })).not.toBeInTheDocument();
  expect(within(dialog).queryByRole('button', { name: /^Rate$/i })).not.toBeInTheDocument();

  await userEvent.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});

test('a slow response for a previous category never replaces the current feed', async () => {
  let resolveAllNews;
  global.fetch = jest.fn((url) => {
    if (url.includes('category=all')) {
      return new Promise((resolve) => {
        resolveAllNews = () => resolve({
          ok: true,
          status: 200,
          json: async () => ({ success: true, data: [article('old', 'Stale all-news story')], hasMore: false })
        });
      });
    }
    if (url.includes('category=sports')) {
      return jsonResponse({ success: true, data: [article('s1', 'Fresh sports story', { category: 'sports' })], hasMore: false });
    }
    return jsonResponse({ success: true, data: [], hasMore: false });
  });

  renderApp();

  const sidebar = screen.getByRole('navigation', { name: 'Primary' });
  await userEvent.click(within(sidebar).getByRole('button', { name: /Sports/i }));
  expect(await screen.findByText('Fresh sports story')).toBeInTheDocument();

  resolveAllNews();
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(screen.queryByText('Stale all-news story')).not.toBeInTheDocument();
  expect(screen.getByText('Fresh sports story')).toBeInTheDocument();
});
