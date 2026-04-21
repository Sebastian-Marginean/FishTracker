// App.tsx — Punctul de intrare al aplicației FishTracker

import React, { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import AppNavigator from './src/navigation/AppNavigator';
import { useI18n } from './src/i18n';
import { UPDATE_NOTICE } from './src/config/updateNotice';
import { hasSeenNotice, hasSeenUpdateNotice, markNoticeSeen, markUpdateNoticeSeen } from './src/lib/storage';
import { supabase } from './src/lib/supabase';
import { useThemeStore } from './src/store/themeStore';
import { getAppTheme } from './src/theme';

interface LiveAnnouncement {
  id: string;
  title_ro?: string | null;
  title_en?: string | null;
  message_ro?: string | null;
  message_en?: string | null;
  updated_at: string;
}

function getLocalizedAnnouncementCopy(language: 'ro' | 'en', announcement: LiveAnnouncement) {
  const title = language === 'ro'
    ? announcement.title_ro?.trim() || announcement.title_en?.trim() || ''
    : announcement.title_en?.trim() || announcement.title_ro?.trim() || '';
  const message = language === 'ro'
    ? announcement.message_ro?.trim() || announcement.message_en?.trim() || ''
    : announcement.message_en?.trim() || announcement.message_ro?.trim() || '';

  return { title, message };
}

function UpdateNoticeBanner() {
  const insets = useSafeAreaInsets();
  const { language } = useI18n();
  const mode = useThemeStore((state) => state.mode);
  const theme = getAppTheme(mode);
  const [visible, setVisible] = useState(false);
  const noticeContent = UPDATE_NOTICE.content[language] ?? UPDATE_NOTICE.content.ro;

  useEffect(() => {
    if (!UPDATE_NOTICE.enabled) {
      setVisible(false);
      return;
    }

    let mounted = true;

    const loadVisibility = async () => {
      const alreadySeen = await hasSeenUpdateNotice(UPDATE_NOTICE.id);
      if (mounted) {
        setVisible(!alreadySeen);
      }
    };

    void loadVisibility();

    return () => {
      mounted = false;
    };
  }, []);

  const dismissBanner = async () => {
    setVisible(false);
    await markUpdateNoticeSeen(UPDATE_NOTICE.id);
  };

  if (!visible) return null;

  return (
    <View style={[styles.updateBanner, { paddingTop: Math.max(insets.top, 10), backgroundColor: theme.primaryStrong }]}> 
      <View style={styles.updateBannerRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.updateBannerEyebrow}>{noticeContent.eyebrow}</Text>
          <Text style={styles.updateBannerTitle}>{noticeContent.title}</Text>
          <Text style={styles.updateBannerMessage}>{noticeContent.message}</Text>
        </View>
        <TouchableOpacity style={styles.updateBannerButton} onPress={() => void dismissBanner()}>
          <Text style={styles.updateBannerButtonText}>{noticeContent.action}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function LiveAnnouncementBanner() {
  const insets = useSafeAreaInsets();
  const { language, t } = useI18n();
  const mode = useThemeStore((state) => state.mode);
  const theme = getAppTheme(mode);
  const [announcement, setAnnouncement] = useState<LiveAnnouncement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let mounted = true;

    const loadAnnouncement = async () => {
      const { data, error } = await supabase
        .from('app_announcements')
        .select('id, title_ro, title_en, message_ro, message_en, updated_at')
        .eq('is_active', true)
        .order('updated_at', { ascending: false })
        .limit(1);

      if (!mounted) return;

      if (error) {
        setAnnouncement(null);
        setVisible(false);
        return;
      }

      setAnnouncement(((data ?? [])[0] as LiveAnnouncement | undefined) ?? null);
    };

    void loadAnnouncement();

    const channel = supabase
      .channel('app-announcements-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'app_announcements' }, () => {
        void loadAnnouncement();
      })
      .subscribe();

    return () => {
      mounted = false;
      void supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    let mounted = true;

    const syncVisibility = async () => {
      if (!announcement) {
        if (mounted) setVisible(false);
        return;
      }

      const noticeKey = `admin-announcement:${announcement.id}:${announcement.updated_at}`;
      const alreadySeen = await hasSeenNotice(noticeKey);
      if (mounted) {
        setVisible(!alreadySeen);
      }
    };

    void syncVisibility();

    return () => {
      mounted = false;
    };
  }, [announcement]);

  const dismissAnnouncement = async () => {
    if (!announcement) return;
    setVisible(false);
    await markNoticeSeen(`admin-announcement:${announcement.id}:${announcement.updated_at}`);
  };

  if (!announcement || !visible) return null;

  const copy = getLocalizedAnnouncementCopy(language, announcement);
  if (!copy.title && !copy.message) return null;

  return (
    <View
      style={[
        styles.liveAnnouncementBanner,
        { paddingTop: Math.max(insets.top, 10), backgroundColor: theme.primary },
      ]}
    >
      <View style={styles.updateBannerRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.updateBannerEyebrow}>{t('app.liveAnnouncementEyebrow')}</Text>
          {!!copy.title && <Text style={styles.updateBannerTitle}>{copy.title}</Text>}
          {!!copy.message && <Text style={styles.updateBannerMessage}>{copy.message}</Text>}
        </View>
        <TouchableOpacity style={styles.updateBannerButton} onPress={() => void dismissAnnouncement()}>
          <Text style={styles.updateBannerButtonText}>{t('app.liveAnnouncementAction')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

export default function App() {
  const mode = useThemeStore((state) => state.mode);
  const theme = getAppTheme(mode);

  return (
    <SafeAreaProvider>
      <StatusBar style={theme.statusBar} />
      <UpdateNoticeBanner />
      <LiveAnnouncementBanner />
      <AppNavigator />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  updateBanner: {
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  liveAnnouncementBanner: {
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  updateBannerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  updateBannerEyebrow: {
    color: 'rgba(255,255,255,0.82)',
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  updateBannerTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '900',
    marginTop: 2,
  },
  updateBannerMessage: {
    color: 'rgba(255,255,255,0.92)',
    fontSize: 13,
    lineHeight: 19,
    marginTop: 4,
  },
  updateBannerButton: {
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  updateBannerButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '800',
  },
});
