import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import MapView, { Marker } from 'react-native-maps';

type Tab = 'map' | 'memories' | 'add' | 'collections';
type Privacy = 'private' | 'link';
type Place = {
  id: string;
  name: string;
  category: string;
  memo: string;
  tags: string[];
  date: string;
  latitude: number;
  longitude: number;
  collectionId: string;
  privacy: Privacy;
  imageUri?: string;
};
type Collection = { id: string; name: string; privacy: Privacy };

const COLORS = {
  bg: '#F6F8F7', surface: '#FFFFFF', primary: '#1F6A5B', primaryDark: '#174D43',
  soft: '#E7F2EE', text: '#1D2B27', muted: '#6F7F79', line: '#DDE6E2', accent: '#FF8A5B',
};
const CATEGORIES = ['카페', '맛집', '숙소', '볼거리', '쇼핑', '기타'];
const STORAGE_KEY = 'yeogiyeotji:v1';

const initialCollections: Collection[] = [
  { id: 'c1', name: '제주·강릉 다시 갈 곳', privacy: 'link' },
  { id: 'c2', name: '가족과 갈 식당', privacy: 'private' },
  { id: 'c3', name: '사고 싶은 물건 판매처', privacy: 'private' },
  { id: 'c4', name: '캠핑하기 좋은 장소', privacy: 'link' },
];
const initialPlaces: Place[] = [
  { id: 'p1', name: '강릉 바다 창가 카페', category: '카페', memo: '창가 자리에서 바다가 잘 보였고 평일 오전에는 사람이 적었음', tags: ['바다전망', '다시갈곳'], date: '2026-05-18', latitude: 37.772, longitude: 128.947, collectionId: 'c1', privacy: 'private' },
  { id: 'p2', name: '성수동 소품숍', category: '쇼핑', memo: '선물하기 좋았던 가죽가방을 발견함', tags: ['쇼핑', '선물'], date: '2026-07-24', latitude: 37.544, longitude: 127.056, collectionId: 'c3', privacy: 'private' },
  { id: 'p3', name: '제주 조용한 해변', category: '볼거리', memo: '사람이 적고 노을이 예뻤음', tags: ['바다', '노을'], date: '2026-07-11', latitude: 33.45, longitude: 126.31, collectionId: 'c1', privacy: 'link' },
  { id: 'p4', name: '전주 한옥 베이커리', category: '카페', memo: '마당과 빵이 모두 좋았음', tags: ['카페', '한옥'], date: '2026-07-02', latitude: 35.815, longitude: 127.153, collectionId: 'c2', privacy: 'private' },
];

export default function App() {
  const [tab, setTab] = useState<Tab>('map');
  const [places, setPlaces] = useState<Place[]>(initialPlaces);
  const [collections, setCollections] = useState<Collection[]>(initialCollections);
  const [selected, setSelected] = useState<Place | null>(initialPlaces[0]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then(raw => {
      if (raw) {
        const parsed = JSON.parse(raw) as { places: Place[]; collections: Collection[] };
        setPlaces(parsed.places);
        setCollections(parsed.collections);
        setSelected(parsed.places[0] ?? null);
      }
    }).catch(() => {}).finally(() => setLoaded(true));
  }, []);
  useEffect(() => {
    if (loaded) AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ places, collections })).catch(() => {});
  }, [places, collections, loaded]);

  const addPlace = (place: Place) => {
    setPlaces(current => [place, ...current]);
    setSelected(place);
    setTab('map');
  };
  const deletePlace = (id: string) => {
    setPlaces(current => current.filter(place => place.id !== id));
    setSelected(null);
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.shell}>
        <Header tab={tab} placeCount={places.length} />
        <View style={styles.content}>
          {tab === 'map' && <MapScreen places={places} selected={selected} setSelected={setSelected} />}
          {tab === 'memories' && <MemoriesScreen places={places} setSelected={setSelected} />}
          {tab === 'add' && <AddScreen collections={collections} onSave={addPlace} />}
          {tab === 'collections' && <CollectionsScreen places={places} collections={collections} setCollections={setCollections} setSelected={setSelected} />}
        </View>
        <BottomNav tab={tab} setTab={setTab} />
        <PlaceDetail place={selected} visible={Boolean(selected && tab !== 'add')} onClose={() => setSelected(null)} onDelete={deletePlace} />
      </View>
    </SafeAreaView>
  );
}

