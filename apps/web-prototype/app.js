const seedPlaces = [
  { id: 'p1', name: '강릉 바다 창가 카페', category: '카페', memo: '창가 자리에서 바다가 잘 보였고 평일 오전에는 사람이 적었음', tags: ['바다전망', '다시갈곳'], date: '2026-05-18', lat: 37.772, lng: 128.947, collection: 'c1', privacy: 'private', image: '' },
  { id: 'p2', name: '성수동 소품숍', category: '쇼핑', memo: '선물하기 좋았던 가죽가방을 발견함', tags: ['쇼핑', '선물'], date: '2026-07-24', lat: 37.544, lng: 127.056, collection: 'c3', privacy: 'private', image: '' },
  { id: 'p3', name: '제주 조용한 해변', category: '볼거리', memo: '사람이 적고 노을이 예뻤음', tags: ['바다', '노을'], date: '2026-07-11', lat: 33.45, lng: 126.31, collection: 'c1', privacy: 'link', image: '' },
  { id: 'p4', name: '전주 한옥 베이커리', category: '카페', memo: '마당과 빵이 모두 좋았음', tags: ['카페', '한옥'], date: '2026-07-02', lat: 35.815, lng: 127.153, collection: 'c2', privacy: 'private', image: '' }
];

const seedCollections = [
  { id: 'c1', name: '제주·강릉 다시 갈 곳', privacy: 'link' },
  { id: 'c2', name: '가족과 갈 식당', privacy: 'private' },
  { id: 'c3', name: '사고 싶은 물건 판매처', privacy: 'private' },
  { id: 'c4', name: '캠핑하기 좋은 장소', privacy: 'link' }
];

const state = {
  tab: 'map',
  places: JSON.parse(localStorage.getItem('yyj_places') || 'null') || seedPlaces,
  collections: JSON.parse(localStorage.getItem('yyj_collections') || 'null') || seedCollections,
  selectedId: 'p1',
  filter: '전체',
  search: '',
  pendingImage: '',
  pendingLat: null,
  pendingLng: null,
  map: null,
  pickerMap: null
};

const $ = selector => document.querySelector(selector);
const view = $('#view');
const DEFAULT_CENTER = [36.35, 127.85];

function save() {
  localStorage.setItem('yyj_places', JSON.stringify(state.places));
  localStorage.setItem('yyj_collections', JSON.stringify(state.collections));
}

function toast(message) {
  const old = document.querySelector('.toast');
  old?.remove();
  const element = document.createElement('div');
  element.className = 'toast';
  element.textContent = message;
  document.body.appendChild(element);
  setTimeout(() => element.remove(), 2500);
}

function esc(value = '') {
  return String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}

function setHeader(title, eyebrow) {
  $('#headerTitle').textContent = title;
  $('#headerEyebrow').textContent = eyebrow;
}

function formatDate(date) {
  return new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(date));
}

function hasCoordinates(place) {
  return Number.isFinite(Number(place?.lat)) && Number.isFinite(Number(place?.lng));
}

function photoStyle(place) {
  return place.image ? `style="background-image:url('${place.image}')"` : '';
}

function thumb(place) {
  return `<div class="thumb" ${photoStyle(place)}></div>`;
}

function disposeMaps() {
  if (state.map) {
    state.map.remove();
    state.map = null;
  }
  if (state.pickerMap) {
    state.pickerMap.remove();
    state.pickerMap = null;
  }
}

function addTileLayer(map) {
  return L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  }).addTo(map);
}

function markerStyle(active = false) {
  return {
    radius: active ? 10 : 8,
    color: '#ffffff',
    weight: 3,
    fillColor: active ? '#ff8a5b' : '#1f6a5b',
    fillOpacity: 1
  };
}

function selectedCard(place) {
  if (!place) return '<div class="empty">저장된 장소가 없습니다.</div>';
  return `<article class="place-card" data-detail="${esc(place.id)}">${thumb(place)}<div><h3>${esc(place.name)}</h3><p>${esc(place.category)} · ${formatDate(place.date)}</p><p>${esc(place.memo)}</p><p class="tags">${place.tags.map(tag => `#${esc(tag)}`).join(' ')}</p></div></article>`;
}

