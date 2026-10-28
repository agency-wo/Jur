// Copy this file to config.js and fill in your keys. config.js is gitignored.
// On deploy, GitHub Actions regenerates config.js from the repo's Secrets.
//
// The safe setup: deploy the Worker in cloudflare-worker/ with the keys as its secrets and set
// AI_PROXY to its URL. Then the keys below stay empty, and nothing secret is published: on deploy
// this file is served to every visitor, so any key written here can be read by anyone.
const AI_PROXY = 'YOUR_WORKER_URL_HERE';   // e.g. https://jur-ai.<account>.workers.dev
//
// Without a Worker the app calls the providers itself, in order (Groq gpt-oss-20b, Groq
// gpt-oss-120b, Gemini 2.5-flash-lite, Gemini 2.5-flash), falling back to the next one when a key
// expires, a model is busy or an answer comes back empty. Leave a key as its placeholder to skip it.
//
// Groq (free):          https://console.groq.com/keys
const GROQ_KEY = 'YOUR_GROQ_KEY_HERE';
// Google Gemini (free): https://aistudio.google.com/apikey
// (Gemini also powers semantic grounding + the "real web sources" search — keep it set.)
const GEMINI_KEY = 'YOUR_GEMINI_KEY_HERE';
// Cerebras was removed on 2026-10-28: its free tier answers 402 "Payment required" to every call.

// Login credentials (any of the three pairs grants access):
const LOGIN_USER = 'user1';  const LOGIN_PASS = 'pass1';
const LOGIN_USER2 = 'user2'; const LOGIN_PASS2 = 'pass2';
const LOGIN_USER3 = 'user3'; const LOGIN_PASS3 = 'pass3';