function Header({ tab, placeCount }: { tab: Tab; placeCount: number }) {
  const copy = {
    map: ['내 지도', `기억해 둔 장소 ${placeCount}곳`],
    memories: ['기억', '사진과 날짜로 다시 찾기'],
    add: ['장소 저장', '사진과 위치로 기억 남기기'],
    collections: ['컬렉션', '장소를 주제별로 정리'],
  } as const;
  return <View style={styles.header}><View><Text style={styles.eyebrow}>{copy[tab][1]}</Text><Text style={styles.title}>{copy[tab][0]}</Text></View><Pressable style={styles.iconButton}><Text>⚙</Text></Pressable></View>;
}

function BottomNav({ tab, setTab }: { tab: Tab; setTab: (tab: Tab) => void }) {
  const items: Array<[Tab, string, string]> = [['map', '⌖', '지도'], ['memories', '▧', '기억'], ['add', '＋', '저장'], ['collections', '▣', '컬렉션']];
  return <View style={styles.nav}>{items.map(([key, icon, label]) => <Pressable key={key} onPress={() => setTab(key)} style={styles.navItem}><View style={key === 'add' ? styles.addCircle : undefined}><Text style={[styles.navIcon, tab === key && styles.navActive, key === 'add' && styles.addIcon]}>{icon}</Text></View><Text style={[styles.navLabel, tab === key && styles.navActive]}>{label}</Text></Pressable>)}</View>;
}

function MapScreen({ places, selected, setSelected }: { places: Place[]; selected: Place | null; setSelected: (place: Place) => void }) {
  const [category, setCategory] = useState('전체');
  const [query, setQuery] = useState('');
  const visible = useMemo(() => places.filter(place => (category === '전체' || place.category === category) && [place.name, place.memo, ...place.tags].join(' ').toLowerCase().includes(query.toLowerCase())), [places, category, query]);
  const initial = selected ?? visible[0] ?? places[0];
  return <View style={styles.flex}>
    <TextInput value={query} onChangeText={setQuery} placeholder="⌕  장소, 지역, 태그 검색" style={styles.search} />
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>{['전체', ...new Set(places.map(p => p.category))].map(item => <Chip key={item} label={item} active={category === item} onPress={() => setCategory(item)} />)}</ScrollView>
    <MapView style={styles.map} initialRegion={{ latitude: initial?.latitude ?? 37.5665, longitude: initial?.longitude ?? 126.978, latitudeDelta: 5, longitudeDelta: 5 }}>
      {visible.map(place => <Marker key={place.id} coordinate={{ latitude: place.latitude, longitude: place.longitude }} pinColor={selected?.id === place.id ? COLORS.accent : COLORS.primary} onPress={() => setSelected(place)} />)}
    </MapView>
    {selected && <PlaceCard place={selected} onPress={() => setSelected(selected)} />}
  </View>;
}

function MemoriesScreen({ places, setSelected }: { places: Place[]; setSelected: (place: Place) => void }) {
  const sorted = [...places].sort((a, b) => b.date.localeCompare(a.date));
  return <FlatList data={sorted} keyExtractor={item => item.id} contentContainerStyle={styles.listContent} ListHeaderComponent={<ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}><Chip label="최신순" active /><Chip label="지역" /><Chip label="태그" /><Chip label="날짜" /></ScrollView>} renderItem={({ item }) => <MemoryCard place={item} onPress={() => setSelected(item)} />} />;
}

