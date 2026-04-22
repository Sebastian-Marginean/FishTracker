// src/screens/dashboard/DashboardScreen.tsx
// Timere locale — compatibil cu Expo Go

import React, { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, Modal, TextInput,
  Platform, RefreshControl, KeyboardAvoidingView,
  ActivityIndicator,
} from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import * as Location from 'expo-location';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import ConfirmActionSheet from '../../components/ConfirmActionSheet';
import SuccessSheet from '../../components/SuccessSheet';
import { formatDate, formatDateTime, getWeatherApiLanguage, useI18n } from '../../i18n';
import { supabase } from '../../lib/supabase';
import { buildFishForecast } from '../../lib/fishForecast';
import { useAuthStore } from '../../store/authStore';
import { useSessionStore } from '../../store/sessionStore';
import { useThemeStore } from '../../store/themeStore';
import { getAppTheme } from '../../theme';
import type { Group, Location as FishLocation } from '../../types';

interface WeatherData {
  temp: number;
  humidity: number;
  pressure: number;
  windSpeed: number;
  description: string;
}

interface SuccessState {
  title: string;
  message: string;
  details?: string;
  variant?: 'success' | 'warning';
}

interface HistorySessionRow {
  id: string;
  started_at: string;
  ended_at?: string | null;
  is_active: boolean;
  location?: { name?: string } | null;
}

interface HistoryRodRow {
  id: string;
  session_id: string;
  rod_number: number;
  bait_custom?: string | null;
  hook_bait?: string | null;
  hook_setup?: string | null;
  cast_count: number;
  catch_count: number;
  updated_at: string;
  last_cast_at?: string | null;
}

interface HistoryCatchRow {
  id: string;
  session_id: string;
  rod_id?: string | null;
  fish_species?: string | null;
  weight_kg?: number | null;
  caught_at: string;
  notes?: string | null;
}

interface HistorySetupRow {
  id: string;
  session_id: string;
  rod_id?: string | null;
  rod_number: number;
  bait_name?: string | null;
  hook_bait?: string | null;
  hook_setup?: string | null;
  created_at: string;
}

interface SessionHistoryItem {
  id: string;
  locationName: string;
  startedAt: string;
  endedAt?: string | null;
  totalCasts: number;
  totalCatches: number;
  totalWeight: number;
  baitsUsed: string[];
  rods: HistoryRodRow[];
  catches: HistoryCatchRow[];
  setupHistory: HistorySetupRow[];
}

interface SessionLocationChoice {
  id: string;
  name: string;
  lat: number;
  lng: number;
  water_type?: FishLocation['water_type'] | null;
}

interface ResolvedSessionLocation {
  id: string | null;
  name: string;
  waterType?: FishLocation['water_type'] | null;
  distanceMeters?: number | null;
}

// Timestamp-uri ținute în memorie (nu MMKV — compatibil Expo Go)
const castTimestamps: Record<number, number | null> = {
  1: null,
  2: null,
  3: null,
  4: null,
  5: null,
  6: null,
  7: null,
  8: null,
  9: null,
  10: null,
};
const LOCATION_MATCH_RADIUS_METERS = 750;
const HISTORY_SESSION_LIMIT = 20;

