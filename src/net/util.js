// Voidworks — net plumbing shared by both drivers: identity, room codes, path maths, name escaping and byte accounting.

import { NET } from '../config.js';

const UID_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';

export function randomString(length, alphabet) {
  const chars = alphabet || UID_ALPHABET;
  const n = Math.max(1, length | 0);
  let out = '';
  const buf = typeof crypto !== 'undefined' && crypto.getRandomValues
    ? crypto.getRandomValues(new Uint8Array(n))
    : null;
  for (let i = 0; i < n; i += 1) {
    const value = buf ? buf[i] : Math.floor(Math.random() * 256);
    out += chars[value % chars.length];
  }
  return out;
}

export function makeUid() {
  return randomString(NET.identityLength);
}

// There is no Firebase Auth here (anonymous sign-in needs billing), so the client identity is a
// random id minted once and kept in localStorage. It is stable across visits and orders
// deterministically, which is everything the lowest-id authority rule needs.
export function localIdentity() {
  // Two tabs of the same browser share localStorage and would therefore share an identity — which
  // is right for one player on two devices and wrong for testing co-op on one machine. ?netid=2
  // gives a tab its own identity slot without pretending to be a second browser.
  let key = NET.identityKey;
  try {
    if (typeof location !== 'undefined') {
      const slot = new URLSearchParams(location.search).get('netid');
      if (slot) key = `${key}.${String(slot).replace(/[^a-z0-9]/gi, '').slice(0, 8)}`;
    }
  } catch {
    // no location (headless) — the plain key stands
  }
  try {
    if (typeof localStorage !== 'undefined') {
      const existing = localStorage.getItem(key);
      if (typeof existing === 'string' && existing.length >= 8) return existing;
      const fresh = makeUid();
      localStorage.setItem(key, fresh);
      return fresh;
    }
  } catch {
    // private mode — fall through to a per-tab identity
  }
  return makeUid();
}

export function makeRoomCode() {
  return randomString(NET.codeLength, NET.codeAlphabet);
}

// The room code is the only access control, so the rules reject anything shorter than
// NET.codeMinLength. A short or empty code is deterministically extended rather than rejected,
// so a typo can never produce a path the rules refuse to write and a silent dead session.
export function normalizeCode(code) {
  const raw = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (raw.length >= NET.codeMinLength) return raw;
  if (!raw.length) return makeRoomCode();
  let out = raw;
  let salt = 0;
  for (let i = 0; i < raw.length; i += 1) salt = (salt * 31 + raw.charCodeAt(i)) >>> 0;
  while (out.length < NET.codeMinLength) {
    out += NET.codeAlphabet[salt % NET.codeAlphabet.length];
    salt = Math.floor(salt / NET.codeAlphabet.length) + 7;
  }
  return out;
}

// The player name comes from a text input and is persisted in localStorage, so a payload stored
// once survives every later session. It is stripped BEFORE it reaches the database and again on
// the way out, because a peer's name is not a value this client ever chose. Consumers still put
// it in the DOM with textContent — this is the belt, not the braces.
export function escapeName(value, fallback) {
  const clean = String(value == null ? '' : value)
    .replace(/[\u0000-\u001f\u007f<>&"'`\\/]/g, '')
    .slice(0, NET.nameMaxLength)
    .trim();
  return clean || (fallback || 'Engineer');
}

export function splitPath(path) {
  if (!path) return [];
  return String(path).split('/').filter((part) => part.length > 0);
}

export function joinPath(...parts) {
  return parts
    .map((p) => String(p == null ? '' : p))
    .join('/')
    .replace(/\/+/g, '/')
    .replace(/^\/|\/$/g, '');
}

export function getPath(tree, path) {
  const parts = splitPath(path);
  let node = tree;
  for (const part of parts) {
    if (node == null || typeof node !== 'object') return null;
    node = node[part];
  }
  return node === undefined ? null : node;
}

export function setPath(tree, path, value) {
  const parts = splitPath(path);
  if (!parts.length) return value;
  let node = tree;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const part = parts[i];
    if (node[part] == null || typeof node[part] !== 'object') node[part] = {};
    node = node[part];
  }
  const last = parts[parts.length - 1];
  if (value === null || value === undefined) delete node[last];
  else node[last] = value;
  return tree;
}

export function clone(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(clone);
  const out = {};
  for (const key of Object.keys(value)) out[key] = clone(value[key]);
  return out;
}

// True when `path` is the same node as `other`, an ancestor of it, or a descendant.
export function pathsOverlap(path, other) {
  if (path === other) return true;
  const a = splitPath(path);
  const b = splitPath(other);
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

export function byteLength(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value == null ? null : value);
  if (typeof TextEncoder === 'function') return new TextEncoder().encode(text).length;
  return unescape(encodeURIComponent(text)).length;
}

export function createStats() {
  return {
    bytesSent: 0,
    bytesReceived: 0,
    messagesSent: 0,
    messagesReceived: 0,
    transactionRetries: 0,
    startedAt: 0,
  };
}

// A grid cell, as an RTDB key. Levels matter: a belt and a ramp can legally share x,z on
// different levels, so a claim is per cell PER LEVEL or two players would deadlock a legal build.
export function cellClaimKey(x, z, level) {
  return `${x | 0}_${z | 0}_${level | 0}`;
}