function updateSelectedCard(place) {
  const container = $('#mapSelectedCard');
  if (!container) return;
  container.innerHTML = selectedCard(place);
  container.querySelector('[data-detail]')?.addEventListener('click', event => openDetail(event.currentTarget.dataset.detail));
}

function openDetail(id) {
  const place = state.places.find(item => item.id === id);
  if (!place) return;
  const collection = state.collections.find(item => item.id === place.collection);
  const mapUrl = hasCoordinates(place) ? `https://www.google.com/maps?q=${place.lat},${place.lng}` : '#';
  const dialog = $('#detailDialog');
  dialog.innerHTML = `<div class="detail-hero" ${photoStyle(place)}><button class="icon-button detail-close" onclick="detailDialog.close()">✕</button></div><div class="detail-body"><p class="meta">${esc(place.category)} · ${formatDate(place.date)}</p><h2>${esc(place.name)}</h2><p>${esc(place.memo || '아직 메모가 없습니다.')}</p><p class="tags">${place.tags.map(tag => `#${esc(tag)}`).join(' ')}</p><p class="meta">⌖ ${hasCoordinates(place) ? `${Number(place.lat).toFixed(6)}, ${Number(place.lng).toFixed(6)}` : '위치 없음'}<br>▣ ${esc(collection?.name || '컬렉션 없음')} · ${place.privacy === 'private' ? '나만 보기' : '링크 공유'}</p><div class="detail-actions">${hasCoordinates(place) ? `<a class="secondary button-link" href="${mapUrl}" target="_blank" rel="noopener">지도 열기</a>` : '<button class="secondary" disabled>위치 없음</button>'}<button class="secondary" onclick="sharePlace('${esc(place.id)}')">공유</button><button class="danger" onclick="deletePlace('${esc(place.id)}')">삭제</button></div></div>`;
  dialog.showModal();
}

window.detailDialog = $('#detailDialog');
window.sharePlace = async id => {
  const place = state.places.find(item => item.id === id);
  if (!place) return;
  const position = hasCoordinates(place) ? `https://www.google.com/maps?q=${place.lat},${place.lng}` : '위치 정보 없음';
  const text = `${place.name}\n${place.memo}\n${position}`;
  try {
    if (navigator.share) await navigator.share({ title: place.name, text });
    else await navigator.clipboard.writeText(text);
    toast('공유 내용이 준비되었습니다.');
  } catch (_) {}
};

window.deletePlace = id => {
  if (!confirm('이 장소를 삭제할까요?')) return;
  state.places = state.places.filter(place => place.id !== id);
  state.selectedId = state.places[0]?.id || '';
  save();
  detailDialog.close();
  render();
  toast('장소를 삭제했습니다.');
};

function filteredPlaces() {
  const query = state.search.trim().toLowerCase();
  return state.places.filter(place => {
    const categoryMatches = state.filter === '전체' || place.category === state.filter;
    const searchMatches = !query || [place.name, place.memo, ...place.tags].join(' ').toLowerCase().includes(query);
    return categoryMatches && searchMatches;
  });
}

function showPendingLocation(lat, lng, map, temporaryLayerRef) {
  state.pendingLat = Number(lat);
  state.pendingLng = Number(lng);
  $('#mapLocationPanel').hidden = false;
  $('#mapLocationText').textContent = `${state.pendingLat.toFixed(6)}, ${state.pendingLng.toFixed(6)}`;
  $('#mapStatus').textContent = '위치를 선택했습니다. 저장 버튼을 누르면 장소 입력 화면으로 이동합니다.';
  if (temporaryLayerRef.layer) temporaryLayerRef.layer.remove();
  temporaryLayerRef.layer = L.circleMarker([state.pendingLat, state.pendingLng], {
    radius: 10,
    color: '#ffffff',
    weight: 3,
    fillColor: '#ff8a5b',
    fillOpacity: 1
  }).addTo(map).bindTooltip('새 장소 위치', { permanent: false });
}