function getDistanceMeters(lat1: number, lng1: number, lat2: number, lng2: number) {
  const earthRadius = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);

  return 2 * earthRadius * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatSessionDuration(startedAt?: string, endedAt?: string | null) {
  if (!startedAt || !endedAt) return '-';

  const start = new Date(startedAt).getTime();
  const end = new Date(endedAt).getTime();
  const totalMinutes = Math.max(0, Math.round((end - start) / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  return `${minutes}m`;
}

function findSetupForCatch(catchTime: string, rod: HistoryRodRow, setupHistory: HistorySetupRow[]) {
  const catchTimestamp = new Date(catchTime).getTime();
  const matchingEntries = setupHistory
    .filter((entry) => new Date(entry.created_at).getTime() <= catchTimestamp)
    .sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime());

  const latestEntry = matchingEntries[0];

  return {
    bait: latestEntry?.bait_name?.trim() || rod.bait_custom?.trim() || '',
    hookBait: latestEntry?.hook_bait?.trim() || rod.hook_bait?.trim() || '',
    hook: latestEntry?.hook_setup?.trim() || rod.hook_setup?.trim() || '',
  };
}

export default function DashboardScreen() {
  const insets = useSafeAreaInsets();
  const isFocused = useIsFocused();
  const { user, profile } = useAuthStore();
  const { language, t } = useI18n();
  const { activeSession, startSession, endSession, updateSessionLocation, addRod, removeRod, castRod, saveRodSetup, addCatch, syncToSupabase } = useSessionStore();
  const mode = useThemeStore((state) => state.mode);
  const theme = getAppTheme(mode);
  const isDark = mode === 'dark';

  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [forecastModalVisible, setForecastModalVisible] = useState(false);
  const [tick, setTick] = useState(0); // forțează re-render la fiecare secundă
  const [editingRod, setEditingRod] = useState<number | null>(null);
  const [catchModal, setCatchModal] = useState<number | null>(null);
  const [catchWeight, setCatchWeight] = useState('');
  const [catchSpecies, setCatchSpecies] = useState('');
  const [myGroups, setMyGroups] = useState<Group[]>([]);
  const [selectedCatchGroupId, setSelectedCatchGroupId] = useState<string | null>(null);
  const [successState, setSuccessState] = useState<SuccessState | null>(null);
  const [baitInput, setBaitInput] = useState('');
  const [hookBaitInput, setHookBaitInput] = useState('');
  const [hookInput, setHookInput] = useState('');
  const [historyModalVisible, setHistoryModalVisible] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [totalHistorySessions, setTotalHistorySessions] = useState(0);
  const [sessionHistory, setSessionHistory] = useState<SessionHistoryItem[]>([]);
  const [selectedHistorySession, setSelectedHistorySession] = useState<SessionHistoryItem | null>(null);
  const [pendingRodDelete, setPendingRodDelete] = useState<number | null>(null);
  const [pendingSessionDelete, setPendingSessionDelete] = useState<SessionHistoryItem | null>(null);
  const [sessionLocationOptions, setSessionLocationOptions] = useState<SessionLocationChoice[]>([]);
  const [sessionLocationModalVisible, setSessionLocationModalVisible] = useState(false);
  const [sessionLocationMode, setSessionLocationMode] = useState<'start' | 'update'>('start');
  const [sessionLocationQuery, setSessionLocationQuery] = useState('');
  const [resolvingSessionLocation, setResolvingSessionLocation] = useState(false);
  const [suggestedSessionLocation, setSuggestedSessionLocation] = useState<ResolvedSessionLocation | null>(null);
  const [selectedSessionLocationId, setSelectedSessionLocationId] = useState<string | null>(null);
  const [selectedSessionLocationName, setSelectedSessionLocationName] = useState('');

  // Timer global — tick la fiecare secundă
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    fetchWeather();
  }, []);

  const getWaterTypeLabel = (value?: FishLocation['water_type'] | null) => t(`locations.waterType.${value ?? 'other'}`);

  const fetchSessionLocations = async (): Promise<SessionLocationChoice[]> => {
    const { data } = await supabase
      .from('locations')
      .select('id, name, lat, lng, water_type')
      .order('name');

    const mapped = (data ?? []) as SessionLocationChoice[];
    setSessionLocationOptions(mapped);
    return mapped;
  };

  const fetchUserGroups = async (userId?: string) => {
    if (!userId) {
      setMyGroups([]);
      return;
    }

    const { data } = await supabase
      .from('group_members')
      .select('groups(id, name, invite_code, owner_id, description, avatar_url, is_private, created_at)')
      .eq('user_id', userId);

    const groups = (data ?? []).map((item: any) => item.groups).filter(Boolean);
    setMyGroups(groups as Group[]);
  };

  useEffect(() => {
    void fetchUserGroups(user?.id);
  }, [user?.id, isFocused]);

  const loadSessionHistory = async () => {
    if (!user?.id) {
      setTotalHistorySessions(0);
      setSessionHistory([]);
      return;
    }

    setHistoryLoading(true);

    const totalSessionsRes = await supabase
      .from('sessions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .not('ended_at', 'is', null);

    setTotalHistorySessions(totalSessionsRes.count ?? 0);

    const { data: sessionsData, error: sessionsError } = await supabase
      .from('sessions')
      .select('id, started_at, ended_at, is_active, location:locations(name)')
      .eq('user_id', user.id)
      .not('ended_at', 'is', null)
      .order('started_at', { ascending: false })
      .limit(HISTORY_SESSION_LIMIT);

    if (sessionsError || !sessionsData?.length) {
      setSessionHistory([]);
      setSelectedHistorySession(null);
      setHistoryLoading(false);
      return;
    }

    const sessions = (sessionsData ?? []) as HistorySessionRow[];
    const sessionIds = sessions.map((item) => item.id);

    const [rodsRes, catchesRes, setupHistoryRes] = await Promise.all([
      supabase
        .from('rods')
        .select('id, session_id, rod_number, bait_custom, hook_bait, hook_setup, cast_count, catch_count, updated_at, last_cast_at')
        .in('session_id', sessionIds)
        .order('rod_number', { ascending: true }),
      supabase
        .from('catches')
        .select('id, session_id, rod_id, fish_species, weight_kg, caught_at, notes')
        .in('session_id', sessionIds)
        .order('caught_at', { ascending: false }),
        supabase
        .from('rod_setup_history')
        .select('id, session_id, rod_id, rod_number, bait_name, hook_bait, hook_setup, created_at')
        .in('session_id', sessionIds)
        .order('created_at', { ascending: true }),
    ]);

    const rods = ((rodsRes.data ?? []) as HistoryRodRow[]);
    const catches = ((catchesRes.data ?? []) as HistoryCatchRow[]);
      const setupHistory = (setupHistoryRes.error ? [] : (setupHistoryRes.data ?? [])) as HistorySetupRow[];

    const rodsBySession = rods.reduce<Record<string, HistoryRodRow[]>>((acc, rod) => {
      acc[rod.session_id] = [...(acc[rod.session_id] ?? []), rod];
      return acc;
    }, {});

    const catchesBySession = catches.reduce<Record<string, HistoryCatchRow[]>>((acc, item) => {
      acc[item.session_id] = [...(acc[item.session_id] ?? []), item];
      return acc;
    }, {});

    const setupHistoryBySession = setupHistory.reduce<Record<string, HistorySetupRow[]>>((acc, item) => {
      acc[item.session_id] = [...(acc[item.session_id] ?? []), item];
      return acc;
    }, {});

    const mapped = sessions.map((session) => {
      const sessionRods = (rodsBySession[session.id] ?? []).slice().sort((left, right) => left.rod_number - right.rod_number);
      const sessionCatches = catchesBySession[session.id] ?? [];
      const sessionSetupHistory = setupHistoryBySession[session.id] ?? [];
      const baitsUsed = Array.from(new Set([
        ...sessionSetupHistory
          .map((item) => item.bait_name?.trim())
          .filter((bait): bait is string => !!bait),
        ...sessionRods
          .map((rod) => rod.bait_custom?.trim())
          .filter((bait): bait is string => !!bait),
      ]));

      return {
        id: session.id,
        locationName: session.location?.name?.trim() || t('dashboard.historyUnknownLocation'),
        startedAt: session.started_at,
        endedAt: session.ended_at,
        totalCasts: sessionRods.reduce((sum, rod) => sum + Number(rod.cast_count ?? 0), 0),
        totalCatches: sessionCatches.length,
        totalWeight: sessionCatches.reduce((sum, item) => sum + Number(item.weight_kg ?? 0), 0),
        baitsUsed,
        rods: sessionRods,
        catches: sessionCatches,
        setupHistory: sessionSetupHistory,
      } satisfies SessionHistoryItem;
    });

    setSessionHistory(mapped);
    setSelectedHistorySession((current) => (current ? mapped.find((item) => item.id === current.id) ?? null : null));
    setHistoryLoading(false);
  };

  useEffect(() => {
    if (!user?.id || !isFocused) return;
    void loadSessionHistory();
  }, [user?.id, isFocused]);

  useEffect(() => {
    if (!isFocused) return;
    void fetchSessionLocations();
  }, [isFocused]);

  useEffect(() => {
    const channel = supabase
      .channel('dashboard-locations-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'locations' }, () => {
        void fetchSessionLocations();
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    if (!user?.id) return;

    const channel = supabase
      .channel(`dashboard-group-members-${user.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'group_members', filter: `user_id=eq.${user.id}` },
        () => {
          void fetchUserGroups(user.id);
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [user?.id]);

  const resolveSessionLocation = async (availableLocations: SessionLocationChoice[]): Promise<ResolvedSessionLocation> => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        return { id: null, name: t('dashboard.currentLocation') };
      }

      const currentLocation =
        await Location.getLastKnownPositionAsync()
        ?? await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });

      if (!availableLocations.length) {
        return { id: null, name: t('dashboard.currentLocation') };
      }

      let nearestLocation: SessionLocationChoice | null = null;
      let nearestDistance = Number.POSITIVE_INFINITY;

      for (const item of availableLocations) {
        const distance = getDistanceMeters(
          currentLocation.coords.latitude,
          currentLocation.coords.longitude,
          item.lat,
          item.lng,
        );

        if (distance < nearestDistance) {
          nearestLocation = item;
          nearestDistance = distance;
        }
      }

      if (nearestLocation && nearestDistance <= LOCATION_MATCH_RADIUS_METERS) {
        return {
          id: nearestLocation.id,
          name: nearestLocation.name,
          waterType: nearestLocation.water_type ?? 'other',
          distanceMeters: Math.round(nearestDistance),
        };
      }
    } catch {
      // fallback la locație generică
    }

    return { id: null, name: t('dashboard.currentLocation') };
  };

  const closeSessionLocationModal = () => {
    setSessionLocationModalVisible(false);
    setSessionLocationQuery('');
    setResolvingSessionLocation(false);
    setSuggestedSessionLocation(null);
  };

  const openSessionLocationPicker = async (mode: 'start' | 'update') => {
    if (mode === 'update' && !activeSession) return;

    setSessionLocationMode(mode);
    setSessionLocationModalVisible(true);
    setSessionLocationQuery('');
    setResolvingSessionLocation(true);

    const fallbackName = mode === 'update'
      ? activeSession?.locationName || t('dashboard.currentLocation')
      : t('dashboard.currentLocation');

    setSelectedSessionLocationId(mode === 'update' ? activeSession?.locationId ?? null : null);
    setSelectedSessionLocationName(fallbackName);

    const availableLocations = sessionLocationOptions.length ? sessionLocationOptions : await fetchSessionLocations();
    const suggestion = await resolveSessionLocation(availableLocations);
    setSuggestedSessionLocation(suggestion);

    if (mode === 'start') {
      setSelectedSessionLocationId(suggestion.id);
      setSelectedSessionLocationName(suggestion.name);
    }

    setResolvingSessionLocation(false);
  };

  const confirmSessionLocation = async () => {
    const finalLocationName = selectedSessionLocationName.trim() || t('dashboard.currentLocation');

    if (sessionLocationMode === 'update' && activeSession) {
      await updateSessionLocation(selectedSessionLocationId, finalLocationName);
      if (user?.id) {
        await syncToSupabase(user.id);
      }

      closeSessionLocationModal();
      setSuccessState({
        title: t('dashboard.sessionLocationUpdatedTitle'),
        message: t('dashboard.sessionLocationUpdatedMessage', { location: finalLocationName }),
        details: selectedSessionLocationId
          ? t('dashboard.sessionLocationUpdatedDetails')
          : t('dashboard.sessionLocationCurrentDetails'),
      });
      return;
    }

    Object.keys(castTimestamps).forEach((key) => { castTimestamps[Number(key)] = null; });
    await startSession(selectedSessionLocationId, finalLocationName);
    closeSessionLocationModal();
    setSuccessState({
      title: t('dashboard.sessionStartedTitle'),
      message: t('dashboard.sessionStartedMessage'),
      details: selectedSessionLocationId
        ? t('dashboard.sessionStartedWaterDetails', { location: finalLocationName })
        : t('dashboard.sessionStartedCurrentDetails'),
    });

    if (user?.id) {
      void syncToSupabase(user.id);
    }
  };

  const fetchWeather = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low });
      const apiKey = process.env.EXPO_PUBLIC_WEATHER_API_KEY;
      if (!apiKey) return;
      const res = await fetch(
        `https://api.openweathermap.org/data/2.5/weather?lat=${loc.coords.latitude}&lon=${loc.coords.longitude}&appid=${apiKey}&units=metric&lang=${getWeatherApiLanguage(language)}`
      );
      const data = await res.json();
      setWeather({
        temp: Math.round(data.main.temp),
        humidity: data.main.humidity,
        pressure: data.main.pressure,
        windSpeed: Math.round((data.wind?.speed ?? 0) * 3.6),
        description: data.weather?.[0]?.description ?? '',
      });
    } catch {
      // Meteo e opțional
    }
  };

  const handleRefresh = async () => {
    await Promise.all([
      fetchWeather(),
      user?.id ? loadSessionHistory() : Promise.resolve(),
    ]);
  };

  const handleStartSession = async () => {
    await openSessionLocationPicker('start');
  };

  const handleEndSession = async () => {
    Object.keys(castTimestamps).forEach((key) => { castTimestamps[Number(key)] = null; });
    await endSession();
    await loadSessionHistory();
    setSuccessState({
      title: t('dashboard.sessionEndedTitle'),
      message: t('dashboard.sessionEndedMessage'),
      details: t('dashboard.sessionEndedDetails'),
    });
  };

  const handleCast = (rodNumber: number) => {
    castTimestamps[rodNumber] = Date.now(); // salvăm timestamp local
    castRod(rodNumber);
  };

  const handleLogCatch = (rodNumber: number) => {
    setCatchModal(rodNumber);
    setCatchWeight('');
    setCatchSpecies('');
    setSelectedCatchGroupId(myGroups.length === 1 ? myGroups[0].id : null);
  };

  const confirmCatch = async () => {
    if (!catchModal) return;
    const species = catchSpecies.trim();

    if (!species) {
      setSuccessState({
        title: t('dashboard.catchSpeciesRequiredTitle'),
        message: t('dashboard.catchSpeciesRequiredMessage'),
        variant: 'warning',
      });
      return;
    }

    const weight = parseFloat(catchWeight);
    const weightPart = !isNaN(weight) && weight > 0 ? ` · ${weight} kg` : '';
    await addCatch(catchModal, {
      groupId: selectedCatchGroupId,
      fishSpecies: species,
      weightKg: !isNaN(weight) && weight > 0 ? weight : undefined,
    });

    if (user?.id) {
      await syncToSupabase(user.id);
    }

    await loadSessionHistory();

    setCatchModal(null);
    setSuccessState({
      title: t('dashboard.catchSavedTitle'),
      message: t('dashboard.catchSavedMessage', { species, weightPart, rod: catchModal }),
      details: selectedCatchGroupId
        ? t('dashboard.catchSavedDetailsGroup')
        : t('dashboard.catchSavedDetailsSolo'),
    });
  };

  const getElapsed = (rodNumber: number): number => {
    const ts = castTimestamps[rodNumber];
    if (!ts) return 0;
    return Math.floor((Date.now() - ts) / 1000);
  };

  const formatTime = (seconds: number): string => {
    if (!seconds || isNaN(seconds)) return '00:00';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const getTimerColor = (seconds: number): string => {
    if (seconds > 7200) return '#E24B4A';
    if (seconds > 3600) return '#EF9F27';
    return '#1D9E75';
  };

  const handleAddRod = () => {
    const nextRod = addRod();
    if (!nextRod) return;

    setBaitInput('');
    setHookInput('');
    setEditingRod(nextRod);
  };

  const confirmRemoveRod = async () => {
    if (!pendingRodDelete) return;

    const removed = await removeRod(pendingRodDelete);
    if (removed) {
      castTimestamps[pendingRodDelete] = null;
      setSuccessState({
        title: t('dashboard.rodRemovedTitle', { number: pendingRodDelete }),
        message: t('dashboard.rodRemovedMessage', { number: pendingRodDelete }),
        details: t('dashboard.rodRemovedDetails'),
      });
    }

    setPendingRodDelete(null);
  };

  const confirmDeleteSession = async () => {
    if (!pendingSessionDelete) return;

    const targetSession = pendingSessionDelete;
    setPendingSessionDelete(null);

    const { error } = await supabase
      .from('sessions')
      .delete()
      .eq('id', targetSession.id);

    if (error) {
      setSuccessState({
        title: t('dashboard.historyDeleteFailedTitle'),
        message: t('dashboard.historyDeleteFailedMessage'),
        details: error.message,
        variant: 'warning',
      });
      return;
    }

    if (selectedHistorySession?.id === targetSession.id) {
      setSelectedHistorySession(null);
    }

    await loadSessionHistory();
    setSuccessState({
      title: t('dashboard.historyDeleteSuccessTitle'),
      message: t('dashboard.historyDeleteSuccessMessage', { location: targetSession.locationName }),
    });
  };

  const isActive = !!activeSession;
  const fishForecast = weather ? buildFishForecast(weather, language) : [];
  const visibleRodNumbers = activeSession?.rods.map((rod) => rod.rodNumber) ?? [1];
  const filteredSessionLocationOptions = sessionLocationOptions.filter((item) => {
    const query = sessionLocationQuery.trim().toLowerCase();
    if (!query) return true;

    return item.name.toLowerCase().includes(query) || getWaterTypeLabel(item.water_type).toLowerCase().includes(query);
  });

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
      <ScrollView
        style={[styles.container, { backgroundColor: theme.background }]}
        contentContainerStyle={[styles.scroll, { paddingTop: 16 + Math.max(insets.top * 0.15, 0) }]}
        refreshControl={<RefreshControl refreshing={false} onRefresh={handleRefresh} tintColor={theme.primary} />}
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.greeting, { color: theme.text }]}>{t('dashboard.greeting', { name: profile?.username ?? t('dashboard.defaultAngler') })}</Text>
            <Text style={[styles.sessionLabel, { color: theme.textMuted }]}>
              {isActive ? t('dashboard.activeSession', { location: activeSession.locationName }) : t('dashboard.noActiveSession')}
            </Text>
            {isActive && (
              <TouchableOpacity onPress={() => void openSessionLocationPicker('update')}>
                <Text style={[styles.changeLocationLinkText, { color: theme.primary }]}>{t('dashboard.changeLocation')}</Text>
              </TouchableOpacity>
            )}
          </View>
          {isActive ? (
            <TouchableOpacity style={styles.endBtn} onPress={handleEndSession}>
              <Text style={styles.endBtnText}>{t('dashboard.end')}</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={styles.startBtn} onPress={handleStartSession}>
              <Text style={styles.startBtnText}>{t('dashboard.start')}</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Meteo */}
        {weather ? (
          <View style={[styles.weatherCard, { backgroundColor: isDark ? theme.surfaceAlt : theme.primarySoft, borderColor: isDark ? theme.border : '#9FE1CB' }]}>
            <View style={styles.weatherHeaderRow}>
              <Text style={[styles.weatherTitle, { color: isDark ? theme.text : theme.primaryStrong }]}>{t('dashboard.weatherTitle')}</Text>
              <TouchableOpacity
                style={[
                  styles.weatherForecastBtn,
                  {
                    backgroundColor: isDark ? theme.primary : '#7EDFC0',
                    borderWidth: 1,
                    borderColor: isDark ? theme.primary : '#5CCDA8',
                  },
                ]}
                onPress={() => setForecastModalVisible(true)}
              >
                <Text style={[styles.weatherForecastBtnText, { color: theme.primaryStrong }]}>{t('dashboard.weatherSpecies')}</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.weatherRow}>
              <WeatherStat icon="🌡" label={t('dashboard.weatherTemp')} value={`${weather.temp}°C`} theme={theme} />
              <WeatherStat icon="💧" label={t('dashboard.weatherHumidity')} value={`${weather.humidity}%`} theme={theme} />
              <WeatherStat icon="📊" label={t('dashboard.weatherPressure')} value={`${weather.pressure}hPa`} theme={theme} />
              <WeatherStat icon="💨" label={t('dashboard.weatherWind')} value={`${weather.windSpeed}km/h`} theme={theme} />
            </View>
            {!!weather.description && (
              <Text style={[styles.weatherDesc, { color: isDark ? theme.textMuted : theme.primary }]}>{weather.description}</Text>
            )}
            {fishForecast[0] && (
              <View style={[styles.weatherForecastPreview, { borderTopColor: isDark ? theme.border : 'rgba(8, 80, 65, 0.12)' }]}>
                <Text style={[styles.weatherForecastPreviewLabel, { color: theme.textMuted }]}>{t('dashboard.weatherTopActive')}</Text>
                <Text style={[styles.weatherForecastPreviewText, { color: isDark ? theme.text : theme.primaryStrong }]}> 
                  {fishForecast.slice(0, 3).map((item) => item.name).join(' • ')}
                </Text>
              </View>
            )}
          </View>
        ) : (
          <TouchableOpacity style={[styles.weatherEmpty, { backgroundColor: theme.surface, borderColor: theme.border }]} onPress={fetchWeather}>
            <Text style={[styles.weatherEmptyText, { color: theme.textMuted }]}>{t('dashboard.weatherTap')}</Text>
          </TouchableOpacity>
        )}

        {/* Lansete */}
        <Text style={[styles.sectionTitle, { color: theme.text }]}>{t('dashboard.rods')}</Text>

        {visibleRodNumbers.map((rodNum) => {
          const rod = activeSession?.rods.find((r) => r.rodNumber === rodNum);
          const elapsed = getElapsed(rodNum);
          const hasCast = castTimestamps[rodNum] !== null;

          return (
            <View key={rodNum} style={[styles.rodCard, { backgroundColor: theme.surface, borderColor: theme.borderSoft }, !isActive && styles.rodCardDisabled]}>
              {/* Header lansetă */}
              <View style={styles.rodHeader}>
                <View style={styles.rodHeaderMain}>
                  <View style={[styles.rodBadge, { backgroundColor: isActive ? '#1D9E75' : '#ccc' }]}> 
                    <Text style={styles.rodBadgeText}>{rodNum}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.rodTitle, { color: theme.text }]}>{t('dashboard.rod', { number: rodNum })}</Text>
                    {rod?.baitName ? (
                      <Text style={[styles.rodBait, { color: theme.textMuted }]}>🪱 {rod.baitName}</Text>
                    ) : isActive ? (
                      <TouchableOpacity onPress={() => {
                        setBaitInput('');
                        setHookBaitInput('');
                        setHookInput('');
                        setEditingRod(rodNum);
                      }}>
                        <Text style={[styles.rodBaitEmpty, { color: theme.primary }]}>{t('dashboard.addBait')}</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                </View>
                {isActive && (activeSession?.rods.length ?? 0) > 1 && (
                  <TouchableOpacity
                    style={[styles.rodHeaderDeleteBtn, { backgroundColor: isDark ? theme.dangerSoft : '#FFF1F1', borderColor: isDark ? theme.dangerText : '#F4CACA' }]}
                    onPress={() => setPendingRodDelete(rodNum)}
                  >
                    <Text style={[styles.rodHeaderDeleteText, { color: theme.dangerText }]}>{t('common.delete')}</Text>
                  </TouchableOpacity>
                )}
              </View>

              {/* Cronometru + statistici */}
              <View style={styles.timerRow}>
                <View>
                  <Text style={[styles.timerLabel, { color: theme.textSoft }]}>{t('dashboard.lastCast')}</Text>
                  <Text style={[styles.timerValue, { color: hasCast ? getTimerColor(elapsed) : '#ccc' }]}>
                    {hasCast ? formatTime(elapsed) : '--:--'}
                  </Text>
                </View>
                <View style={styles.statsCol}>
                  <View style={[styles.statBadge, { backgroundColor: theme.surfaceAlt }]}>
                    <Text style={styles.statIcon}>🪃</Text>
                    <Text style={[styles.statNum, { color: theme.text }]}>{rod?.castCount ?? 0}</Text>
                    <Text style={[styles.statLabel, { color: theme.textSoft }]}>{t('dashboard.castCount')}</Text>
                  </View>
                  <View style={[styles.statBadge, { backgroundColor: theme.surfaceAlt }]}>
                    <Text style={styles.statIcon}>🐟</Text>
                    <Text style={[styles.statNum, { color: theme.text }]}>{rod?.catchCount ?? 0}</Text>
                    <Text style={[styles.statLabel, { color: theme.textSoft }]}>{t('dashboard.catchCount')}</Text>
                  </View>
                </View>
              </View>

              {/* Montură */}
              {rod?.hookSetup ? (
                <Text style={[styles.hookText, { color: theme.textMuted }]}>🪝 {rod.hookSetup}</Text>
              ) : null}
              {rod?.hookBait ? (
                <Text style={[styles.hookText, { color: theme.textMuted }]}>{t('dashboard.hookBaitInline', { value: rod.hookBait })}</Text>
              ) : null}

              {/* Butoane */}
              {isActive && (
                <View style={styles.rodActions}>
                  <TouchableOpacity
                    style={[
                      styles.castBtn,
                      {
                        backgroundColor: isDark ? theme.surfaceAlt : '#EEF6FF',
                        borderColor: isDark ? theme.primary : '#B5D4F4',
                      },
                    ]}
                    onPress={() => handleCast(rodNum)}
                  >
                    <View style={styles.actionLabelRow}>
                      <Text style={styles.actionIcon}>🪃</Text>
                      <Text style={[styles.castBtnText, { color: isDark ? theme.text : '#185FA5' }]}>{t('dashboard.cast')}</Text>
                    </View>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.catchBtn,
                      {
                        backgroundColor: isDark ? theme.primarySoft : '#E1F5EE',
                        borderColor: isDark ? theme.primary : '#9FE1CB',
                      },
                    ]}
                    onPress={() => handleLogCatch(rodNum)}
                  >
                    <Text style={[styles.catchBtnText, { color: isDark ? theme.text : '#085041' }]}>{t('dashboard.catch')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.editBtn, { backgroundColor: isDark ? theme.surfaceAlt : '#f5f5f5' }]} onPress={() => {
                    setBaitInput(rod?.baitName ?? '');
                    setHookBaitInput(rod?.hookBait ?? '');
                    setHookInput(rod?.hookSetup ?? '');
                    setEditingRod(rodNum);
                  }}>
                    <Text style={[styles.editBtnText, { color: isDark ? theme.text : '#1a1a1a' }]}>✏️</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          );
        })}

        {isActive && (activeSession?.rods.length ?? 0) < 10 && (
          <View style={[styles.addRodCard, { backgroundColor: theme.surface, borderColor: theme.borderSoft }]}>
            <Text style={[styles.addRodText, { color: theme.text }]}>{t('dashboard.addRodDetails')}</Text>
            <TouchableOpacity style={[styles.addRodButton, { backgroundColor: theme.primary }]} onPress={handleAddRod}>
              <Text style={styles.addRodButtonText}>{t('dashboard.addRod')}</Text>
            </TouchableOpacity>
          </View>
        )}

        {!isActive && (
          <View style={styles.noSessionBanner}>
            <Text style={[styles.noSessionText, { color: theme.textSoft }]}>{t('dashboard.startToActivate')}</Text>
          </View>
        )}

        <View style={[styles.historyCard, { backgroundColor: theme.surface, borderColor: theme.borderSoft }]}> 
          <View style={styles.historyHeaderRow}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.historyTitle, { color: theme.text }]}>{t('dashboard.historyTitle')}</Text>
              <Text style={[styles.historySubtitle, { color: theme.textMuted }]}>{t('dashboard.historySubtitle')}</Text>
            </View>
            <TouchableOpacity
              style={[styles.historyButton, { backgroundColor: theme.primary }]}
              onPress={() => setHistoryModalVisible(true)}
            >
              <Text style={styles.historyButtonText}>{t('dashboard.historyButton')}</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.historyQuickStatsRow}>
            <View style={[styles.historyQuickStat, { backgroundColor: theme.surfaceAlt }]}> 
              <Text style={[styles.historyQuickValue, { color: theme.text }]}>{totalHistorySessions}</Text>
              <Text style={[styles.historyQuickLabel, { color: theme.textSoft }]}>{t('dashboard.historySessionsCount')}</Text>
            </View>
            <View style={[styles.historyQuickStat, { backgroundColor: theme.surfaceAlt }]}> 
              <Text style={[styles.historyQuickValue, { color: theme.text }]}>{sessionHistory.reduce((sum, item) => sum + item.totalCatches, 0)}</Text>
              <Text style={[styles.historyQuickLabel, { color: theme.textSoft }]}>{t('dashboard.historyTotalCatches')}</Text>
            </View>
          </View>

          {historyLoading ? (
            <View style={styles.historyLoadingBox}>
              <ActivityIndicator color={theme.primary} />
              <Text style={[styles.historyLoadingText, { color: theme.textMuted }]}>{t('dashboard.historyLoading')}</Text>
            </View>
          ) : sessionHistory.length === 0 ? (
            <Text style={[styles.historyEmpty, { color: theme.textSoft }]}>{t('dashboard.historyEmpty')}</Text>
          ) : (
            <Text style={[styles.historyHint, { color: theme.textMuted }]}>{t('dashboard.historyLatestHint', { count: sessionHistory.length })}</Text>
          )}
        </View>

        <View style={{ height: 32 }} />
      </ScrollView>

      {/* Modal editare nadă */}
      <Modal visible={editingRod !== null} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: theme.surface }]}> 
            <Text style={[styles.modalTitle, { color: theme.text }]}>{t('dashboard.rodEditTitle', { number: editingRod ?? '' })}</Text>
            <Text style={[styles.modalSub, { color: theme.textMuted }]}>{t('dashboard.rodEditSubtitle')}</Text>
            <Text style={[styles.modalLabel, { color: theme.textMuted }]}>{t('dashboard.baitType')}</Text>
            <TextInput
              style={[styles.modalInput, { borderColor: theme.border, color: theme.text, backgroundColor: theme.inputBg }]}
              placeholder={t('dashboard.baitPlaceholder')}
              placeholderTextColor={theme.textSoft}
              value={baitInput}
              onChangeText={setBaitInput}
              returnKeyType="next"
            />
            <Text style={[styles.modalLabel, { color: theme.textMuted }]}>{t('dashboard.hookBaitType')}</Text>
            <TextInput
              style={[styles.modalInput, { borderColor: theme.border, color: theme.text, backgroundColor: theme.inputBg }]}
              placeholder={t('dashboard.hookBaitPlaceholder')}
              placeholderTextColor={theme.textSoft}
              value={hookBaitInput}
              onChangeText={setHookBaitInput}
              returnKeyType="next"
            />
            <Text style={[styles.modalLabel, { color: theme.textMuted }]}>{t('dashboard.hookSetup')}</Text>
            <TextInput
              style={[styles.modalInput, { borderColor: theme.border, color: theme.text, backgroundColor: theme.inputBg }]}
              placeholder={t('dashboard.hookPlaceholder')}
              placeholderTextColor={theme.textSoft}
              value={hookInput}
              onChangeText={setHookInput}
              returnKeyType="done"
            />
            <View style={styles.modalActions}>
              <TouchableOpacity style={[styles.modalCancel, { borderColor: theme.border }]} onPress={() => setEditingRod(null)}>
                <Text style={[styles.modalCancelText, { color: theme.textMuted }]}>{t('common.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalConfirm, { backgroundColor: theme.primary }]} onPress={async () => {
                if (editingRod) {
                  await saveRodSetup(editingRod, { baitName: baitInput, hookBait: hookBaitInput, hookSetup: hookInput }, user?.id);
                  await loadSessionHistory();
                }
                setEditingRod(null);
              }}>
                <Text style={styles.modalConfirmText}>{t('common.save')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modal captură */}
      <Modal visible={catchModal !== null} transparent animationType="slide" onRequestClose={() => setCatchModal(null)}>
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={Platform.OS === 'ios' ? 24 : 0}>
          <View style={[styles.modalCard, { backgroundColor: theme.surface }]}> 
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={styles.modalScrollContent}>
            <Text style={[styles.modalTitle, { color: theme.text }]}>{t('dashboard.newCatchTitle')}</Text>
            <Text style={[styles.modalSub, { color: theme.textMuted }]}>{t('dashboard.rod', { number: catchModal ?? '' })}</Text>
            <Text style={[styles.modalLabel, { color: theme.textMuted }]}>{t('dashboard.fishSpecies')}</Text>
            <TextInput
              style={[styles.modalInput, { borderColor: theme.border, color: theme.text, backgroundColor: theme.inputBg }]}
              placeholder={t('dashboard.fishSpeciesPlaceholder')}
              placeholderTextColor={theme.textSoft}
              value={catchSpecies}
              onChangeText={setCatchSpecies}
              returnKeyType="next"
            />
            <Text style={[styles.modalLabel, { color: theme.textMuted }]}>{t('dashboard.weightKg')}</Text>
            <TextInput
              style={[styles.modalInput, { borderColor: theme.border, color: theme.text, backgroundColor: theme.inputBg }]}
              placeholder={t('dashboard.weightPlaceholder')}
              placeholderTextColor={theme.textSoft}
              value={catchWeight}
              onChangeText={setCatchWeight}
              keyboardType="decimal-pad"
              returnKeyType="done"
            />
            {myGroups.length > 0 && (
              <>
                <Text style={[styles.modalLabel, { color: theme.textMuted }]}>{t('dashboard.sendCatchToGroup')}</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.groupSelectorRow}>
                  <TouchableOpacity
                    style={[styles.groupChip, { backgroundColor: theme.surfaceAlt, borderColor: theme.border }, selectedCatchGroupId === null && styles.groupChipActive, selectedCatchGroupId === null && { backgroundColor: theme.primary, borderColor: theme.primary }]}
                    onPress={() => setSelectedCatchGroupId(null)}
                  >
                    <Text style={[styles.groupChipText, { color: theme.textMuted }, selectedCatchGroupId === null && styles.groupChipTextActive]}>{t('dashboard.noGroup')}</Text>
                  </TouchableOpacity>
                  {myGroups.map((group) => (
                    <TouchableOpacity
                      key={group.id}
                      style={[styles.groupChip, { backgroundColor: theme.surfaceAlt, borderColor: theme.border }, selectedCatchGroupId === group.id && styles.groupChipActive, selectedCatchGroupId === group.id && { backgroundColor: theme.primary, borderColor: theme.primary }]}
                      onPress={() => setSelectedCatchGroupId(group.id)}
                    >
                      <Text style={[styles.groupChipText, { color: theme.textMuted }, selectedCatchGroupId === group.id && styles.groupChipTextActive]} numberOfLines={1}>
                        {group.name}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </>
            )}
            <View style={styles.modalActions}>
              <TouchableOpacity style={[styles.modalCancel, { borderColor: theme.border }]} onPress={() => setCatchModal(null)}>
                <Text style={[styles.modalCancelText, { color: theme.textMuted }]}>{t('common.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalConfirm, { backgroundColor: theme.primary }]} onPress={confirmCatch}>
                <Text style={styles.modalConfirmText}>{t('dashboard.saveWithCheck')}</Text>
              </TouchableOpacity>
            </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={sessionLocationModalVisible} transparent animationType="slide" onRequestClose={closeSessionLocationModal}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: theme.surface }]}> 
            <Text style={[styles.modalTitle, { color: theme.text }]}>{t('dashboard.locationPickerTitle')}</Text>
            <Text style={[styles.modalSub, { color: theme.textMuted }]}>
              {t(sessionLocationMode === 'start' ? 'dashboard.locationPickerSubtitleStart' : 'dashboard.locationPickerSubtitleUpdate')}
            </Text>

            {resolvingSessionLocation ? (
              <View style={styles.sessionLocationLoadingBox}>
                <ActivityIndicator color={theme.primary} />
                <Text style={[styles.historyLoadingText, { color: theme.textMuted }]}>{t('dashboard.locationPickerDetecting')}</Text>
              </View>
            ) : (
              <>
                {suggestedSessionLocation?.id ? (
                  <View style={[styles.sessionLocationSuggestionCard, { backgroundColor: theme.surfaceAlt, borderColor: theme.borderSoft }]}> 
                    <Text style={[styles.sessionLocationSectionLabel, { color: theme.textMuted }]}>{t('dashboard.locationPickerSuggested')}</Text>
                    <TouchableOpacity
                      style={[
                        styles.sessionLocationRow,
                        { backgroundColor: theme.inputBg, borderColor: theme.border },
                        selectedSessionLocationId === suggestedSessionLocation.id && { borderColor: theme.primary, backgroundColor: isDark ? theme.surfaceAlt : theme.primarySoft },
                      ]}
                      onPress={() => {
                        setSelectedSessionLocationId(suggestedSessionLocation.id);
                        setSelectedSessionLocationName(suggestedSessionLocation.name);
                      }}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.sessionLocationTitle, { color: theme.text }]}>{suggestedSessionLocation.name}</Text>
                        <Text style={[styles.sessionLocationMeta, { color: theme.textMuted }]}>
                          {getWaterTypeLabel(suggestedSessionLocation.waterType)} · {t('dashboard.locationPickerDistance', { value: suggestedSessionLocation.distanceMeters ?? 0 })}
                        </Text>
                      </View>
                      <View style={[styles.sessionLocationBadge, { backgroundColor: theme.primarySoft }]}> 
                        <Text style={[styles.sessionLocationBadgeText, { color: isDark ? theme.text : theme.primaryStrong }]}>{t('dashboard.locationPickerSuggestedBadge')}</Text>
                      </View>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <Text style={[styles.sessionLocationEmptyHint, { color: theme.textSoft }]}>{t('dashboard.locationPickerNoSuggestion')}</Text>
                )}

                <TextInput
                  style={[styles.modalInput, { borderColor: theme.border, color: theme.text, backgroundColor: theme.inputBg }]}
                  placeholder={t('dashboard.locationPickerSearchPlaceholder')}
                  placeholderTextColor={theme.textSoft}
                  value={sessionLocationQuery}
                  onChangeText={setSessionLocationQuery}
                />

                <TouchableOpacity
                  style={[
                    styles.sessionLocationRow,
                    { backgroundColor: theme.inputBg, borderColor: theme.border },
                    selectedSessionLocationId === null && { borderColor: theme.primary, backgroundColor: isDark ? theme.surfaceAlt : theme.primarySoft },
                  ]}
                  onPress={() => {
                    setSelectedSessionLocationId(null);
                    setSelectedSessionLocationName(t('dashboard.currentLocation'));
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.sessionLocationTitle, { color: theme.text }]}>{t('dashboard.locationPickerUseCurrent')}</Text>
                    <Text style={[styles.sessionLocationMeta, { color: theme.textMuted }]}>{t('dashboard.locationPickerUseCurrentHint')}</Text>
                  </View>
                </TouchableOpacity>

                <ScrollView style={styles.sessionLocationList} nestedScrollEnabled>
                  {filteredSessionLocationOptions.map((item) => {
                    const isSelected = selectedSessionLocationId === item.id;
                    const isSuggested = suggestedSessionLocation?.id === item.id;

                    return (
                      <TouchableOpacity
                        key={item.id}
                        style={[
                          styles.sessionLocationRow,
                          { backgroundColor: theme.inputBg, borderColor: theme.border },
                          isSelected && { borderColor: theme.primary, backgroundColor: isDark ? theme.surfaceAlt : theme.primarySoft },
                        ]}
                        onPress={() => {
                          setSelectedSessionLocationId(item.id);
                          setSelectedSessionLocationName(item.name);
                        }}
                      >
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.sessionLocationTitle, { color: theme.text }]}>{item.name}</Text>
                          <Text style={[styles.sessionLocationMeta, { color: theme.textMuted }]}>{getWaterTypeLabel(item.water_type)}</Text>
                        </View>
                        {isSuggested && (
                          <View style={[styles.sessionLocationBadge, { backgroundColor: theme.primarySoft }]}> 
                            <Text style={[styles.sessionLocationBadgeText, { color: isDark ? theme.text : theme.primaryStrong }]}>{t('dashboard.locationPickerSuggestedBadge')}</Text>
                          </View>
                        )}
                      </TouchableOpacity>
                    );
                  })}

                  {filteredSessionLocationOptions.length === 0 && (
                    <Text style={[styles.sessionLocationEmptyHint, { color: theme.textSoft }]}>{t('dashboard.locationPickerEmpty')}</Text>
                  )}
                </ScrollView>
              </>
            )}

            <View style={styles.modalActions}>
              <TouchableOpacity style={[styles.modalCancel, { borderColor: theme.border }]} onPress={closeSessionLocationModal}>
                <Text style={[styles.modalCancelText, { color: theme.textMuted }]}>{t('common.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalConfirm, { backgroundColor: theme.primary }, resolvingSessionLocation && { opacity: 0.7 }]}
                onPress={confirmSessionLocation}
                disabled={resolvingSessionLocation}
              >
                <Text style={styles.modalConfirmText}>
                  {t(sessionLocationMode === 'start' ? 'dashboard.locationPickerConfirmStart' : 'dashboard.locationPickerConfirmUpdate')}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={forecastModalVisible} animationType="slide">
        <SafeAreaView style={[styles.forecastSafe, { backgroundColor: theme.background }]}> 
          <View style={[styles.forecastHeader, { backgroundColor: theme.surface, borderBottomColor: theme.borderSoft }]}> 
            <TouchableOpacity onPress={() => setForecastModalVisible(false)}>
              <Text style={[styles.forecastBack, { color: theme.primary }]}>‹ {t('dashboard.forecastBack')}</Text>
            </TouchableOpacity>
            <Text style={[styles.forecastTitle, { color: theme.text }]}>{t('dashboard.forecastTitle')}</Text>
            <View style={{ width: 60 }} />
          </View>

          <ScrollView contentContainerStyle={styles.forecastScroll}>
            <View style={styles.forecastHero}>
              <Text style={styles.forecastHeroEyebrow}>{t('dashboard.forecastEyebrow')}</Text>
              <Text style={styles.forecastHeroTitle}>{t('dashboard.forecastHeroTitle')}</Text>
              <Text style={styles.forecastHeroText}>{t('dashboard.forecastHeroText')}</Text>
            </View>

            {weather && (
              <View style={[styles.forecastWeatherStrip, { backgroundColor: theme.surface, borderColor: theme.border }]}> 
                <Text style={[styles.forecastWeatherStripText, { color: theme.textMuted }]}>
                  {weather.temp}°C · {weather.windSpeed} km/h · {weather.pressure} hPa{weather.description ? ` · ${weather.description}` : ''}
                </Text>
              </View>
            )}

            {fishForecast.map((item, index) => (
              <View key={item.id} style={[styles.forecastCard, { backgroundColor: theme.surface, borderColor: theme.border }]}> 
                <View style={styles.forecastRankCol}>
                  <Text style={[styles.forecastRank, { color: isDark ? theme.text : theme.primaryStrong }]}>#{index + 1}</Text>
                  <View
                    style={[
                      styles.forecastChancePill,
                      {
                        backgroundColor: isDark ? theme.primarySoft : theme.primarySoft,
                        borderWidth: 1,
                        borderColor: isDark ? theme.primary : 'transparent',
                      },
                    ]}
                  > 
                    <Text style={[styles.forecastChanceText, { color: isDark ? theme.text : theme.primaryStrong }]}>{item.chance}%</Text>
                  </View>
                </View>

                <View style={styles.forecastBody}>
                  <View style={styles.forecastNameRow}>
                    <Text style={[styles.forecastFishName, { color: theme.text }]}>{item.name}</Text>
                    <View style={[styles.forecastBadge, { backgroundColor: theme.badgeBg }]}> 
                      <Text style={[styles.forecastBadgeText, { color: theme.badgeText }]}>{item.badge}</Text>
                    </View>
                  </View>
                  <Text style={[styles.forecastSubtitle, { color: theme.textMuted }]}>{item.subtitle}</Text>
                  <Text style={[styles.forecastReason, { color: theme.text }]}>{t('dashboard.forecastReason', { value: item.why })}</Text>
                  <Text style={[styles.forecastTip, { color: isDark ? theme.textMuted : theme.primaryStrong }]}>{t('dashboard.forecastTip', { value: item.tip })}</Text>
                </View>
              </View>
            ))}
          </ScrollView>
        </SafeAreaView>
      </Modal>

      <Modal visible={historyModalVisible} animationType="slide">
        <SafeAreaView style={[styles.forecastSafe, { backgroundColor: theme.background }]}> 
          <View style={[styles.forecastHeader, { backgroundColor: theme.surface, borderBottomColor: theme.borderSoft }]}> 
            <TouchableOpacity onPress={() => setHistoryModalVisible(false)}>
              <Text style={[styles.forecastBack, { color: theme.primary }]}>‹ {t('common.close')}</Text>
            </TouchableOpacity>
            <Text style={[styles.forecastTitle, { color: theme.text }]}>{t('dashboard.historyTitle')}</Text>
            <View style={{ width: 60 }} />
          </View>

          <ScrollView contentContainerStyle={styles.historyModalScroll}>
            {historyLoading ? (
              <View style={styles.historyLoadingBox}>
                <ActivityIndicator color={theme.primary} />
                <Text style={[styles.historyLoadingText, { color: theme.textMuted }]}>{t('dashboard.historyLoading')}</Text>
              </View>
            ) : sessionHistory.length === 0 ? (
              <View style={[styles.historyEmptyCard, { backgroundColor: theme.surface, borderColor: theme.border }]}> 
                <Text style={[styles.historyEmpty, { color: theme.textSoft }]}>{t('dashboard.historyEmpty')}</Text>
              </View>
            ) : (
              sessionHistory.map((session) => {
                return (
                  <View key={session.id} style={[styles.historySessionCard, { backgroundColor: theme.surface, borderColor: theme.border }]}> 
                    <View style={styles.historySessionTopRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.historySessionTitle, { color: theme.text }]}>{t('dashboard.historySessionAt', { location: session.locationName })}</Text>
                        <Text style={[styles.historySessionMeta, { color: theme.textMuted }]}>
                          {formatDateTime(language, session.startedAt)}
                        </Text>
                        <Text style={[styles.historySessionMeta, { color: theme.textSoft }]}>
                          {t('dashboard.historyDuration', { value: formatSessionDuration(session.startedAt, session.endedAt) })}
                        </Text>
                      </View>
                      <View style={styles.historyCardActions}>
                        <TouchableOpacity
                          style={[styles.historyDetailsToggle, { backgroundColor: theme.primary }]}
                          onPress={() => setSelectedHistorySession(session)}
                        >
                          <Text style={[styles.historyDetailsToggleText, { color: '#fff' }]}> 
                            {t('dashboard.historyOpenDetails')}
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.historyDeleteToggle, { backgroundColor: isDark ? theme.dangerSoft : '#FFF1F1', borderColor: isDark ? theme.dangerText : '#F4CACA' }]}
                          onPress={() => setPendingSessionDelete(session)}
                        >
                          <Text style={[styles.historyDeleteToggleText, { color: theme.dangerText }]}>{t('common.delete')}</Text>
                        </TouchableOpacity>
                      </View>
                    </View>

                    <View style={styles.historyMetricsRow}>
                      <View style={[styles.historyMetricCard, { backgroundColor: theme.surfaceAlt }]}> 
                        <Text style={[styles.historyMetricValue, { color: theme.text }]}>{session.totalCasts}</Text>
                        <Text style={[styles.historyMetricLabel, { color: theme.textSoft }]}>{t('dashboard.historyTotalCasts')}</Text>
                      </View>
                      <View style={[styles.historyMetricCard, { backgroundColor: theme.surfaceAlt }]}> 
                        <Text style={[styles.historyMetricValue, { color: theme.text }]}>{session.totalCatches}</Text>
                        <Text style={[styles.historyMetricLabel, { color: theme.textSoft }]}>{t('dashboard.historyTotalCatches')}</Text>
                      </View>
                      <View style={[styles.historyMetricCard, { backgroundColor: theme.surfaceAlt }]}> 
                        <Text style={[styles.historyMetricValue, { color: theme.text }]}>{session.totalWeight.toFixed(1)}kg</Text>
                        <Text style={[styles.historyMetricLabel, { color: theme.textSoft }]}>{t('dashboard.historyTotalWeight')}</Text>
                      </View>
                    </View>

                    <Text style={[styles.historySectionLabel, { color: theme.textMuted }]}>{t('dashboard.historyUsedBaits')}</Text>
                    <View style={styles.historyBaitsRow}>
                      {session.baitsUsed.length > 0 ? session.baitsUsed.map((bait) => (
                        <View key={`${session.id}-${bait}`} style={[styles.historyBaitChip, { backgroundColor: theme.primarySoft, borderColor: theme.border }]}> 
                          <Text style={[styles.historyBaitChipText, { color: theme.text }]}>{bait}</Text>
                        </View>
                      )) : (
                        <Text style={[styles.historySessionMeta, { color: theme.textSoft }]}>{t('dashboard.historyNoBaits')}</Text>
                      )}
                    </View>
                  </View>
                );
              })
            )}
          </ScrollView>
        </SafeAreaView>
      </Modal>

      <Modal visible={!!selectedHistorySession} animationType="slide">
        <SafeAreaView style={[styles.forecastSafe, { backgroundColor: theme.background }]}> 
          <View style={[styles.forecastHeader, { backgroundColor: theme.surface, borderBottomColor: theme.borderSoft }]}> 
            <TouchableOpacity onPress={() => setSelectedHistorySession(null)}>
              <Text style={[styles.forecastBack, { color: theme.primary }]}>‹ {t('dashboard.forecastBack')}</Text>
            </TouchableOpacity>
            <Text style={[styles.forecastTitle, { color: theme.text }]}>{t('dashboard.historyDetailTitle')}</Text>
            <View style={{ width: 60 }} />
          </View>

          {selectedHistorySession && (
            <ScrollView contentContainerStyle={styles.historyDetailScroll}>
              <View style={[styles.historyDetailHero, { backgroundColor: theme.surface, borderColor: theme.borderSoft }]}> 
                <Text style={[styles.historyDetailEyebrow, { color: theme.textSoft }]}>{t('dashboard.historySessionAt', { location: selectedHistorySession.locationName })}</Text>
                <Text style={[styles.historyDetailTitle, { color: theme.text }]}>{formatDateTime(language, selectedHistorySession.startedAt)}</Text>
                <Text style={[styles.historyDetailSub, { color: theme.textMuted }]}>{t('dashboard.historyDuration', { value: formatSessionDuration(selectedHistorySession.startedAt, selectedHistorySession.endedAt) })}</Text>

                <TouchableOpacity
                  style={[styles.historyDetailDeleteButton, { backgroundColor: isDark ? theme.dangerSoft : '#FFF1F1', borderColor: isDark ? theme.dangerText : '#F4CACA' }]}
                  onPress={() => setPendingSessionDelete(selectedHistorySession)}
                >
                  <Text style={[styles.historyDetailDeleteText, { color: theme.dangerText }]}>{t('dashboard.historyDeleteAction')}</Text>
                </TouchableOpacity>

                <View style={styles.historyMetricsRow}>
                  <View style={[styles.historyMetricCard, { backgroundColor: theme.surfaceAlt }]}> 
                    <Text style={[styles.historyMetricValue, { color: theme.text }]}>{selectedHistorySession.totalCasts}</Text>
                    <Text style={[styles.historyMetricLabel, { color: theme.textSoft }]}>{t('dashboard.historyTotalCasts')}</Text>
                  </View>
                  <View style={[styles.historyMetricCard, { backgroundColor: theme.surfaceAlt }]}> 
                    <Text style={[styles.historyMetricValue, { color: theme.text }]}>{selectedHistorySession.totalCatches}</Text>
                    <Text style={[styles.historyMetricLabel, { color: theme.textSoft }]}>{t('dashboard.historyTotalCatches')}</Text>
                  </View>
                  <View style={[styles.historyMetricCard, { backgroundColor: theme.surfaceAlt }]}> 
                    <Text style={[styles.historyMetricValue, { color: theme.text }]}>{selectedHistorySession.totalWeight.toFixed(1)}kg</Text>
                    <Text style={[styles.historyMetricLabel, { color: theme.textSoft }]}>{t('dashboard.historyTotalWeight')}</Text>
                  </View>
                </View>
              </View>

              {selectedHistorySession.rods.map((rod) => {
                const rodSetupHistory = selectedHistorySession.setupHistory.filter((item) => item.rod_number === rod.rod_number);
                const rodCatches = selectedHistorySession.catches.filter((item) => item.rod_id === rod.id).sort((left, right) => new Date(right.caught_at).getTime() - new Date(left.caught_at).getTime());
                const fallbackBait = rod.bait_custom?.trim();
                const fallbackHookBait = rod.hook_bait?.trim();
                const fallbackHook = rod.hook_setup?.trim();

                return (
                  <View key={rod.id} style={[styles.historyRodDetailCard, { backgroundColor: theme.surface, borderColor: theme.borderSoft }]}> 
                    <View style={styles.historyRodHeader}>
                      <Text style={[styles.historyRodTitle, { color: theme.text }]}>{t('dashboard.historyRodSummary', { number: rod.rod_number })}</Text>
                      <Text style={[styles.historyRodMeta, { color: theme.textMuted }]}>{rod.cast_count} {t('dashboard.castCount')} · {rod.catch_count} {t('dashboard.catchCount')}</Text>
                    </View>

                    <View style={[styles.historyTimelineSection, { backgroundColor: isDark ? theme.surfaceAlt : theme.primarySoft, borderColor: isDark ? theme.border : theme.borderSoft }]}> 
                      <Text style={[styles.historySectionLabel, { color: isDark ? theme.text : theme.primaryStrong }]}>{t('dashboard.historyBaitTimelineTitle')}</Text>
                      <Text style={[styles.historySectionHint, { color: theme.textMuted }]}>{t('dashboard.historyBaitTimelineHint')}</Text>
                      {rodSetupHistory.length > 0 ? rodSetupHistory.map((entry) => (
                        <View key={entry.id} style={[styles.historyTimelineRow, styles.historySetupRow, { borderTopColor: theme.borderSoft, borderLeftColor: isDark ? theme.primary : 'rgba(29,158,117,0.35)' }]}> 
                          <Text style={[styles.historyTimelineTime, { color: isDark ? theme.primary : theme.primaryStrong }]}>{formatDateTime(language, entry.created_at)}</Text>
                          <Text style={[styles.historyTimelineTitle, { color: theme.text }]}>{entry.bait_name?.trim() || t('dashboard.historyNoBaitValue')}</Text>
                          <Text style={[styles.historyTimelineMeta, { color: theme.textMuted }]}>{t('dashboard.historyHookBait', { value: entry.hook_bait?.trim() || t('dashboard.historyNoHookBaitValue') })}</Text>
                          <Text style={[styles.historyTimelineMeta, { color: theme.textMuted }]}>{t('dashboard.historyHook', { value: entry.hook_setup?.trim() || t('dashboard.historyNoHookValue') })}</Text>
                        </View>
                      )) : (
                        <View style={[styles.historyFallbackBox, { backgroundColor: theme.surface, borderColor: theme.borderSoft }]}> 
                          {fallbackBait || fallbackHookBait || fallbackHook ? (
                            <>
                              {fallbackBait ? <Text style={[styles.historyFallbackText, { color: theme.textMuted }]}>{t('dashboard.historyBait', { value: fallbackBait })}</Text> : null}
                              {fallbackHookBait ? <Text style={[styles.historyFallbackText, { color: theme.textMuted }]}>{t('dashboard.historyHookBait', { value: fallbackHookBait })}</Text> : null}
                              {fallbackHook ? <Text style={[styles.historyFallbackText, { color: theme.textMuted }]}>{t('dashboard.historyHook', { value: fallbackHook })}</Text> : null}
                            </>
                          ) : (
                            <Text style={[styles.historyFallbackText, { color: theme.textMuted }]}>{t('dashboard.historyNoBaits')}</Text>
                          )}
                        </View>
                      )}
                    </View>

                    <View style={[styles.historyTimelineSection, styles.historyCatchSection, { backgroundColor: theme.surfaceAlt, borderColor: theme.borderSoft }]}> 
                      <Text style={[styles.historySectionLabel, { color: theme.text }]}>{t('dashboard.historyCatchesTitle')}</Text>
                      <Text style={[styles.historySectionHint, { color: theme.textMuted }]}>{t('dashboard.historyCatchTimelineHint')}</Text>
                      {rodCatches.length > 0 ? rodCatches.map((item) => {
                        const fishName = item.fish_species?.trim() || t('dashboard.historyUnknownSpecies');
                        const fishWeight = item.weight_kg ? ` · ${Number(item.weight_kg).toFixed(2)} kg` : '';
                        const catchSetup = findSetupForCatch(item.caught_at, rod, rodSetupHistory);
                        const catchSetupLabel = catchSetup.bait
                          ? t('dashboard.historyCatchSetup', { bait: catchSetup.bait, hookBait: catchSetup.hookBait || t('dashboard.historyNoHookBaitValue'), hook: catchSetup.hook || t('dashboard.historyNoHookValue') })
                          : t('dashboard.historyCatchNoSetup');

                        return (
                          <View key={item.id} style={[styles.historyTimelineRow, styles.historyCatchDetailRow, { borderTopColor: theme.border }]}> 
                            <Text style={[styles.historyTimelineTime, { color: theme.textSoft }]}>{formatDateTime(language, item.caught_at)}</Text>
                            <Text style={[styles.historyTimelineTitle, { color: theme.text }]}>{`${fishName}${fishWeight}`}</Text>
                            <Text style={[styles.historyTimelineMeta, { color: isDark ? theme.text : theme.textMuted }]}>{t('dashboard.historyCatchMeta', { rod: rod.rod_number, time: formatDateTime(language, item.caught_at) })}</Text>
                            <Text style={[styles.historyTimelineMeta, { color: isDark ? theme.text : theme.textMuted }]}>{catchSetupLabel}</Text>
                          </View>
                        );
                      }) : (
                        <Text style={[styles.historySessionMeta, { color: theme.textSoft }]}>{t('dashboard.historyNoRodCatches')}</Text>
                      )}
                    </View>
                  </View>
                );
              })}
            </ScrollView>
          )}
        </SafeAreaView>
      </Modal>

      <SuccessSheet
        visible={!!successState}
        title={successState?.title ?? ''}
        message={successState?.message ?? ''}
        details={successState?.details}
        variant={successState?.variant ?? 'success'}
        onClose={() => setSuccessState(null)}
      />

      <ConfirmActionSheet
        visible={pendingRodDelete !== null}
        title={t('dashboard.removeRodTitle', { number: pendingRodDelete ?? '' })}
        message={t('dashboard.removeRodMessage', { number: pendingRodDelete ?? '' })}
        confirmLabel={t('dashboard.removeRodConfirm')}
        onConfirm={confirmRemoveRod}
        onClose={() => setPendingRodDelete(null)}
      />

      <ConfirmActionSheet
        visible={pendingSessionDelete !== null}
        title={t('dashboard.historyDeleteTitle')}
        message={t('dashboard.historyDeletePrompt', { location: pendingSessionDelete?.locationName ?? '' })}
        confirmLabel={t('dashboard.historyDeleteAction')}
        onConfirm={confirmDeleteSession}
        onClose={() => setPendingSessionDelete(null)}
      />
    </SafeAreaView>
  );
}

