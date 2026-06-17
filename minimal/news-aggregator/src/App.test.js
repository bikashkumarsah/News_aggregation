import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { AuthProvider } from './context/AuthContext';

test('opens the Market Gyan dashboard from the Khabar sidebar', async () => {
  global.fetch = jest.fn((url) => {
    if (url.includes('/market-gyan/overview')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
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
        })
      });
    }

    return Promise.resolve({
      ok: true,
      json: async () => ({
        success: true,
        data: [],
        hasMore: false
      })
    });
  });

  render(
    <AuthProvider>
      <App />
    </AuthProvider>
  );

  await userEvent.click(screen.getByRole('button', { name: /Market Gyan/i }));

  expect(await screen.findByRole('heading', { name: 'Market Gyan' })).toBeInTheDocument();
  expect(screen.getByRole('note')).toHaveTextContent('not investment advice');
});
