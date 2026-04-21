import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  TextInput, ActivityIndicator, Alert, RefreshControl, Image, Modal,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import PasswordStrengthMeter from '../../components/PasswordStrengthMeter';
import SuccessSheet from '../../components/SuccessSheet';
import { uploadImageToSupabase } from '../../lib/mediaUpload';
import { supabase } from '../../lib/supabase';
import { formatDate, formatDateTime, useI18n } from '../../i18n';
import { useAuthStore } from '../../store/authStore';
import { useLanguageStore } from '../../store/languageStore';
import { useThemeStore } from '../../store/themeStore';
import { getAppTheme } from '../../theme';
import type { Catch, Group, Location, Message, Profile as FishProfile } from '../../types';

interface ProfileStats {
  catches: number;
  sessions: number;
  groups: number;
}

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

interface AdminAnnouncement {
  id: string;
  title_ro?: string | null;
  title_en?: string | null;
  message_ro?: string | null;
  message_en?: string | null;
  is_active: boolean;
  updated_at: string;
  created_at: string;
}

type AdminTab = 'locations' | 'catches' | 'groups' | 'messages' | 'users';
type ModerationKind = 'mute' | 'ban';
type ModerationDuration = '1h' | '24h' | '7d' | '30d' | 'permanent';

type AdminLocation = Pick<Location, 'id' | 'name' | 'created_at'> & { created_by?: string };
type AdminCatch = Pick<Catch, 'id' | 'fish_species' | 'weight_kg' | 'caught_at' | 'user_id'> & {
  profiles?: { username?: string } | null;
  locations?: { name?: string } | null;
};
type AdminGroup = Pick<Group, 'id' | 'name' | 'invite_code' | 'created_at' | 'owner_id'>;
type AdminMessage = Pick<Message, 'id' | 'content' | 'created_at' | 'user_id'> & {
  profiles?: { username?: string } | null;
};
type AdminUser = Pick<FishProfile, 'id' | 'username' | 'full_name' | 'role' | 'created_at' | 'muted_until' | 'mute_permanent' | 'banned_until' | 'ban_permanent'>;

function isRateLimitMessage(message: string) {
  return /email rate limit exceeded|too many requests/i.test(message);
}

function getFriendlyAuthMessage(
  message: string,
  t: (key: string, params?: Record<string, string | number>) => string,
) {
  if (isRateLimitMessage(message)) {
    return t('auth.emailRateLimit');
  }

  if (/already been registered|already exists|exista deja un cont/i.test(message)) {
    return t('auth.accountAlreadyExists');
  }

  if (/username-ul este deja folosit|username is already|username already exists/i.test(message)) {
    return t('auth.usernameTaken');
  }

  return message;
}

function normalizeUsername(value: string) {
  return value.trim().replace(/\s+/g, ' ');
}