function WeatherStat({ icon, label, value, theme }: { icon: string; label: string; value: string; theme: ReturnType<typeof getAppTheme> }) {
  const isDark = theme.text === '#eef4f6';

  return (
    <View style={{ alignItems: 'center', flex: 1 }}>
      <Text style={{ fontSize: 22 }}>{icon}</Text>
      <Text style={{ fontSize: 15, fontWeight: '700', color: isDark ? theme.text : theme.primaryStrong, marginTop: 2 }}>{value}</Text>
      <Text style={{ fontSize: 11, color: isDark ? theme.textMuted : theme.primary }}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f4f6f8' },
  container: { flex: 1 },
  scroll: { padding: 16, paddingTop: 12 },

  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 14, gap: 10 },
  greeting: { fontSize: 19, fontWeight: '700', color: '#1a1a1a' },
  sessionLabel: { fontSize: 12, color: '#777', marginTop: 2 },
  changeLocationLinkText: { fontSize: 12, fontWeight: '700', marginTop: 8 },
  startBtn: { backgroundColor: '#1D9E75', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10 },
  startBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  endBtn: { backgroundColor: '#E24B4A', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10 },
  endBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },

  weatherCard: {
    backgroundColor: '#E1F5EE', borderRadius: 14, padding: 14,
    marginBottom: 14, borderWidth: 0.5, borderColor: '#9FE1CB',
  },
  weatherEmpty: {
    backgroundColor: '#f0f0f0', borderRadius: 14, padding: 16,
    marginBottom: 14, alignItems: 'center', borderWidth: 0.5, borderColor: '#ddd',
  },
  weatherEmptyText: { color: '#888', fontSize: 14 },
  weatherHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  weatherTitle: { fontSize: 12, fontWeight: '600', color: '#085041', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 },
  weatherRow: { flexDirection: 'row', marginBottom: 8 },
  weatherDesc: { fontSize: 12, color: '#0F6E56', textAlign: 'center', textTransform: 'capitalize' },
  weatherForecastBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#0F6E56',
  },
  weatherForecastBtnText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  weatherForecastPreview: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(8, 80, 65, 0.12)',
  },
  weatherForecastPreviewLabel: { fontSize: 11, color: '#478272', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 4 },
  weatherForecastPreviewText: { fontSize: 13, fontWeight: '700', color: '#085041' },

  sectionTitle: { fontSize: 15, fontWeight: '700', color: '#1a1a1a', marginBottom: 10 },

  rodCard: {
    backgroundColor: '#fff', borderRadius: 16, padding: 14, marginBottom: 10,
    borderWidth: 0.5, borderColor: '#e8e8e8',
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  rodCardDisabled: { opacity: 0.5 },

  rodHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 12 },
  rodHeaderMain: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, flex: 1 },
  rodBadge: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  rodBadgeText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  rodTitle: { fontSize: 15, fontWeight: '700', color: '#1a1a1a' },
  rodBait: { fontSize: 12, color: '#555', marginTop: 2 },
  rodBaitEmpty: { fontSize: 12, color: '#1D9E75', marginTop: 2 },
  rodHeaderDeleteBtn: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rodHeaderDeleteText: { fontSize: 11, fontWeight: '800' },
  hookText: { fontSize: 12, color: '#888', marginBottom: 10 },

  timerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  timerLabel: { fontSize: 11, color: '#aaa', marginBottom: 2 },
  timerValue: { fontSize: 32, fontWeight: '800', fontVariant: ['tabular-nums'] },
  statsCol: { flexDirection: 'row', gap: 10 },
  statBadge: { alignItems: 'center', backgroundColor: '#f8f8f8', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6 },
  statIcon: { fontSize: 16 },
  statNum: { fontSize: 18, fontWeight: '800', color: '#1a1a1a' },
  statLabel: { fontSize: 10, color: '#aaa' },

  rodActions: { flexDirection: 'row', gap: 8 },
  castBtn: { flex: 1, backgroundColor: '#EEF6FF', paddingVertical: 11, borderRadius: 10, alignItems: 'center', borderWidth: 0.5, borderColor: '#B5D4F4' },
  actionLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  actionIcon: { fontSize: 13 },
  castBtnText: { fontSize: 13, fontWeight: '700', color: '#185FA5' },
  catchBtn: { flex: 1, backgroundColor: '#E1F5EE', paddingVertical: 11, borderRadius: 10, alignItems: 'center', borderWidth: 0.5, borderColor: '#9FE1CB' },
  catchBtnText: { fontSize: 13, fontWeight: '700', color: '#085041' },
  editBtn: { width: 42, backgroundColor: '#f5f5f5', paddingVertical: 11, borderRadius: 10, alignItems: 'center' },
  editBtnText: { fontSize: 16 },
  addRodCard: {
    borderRadius: 16,
    borderWidth: 0.5,
    padding: 14,
    marginBottom: 10,
    alignItems: 'center',
  },
  addRodText: { fontSize: 13, lineHeight: 19, textAlign: 'center', marginBottom: 10 },
  addRodButton: { borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12 },
  addRodButtonText: { color: '#fff', fontSize: 13, fontWeight: '800' },

  noSessionBanner: { alignItems: 'center', padding: 20 },
  noSessionText: { fontSize: 14, color: '#aaa', textAlign: 'center' },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  modalCard: {
    backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 24, paddingBottom: Platform.OS === 'ios' ? 36 : 24,
    maxHeight: '82%',
  },
  modalScrollContent: { paddingBottom: 4 },
  modalTitle: { fontSize: 18, fontWeight: '800', color: '#1a1a1a', marginBottom: 2 },
  modalSub: { fontSize: 13, color: '#888', marginBottom: 16 },
  modalLabel: { fontSize: 13, fontWeight: '600', color: '#444', marginBottom: 6 },
  modalInput: {
    borderWidth: 1, borderColor: '#e0e0e0', borderRadius: 10,
    padding: 13, fontSize: 14, color: '#1a1a1a', backgroundColor: '#fafafa', marginBottom: 12,
  },
  groupSelectorRow: { gap: 8, paddingBottom: 4, marginBottom: 10 },
  groupChip: {
    maxWidth: 150,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: '#f3f5f7',
    borderWidth: 1,
    borderColor: '#e0e6eb',
  },
  groupChipActive: { backgroundColor: '#1D9E75', borderColor: '#1D9E75' },
  groupChipText: { fontSize: 12, fontWeight: '700', color: '#4b5563' },
  groupChipTextActive: { color: '#fff' },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  modalCancel: { flex: 1, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: '#ddd', alignItems: 'center' },
  modalCancelText: { fontSize: 15, color: '#666', fontWeight: '500' },
  modalConfirm: { flex: 1, padding: 14, borderRadius: 12, backgroundColor: '#1D9E75', alignItems: 'center' },
  modalConfirmText: { fontSize: 15, color: '#fff', fontWeight: '700' },
  sessionLocationLoadingBox: { paddingVertical: 20, alignItems: 'center', gap: 10 },
  sessionLocationSuggestionCard: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 12,
    marginBottom: 12,
  },
  sessionLocationSectionLabel: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  sessionLocationList: { maxHeight: 260, marginTop: 10 },
  sessionLocationRow: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 11,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  sessionLocationTitle: { fontSize: 14, fontWeight: '800' },
  sessionLocationMeta: { fontSize: 12, marginTop: 4 },
  sessionLocationEmptyHint: { fontSize: 12, lineHeight: 18, marginBottom: 10 },
  sessionLocationBadge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  sessionLocationBadgeText: { fontSize: 11, fontWeight: '800' },

  forecastSafe: { flex: 1, backgroundColor: '#f4f6f8' },
  forecastHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: '#fff',
    borderBottomWidth: 0.5,
    borderBottomColor: '#e6eaee',
  },
  forecastBack: { fontSize: 16, color: '#1D9E75', fontWeight: '700' },
  forecastTitle: { fontSize: 17, fontWeight: '800', color: '#1a1a1a' },
  forecastScroll: { padding: 16, paddingBottom: 28 },
  forecastHero: {
    backgroundColor: '#103B33',
    borderRadius: 20,
    padding: 18,
    marginBottom: 12,
  },
  forecastHeroEyebrow: { fontSize: 11, color: '#98D7C6', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6 },
  forecastHeroTitle: { fontSize: 22, lineHeight: 28, fontWeight: '800', color: '#fff', marginBottom: 8 },
  forecastHeroText: { fontSize: 13, lineHeight: 19, color: '#D5ECE6' },
  forecastWeatherStrip: {
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#e7ecf0',
  },
  forecastWeatherStripText: { fontSize: 13, color: '#43505c', fontWeight: '600', textTransform: 'capitalize' },
  forecastCard: {
    flexDirection: 'row',
    gap: 12,
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#e7ecf0',
  },
  forecastRankCol: { width: 64, alignItems: 'center', justifyContent: 'flex-start' },
  forecastRank: { fontSize: 20, fontWeight: '900', color: '#103B33', marginBottom: 8 },
  forecastChancePill: {
    minWidth: 56,
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#E1F5EE',
  },
  forecastChanceText: { fontSize: 14, fontWeight: '800', color: '#0F6E56' },
  forecastBody: { flex: 1 },
  forecastNameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 },
  forecastFishName: { fontSize: 17, fontWeight: '800', color: '#1a1a1a' },
  forecastBadge: { backgroundColor: '#F4E7C5', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999 },
  forecastBadgeText: { fontSize: 11, fontWeight: '800', color: '#745109' },
  forecastSubtitle: { fontSize: 12, color: '#66717d', marginBottom: 8 },
  forecastReason: { fontSize: 13, lineHeight: 19, color: '#26323b', marginBottom: 8 },
  forecastTip: { fontSize: 12, lineHeight: 18, color: '#0F6E56', fontWeight: '600' },

  historyCard: {
    borderRadius: 18,
    padding: 16,
    borderWidth: 0.5,
    marginTop: 6,
  },
  historyHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  historyTitle: { fontSize: 17, fontWeight: '800' },
  historySubtitle: { fontSize: 13, lineHeight: 19, marginTop: 4 },
  historyButton: {
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  historyButtonText: { color: '#fff', fontSize: 13, fontWeight: '800' },
  historyQuickStatsRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
  historyQuickStat: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 12,
    alignItems: 'center',
  },
  historyQuickValue: { fontSize: 22, fontWeight: '900' },
  historyQuickLabel: { fontSize: 11, marginTop: 4, textAlign: 'center' },
  historyLoadingBox: { paddingVertical: 20, alignItems: 'center', gap: 10 },
  historyLoadingText: { fontSize: 13 },
  historyEmpty: { fontSize: 13, lineHeight: 19, marginTop: 14, textAlign: 'center' },
  historyHint: { fontSize: 12, lineHeight: 18, marginTop: 14 },
  historyModalScroll: { padding: 16, paddingBottom: 28 },
  historyEmptyCard: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 18,
  },
  historySessionCard: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 14,
    marginBottom: 12,
  },
  historySessionTopRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  historyCardActions: { alignItems: 'flex-end', gap: 8 },
  historySessionTitle: { fontSize: 16, fontWeight: '800' },
  historySessionMeta: { fontSize: 12, marginTop: 4, lineHeight: 18 },
  historyDetailsToggle: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 999,
  },
  historyDetailsToggleText: { fontSize: 12, fontWeight: '800' },
  historyDeleteToggle: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: 1,
  },
  historyDeleteToggleText: { fontSize: 12, fontWeight: '800' },
  historyMetricsRow: { flexDirection: 'row', gap: 8, marginTop: 14 },
  historyMetricCard: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 8,
    alignItems: 'center',
  },
  historyMetricValue: { fontSize: 18, fontWeight: '900' },
  historyMetricLabel: { fontSize: 10, marginTop: 4, textAlign: 'center' },
  historySectionLabel: { fontSize: 12, fontWeight: '700', marginTop: 14, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.4 },
  historyBaitsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  historyBaitChip: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  historyBaitChipText: { fontSize: 12, fontWeight: '700' },
  historyExpandedTitle: { fontSize: 14, fontWeight: '800', marginTop: 18, marginBottom: 10 },
  historyRodCard: {
    borderRadius: 14,
    borderWidth: 0.5,
    padding: 12,
    marginBottom: 8,
  },
  historyRodHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: 10, alignItems: 'center', marginBottom: 6 },
  historyRodTitle: { fontSize: 14, fontWeight: '800' },
  historyRodMeta: { fontSize: 11 },
  historyRodLine: { fontSize: 12, lineHeight: 18, marginTop: 2 },
  historyCatchRow: {
    borderTopWidth: 0.5,
    paddingTop: 10,
    marginTop: 10,
  },
  historyCatchTitle: { fontSize: 14, fontWeight: '700' },
  historyCatchMeta: { fontSize: 12, marginTop: 4 },
  historyDetailScroll: { padding: 16, paddingBottom: 28 },
  historyDetailHero: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 16,
    marginBottom: 12,
  },
  historyDetailEyebrow: { fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.8 },
  historyDetailTitle: { fontSize: 22, fontWeight: '900', marginTop: 8 },
  historyDetailSub: { fontSize: 13, marginTop: 6 },
  historyDetailDeleteButton: {
    marginTop: 14,
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: 1,
  },
  historyDetailDeleteText: { fontSize: 12, fontWeight: '800' },
  historyRodDetailCard: {
    borderRadius: 18,
    borderWidth: 0.5,
    padding: 14,
    marginBottom: 12,
  },
  historyTimelineSection: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 12,
    marginTop: 12,
  },
  historyCatchSection: {
    marginTop: 16,
  },
  historySectionHint: { fontSize: 12, marginTop: 4 },
  historyTimelineRow: {
    borderTopWidth: 0.5,
    paddingTop: 10,
    marginTop: 10,
  },
  historySetupRow: {
    paddingLeft: 10,
    borderLeftWidth: 3,
    borderLeftColor: 'rgba(29,158,117,0.35)',
  },
  historyCatchDetailRow: {
    paddingLeft: 12,
    backgroundColor: 'rgba(255,255,255,0.35)',
    borderRadius: 12,
    paddingBottom: 10,
  },
  historyTimelineTime: { fontSize: 11, marginBottom: 4 },
  historyTimelineTitle: { fontSize: 14, fontWeight: '800' },
  historyTimelineMeta: { fontSize: 12, marginTop: 4, lineHeight: 18 },
  historyFallbackBox: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
  },
  historyFallbackText: { fontSize: 12, lineHeight: 18 },
});
