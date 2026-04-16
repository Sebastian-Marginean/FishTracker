import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  TextInput, ActivityIndicator, Alert, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import SuccessSheet from '../../components/SuccessSheet';
import { supabase } from '../../lib/supabase';
import { formatDate, formatDateTime, useI18n } from '../../i18n';
import { useAuthStore } from '../../store/authStore';
import { useLanguageStore } from '../../store/languageStore';
import { useThemeStore } from '../../store/themeStore';
import { getAppTheme } from '../../theme';
import type { Catch, Group, Location, Message } from '../../types';

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

type AdminTab = 'locations' | 'catches' | 'groups' | 'messages';

type AdminLocation = Pick<Location, 'id' | 'name' | 'created_at'> & { created_by?: string };
type AdminCatch = Pick<Catch, 'id' | 'fish_species' | 'weight_kg' | 'caught_at' | 'user_id'> & {
  profiles?: { username?: string } | null;
  locations?: { name?: string } | null;
};
type AdminGroup = Pick<Group, 'id' | 'name' | 'invite_code' | 'created_at' | 'owner_id'>;
type AdminMessage = Pick<Message, 'id' | 'content' | 'created_at' | 'user_id'> & {
  profiles?: { username?: string } | null;
};

export default function ProfileScreen() {
  const { user, profile, updateProfile, updateEmail, updatePassword, fetchProfile, signOut } = useAuthStore();
  const { language, t } = useI18n();
  const selectedLanguage = useLanguageStore((state) => state.language);
  const setLanguage = useLanguageStore((state) => state.setLanguage);
  const mode = useThemeStore((state) => state.mode);
  const toggleMode = useThemeStore((state) => state.toggleMode);
  const theme = getAppTheme(mode);
  const [fullName, setFullName] = useState('');
  const [bio, setBio] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [stats, setStats] = useState<ProfileStats>({ catches: 0, sessions: 0, groups: 0 });
  const [saving, setSaving] = useState(false);
  const [updatingEmail, setUpdatingEmail] = useState(false);
  const [updatingPassword, setUpdatingPassword] = useState(false);
  const [successState, setSuccessState] = useState<SuccessState | null>(null);
  const [emailCooldownUntil, setEmailCooldownUntil] = useState<number | null>(null);
  const [emailCooldownLeft, setEmailCooldownLeft] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [adminLoading, setAdminLoading] = useState(false);
  const [activeAdminTab, setActiveAdminTab] = useState<AdminTab>('locations');
  const [adminLocations, setAdminLocations] = useState<AdminLocation[]>([]);
  const [adminCatches, setAdminCatches] = useState<AdminCatch[]>([]);
  const [adminGroups, setAdminGroups] = useState<AdminGroup[]>([]);
  const [adminMessages, setAdminMessages] = useState<AdminMessage[]>([]);

  const isAdmin = profile?.role === 'admin';

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
    setFullName(profile?.full_name ?? '');
    setBio(profile?.bio ?? '');
  }, [profile?.full_name, profile?.bio]);

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

    const [locationsRes, catchesRes, groupsRes, messagesRes] = await Promise.all([
      isAdmin ? locationsQuery : locationsQuery.eq('created_by', user.id),
      isAdmin ? catchesQuery : catchesQuery.eq('user_id', user.id),
      isAdmin ? groupsQuery : groupsQuery.eq('owner_id', user.id),
      isAdmin ? messagesQuery : messagesQuery.eq('user_id', user.id),
    ]);

    setAdminLocations((locationsRes.data ?? []) as AdminLocation[]);
    setAdminCatches((catchesRes.data ?? []) as AdminCatch[]);
    setAdminGroups((groupsRes.data ?? []) as AdminGroup[]);
    setAdminMessages((messagesRes.data ?? []) as AdminMessage[]);
    setAdminLoading(false);
  }, [isAdmin, user]);

  const refreshAll = useCallback(async () => {
    setRefreshing(true);
    await fetchProfile();
    await loadProfileData();
    await loadAdminData();
    setRefreshing(false);
  }, [fetchProfile, loadAdminData, loadProfileData]);

  useFocusEffect(
    useCallback(() => {
      void refreshAll();
    }, [refreshAll])
  );

  const handleSaveProfile = async () => {
    setSaving(true);
    const { error } = await updateProfile({
      full_name: fullName.trim() || null,
      bio: bio.trim() || null,
    } as any);
    setSaving(false);

    if (error) {
      Alert.alert(t('common.error'), error);
      return;
    }

    Alert.alert(t('profile.updatedTitle'), t('profile.updatedMessage'));
    await fetchProfile();
  };

  const handleChangeEmail = async () => {
    if (!newEmail.trim()) {
      Alert.alert(t('common.error'), t('auth.emailRequired'));
      return;
    }

    if (emailCooldownLeft > 0) {
      Alert.alert(t('common.info'), t('auth.emailCooldown', { seconds: emailCooldownLeft }));
      return;
    }

    setUpdatingEmail(true);
    const { error } = await updateEmail(newEmail.trim());
    setUpdatingEmail(false);

    if (error) {
      if (/email rate limit exceeded/i.test(error)) {
        setEmailCooldownUntil(Date.now() + 60_000);
        Alert.alert(t('common.error'), t('auth.emailRateLimit'));
        return;
      }

      Alert.alert(t('common.error'), error);
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
      Alert.alert(t('common.error'), t('auth.passwordTooShort'));
      return;
    }
    if (newPassword.length < 6) {
      Alert.alert(t('common.error'), t('auth.passwordTooShort'));
      return;
    }
    if (newPassword !== confirmNewPassword) {
      Alert.alert(t('common.error'), t('auth.passwordMismatch'));
      return;
    }

    setUpdatingPassword(true);
    const { error } = await updatePassword(newPassword);
    setUpdatingPassword(false);

    if (error) {
      Alert.alert(t('common.error'), error);
      return;
    }

    setNewPassword('');
    setConfirmNewPassword('');
    Alert.alert(t('profile.passwordUpdatedTitle'), t('profile.passwordUpdatedMessage'));
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
  ], [t]);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}> 
      <ScrollView
        style={[styles.container, { backgroundColor: theme.background }]}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refreshAll} tintColor={theme.primary} />}
      >
        <View style={[styles.headerCard, { backgroundColor: theme.surface, borderColor: theme.borderSoft }]}> 
          <View style={[styles.avatar, { backgroundColor: theme.primary }]}>
            <Text style={styles.avatarText}>{profile?.username?.[0]?.toUpperCase() ?? '?'}</Text>
          </View>
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
          </View>
        </View>

        <View style={styles.statsRow}>
          <StatCard value={stats.catches} label={t('profile.statsCatches')} theme={theme} />
          <StatCard value={stats.sessions} label={t('profile.statsSessions')} theme={theme} />
          <StatCard value={stats.groups} label={t('profile.statsGroups')} theme={theme} />
        </View>

        <View style={[styles.sectionCard, { backgroundColor: theme.surface, borderColor: theme.borderSoft }]}> 
          <Text style={[styles.sectionTitle, { color: theme.text }]}>{t('profile.myProfile')}</Text>
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
            <TextInput
              style={[styles.input, { backgroundColor: theme.inputBg, borderColor: theme.border, color: theme.text }]}
              placeholder={t('profile.newPasswordPlaceholder')}
              placeholderTextColor="#bbb"
              value={newPassword}
              onChangeText={setNewPassword}
              secureTextEntry
            />

            <Text style={[styles.inputLabel, { color: theme.textMuted }]}>{t('profile.confirmNewPassword')}</Text>
            <TextInput
              style={[styles.input, { backgroundColor: theme.inputBg, borderColor: theme.border, color: theme.text }]}
              placeholder={t('profile.confirmNewPasswordPlaceholder')}
              placeholderTextColor="#bbb"
              value={confirmNewPassword}
              onChangeText={setConfirmNewPassword}
              secureTextEntry
            />
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
              </>
            )}
          </View>
        )}
      </ScrollView>

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
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#1D9E75',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: '#fff', fontSize: 26, fontWeight: '800' },
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

  adminTabsRow: { gap: 8, paddingBottom: 12 },
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
  deleteBtn: { backgroundColor: '#FFF1F1', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  deleteBtnText: { color: '#C53A3A', fontWeight: '800', fontSize: 12 },
  emptyAdminState: { paddingVertical: 20, alignItems: 'center' },
  emptyAdminText: { fontSize: 13, color: '#999' },
});