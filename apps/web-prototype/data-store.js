(function () {
  'use strict';

  const PLACE_KEY = 'yyj_places';
  const COLLECTION_KEY = 'yyj_collections';
  const PHOTO_KEY = 'yyj_place_photos';
  const REQUEST_TIMEOUT = 5000;
  let mode = 'browser';
  let fallback = false;

  class AuthenticationError extends Error {
    constructor(message, status = 401, payload = null) {
      super(message);
      this.name = 'AuthenticationError';
      this.status = status;
      this.payload = payload;
    }
  }

  const isServerCapableOrigin = () => ['http:', 'https:'].includes(location.protocol);

  function readLocal(key, fallbackValue) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || 'null');
      return value ?? fallbackValue;
    } catch (error) {
      console.error(`로컬 데이터 읽기 실패: ${key}`, error);
      return fallbackValue;
    }
  }

  function writeLocal(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      console.error(`로컬 데이터 저장 실패: ${key}`, error);
      throw new Error('브라우저 저장 공간이 부족하거나 사용할 수 없습니다.');
    }
  }

  function normalizePlace(item) {
    const photos = readLocal(PHOTO_KEY, {});
    return {
      id: String(item.id),
      name: String(item.name || ''),
      category: String(item.category || '기타'),
      memo: String(item.memo || ''),
      tags: Array.isArray(item.tags) ? item.tags.map(String) : [],
      date: item.visitedAt || item.date || new Date().toISOString().slice(0, 10),
      lat: item.latitude ?? item.lat ?? null,
      lng: item.longitude ?? item.lng ?? null,
      collection: item.collectionId ?? item.collection ?? '',
      privacy: item.privacy || 'private',
      image: photos[item.id] || item.image || ''
    };
  }

  function toServerPlace(place) {
    return {
      name: place.name,
      category: place.category,
      memo: place.memo,
      tags: place.tags,
      visitedAt: place.date,
      latitude: place.lat,
      longitude: place.lng,
      collectionId: place.collection || null,
      privacy: place.privacy
    };
  }

  function normalizeCollection(item) {
    return { id: String(item.id), name: String(item.name || ''), privacy: item.privacy || 'private' };
  }

  async function request(path, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
    try {
      const useBearer = options.useBearer === true;
      const requestOptions = { ...options }; delete requestOptions.useBearer;
      const headers = { 'content-type': 'application/json', ...(requestOptions.headers || {}) };
      if (useBearer) { const token = await window.YYJSupabaseAuth.getAccessToken(); if (token) headers.Authorization = `Bearer ${token}`; }
      const response = await fetch(path, { ...requestOptions, credentials: 'same-origin', signal: controller.signal, headers });
      const raw = await response.text();
      if (!raw) throw new Error('서버가 빈 응답을 보냈습니다.');
      let payload;
      try { payload = JSON.parse(raw); } catch (error) { throw new Error('서버 응답 형식이 올바르지 않습니다.'); }
      if (!response.ok) {
        if (response.status === 401 || (response.status === 409 && payload.error === 'auth_identity_conflict')) throw new AuthenticationError(payload.message || '로그인이 필요합니다.', response.status, payload);
        const error = new Error(payload.message || (response.status === 404 ? '요청한 데이터를 찾을 수 없습니다.' : response.status >= 500 ? '서버에서 오류가 발생했습니다.' : '입력값을 확인해 주세요.'));
        error.status = response.status;
        error.payload = payload;
        throw error;
      }
      return payload;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('서버 응답 시간이 초과되었습니다.');
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async function checkServer() {
    if (!isServerCapableOrigin()) return false;
    const result = await request('/api/health', { useBearer: false });
    return result.ok === true;
  }

  async function initialize(seedPlaces, seedCollections) {
    if (isServerCapableOrigin()) {
      try {
        if (!await checkServer()) throw new Error('서버 상태를 확인할 수 없습니다.');
        const config = await request('/api/auth/config', { useBearer: false });
        window.YYJSupabaseAuth.initialize(config.item);
        mode = 'server';
        fallback = false;
        try {
          const user = await getCurrentUser();
          const [places, collections] = await Promise.all([listPlaces(), listCollections()]);
          return { places, collections, user, mode, fallback, authRequired: false };
        } catch (error) {
          if (error instanceof AuthenticationError) return { places: [], collections: [], user: null, mode, fallback, authRequired: true, authIssue: error.payload && error.payload.error ? error.payload.error : 'unauthorized' };
          throw error;
        }
      } catch (error) {
        console.error('서버 연결 실패, 브라우저 저장으로 전환합니다.', error);
        if (error && ['SUPABASE_AUTH_STATE_ERROR', 'SUPABASE_AUTH_CONFIG_ERROR'].includes(error.code)) throw error;
        mode = 'browser';
        fallback = true;
      }
    }
    const places = readLocal(PLACE_KEY, seedPlaces).map(normalizePlace);
    const collections = readLocal(COLLECTION_KEY, seedCollections).map(normalizeCollection);
    if (localStorage.getItem(PLACE_KEY) === null) writeLocal(PLACE_KEY, places);
    if (localStorage.getItem(COLLECTION_KEY) === null) writeLocal(COLLECTION_KEY, collections);
    return {
      places,
      collections,
      mode,
      fallback
    };
  }

  async function register(credentials) {
    return (await request('/api/auth/register', { method: 'POST', body: JSON.stringify(credentials), useBearer: false })).item;
  }

  async function login(credentials) {
    return (await request('/api/auth/login', { method: 'POST', body: JSON.stringify(credentials), useBearer: false })).item;
  }

  async function linkSupabaseAccount(password) {
    return await request('/api/auth/link-supabase', { method: 'POST', body: JSON.stringify({ password }), useBearer: true });
  }

  async function logout() {
    const results = await Promise.allSettled([request('/api/auth/logout', { method: 'POST', body: '{}', useBearer: false }), window.YYJSupabaseAuth.signOut()]);
    const failure = results.find(result => result.status === 'rejected');
    if (failure) { const error = new Error('로그아웃을 완료하지 못했습니다.'); error.code = 'LOGOUT_FAILED'; throw error; }
  }

  async function getCurrentUser() {
    return (await request('/api/auth/me', { useBearer: true })).item;
  }

  async function loadServerData() {
    const [places, collections] = await Promise.all([listPlaces(), listCollections()]);
    return { places, collections };
  }

  async function listPlaces() {
    if (mode === 'server') return (await request('/api/places', { useBearer: true })).items.map(normalizePlace);
    return readLocal(PLACE_KEY, []).map(normalizePlace);
  }

  async function createPlace(place) {
    if (mode === 'server') {
      const created = normalizePlace((await request('/api/places', { method: 'POST', body: JSON.stringify(toServerPlace(place)), useBearer: true })).item);
      if (place.image) {
        try {
          const photos = readLocal(PHOTO_KEY, {});
          photos[created.id] = place.image;
          writeLocal(PHOTO_KEY, photos);
          created.image = place.image;
        } catch (error) {
          console.error('사진의 브라우저 저장 실패', error);
          created.photoSaveFailed = true;
        }
      }
      return created;
    }
    const created = normalizePlace({ ...place, id: place.id || `p${Date.now()}` });
    const places = readLocal(PLACE_KEY, []);
    places.unshift(created);
    writeLocal(PLACE_KEY, places);
    return created;
  }

  async function deletePlace(id) {
    if (mode === 'server') await request(`/api/places/${encodeURIComponent(id)}`, { method: 'DELETE', useBearer: true });
    else writeLocal(PLACE_KEY, readLocal(PLACE_KEY, []).filter(place => String(place.id) !== String(id)));
    const photos = readLocal(PHOTO_KEY, {});
    delete photos[id];
    writeLocal(PHOTO_KEY, photos);
  }

  async function listCollections() {
    if (mode === 'server') return (await request('/api/collections', { useBearer: true })).items.map(normalizeCollection);
    return readLocal(COLLECTION_KEY, []).map(normalizeCollection);
  }

  async function createCollection(collection) {
    const payload = { name: collection.name, privacy: collection.privacy };
    if (mode === 'server') return normalizeCollection((await request('/api/collections', { method: 'POST', body: JSON.stringify(payload), useBearer: true })).item);
    const created = normalizeCollection({ ...payload, id: collection.id || `c${Date.now()}` });
    const collections = readLocal(COLLECTION_KEY, []);
    collections.push(created);
    writeLocal(COLLECTION_KEY, collections);
    return created;
  }

  function statusText() {
    if (fallback) return '서버 연결 실패 — 브라우저 저장으로 전환됨';
    return mode === 'server' ? '서버에 저장 중' : '이 브라우저에 저장 중';
  }

  window.YYJDataStore = { initialize, register, login, linkSupabaseAccount, logout, getCurrentUser, loadServerData, listPlaces, createPlace, deletePlace, listCollections, createCollection, checkServer, statusText, AuthenticationError, getMode: () => mode, isFallback: () => fallback };
})();
