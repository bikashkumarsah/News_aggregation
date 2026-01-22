/**
 * Application Configuration
 * 
 * Automatically detects the current host to enable access from 
 * any device on the same network.
 */

// Get the current hostname (works with IP addresses too)
const hostname = window.location.hostname;

// Backend API port
const API_PORT = 5001;

// Construct the API base URL dynamically
// This allows the app to work when accessed via:
// - localhost:3000
// - 192.168.x.x:3000 (same network)
// - any other host
export const API_BASE_URL = `http://${hostname}:${API_PORT}`;

// API endpoints
export const API_URL = `${API_BASE_URL}/api`;

// Audio URL base (for TTS)
export const AUDIO_BASE_URL = API_BASE_URL;

export default {
  API_BASE_URL,
  API_URL,
  AUDIO_BASE_URL,
  hostname
};
