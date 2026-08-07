(() => {
  state.addStep = 1;
  state.pendingCategory = '카페';
  state.pendingPrivacy = 'private';

  const addNav = document.querySelector('[data-tab="add"]');
  if (addNav) {
    const originalAddNavClick = addNav.onclick;
    addNav.onclick = event => {
      state.addStep = 1;
      originalAddNavClick?.call(addNav, event);
    };
  }

  function addFlowHeader(title, subtitle, backId) {
    return `<div class="add-flow-header"><button class="add-back-button" id="${backId}" type="button" aria-label="뒤로">‹</button><div><h2>${esc(title)}</h2><p>${esc(subtitle)}</p></div></div>`;
  }

  function showAddStep(step) {
    state.addStep = step;
    renderAdd();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function renderPhotoStep() {
    view.innerHTML = `<section class="add-view add-step add-step-photo">${addFlowHeader('장소 저장', '1 / 3 · 사진을 선택하세요', 'addBackButton')}<div class="add-photo-content"><div class="upload-card" id="uploadCard"><input id="photoInput" type="file" accept="image/*" hidden><div id="photoPreview" class="photo-preview"><b>＋</b><strong>사진 촬영 또는 앨범에서 선택</strong><small>장소를 기억할 사진을 최대 10장까지</small></div></div><div class="photo-action-row"><button class="primary" id="cameraButton" type="button">카메라 열기</button><button class="secondary" id="photoButton" type="button">앨범에서 선택</button></div><div class="recent-photos" aria-label="최근 사진 미리보기"><h3>최근 사진</h3><div class="recent-photo-grid" aria-hidden="true"><div class="recent-photo recent-photo-a">사진</div><div class="recent-photo recent-photo-b">사진</div><div class="recent-photo recent-photo-c">사진</div><div class="recent-photo recent-photo-a">사진</div><div class="recent-photo recent-photo-b">사진</div><div class="recent-photo recent-photo-c">사진</div></div></div><button class="primary add-next-button" id="photoNextButton" type="button" ${state.pendingImage ? '' : 'disabled'}>다음</button></div></section>`;

    $('#addBackButton').onclick = () => document.querySelector('[data-tab="map"]').click();
    const photo = $('#photoInput');
    const openPicker = capture => {
      if (capture) photo.setAttribute('capture', 'environment');
      else photo.removeAttribute('capture');
      photo.click();
    };
    $('#cameraButton').onclick = () => openPicker(true);
    $('#photoButton').onclick = () => openPicker(false);
    if (state.pendingImage) {
      const preview = $('#photoPreview');
      preview.style.backgroundImage = `url('${state.pendingImage}')`;
      preview.innerHTML = '';
    }
    photo.onchange = async event => {
      const file = event.target.files[0];
      if (!file) return;
      try {
        state.pendingImage = await compressImage(file);
        const preview = $('#photoPreview');
        preview.style.backgroundImage = `url('${state.pendingImage}')`;
        preview.innerHTML = '';
        $('#photoNextButton').disabled = false;
        toast('사진을 최적화해 불러왔습니다.');
      } catch (_) {
        toast('사진을 불러오지 못했습니다.');
      }
    };
    $('#photoNextButton').onclick = () => showAddStep(2);
  }

  function setLocationCard(lat, lng) {
    const title = $('#selectedLocationTitle');
    const detail = $('#selectedLocationDetail');
    const continueButton = $('#locationContinueButton');
    if (!title || !detail || !continueButton) return;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      title.textContent = '지도에서 위치를 선택하세요';
      detail.textContent = '원하는 지점을 누르면 위치가 저장됩니다.';
      continueButton.disabled = true;
      return;
    }
    title.textContent = '선택 위치';
    detail.textContent = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    continueButton.disabled = false;
  }

  function renderLocationStep() {
    view.innerHTML = `<section class="add-view add-step add-step-location">${addFlowHeader('위치 확인', '2 / 3 · 촬영 장소를 확인하세요', 'addBackButton')}<div class="add-location-map" id="locationPickerMap" aria-label="장소 위치 선택 지도"></div><div class="selected-location-card"><small>현재 선택된 장소</small><h3 id="selectedLocationTitle"></h3><p id="selectedLocationDetail"></p><button class="location-search-button" id="locationSearchButton" type="button">⌕ 다른 장소 검색</button></div><button class="primary add-location-continue" id="locationContinueButton" type="button">이 위치로 계속</button></section>`;

    $('#addBackButton').onclick = () => showAddStep(1);
    const initialLat = Number.isFinite(state.pendingLat) ? state.pendingLat : 37.5665;
    const initialLng = Number.isFinite(state.pendingLng) ? state.pendingLng : 126.9780;
    let marker = null;
    const applyLocation = (lat, lng, pan = false) => {
      state.pendingLat = Number(lat);
      state.pendingLng = Number(lng);
      if (marker) marker.setLatLng([state.pendingLat, state.pendingLng]);
      else marker = L.circleMarker([state.pendingLat, state.pendingLng], { radius: 10, color: '#ffffff', weight: 3, fillColor: '#1f6a5b', fillOpacity: 1 }).addTo(state.pickerMap);
      if (pan) state.pickerMap.setView([state.pendingLat, state.pendingLng], 16);
      setLocationCard(state.pendingLat, state.pendingLng);
    };

    if (typeof L !== 'undefined') {
      state.pickerMap = L.map('locationPickerMap', { zoomControl: false }).setView([initialLat, initialLng], Number.isFinite(state.pendingLat) ? 16 : 11);
      addTileLayer(state.pickerMap);
      if (Number.isFinite(state.pendingLat) && Number.isFinite(state.pendingLng)) applyLocation(state.pendingLat, state.pendingLng, false);
      else setLocationCard(NaN, NaN);
      state.pickerMap.on('click', event => applyLocation(event.latlng.lat, event.latlng.lng, false));
    } else {
      $('#locationPickerMap').innerHTML = '<div class="map-error">지도를 불러오지 못했습니다.</div>';
      setLocationCard(NaN, NaN);
    }

    $('#locationSearchButton').onclick = () => {
      if (!navigator.geolocation) {
        toast('지도를 눌러 원하는 위치를 선택해 주세요.');
        return;
      }
      navigator.geolocation.getCurrentPosition(position => {
        applyLocation(position.coords.latitude, position.coords.longitude, true);
        toast('현재 위치를 선택했습니다.');
      }, () => toast('지도를 눌러 원하는 위치를 선택해 주세요.'), { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 });
    };
    $('#locationContinueButton').onclick = () => showAddStep(3);
  }

  function categoryButtons() {
    return ['카페', '맛집', '숙소', '쇼핑'].map(category => `<button class="chip category-choice ${state.pendingCategory === category ? 'active' : ''}" type="button" data-category="${esc(category)}">${esc(category)}</button>`).join('');
  }

  function renderInfoStep() {
    const collections = state.collections.map(collection => `<option value="${esc(collection.id)}">${esc(collection.name)}</option>`).join('');
    const privateMode = state.pendingPrivacy !== 'link';
    view.innerHTML = `<section class="add-view add-step add-step-info">${addFlowHeader('장소 정보', '3 / 3 · 기억을 남겨보세요', 'addBackButton')}<form id="placeForm" class="add-info-form"><label class="field"><span>장소 이름</span><input id="placeName" required maxlength="100" placeholder="예: 강릉 안목해변 카페"></label><label class="field"><span>한 줄 메모</span><textarea id="memo" rows="4" maxlength="500" placeholder="무엇이 좋았는지 기록하세요"></textarea></label><div class="field category-field"><span>카테고리</span><div class="chips category-choices">${categoryButtons()}</div></div><label class="field"><span>컬렉션</span><select id="collectionSelect">${collections}</select></label><div class="field privacy-field"><span>공개 범위</span><button class="privacy-choice" id="privacyChoice" type="button"><strong>${privateMode ? '🔒  나만 보기' : '🔗  링크 공유'}</strong><small>${privateMode ? '기본값' : '공유 가능'}</small></button></div><button class="primary add-save-button" type="submit">장소 저장하기</button></form></section>`;

    $('#addBackButton').onclick = () => showAddStep(2);
    document.querySelectorAll('[data-category]').forEach(button => {
      button.onclick = () => {
        state.pendingCategory = button.dataset.category;
        document.querySelectorAll('[data-category]').forEach(item => item.classList.toggle('active', item.dataset.category === state.pendingCategory));
      };
    });
    $('#privacyChoice').onclick = () => {
      state.pendingPrivacy = state.pendingPrivacy === 'link' ? 'private' : 'link';
      const privateNow = state.pendingPrivacy !== 'link';
      $('#privacyChoice').innerHTML = `<strong>${privateNow ? '🔒  나만 보기' : '🔗  링크 공유'}</strong><small>${privateNow ? '기본값' : '공유 가능'}</small>`;
    };

    $('#placeForm').onsubmit = async event => {
      event.preventDefault();
      if (state.savingPlace) return;
      const name = $('#placeName').value.trim();
      if (!name) {
        toast('장소 이름을 입력해 주세요.');
        return;
      }
      if (!Number.isFinite(state.pendingLat) || !Number.isFinite(state.pendingLng)) {
        toast('장소 위치를 선택해 주세요.');
        showAddStep(2);
        return;
      }
      const place = {
        name,
        category: state.pendingCategory || '카페',
        memo: $('#memo').value.trim(),
        tags: [],
        date: new Date().toISOString().slice(0, 10),
        lat: state.pendingLat,
        lng: state.pendingLng,
        collection: $('#collectionSelect').value,
        privacy: state.pendingPrivacy === 'link' ? 'link' : 'private',
        image: state.pendingImage
      };
      const submit = event.currentTarget.querySelector('[type="submit"]');
      state.savingPlace = true;
      submit.disabled = true;
      submit.textContent = '저장 중…';
      try {
        const created = await YYJDataStore.createPlace(place);
        state.places.unshift(created);
        state.selectedId = created.id;
        state.pendingImage = '';
        state.pendingLat = null;
        state.pendingLng = null;
        state.pendingCategory = '카페';
        state.pendingPrivacy = 'private';
        state.addStep = 1;
        state.search = '';
        state.tab = 'map';
        syncNav();
        render();
        toast(created.photoSaveFailed ? '장소는 저장했지만 사진은 기기에 저장하지 못했습니다.' : '장소를 저장했습니다.');
      } catch (error) {
        if (handleAuthenticationError(error)) return;
        console.error('장소 저장 실패', error);
        toast(error.message || '장소를 저장하지 못했습니다.');
        submit.disabled = false;
        submit.textContent = '장소 저장하기';
      } finally {
        state.savingPlace = false;
      }
    };
  }

  renderAdd = function renderAddFlow() {
    disposeMaps();
    setHeader('장소 저장', '사진과 위치로 기억 남기기');
    if (!state.pendingImage && state.addStep > 1) state.addStep = 1;
    if (state.addStep === 2) renderLocationStep();
    else if (state.addStep === 3) renderInfoStep();
    else renderPhotoStep();
  };
})();