function AddScreen({ collections, onSave }: { collections: Collection[]; onSave: (place: Place) => void }) {
  const [imageUri, setImageUri] = useState<string>();
  const [name, setName] = useState(''); const [memo, setMemo] = useState(''); const [tags, setTags] = useState('');
  const [category, setCategory] = useState(CATEGORIES[0]); const [collectionId, setCollectionId] = useState(collections[0]?.id ?? '');
  const [privacy, setPrivacy] = useState<Privacy>('private'); const [coords, setCoords] = useState({ latitude: 37.5665, longitude: 126.978 });
  const choosePhoto = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return Alert.alert('사진 권한이 필요합니다.');
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: .75 });
    if (!result.canceled) setImageUri(result.assets[0].uri);
  };
  const locate = async () => {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (!permission.granted) return Alert.alert('위치 권한이 필요합니다.');
    const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    setCoords({ latitude: location.coords.latitude, longitude: location.coords.longitude });
  };
  const submit = () => {
    if (!name.trim()) return Alert.alert('장소 이름을 입력하세요.');
    onSave({ id: `p${Date.now()}`, name: name.trim(), memo: memo.trim(), tags: tags.split(',').map(v => v.trim()).filter(Boolean), category, date: new Date().toISOString().slice(0, 10), latitude: coords.latitude, longitude: coords.longitude, collectionId, privacy, imageUri });
  };
  return <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}><ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
    <View style={styles.progress}><View style={styles.progressOn} /><View /><View /></View>
    <Pressable style={styles.upload} onPress={choosePhoto}>{imageUri ? <Image source={{ uri: imageUri }} style={styles.uploadImage} /> : <><Text style={styles.uploadPlus}>＋</Text><Text style={styles.uploadTitle}>사진 촬영 또는 앨범에서 선택</Text><Text style={styles.eyebrow}>장소를 기억할 사진을 선택하세요</Text></>}</Pressable>
    <Field label="장소 이름"><TextInput value={name} onChangeText={setName} placeholder="예: 강릉 바다 창가 카페" style={styles.input} /></Field>
    <Pressable style={styles.locationButton} onPress={locate}><Text style={styles.locationText}>⌖ 현재 위치 불러오기</Text></Pressable>
    <Text style={styles.coords}>{coords.latitude.toFixed(5)}, {coords.longitude.toFixed(5)}</Text>
    <Field label="한 줄 메모"><TextInput value={memo} onChangeText={setMemo} placeholder="무엇이 좋았는지 기록하세요" multiline style={[styles.input, styles.textarea]} /></Field>
    <Text style={styles.fieldLabel}>카테고리</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>{CATEGORIES.map(item => <Chip key={item} label={item} active={category === item} onPress={() => setCategory(item)} />)}</ScrollView>
    <Field label="태그"><TextInput value={tags} onChangeText={setTags} placeholder="바다전망, 다시갈곳" style={styles.input} /></Field>
    <Text style={styles.fieldLabel}>컬렉션</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>{collections.map(item => <Chip key={item.id} label={item.name} active={collectionId === item.id} onPress={() => setCollectionId(item.id)} />)}</ScrollView>
    <Text style={styles.fieldLabel}>공개 범위</Text><View style={styles.privacyRow}><Chip label="🔒 나만 보기" active={privacy === 'private'} onPress={() => setPrivacy('private')} /><Chip label="🔗 링크 공유" active={privacy === 'link'} onPress={() => setPrivacy('link')} /></View>
    <Pressable style={styles.primaryButton} onPress={submit}><Text style={styles.primaryButtonText}>장소 저장하기</Text></Pressable>
  </ScrollView></KeyboardAvoidingView>;
}

function CollectionsScreen({ places, collections, setCollections, setSelected }: { places: Place[]; collections: Collection[]; setCollections: React.Dispatch<React.SetStateAction<Collection[]>>; setSelected: (place: Place) => void }) {
  const add = () => Alert.prompt?.('새 컬렉션', '컬렉션 이름을 입력하세요.', name => name?.trim() && setCollections(current => [...current, { id: `c${Date.now()}`, name: name.trim(), privacy: 'private' }]));
  return <FlatList data={collections} keyExtractor={item => item.id} contentContainerStyle={styles.listContent} ListHeaderComponent={<View style={styles.collectionHeader}><Text style={styles.eyebrow}>장소를 주제별로 정리하세요</Text><Pressable style={styles.smallAdd} onPress={add}><Text style={styles.addIcon}>＋</Text></Pressable></View>} renderItem={({ item }) => { const collectionPlaces = places.filter(p => p.collectionId === item.id); const cover = collectionPlaces[0]; return <Pressable style={styles.collectionCard} onPress={() => cover && setSelected(cover)}>{cover?.imageUri ? <Image source={{ uri: cover.imageUri }} style={styles.collectionImage} /> : <View style={[styles.collectionImage, styles.placeholder]} />}<View style={styles.cardBody}><Text style={styles.cardTitle}>{item.name}</Text><Text style={styles.cardMeta}>{collectionPlaces.length}곳 · {item.privacy === 'private' ? '나만 보기' : '링크 공유'}</Text><Text style={styles.tagText}>{cover ? `최근 저장 ${formatDate(cover.date)}` : '아직 장소가 없습니다'}</Text></View></Pressable>; }} />;
}

