// src/screens/groups/GroupsScreen.tsx
// Grupuri private de pescari

import React, { useEffect, useState } from 'react';
import { useIsFocused } from '@react-navigation/native';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Modal, TextInput, Alert, ActivityIndicator,
  FlatList, Clipboard, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import ConfirmActionSheet from '../../components/ConfirmActionSheet';
import { formatDate, formatTime, useI18n } from '../../i18n';
import MessageActionSheet from '../../components/MessageActionSheet';
import SuccessSheet from '../../components/SuccessSheet';
import { supabase } from '../../lib/supabase';
import { useAuthStore } from '../../store/authStore';
import { useThemeStore } from '../../store/themeStore';
import { useUnreadStore } from '../../store/unreadStore';
import { getAppTheme } from '../../theme';
import type { Group, GroupMessage } from '../../types';

interface SuccessState {
  title: string;
  message: string;
  details?: string;
  detailsLabel?: string;
  copyValue?: string;
}

export default function GroupsScreen() {
  const insets = useSafeAreaInsets();
  const isFocused = useIsFocused();
  const { user, profile } = useAuthStore();
  const { language, t } = useI18n();
  const mode = useThemeStore((state) => state.mode);
  const theme = getAppTheme(mode);
  const isDark = mode === 'dark';
  const isAdmin = profile?.role === 'admin';
  const refreshUnread = useUnreadStore((state) => state.refreshUnread);
  const [myGroups, setMyGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeGroup, setActiveGroup] = useState<Group | null>(null);
  const [groupCatches, setGroupCatches] = useState<any[]>([]);
  const [groupMembers, setGroupMembers] = useState<any[]>([]);
  const [groupMessages, setGroupMessages] = useState<any[]>([]);
  const [groupMessageText, setGroupMessageText] = useState('');
  const [editingGroupMessage, setEditingGroupMessage] = useState<GroupMessage | null>(null);
  const [loadingGroupMessages, setLoadingGroupMessages] = useState(false);
  const [groupUnreadCounts, setGroupUnreadCounts] = useState<Record<string, number>>({});

  // Modals
  const [createModal, setCreateModal] = useState(false);
  const [joinModal, setJoinModal] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupDesc, setNewGroupDesc] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [activeTab, setActiveTab] = useState<'jurnal' | 'statistici' | 'membri' | 'chat'>('jurnal');
  const [saving, setSaving] = useState(false);
  const [successState, setSuccessState] = useState<SuccessState | null>(null);
  const [messageActionState, setMessageActionState] = useState<any | null>(null);
  const [pendingDeleteMessageId, setPendingDeleteMessageId] = useState<string | null>(null);
  const keyboardBehavior = Platform.OS === 'ios' ? 'padding' : 'height';

  useEffect(() => {
    void fetchMyGroups(user?.id);
  }, [user?.id, isFocused]);

  const fetchMyGroups = async (userId?: string) => {
    if (!userId) {
      setMyGroups([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const { data } = await supabase
      .from('group_members')
      .select('groups(*)')
      .eq('user_id', userId);
    if (data) {
      const groups = data.map((d: any) => d.groups).filter(Boolean);
      setMyGroups(groups as Group[]);
      await fetchGroupUnreadCounts(userId, groups as Group[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (!user?.id) return;

    const channel = supabase
      .channel(`groups-memberships-${user.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'group_members', filter: `user_id=eq.${user.id}` },
        () => {
          void fetchMyGroups(user.id);
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [user?.id]);

  useEffect(() => {
    if (!activeGroup?.id) return;

    const channel = supabase
      .channel(`group-chat-${activeGroup.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'group_messages', filter: `group_id=eq.${activeGroup.id}` },
        () => {
          void fetchGroupMessages(activeGroup.id);
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [activeGroup?.id]);

  useEffect(() => {
    if (!user?.id) return;

    const channel = supabase
      .channel(`groups-unread-${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'group_messages' }, () => {
        void fetchGroupUnreadCounts(user.id);
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [user?.id, myGroups.length]);

  useEffect(() => {
    if (activeGroup?.id && activeTab === 'chat') {
      void markGroupAsRead(activeGroup.id);
    }
  }, [activeGroup?.id, activeTab]);

  const openGroup = async (group: Group) => {
    setActiveGroup(group);
    setActiveTab('jurnal');
    fetchGroupData(group.id);
  };

  const fetchGroupData = async (groupId: string) => {
    // Membrii
    const { data: membersData } = await supabase
      .from('group_members')
      .select('*, profiles(username, avatar_url)')
      .eq('group_id', groupId);
    if (membersData) setGroupMembers(membersData);

    const { data: catchData } = await supabase
      .from('catches')
      .select('*, profiles(username)')
      .eq('group_id', groupId)
      .order('caught_at', { ascending: false })
      .limit(50);
    if (catchData) setGroupCatches(catchData);

    await fetchGroupMessages(groupId);
  };

  const fetchGroupMessages = async (groupId: string) => {
    setLoadingGroupMessages(true);
    const { data } = await supabase
      .from('group_messages')
      .select('id, group_id, user_id, content, media_url, created_at, profiles:profiles!group_messages_user_id_fkey(username, avatar_url)')
      .eq('group_id', groupId)
      .order('created_at', { ascending: true })
      .limit(100);
    if (data) setGroupMessages(data);
    setLoadingGroupMessages(false);
  };

  const canManageMessage = (messageUserId?: string) => !!user?.id && (messageUserId === user.id || isAdmin);

  const fetchGroupUnreadCounts = async (userId?: string, groupsInput?: Group[]) => {
    if (!userId) {
      setGroupUnreadCounts({});
      return;
    }

    const activeGroups = groupsInput ?? myGroups;
    if (!activeGroups.length) {
      setGroupUnreadCounts({});
      return;
    }

    const groupIds = activeGroups.map((group) => group.id);
    const { data: memberRows } = await supabase
      .from('group_members')
      .select('group_id, last_read_at')
      .eq('user_id', userId)
      .in('group_id', groupIds);

    const readMap = new Map<string, string | null>();
    for (const row of memberRows ?? []) {
      readMap.set((row as any).group_id, (row as any).last_read_at ?? null);
    }

    const { data: messageRows } = await supabase
      .from('group_messages')
      .select('group_id, user_id, created_at')
      .in('group_id', groupIds)
      .order('created_at', { ascending: false });

    const nextCounts: Record<string, number> = {};
    for (const group of activeGroups) {
      nextCounts[group.id] = 0;
    }

    for (const row of messageRows ?? []) {
      const groupId = (row as any).group_id as string;
      const lastReadAt = readMap.get(groupId);
      const isUnread = (row as any).user_id !== userId && (!lastReadAt || new Date((row as any).created_at).getTime() > new Date(lastReadAt).getTime());
      if (isUnread) {
        nextCounts[groupId] = (nextCounts[groupId] ?? 0) + 1;
      }
    }

    setGroupUnreadCounts(nextCounts);
  };

  const markGroupAsRead = async (groupId: string) => {
    if (!user?.id) return;
    await supabase
      .from('group_members')
      .update({ last_read_at: new Date().toISOString() })
      .eq('group_id', groupId)
      .eq('user_id', user.id);
    await fetchGroupUnreadCounts(user.id);
    refreshUnread();
  };

  const sendGroupMessage = async () => {
    if (!activeGroup?.id || !user?.id || !groupMessageText.trim()) return;

    const content = groupMessageText.trim();
    const editingId = editingGroupMessage?.id;
    setGroupMessageText('');

    if (editingId) {
      const { error } = await supabase
        .from('group_messages')
        .update({ content })
        .eq('id', editingId);

      if (error) {
        setGroupMessageText(content);
        Alert.alert(t('groups.messageEditFailed'), error.message);
        return;
      }

      setEditingGroupMessage(null);
      await fetchGroupMessages(activeGroup.id);
      return;
    }

    const { error } = await supabase.from('group_messages').insert({
      group_id: activeGroup.id,
      user_id: user.id,
      content,
    });

    if (error) {
      setGroupMessageText(content);
      Alert.alert(t('groups.messageSendFailed'), error.message);
      return;
    }

    await fetchGroupMessages(activeGroup.id);
    await markGroupAsRead(activeGroup.id);
  };

  const deleteGroupMessage = async (messageId: string) => {
    const { error } = await supabase.from('group_messages').delete().eq('id', messageId);
    if (error) {
      Alert.alert(t('groups.messageDeleteFailed'), error.message);
      return;
    }

    if (editingGroupMessage?.id === messageId) {
      setEditingGroupMessage(null);
      setGroupMessageText('');
    }
    if (activeGroup?.id) {
      await fetchGroupMessages(activeGroup.id);
      await fetchGroupUnreadCounts(user?.id);
      refreshUnread();
    }
  };

  const openGroupMessageActions = (message: any) => {
    if (!canManageMessage(message.user_id)) return;
    setMessageActionState(message);
  };

  const handleGroupMessageActionEdit = () => {
    if (!messageActionState) return;
    setEditingGroupMessage(messageActionState as GroupMessage);
    setGroupMessageText(messageActionState.content ?? '');
    setMessageActionState(null);
  };

  const handleGroupMessageActionDelete = () => {
    if (!messageActionState) return;
    const targetId = String(messageActionState.id);
    setMessageActionState(null);
    setPendingDeleteMessageId(targetId);
  };

  const confirmDeleteGroupMessage = () => {
    if (!pendingDeleteMessageId) return;
    const targetId = pendingDeleteMessageId;
    setPendingDeleteMessageId(null);
    void deleteGroupMessage(targetId);
  };

  const cancelGroupEdit = () => {
    setEditingGroupMessage(null);
    setGroupMessageText('');
  };

  const createGroup = async () => {
    if (!newGroupName.trim() || !user) return Alert.alert(t('common.error'), t('groups.groupNameRequired'));
    setSaving(true);
    const { data, error } = await supabase
      .from('groups')
      .insert({ owner_id: user.id, name: newGroupName.trim(), description: newGroupDesc.trim() || null })
      .select()
      .single();

    if (error || !data) {
      setSaving(false);
      return Alert.alert(t('common.error'), error?.message ?? t('common.unknown'));
    }

    // Adaugă creatorul ca owner
    await supabase.from('group_members').insert({ group_id: data.id, user_id: user.id, role: 'owner' });

    setSaving(false);
    setCreateModal(false);
    setNewGroupName(''); setNewGroupDesc('');
    setSuccessState({
      title: t('groups.groupCreatedTitle'),
      message: t('groups.groupCreatedMessage', { name: data.name }),
      details: data.invite_code,
      detailsLabel: t('groups.inviteCodeLabel'),
      copyValue: data.invite_code,
    });
    await fetchMyGroups(user.id);
  };

  const joinGroup = async () => {
    if (!inviteCode.trim() || !user) return;
    setSaving(true);
    const { data: groupRows, error } = await supabase.rpc('get_group_by_invite_code', {
      invite_code_input: inviteCode.trim(),
    });

    const group = groupRows?.[0];

    if (error || !group) {
      setSaving(false);
      return Alert.alert(t('common.error'), t('groups.invalidInvite'));
    }

    // Verifică dacă e deja membru
    const { data: existing } = await supabase
      .from('group_members')
      .select('id')
      .eq('group_id', group.id)
      .eq('user_id', user.id)
      .single();

    if (existing) {
      setSaving(false);
      return Alert.alert(t('common.info'), t('groups.alreadyMember'));
    }

    await supabase.from('group_members').insert({ group_id: group.id, user_id: user.id, role: 'member' });
    setSaving(false);
    setJoinModal(false);
    setInviteCode('');
    setSuccessState({
      title: t('groups.joinedTitle'),
      message: t('groups.joinedMessage', { name: group.name }),
      details: t('groups.joinedDetails'),
    });
    await fetchMyGroups(user.id);
  };

  // Statistici per membru
  const getMemberStats = (userId: string) => {
    const memberCatches = groupCatches.filter((c) => c.user_id === userId);
    const total = memberCatches.length;
    const totalKg = memberCatches.reduce((s, c) => s + (c.weight_kg ?? 0), 0);
    const maxKg = memberCatches.reduce((m, c) => Math.max(m, c.weight_kg ?? 0), 0);
    return { total, totalKg: totalKg.toFixed(2), maxKg: maxKg.toFixed(2) };
  };

  const copyInviteCode = () => {
    if (!activeGroup?.invite_code) return;
    Clipboard.setString(activeGroup.invite_code);
    Alert.alert(t('groups.inviteCopiedTitle'), t('groups.inviteCopiedMessage'));
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }] }>
      <View style={[styles.header, { paddingTop: 12 + Math.max(insets.top * 0.15, 0), backgroundColor: theme.surface, borderBottomColor: theme.borderSoft }] }>
        <Text style={[styles.headerTitle, { color: theme.text }]}>👥 {t('groups.title')}</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TouchableOpacity style={[styles.joinBtn, { backgroundColor: isDark ? theme.surfaceAlt : '#E6F1FB' }]} onPress={() => setJoinModal(true)}>
            <Text style={styles.joinBtnText}>{t('groups.join')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.addBtn, { backgroundColor: theme.primary }]} onPress={() => setCreateModal(true)}>
            <Text style={styles.addBtnText}>{t('groups.new')}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={theme.primary} size="large" /></View>
      ) : myGroups.length === 0 ? (
        <View style={styles.center}>
          <Text style={{ fontSize: 50, marginBottom: 12 }}>👥</Text>
          <Text style={[styles.emptyText, { color: theme.textMuted }]}>{t('groups.empty')}</Text>
          <Text style={[styles.emptySub, { color: theme.textSoft }]}>{t('groups.emptyHint')}</Text>
          <TouchableOpacity style={[styles.addBtn, { backgroundColor: theme.primary }]} onPress={() => setCreateModal(true)}>
            <Text style={styles.addBtnText}>{t('groups.createFirst')}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={myGroups}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 16 }}
          renderItem={({ item }) => (
            <TouchableOpacity style={[styles.groupCard, { backgroundColor: theme.surface, borderColor: theme.borderSoft }]} onPress={() => openGroup(item)}>
              <View style={[styles.groupAvatar, { backgroundColor: isDark ? theme.primarySoft : '#E1F5EE' }]}>
                <Text style={{ fontSize: 26 }}>🎣</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.groupName, { color: theme.text }]}>{item.name}</Text>
                {item.description && <Text style={[styles.groupDesc, { color: theme.textMuted }]} numberOfLines={1}>{item.description}</Text>}
                <Text style={[styles.groupCode, { color: theme.primary }]}>{t('groups.code', { code: item.invite_code })}</Text>
              </View>
              {(groupUnreadCounts[item.id] ?? 0) > 0 && (
                <View style={[styles.groupUnreadBadge, { backgroundColor: theme.primary }]}>
                  <Text style={styles.groupUnreadText}>{groupUnreadCounts[item.id]}</Text>
                </View>
              )}
              <Text style={{ fontSize: 20, color: theme.textSoft }}>›</Text>
            </TouchableOpacity>
          )}
        />
      )}

      {/* Modal detalii grup */}
      <Modal visible={!!activeGroup} animationType="slide">
        <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }] }>
          <View style={[styles.detailHeader, { paddingTop: 12 + Math.max(insets.top * 0.15, 0), backgroundColor: theme.surface, borderBottomColor: theme.borderSoft }] }>
            <TouchableOpacity onPress={() => setActiveGroup(null)}>
              <Text style={[styles.backBtn, { color: theme.primary }]}>‹ {t('groups.back')}</Text>
            </TouchableOpacity>
            <Text style={[styles.detailTitle, { color: theme.text }]} numberOfLines={1}>{activeGroup?.name}</Text>
            <View style={{ width: 60 }} />
          </View>

          {/* Cod invitare */}
          <View style={[styles.inviteBar, { backgroundColor: isDark ? theme.primarySoft : '#E1F5EE' }]}>
            <Text style={[styles.inviteLabel, { color: isDark ? theme.text : theme.primaryStrong }]}>{t('groups.inviteCode')}</Text>
            <Text style={[styles.inviteCode, { color: theme.primary }] }>{activeGroup?.invite_code}</Text>
            <TouchableOpacity style={[styles.inviteCopyBtn, { backgroundColor: isDark ? theme.primary : theme.primaryStrong }]} onPress={copyInviteCode}>
              <Text style={styles.inviteCopyText}>{t('groups.copy')}</Text>
            </TouchableOpacity>
          </View>

          {/* Tab-uri */}
          <View style={[styles.tabs, { backgroundColor: theme.surface, borderBottomColor: theme.borderSoft }] }>
            {(['jurnal', 'statistici', 'membri', 'chat'] as const).map((tab) => (
              <TouchableOpacity
                key={tab}
                style={[styles.tab, activeTab === tab && styles.tabActive, activeTab === tab && { borderBottomColor: theme.primary }]}
                onPress={() => setActiveTab(tab)}
              >
                <Text style={[styles.tabText, { color: theme.tabInactive }, activeTab === tab && styles.tabTextActive, activeTab === tab && { color: theme.primary }]}>
                  {tab === 'jurnal' ? t('groups.tabJournal') : tab === 'statistici' ? t('groups.tabStats') : tab === 'membri' ? t('groups.tabMembers') : `${t('groups.tabChat')}${(groupUnreadCounts[activeGroup?.id ?? ''] ?? 0) > 0 ? ` (${groupUnreadCounts[activeGroup?.id ?? '']})` : ''}`}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {activeTab === 'chat' ? (
            <KeyboardAvoidingView style={{ flex: 1 }} behavior={keyboardBehavior} keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 24}>
              {editingGroupMessage && (
                <View style={[styles.editingBanner, { backgroundColor: theme.surface, borderBottomColor: theme.borderSoft }]}> 
                  <View style={[styles.editingAccent, { backgroundColor: theme.primary }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.editingTitle, { color: theme.text }]}>{t('groups.editingMessage')}</Text>
                    <Text style={[styles.editingPreview, { color: theme.textMuted }]} numberOfLines={2}>{editingGroupMessage.content || t('sheet.emptyMessage')}</Text>
                  </View>
                  <TouchableOpacity onPress={cancelGroupEdit}>
                    <Text style={[styles.editingCancel, { color: theme.primary }]}>{t('sheet.keep')}</Text>
                  </TouchableOpacity>
                </View>
              )}

              {loadingGroupMessages ? (
                <View style={styles.center}><ActivityIndicator color={theme.primary} /></View>
              ) : (
                <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 8 }}>
                  {groupMessages.length === 0 ? (
                    <View style={styles.center}>
                      <Text style={[styles.emptyText, { color: theme.textMuted }]}>{t('groups.noChatMessages')}</Text>
                    </View>
                  ) : groupMessages.map((message: any) => {
                    const isMe = message.user_id === user?.id;
                    return (
                      <TouchableOpacity key={message.id} activeOpacity={0.9} delayLongPress={220} onLongPress={() => openGroupMessageActions(message)} style={[styles.groupMsgRow, isMe && styles.groupMsgRowMe]}>
                        {!isMe && (
                          <View style={[styles.memberAvatar, { marginBottom: 0 }]}> 
                            <Text style={{ color: '#fff', fontWeight: '700' }}>{message.profiles?.username?.[0]?.toUpperCase() ?? '?'}</Text>
                          </View>
                        )}
                        <View style={[styles.groupMsgBubble, { backgroundColor: isMe ? theme.primary : theme.surface, borderColor: isMe ? theme.primary : theme.borderSoft }]}>
                          {!isMe && <Text style={[styles.groupMsgUser, { color: theme.primary }]}>@{message.profiles?.username ?? t('groups.unknownUser')}</Text>}
                          <Text style={[styles.groupMsgText, { color: isMe ? '#fff' : theme.text }]}>{message.content}</Text>
                          <Text style={[styles.groupMsgTime, { color: isMe ? 'rgba(255,255,255,0.7)' : theme.textSoft }]}>
                            {formatTime(language, message.created_at, { hour: '2-digit', minute: '2-digit' })}
                          </Text>
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              )}

              <View style={[styles.groupChatInput, { backgroundColor: theme.surface, borderTopColor: theme.borderSoft, paddingBottom: Math.max(insets.bottom, 12) }]}> 
                <TextInput
                  style={[styles.groupChatTextInput, { backgroundColor: theme.inputBg, color: theme.text, borderColor: theme.border }]}
                  placeholder={editingGroupMessage ? t('groups.chatPlaceholderEdit') : t('groups.chatPlaceholder')}
                  placeholderTextColor={theme.textSoft}
                  value={groupMessageText}
                  onChangeText={setGroupMessageText}
                  onSubmitEditing={sendGroupMessage}
                  returnKeyType="send"
                  multiline
                />
                <TouchableOpacity style={[styles.groupChatSendBtn, { backgroundColor: theme.primary }, !groupMessageText.trim() && { opacity: 0.4 }]} onPress={sendGroupMessage} disabled={!groupMessageText.trim()}>
                  <Text style={styles.groupChatSendText}>{editingGroupMessage ? '✓' : '↑'}</Text>
                </TouchableOpacity>
              </View>
            </KeyboardAvoidingView>
          ) : (
          <ScrollView contentContainerStyle={{ padding: 16 }}>
            {activeTab === 'jurnal' && (
              groupCatches.length === 0 ? (
                <View style={styles.center}>
                  <Text style={[styles.emptyText, { color: theme.textMuted }]}>{t('groups.noCatches')}</Text>
                </View>
              ) : groupCatches.map((c: any) => (
                <View key={c.id} style={[styles.catchCard, { backgroundColor: theme.surface, borderColor: theme.borderSoft }]}>
                  <Text style={{ fontSize: 28 }}>🐟</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.catchTitle, { color: theme.text }]}>
                      {c.fish_species ?? t('groups.unknownFish')}{c.weight_kg ? ` · ${c.weight_kg} kg` : ''}
                    </Text>
                    <Text style={[styles.catchMeta, { color: theme.textMuted }]}>
                      @{c.profiles?.username ?? t('groups.unknownUser')} · {formatDate(language, c.caught_at)}
                    </Text>
                  </View>
                </View>
              ))
            )}

            {activeTab === 'statistici' && groupMembers.map((m: any) => {
              const stats = getMemberStats(m.user_id);
              return (
                <View key={m.id} style={[styles.statCard, { backgroundColor: theme.surface, borderColor: theme.borderSoft }]}>
                  <View style={styles.memberAvatar}>
                    <Text style={{ color: '#fff', fontWeight: '700' }}>
                      {m.profiles?.username?.[0]?.toUpperCase() ?? '?'}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.memberName, { color: theme.text }]}>@{m.profiles?.username ?? t('groups.unknownUser')}</Text>
                    {m.role === 'owner' && <Text style={[styles.ownerBadge, { color: theme.badgeText }]}>{t('groups.owner')}</Text>}
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={[styles.statNum, { color: theme.primary }]}>{t('groups.fishCount', { count: stats.total })}</Text>
                    <Text style={[styles.statSub, { color: theme.textMuted }]}>{t('groups.totalKg', { weight: stats.totalKg })}</Text>
                    <Text style={[styles.statSub, { color: theme.textMuted }]}>{t('groups.maxKg', { weight: stats.maxKg })}</Text>
                  </View>
                </View>
              );
            })}

            {activeTab === 'membri' && groupMembers.map((m: any) => (
              <View key={m.id} style={[styles.statCard, { backgroundColor: theme.surface, borderColor: theme.borderSoft }]}>
                <View style={styles.memberAvatar}>
                  <Text style={{ color: '#fff', fontWeight: '700' }}>
                    {m.profiles?.username?.[0]?.toUpperCase() ?? '?'}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.memberName, { color: theme.text }]}>@{m.profiles?.username ?? t('groups.unknownUser')}</Text>
                  <Text style={[styles.catchMeta, { color: theme.textMuted }]}>{t('groups.activeSince', { date: formatDate(language, m.joined_at) })}</Text>
                </View>
                <View style={[styles.roleBadge, { backgroundColor: theme.surfaceAlt }, m.role === 'owner' && { backgroundColor: theme.badgeBg }] }>
                  <Text style={[styles.roleText, { color: theme.textMuted }, m.role === 'owner' && { color: theme.badgeText }] }>
                    {m.role === 'owner' ? t('groups.ownerRole') : t('groups.memberRole')}
                  </Text>
                </View>
              </View>
            ))}
          </ScrollView>
          )}
        </SafeAreaView>
      </Modal>

      {/* Modal creare grup */}
      <Modal visible={createModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: theme.surface }] }>
            <Text style={[styles.modalTitle, { color: theme.text }]}>{t('groups.newGroupTitle')}</Text>
            <TextInput style={[styles.input, { borderColor: theme.border, color: theme.text, backgroundColor: theme.inputBg }]} placeholder={t('groups.newGroupName')} placeholderTextColor={theme.textSoft} value={newGroupName} onChangeText={setNewGroupName} />
            <TextInput style={[styles.input, { borderColor: theme.border, color: theme.text, backgroundColor: theme.inputBg }]} placeholder={t('groups.newGroupDescription')} placeholderTextColor={theme.textSoft} value={newGroupDesc} onChangeText={setNewGroupDesc} />
            <View style={styles.modalActions}>
              <TouchableOpacity style={[styles.cancelBtn, { borderColor: theme.border }]} onPress={() => setCreateModal(false)}>
                <Text style={[styles.cancelText, { color: theme.textMuted }]}>{t('common.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.confirmBtn, { backgroundColor: theme.primary }, saving && { opacity: 0.6 }]} onPress={createGroup} disabled={saving}>
                {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.confirmText}>{t('groups.create')}</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modal intrare grup */}
      <Modal visible={joinModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: theme.surface }] }>
            <Text style={[styles.modalTitle, { color: theme.text }]}>{t('groups.joinTitle')}</Text>
            <Text style={[styles.modalSub, { color: theme.textMuted }]}>{t('groups.joinSubtitle')}</Text>
            <TextInput
              style={[styles.input, { borderColor: theme.border, color: theme.text, backgroundColor: theme.inputBg, textAlign: 'center', fontSize: 20, letterSpacing: 4, fontWeight: '700' }]}
              placeholder="ABCD1234"
              placeholderTextColor={theme.textSoft}
              value={inviteCode}
              onChangeText={setInviteCode}
              autoCapitalize="characters"
              maxLength={8}
            />
            <View style={styles.modalActions}>
              <TouchableOpacity style={[styles.cancelBtn, { borderColor: theme.border }]} onPress={() => setJoinModal(false)}>
                <Text style={[styles.cancelText, { color: theme.textMuted }]}>{t('common.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.confirmBtn, { backgroundColor: theme.primary }, saving && { opacity: 0.6 }]} onPress={joinGroup} disabled={saving}>
                {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.confirmText}>{t('groups.join')}</Text>}
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
        detailsLabel={successState?.detailsLabel}
        copyValue={successState?.copyValue}
        onClose={() => setSuccessState(null)}
      />

      <MessageActionSheet
        visible={!!messageActionState}
        title={t('sheet.groupMessageTitle')}
        username={messageActionState?.profiles?.username}
        messagePreview={messageActionState?.content}
        onEdit={handleGroupMessageActionEdit}
        onDelete={handleGroupMessageActionDelete}
        onClose={() => setMessageActionState(null)}
      />

      <ConfirmActionSheet
        visible={!!pendingDeleteMessageId}
        title={t('sheet.confirmDeleteTitle')}
        message={t('sheet.confirmDeleteGroup')}
        onConfirm={confirmDeleteGroupMessage}
        onClose={() => setPendingDeleteMessageId(null)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f4f6f8' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 10 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, backgroundColor: '#fff', borderBottomWidth: 0.5, borderBottomColor: '#eee' },
  headerTitle: { fontSize: 18, fontWeight: '800', color: '#1a1a1a' },
  addBtn: { backgroundColor: '#1D9E75', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8 },
  addBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  joinBtn: { backgroundColor: '#E6F1FB', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8 },
  joinBtnText: { color: '#185FA5', fontWeight: '700', fontSize: 13 },
  emptyText: { fontSize: 15, color: '#888', textAlign: 'center' },
  emptySub: { fontSize: 13, color: '#aaa', textAlign: 'center' },
  groupCard: { backgroundColor: '#fff', borderRadius: 14, marginBottom: 10, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 0.5, borderColor: '#eee' },
  groupAvatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#E1F5EE', alignItems: 'center', justifyContent: 'center' },
  groupName: { fontSize: 16, fontWeight: '700', color: '#1a1a1a' },
  groupDesc: { fontSize: 12, color: '#888', marginTop: 2 },
  groupCode: { fontSize: 11, color: '#1D9E75', marginTop: 3, fontWeight: '600' },
  groupUnreadBadge: { minWidth: 22, height: 22, paddingHorizontal: 6, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  groupUnreadText: { color: '#fff', fontSize: 11, fontWeight: '800' },
  detailHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, backgroundColor: '#fff', borderBottomWidth: 0.5, borderBottomColor: '#eee' },
  backBtn: { fontSize: 16, color: '#1D9E75', fontWeight: '600' },
  detailTitle: { fontSize: 16, fontWeight: '700', color: '#1a1a1a', flex: 1, textAlign: 'center' },
  inviteBar: { backgroundColor: '#E1F5EE', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: 10, gap: 8 },
  inviteLabel: { fontSize: 13, color: '#085041' },
  inviteCode: { fontSize: 18, fontWeight: '800', color: '#0F6E56', letterSpacing: 3 },
  inviteCopyBtn: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10 },
  inviteCopyText: { fontSize: 12, color: '#fff', fontWeight: '800' },
  tabs: { flexDirection: 'row', backgroundColor: '#fff', borderBottomWidth: 0.5, borderBottomColor: '#eee' },
  tab: { flex: 1, padding: 12, alignItems: 'center' },
  tabActive: { borderBottomWidth: 2, borderBottomColor: '#1D9E75' },
  tabText: { fontSize: 13, color: '#888' },
  tabTextActive: { color: '#1D9E75', fontWeight: '700' },
  catchCard: { backgroundColor: '#fff', borderRadius: 12, padding: 12, marginBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 0.5, borderColor: '#eee' },
  catchTitle: { fontSize: 14, fontWeight: '600', color: '#1a1a1a' },
  catchMeta: { fontSize: 12, color: '#888', marginTop: 2 },
  statCard: { backgroundColor: '#fff', borderRadius: 12, padding: 12, marginBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 0.5, borderColor: '#eee' },
  memberAvatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#1D9E75', alignItems: 'center', justifyContent: 'center' },
  memberName: { fontSize: 14, fontWeight: '700', color: '#1a1a1a' },
  ownerBadge: { fontSize: 11, color: '#BA7517', fontWeight: '600' },
  statNum: { fontSize: 14, fontWeight: '700', color: '#1D9E75' },
  statSub: { fontSize: 11, color: '#888' },
  roleBadge: { backgroundColor: '#f0f0f0', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  roleText: { fontSize: 12, color: '#666', fontWeight: '600' },
  groupMsgRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginBottom: 10 },
  groupMsgRowMe: { flexDirection: 'row-reverse' },
  groupMsgBubble: { maxWidth: '78%', borderRadius: 16, padding: 10, borderWidth: 1, borderBottomLeftRadius: 4 },
  groupMsgUser: { fontSize: 11, fontWeight: '700', marginBottom: 4 },
  groupMsgText: { fontSize: 14, lineHeight: 20 },
  groupMsgTime: { fontSize: 10, marginTop: 4, textAlign: 'right' },
  editingBanner: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 0.5 },
  editingAccent: { width: 4, alignSelf: 'stretch', borderRadius: 999 },
  editingTitle: { fontSize: 13, fontWeight: '800' },
  editingPreview: { fontSize: 12, marginTop: 3, lineHeight: 18 },
  groupChatInput: { flexDirection: 'row', gap: 8, padding: 12, borderTopWidth: 0.5, alignItems: 'flex-end' },
  editingCancel: { fontSize: 12, fontWeight: '800' },
  groupChatTextInput: { flex: 1, borderWidth: 1, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, maxHeight: 100 },
  groupChatSendBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  groupChatSendText: { color: '#fff', fontSize: 20, fontWeight: '700' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24 },
  modalTitle: { fontSize: 18, fontWeight: '800', color: '#1a1a1a', marginBottom: 4 },
  modalSub: { fontSize: 13, color: '#888', marginBottom: 14 },
  input: { borderWidth: 1, borderColor: '#e0e0e0', borderRadius: 10, padding: 12, fontSize: 14, color: '#1a1a1a', marginBottom: 10, backgroundColor: '#fafafa' },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 6 },
  cancelBtn: { flex: 1, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: '#ddd', alignItems: 'center' },
  cancelText: { fontSize: 15, color: '#666' },
  confirmBtn: { flex: 1, padding: 14, borderRadius: 12, backgroundColor: '#1D9E75', alignItems: 'center' },
  confirmText: { fontSize: 15, color: '#fff', fontWeight: '700' },
});