function renderMap() {
  disposeMaps();
  setHeader('내 지도', `기억해 둔 장소 ${state.places.length}곳`);
  view.innerHTML = $('#mapViewTemplate').innerHTML;

  const categories = ['전체', ...new Set(state.places.map(place => place.category))];
  $('#mapChips').innerHTML = categories.map(category => `<button class="chip ${state.filter === category ? 'active' : ''}" data-filter="${esc(category)}">${esc(category)}</button>`).join('');
  document.querySelectorAll('[data-filter]').forEach(button => {
    button.onclick = () => {
      state.filter = button.dataset.filter;
      renderMap();
    };
  });

  if (typeof L === 'undefined') {
    $('#realMap').innerHTML = '<div class="map-error">지도를 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.</div>';
    return;
  }

  const visible = filteredPlaces();
  const selected = state.places.find(place => place.id === state.selectedId) || visible[0] || state.places[0];
  if (selected) state.selectedId = selected.id;
  const initialCenter = hasCoordinates(selected) ? [Number(selected.lat), Number(selected.lng)] : DEFAULT_CENTER;

  state.map = L.map('realMap', { zoomControl: true }).setView(initialCenter, hasCoordinates(selected) ? 12 : 7);
  addTileLayer(state.map);
  const markerRefs = new Map();
  const bounds = [];

  visible.filter(hasCoordinates).forEach(place => {
    const coordinates = [Number(place.lat), Number(place.lng)];
    bounds.push(coordinates);
    const marker = L.circleMarker(coordinates, markerStyle(place.id === state.selectedId)).addTo(state.map);
    marker.bindTooltip(esc(place.name));
    marker.on('click', () => {
      state.selectedId = place.id;
      markerRefs.forEach((layer, markerId) => layer.setStyle(markerStyle(markerId === place.id)));
      updateSelectedCard(place);
    });
    markerRefs.set(place.id, marker);
  });

  if (!selected && bounds.length > 1) state.map.fitBounds(bounds, { padding: [24, 24], maxZoom: 13 });
  updateSelectedCard(selected);

  const temporaryLayerRef = { layer: null };
  state.map.on('click', event => showPendingLocation(event.latlng.lat, event.latlng.lng, state.map, temporaryLayerRef));

  $('#saveMapLocationButton').onclick = () => {
    state.tab = 'add';
    syncNav();
    render();
  };

  $('#locateMapButton').onclick = () => {
    if (!navigator.geolocation) {
      toast('이 기기에서는 위치를 사용할 수 없습니다.');
      return;
    }
    $('#mapStatus').textContent = '현재 위치를 확인하는 중입니다…';
    navigator.geolocation.getCurrentPosition(position => {
      const { latitude, longitude } = position.coords;
      state.map.setView([latitude, longitude], 16);
      showPendingLocation(latitude, longitude, state.map, temporaryLayerRef);
      toast('현재 위치를 지도에 표시했습니다.');
    }, () => {
      $('#mapStatus').textContent = '위치 권한을 허용하면 현재 위치를 표시할 수 있습니다.';
      toast('위치 권한을 허용해 주세요.');
    }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 });
  };

  $('#mapSearch').value = state.search;
  $('#mapSearch').oninput = event => {
    state.search = event.target.value;
    const matches = filteredPlaces();
    const hit = matches[0];
    if (!hit) {
      updateSelectedCard(null);
      return;
    }
    state.selectedId = hit.id;
    markerRefs.forEach((layer, markerId) => layer.setStyle(markerStyle(markerId === hit.id)));
    if (hasCoordinates(hit)) state.map.setView([Number(hit.lat), Number(hit.lng)], Math.max(state.map.getZoom(), 13));
    updateSelectedCard(hit);
  };
}