function PlaceDetail({ place, visible, onClose, onDelete }: { place: Place | null; visible: boolean; onClose: () => void; onDelete: (id: string) => void }) {
  if (!place) return null;
  return <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}><View style={styles.modalBackdrop}><View style={styles.detailSheet}>{place.imageUri ? <Image source={{ uri: place.imageUri }} style={styles.detailImage} /> : <View style={[styles.detailImage, styles.placeholder]} />}<Pressable onPress={onClose} style={styles.closeButton}><Text>✕</Text></Pressable><View style={styles.detailBody}><Text style={styles.cardMeta}>{place.category} · {formatDate(place.date)}</Text><Text style={styles.detailTitle}>{place.name}</Text><Text style={styles.detailMemo}>{place.memo || '아직 메모가 없습니다.'}</Text><Text style={styles.tagText}>{place.tags.map(tag => `#${tag}`).join(' ')}</Text><Text style={styles.cardMeta}>⌖ {place.latitude.toFixed(5)}, {place.longitude.toFixed(5)} · {place.privacy === 'private' ? '나만 보기' : '링크 공유'}</Text><View style={styles.actionRow}><Pressable style={styles.secondaryButton} onPress={onClose}><Text style={styles.secondaryText}>닫기</Text></Pressable><Pressable style={styles.deleteButton} onPress={() => Alert.alert('장소 삭제', '이 장소를 삭제할까요?', [{ text: '취소' }, { text: '삭제', style: 'destructive', onPress: () => onDelete(place.id) }])}><Text style={styles.deleteText}>삭제</Text></Pressable></View></View></View></View></Modal>;
}

