'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

function seed() {
  return { schemaVersion: 2, users: [], collections: [], places: [] };
}

function normalizeStore(parsed) {
  return {
    ...parsed,
    schemaVersion: 2,
    users: Array.isArray(parsed.users) ? parsed.users : [],
    places: Array.isArray(parsed.places) ? parsed.places : [],
    collections: Array.isArray(parsed.collections) ? parsed.collections : []
  };
}

function createJsonStorage(dataFile) {
  let writeQueue = Promise.resolve();
  let mutationQueue = Promise.resolve();
  const sessions = new Map();
  const clone = value => JSON.parse(JSON.stringify(value));

  async function loadRaw() {
    try {
      return normalizeStore(JSON.parse(await fs.readFile(dataFile, 'utf8')));
    } catch (error) {
      if (error.code !== 'ENOENT' && error.name !== 'SyntaxError') throw error;
      const data = seed();
      await save(data);
      return data;
    }
  }

  async function load() {
    await writeQueue;
    return loadRaw();
  }

  function save(data) {
    writeQueue = writeQueue.then(async () => {
      await fs.mkdir(path.dirname(dataFile), { recursive: true });
      const temporaryFile = `${dataFile}.${process.pid}.tmp`;
      await fs.writeFile(temporaryFile, JSON.stringify(data, null, 2));
      try { await fs.unlink(dataFile); } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      await fs.rename(temporaryFile, dataFile);
    });
    return writeQueue;
  }

  const mutate = operation => {
    const result = mutationQueue.then(async () => {
      const data = await loadRaw();
      const value = await operation(data);
      await save(data);
      return clone(value);
    });
    mutationQueue = result.then(() => undefined, () => undefined);
    return result;
  };

  const methods = {
    initialize: async () => { const data = await load(); await methods.deleteExpiredSessions(new Date().toISOString()); return data; },
    findUserById: async userId => (await load()).users.find(user => user.id === userId) || null,
    findUserByEmail: async email => (await load()).users.find(user => user.email === email) || null,
    createUser: user => mutate(data => {
      if (data.users.some(item => item.email === user.email)) {
        const error = new Error('Email already exists');
        error.code = 'EMAIL_EXISTS';
        throw error;
      }
      data.users.push(user);
      return user;
    }),
    listCollections: async ownerId => (await load()).collections.filter(item => item.ownerId === ownerId),
    findCollectionById: async (ownerId, collectionId) => (await load()).collections.find(item => item.ownerId === ownerId && item.id === collectionId) || null,
    createCollection: collection => mutate(data => { data.collections.push(collection); return collection; }),
    listPlaces: async ownerId => (await load()).places.filter(item => item.ownerId === ownerId),
    findPlaceById: async (ownerId, placeId) => (await load()).places.find(item => item.ownerId === ownerId && item.id === placeId) || null,
    createPlace: place => mutate(data => { data.places.unshift(place); return place; }),
    updatePlace: (ownerId, placeId, nextPlace) => mutate(data => {
      const index = data.places.findIndex(item => item.ownerId === ownerId && item.id === placeId);
      if (index < 0) return null;
      data.places[index] = { ...data.places[index], ...nextPlace, ownerId, id: placeId };
      return data.places[index];
    }),
    deletePlace: (ownerId, placeId) => mutate(data => {
      const index = data.places.findIndex(item => item.ownerId === ownerId && item.id === placeId);
      if (index < 0) return false;
      data.places.splice(index, 1);
      return true;
    }),
    createSession: async session => { sessions.set(session.tokenHash, { ...session }); return { ...session }; },
    findSessionByTokenHash: async tokenHash => { const session = sessions.get(tokenHash); return session ? { ...session } : null; },
    deleteSession: async tokenHash => sessions.delete(tokenHash),
    deleteExpiredSessions: async now => { let count = 0; for (const [hash, session] of sessions) if (new Date(session.expiresAt) <= new Date(now)) { sessions.delete(hash); count += 1; } return count; }
  };

  return { load, save, ...methods };
}

module.exports = { createJsonStorage, seed, normalizeStore };
