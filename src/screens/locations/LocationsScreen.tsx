// src/screens/locations/LocationsScreen.tsx
// Gestionare lacuri/bălți — selectare, creare, istoric capturi

import React, { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Modal, TextInput, Alert, ActivityIndicator,
  FlatList, Image,
} from 'react-native';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import { SafeAreaView } from 'react-native-safe-area-context';
import SuccessSheet from '../../components/SuccessSheet';
import { formatDate, useI18n } from '../../i18n';
import { supabase } from '../../lib/supabase';
import { useAuthStore } from '../../store/authStore';
import { useThemeStore } from '../../store/themeStore';
import { getAppTheme } from '../../theme';
import type { Location as FishLocation, Catch } from '../../types';

interface SuccessState {
  title: string;
  message: string;
  details?: string;
}

export default function LocationsScreen() {
  const { user } = useAuthStore();
  const { language, t } = useI18n();
  const mode = useThemeStore((state) => state.mode);
  const theme = getAppTheme(mode);
  const isDark = mode === 'dark';
  const [locations, setLocations] = useState<FishLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedLocation, setSelectedLocation] = useState<FishLocation | null>(null);
  const [catches, setCatches] = useState<Catch[]>([]);
  const [createModal, setCreateModal] = useState(false);
  const [searchText, setSearchText] = useState('');

  // Form creare
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newLat, setNewLat] = useState('');
  const [newLng, setNewLng] = useState('');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [successState, setSuccessState] = useState<SuccessState | null>(null);

  useEffect(() => {
    fetchLocations();
  }, []);

  const fetchLocations = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('locations')
      .select('*')
      .order('name');
    if (data) setLocations(data as FishLocation[]);
    setLoading(false);
  };

  const fetchCatches = async (locationId: string) => {
    const { data } = await supabase
      .from('catches')
      .select('*, profiles:profiles!catches_user_id_fkey(username, avatar_url)')
      .eq('location_id', locationId)
      .order('caught_at', { ascending: false })
      .limit(30);
    if (data) setCatches(data as any[]);
  };

  const openLocation = (loc: FishLocation) => {
    setSelectedLocation(loc);
    fetchCatches(loc.id);
  };

  const getGPSLocation = async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return;
    const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
    setNewLat(loc.coords.latitude.toFixed(6));
    setNewLng(loc.coords.longitude.toFixed(6));
  };

  const pickPhoto = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
      allowsEditing: true,
      aspect: [16, 9],
    });
    if (!result.canceled) {
      setPhotoUri(result.assets[0].uri);
    }
  };

  const saveLocation = async () => {
    if (!newName.trim()) return Alert.alert(t('common.error'), t('locations.missingName'));
    if (!newLat || !newLng) return Alert.alert(t('common.error'), t('locations.missingCoordinates'));
    if (!user) return;

    setSaving(true);
    let photoUrl: string | null = null;

    // Upload foto dacă există
    if (photoUri) {
      const fileName = `locations/${Date.now()}.jpg`;
      const response = await fetch(photoUri);
      const blob = await response.blob();
      const { data: uploadData } = await supabase.storage
        .from('photos')
        .upload(fileName, blob, { contentType: 'image/jpeg' });
      if (uploadData) {
        const { data: urlData } = supabase.storage.from('photos').getPublicUrl(fileName);
        photoUrl = urlData.publicUrl;
      }
    }

    const { error } = await supabase.from('locations').insert({
      created_by: user.id,
      name: newName.trim(),
      description: newDesc.trim() || null,
      lat: parseFloat(newLat),
      lng: parseFloat(newLng),
      photo_url: photoUrl,
      is_public: true,
    });

    setSaving(false);
    if (error) {
      Alert.alert(t('common.error'), error.message);
    } else {
      setSuccessState({
        title: t('locations.addedTitle'),
        message: t('locations.addedMessage', { name: newName }),
        details: t('locations.addedDetails'),
      });
      setCreateModal(false);
      setNewName(''); setNewDesc(''); setNewLat(''); setNewLng(''); setPhotoUri(null);
      fetchLocations();
    }
  };

  const filtered = locations.filter((l) =>
    l.name.toLowerCase().includes(searchText.toLowerCase())
  );

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: theme.surface, borderBottomColor: theme.borderSoft }]}>
        <Text style={[styles.headerTitle, { color: theme.text }]}>📍 {t('locations.title')}</Text>
        <TouchableOpacity style={[styles.addBtn, { backgroundColor: theme.primary }]} onPress={() => setCreateModal(true)}>
          <Text style={styles.addBtnText}>{t('locations.add')}</Text>
        </TouchableOpacity>
      </View>

      {/* Căutare */}
      <View style={[styles.searchRow, { backgroundColor: theme.surface, borderBottomColor: theme.borderSoft }]}>
        <TextInput
          style={[styles.searchInput, { backgroundColor: theme.inputBg, color: theme.text }]}
          placeholder={`🔍 ${t('locations.search')}`}
          placeholderTextColor={theme.textSoft}
          value={searchText}
          onChangeText={setSearchText}
        />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.primary} size="large" />
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 16, paddingTop: 8 }}
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={{ fontSize: 40, marginBottom: 10 }}>🏞️</Text>
              <Text style={[styles.emptyText, { color: theme.textMuted }]}>{t('locations.noneFound')}</Text>
              <Text style={[styles.emptySubText, { color: theme.textSoft }]}>{t('locations.addFirst')}</Text>
            </View>
          }
          renderItem={({ item }) => (
            <TouchableOpacity style={[styles.locationCard, { backgroundColor: theme.surface, borderColor: theme.borderSoft }]} onPress={() => openLocation(item)}>
              {item.photo_url ? (
                <Image source={{ uri: item.photo_url }} style={styles.locationPhoto} />
              ) : (
                <View style={[styles.locationPhotoEmpty, { backgroundColor: theme.surfaceAlt }]}>
                  <Text style={{ fontSize: 32 }}>🏞️</Text>
                </View>
              )}
              <View style={styles.locationInfo}>
                <Text style={[styles.locationName, { color: theme.text }]}>{item.name}</Text>
                {item.description && (
                  <Text style={[styles.locationDesc, { color: theme.textMuted }]} numberOfLines={1}>{item.description}</Text>
                )}
                <Text style={[styles.locationCoords, { color: theme.textSoft }]}>
                  📌 {item.lat.toFixed(4)}, {item.lng.toFixed(4)}
                </Text>
              </View>
              <Text style={{ fontSize: 20, color: theme.textSoft }}>›</Text>
            </TouchableOpacity>
          )}
        />
      )}

      {/* Modal detalii locație */}
      <Modal visible={!!selectedLocation} animationType="slide">
        <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}> 
          <View style={[styles.detailHeader, { backgroundColor: theme.surface, borderBottomColor: theme.borderSoft }]}> 
            <TouchableOpacity onPress={() => setSelectedLocation(null)}>
              <Text style={[styles.backBtn, { color: theme.primary }]}>‹ {t('locations.back')}</Text>
            </TouchableOpacity>
            <Text style={[styles.detailTitle, { color: theme.text }]} numberOfLines={1}>{selectedLocation?.name}</Text>
            <View style={{ width: 60 }} />
          </View>

          <ScrollView contentContainerStyle={{ padding: 16 }}>
            {selectedLocation?.photo_url && (
              <Image source={{ uri: selectedLocation.photo_url }} style={styles.detailPhoto} />
            )}

            <Text style={[styles.sectionTitle, { color: theme.text }]}>📊 {t('locations.catchHistory')}</Text>

            {catches.length === 0 ? (
              <View style={styles.center}>
                <Text style={[styles.emptyText, { color: theme.textMuted }]}>{t('locations.noCatches')}</Text>
              </View>
            ) : (
              catches.map((c: any) => (
                <View key={c.id} style={[styles.catchCard, { backgroundColor: theme.surface, borderColor: theme.borderSoft }]}>
                  <Text style={styles.catchEmoji}>🐟</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.catchTitle, { color: theme.text }]}>
                      {c.fish_species ?? t('locations.unknownFish')}
                      {c.weight_kg ? ` · ${c.weight_kg} kg` : ''}
                    </Text>
                    <Text style={[styles.catchMeta, { color: theme.textMuted }]}>
                      @{c.profiles?.username ?? 'anonim'} · {formatDate(language, c.caught_at)}
                    </Text>
                  </View>
                  {c.is_returned && (
                    <View style={[styles.returnedBadge, { backgroundColor: isDark ? theme.primarySoft : '#E1F5EE' }]}>
                      <Text style={[styles.returnedText, { color: theme.primaryStrong }]}>C&R</Text>
                    </View>
                  )}
                </View>
              ))
            )}
          </ScrollView>
        </SafeAreaView>
      </Modal>

      {/* Modal creare locație */}
      <Modal visible={createModal} animationType="slide">
        <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}> 
          <View style={[styles.detailHeader, { backgroundColor: theme.surface, borderBottomColor: theme.borderSoft }]}> 
            <TouchableOpacity onPress={() => setCreateModal(false)}>
              <Text style={[styles.backBtn, { color: theme.primary }]}>‹ {t('locations.cancel')}</Text>
            </TouchableOpacity>
            <Text style={[styles.detailTitle, { color: theme.text }]}>{t('locations.newLocation')}</Text>
            <View style={{ width: 60 }} />
          </View>

          <ScrollView contentContainerStyle={{ padding: 16 }}>
            <Text style={[styles.inputLabel, { color: theme.textMuted }]}>{t('locations.locationName')}</Text>
            <TextInput style={[styles.input, { backgroundColor: theme.inputBg, borderColor: theme.border, color: theme.text }]} placeholder={t('locations.locationNamePlaceholder')} placeholderTextColor={theme.textSoft} value={newName} onChangeText={setNewName} />

            <Text style={[styles.inputLabel, { color: theme.textMuted }]}>{t('locations.description')}</Text>
            <TextInput style={[styles.input, { height: 80, backgroundColor: theme.inputBg, borderColor: theme.border, color: theme.text }]} placeholder={t('locations.descriptionPlaceholder')} placeholderTextColor={theme.textSoft} value={newDesc} onChangeText={setNewDesc} multiline />

            <Text style={[styles.inputLabel, { color: theme.textMuted }]}>{t('locations.coordinates')}</Text>
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
              <TextInput style={[styles.input, { flex: 1, marginBottom: 0, backgroundColor: theme.inputBg, borderColor: theme.border, color: theme.text }]} placeholder={t('locations.latitude')} placeholderTextColor={theme.textSoft} value={newLat} onChangeText={setNewLat} keyboardType="decimal-pad" />
              <TextInput style={[styles.input, { flex: 1, marginBottom: 0, backgroundColor: theme.inputBg, borderColor: theme.border, color: theme.text }]} placeholder={t('locations.longitude')} placeholderTextColor={theme.textSoft} value={newLng} onChangeText={setNewLng} keyboardType="decimal-pad" />
            </View>
            <TouchableOpacity style={[styles.gpsBtn, { backgroundColor: isDark ? theme.surfaceAlt : '#E6F1FB', borderColor: isDark ? theme.border : '#B5D4F4' }]} onPress={getGPSLocation}>
              <Text style={styles.gpsBtnText}>📍 {t('locations.useCurrentLocation')}</Text>
            </TouchableOpacity>

            <Text style={[styles.inputLabel, { color: theme.textMuted }]}>{t('locations.photo')}</Text>
            <TouchableOpacity style={[styles.photoBtn, { backgroundColor: theme.surface, borderColor: theme.border }]} onPress={pickPhoto}>
              {photoUri ? (
                <Image source={{ uri: photoUri }} style={styles.photoPreview} />
              ) : (
                <Text style={[styles.photoBtnText, { color: theme.textMuted }]}>📷 {t('locations.pickPhoto')}</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.saveBtn, { backgroundColor: theme.primary }, saving && { opacity: 0.6 }]}
              onPress={saveLocation}
              disabled={saving}
            >
              {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>✅ {t('locations.save')}</Text>}
            </TouchableOpacity>
          </ScrollView>
        </SafeAreaView>
      </Modal>

      <SuccessSheet
        visible={!!successState}
        title={successState?.title ?? ''}
        message={successState?.message ?? ''}
        details={successState?.details}
        onClose={() => setSuccessState(null)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f4f6f8' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, paddingBottom: 8, backgroundColor: '#fff', borderBottomWidth: 0.5, borderBottomColor: '#eee' },
  headerTitle: { fontSize: 18, fontWeight: '800', color: '#1a1a1a' },
  addBtn: { backgroundColor: '#1D9E75', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8 },
  addBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  searchRow: { backgroundColor: '#fff', padding: 10, borderBottomWidth: 0.5, borderBottomColor: '#eee' },
  searchInput: { backgroundColor: '#f4f6f8', borderRadius: 10, padding: 10, fontSize: 14, color: '#1a1a1a' },
  locationCard: { backgroundColor: '#fff', borderRadius: 14, marginBottom: 10, overflow: 'hidden', flexDirection: 'row', alignItems: 'center', borderWidth: 0.5, borderColor: '#eee', padding: 10, gap: 12 },
  locationPhoto: { width: 60, height: 60, borderRadius: 10 },
  locationPhotoEmpty: { width: 60, height: 60, borderRadius: 10, backgroundColor: '#f0f0f0', alignItems: 'center', justifyContent: 'center' },
  locationInfo: { flex: 1 },
  locationName: { fontSize: 15, fontWeight: '700', color: '#1a1a1a' },
  locationDesc: { fontSize: 12, color: '#888', marginTop: 2 },
  locationCoords: { fontSize: 11, color: '#aaa', marginTop: 3 },
  emptyText: { fontSize: 15, color: '#888', textAlign: 'center' },
  emptySubText: { fontSize: 13, color: '#aaa', marginTop: 4 },
  detailHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, backgroundColor: '#fff', borderBottomWidth: 0.5, borderBottomColor: '#eee' },
  backBtn: { fontSize: 16, color: '#1D9E75', fontWeight: '600' },
  detailTitle: { fontSize: 16, fontWeight: '700', color: '#1a1a1a', flex: 1, textAlign: 'center' },
  detailPhoto: { width: '100%', height: 180, borderRadius: 14, marginBottom: 16 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: '#1a1a1a', marginBottom: 12 },
  catchCard: { backgroundColor: '#fff', borderRadius: 12, padding: 12, marginBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 0.5, borderColor: '#eee' },
  catchEmoji: { fontSize: 28 },
  catchTitle: { fontSize: 14, fontWeight: '600', color: '#1a1a1a' },
  catchMeta: { fontSize: 12, color: '#888', marginTop: 2 },
  returnedBadge: { backgroundColor: '#E1F5EE', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  returnedText: { fontSize: 11, color: '#085041', fontWeight: '700' },
  inputLabel: { fontSize: 13, fontWeight: '600', color: '#444', marginBottom: 6, marginTop: 12 },
  input: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#e0e0e0', borderRadius: 10, padding: 12, fontSize: 14, color: '#1a1a1a', marginBottom: 4 },
  gpsBtn: { backgroundColor: '#E6F1FB', borderRadius: 10, padding: 12, alignItems: 'center', marginBottom: 4, borderWidth: 0.5, borderColor: '#B5D4F4' },
  gpsBtnText: { color: '#185FA5', fontWeight: '600', fontSize: 14 },
  photoBtn: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#ddd', borderRadius: 10, height: 100, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  photoBtnText: { color: '#888', fontSize: 15 },
  photoPreview: { width: '100%', height: 100 },
  saveBtn: { backgroundColor: '#1D9E75', borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 20, marginBottom: 10 },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