function PlaceCard({ place, onPress }: { place: Place; onPress: () => void }) { return <Pressable style={styles.placeCard} onPress={onPress}>{place.imageUri ? <Image source={{ uri: place.imageUri }} style={styles.placeImage} /> : <View style={[styles.placeImage, styles.placeholder]} />}<View style={styles.cardBody}><Text style={styles.cardTitle}>{place.name}</Text><Text style={styles.cardMeta}>{place.category} · {formatDate(place.date)}</Text><Text style={styles.cardMemo} numberOfLines={2}>{place.memo}</Text><Text style={styles.tagText}>{place.tags.map(tag => `#${tag}`).join(' ')}</Text></View></Pressable>; }
function MemoryCard({ place, onPress }: { place: Place; onPress: () => void }) { return <Pressable style={styles.memoryCard} onPress={onPress}>{place.imageUri ? <Image source={{ uri: place.imageUri }} style={styles.memoryImage} /> : <View style={[styles.memoryImage, styles.placeholder]} />}<View style={styles.cardBody}><Text style={styles.cardTitle}>{place.name}</Text><Text style={styles.cardMeta}>{formatDate(place.date)} · {place.category}</Text><Text style={styles.cardMemo} numberOfLines={2}>{place.memo}</Text><Text style={styles.tagText}>{place.tags.map(tag => `#${tag}`).join(' ')}</Text></View></Pressable>; }
function Chip({ label, active, onPress }: { label: string; active?: boolean; onPress?: () => void }) { return <Pressable onPress={onPress} style={[styles.chip, active && styles.chipActive]}><Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text></Pressable>; }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <View style={styles.field}><Text style={styles.fieldLabel}>{label}</Text>{children}</View>; }
function formatDate(date: string) { return new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric' }).format(new Date(date)); }

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg }, shell: { flex: 1, backgroundColor: COLORS.bg }, flex: { flex: 1 }, content: { flex: 1, paddingHorizontal: 18 },
  header: { height: 94, paddingHorizontal: 20, paddingBottom: 12, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }, eyebrow: { color: COLORS.muted, fontSize: 12, marginBottom: 3 }, title: { color: COLORS.text, fontSize: 25, fontWeight: '800' }, iconButton: { width: 42, height: 42, borderRadius: 14, backgroundColor: COLORS.surface, alignItems: 'center', justifyContent: 'center' },
  nav: { height: 76, flexDirection: 'row', backgroundColor: COLORS.surface, borderTopWidth: 1, borderTopColor: COLORS.line }, navItem: { flex: 1, alignItems: 'center', justifyContent: 'center' }, navIcon: { fontSize: 24, color: COLORS.muted }, navLabel: { fontSize: 11, color: COLORS.muted }, navActive: { color: COLORS.primary, fontWeight: '800' }, addCircle: { width: 48, height: 48, borderRadius: 24, backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center', marginTop: -24 }, addIcon: { color: '#fff', fontSize: 27 },
  search: { height: 48, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.line, borderRadius: 15, paddingHorizontal: 14 }, chipRow: { gap: 8, paddingVertical: 13 }, chip: { borderWidth: 1, borderColor: COLORS.line, backgroundColor: COLORS.surface, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 14 }, chipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary }, chipText: { color: COLORS.muted, fontSize: 13 }, chipTextActive: { color: '#fff', fontWeight: '800' }, map: { flex: 1, minHeight: 360, borderRadius: 20 },
  placeCard: { backgroundColor: COLORS.surface, borderRadius: 20, padding: 10, marginVertical: 12, flexDirection: 'row', gap: 14 }, placeImage: { width: 112, height: 105, borderRadius: 15 }, placeholder: { backgroundColor: '#B8D9CE' }, cardBody: { flex: 1, justifyContent: 'center' }, cardTitle: { color: COLORS.text, fontSize: 16, fontWeight: '800', marginBottom: 5 }, cardMeta: { color: COLORS.muted, fontSize: 12, marginBottom: 7 }, cardMemo: { color: COLORS.text, fontSize: 13, lineHeight: 19 }, tagText: { color: COLORS.primary, fontWeight: '700', fontSize: 12, marginTop: 8 }, listContent: { paddingBottom: 18 }, memoryCard: { flexDirection: 'row', gap: 14, backgroundColor: COLORS.surface, padding: 10, borderRadius: 18, marginBottom: 14 }, memoryImage: { width: 126, height: 126, borderRadius: 15 },
  form: { gap: 14, paddingBottom: 28 }, progress: { flexDirection: 'row', gap: 6 }, progressOn: { backgroundColor: COLORS.primary }, upload: { height: 230, backgroundColor: COLORS.soft, borderRadius: 20, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }, uploadImage: { width: '100%', height: '100%' }, uploadPlus: { fontSize: 48, color: COLORS.primary }, uploadTitle: { fontWeight: '800', marginBottom: 7 }, field: { gap: 7 }, fieldLabel: { color: COLORS.text, fontSize: 13, fontWeight: '800' }, input: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.line, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 13 }, textarea: { minHeight: 90, textAlignVertical: 'top' }, locationButton: { backgroundColor: COLORS.soft, padding: 14, borderRadius: 14, alignItems: 'center' }, locationText: { color: COLORS.primaryDark, fontWeight: '800' }, coords: { color: COLORS.muted, fontSize: 12, textAlign: 'center' }, privacyRow: { flexDirection: 'row', gap: 8 }, primaryButton: { backgroundColor: COLORS.primary, padding: 16, borderRadius: 15, alignItems: 'center', marginTop: 5 }, primaryButtonText: { color: '#fff', fontWeight: '800' },
  collectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }, smallAdd: { width: 42, height: 42, borderRadius: 14, backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center' }, collectionCard: { flexDirection: 'row', gap: 14, backgroundColor: COLORS.surface, padding: 10, borderRadius: 18, marginBottom: 14 }, collectionImage: { width: 112, height: 112, borderRadius: 15 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(9,24,20,.55)', justifyContent: 'flex-end' }, detailSheet: { backgroundColor: COLORS.bg, borderTopLeftRadius: 28, borderTopRightRadius: 28, overflow: 'hidden', maxHeight: '90%' }, detailImage: { width: '100%', height: 280 }, closeButton: { position: 'absolute', right: 16, top: 16, width: 42, height: 42, borderRadius: 21, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' }, detailBody: { padding: 22 }, detailTitle: { fontSize: 24, fontWeight: '900', color: COLORS.text, marginBottom: 12 }, detailMemo: { fontSize: 15, color: COLORS.text, lineHeight: 22 }, actionRow: { flexDirection: 'row', gap: 10, marginTop: 22 }, secondaryButton: { flex: 1, borderWidth: 1, borderColor: COLORS.line, borderRadius: 14, padding: 14, alignItems: 'center' }, secondaryText: { color: COLORS.primary, fontWeight: '800' }, deleteButton: { flex: 1, backgroundColor: '#FFF0F0', borderRadius: 14, padding: 14, alignItems: 'center' }, deleteText: { color: '#B64848', fontWeight: '800' },
});
