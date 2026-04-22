// src/screens/locations/LocationsScreen.tsx
// Gestionare lacuri/bălți — selectare, creare, istoric capturi

import React, { useEffect, useRef, useState } from 'react';
import { useIsFocused } from '@react-navigation/native';
import {
  Animated,
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Modal, TextInput, Alert, ActivityIndicator,
  FlatList, Image, Linking, PanResponder,
} from 'react-native';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import { SafeAreaView } from 'react-native-safe-area-context';
import SuccessSheet from '../../components/SuccessSheet';
import { formatDate, useI18n } from '../../i18n';
import { uploadImageToSupabase } from '../../lib/mediaUpload';
import { supabase } from '../../lib/supabase';
import { useAuthStore } from '../../store/authStore';
import { useThemeStore } from '../../store/themeStore';
import { getAppTheme } from '../../theme';
import type { Location as FishLocation, Catch } from '../../types';

type WaterType = FishLocation['water_type'];
type LocationScope = 'public' | 'private';

interface SuccessState {
  title: string;
  message: string;
  details?: string;
}

interface NoticeState {
  title: string;
  message: string;
  details?: string;
}

const DEFAULT_MAP_ZOOM = 15;
const TILE_SIZE = 256;

function clampLatitude(latitude: number) {
  return Math.max(-85, Math.min(85, latitude));
}

function normalizeLongitude(longitude: number) {
  return ((((longitude + 180) % 360) + 360) % 360) - 180;
}

function getDragAdjustedCoords(
  latitude: number,
  longitude: number,
  dx: number,
  dy: number,
  zoom: number,
) {
  const latitudeRadians = (latitude * Math.PI) / 180;
  const metersPerPixel = (156543.03392 * Math.max(Math.cos(latitudeRadians), 0.01)) / Math.pow(2, zoom);
  const metersPerDegreeLatitude = 111320;
  const metersPerDegreeLongitude = Math.max(111320 * Math.cos(latitudeRadians), 1);

  return {
    lat: clampLatitude(latitude + ((dy * metersPerPixel) / metersPerDegreeLatitude)),
    lng: normalizeLongitude(longitude - ((dx * metersPerPixel) / metersPerDegreeLongitude)),
  };
}

function getTilePoint(latitude: number, longitude: number, zoom: number) {
  const scale = Math.pow(2, zoom);
  const normalizedLatitude = clampLatitude(latitude);
  const latitudeRadians = (normalizedLatitude * Math.PI) / 180;
  const x = ((normalizeLongitude(longitude) + 180) / 360) * scale;
  const y = (1 - Math.log(Math.tan(latitudeRadians) + (1 / Math.cos(latitudeRadians))) / Math.PI) / 2 * scale;

  return { x, y, scale };
}

function buildMapTiles(
  latitude: number,
  longitude: number,
  zoom: number,
  viewport: { width: number; height: number },
) {
  const tilePoint = getTilePoint(latitude, longitude, zoom);
  const centerPixelX = tilePoint.x * TILE_SIZE;
  const centerPixelY = tilePoint.y * TILE_SIZE;
  const viewportWidth = Math.max(240, Math.round(viewport.width || 320));
  const viewportHeight = Math.max(180, Math.round(viewport.height || 220));
  const originPixelX = centerPixelX - viewportWidth / 2;
  const originPixelY = centerPixelY - viewportHeight / 2;
  const startTileX = Math.floor(originPixelX / TILE_SIZE) - 1;
  const endTileX = Math.floor((originPixelX + viewportWidth) / TILE_SIZE) + 1;
  const startTileY = Math.floor(originPixelY / TILE_SIZE) - 1;
  const endTileY = Math.floor((originPixelY + viewportHeight) / TILE_SIZE) + 1;
  const maxTileIndex = tilePoint.scale - 1;
  const tiles: Array<{ key: string; uri: string; left: number; top: number }> = [];

  for (let tileY = startTileY; tileY <= endTileY; tileY += 1) {
    if (tileY < 0 || tileY > maxTileIndex) continue;

    for (let tileX = startTileX; tileX <= endTileX; tileX += 1) {
      const wrappedTileX = ((tileX % tilePoint.scale) + tilePoint.scale) % tilePoint.scale;
      const tileSubdomain = ['a', 'b', 'c', 'd'][(wrappedTileX + tileY) % 4];

      tiles.push({
        key: `${zoom}-${wrappedTileX}-${tileY}-${tileX}`,
        uri: `https://${tileSubdomain}.basemaps.cartocdn.com/rastertiles/voyager/${zoom}/${wrappedTileX}/${tileY}.png`,
        left: tileX * TILE_SIZE - originPixelX,
        top: tileY * TILE_SIZE - originPixelY,
      });
    }
  }

  return tiles;
}