export default function ProfileScreen() {
  const { user, profile, updateProfile, updateEmail, updatePassword, fetchProfile, signOut } = useAuthStore();
  const { language, t } = useI18n();
  const selectedLanguage = useLanguageStore((state) => state.language);
  const setLanguage = useLanguageStore((state) => state.setLanguage);
  const mode = useThemeStore((state) => state.mode);
  const toggleMode = useThemeStore((state) => state.toggleMode);
  const theme = getAppTheme(mode);
  const [username, setUsername] = useState('');
  const [fullName, setFullName] = useState('');
  const [bio, setBio] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmNewPassword, setShowConfirmNewPassword] = useState(false);
  const [stats, setStats] = useState<ProfileStats>({ catches: 0, sessions: 0, groups: 0 });
  const [saving, setSaving] = useState(false);
  const [updatingAvatar, setUpdatingAvatar] = useState(false);
  const [updatingEmail, setUpdatingEmail] = useState(false);
  const [updatingPassword, setUpdatingPassword] = useState(false);
  const [successState, setSuccessState] = useState<SuccessState | null>(null);
  const [noticeState, setNoticeState] = useState<NoticeState | null>(null);
  const [emailCooldownUntil, setEmailCooldownUntil] = useState<number | null>(null);
  const [emailCooldownLeft, setEmailCooldownLeft] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [adminLoading, setAdminLoading] = useState(false);
  const [activeAdminTab, setActiveAdminTab] = useState<AdminTab>('locations');
  const [adminLocations, setAdminLocations] = useState<AdminLocation[]>([]);
  const [adminCatches, setAdminCatches] = useState<AdminCatch[]>([]);
  const [adminGroups, setAdminGroups] = useState<AdminGroup[]>([]);
  const [adminMessages, setAdminMessages] = useState<AdminMessage[]>([]);
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([]);
  const [adminUserSearch, setAdminUserSearch] = useState('');
  const [updatingAdminRoleId, setUpdatingAdminRoleId] = useState<string | null>(null);
  const [adminAnnouncement, setAdminAnnouncement] = useState<AdminAnnouncement | null>(null);
  const [announcementTitleRo, setAnnouncementTitleRo] = useState('');
  const [announcementTitleEn, setAnnouncementTitleEn] = useState('');
  const [announcementMessageRo, setAnnouncementMessageRo] = useState('');
  const [announcementMessageEn, setAnnouncementMessageEn] = useState('');
  const [savingAnnouncement, setSavingAnnouncement] = useState(false);
  const [moderationUser, setModerationUser] = useState<AdminUser | null>(null);
  const [moderationKind, setModerationKind] = useState<ModerationKind>('mute');
  const [moderationDuration, setModerationDuration] = useState<ModerationDuration>('24h');

  const isAdmin = profile?.role === 'admin';

  const openWarningNotice = (title: string, message: string, details?: string) => {
    setNoticeState({ title, message, details });
  };

  const openAuthErrorNotice = (title: string, message: string) => {
    openWarningNotice(title, getFriendlyAuthMessage(message, t));
  };

  useEffect(() => {
    if (!emailCooldownUntil) {
      setEmailCooldownLeft(0);
      return;
    }

    const updateRemaining = () => {
      const remainingMs = Math.max(0, emailCooldownUntil - Date.now());
      const remainingSeconds = Math.ceil(remainingMs / 1000);
      setEmailCooldownLeft(remainingSeconds);

      if (remainingMs <= 0) {
        setEmailCooldownUntil(null);
      }
    };

    updateRemaining();
    const timer = setInterval(updateRemaining, 1000);

    return () => clearInterval(timer);
  }, [emailCooldownUntil]);

  useEffect(() => {
    setUsername(profile?.username ?? '');
    setFullName(profile?.full_name ?? '');
    setBio(profile?.bio ?? '');
  }, [profile?.username, profile?.full_name, profile?.bio]);

  useEffect(() => {
    setAvatarUri(profile?.avatar_url ?? null);
  }, [profile?.avatar_url]);

  const loadProfileData = useCallback(async () => {
    if (!user) return;

    const [{ count: catches }, { count: sessions }, { count: groups }] = await Promise.all([
      supabase.from('catches').select('*', { count: 'exact', head: true }).eq('user_id', user.id),
      supabase.from('sessions').select('*', { count: 'exact', head: true }).eq('user_id', user.id),
      supabase.from('group_members').select('*', { count: 'exact', head: true }).eq('user_id', user.id),
    ]);

    setStats({
      catches: catches ?? 0,
      sessions: sessions ?? 0,
      groups: groups ?? 0,
    });
  }, [user]);

  const loadAdminData = useCallback(async () => {
    if (!user) return;

    setAdminLoading(true);

    const locationsQuery = supabase.from('locations').select('id, name, created_at, created_by').order('created_at', { ascending: false }).limit(10);
    const catchesQuery = supabase
      .from('catches')
      .select('id, fish_species, weight_kg, caught_at, user_id, profiles:profiles!catches_user_id_fkey(username), locations:locations(name)')
      .order('caught_at', { ascending: false })
      .limit(10);
    const groupsQuery = supabase.from('groups').select('id, name, invite_code, created_at, owner_id').order('created_at', { ascending: false }).limit(10);
    const messagesQuery = supabase
      .from('messages')
      .select('id, content, created_at, user_id, profiles:profiles!messages_user_id_fkey(username)')
      .order('created_at', { ascending: false })
      .limit(10);
    const usersQuery = supabase
      .from('profiles')
      .select('id, username, full_name, role, created_at, muted_until, mute_permanent, banned_until, ban_permanent')
      .neq('id', user.id)
      .order('created_at', { ascending: false })
      .limit(200);

    const [locationsRes, catchesRes, groupsRes, messagesRes, usersRes] = await Promise.all([
      isAdmin ? locationsQuery : locationsQuery.eq('created_by', user.id),
      isAdmin ? catchesQuery : catchesQuery.eq('user_id', user.id),
      isAdmin ? groupsQuery : groupsQuery.eq('owner_id', user.id),
      isAdmin ? messagesQuery : messagesQuery.eq('user_id', user.id),
      isAdmin ? usersQuery : Promise.resolve({ data: [] as AdminUser[] }),
    ]);

    setAdminLocations((locationsRes.data ?? []) as AdminLocation[]);
    setAdminCatches((catchesRes.data ?? []) as AdminCatch[]);
    setAdminGroups((groupsRes.data ?? []) as AdminGroup[]);
    setAdminMessages((messagesRes.data ?? []) as AdminMessage[]);
    setAdminUsers((usersRes.data ?? []) as AdminUser[]);
    setAdminLoading(false);
  }, [isAdmin, user]);

  const loadAdminAnnouncement = useCallback(async () => {
    if (!isAdmin) {
      setAdminAnnouncement(null);
      setAnnouncementTitleRo('');
      setAnnouncementTitleEn('');
      setAnnouncementMessageRo('');
      setAnnouncementMessageEn('');
      return;
    }

    const { data, error } = await supabase
      .from('app_announcements')
      .select('id, title_ro, title_en, message_ro, message_en, is_active, updated_at, created_at')
      .order('updated_at', { ascending: false })
      .limit(1);

    if (error) {
      setAdminAnnouncement(null);
      return;
    }

    const latestAnnouncement = ((data ?? [])[0] as AdminAnnouncement | undefined) ?? null;
    setAdminAnnouncement(latestAnnouncement);
    setAnnouncementTitleRo(latestAnnouncement?.title_ro ?? '');
    setAnnouncementTitleEn(latestAnnouncement?.title_en ?? '');
    setAnnouncementMessageRo(latestAnnouncement?.message_ro ?? '');
    setAnnouncementMessageEn(latestAnnouncement?.message_en ?? '');
  }, [isAdmin]);

  const moderationOptions = useMemo(() => [
    { key: '1h' as const, label: t('profile.moderationDuration1h'), ms: 60 * 60 * 1000 },
    { key: '24h' as const, label: t('profile.moderationDuration24h'), ms: 24 * 60 * 60 * 1000 },
    { key: '7d' as const, label: t('profile.moderationDuration7d'), ms: 7 * 24 * 60 * 60 * 1000 },
    { key: '30d' as const, label: t('profile.moderationDuration30d'), ms: 30 * 24 * 60 * 60 * 1000 },
    { key: 'permanent' as const, label: t('profile.moderationDurationPermanent'), ms: null },
  ], [t]);

  const filteredAdminUsers = useMemo(() => {
    const term = adminUserSearch.trim().toLowerCase();
    if (!term) return adminUsers;
    return adminUsers.filter((item) => {
      const username = item.username?.toLowerCase() ?? '';
      const fullName = item.full_name?.toLowerCase() ?? '';
      return username.includes(term) || fullName.includes(term);
    });
  }, [adminUserSearch, adminUsers]);

  const isModerationActive = (item: AdminUser, kind: ModerationKind) => {
    const permanent = kind === 'mute' ? item.mute_permanent : item.ban_permanent;
    const until = kind === 'mute' ? item.muted_until : item.banned_until;
    return !!permanent || (!!until && new Date(until).getTime() > Date.now());
  };

  const getModerationStatusLabel = (item: AdminUser, kind: ModerationKind) => {
    const permanent = kind === 'mute' ? item.mute_permanent : item.ban_permanent;
    const until = kind === 'mute' ? item.muted_until : item.banned_until;
    if (!isModerationActive(item, kind)) return null;
    if (permanent) return t('profile.moderationPermanent');
    if (!until) return null;
    return kind === 'mute'
      ? t('profile.moderationMutedUntil', { date: formatDateTime(language, until) })
      : t('profile.moderationBannedUntil', { date: formatDateTime(language, until) });
  };

  const applyModeration = async (kind: ModerationKind, action: 'set' | 'clear') => {
    if (!moderationUser) return;

    const selectedOption = moderationOptions.find((item) => item.key === moderationDuration);
    const untilValue = action === 'set' && selectedOption?.ms
      ? new Date(Date.now() + selectedOption.ms).toISOString()
      : null;
    const updates = kind === 'mute'
      ? {
          mute_permanent: action === 'set' ? moderationDuration === 'permanent' : false,
          muted_until: action === 'set' ? untilValue : null,
        }
      : {
          ban_permanent: action === 'set' ? moderationDuration === 'permanent' : false,
          banned_until: action === 'set' ? untilValue : null,
        };

    const { error } = await supabase.from('profiles').update(updates).eq('id', moderationUser.id);
    if (error) {
      openWarningNotice(t('common.error'), error.message);
      return;
    }

    setSuccessState({
      title: t('profile.updatedTitle'),
      message: action === 'set'
        ? (kind === 'mute'
            ? t('profile.userMutedMessage', { username: moderationUser.username })
            : t('profile.userBannedMessage', { username: moderationUser.username }))
        : (kind === 'mute'
            ? t('profile.userUnmutedMessage', { username: moderationUser.username })
            : t('profile.userUnbannedMessage', { username: moderationUser.username })),
    });

    setModerationUser(null);
    await loadAdminData();
  };

  const toggleAdminRole = async (targetUser: AdminUser) => {
    const nextRole = targetUser.role === 'admin' ? 'user' : 'admin';
    setUpdatingAdminRoleId(targetUser.id);

    const { error } = await supabase
      .from('profiles')
      .update({ role: nextRole })
      .eq('id', targetUser.id);

    setUpdatingAdminRoleId(null);

    if (error) {
      openWarningNotice(t('common.error'), error.message);
      return;
    }

    setSuccessState({
      title: t('profile.updatedTitle'),
      message: nextRole === 'admin'
        ? t('profile.userPromotedAdminMessage', { username: targetUser.username })
        : t('profile.userDemotedAdminMessage', { username: targetUser.username }),
    });

    await loadAdminData();
  };

  const refreshAll = useCallback(async () => {
    setRefreshing(true);
    await fetchProfile();
    await loadProfileData();
    await loadAdminData();
    await loadAdminAnnouncement();
    setRefreshing(false);
  }, [fetchProfile, loadAdminAnnouncement, loadAdminData, loadProfileData]);

  const saveAnnouncement = async () => {
    if (!user?.id) return;

    const nextTitleRo = announcementTitleRo.trim();
    const nextTitleEn = announcementTitleEn.trim();
    const nextMessageRo = announcementMessageRo.trim();
    const nextMessageEn = announcementMessageEn.trim();

    if (!nextTitleRo && !nextTitleEn && !nextMessageRo && !nextMessageEn) {
      openWarningNotice(t('profile.announcementValidationTitle'), t('profile.announcementValidationMessage'));
      return;
    }

    setSavingAnnouncement(true);

    const payload = {
      title_ro: nextTitleRo || null,
      title_en: nextTitleEn || null,
      message_ro: nextMessageRo || null,
      message_en: nextMessageEn || null,
      is_active: true,
      updated_at: new Date().toISOString(),
    };

    const { error } = adminAnnouncement?.id
      ? await supabase.from('app_announcements').update(payload).eq('id', adminAnnouncement.id)
      : await supabase.from('app_announcements').insert({ ...payload, created_by: user.id });

    setSavingAnnouncement(false);

    if (error) {
      openWarningNotice(t('common.error'), error.message);
      return;
    }

    setSuccessState({
      title: t('profile.announcementSavedTitle'),
      message: t('profile.announcementSavedMessage'),
    });
    await loadAdminAnnouncement();
  };

  const deactivateAnnouncement = async () => {
    if (!adminAnnouncement?.id) return;

    setSavingAnnouncement(true);
    const { error } = await supabase
      .from('app_announcements')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', adminAnnouncement.id);
    setSavingAnnouncement(false);

    if (error) {
      openWarningNotice(t('common.error'), error.message);
      return;
    }

    setSuccessState({
      title: t('profile.announcementHiddenTitle'),
      message: t('profile.announcementHiddenMessage'),
    });
    await loadAdminAnnouncement();
  };

  useFocusEffect(
    useCallback(() => {
      void refreshAll();
    }, [refreshAll])
  );

  const handleSaveProfile = async () => {
    const submittedUsername = normalizeUsername(username);
    const currentUsername = normalizeUsername(profile?.username ?? '');

    if (!submittedUsername) {
      openWarningNotice(t('auth.validationTitle'), t('auth.fillAllFields'));
      return;
    }

    if (submittedUsername.length < 3) {
      openWarningNotice(t('auth.validationTitle'), t('auth.usernameTooShort'));
      return;
    }

    if (submittedUsername.toLowerCase() !== currentUsername.toLowerCase()) {
      const { data, error } = await supabase.rpc('find_profile_by_username', { lookup_username: submittedUsername });

      if (error) {
        openWarningNotice(t('common.error'), getFriendlyAuthMessage(error.message, t));
        return;
      }

      const existingUser = Array.isArray(data) ? data[0] : null;
      if (existingUser?.id && existingUser.id !== user?.id) {
        openWarningNotice(t('auth.validationTitle'), t('auth.usernameTaken'));
        return;
      }
    }

    setSaving(true);

    let avatarUrl = profile?.avatar_url ?? null;

    if (avatarUri && avatarUri !== profile?.avatar_url) {
      try {
        setUpdatingAvatar(true);
        avatarUrl = await uploadImageToSupabase({
          bucket: 'avatars',
          folder: 'profiles',
          uri: avatarUri,
          userId: user?.id,
        });
      } catch (error) {
        setUpdatingAvatar(false);
        setSaving(false);
        openWarningNotice(
          t('common.error'),
          `${t('profile.avatarUploadFailed')}\n\n${error instanceof Error ? error.message : ''}`.trim()
        );
        return;
      }
    }

    const { error } = await updateProfile({
      username: submittedUsername,
      full_name: fullName.trim() || null,
      bio: bio.trim() || null,
      avatar_url: avatarUrl,
    } as any);
    setUpdatingAvatar(false);
    setSaving(false);

    if (error) {
      openWarningNotice(t('common.error'), getFriendlyAuthMessage(error, t));
      return;
    }

    setSuccessState({
      title: t('profile.updatedTitle'),
      message: t('profile.updatedMessage'),
    });
    await fetchProfile();
  };

  const pickAvatar = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.75,
      allowsEditing: true,
      aspect: [1, 1],
    });

    if (!result.canceled) {
      setAvatarUri(result.assets[0].uri);
    }
  };

  const handleChangeEmail = async () => {
    if (!newEmail.trim()) {
      openWarningNotice(t('auth.validationTitle'), t('auth.emailRequired'));
      return;
    }

    if (emailCooldownLeft > 0) {
      openWarningNotice(t('auth.rateLimitTitle'), t('auth.rateLimitMessage'), t('auth.emailCooldown', { seconds: emailCooldownLeft }));
      return;
    }

    setUpdatingEmail(true);
    const { error } = await updateEmail(newEmail.trim());
    setUpdatingEmail(false);

    if (error) {
      if (isRateLimitMessage(error)) {
        setEmailCooldownUntil(Date.now() + 60_000);
        openWarningNotice(t('auth.rateLimitTitle'), t('auth.rateLimitMessage'), t('auth.emailCooldown', { seconds: 60 }));
        return;
      }

      openAuthErrorNotice(t('common.error'), error);
      return;
    }

    setEmailCooldownUntil(Date.now() + 60_000);
    const submittedEmail = newEmail.trim();
    setNewEmail('');
    setSuccessState({
      title: t('profile.emailUpdatedTitle'),
      message: t('profile.emailUpdatedMessage'),
      details: submittedEmail,
    });
  };

  const handleChangePassword = async () => {
    if (!newPassword.trim()) {
      openWarningNotice(t('auth.validationTitle'), t('auth.passwordTooShort'));
      return;
    }
    if (newPassword.length < 8) {
      openWarningNotice(t('auth.validationTitle'), t('auth.passwordTooShort'));
      return;
    }
    if (newPassword !== confirmNewPassword) {
      openWarningNotice(t('auth.validationTitle'), t('auth.passwordMismatch'));
      return;
    }

    setUpdatingPassword(true);
    const { error } = await updatePassword(newPassword);
    setUpdatingPassword(false);

    if (error) {
      openAuthErrorNotice(t('common.error'), error);
      return;
    }

    setNewPassword('');
    setConfirmNewPassword('');
    setSuccessState({
      title: t('profile.passwordUpdatedTitle'),
      message: t('profile.passwordUpdatedMessage'),
    });
  };

  const handleDelete = async (table: 'locations' | 'catches' | 'groups' | 'messages', id: string, label: string) => {
    Alert.alert(
      t('common.confirm'),
      t('profile.deletePrompt', { label }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            const { error } = await supabase.from(table).delete().eq('id', id);
            if (error) {
              Alert.alert(t('common.error'), error.message);
              return;
            }

            await loadProfileData();
            await loadAdminData();
          },
        },
      ]
    );
  };

  const adminSections = useMemo(() => [
    { key: 'locations' as const, label: t('profile.locationsTab') },
    { key: 'catches' as const, label: t('profile.catchesTab') },
    { key: 'groups' as const, label: t('profile.groupsTab') },
    { key: 'messages' as const, label: t('profile.messagesTab') },
    ...(isAdmin ? [{ key: 'users' as const, label: t('profile.usersTab') }] : []),
  ], [isAdmin, t]);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}> 
      <ScrollView
        style={[styles.container, { backgroundColor: theme.background }]}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refreshAll} tintColor={theme.primary} />}
      >
        <View style={[styles.headerCard, { backgroundColor: theme.surface, borderColor: theme.borderSoft }]}> 
          <TouchableOpacity style={[styles.avatarWrap, { borderColor: theme.borderSoft }]} onPress={pickAvatar} activeOpacity={0.9}>
            {avatarUri ? (
              <Image source={{ uri: avatarUri }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, { backgroundColor: theme.primary }]}>
                <Text style={styles.avatarText}>{profile?.username?.[0]?.toUpperCase() ?? '?'}</Text>
              </View>
            )}
            <View style={[styles.avatarBadge, { backgroundColor: theme.primaryStrong }]}>
              <Text style={styles.avatarBadgeText}>{updatingAvatar ? '…' : '+'}</Text>
            </View>
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <View style={styles.nameRow}>
              <Text style={[styles.username, { color: theme.text }]}>@{profile?.username ?? t('profile.userFallback')}</Text>
              {isAdmin && (
                <View style={[styles.adminBadge, { backgroundColor: theme.badgeBg }]}> 
                  <Text style={[styles.adminBadgeText, { color: theme.badgeText }]}>{t('profile.admin')}</Text>
                </View>
              )}
            </View>
            <Text style={[styles.email, { color: theme.textMuted }]}>{user?.email ?? t('profile.noEmail')}</Text>
            <Text style={[styles.joined, { color: theme.textSoft }]}>{t('profile.memberSince', { date: profile?.created_at ? formatDate(language, profile.created_at) : '-' })}</Text>
            <Text style={[styles.avatarHint, { color: theme.textSoft }]}>{t('profile.avatarHint')}</Text>
          </View>
        </View>

        <View style={styles.statsRow}>
          <StatCard value={stats.catches} label={t('profile.statsCatches')} theme={theme} />
          <StatCard value={stats.sessions} label={t('profile.statsSessions')} theme={theme} />
          <StatCard value={stats.groups} label={t('profile.statsGroups')} theme={theme} />
        </View>

        <View style={[styles.sectionCard, { backgroundColor: theme.surface, borderColor: theme.borderSoft }]}> 
          <Text style={[styles.sectionTitle, { color: theme.text }]}>{t('profile.myProfile')}</Text>
          <Text style={[styles.inputLabel, { color: theme.textMuted }]}>{t('auth.username')}</Text>
          <TextInput
            style={[styles.input, { backgroundColor: theme.inputBg, borderColor: theme.border, color: theme.text }]}
            placeholder={t('auth.username')}
            placeholderTextColor="#bbb"
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
          />
          <Text style={[styles.inputLabel, { color: theme.textMuted }]}>{t('profile.displayName')}</Text>
          <TextInput
            style={[styles.input, { backgroundColor: theme.inputBg, borderColor: theme.border, color: theme.text }]}
            placeholder={t('profile.namePlaceholder')}
            placeholderTextColor="#bbb"
            value={fullName}
            onChangeText={setFullName}
          />
          <Text style={[styles.inputLabel, { color: theme.textMuted }]}>{t('profile.bio')}</Text>
          <TextInput
            style={[styles.input, styles.textArea, { backgroundColor: theme.inputBg, borderColor: theme.border, color: theme.text }]}
            placeholder={t('profile.bioPlaceholder')}
            placeholderTextColor="#bbb"
            value={bio}
            onChangeText={setBio}
            multiline
          />

          <View style={[styles.themeRow, { backgroundColor: theme.surfaceAlt, borderColor: theme.border }]}> 
            <View style={{ flex: 1 }}>
              <Text style={[styles.themeTitle, { color: theme.text }]}>{t('profile.themeTitle')}</Text>
              <Text style={[styles.themeSub, { color: theme.textMuted }]}>
                {t('profile.themeCurrent', { mode: mode === 'dark' ? t('profile.themeDark') : t('profile.themeLight') })}
              </Text>
            </View>
            <TouchableOpacity style={[styles.themeToggle, { backgroundColor: mode === 'dark' ? theme.primary : theme.primaryStrong }]} onPress={toggleMode}>
              <Text style={styles.themeToggleText}>{mode === 'dark' ? t('profile.switchToLight') : t('profile.switchToDark')}</Text>
            </TouchableOpacity>
          </View>

          <View style={[styles.themeRow, { backgroundColor: theme.surfaceAlt, borderColor: theme.border }]}> 
            <View style={{ flex: 1 }}>
              <Text style={[styles.themeTitle, { color: theme.text }]}>{t('profile.languageTitle')}</Text>
              <Text style={[styles.themeSub, { color: theme.textMuted }]}>{t('profile.languageSubtitle')}</Text>
            </View>
            <View style={styles.langButtonsRow}>
              {(['ro', 'en'] as const).map((lang) => (
                <TouchableOpacity
                  key={lang}
                  style={[
                    styles.langButton,
                    { backgroundColor: selectedLanguage === lang ? theme.primary : theme.surface },
                    { borderColor: selectedLanguage === lang ? theme.primary : theme.border },
                  ]}
                  onPress={() => setLanguage(lang)}
                >
                  <Text style={[styles.langButtonText, { color: selectedLanguage === lang ? '#fff' : theme.text }]}>{lang.toUpperCase()}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={[styles.securityCard, { backgroundColor: theme.surfaceAlt, borderColor: theme.border }]}> 
            <Text style={[styles.themeTitle, { color: theme.text }]}>{t('profile.securityTitle')}</Text>
            <Text style={[styles.themeSub, { color: theme.textMuted }]}>{t('profile.securitySubtitle')}</Text>

            <Text style={[styles.inputLabel, { color: theme.textMuted }]}>{t('profile.newEmail')}</Text>
            <TextInput
              style={[styles.input, { backgroundColor: theme.inputBg, borderColor: theme.border, color: theme.text }]}
              placeholder={t('profile.newEmailPlaceholder')}
              placeholderTextColor="#bbb"
              value={newEmail}
              onChangeText={setNewEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
            />
            <TouchableOpacity
              style={[styles.tertiaryBtn, { backgroundColor: theme.primaryStrong }, (updatingEmail || emailCooldownLeft > 0) && styles.disabledBtn]}
              onPress={handleChangeEmail}
              disabled={updatingEmail || emailCooldownLeft > 0}
            >
              {updatingEmail ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>{t('profile.changeEmail')}</Text>}
            </TouchableOpacity>
            {emailCooldownLeft > 0 && (
              <Text style={[styles.cooldownHint, { color: theme.textSoft }]}>{t('profile.emailChangeCooldownHint', { seconds: emailCooldownLeft })}</Text>
            )}

            <Text style={[styles.inputLabel, { color: theme.textMuted }]}>{t('profile.newPassword')}</Text>
            <View style={styles.passwordInputWrap}>
              <TextInput
                style={[styles.input, styles.passwordInput, { backgroundColor: theme.inputBg, borderColor: theme.border, color: theme.text }]}
                placeholder={t('profile.newPasswordPlaceholder')}
                placeholderTextColor="#bbb"
                value={newPassword}
                onChangeText={setNewPassword}
                secureTextEntry={!showNewPassword}
              />
              <TouchableOpacity style={[styles.passwordToggle, { backgroundColor: theme.surfaceAlt }]} onPress={() => setShowNewPassword((value) => !value)}>
                <Text style={[styles.passwordToggleText, { color: theme.primary }]}>{showNewPassword ? t('common.hide') : t('common.show')}</Text>
              </TouchableOpacity>
            </View>
            <PasswordStrengthMeter password={newPassword} variant="profile" />

            <Text style={[styles.inputLabel, { color: theme.textMuted }]}>{t('profile.confirmNewPassword')}</Text>
            <View style={styles.passwordInputWrap}>
              <TextInput
                style={[styles.input, styles.passwordInput, { backgroundColor: theme.inputBg, borderColor: theme.border, color: theme.text }]}
                placeholder={t('profile.confirmNewPasswordPlaceholder')}
                placeholderTextColor="#bbb"
                value={confirmNewPassword}
                onChangeText={setConfirmNewPassword}
                secureTextEntry={!showConfirmNewPassword}
              />
              <TouchableOpacity style={[styles.passwordToggle, { backgroundColor: theme.surfaceAlt }]} onPress={() => setShowConfirmNewPassword((value) => !value)}>
                <Text style={[styles.passwordToggleText, { color: theme.primary }]}>{showConfirmNewPassword ? t('common.hide') : t('common.show')}</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity style={[styles.tertiaryBtn, { backgroundColor: theme.primary }, updatingPassword && styles.disabledBtn]} onPress={handleChangePassword} disabled={updatingPassword}>
              {updatingPassword ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>{t('profile.changePassword')}</Text>}
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: theme.primary }, saving && styles.disabledBtn]} onPress={handleSaveProfile} disabled={saving}>
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>{t('profile.saveProfile')}</Text>}
          </TouchableOpacity>

          <TouchableOpacity style={[styles.secondaryBtn, { backgroundColor: theme.surfaceAlt }]} onPress={signOut}>
            <Text style={[styles.secondaryBtnText, { color: theme.text }]}>{t('profile.signOut')}</Text>
          </TouchableOpacity>
        </View>

        {isAdmin && (
          <View style={[styles.sectionCard, { backgroundColor: theme.surface, borderColor: theme.borderSoft }]}> 
            <Text style={[styles.sectionTitle, { color: theme.text }]}>{t('profile.announcementTitle')}</Text>
            <Text style={[styles.sectionSub, { color: theme.textMuted }]}>{t('profile.announcementSubtitle')}</Text>
            <Text style={[styles.announcementStatus, { color: adminAnnouncement?.is_active ? theme.primary : theme.textSoft }]}>
              {adminAnnouncement?.is_active ? t('profile.announcementStatusActive') : t('profile.announcementStatusInactive')}
            </Text>

            <Text style={[styles.inputLabel, { color: theme.textMuted }]}>{t('profile.announcementTitleRo')}</Text>
            <TextInput
              style={[styles.input, { backgroundColor: theme.inputBg, borderColor: theme.border, color: theme.text }]}
              placeholder={t('profile.announcementTitleRo')}
              placeholderTextColor="#bbb"
              value={announcementTitleRo}
              onChangeText={setAnnouncementTitleRo}
            />

            <Text style={[styles.inputLabel, { color: theme.textMuted }]}>{t('profile.announcementMessageRo')}</Text>
            <TextInput
              style={[styles.input, styles.textArea, { backgroundColor: theme.inputBg, borderColor: theme.border, color: theme.text }]}
              placeholder={t('profile.announcementMessageRo')}
              placeholderTextColor="#bbb"
              value={announcementMessageRo}
              onChangeText={setAnnouncementMessageRo}
              multiline
            />

            <Text style={[styles.inputLabel, { color: theme.textMuted }]}>{t('profile.announcementTitleEn')}</Text>
            <TextInput
              style={[styles.input, { backgroundColor: theme.inputBg, borderColor: theme.border, color: theme.text }]}
              placeholder={t('profile.announcementTitleEn')}
              placeholderTextColor="#bbb"
              value={announcementTitleEn}
              onChangeText={setAnnouncementTitleEn}
            />

            <Text style={[styles.inputLabel, { color: theme.textMuted }]}>{t('profile.announcementMessageEn')}</Text>
            <TextInput
              style={[styles.input, styles.textArea, { backgroundColor: theme.inputBg, borderColor: theme.border, color: theme.text }]}
              placeholder={t('profile.announcementMessageEn')}
              placeholderTextColor="#bbb"
              value={announcementMessageEn}
              onChangeText={setAnnouncementMessageEn}
              multiline
            />

            <View style={styles.announcementActions}>
              <TouchableOpacity style={[styles.primaryBtn, styles.announcementButton, { backgroundColor: theme.primary }, savingAnnouncement && styles.disabledBtn]} onPress={() => void saveAnnouncement()} disabled={savingAnnouncement}>
                {savingAnnouncement ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>{t('profile.announcementPublish')}</Text>}
              </TouchableOpacity>
              <TouchableOpacity style={[styles.secondaryBtn, styles.announcementButton, { backgroundColor: theme.surfaceAlt }, (!adminAnnouncement?.is_active || savingAnnouncement) && styles.disabledBtn]} onPress={() => void deactivateAnnouncement()} disabled={!adminAnnouncement?.is_active || savingAnnouncement}>
                <Text style={[styles.secondaryBtnText, { color: theme.text }]}>{t('profile.announcementHide')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {user && (
          <View style={[styles.sectionCard, { backgroundColor: theme.surface, borderColor: theme.borderSoft }]}> 
            <Text style={[styles.sectionTitle, { color: theme.text }]}>{isAdmin ? t('profile.manageTitle') : t('profile.myContentTitle')}</Text>
            <Text style={[styles.sectionSub, { color: theme.textMuted }]}>{isAdmin ? t('profile.manageSubtitle') : t('profile.myContentSubtitle')}</Text>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.adminTabsRow}>
              {adminSections.map((section) => (
                <TouchableOpacity
                  key={section.key}
                  style={[
                    styles.adminTab,
                    { backgroundColor: theme.surfaceAlt },
                    activeAdminTab === section.key && [styles.adminTabActive, { backgroundColor: theme.primary }],
                  ]}
                  onPress={() => setActiveAdminTab(section.key)}
                >
                  <Text style={[styles.adminTabText, { color: theme.textMuted }, activeAdminTab === section.key && styles.adminTabTextActive]}>
                    {section.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            {adminLoading ? (
              <View style={styles.loadingBox}>
                <ActivityIndicator color="#1D9E75" />
              </View>
            ) : (
              <>
                {activeAdminTab === 'locations' && adminLocations.map((item) => (
                  <AdminRow
                    key={item.id}
                    title={item.name}
                    subtitle={t('profile.createdOn', { date: formatDate(language, item.created_at) })}
                    onDelete={() => handleDelete('locations', item.id, t('profile.deleteLocationLabel', { name: item.name }))}
                    theme={theme}
                    deleteLabel={t('common.delete')}
                  />
                ))}

                {activeAdminTab === 'catches' && adminCatches.map((item) => (
                  <AdminRow
                    key={item.id}
                    title={`${item.fish_species ?? t('profile.catchWithoutSpecies')}${item.weight_kg ? ` · ${item.weight_kg} kg` : ''}`}
                    subtitle={`@${item.profiles?.username ?? t('profile.unknownUser')} · ${item.locations?.name ?? '-'} · ${formatDate(language, item.caught_at)}`}
                    onDelete={() => handleDelete('catches', item.id, t('profile.deleteCatchLabel'))}
                    theme={theme}
                    deleteLabel={t('common.delete')}
                  />
                ))}

                {activeAdminTab === 'groups' && adminGroups.map((item) => (
                  <AdminRow
                    key={item.id}
                    title={item.name}
                    subtitle={t('profile.codeAndDate', { code: item.invite_code, date: formatDate(language, item.created_at) })}
                    onDelete={() => handleDelete('groups', item.id, t('profile.deleteGroupLabel', { name: item.name }))}
                    theme={theme}
                    deleteLabel={t('common.delete')}
                  />
                ))}

                {activeAdminTab === 'messages' && adminMessages.map((item) => (
                  <AdminRow
                    key={item.id}
                    title={item.content?.trim() || t('profile.messageWithoutContent')}
                    subtitle={`@${item.profiles?.username ?? t('profile.unknownUser')} · ${formatDateTime(language, item.created_at)}`}
                    onDelete={() => handleDelete('messages', item.id, t('profile.deleteMessageLabel'))}
                    theme={theme}
                    deleteLabel={t('common.delete')}
                  />
                ))}

                {activeAdminTab === 'locations' && adminLocations.length === 0 && <EmptyAdminState label={isAdmin ? t('profile.noLocationsToModerate') : t('profile.noLocationsYet')} theme={theme} />}
                {activeAdminTab === 'catches' && adminCatches.length === 0 && <EmptyAdminState label={isAdmin ? t('profile.noCatchesToModerate') : t('profile.noCatchesYet')} theme={theme} />}
                {activeAdminTab === 'groups' && adminGroups.length === 0 && <EmptyAdminState label={isAdmin ? t('profile.noGroupsToModerate') : t('profile.noGroupsYet')} theme={theme} />}
                {activeAdminTab === 'messages' && adminMessages.length === 0 && <EmptyAdminState label={isAdmin ? t('profile.noMessagesToModerate') : t('profile.noMessagesYet')} theme={theme} />}
                {activeAdminTab === 'users' && (
                  <TextInput
                    style={[styles.input, styles.adminSearchInput, { backgroundColor: theme.inputBg, borderColor: theme.border, color: theme.text }]}
                    placeholder={t('profile.searchUsersPlaceholder')}
                    placeholderTextColor={theme.textSoft}
                    value={adminUserSearch}
                    onChangeText={setAdminUserSearch}
                    autoCapitalize="none"
                  />
                )}
                {activeAdminTab === 'users' && filteredAdminUsers.map((item) => (
                  <View key={item.id} style={[styles.adminRow, { borderTopColor: theme.borderSoft }]}> 
                    <View style={{ flex: 1 }}>
                      <View style={styles.adminUserTitleRow}>
                        <Text style={[styles.adminRowTitle, { color: theme.text }]}>@{item.username}</Text>
                        {item.role === 'admin' ? (
                          <View style={[styles.inlineAdminBadge, { backgroundColor: theme.badgeBg }]}> 
                            <Text style={[styles.inlineAdminBadgeText, { color: theme.badgeText }]}>{t('profile.admin')}</Text>
                          </View>
                        ) : null}
                      </View>
                      <Text style={[styles.adminRowSubtitle, { color: theme.textMuted }]}>{item.full_name?.trim() || t('profile.userFallback')}</Text>
                      {getModerationStatusLabel(item, 'mute') ? <Text style={[styles.adminRowSubtitle, { color: theme.primary }]}>{getModerationStatusLabel(item, 'mute')}</Text> : null}
                      {getModerationStatusLabel(item, 'ban') ? <Text style={[styles.adminRowSubtitle, { color: theme.dangerText }]}>{getModerationStatusLabel(item, 'ban')}</Text> : null}
                    </View>
                    <View style={styles.moderationActions}>
                      <TouchableOpacity
                        style={[styles.moderationBtn, { backgroundColor: item.role === 'admin' ? theme.surfaceAlt : theme.badgeBg }]}
                        onPress={() => void toggleAdminRole(item)}
                        disabled={updatingAdminRoleId === item.id}
                      >
                        {updatingAdminRoleId === item.id ? (
                          <ActivityIndicator color={item.role === 'admin' ? theme.text : theme.badgeText} size="small" />
                        ) : (
                          <Text style={[styles.moderationBtnText, { color: item.role === 'admin' ? theme.text : theme.badgeText }]}>
                            {item.role === 'admin' ? t('profile.removeAdmin') : t('profile.makeAdmin')}
                          </Text>
                        )}
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.moderationBtn, { backgroundColor: isModerationActive(item, 'mute') ? theme.surfaceAlt : theme.primarySoft }]}
                        onPress={() => {
                          setModerationUser(item);
                          setModerationKind('mute');
                          setModerationDuration('24h');
                          if (isModerationActive(item, 'mute')) {
                            void applyModeration('mute', 'clear');
                            return;
                          }
                        }}
                      >
                        <Text style={[styles.moderationBtnText, { color: isModerationActive(item, 'mute') ? theme.text : (mode === 'dark' ? '#dcfff3' : theme.primaryStrong) }]}>{isModerationActive(item, 'mute') ? t('profile.unmuteUser') : t('profile.muteUser')}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.moderationBtn, { backgroundColor: isModerationActive(item, 'ban') ? theme.surfaceAlt : theme.dangerSoft }]}
                        onPress={() => {
                          setModerationUser(item);
                          setModerationKind('ban');
                          setModerationDuration('24h');
                          if (isModerationActive(item, 'ban')) {
                            void applyModeration('ban', 'clear');
                            return;
                          }
                        }}
                      >
                        <Text style={[styles.moderationBtnText, { color: isModerationActive(item, 'ban') ? theme.text : theme.dangerText }]}>{isModerationActive(item, 'ban') ? t('profile.unbanUser') : t('profile.banUser')}</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
                {activeAdminTab === 'users' && adminUsers.length === 0 && <EmptyAdminState label={t('profile.noUsersToModerate')} theme={theme} />}
                {activeAdminTab === 'users' && adminUsers.length > 0 && filteredAdminUsers.length === 0 && <EmptyAdminState label={t('profile.noUsersMatch')} theme={theme} />}
              </>
            )}
          </View>
        )}
      </ScrollView>

      <Modal visible={!!moderationUser && !isModerationActive(moderationUser, moderationKind)} transparent animationType="slide" onRequestClose={() => setModerationUser(null)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: theme.surface }]}> 
            <Text style={[styles.modalTitle, { color: theme.text }]}>{t('profile.moderationTitle')}</Text>
            <Text style={[styles.modalSub, { color: theme.textMuted }]}>{moderationUser ? `@${moderationUser.username} · ${t('profile.moderationSubtitle')}` : t('profile.moderationSubtitle')}</Text>
            <View style={styles.durationGrid}>
              {moderationOptions.map((option) => (
                <TouchableOpacity
                  key={option.key}
                  style={[
                    styles.durationChip,
                    { backgroundColor: moderationDuration === option.key ? theme.primary : theme.surfaceAlt },
                  ]}
                  onPress={() => setModerationDuration(option.key)}
                >
                  <Text style={[styles.durationChipText, { color: moderationDuration === option.key ? '#fff' : theme.text }]}>{option.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.modalActions}>
              <TouchableOpacity style={[styles.cancelBtn, { borderColor: theme.border }]} onPress={() => setModerationUser(null)}>
                <Text style={[styles.cancelText, { color: theme.textMuted }]}>{t('common.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.confirmBtn, { backgroundColor: moderationKind === 'ban' ? theme.dangerText : theme.primary }]} onPress={() => void applyModeration(moderationKind, 'set')}>
                <Text style={styles.confirmText}>{t('profile.moderationApply')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
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
        detailsLabel={t('auth.rateLimitDetailsLabel')}
        buttonLabel={t('auth.ok')}
        autoCloseMs={5000}
        variant="warning"
        onClose={() => setNoticeState(null)}
      />
    </SafeAreaView>
  );
}

function StatCard({ value, label, theme }: { value: number; label: string; theme: ReturnType<typeof getAppTheme> }) {
  return (
    <View style={[styles.statCard, { backgroundColor: theme.surface, borderColor: theme.borderSoft }]}> 
      <Text style={[styles.statValue, { color: theme.primary }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: theme.textMuted }]}>{label}</Text>
    </View>
  );
}

function AdminRow({ title, subtitle, onDelete, theme, deleteLabel }: { title: string; subtitle: string; onDelete: () => void; theme: ReturnType<typeof getAppTheme>; deleteLabel: string }) {
  return (
    <View style={[styles.adminRow, { borderTopColor: theme.borderSoft }]}> 
      <View style={{ flex: 1 }}>
        <Text style={[styles.adminRowTitle, { color: theme.text }]} numberOfLines={2}>{title}</Text>
        <Text style={[styles.adminRowSubtitle, { color: theme.textMuted }]}>{subtitle}</Text>
      </View>
      <TouchableOpacity style={[styles.deleteBtn, { backgroundColor: theme.dangerSoft }]} onPress={onDelete}>
        <Text style={[styles.deleteBtnText, { color: theme.dangerText }]}>{deleteLabel}</Text>
      </TouchableOpacity>
    </View>
  );
}

function EmptyAdminState({ label, theme }: { label: string; theme: ReturnType<typeof getAppTheme> }) {
  return (
    <View style={styles.emptyAdminState}>
      <Text style={[styles.emptyAdminText, { color: theme.textSoft }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f4f6f8' },
  container: { flex: 1 },
  content: { padding: 16, gap: 14 },

  headerCard: {
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 16,
    flexDirection: 'row',
    gap: 14,
    alignItems: 'center',
    borderWidth: 0.5,
    borderColor: '#e9e9e9',
  },
  avatarWrap: {
    position: 'relative',
    borderRadius: 36,
    borderWidth: 1,
    padding: 4,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#1D9E75',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarBadgeText: { color: '#fff', fontSize: 14, fontWeight: '900', lineHeight: 16 },
  avatarText: { color: '#fff', fontSize: 26, fontWeight: '800' },
  avatarHint: { fontSize: 12, marginTop: 6 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  username: { fontSize: 18, fontWeight: '800', color: '#1a1a1a' },
  adminBadge: { backgroundColor: '#FAEEDA', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999 },
  adminBadgeText: { color: '#8A560A', fontSize: 11, fontWeight: '800' },
  email: { fontSize: 13, color: '#666', marginTop: 2 },
  joined: { fontSize: 12, color: '#999', marginTop: 4 },

  statsRow: { flexDirection: 'row', gap: 10 },
  statCard: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
    borderWidth: 0.5,
    borderColor: '#e9e9e9',
  },
  statValue: { fontSize: 22, fontWeight: '800', color: '#1D9E75' },
  statLabel: { fontSize: 12, color: '#888', marginTop: 4 },

  sectionCard: {
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 16,
    borderWidth: 0.5,
    borderColor: '#e9e9e9',
  },
  sectionTitle: { fontSize: 17, fontWeight: '800', color: '#1a1a1a', marginBottom: 6 },
  sectionSub: { fontSize: 13, color: '#777', marginBottom: 12 },
  inputLabel: { fontSize: 13, fontWeight: '600', color: '#444', marginBottom: 6, marginTop: 10 },
  input: {
    backgroundColor: '#fafafa',
    borderWidth: 1,
    borderColor: '#e1e1e1',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    color: '#1a1a1a',
  },
  passwordInputWrap: {
    position: 'relative',
    justifyContent: 'center',
  },
  passwordInput: {
    paddingRight: 84,
  },
  passwordToggle: {
    position: 'absolute',
    right: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 999,
  },
  passwordToggleText: {
    fontSize: 12,
    fontWeight: '800',
  },
  textArea: { minHeight: 92, textAlignVertical: 'top' },
  primaryBtn: {
    marginTop: 16,
    backgroundColor: '#1D9E75',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryBtnText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  secondaryBtn: {
    marginTop: 10,
    backgroundColor: '#f4f6f8',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  secondaryBtnText: { color: '#444', fontSize: 15, fontWeight: '700' },
  disabledBtn: { opacity: 0.65 },
  themeRow: {
    marginTop: 14,
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  themeTitle: { fontSize: 15, fontWeight: '800' },
  themeSub: { fontSize: 12, marginTop: 4 },
  themeToggle: { paddingHorizontal: 14, paddingVertical: 11, borderRadius: 999 },
  themeToggleText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  securityCard: {
    marginTop: 14,
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
  },
  tertiaryBtn: {
    marginTop: 12,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
  },
  cooldownHint: {
    marginTop: 10,
    fontSize: 12,
    lineHeight: 18,
  },
  langButtonsRow: { flexDirection: 'row', gap: 8 },
  langButton: { minWidth: 54, borderRadius: 999, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 11, alignItems: 'center' },
  langButtonText: { fontSize: 12, fontWeight: '800' },
  announcementStatus: { fontSize: 12, fontWeight: '700', marginBottom: 6 },
  announcementActions: { flexDirection: 'row', gap: 10, marginTop: 6 },
  announcementButton: { flex: 1, marginTop: 0 },

  adminTabsRow: { gap: 8, paddingBottom: 12 },
  adminSearchInput: { marginBottom: 12 },
  adminTab: { backgroundColor: '#f1f1f1', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999 },
  adminTabActive: { backgroundColor: '#1D9E75' },
  adminTabText: { color: '#666', fontSize: 13, fontWeight: '600' },
  adminTabTextActive: { color: '#fff' },
  loadingBox: { paddingVertical: 24, alignItems: 'center' },
  adminRow: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
    paddingVertical: 12,
    borderTopWidth: 0.5,
    borderTopColor: '#efefef',
  },
  adminRowTitle: { fontSize: 14, fontWeight: '700', color: '#1a1a1a' },
  adminRowSubtitle: { fontSize: 12, color: '#888', marginTop: 4 },
  adminUserTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  inlineAdminBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999 },
  inlineAdminBadgeText: { fontSize: 10, fontWeight: '800' },
  moderationActions: { gap: 8 },
  moderationBtn: { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 9, minWidth: 96, alignItems: 'center' },
  moderationBtnText: { fontSize: 12, fontWeight: '800' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  modalCard: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24 },
  modalTitle: { fontSize: 18, fontWeight: '800', marginBottom: 4 },
  modalSub: { fontSize: 13, marginBottom: 14 },
  durationGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 14 },
  durationChip: { borderRadius: 999, paddingHorizontal: 14, paddingVertical: 10 },
  durationChipText: { fontSize: 12, fontWeight: '800' },
  modalActions: { flexDirection: 'row', gap: 10 },
  cancelBtn: { flex: 1, borderRadius: 12, borderWidth: 1, paddingVertical: 12, alignItems: 'center' },
  cancelText: { fontSize: 13, fontWeight: '700' },
  confirmBtn: { flex: 1, borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  confirmText: { fontSize: 13, fontWeight: '800', color: '#fff' },
  deleteBtn: { backgroundColor: '#FFF1F1', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  deleteBtnText: { color: '#C53A3A', fontWeight: '800', fontSize: 12 },
  emptyAdminState: { paddingVertical: 20, alignItems: 'center' },
  emptyAdminText: { fontSize: 13, color: '#999' },
});