function renderMemories() {
  disposeMaps();
  setHeader('기억', '사진과 날짜로 다시 찾기');
  view.innerHTML = $('#memoriesViewTemplate').innerHTML;
  const list = [...state.places].sort((a, b) => b.date.localeCompare(a.date));
  $('#memoryList').innerHTML = list.length
    ? `<h2 class="month-label">${new Date(list[0].date).getFullYear()}년 기억</h2>` + list.map(place => `<article class="memory-card" data-detail="${esc(place.id)}">${thumb(place)}<div><h3>${esc(place.name)}</h3><p>${formatDate(place.date)} · ${esc(place.category)}</p><p>${esc(place.memo)}</p><p class="tags">${place.tags.map(tag => `#${esc(tag)}`).join(' ')}</p></div></article>`).join('')
    : '<div class="empty">첫 장소를 저장해 보세요.</div>';
  document.querySelectorAll('[data-detail]').forEach(element => element.onclick = () => openDetail(element.dataset.detail));
}

function compressImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const image = new Image();
      image.onerror = reject;
      image.onload = () => {
        const maxSize = 1200;
        const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(image.width * scale);
        canvas.height = Math.round(image.height * scale);
        canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function updatePickerPosition(lat, lng, markerRef, pan = true) {
  const latitude = Number(lat);
  const longitude = Number(lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
  state.pendingLat = latitude;
  state.pendingLng = longitude;
  $('#latitude').value = latitude.toFixed(6);
  $('#longitude').value = longitude.toFixed(6);
  if (markerRef.marker) markerRef.marker.setLatLng([latitude, longitude]);
  else markerRef.marker = L.circleMarker([latitude, longitude], markerStyle(true)).addTo(state.pickerMap);
  if (pan) state.pickerMap.setView([latitude, longitude], 16);
}

function renderAdd() {
  disposeMaps();
  setHeader('장소 저장', '사진과 위치로 기억 남기기');
  view.innerHTML = $('#addViewTemplate').innerHTML;
  $('#collectionSelect').innerHTML = state.collections.map(collection => `<option value="${esc(collection.id)}">${esc(collection.name)}</option>`).join('');

  const photo = $('#photoInput');
  $('#photoButton').onclick = () => photo.click();
  photo.onchange = async event => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      state.pendingImage = await compressImage(file);
      const preview = $('#photoPreview');
      preview.style.backgroundImage = `url('${state.pendingImage}')`;
      preview.innerHTML = '';
      toast('사진을 최적화해 불러왔습니다.');
    } catch (_) {
      toast('사진을 불러오지 못했습니다.');
    }
  };

  const initialLat = Number.isFinite(state.pendingLat) ? state.pendingLat : 37.5665;
  const initialLng = Number.isFinite(state.pendingLng) ? state.pendingLng : 126.9780;
  $('#latitude').value = Number.isFinite(state.pendingLat) ? state.pendingLat.toFixed(6) : '';
  $('#longitude').value = Number.isFinite(state.pendingLng) ? state.pendingLng.toFixed(6) : '';

  const markerRef = { marker: null };
  if (typeof L !== 'undefined') {
    state.pickerMap = L.map('locationPickerMap', { zoomControl: true }).setView([initialLat, initialLng], Number.isFinite(state.pendingLat) ? 16 : 11);
    addTileLayer(state.pickerMap);
    if (Number.isFinite(state.pendingLat)) updatePickerPosition(initialLat, initialLng, markerRef, false);
    state.pickerMap.on('click', event => updatePickerPosition(event.latlng.lat, event.latlng.lng, markerRef, false));
  } else {
    $('#locationPickerMap').innerHTML = '<div class="map-error">지도를 불러오지 못했습니다.</div>';
  }

  $('#locationButton').onclick = () => {
    if (!navigator.geolocation) {
      toast('이 기기에서는 위치를 사용할 수 없습니다.');
      return;
    }
    navigator.geolocation.getCurrentPosition(position => {
      updatePickerPosition(position.coords.latitude, position.coords.longitude, markerRef, true);
      toast('현재 위치를 불러왔습니다.');
    }, () => toast('위치 권한을 허용해 주세요.'), { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 });
  };

  $('#latitude').onchange = () => updatePickerPosition($('#latitude').value, $('#longitude').value, markerRef, true);
  $('#longitude').onchange = () => updatePickerPosition($('#latitude').value, $('#longitude').value, markerRef, true);

  $('#placeForm').onsubmit = event => {
    event.preventDefault();
    const name = $('#placeName').value.trim();
    if (!name) {
      toast('장소 이름을 입력해 주세요.');
      return;
    }
    const latitude = Number($('#latitude').value);
    const longitude = Number($('#longitude').value);
    const place = {
      id: `p${Date.now()}`,
      name,
      category: $('#category').value,
      memo: $('#memo').value.trim(),
      tags: $('#tags').value.split(',').map(value => value.trim()).filter(Boolean).slice(0, 10),
      date: new Date().toISOString().slice(0, 10),
      lat: Number.isFinite(latitude) ? latitude : null,
      lng: Number.isFinite(longitude) ? longitude : null,
      collection: $('#collectionSelect').value,
      privacy: document.querySelector('[name=privacy]:checked').value,
      image: state.pendingImage
    };
    state.places.unshift(place);
    state.selectedId = place.id;
    state.pendingImage = '';
    state.pendingLat = null;
    state.pendingLng = null;
    state.search = '';
    save();
    state.tab = 'map';
    syncNav();
    render();
    toast('장소를 저장했습니다.');
  };
}

function renderCollections() {
  disposeMaps();
  setHeader('컬렉션', '장소를 주제별로 정리');
  view.innerHTML = $('#collectionsViewTemplate').innerHTML;
  $('#collectionList').innerHTML = state.collections.map(collection => {
    const places = state.places.filter(place => place.collection === collection.id);
    const cover = places[0] || {};
    return `<article class="collection-card" data-col="${esc(collection.id)}"><div class="thumb" ${cover.image ? `style="background-image:url('${cover.image}')"` : ''}></div><div><h3>${esc(collection.name)}</h3><p>${places.length}곳 · ${collection.privacy === 'private' ? '나만 보기' : '링크 공유'}</p><p class="tags">최근 저장 ${places[0] ? formatDate(places[0].date) : '없음'}</p></div></article>`;
  }).join('');

  document.querySelectorAll('[data-col]').forEach(element => {
    element.onclick = () => {
      const collection = state.collections.find(item => item.id === element.dataset.col);
      const places = state.places.filter(place => place.collection === collection.id);
      view.innerHTML = `<button class="secondary" id="backCols">‹ 컬렉션</button><h2>${esc(collection.name)}</h2><p>${places.length}곳 · ${collection.privacy === 'private' ? '나만 보기' : '링크 공유'}</p><div class="memory-list">${places.map(place => `<article class="memory-card" data-detail="${esc(place.id)}">${thumb(place)}<div><h3>${esc(place.name)}</h3><p>${esc(place.memo)}</p><p class="tags">${place.tags.map(tag => `#${esc(tag)}`).join(' ')}</p></div></article>`).join('') || '<div class="empty">아직 장소가 없습니다.</div>'}</div>`;
      $('#backCols').onclick = renderCollections;
      document.querySelectorAll('[data-detail]').forEach(item => item.onclick = () => openDetail(item.dataset.detail));
    };
  });

  $('#newCollectionButton').onclick = () => {
    const name = prompt('새 컬렉션 이름을 입력하세요.');
    if (!name?.trim()) return;
    state.collections.push({ id: `c${Date.now()}`, name: name.trim().slice(0, 60), privacy: 'private' });
    save();
    renderCollections();
    toast('컬렉션을 만들었습니다.');
  };
}

function render() {
  ({ map: renderMap, memories: renderMemories, add: renderAdd, collections: renderCollections }[state.tab] || renderMap)();
}

function syncNav() {
  document.querySelectorAll('.nav-item').forEach(button => button.classList.toggle('active', button.dataset.tab === state.tab));
}

document.querySelectorAll('.nav-item').forEach(button => {
  button.onclick = () => {
    state.tab = button.dataset.tab;
    syncNav();
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
});

$('#profileButton').onclick = () => {
  const dialog = $('#settingsDialog');
  dialog.innerHTML = '<h2>여기였지</h2><p>실제 지도 기능이 적용된 공개 테스트 버전입니다.</p><p class="meta">지도 데이터: © OpenStreetMap contributors</p><div class="settings-list"><button id="exportButton">데이터 백업 파일 만들기</button><button id="resetButton">샘플 데이터로 초기화</button><button onclick="settingsDialog.close()">닫기</button></div>';
  dialog.showModal();
  $('#exportButton').onclick = () => {
    const blob = new Blob([JSON.stringify({ places: state.places, collections: state.collections }, null, 2)], { type: 'application/json' });
    const anchor = document.createElement('a');
    anchor.href = URL.createObjectURL(blob);
    anchor.download = '여기였지-백업.json';
    anchor.click();
    URL.revokeObjectURL(anchor.href);
  };
  $('#resetButton').onclick = () => {
    localStorage.clear();
    location.reload();
  };
};

window.settingsDialog = $('#settingsDialog');
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./service-worker.js').catch(() => {});
render();