export default function LocationsScreen() {
  const { user, profile } = useAuthStore();
  const { language, t } = useI18n();
  const mode = useThemeStore((state) => state.mode);
  const theme = getAppTheme(mode);
  const isDark = mode === 'dark';
  const [locations, setLocations] = useState<FishLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedLocation, setSelectedLocation] = useState<FishLocation | null>(null);
  const [descriptionModal, setDescriptionModal] = useState(false);
  const [catches, setCatches] = useState<Catch[]>([]);
  const [createModal, setCreateModal] = useState(false);
  const [requestModal, setRequestModal] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [locationScope, setLocationScope] = useState<LocationScope>('public');
  const [editingLocation, setEditingLocation] = useState<FishLocation | null>(null);

  // Form creare
  const [newName, setNewName] = useState('');
  const [newVisibility, setNewVisibility] = useState<LocationScope>('private');
  const [newWaterType, setNewWaterType] = useState<WaterType>('lake');
  const [newDesc, setNewDesc] = useState('');
  const [newLat, setNewLat] = useState('');
  const [newLng, setNewLng] = useState('');
  const [mapZoom, setMapZoom] = useState(DEFAULT_MAP_ZOOM);
  const [mapViewport, setMapViewport] = useState({ width: 320, height: 220 });
  const [mapPickerVisible, setMapPickerVisible] = useState(false);
  const [mapPickerCoords, setMapPickerCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [mapPickerInitialCoords, setMapPickerInitialCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [mapPickerLiveCoords, setMapPickerLiveCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [mapPickerZoom, setMapPickerZoom] = useState(DEFAULT_MAP_ZOOM);
  const [mapPickerViewport, setMapPickerViewport] = useState({ width: 360, height: 520 });
  const [mapPickerDragging, setMapPickerDragging] = useState(false);
  const [remoteSearchQuery, setRemoteSearchQuery] = useState('');
  const [searchingRemote, setSearchingRemote] = useState(false);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [requestName, setRequestName] = useState('');
  const [requestWaterType, setRequestWaterType] = useState<WaterType>('lake');
  const [requestDesc, setRequestDesc] = useState('');
  const [requesting, setRequesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [successState, setSuccessState] = useState<SuccessState | null>(null);
  const [noticeState, setNoticeState] = useState<NoticeState | null>(null);
  const isAdmin = profile?.role === 'admin';
  const isFocused = useIsFocused();

  useEffect(() => {
    void fetchLocations();
  }, []);

  useEffect(() => {
    if (!isFocused) return;

    void fetchLocations();
    if (selectedLocation?.id) {
      void fetchCatches(selectedLocation.id);
    }
  }, [isFocused, selectedLocation?.id]);

  const normalizeLocationName = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();
  const waterTypeOptions: WaterType[] = ['lake', 'pond', 'river', 'danube', 'canal', 'other'];
  const getWaterTypeLabel = (value?: WaterType | null) => t(`locations.waterType.${value ?? 'other'}`);
  const hasValidCoordinates = !Number.isNaN(parseFloat(newLat)) && !Number.isNaN(parseFloat(newLng));
  const committedMapCoords = hasValidCoordinates ? { lat: parseFloat(newLat), lng: parseFloat(newLng) } : null;
  const waterTypeBadgeBg = isDark ? '#21443b' : theme.primarySoft;
  const waterTypeBadgeBorder = isDark ? '#3f7a6b' : theme.border;
  const waterTypeBadgeText = isDark ? '#d9fff1' : theme.primaryStrong;
  const canCreateLocations = !!user;
  const canCreateGlobalLocations = isAdmin;
  const mapTiles = committedMapCoords ? buildMapTiles(committedMapCoords.lat, committedMapCoords.lng, mapZoom, mapViewport) : [];
  const displayedMapCoords = committedMapCoords;
  const mapPickerDisplayedCoords = mapPickerLiveCoords ?? mapPickerCoords;
  const mapPickerTiles = mapPickerCoords ? buildMapTiles(mapPickerCoords.lat, mapPickerCoords.lng, mapPickerZoom, mapPickerViewport) : [];
  const mapPickerZoomPercent = Math.max(0, Math.min(100, ((mapPickerZoom - 5) / (18 - 5)) * 100));
  const mapPickerPan = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const mapPickerCoordsRef = useRef<{ lat: number; lng: number } | null>(null);
  const mapPickerZoomRef = useRef(DEFAULT_MAP_ZOOM);

  useEffect(() => {
    mapPickerCoordsRef.current = mapPickerCoords;
  }, [mapPickerCoords]);

  useEffect(() => {
    mapPickerZoomRef.current = mapPickerZoom;
  }, [mapPickerZoom]);

  const mapPickerPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !!mapPickerCoordsRef.current,
      onStartShouldSetPanResponderCapture: () => !!mapPickerCoordsRef.current,
      onMoveShouldSetPanResponder: () => !!mapPickerCoordsRef.current,
      onMoveShouldSetPanResponderCapture: () => !!mapPickerCoordsRef.current,
      onPanResponderGrant: () => {
        setMapPickerDragging(true);
      },
      onPanResponderMove: (_, gestureState) => {
        const currentCoords = mapPickerCoordsRef.current;
        if (!currentCoords) return;

        mapPickerPan.setValue({ x: gestureState.dx, y: gestureState.dy });
        setMapPickerLiveCoords(getDragAdjustedCoords(
          currentCoords.lat,
          currentCoords.lng,
          gestureState.dx,
          gestureState.dy,
          mapPickerZoomRef.current,
        ));
      },
      onPanResponderRelease: (_, gestureState) => {
        const currentCoords = mapPickerCoordsRef.current;
        if (!currentCoords) return;

        const nextCoords = getDragAdjustedCoords(
          currentCoords.lat,
          currentCoords.lng,
          gestureState.dx,
          gestureState.dy,
          mapPickerZoomRef.current,
        );

        mapPickerPan.setValue({ x: 0, y: 0 });
        setMapPickerDragging(false);
        setMapPickerLiveCoords(null);
        setMapPickerCoords(nextCoords);
      },
      onPanResponderEnd: () => {
        setMapPickerDragging(false);
      },
      onPanResponderTerminationRequest: () => false,
      onPanResponderTerminate: () => {
        mapPickerPan.setValue({ x: 0, y: 0 });
        setMapPickerDragging(false);
        setMapPickerLiveCoords(null);
      },
    }),
  ).current;

  useEffect(() => {
    mapPickerPan.setValue({ x: 0, y: 0 });
    setMapPickerLiveCoords(null);
  }, [mapPickerCoords, mapPickerZoom, mapPickerPan]);

  const openDuplicateNameNotice = () => {
    setNoticeState({
      title: t('locations.duplicateTitle'),
      message: t('locations.duplicateName'),
      details: t('locations.duplicateDetails'),
    });
  };

  const fetchLocations = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('locations')
      .select('*')
      .order('name');
    if (data) {
      const nextLocations = data as FishLocation[];
      setLocations(nextLocations);
      setSelectedLocation((current) => {
        if (!current) return current;
        return nextLocations.find((item) => item.id === current.id) ?? null;
      });
    }
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
    setDescriptionModal(false);
    setSelectedLocation(loc);
    void fetchCatches(loc.id);
  };

  useEffect(() => {
    const channel = supabase
      .channel('locations-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'locations' }, () => {
        void fetchLocations();
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    if (!selectedLocation?.id) return;

    const channel = supabase
      .channel(`location-detail-${selectedLocation.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'catches', filter: `location_id=eq.${selectedLocation.id}` },
        () => {
          void fetchCatches(selectedLocation.id);
        },
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => {
        void fetchCatches(selectedLocation.id);
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [selectedLocation?.id]);

  const resetLocationForm = () => {
    setEditingLocation(null);
    setNewName('');
    setNewVisibility(isAdmin ? 'public' : 'private');
    setNewWaterType('lake');
    setNewDesc('');
    setNewLat('');
    setNewLng('');
    setMapZoom(DEFAULT_MAP_ZOOM);
    setMapPickerVisible(false);
    setMapPickerCoords(null);
    setMapPickerInitialCoords(null);
    setMapPickerLiveCoords(null);
    setMapPickerZoom(DEFAULT_MAP_ZOOM);
    setRemoteSearchQuery('');
    setPhotoUri(null);
  };

  const openCreateLocationModal = () => {
    if (!user) {
      return;
    }

    resetLocationForm();
    setCreateModal(true);
  };

  const openRequestLocationModal = () => {
    setRequestName(searchText.trim());
    setRequestWaterType('lake');
    setRequestDesc('');
    setRequestModal(true);
  };

  const openEditLocationModal = () => {
    if (!selectedLocation) return;
    setEditingLocation(selectedLocation);
    setNewName(selectedLocation.name);
    setNewVisibility(selectedLocation.is_public ? 'public' : 'private');
    setNewWaterType(selectedLocation.water_type ?? 'lake');
    setNewDesc(selectedLocation.description ?? '');
    setNewLat(String(selectedLocation.lat));
    setNewLng(String(selectedLocation.lng));
    setMapZoom(DEFAULT_MAP_ZOOM);
    setMapPickerVisible(false);
    setMapPickerCoords(null);
    setMapPickerInitialCoords(null);
    setMapPickerLiveCoords(null);
    setMapPickerZoom(DEFAULT_MAP_ZOOM);
    setRemoteSearchQuery(selectedLocation.name);
    setPhotoUri(selectedLocation.photo_url ?? null);
    setCreateModal(true);
  };

  const openMapPicker = () => {
    if (!committedMapCoords) {
      setNoticeState({
        title: t('locations.remoteSearchTitle'),
        message: t('locations.mapNeedsCoords'),
      });
      return;
    }

    setMapPickerCoords(committedMapCoords);
  setMapPickerInitialCoords(committedMapCoords);
    setMapPickerLiveCoords(null);
    setMapPickerZoom(mapZoom);
    setMapPickerVisible(true);
  };

  const closeMapPicker = () => {
    setMapPickerVisible(false);
    setMapPickerInitialCoords(null);
    setMapPickerLiveCoords(null);
    setMapPickerDragging(false);
  };

  const resetMapPicker = () => {
    if (!mapPickerInitialCoords) return;

    setMapPickerCoords(mapPickerInitialCoords);
    setMapPickerLiveCoords(null);
    setMapPickerZoom(mapZoom);
  };

  const centerMapPickerOnCurrentLocation = async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      setNoticeState({
        title: t('locations.mapPickerCurrentLocationTitle'),
        message: t('locations.mapPickerCurrentLocationDenied'),
      });
      return;
    }

    try {
      const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const coords = {
        lat: location.coords.latitude,
        lng: location.coords.longitude,
      };

      setMapPickerCoords(coords);
      setMapPickerLiveCoords(null);
      setMapPickerZoom(DEFAULT_MAP_ZOOM);
    } catch (error) {
      setNoticeState({
        title: t('locations.mapPickerCurrentLocationTitle'),
        message: t('locations.mapPickerCurrentLocationFailed'),
        details: error instanceof Error ? error.message : undefined,
      });
    }
  };

  const confirmMapPicker = () => {
    if (!mapPickerCoords) return;

    setNewLat(mapPickerCoords.lat.toFixed(6));
    setNewLng(mapPickerCoords.lng.toFixed(6));
    setMapZoom(mapPickerZoom);
    closeMapPicker();
  };

  const openCoordsInMaps = async (lat: number, lng: number, label?: string) => {
    const query = encodeURIComponent(label?.trim() ? `${label} ${lat},${lng}` : `${lat},${lng}`);
    const url = `https://www.google.com/maps/search/?api=1&query=${query}`;
    const supported = await Linking.canOpenURL(url);
    if (!supported) {
      setNoticeState({
        title: t('locations.mapOpenFailedTitle'),
        message: t('locations.mapOpenFailedMessage'),
      });
      return;
    }

    await Linking.openURL(url);
  };

  const getGPSLocation = async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return;
    const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
    setNewLat(loc.coords.latitude.toFixed(6));
    setNewLng(loc.coords.longitude.toFixed(6));
    setMapZoom(DEFAULT_MAP_ZOOM);
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

  const searchRemoteLocation = async () => {
    const query = (remoteSearchQuery.trim() || newName.trim());
    if (!query) {
      setNoticeState({
        title: t('locations.remoteSearchTitle'),
        message: t('locations.remoteSearchMissingQuery'),
      });
      return;
    }

    setSearchingRemote(true);
    try {
      const results = await Location.geocodeAsync(query);
      if (!results.length) {
        setNoticeState({
          title: t('locations.remoteSearchTitle'),
          message: t('locations.remoteSearchEmpty'),
          details: t('locations.remoteSearchHint'),
        });
        return;
      }

      const firstResult = results[0];
      setNewLat(firstResult.latitude.toFixed(6));
      setNewLng(firstResult.longitude.toFixed(6));
      setMapZoom(DEFAULT_MAP_ZOOM);
      if (!newName.trim()) {
        setNewName(query);
      }

      setSuccessState({
        title: t('locations.remoteSearchDoneTitle'),
        message: t('locations.remoteSearchDoneMessage'),
        details: `${firstResult.latitude.toFixed(6)}, ${firstResult.longitude.toFixed(6)}`,
      });
    } catch (error) {
      setNoticeState({
        title: t('locations.remoteSearchTitle'),
        message: t('locations.remoteSearchFailed'),
        details: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setSearchingRemote(false);
    }
  };

  const saveLocation = async () => {
    if (!newName.trim()) return Alert.alert(t('common.error'), t('locations.missingName'));
    if (!newLat || !newLng) return Alert.alert(t('common.error'), t('locations.missingCoordinates'));
    if (!user) return;
    if (newVisibility === 'public' && !canCreateGlobalLocations) {
      setNoticeState({
        title: t('locations.adminOnlyGlobalTitle'),
        message: t('locations.adminOnlyGlobalMessage'),
      });
      return;
    }

    const normalizedName = normalizeLocationName(newName);
    const hasDuplicateName = locations.some((item) => normalizeLocationName(item.name) === normalizedName && item.id !== editingLocation?.id);
    if (hasDuplicateName) {
      openDuplicateNameNotice();
      return;
    }

    setSaving(true);
    let photoUrl: string | null = editingLocation?.photo_url ?? null;

    // Upload foto dacă există
    if (photoUri && photoUri !== editingLocation?.photo_url) {
      try {
        photoUrl = await uploadImageToSupabase({
          bucket: 'photos',
          folder: 'locations',
          uri: photoUri,
          userId: user.id,
        });
      } catch (error) {
        setSaving(false);
        Alert.alert(
          t('common.error'),
          `${t('locations.photoUploadFailed')}\n\n${error instanceof Error ? error.message : ''}`.trim()
        );
        return;
      }
    }

    const locationPayload = {
      created_by: editingLocation?.created_by ?? user.id,
      name: newName.trim(),
      water_type: newWaterType,
      description: newDesc.trim() || null,
      lat: parseFloat(newLat),
      lng: parseFloat(newLng),
      photo_url: photoUrl,
      is_public: newVisibility === 'public',
    };

    const { error } = editingLocation
      ? await supabase.from('locations').update(locationPayload).eq('id', editingLocation.id)
      : await supabase.from('locations').insert(locationPayload);

    setSaving(false);
    if (error) {
      const duplicateNameError = /location name already exists|duplicate key value/i.test(error.message);
      if (duplicateNameError) {
        openDuplicateNameNotice();
      } else {
        Alert.alert(t('common.error'), error.message);
      }
    } else {
      setSuccessState({
        title: editingLocation ? t('locations.updatedTitle') : t('locations.addedTitle'),
        message: editingLocation ? t('locations.updatedMessage', { name: newName }) : t('locations.addedMessage', { name: newName }),
        details: newVisibility === 'public' ? t('locations.addedDetailsPublic') : t('locations.addedDetailsPrivate'),
      });
      setCreateModal(false);
      resetLocationForm();
      fetchLocations();
      if (selectedLocation && editingLocation) {
        setSelectedLocation({ ...selectedLocation, ...locationPayload, id: selectedLocation.id, created_at: selectedLocation.created_at });
      }
    }
  };

  const canManageSelectedLocation = !!selectedLocation && !!user?.id && (selectedLocation.created_by === user.id || isAdmin);

  const sendLocationRequest = async () => {
    if (!user?.id) return;

    const normalizedName = requestName.trim();
    if (!normalizedName) {
      Alert.alert(t('common.error'), t('locations.requestMissingName'));
      return;
    }

    setRequesting(true);
    const { data: adminRows, error: adminError } = await supabase
      .from('profiles')
      .select('id')
      .eq('role', 'admin')
      .neq('id', user.id);

    if (adminError || !adminRows?.length) {
      setRequesting(false);
      Alert.alert(t('common.error'), adminError?.message ?? t('locations.requestNoAdmin'));
      return;
    }

    const message = [
      t('locations.requestMessageName', { name: normalizedName }),
      t('locations.requestMessageType', { type: getWaterTypeLabel(requestWaterType) }),
      requestDesc.trim() ? t('locations.requestMessageNotes', { notes: requestDesc.trim() }) : null,
    ].filter(Boolean).join('\n');

    for (const admin of adminRows as Array<{ id: string }>) {
      const conversationResult = await supabase.rpc('create_or_get_private_conversation', { other_user_id: admin.id });
      if (conversationResult.error || !conversationResult.data) {
        setRequesting(false);
        Alert.alert(t('common.error'), conversationResult.error?.message ?? t('common.unknown'));
        return;
      }

      const { error } = await supabase.from('private_messages').insert({
        conversation_id: conversationResult.data,
        user_id: user.id,
        content: message,
      });

      if (error) {
        setRequesting(false);
        Alert.alert(t('common.error'), error.message);
        return;
      }
    }

    setRequesting(false);
    setRequestModal(false);
    setRequestName('');
    setRequestDesc('');
    setRequestWaterType('lake');
    setSuccessState({
      title: t('locations.requestSentTitle'),
      message: t('locations.requestSentMessage', { name: normalizedName }),
      details: t('locations.requestSentDetails'),
    });
  };

  const scopedLocations = locations.filter((item) => (
    locationScope === 'public' ? item.is_public : !item.is_public
  ));

  const filtered = scopedLocations.filter((l) =>
    l.name.toLowerCase().includes(searchText.toLowerCase())
    || l.description?.toLowerCase().includes(searchText.toLowerCase())
    || getWaterTypeLabel(l.water_type).toLowerCase().includes(searchText.toLowerCase())
  );

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: theme.surface, borderBottomColor: theme.borderSoft }]}>
        <Text style={[styles.headerTitle, { color: theme.text }]}>📍 {t('locations.title')}</Text>
        <View style={styles.headerActions}>
          {!isAdmin && (
            <TouchableOpacity style={[styles.requestBtn, { backgroundColor: isDark ? theme.surfaceAlt : '#EEF6FF', borderColor: theme.border }]} onPress={openRequestLocationModal}>
              <Text style={[styles.requestBtnText, { color: theme.text }]}>{t('locations.requestAction')}</Text>
            </TouchableOpacity>
          )}
          {canCreateLocations ? (
            <TouchableOpacity style={[styles.addBtn, { backgroundColor: theme.primary }]} onPress={openCreateLocationModal}>
              <Text style={styles.addBtnText}>{t('locations.add')}</Text>
            </TouchableOpacity>
          ) : <View style={styles.headerSpacer} />}
        </View>
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
        <View style={styles.scopeRow}>
          {(['public', 'private'] as const).map((scope) => (
            <TouchableOpacity
              key={scope}
              style={[
                styles.scopeChip,
                { backgroundColor: theme.inputBg, borderColor: theme.border },
                locationScope === scope && { backgroundColor: theme.primary, borderColor: theme.primary },
              ]}
              onPress={() => setLocationScope(scope)}
            >
              <Text style={[styles.scopeChipText, { color: locationScope === scope ? '#fff' : theme.text }]}>{t(scope === 'public' ? 'locations.scopePublic' : 'locations.scopePrivate')}</Text>
            </TouchableOpacity>
          ))}
        </View>
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
              <Text style={[styles.emptySubText, { color: theme.textSoft }]}>{t(locationScope === 'public' ? 'locations.emptyPublicHint' : 'locations.emptyPrivateHint')}</Text>
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
                <View style={styles.locationTitleRow}>
                  <Text style={[styles.locationName, { color: theme.text }]}>{item.name}</Text>
                  <View style={[styles.typeBadge, { backgroundColor: waterTypeBadgeBg, borderColor: waterTypeBadgeBorder }]}> 
                    <Text style={[styles.typeBadgeText, { color: waterTypeBadgeText }]}>{getWaterTypeLabel(item.water_type)}</Text>
                  </View>
                </View>
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
            {canManageSelectedLocation ? (
              <TouchableOpacity onPress={openEditLocationModal}>
                <Text style={[styles.backBtn, { color: theme.primary }]}>{t('locations.editAction')}</Text>
              </TouchableOpacity>
            ) : <View style={{ width: 60 }} />}
          </View>

          <ScrollView contentContainerStyle={{ padding: 16 }}>
            {selectedLocation?.photo_url && (
              <Image source={{ uri: selectedLocation.photo_url }} style={styles.detailPhoto} />
            )}

            <View style={[styles.detailInfoCard, { backgroundColor: theme.surface, borderColor: theme.borderSoft }]}> 
              <Text style={[styles.sectionTitle, { color: theme.text }]}>{t('locations.description')}</Text>
              <Text style={[styles.detailDescriptionPreview, { color: theme.textMuted }]} numberOfLines={4}>
                {selectedLocation?.description?.trim() || t('locations.descriptionEmpty')}
              </Text>
              {!!selectedLocation?.description?.trim() && (
                <TouchableOpacity
                  style={[styles.descriptionButton, { backgroundColor: isDark ? theme.surfaceAlt : '#EEF6FF', borderColor: theme.border }]}
                  onPress={() => setDescriptionModal(true)}
                >
                  <Text style={[styles.descriptionButtonText, { color: theme.text }]}>{t('locations.viewFullDescription')}</Text>
                </TouchableOpacity>
              )}
            </View>

            <Text style={[styles.sectionTitle, { color: theme.text }]}>📊 {t('locations.catchHistory')}</Text>

            <TouchableOpacity
              style={[styles.mapOpenButton, { backgroundColor: isDark ? theme.surfaceAlt : '#E8F3FE', borderColor: isDark ? theme.border : '#B6D3F2' }]}
              onPress={() => void openCoordsInMaps(selectedLocation?.lat ?? 0, selectedLocation?.lng ?? 0, selectedLocation?.name)}
            >
              <Text style={[styles.mapOpenButtonText, { color: isDark ? theme.text : '#1A5E94' }]}>🗺️ {t('locations.openInMaps')}</Text>
            </TouchableOpacity>

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
                </View>
              ))
            )}
          </ScrollView>
        </SafeAreaView>
      </Modal>

      <Modal visible={descriptionModal} animationType="slide" onRequestClose={() => setDescriptionModal(false)}>
        <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}> 
          <View style={[styles.detailHeader, { backgroundColor: theme.surface, borderBottomColor: theme.borderSoft }]}> 
            <TouchableOpacity onPress={() => setDescriptionModal(false)}>
              <Text style={[styles.backBtn, { color: theme.primary }]}>‹ {t('common.close')}</Text>
            </TouchableOpacity>
            <Text style={[styles.detailTitle, { color: theme.text }]} numberOfLines={1}>{selectedLocation?.name}</Text>
            <View style={{ width: 60 }} />
          </View>

          <ScrollView contentContainerStyle={{ padding: 16 }}>
            <View style={[styles.detailInfoCard, { backgroundColor: theme.surface, borderColor: theme.borderSoft }]}> 
              <Text style={[styles.sectionTitle, { color: theme.text }]}>{t('locations.description')}</Text>
              <Text style={[styles.descriptionFullText, { color: theme.text }]}>
                {selectedLocation?.description?.trim() || t('locations.descriptionEmpty')}
              </Text>
            </View>
          </ScrollView>
        </SafeAreaView>
      </Modal>

      {/* Modal creare locație */}
      <Modal visible={createModal} animationType="slide">
        <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}> 
          <View style={[styles.detailHeader, { backgroundColor: theme.surface, borderBottomColor: theme.borderSoft }]}> 
            <TouchableOpacity onPress={() => {
              setCreateModal(false);
              resetLocationForm();
            }}>
              <Text style={[styles.backBtn, { color: theme.primary }]}>‹ {t('locations.cancel')}</Text>
            </TouchableOpacity>
            <Text style={[styles.detailTitle, { color: theme.text }]}>{editingLocation ? t('locations.editLocation') : t('locations.newLocation')}</Text>
            <View style={{ width: 60 }} />
          </View>

          <ScrollView contentContainerStyle={{ padding: 16 }}>
            <Text style={[styles.inputLabel, { color: theme.textMuted }]}>{t('locations.locationName')}</Text>
            <TextInput style={[styles.input, { backgroundColor: theme.inputBg, borderColor: theme.border, color: theme.text }]} placeholder={t('locations.locationNamePlaceholder')} placeholderTextColor={theme.textSoft} value={newName} onChangeText={setNewName} />

            <Text style={[styles.inputLabel, { color: theme.textMuted }]}>{t('locations.visibilityLabel')}</Text>
            <View style={styles.typeOptionRow}>
              {(['private', 'public'] as const).map((visibility) => {
                const disabled = visibility === 'public' && !canCreateGlobalLocations;
                const isSelected = newVisibility === visibility;

                return (
                  <TouchableOpacity
                    key={visibility}
                    style={[
                      styles.typeOptionChip,
                      { backgroundColor: isSelected ? theme.primary : theme.surface, borderColor: isSelected ? theme.primary : theme.border },
                      disabled && { opacity: 0.45 },
                    ]}
                    onPress={() => !disabled && setNewVisibility(visibility)}
                    disabled={disabled}
                  >
                    <Text style={[styles.typeOptionText, { color: isSelected ? '#fff' : (isDark ? '#d9fff1' : theme.text) }]}>{t(visibility === 'public' ? 'locations.scopePublic' : 'locations.scopePrivate')}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <Text style={[styles.visibilityHint, { color: theme.textSoft }]}>{t(newVisibility === 'public' ? 'locations.visibilityPublicHint' : 'locations.visibilityPrivateHint')}</Text>

            <Text style={[styles.inputLabel, { color: theme.textMuted }]}>{t('locations.waterTypeLabel')}</Text>
            <View style={styles.typeOptionRow}>
              {waterTypeOptions.map((option) => {
                const isSelected = newWaterType === option;
                return (
                  <TouchableOpacity
                    key={option}
                    style={[styles.typeOptionChip, { backgroundColor: isSelected ? theme.primary : theme.surface, borderColor: isSelected ? theme.primary : theme.border }]}
                    onPress={() => setNewWaterType(option)}
                  >
                    <Text style={[styles.typeOptionText, { color: isSelected ? '#fff' : (isDark ? '#d9fff1' : theme.text) }]}>{getWaterTypeLabel(option)}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={[styles.inputLabel, { color: theme.textMuted }]}>{t('locations.description')}</Text>
            <TextInput style={[styles.input, { height: 80, backgroundColor: theme.inputBg, borderColor: theme.border, color: theme.text }]} placeholder={t('locations.descriptionPlaceholder')} placeholderTextColor={theme.textSoft} value={newDesc} onChangeText={setNewDesc} multiline />

            <Text style={[styles.inputLabel, { color: theme.textMuted }]}>{t('locations.remoteSearchLabel')}</Text>
            <View style={styles.remoteSearchRow}>
              <TextInput
                style={[styles.input, styles.remoteSearchInput, { backgroundColor: theme.inputBg, borderColor: theme.border, color: theme.text }]}
                placeholder={t('locations.remoteSearchPlaceholder')}
                placeholderTextColor={theme.textSoft}
                value={remoteSearchQuery}
                onChangeText={setRemoteSearchQuery}
              />
              <TouchableOpacity
                style={[styles.remoteSearchButton, { backgroundColor: theme.primary }, searchingRemote && { opacity: 0.7 }]}
                onPress={() => void searchRemoteLocation()}
                disabled={searchingRemote}
              >
                {searchingRemote ? <ActivityIndicator color="#fff" /> : <Text style={styles.remoteSearchButtonText}>{t('locations.remoteSearchAction')}</Text>}
              </TouchableOpacity>
            </View>

            <Text style={[styles.inputLabel, { color: theme.textMuted }]}>{t('locations.coordinates')}</Text>
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
              <TextInput style={[styles.input, { flex: 1, marginBottom: 0, backgroundColor: theme.inputBg, borderColor: theme.border, color: theme.text }]} placeholder={t('locations.latitude')} placeholderTextColor={theme.textSoft} value={newLat} onChangeText={setNewLat} keyboardType="decimal-pad" />
              <TextInput style={[styles.input, { flex: 1, marginBottom: 0, backgroundColor: theme.inputBg, borderColor: theme.border, color: theme.text }]} placeholder={t('locations.longitude')} placeholderTextColor={theme.textSoft} value={newLng} onChangeText={setNewLng} keyboardType="decimal-pad" />
            </View>

            <View style={[styles.pinAdjustCard, { backgroundColor: theme.surface, borderColor: theme.borderSoft }]}>
              <View style={styles.pinAdjustHeaderRow}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.pinAdjustTitle, { color: theme.text }]}>{t('locations.pinAdjustTitle')}</Text>
                  <Text style={[styles.pinAdjustHint, { color: theme.textMuted }]}>{t('locations.pinAdjustHint')}</Text>
                </View>
                <View style={styles.mapZoomRow}>
                  <TouchableOpacity
                    style={[styles.mapZoomBtn, { backgroundColor: theme.inputBg, borderColor: theme.border }]}
                    onPress={() => setMapZoom((value) => Math.max(5, value - 1))}
                    disabled={!committedMapCoords}
                  >
                    <Text style={[styles.mapZoomBtnText, { color: theme.text }]}>-</Text>
                  </TouchableOpacity>
                  <View style={[styles.mapZoomLevel, { backgroundColor: isDark ? theme.surfaceAlt : theme.primarySoft, borderColor: theme.border }]}> 
                    <Text style={[styles.mapZoomLevelText, { color: theme.text }]}>{t('locations.mapZoomValue', { value: mapZoom })}</Text>
                  </View>
                  <TouchableOpacity
                    style={[styles.mapZoomBtn, { backgroundColor: theme.inputBg, borderColor: theme.border }]}
                    onPress={() => setMapZoom((value) => Math.min(18, value + 1))}
                    disabled={!committedMapCoords}
                  >
                    <Text style={[styles.mapZoomBtnText, { color: theme.text }]}>+</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {committedMapCoords && mapTiles.length ? (
                <>
                  <Text style={[styles.mapLiveCoords, { color: theme.text }]}>
                    {t('locations.mapLiveCoords', {
                      lat: displayedMapCoords?.lat.toFixed(6) ?? committedMapCoords.lat.toFixed(6),
                      lng: displayedMapCoords?.lng.toFixed(6) ?? committedMapCoords.lng.toFixed(6),
                    })}
                  </Text>

                  <TouchableOpacity
                    activeOpacity={0.92}
                    onPress={openMapPicker}
                    style={[styles.inlineMapTouch, { borderColor: theme.border }]}
                  >
                    <View
                      style={[styles.inlineMapFrame, { backgroundColor: theme.inputBg, borderColor: theme.border }]}
                      onLayout={({ nativeEvent }) => {
                        const { width, height } = nativeEvent.layout;
                        if (width > 0 && height > 0) {
                          setMapViewport({ width, height });
                        }
                      }}
                    >
                      <View style={styles.inlineMapLayer}>
                        {mapTiles.map((tile) => (
                          <Image
                            key={tile.key}
                            source={{ uri: tile.uri }}
                            style={[styles.inlineMapTile, { left: tile.left, top: tile.top }]}
                          />
                        ))}
                      </View>
                      <View pointerEvents="none" style={styles.mapCenterPinWrap}>
                        <Text style={styles.mapCenterPin}>📍</Text>
                      </View>
                    </View>
                  </TouchableOpacity>

                  <Text style={[styles.mapGestureHint, { color: theme.textMuted }]}>{t('locations.mapOpenFullscreenHint')}</Text>
                  <TouchableOpacity style={[styles.mapOpenFullBtn, { backgroundColor: theme.primary }]} onPress={openMapPicker}>
                    <Text style={styles.mapOpenFullBtnText}>{t('locations.mapOpenFullscreen')}</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <View style={[styles.inlineMapEmpty, { backgroundColor: theme.inputBg, borderColor: theme.border }]}> 
                  <Text style={[styles.inlineMapEmptyText, { color: theme.textMuted }]}>{t('locations.mapNeedsCoords')}</Text>
                </View>
              )}
            </View>

            <TouchableOpacity style={[styles.gpsBtn, { backgroundColor: isDark ? theme.surfaceAlt : '#E6F1FB', borderColor: isDark ? theme.border : '#B5D4F4' }]} onPress={getGPSLocation}>
              <Text style={styles.gpsBtnText}>📍 {t('locations.useCurrentLocation')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.gpsBtn, { backgroundColor: isDark ? theme.surfaceAlt : '#EEF7EA', borderColor: isDark ? theme.border : '#B7DDC4' }, !hasValidCoordinates && { opacity: 0.5 }]}
              onPress={() => void openCoordsInMaps(parseFloat(newLat), parseFloat(newLng), newName || remoteSearchQuery)}
              disabled={!hasValidCoordinates}
            >
              <Text style={styles.gpsBtnText}>🗺️ {t('locations.openInMaps')}</Text>
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
              {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>✅ {editingLocation ? t('locations.saveChanges') : t('locations.save')}</Text>}
            </TouchableOpacity>
          </ScrollView>
        </SafeAreaView>
      </Modal>

      <Modal visible={requestModal} animationType="slide">
        <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}> 
          <View style={[styles.detailHeader, { backgroundColor: theme.surface, borderBottomColor: theme.borderSoft }]}> 
            <TouchableOpacity onPress={() => setRequestModal(false)}>
              <Text style={[styles.backBtn, { color: theme.primary }]}>‹ {t('locations.cancel')}</Text>
            </TouchableOpacity>
            <Text style={[styles.detailTitle, { color: theme.text }]}>{t('locations.requestTitle')}</Text>
            <View style={{ width: 60 }} />
          </View>

          <ScrollView contentContainerStyle={{ padding: 16 }}>
            <Text style={[styles.inputLabel, { color: theme.textMuted }]}>{t('locations.locationName')}</Text>
            <TextInput style={[styles.input, { backgroundColor: theme.inputBg, borderColor: theme.border, color: theme.text }]} placeholder={t('locations.locationNamePlaceholder')} placeholderTextColor={theme.textSoft} value={requestName} onChangeText={setRequestName} />

            <Text style={[styles.inputLabel, { color: theme.textMuted }]}>{t('locations.waterTypeLabel')}</Text>
            <View style={styles.typeOptionRow}>
              {waterTypeOptions.map((option) => {
                const isSelected = requestWaterType === option;
                return (
                  <TouchableOpacity
                    key={option}
                    style={[styles.typeOptionChip, { backgroundColor: isSelected ? theme.primary : theme.surface, borderColor: isSelected ? theme.primary : theme.border }]}
                    onPress={() => setRequestWaterType(option)}
                  >
                    <Text style={[styles.typeOptionText, { color: isSelected ? '#fff' : (isDark ? '#d9fff1' : theme.text) }]}>{getWaterTypeLabel(option)}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={[styles.inputLabel, { color: theme.textMuted }]}>{t('locations.requestNotesLabel')}</Text>
            <TextInput style={[styles.input, { height: 110, backgroundColor: theme.inputBg, borderColor: theme.border, color: theme.text }]} placeholder={t('locations.requestNotesPlaceholder')} placeholderTextColor={theme.textSoft} value={requestDesc} onChangeText={setRequestDesc} multiline />

            <TouchableOpacity
              style={[styles.saveBtn, { backgroundColor: theme.primary }, requesting && { opacity: 0.6 }]}
              onPress={sendLocationRequest}
              disabled={requesting}
            >
              {requesting ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>📨 {t('locations.requestSend')}</Text>}
            </TouchableOpacity>
          </ScrollView>
        </SafeAreaView>
      </Modal>

      <Modal visible={mapPickerVisible} animationType="slide">
        <SafeAreaView style={[styles.mapPickerSafe, { backgroundColor: theme.background }]}> 
          <View style={[styles.detailHeader, { backgroundColor: theme.surface, borderBottomColor: theme.borderSoft }]}> 
            <TouchableOpacity onPress={closeMapPicker}>
              <Text style={[styles.backBtn, { color: theme.primary }]}>‹ {t('locations.cancel')}</Text>
            </TouchableOpacity>
            <Text style={[styles.detailTitle, { color: theme.text }]} numberOfLines={1}>{t('locations.mapPickerTitle')}</Text>
            <TouchableOpacity onPress={confirmMapPicker} disabled={!mapPickerCoords}>
              <Text style={[styles.backBtn, { color: mapPickerCoords ? theme.primary : theme.textSoft }]}>{t('locations.mapPickerConfirm')}</Text>
            </TouchableOpacity>
          </View>

          <View style={[styles.mapPickerToolbar, { backgroundColor: theme.surface, borderBottomColor: theme.borderSoft }]}> 
            <View style={{ flex: 1 }}>
              <Text style={[styles.mapPickerHint, { color: theme.textMuted }]}>{t('locations.mapPickerHint')}</Text>
              <Text style={[styles.mapLiveCoords, { color: theme.text }]}> 
                {t('locations.mapLiveCoords', {
                  lat: mapPickerDisplayedCoords?.lat.toFixed(6) ?? committedMapCoords?.lat.toFixed(6) ?? '0.000000',
                  lng: mapPickerDisplayedCoords?.lng.toFixed(6) ?? committedMapCoords?.lng.toFixed(6) ?? '0.000000',
                })}
              </Text>
            </View>
            <View style={styles.mapZoomRow}>
              <TouchableOpacity
                style={[styles.mapZoomBtn, { backgroundColor: theme.inputBg, borderColor: theme.border }]}
                onPress={() => setMapPickerZoom((value) => Math.max(5, value - 1))}
                disabled={!mapPickerCoords}
              >
                <Text style={[styles.mapZoomBtnText, { color: theme.text }]}>-</Text>
              </TouchableOpacity>
              <View style={[styles.mapZoomLevel, { backgroundColor: isDark ? theme.surfaceAlt : theme.primarySoft, borderColor: theme.border }]}> 
                <Text style={[styles.mapZoomLevelText, { color: theme.text }]}>{t('locations.mapZoomValue', { value: mapPickerZoom })}</Text>
              </View>
              <TouchableOpacity
                style={[styles.mapZoomBtn, { backgroundColor: theme.inputBg, borderColor: theme.border }]}
                onPress={() => setMapPickerZoom((value) => Math.min(18, value + 1))}
                disabled={!mapPickerCoords}
              >
                <Text style={[styles.mapZoomBtnText, { color: theme.text }]}>+</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.mapZoomMeterWrap}>
              <View style={[styles.mapZoomMeterTrack, { backgroundColor: isDark ? theme.surfaceAlt : '#dbe8ef' }]}>
                <View style={[styles.mapZoomMeterFill, { backgroundColor: theme.primary, width: `${mapPickerZoomPercent}%` }]} />
              </View>
              <Text style={[styles.mapZoomMeterLabel, { color: theme.textMuted }]}>{t('locations.mapZoomScale')}</Text>
            </View>
          </View>

          <View
            style={[styles.mapPickerFrame, { backgroundColor: theme.inputBg }]}
            onLayout={({ nativeEvent }) => {
              const { width, height } = nativeEvent.layout;
              if (width > 0 && height > 0) {
                setMapPickerViewport({ width, height });
              }
            }}
            {...mapPickerPanResponder.panHandlers}
          >
            <Animated.View style={[styles.inlineMapLayer, { transform: [...mapPickerPan.getTranslateTransform()] }]}>
              {mapPickerTiles.map((tile) => (
                <Image
                  key={tile.key}
                  source={{ uri: tile.uri }}
                  style={[styles.inlineMapTile, { left: tile.left, top: tile.top }]}
                />
              ))}
            </Animated.View>
            <View pointerEvents="none" style={styles.mapCenterPinWrap}>
              <Text style={styles.mapPickerCenterPin}>📍</Text>
            </View>
          </View>

          <View style={[styles.mapPickerFooter, { backgroundColor: theme.surface, borderTopColor: theme.borderSoft }]}> 
            <TouchableOpacity
              style={[styles.mapPickerCurrentBtn, { backgroundColor: isDark ? theme.surfaceAlt : '#EEF7EA', borderColor: isDark ? theme.border : '#B7DDC4' }]}
              onPress={() => void centerMapPickerOnCurrentLocation()}
              disabled={mapPickerDragging}
            >
              <Text style={[styles.mapPickerCurrentBtnText, { color: isDark ? theme.text : '#196B4F' }]}>{t('locations.mapPickerCurrentLocation')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.mapPickerResetBtn, { backgroundColor: isDark ? theme.surfaceAlt : '#E8F3FE', borderColor: isDark ? theme.border : '#B6D3F2' }, !mapPickerInitialCoords && { opacity: 0.5 }]}
              onPress={resetMapPicker}
              disabled={!mapPickerInitialCoords || mapPickerDragging}
            >
              <Text style={[styles.mapPickerResetBtnText, { color: isDark ? theme.text : '#1A5E94' }]}>{t('locations.mapPickerReset')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.mapPickerConfirmBtn, { backgroundColor: theme.primary }, !mapPickerCoords && { opacity: 0.5 }]} onPress={confirmMapPicker} disabled={!mapPickerCoords || mapPickerDragging}>
              <Text style={styles.mapPickerConfirmBtnText}>{t('locations.mapPickerConfirm')}</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Modal>

      <SuccessSheet
        visible={!!successState}
        title={successState?.title ?? ''}
        message={successState?.message ?? ''}
        details={successState?.details}
        onClose={() => setSuccessState(null)}
      />

      <SuccessSheet
        visible={!!noticeState}
        title={noticeState?.title ?? ''}
        message={noticeState?.message ?? ''}
        details={noticeState?.details}
        variant="warning"
        buttonLabel={t('auth.ok')}
        autoCloseMs={5000}
        onClose={() => setNoticeState(null)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f4f6f8' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, paddingBottom: 8, backgroundColor: '#fff', borderBottomWidth: 0.5, borderBottomColor: '#eee' },
  headerTitle: { fontSize: 18, fontWeight: '800', color: '#1a1a1a' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerSpacer: { width: 84, height: 1 },
  addBtn: { backgroundColor: '#1D9E75', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8 },
  addBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  requestBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1 },
  requestBtnText: { fontWeight: '700', fontSize: 12 },
  searchRow: { backgroundColor: '#fff', padding: 10, borderBottomWidth: 0.5, borderBottomColor: '#eee' },
  searchInput: { backgroundColor: '#f4f6f8', borderRadius: 10, padding: 10, fontSize: 14, color: '#1a1a1a' },
  scopeRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  scopeChip: { borderRadius: 999, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8 },
  scopeChipText: { fontSize: 12, fontWeight: '800' },
  locationCard: { backgroundColor: '#fff', borderRadius: 14, marginBottom: 10, overflow: 'hidden', flexDirection: 'row', alignItems: 'center', borderWidth: 0.5, borderColor: '#eee', padding: 10, gap: 12 },
  locationPhoto: { width: 60, height: 60, borderRadius: 10 },
  locationPhotoEmpty: { width: 60, height: 60, borderRadius: 10, backgroundColor: '#f0f0f0', alignItems: 'center', justifyContent: 'center' },
  locationInfo: { flex: 1 },
  locationTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  locationName: { fontSize: 15, fontWeight: '700', color: '#1a1a1a' },
  typeBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, borderWidth: 1 },
  typeBadgeText: { fontSize: 11, fontWeight: '800' },
  locationDesc: { fontSize: 12, color: '#888', marginTop: 2 },
  locationCoords: { fontSize: 11, color: '#aaa', marginTop: 3 },
  emptyText: { fontSize: 15, color: '#888', textAlign: 'center' },
  emptySubText: { fontSize: 13, color: '#aaa', marginTop: 4 },
  mapOpenButton: { borderRadius: 12, borderWidth: 1, paddingVertical: 12, paddingHorizontal: 14, marginBottom: 16 },
  mapOpenButtonText: { fontSize: 14, fontWeight: '700', textAlign: 'center' },
  detailInfoCard: { borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 16 },
  detailDescriptionPreview: { fontSize: 14, lineHeight: 21 },
  descriptionButton: { marginTop: 12, borderRadius: 12, borderWidth: 1, paddingVertical: 10, paddingHorizontal: 12 },
  descriptionButtonText: { fontSize: 13, fontWeight: '700', textAlign: 'center' },
  descriptionFullText: { fontSize: 15, lineHeight: 24 },
  typeOptionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  typeOptionChip: { borderRadius: 999, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8 },
  typeOptionText: { fontSize: 12, fontWeight: '700' },
  visibilityHint: { fontSize: 12, lineHeight: 18, marginTop: -6, marginBottom: 4 },
  pinAdjustCard: { borderRadius: 14, borderWidth: 1, padding: 12, marginBottom: 10 },
  inlineMapTouch: { borderRadius: 16, marginTop: 4 },
  pinAdjustHeaderRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  pinAdjustTitle: { fontSize: 13, fontWeight: '800' },
  pinAdjustHint: { fontSize: 12, lineHeight: 18, marginTop: 4 },
  mapZoomRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  mapZoomBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mapZoomBtnText: { fontSize: 20, fontWeight: '800', lineHeight: 22 },
  mapZoomLevel: {
    minWidth: 78,
    height: 34,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  mapZoomLevelText: { fontSize: 12, fontWeight: '700' },
  mapZoomMeterWrap: { marginTop: 10, gap: 6 },
  mapZoomMeterTrack: { height: 8, borderRadius: 999, overflow: 'hidden' },
  mapZoomMeterFill: { height: '100%', borderRadius: 999 },
  mapZoomMeterLabel: { fontSize: 11, fontWeight: '700' },
  mapLiveCoords: { fontSize: 12, fontWeight: '700', marginTop: 12, marginBottom: 8 },
  inlineMapFrame: {
    height: 240,
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
    position: 'relative',
    marginTop: 4,
  },
  inlineMapLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  inlineMapTile: {
    position: 'absolute',
    width: TILE_SIZE,
    height: TILE_SIZE,
  },
  mapCenterPinWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mapCenterPin: { fontSize: 34, marginTop: -18 },
  mapGestureHint: { fontSize: 12, lineHeight: 18, marginTop: 10 },
  mapOpenFullBtn: { borderRadius: 12, paddingVertical: 12, alignItems: 'center', marginTop: 10 },
  mapOpenFullBtnText: { color: '#fff', fontSize: 13, fontWeight: '800' },
  inlineMapEmpty: {
    borderRadius: 16,
    borderWidth: 1,
    minHeight: 160,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
    padding: 16,
  },
  inlineMapEmptyText: { fontSize: 12, lineHeight: 18, textAlign: 'center' },
  remoteSearchRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  remoteSearchInput: { flex: 1 },
  remoteSearchButton: { borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, minWidth: 96, alignItems: 'center', justifyContent: 'center' },
  remoteSearchButtonText: { color: '#fff', fontWeight: '800', fontSize: 12 },
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
  mapPickerSafe: { flex: 1 },
  mapPickerToolbar: { paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, gap: 10 },
  mapPickerHint: { fontSize: 12, lineHeight: 18 },
  mapPickerFrame: { flex: 1, position: 'relative', overflow: 'hidden' },
  mapPickerCenterPin: { fontSize: 42, marginTop: -20 },
  mapPickerFooter: { padding: 16, borderTopWidth: 1, gap: 10 },
  mapPickerCurrentBtn: { borderRadius: 14, paddingVertical: 14, alignItems: 'center', borderWidth: 1 },
  mapPickerCurrentBtnText: { fontSize: 14, fontWeight: '800' },
  mapPickerResetBtn: { borderRadius: 14, paddingVertical: 14, alignItems: 'center', borderWidth: 1 },
  mapPickerResetBtnText: { fontSize: 14, fontWeight: '800' },
  mapPickerConfirmBtn: { borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  mapPickerConfirmBtnText: { color: '#fff', fontSize: 15, fontWeight: '800' },
});
