/**
 * Application Configuration
 *
 * Resolves the backend URL for every way the app is served:
 * - REACT_APP_API_BASE_URL (build-time) always wins, e.g. https://api.example.com
 * - React dev server (port 3000): the API runs on REACT_APP_API_PORT (default
 *   5001) on the same host, so phones on the LAN reach it via 192.168.x.x
 * - Production build served by the API itself or behind a reverse proxy: the
 *   API shares the page's origin (and protocol, so HTTPS just works)
 */

const { protocol, hostname, port, origin } = window.location;

const configuredBaseUrl = (process.env.REACT_APP_API_BASE_URL || '').trim().replace(/\/+$/, '');
const API_PORT = process.env.REACT_APP_API_PORT || '5001';
const DEV_SERVER_PORT = process.env.REACT_APP_DEV_SERVER_PORT || '3000';

export const API_BASE_URL = configuredBaseUrl
  || (port === DEV_SERVER_PORT ? `${protocol}//${hostname}:${API_PORT}` : origin);

// API endpoints
export const API_URL = `${API_BASE_URL}/api`;

// Audio URL base (for TTS)
export const AUDIO_BASE_URL = API_BASE_URL;

const config = {
  API_BASE_URL,
  API_URL,
  AUDIO_BASE_URL,
  hostname
};

export default config;
