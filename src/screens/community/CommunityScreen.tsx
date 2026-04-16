// src/screens/community/CommunityScreen.tsx
// Chat global + conversații private + leaderboard

import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  TextInput, FlatList, ActivityIndicator, Modal,
  KeyboardAvoidingView, Platform, Alert,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import ConfirmActionSheet from '../../components/ConfirmActionSheet';
import { formatDate, formatTime, useI18n } from '../../i18n';
import MessageActionSheet from '../../components/MessageActionSheet';
import { supabase } from '../../lib/supabase';
import { useAuthStore } from '../../store/authStore';
import { useThemeStore } from '../../store/themeStore';
import { useUnreadStore } from '../../store/unreadStore';
import { getAppTheme } from '../../theme';
import type { LeaderboardEntry, Message, PrivateMessage, SearchProfileResult } from '../../types';

type Tab = 'chat' | 'private' | 'leaderboard';

interface ConversationPreview {
  conversationId: string;
  otherUser: SearchProfileResult;
  unreadCount: number;
  lastMessage?: {
    content?: string;
    created_at: string;
    user_id: string;
  };
}

interface PublicProfileSheetState {
  userId: string;
  username?: string;
  avatarUrl?: string;
}

interface PublicProfileDetails extends SearchProfileResult {
  bio?: string | null;
  created_at: string;
  catchesCount: number;
  sessionsCount: number;
  groupsCount: number;
}

export default function CommunityScreen() {
  const insets = useSafeAreaInsets();
  const { user, profile } = useAuthStore();
  const { language, t } = useI18n();
  const mode = useThemeStore((state) => state.mode);
  const theme = getAppTheme(mode);
  const isDark = mode === 'dark';
  const isAdmin = profile?.role === 'admin';
  const refreshUnread = useUnreadStore((state) => state.refreshUnread);
  const [activeTab, setActiveTab] = useState<Tab>('chat');
  const [messages, setMessages] = useState<any[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [leaderboardError, setLeaderboardError] = useState<string | null>(null);
  const [messageText, setMessageText] = useState('');
  const [loadingChat, setLoadingChat] = useState(true);
  const [loadingBoard, setLoadingBoard] = useState(true);
  const [lbFilter, setLbFilter] = useState<'total_catches' | 'biggest_fish_kg' | 'total_weight_kg'>('total_catches');
  const [privateSearch, setPrivateSearch] = useState('');
  const [searchResults, setSearchResults] = useState<SearchProfileResult[]>([]);
  const [searchingProfiles, setSearchingProfiles] = useState(false);
  const [conversationList, setConversationList] = useState<ConversationPreview[]>([]);
  const [loadingPrivate, setLoadingPrivate] = useState(true);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [privateMessages, setPrivateMessages] = useState<PrivateMessage[]>([]);
  const [loadingPrivateMessages, setLoadingPrivateMessages] = useState(false);
  const [privateMessageText, setPrivateMessageText] = useState('');
  const [editingGlobalMessage, setEditingGlobalMessage] = useState<Message | null>(null);
  const [editingPrivateMessage, setEditingPrivateMessage] = useState<PrivateMessage | null>(null);
  const [messageActionState, setMessageActionState] = useState<{ kind: 'global' | 'private'; message: any } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ kind: 'global' | 'private'; id: string } | null>(null);
  const [publicProfileState, setPublicProfileState] = useState<PublicProfileSheetState | null>(null);
  const [publicProfileDetails, setPublicProfileDetails] = useState<PublicProfileDetails | null>(null);
  const [loadingPublicProfile, setLoadingPublicProfile] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const privateScrollRef = useRef<ScrollView>(null);
  const channelRef = useRef<any>(null);
  const keyboardBehavior = Platform.OS === 'ios' ? 'padding' : 'height';

  const canManageMessage = (messageUserId?: string) => !!user?.id && (messageUserId === user.id || isAdmin);

  const mergeMessage = (incoming: any) => {
    setMessages((prev) => {
      if (prev.some((item) => item.id === incoming.id)) return prev;
      return [...prev, incoming];
    });
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  };

  useEffect(() => {
    void fetchMessages();
    void fetchLeaderboard();
    void fetchPrivateConversations();
  }, [user?.id]);

  useEffect(() => {
    subscribeToRealtime();
    return () => {
      if (channelRef.current) supabase.removeChannel(channelRef.current);
    };
  }, [user?.id, selectedConversationId]);

  useEffect(() => {
    if (activeTab === 'leaderboard') void fetchLeaderboard();
    if (activeTab === 'private') void fetchPrivateConversations();
  }, [activeTab]);

  useEffect(() => {
    if (selectedConversationId) void fetchPrivateMessages(selectedConversationId);
  }, [selectedConversationId]);

  const fetchMessages = async () => {
    setLoadingChat(true);
    const { data } = await supabase
      .from('messages')
      .select('id, user_id, content, media_url, created_at, profiles:profiles!messages_user_id_fkey(username, avatar_url)')
      .order('created_at', { ascending: true })
      .limit(60);
    if (data) setMessages(data);
    setLoadingChat(false);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: false }), 200);
  };

  const normalizeLeaderboardRows = (rows: any[]): LeaderboardEntry[] => rows.map((row) => ({
    user_id: String(row.user_id),
    username: row.username ?? t('community.unknownUser'),
    avatar_url: row.avatar_url ?? undefined,
    total_catches: Number(row.total_catches ?? 0),
    biggest_fish_kg: Number(row.biggest_fish_kg ?? 0),
    total_weight_kg: Number(row.total_weight_kg ?? 0),
    total_sessions: Number(row.total_sessions ?? 0),
  }));

  const fetchLeaderboard = async () => {
    setLoadingBoard(true);
    setLeaderboardError(null);

    const rpcResult = await supabase.rpc('get_leaderboard_monthly');
    if (!rpcResult.error && rpcResult.data) {
      setLeaderboard(normalizeLeaderboardRows(rpcResult.data).slice(0, 20));
      setLoadingBoard(false);
      return;
    }

    const viewResult = await supabase.from('leaderboard_monthly').select('*').limit(20);
    if (!viewResult.error && viewResult.data) {
      setLeaderboard(normalizeLeaderboardRows(viewResult.data));
      setLoadingBoard(false);
      return;
    }

    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const fallback = await supabase
      .from('catches')
      .select('id, user_id, weight_kg, session_id, caught_at, profiles:profiles!catches_user_id_fkey(username, avatar_url)')
      .gte('caught_at', startOfMonth.toISOString())
      .order('caught_at', { ascending: false });

    if (fallback.error || !fallback.data) {
      const message = rpcResult.error?.message || viewResult.error?.message || fallback.error?.message || t('common.unknown');
      setLeaderboard([]);
      setLeaderboardError(message);
      setLoadingBoard(false);
      return;
    }

    const grouped = new Map<string, LeaderboardEntry & { sessionIds?: Set<string> }>();
    for (const row of fallback.data as any[]) {
      const current = grouped.get(row.user_id) ?? {
        user_id: String(row.user_id),
        username: row.profiles?.username ?? t('community.unknownUser'),
        avatar_url: row.profiles?.avatar_url,
        total_catches: 0,
        biggest_fish_kg: 0,
        total_weight_kg: 0,
        total_sessions: 0,
        sessionIds: new Set<string>(),
      };
      current.total_catches += 1;
      current.biggest_fish_kg = Math.max(current.biggest_fish_kg, Number(row.weight_kg ?? 0));
      current.total_weight_kg += Number(row.weight_kg ?? 0);
      if (row.session_id) {
        current.sessionIds?.add(String(row.session_id));
        current.total_sessions = current.sessionIds?.size ?? current.total_sessions;
      }
      grouped.set(String(row.user_id), current);
    }

    setLeaderboard(Array.from(grouped.values()).map(({ sessionIds, ...entry }) => entry).slice(0, 20));
    setLoadingBoard(false);
  };

  const fetchPrivateConversations = async () => {
    if (!user?.id) {
      setConversationList([]);
      setLoadingPrivate(false);
      return;
    }

    setLoadingPrivate(true);
    const { data: memberRows } = await supabase
      .from('private_conversation_members')
      .select('conversation_id, last_read_at')
      .eq('user_id', user.id);

    if (!memberRows?.length) {
      setConversationList([]);
      setLoadingPrivate(false);
      return;
    }

    const conversationIds = Array.from(new Set(memberRows.map((item: any) => item.conversation_id)));
    const readMap = new Map<string, string | null>();
    for (const row of memberRows as any[]) {
      readMap.set(row.conversation_id, row.last_read_at ?? null);
    }

    const [{ data: otherMembers }, { data: lastMessageRows }] = await Promise.all([
      supabase
        .from('private_conversation_members')
        .select('conversation_id, profiles:profiles!private_conversation_members_user_id_fkey(id, username, full_name, avatar_url)')
        .in('conversation_id', conversationIds)
        .neq('user_id', user.id),
      supabase
        .from('private_messages')
        .select('id, conversation_id, content, created_at, user_id')
        .in('conversation_id', conversationIds)
        .order('created_at', { ascending: false }),
    ]);

    const latestMessageMap = new Map<string, ConversationPreview['lastMessage']>();
    const unreadMap = new Map<string, number>();
    for (const row of lastMessageRows ?? []) {
      if (!latestMessageMap.has(row.conversation_id)) {
        latestMessageMap.set(row.conversation_id, {
          content: row.content,
          created_at: row.created_at,
          user_id: row.user_id,
        });
      }

      const lastReadAt = readMap.get(row.conversation_id);
      const isUnread = row.user_id !== user.id && (!lastReadAt || new Date(row.created_at).getTime() > new Date(lastReadAt).getTime());
      if (isUnread) {
        unreadMap.set(row.conversation_id, (unreadMap.get(row.conversation_id) ?? 0) + 1);
      }
    }

    const nextConversationList = (otherMembers ?? []).map((item: any) => ({
      conversationId: item.conversation_id,
      otherUser: item.profiles,
      unreadCount: unreadMap.get(item.conversation_id) ?? 0,
      lastMessage: latestMessageMap.get(item.conversation_id),
    })) as ConversationPreview[];

    nextConversationList.sort((left, right) => {
      const leftTs = left.lastMessage ? new Date(left.lastMessage.created_at).getTime() : 0;
      const rightTs = right.lastMessage ? new Date(right.lastMessage.created_at).getTime() : 0;
      return rightTs - leftTs || left.otherUser.username.localeCompare(right.otherUser.username);
    });

    setConversationList(nextConversationList);
    setLoadingPrivate(false);
  };

  const fetchPrivateMessages = async (conversationId: string) => {
    setLoadingPrivateMessages(true);
    const { data } = await supabase
      .from('private_messages')
      .select('id, conversation_id, user_id, content, media_url, created_at, profiles:profiles!private_messages_user_id_fkey(username, avatar_url)')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
      .limit(100);

    if (data) {
      setPrivateMessages(data as any);
      setTimeout(() => privateScrollRef.current?.scrollToEnd({ animated: false }), 120);
    }
    await markPrivateConversationAsRead(conversationId);
    setLoadingPrivateMessages(false);
  };

  const markPrivateConversationAsRead = async (conversationId: string) => {
    if (!user?.id) return;
    await supabase
      .from('private_conversation_members')
      .update({ last_read_at: new Date().toISOString() })
      .eq('conversation_id', conversationId)
      .eq('user_id', user.id);
    await fetchPrivateConversations();
    refreshUnread();
  };

  const searchProfiles = async (value: string) => {
    setPrivateSearch(value);
    if (!user?.id || value.trim().length < 2) {
      setSearchResults([]);
      setSearchingProfiles(false);
      return;
    }

    setSearchingProfiles(true);
    const term = value.trim();
    const { data } = await supabase
      .from('profiles')
      .select('id, username, full_name, avatar_url')
      .neq('id', user.id)
      .or(`username.ilike.%${term}%,full_name.ilike.%${term}%`)
      .limit(8);

    setSearchResults((data ?? []) as SearchProfileResult[]);
    setSearchingProfiles(false);
  };

  const openPrivateConversation = async (targetUser: SearchProfileResult) => {
    const { data, error } = await supabase.rpc('create_or_get_private_conversation', { other_user_id: targetUser.id });
    if (error || !data) {
      Alert.alert(t('community.createConversationFailed'), error?.message ?? t('community.tryAgain'));
      return;
    }

    const conversationId = String(data);
    setSelectedConversationId(conversationId);
    setPrivateSearch('');
    setSearchResults([]);
    await fetchPrivateConversations();
    await fetchPrivateMessages(conversationId);
  };

  const openPublicProfile = async (targetUser: PublicProfileSheetState) => {
    if (!targetUser.userId || targetUser.userId === user?.id) return;

    setPublicProfileState(targetUser);
    setPublicProfileDetails(null);
    setLoadingPublicProfile(true);

    const [profileRes, catchesRes, sessionsRes, groupsRes] = await Promise.all([
      supabase
        .from('profiles')
        .select('id, username, full_name, avatar_url, bio, created_at')
        .eq('id', targetUser.userId)
        .single(),
      supabase
        .from('catches')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', targetUser.userId),
      supabase
        .from('sessions')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', targetUser.userId),
      supabase
        .from('group_members')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', targetUser.userId),
    ]);

    if (profileRes.error || !profileRes.data) {
      setLoadingPublicProfile(false);
      Alert.alert(t('common.error'), profileRes.error?.message ?? t('common.unknown'));
      setPublicProfileState(null);
      return;
    }

    setPublicProfileDetails({
      ...(profileRes.data as SearchProfileResult & { bio?: string | null; created_at: string }),
      catchesCount: catchesRes.count ?? 0,
      sessionsCount: sessionsRes.count ?? 0,
      groupsCount: groupsRes.count ?? 0,
    });
    setLoadingPublicProfile(false);
  };

  const handleStartConversationFromProfile = async () => {
    if (!publicProfileDetails) return;
    const profileTarget: SearchProfileResult = {
      id: publicProfileDetails.id,
      username: publicProfileDetails.username,
      full_name: publicProfileDetails.full_name,
      avatar_url: publicProfileDetails.avatar_url,
    };

    setPublicProfileState(null);
    setPublicProfileDetails(null);
    setActiveTab('private');
    await openPrivateConversation(profileTarget);
  };

  const sendMessage = async () => {
    if (!messageText.trim() || !user) return;
    const content = messageText.trim();
    const editingId = editingGlobalMessage?.id;
    setMessageText('');

    if (editingId) {
      const { error } = await supabase
        .from('messages')
        .update({ content })
        .eq('id', editingId);

      if (error) {
        setMessageText(content);
        Alert.alert(t('community.globalEditFailed'), error.message);
        return;
      }

      setEditingGlobalMessage(null);
      await fetchMessages();
      return;
    }

    const { data, error } = await supabase
      .from('messages')
      .insert({ user_id: user.id, content })
      .select('id, user_id, content, media_url, created_at, profiles:profiles!messages_user_id_fkey(username, avatar_url)')
      .single();

    if (error) {
      setMessageText(content);
      Alert.alert(t('community.globalSendFailed'), error.message);
      return;
    }

    if (data) mergeMessage(data);
  };

  const sendPrivateMessage = async () => {
    if (!selectedConversationId || !privateMessageText.trim() || !user) return;
    const content = privateMessageText.trim();
    const editingId = editingPrivateMessage?.id;
    setPrivateMessageText('');

    if (editingId) {
      const { error } = await supabase
        .from('private_messages')
        .update({ content })
        .eq('id', editingId);

      if (error) {
        setPrivateMessageText(content);
        Alert.alert(t('community.privateEditFailed'), error.message);
        return;
      }

      setEditingPrivateMessage(null);
      await fetchPrivateMessages(selectedConversationId);
      await fetchPrivateConversations();
      refreshUnread();
      return;
    }

    const { error } = await supabase.from('private_messages').insert({
      conversation_id: selectedConversationId,
      user_id: user.id,
      content,
    });

    if (error) {
      setPrivateMessageText(content);
      Alert.alert(t('community.privateSendFailed'), error.message);
      return;
    }

    await fetchPrivateMessages(selectedConversationId);
    await fetchPrivateConversations();
  };

  const deleteGlobalMessage = async (messageId: string) => {
    const { error } = await supabase.from('messages').delete().eq('id', messageId);
    if (error) {
      Alert.alert(t('community.globalDeleteFailed'), error.message);
      return;
    }

    if (editingGlobalMessage?.id === messageId) {
      setEditingGlobalMessage(null);
      setMessageText('');
    }
    await fetchMessages();
  };

  const deletePrivateMessage = async (messageId: string) => {
    const { error } = await supabase.from('private_messages').delete().eq('id', messageId);
    if (error) {
      Alert.alert(t('community.privateDeleteFailed'), error.message);
      return;
    }

    if (editingPrivateMessage?.id === messageId) {
      setEditingPrivateMessage(null);
      setPrivateMessageText('');
    }
    if (selectedConversationId) {
      await fetchPrivateMessages(selectedConversationId);
    }
    await fetchPrivateConversations();
    refreshUnread();
  };

  const openGlobalMessageActions = (message: any) => {
    if (!canManageMessage(message.user_id)) return;
    setMessageActionState({ kind: 'global', message });
  };

  const openPrivateMessageActions = (message: any) => {
    if (!canManageMessage(message.user_id)) return;
    setMessageActionState({ kind: 'private', message });
  };

  const handleMessageActionEdit = () => {
    if (!messageActionState) return;
    if (messageActionState.kind === 'global') {
      setEditingGlobalMessage(messageActionState.message as Message);
      setMessageText(messageActionState.message.content ?? '');
    } else {
      setEditingPrivateMessage(messageActionState.message as PrivateMessage);
      setPrivateMessageText(messageActionState.message.content ?? '');
    }
    setMessageActionState(null);
  };

  const handleMessageActionDelete = () => {
    if (!messageActionState) return;
    const target = messageActionState;
    setMessageActionState(null);
    setPendingDelete({ kind: target.kind, id: String(target.message.id) });
  };

  const confirmDeleteMessage = () => {
    if (!pendingDelete) return;
    const target = pendingDelete;
    setPendingDelete(null);
    if (target.kind === 'global') {
      void deleteGlobalMessage(target.id);
      return;
    }
    void deletePrivateMessage(target.id);
  };

  const cancelGlobalEdit = () => {
    setEditingGlobalMessage(null);
    setMessageText('');
  };

  const cancelPrivateEdit = () => {
    setEditingPrivateMessage(null);
    setPrivateMessageText('');
  };

  const subscribeToRealtime = () => {
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
    }

    channelRef.current = supabase
      .channel(`community-realtime-${user?.id ?? 'guest'}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, async (payload) => {
        if (payload.eventType === 'INSERT') {
          const { data } = await supabase
            .from('messages')
            .select('id, user_id, content, media_url, created_at, profiles:profiles!messages_user_id_fkey(username, avatar_url)')
            .eq('id', payload.new.id)
            .single();
          if (data) {
            mergeMessage(data);
            return;
          }
        }

        void fetchMessages();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'catches' }, () => {
        void fetchLeaderboard();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'private_messages' }, (payload) => {
        const nextRow = ((payload.new as { conversation_id?: string })?.conversation_id ? payload.new : payload.old) as { conversation_id?: string };
        const conversationId = String(nextRow?.conversation_id ?? '');
        void fetchPrivateConversations();
        if (selectedConversationId && (!conversationId || conversationId === selectedConversationId)) {
          void fetchPrivateMessages(selectedConversationId);
        }
        refreshUnread();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'private_conversation_members' }, () => {
        void fetchPrivateConversations();
      })
      .subscribe();
  };

  const sortedLeaderboard = [...leaderboard].sort((a, b) => Number(b[lbFilter] ?? 0) - Number(a[lbFilter] ?? 0));

  const filterLabel = {
    total_catches: { icon: '🐟', title: t('community.filterMost'), subtitle: t('community.filterFish') },
    biggest_fish_kg: { icon: '🏆', title: t('community.filterBiggest'), subtitle: t('community.filterSingleFish') },
    total_weight_kg: { icon: '⚖️', title: t('community.filterWeight'), subtitle: t('community.filterTotal') },
  };

  const metricPreview = {
    total_catches: t('community.metricByCatches'),
    biggest_fish_kg: t('community.metricByBiggest'),
    total_weight_kg: t('community.metricByWeight'),
  };

  const selectedConversation = conversationList.find((item) => item.conversationId === selectedConversationId) ?? null;
  const totalPrivateUnread = conversationList.reduce((sum, item) => sum + item.unreadCount, 0);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}> 
      <View style={[styles.header, { backgroundColor: theme.surface, borderBottomColor: theme.borderSoft }]}> 
        <Text style={[styles.headerTitle, { color: theme.text }]}>🌍 {t('community.title')}</Text>
      </View>
      <View style={[styles.tabs, { backgroundColor: theme.surface, borderBottomColor: theme.borderSoft }]}> 
        <TouchableOpacity style={[styles.tab, activeTab === 'chat' && styles.tabActive, activeTab === 'chat' && { borderBottomColor: theme.primary }]} onPress={() => setActiveTab('chat')}>
          <Text style={[styles.tabText, { color: theme.tabInactive }, activeTab === 'chat' && styles.tabTextActive, activeTab === 'chat' && { color: theme.primary }]}>💬 {t('community.tabGlobal')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tab, activeTab === 'private' && styles.tabActive, activeTab === 'private' && { borderBottomColor: theme.primary }]} onPress={() => setActiveTab('private')}>
          <Text style={[styles.tabText, { color: theme.tabInactive }, activeTab === 'private' && styles.tabTextActive, activeTab === 'private' && { color: theme.primary }]}>✉️ {t('community.tabPrivate')}{totalPrivateUnread > 0 ? ` (${totalPrivateUnread})` : ''}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tab, activeTab === 'leaderboard' && styles.tabActive, activeTab === 'leaderboard' && { borderBottomColor: theme.primary }]} onPress={() => setActiveTab('leaderboard')}>
          <Text style={[styles.tabText, { color: theme.tabInactive }, activeTab === 'leaderboard' && styles.tabTextActive, activeTab === 'leaderboard' && { color: theme.primary }]}>🏆 {t('community.tabLeaderboard')}</Text>
        </TouchableOpacity>
      </View>

      {activeTab === 'chat' && (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={keyboardBehavior} keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 76}>
          {editingGlobalMessage && (
            <View style={[styles.editingBanner, { backgroundColor: theme.surface, borderBottomColor: theme.borderSoft }]}> 
              <View style={[styles.editingAccent, { backgroundColor: theme.primary }]} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.editingTitle, { color: theme.text }]}>{t('community.editingGlobal')}</Text>
                <Text style={[styles.editingPreview, { color: theme.textMuted }]} numberOfLines={2}>{editingGlobalMessage.content || t('sheet.emptyMessage')}</Text>
              </View>
              <TouchableOpacity onPress={cancelGlobalEdit}>
                <Text style={[styles.editingCancel, { color: theme.primary }]}>{t('sheet.keep')}</Text>
              </TouchableOpacity>
            </View>
          )}
          {loadingChat ? (
            <View style={styles.center}><ActivityIndicator color={theme.primary} /></View>
          ) : (
            <ScrollView ref={scrollRef} style={{ flex: 1 }} contentContainerStyle={{ padding: 12, paddingBottom: 8 }}>
              {messages.length === 0 ? (
                <View style={styles.center}>
                  <Text style={[styles.emptyText, { color: theme.textSoft }]}>{t('community.noMessages')}</Text>
                </View>
              ) : messages.map((msg: any) => (
                <MessageBubble
                  key={msg.id}
                  isMe={msg.user_id === user?.id}
                  message={msg.content}
                  time={msg.created_at}
                  username={msg.profiles?.username}
                  theme={theme}
                  language={language}
                  unknownUserLabel={t('community.unknownUser')}
                  onLongPress={() => openGlobalMessageActions(msg)}
                  onPress={() => openPublicProfile({ userId: String(msg.user_id), username: msg.profiles?.username, avatarUrl: msg.profiles?.avatar_url })}
                />
              ))}
            </ScrollView>
          )}

          <View style={[styles.chatInput, { backgroundColor: theme.surface, borderTopColor: theme.borderSoft, paddingBottom: Math.max(insets.bottom, 10) }]}> 
            <TextInput style={[styles.chatTextInput, { backgroundColor: theme.inputBg, color: theme.text }]} placeholder={editingGlobalMessage ? t('community.messagePlaceholderEdit') : t('community.messagePlaceholder')} placeholderTextColor={theme.textSoft} value={messageText} onChangeText={setMessageText} onSubmitEditing={sendMessage} returnKeyType="send" multiline maxLength={500} />
            <TouchableOpacity style={[styles.sendBtn, { backgroundColor: theme.primary }, !messageText.trim() && { opacity: 0.4 }]} onPress={sendMessage} disabled={!messageText.trim()}>
              <Text style={styles.sendBtnText}>{editingGlobalMessage ? '✓' : '↑'}</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      )}

      {activeTab === 'private' && (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={keyboardBehavior} keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 76}>
          <View style={[styles.privateSearchWrap, { backgroundColor: theme.surface, borderBottomColor: theme.borderSoft }]}> 
            <TextInput style={[styles.privateSearchInput, { backgroundColor: theme.inputBg, color: theme.text, borderColor: theme.border }]} placeholder={t('community.peopleSearch')} placeholderTextColor={theme.textSoft} value={privateSearch} onChangeText={searchProfiles} />
            {searchingProfiles && <ActivityIndicator color={theme.primary} style={{ marginTop: 10 }} />}
            {!!privateSearch.trim() && searchResults.length > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.searchResultsRow}>
                {searchResults.map((profileResult) => (
                  <TouchableOpacity key={profileResult.id} style={[styles.personCard, { backgroundColor: theme.surfaceAlt, borderColor: theme.border }]} onPress={() => openPrivateConversation(profileResult)}>
                    <View style={[styles.personAvatar, { backgroundColor: theme.primary }]}>
                      <Text style={styles.personAvatarText}>{profileResult.username?.[0]?.toUpperCase() ?? '?'}</Text>
                    </View>
                    <Text style={[styles.personName, { color: theme.text }]} numberOfLines={1}>@{profileResult.username}</Text>
                    <Text style={[styles.personSub, { color: theme.textMuted }]} numberOfLines={1}>{profileResult.full_name || t('community.openConversation')}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
          </View>

          {selectedConversation ? (
            <>
              <View style={[styles.privateHeader, { backgroundColor: theme.surface, borderBottomColor: theme.borderSoft }]}> 
                <View style={[styles.personAvatar, { backgroundColor: theme.primary }]}> 
                  <Text style={styles.personAvatarText}>{selectedConversation.otherUser.username?.[0]?.toUpperCase() ?? '?'}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.privateTitle, { color: theme.text }]}>@{selectedConversation.otherUser.username}</Text>
                  <Text style={[styles.privateSubtitle, { color: theme.textMuted }]}>{selectedConversation.otherUser.full_name || t('community.privateConversation')}</Text>
                </View>
                <TouchableOpacity onPress={() => setSelectedConversationId(null)}>
                  <Text style={[styles.privateClose, { color: theme.primary }]}>{t('community.closeConversation')}</Text>
                </TouchableOpacity>
              </View>

              {editingPrivateMessage && (
                <View style={[styles.editingBanner, { backgroundColor: theme.surface, borderBottomColor: theme.borderSoft }]}> 
                  <View style={[styles.editingAccent, { backgroundColor: theme.primary }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.editingTitle, { color: theme.text }]}>{t('community.editingPrivate')}</Text>
                    <Text style={[styles.editingPreview, { color: theme.textMuted }]} numberOfLines={2}>{editingPrivateMessage.content || t('sheet.emptyMessage')}</Text>
                  </View>
                  <TouchableOpacity onPress={cancelPrivateEdit}>
                    <Text style={[styles.editingCancel, { color: theme.primary }]}>{t('sheet.keep')}</Text>
                  </TouchableOpacity>
                </View>
              )}

              {loadingPrivateMessages ? (
                <View style={styles.center}><ActivityIndicator color={theme.primary} /></View>
              ) : (
                <ScrollView ref={privateScrollRef} style={{ flex: 1 }} contentContainerStyle={{ padding: 12, paddingBottom: 8 }}>
                  {privateMessages.length === 0 ? (
                    <View style={styles.center}>
                      <Text style={[styles.emptyText, { color: theme.textSoft }]}>{t('community.noPrivateMessages')}</Text>
                    </View>
                  ) : privateMessages.map((msg: any) => (
                    <MessageBubble key={msg.id} isMe={msg.user_id === user?.id} message={msg.content} time={msg.created_at} username={msg.profiles?.username} theme={theme} language={language} unknownUserLabel={t('community.unknownUser')} onLongPress={() => openPrivateMessageActions(msg)} />
                  ))}
                </ScrollView>
              )}

              <View style={[styles.chatInput, { backgroundColor: theme.surface, borderTopColor: theme.borderSoft, paddingBottom: Math.max(insets.bottom, 10) }]}> 
                <TextInput style={[styles.chatTextInput, { backgroundColor: theme.inputBg, color: theme.text }]} placeholder={editingPrivateMessage ? t('community.privateMessagePlaceholderEdit') : t('community.privateMessagePlaceholder')} placeholderTextColor={theme.textSoft} value={privateMessageText} onChangeText={setPrivateMessageText} onSubmitEditing={sendPrivateMessage} returnKeyType="send" multiline maxLength={500} />
                <TouchableOpacity style={[styles.sendBtn, { backgroundColor: theme.primary }, !privateMessageText.trim() && { opacity: 0.4 }]} onPress={sendPrivateMessage} disabled={!privateMessageText.trim()}>
                  <Text style={styles.sendBtnText}>{editingPrivateMessage ? '✓' : '↑'}</Text>
                </TouchableOpacity>
              </View>
            </>
          ) : loadingPrivate ? (
            <View style={styles.center}><ActivityIndicator color={theme.primary} /></View>
          ) : (
            <FlatList
              data={conversationList}
              keyExtractor={(item) => item.conversationId}
              contentContainerStyle={{ padding: 16 }}
              ListEmptyComponent={
                <View style={styles.center}>
                  <Text style={[styles.emptyText, { color: theme.textMuted }]}>{t('community.noPrivateConversations')}</Text>
                  <Text style={[styles.emptyHint, { color: theme.textSoft }]}>{t('community.noPrivateConversationsHint')}</Text>
                </View>
              }
              renderItem={({ item }) => (
                <TouchableOpacity style={[styles.dmCard, { backgroundColor: theme.surface, borderColor: theme.borderSoft }]} onPress={() => setSelectedConversationId(item.conversationId)}>
                  <View style={[styles.personAvatar, { backgroundColor: theme.primary }]}> 
                    <Text style={styles.personAvatarText}>{item.otherUser.username?.[0]?.toUpperCase() ?? '?'}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.dmName, { color: theme.text }]}>@{item.otherUser.username}</Text>
                    <Text style={[styles.dmPreview, { color: theme.textMuted }]} numberOfLines={1}>{item.lastMessage?.content || t('community.newConversation')}</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 6 }}>
                    <Text style={[styles.dmTime, { color: theme.textSoft }]}>{item.lastMessage ? formatDate(language, item.lastMessage.created_at, { day: '2-digit', month: '2-digit' }) : ''}</Text>
                    {item.unreadCount > 0 && (
                      <View style={[styles.unreadBadge, { backgroundColor: theme.primary }]}>
                        <Text style={styles.unreadBadgeText}>{item.unreadCount}</Text>
                      </View>
                    )}
                  </View>
                </TouchableOpacity>
              )}
            />
          )}
        </KeyboardAvoidingView>
      )}

      {activeTab === 'leaderboard' && (
        <View style={{ flex: 1 }}>
          <View style={[styles.lbHero, { backgroundColor: theme.surface, borderBottomColor: theme.borderSoft }]}> 
            <Text style={[styles.lbHeroEyebrow, { color: theme.textSoft }]}>{t('community.monthlyLeaderboard')}</Text>
            <Text style={[styles.lbHeroTitle, { color: theme.text }]}>{t('community.topAnglers')}</Text>
            <Text style={[styles.lbHeroSub, { color: theme.textMuted }]}>{metricPreview[lbFilter]}</Text>
            <View style={styles.filterDeck}>
              {(Object.keys(filterLabel) as (keyof typeof filterLabel)[]).map((key) => (
                <TouchableOpacity key={key} style={[styles.filterChip, { backgroundColor: theme.surfaceAlt, borderColor: theme.border }, lbFilter === key && styles.filterChipActive, lbFilter === key && { backgroundColor: theme.primaryStrong, borderColor: theme.primaryStrong }]} onPress={() => setLbFilter(key as any)}>
                  <View style={[styles.filterIconWrap, { backgroundColor: theme.surface }, lbFilter === key && styles.filterIconWrapActive, lbFilter === key && { backgroundColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.18)' }]}>
                    <Text style={styles.filterIcon}>{filterLabel[key].icon}</Text>
                  </View>
                  <Text style={[styles.filterTitle, { color: theme.text }, lbFilter === key && styles.filterTextActive]}>{filterLabel[key].title}</Text>
                  <Text style={[styles.filterSubtitle, { color: theme.textMuted }, lbFilter === key && styles.filterSubtextActive]}>{filterLabel[key].subtitle}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {loadingBoard ? (
            <View style={styles.center}><ActivityIndicator color={theme.primary} /></View>
          ) : sortedLeaderboard.length === 0 ? (
            <View style={styles.center}>
              <Text style={[styles.emptyText, { color: theme.textSoft }]}>{leaderboardError ? t('community.leaderboardLoadFailed') : t('community.noMonthlyCatches')}</Text>
              {!!leaderboardError && <Text style={[styles.lbErrorText, { color: theme.dangerText }]}>{leaderboardError}</Text>}
            </View>
          ) : (
            <FlatList
              data={sortedLeaderboard}
              keyExtractor={(item) => item.user_id}
              contentContainerStyle={{ padding: 16, paddingTop: 12 }}
              renderItem={({ item, index }) => {
                const medals = ['🥇', '🥈', '🥉'];
                const isMe = item.user_id === user?.id;
                const metricValue = lbFilter === 'total_catches' ? `${item.total_catches} 🐟` : lbFilter === 'biggest_fish_kg' ? `${Number(item.biggest_fish_kg ?? 0).toFixed(2)} kg` : `${Number(item.total_weight_kg ?? 0).toFixed(2)} kg`;
                const cardBackground = isMe ? theme.primarySoft : index < 3 ? theme.surfaceMuted : theme.surface;
                const cardBorder = isMe ? theme.primary : index < 3 ? theme.border : theme.borderSoft;

                return (
                  <View style={[styles.lbCard, isMe && styles.lbCardMe, index < 3 && styles.lbCardTop, { backgroundColor: cardBackground, borderColor: cardBorder }]}> 
                    <View style={[styles.lbRankRail, { backgroundColor: theme.surfaceAlt }] }>
                      <Text style={[styles.lbRank, { color: theme.text }]}>{medals[index] ?? `${index + 1}`}</Text>
                    </View>
                    <View style={[styles.lbAvatar, { backgroundColor: theme.primary }] }>
                      <Text style={styles.lbAvatarText}>{item.username?.[0]?.toUpperCase() ?? '?'}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <View style={styles.lbNameRow}>
                        <Text style={[styles.lbName, { color: theme.text }]}>@{item.username}</Text>
                        {isMe && <Text style={[styles.lbMeTag, { color: isDark ? theme.text : theme.primaryStrong, backgroundColor: isDark ? theme.primaryStrong : '#dff6eb' }]}>{t('community.you')}</Text>}
                      </View>
                      <Text style={[styles.lbSub, { color: theme.textMuted }]}>{item.total_catches} {t('community.totalFish')} · {Number(item.total_weight_kg ?? 0).toFixed(1)} {t('community.totalKg')}</Text>
                    </View>
                    <View style={[styles.lbMetricPill, { backgroundColor: isDark ? theme.surfaceAlt : '#eef8f4' }] }>
                      <Text style={[styles.lbMetricValue, { color: theme.primary }]}>{metricValue}</Text>
                    </View>
                  </View>
                );
              }}
            />
          )}
        </View>
      )}

      <MessageActionSheet
        visible={!!messageActionState}
        title={messageActionState?.kind === 'private' ? t('sheet.privateMessageTitle') : t('sheet.messageTitle')}
        username={messageActionState?.message?.profiles?.username}
        messagePreview={messageActionState?.message?.content}
        onEdit={handleMessageActionEdit}
        onDelete={handleMessageActionDelete}
        onClose={() => setMessageActionState(null)}
      />

      <ConfirmActionSheet
        visible={!!pendingDelete}
        title={t('sheet.confirmDeleteTitle')}
        message={pendingDelete?.kind === 'private' ? t('sheet.confirmDeletePrivate') : t('sheet.confirmDeleteGlobal')}
        onConfirm={confirmDeleteMessage}
        onClose={() => setPendingDelete(null)}
      />

      <Modal visible={!!publicProfileState} transparent animationType="fade" onRequestClose={() => setPublicProfileState(null)}>
        <View style={styles.profileOverlay}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setPublicProfileState(null)} />
          <View style={[styles.profileCard, { backgroundColor: theme.surface }]}> 
            <View style={[styles.profileHandle, { backgroundColor: isDark ? theme.border : '#D6DEE3' }]} />

            {loadingPublicProfile ? (
              <View style={styles.profileLoadingBox}>
                <ActivityIndicator color={theme.primary} />
                <Text style={[styles.profileLoadingText, { color: theme.textMuted }]}>{t('community.profileLoading')}</Text>
              </View>
            ) : publicProfileDetails ? (
              <>
                <View style={styles.profileHeaderRow}>
                  <View style={[styles.profileAvatarLarge, { backgroundColor: theme.primary }]}> 
                    <Text style={styles.profileAvatarLargeText}>{publicProfileDetails.username?.[0]?.toUpperCase() ?? '?'}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.profileUsername, { color: theme.text }]}>@{publicProfileDetails.username}</Text>
                    <Text style={[styles.profileFullName, { color: theme.textMuted }]}>{publicProfileDetails.full_name?.trim() || t('community.profileNoName')}</Text>
                    <Text style={[styles.profileMemberSince, { color: theme.textSoft }]}>{t('community.profileMemberSince', { date: formatDate(language, publicProfileDetails.created_at) })}</Text>
                  </View>
                </View>

                <View style={[styles.profileBioBox, { backgroundColor: theme.surfaceAlt, borderColor: theme.borderSoft }]}> 
                  <Text style={[styles.profileSectionLabel, { color: theme.textMuted }]}>{t('community.profilePublicData')}</Text>
                  <Text style={[styles.profileBioText, { color: theme.text }]}>{publicProfileDetails.bio?.trim() || t('community.profileNoBio')}</Text>
                </View>

                <View style={styles.profileStatsRow}>
                  <View style={[styles.profileStatCard, { backgroundColor: theme.surfaceAlt }]}> 
                    <Text style={[styles.profileStatValue, { color: theme.text }]}>{publicProfileDetails.catchesCount}</Text>
                    <Text style={[styles.profileStatLabel, { color: theme.textSoft }]}>{t('community.profileCatches')}</Text>
                  </View>
                  <View style={[styles.profileStatCard, { backgroundColor: theme.surfaceAlt }]}> 
                    <Text style={[styles.profileStatValue, { color: theme.text }]}>{publicProfileDetails.sessionsCount}</Text>
                    <Text style={[styles.profileStatLabel, { color: theme.textSoft }]}>{t('community.profileSessions')}</Text>
                  </View>
                  <View style={[styles.profileStatCard, { backgroundColor: theme.surfaceAlt }]}> 
                    <Text style={[styles.profileStatValue, { color: theme.text }]}>{publicProfileDetails.groupsCount}</Text>
                    <Text style={[styles.profileStatLabel, { color: theme.textSoft }]}>{t('community.profileGroups')}</Text>
                  </View>
                </View>

                <View style={styles.profileActionsRow}>
                  <TouchableOpacity style={[styles.profileSecondaryButton, { backgroundColor: theme.surfaceAlt, borderColor: theme.border }]} onPress={() => setPublicProfileState(null)}>
                    <Text style={[styles.profileSecondaryButtonText, { color: theme.text }]}>{t('community.profileClose')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.profilePrimaryButton, { backgroundColor: theme.primary }]} onPress={handleStartConversationFromProfile}>
                    <Text style={styles.profilePrimaryButtonText}>{t('community.profileSendMessage')}</Text>
                  </TouchableOpacity>
                </View>
              </>
            ) : null}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function MessageBubble({ isMe, message, time, username, theme, language, unknownUserLabel, onLongPress, onPress }: { isMe: boolean; message?: string; time: string; username?: string; theme: ReturnType<typeof getAppTheme>; language: 'ro' | 'en'; unknownUserLabel: string; onLongPress?: () => void; onPress?: () => void; }) {
  return (
    <TouchableOpacity activeOpacity={0.9} delayLongPress={220} onLongPress={onLongPress} onPress={!isMe ? onPress : undefined} style={[styles.msgRow, isMe && styles.msgRowMe]}>
      {!isMe && (
        <View style={[styles.msgAvatar, { backgroundColor: theme.primary }]}> 
          <Text style={styles.msgAvatarText}>{username?.[0]?.toUpperCase() ?? '?'}</Text>
        </View>
      )}
      <View style={[styles.msgBubble, { backgroundColor: theme.surface, borderColor: theme.borderSoft }, isMe && styles.msgBubbleMe, isMe && { backgroundColor: theme.primary, borderColor: theme.primary }]}> 
        {!isMe && <Text style={[styles.msgUsername, { color: theme.primary }]}>@{username ?? unknownUserLabel}</Text>}
        <Text style={[styles.msgContent, { color: isMe ? '#fff' : theme.text }, isMe && styles.msgContentMe]}>{message}</Text>
        <Text style={[styles.msgTime, { color: isMe ? 'rgba(255,255,255,0.65)' : theme.textSoft }]}>{formatTime(language, time, { hour: '2-digit', minute: '2-digit' })}</Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f4f6f8' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyText: { fontSize: 14, color: '#aaa', textAlign: 'center' },
  emptyHint: { fontSize: 13, textAlign: 'center', marginTop: 6 },
  header: { backgroundColor: '#fff', padding: 16, borderBottomWidth: 0.5, borderBottomColor: '#eee' },
  headerTitle: { fontSize: 18, fontWeight: '800', color: '#1a1a1a' },
  tabs: { flexDirection: 'row', backgroundColor: '#fff', borderBottomWidth: 0.5, borderBottomColor: '#eee' },
  tab: { flex: 1, padding: 12, alignItems: 'center' },
  tabActive: { borderBottomWidth: 2, borderBottomColor: '#1D9E75' },
  tabText: { fontSize: 13, color: '#888' },
  tabTextActive: { color: '#1D9E75', fontWeight: '700' },
  msgRow: { flexDirection: 'row', marginBottom: 10, gap: 8, alignItems: 'flex-end' },
  msgRowMe: { flexDirection: 'row-reverse' },
  msgAvatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#1D9E75', alignItems: 'center', justifyContent: 'center' },
  msgAvatarText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  msgBubble: { maxWidth: '75%', backgroundColor: '#fff', borderRadius: 16, borderBottomLeftRadius: 4, padding: 10, borderWidth: 0.5, borderColor: '#eee' },
  msgBubbleMe: { backgroundColor: '#1D9E75', borderBottomLeftRadius: 16, borderBottomRightRadius: 4, borderWidth: 0 },
  msgUsername: { fontSize: 11, color: '#1D9E75', fontWeight: '700', marginBottom: 3 },
  msgContent: { fontSize: 14, color: '#1a1a1a', lineHeight: 20 },
  msgContentMe: { color: '#fff' },
  msgTime: { fontSize: 10, color: '#aaa', marginTop: 4, textAlign: 'right' },
  editingBanner: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 0.5 },
  editingAccent: { width: 4, alignSelf: 'stretch', borderRadius: 999 },
  editingTitle: { fontSize: 13, fontWeight: '800' },
  editingPreview: { fontSize: 12, marginTop: 3, lineHeight: 18 },
  chatInput: { flexDirection: 'row', gap: 8, padding: 10, backgroundColor: '#fff', borderTopWidth: 0.5, borderTopColor: '#eee', alignItems: 'flex-end' },
  editingCancel: { fontSize: 12, fontWeight: '800' },
  chatTextInput: { flex: 1, backgroundColor: '#f4f6f8', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, color: '#1a1a1a', maxHeight: 100 },
  sendBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#1D9E75', alignItems: 'center', justifyContent: 'center' },
  sendBtnText: { color: '#fff', fontSize: 20, fontWeight: '700' },
  privateSearchWrap: { padding: 14, borderBottomWidth: 0.5, borderBottomColor: '#eee' },
  privateSearchInput: { borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14 },
  searchResultsRow: { gap: 10, paddingTop: 12 },
  personCard: { width: 150, padding: 12, borderRadius: 16, borderWidth: 1 },
  personAvatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  personAvatarText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  personName: { fontSize: 13, fontWeight: '800' },
  personSub: { fontSize: 12, marginTop: 4 },
  dmCard: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 16, padding: 12, marginBottom: 10, borderWidth: 1 },
  dmName: { fontSize: 14, fontWeight: '800' },
  dmPreview: { fontSize: 12, marginTop: 4 },
  dmTime: { fontSize: 11, marginLeft: 8 },
  unreadBadge: { minWidth: 22, height: 22, paddingHorizontal: 6, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  unreadBadgeText: { color: '#fff', fontSize: 11, fontWeight: '800' },
  privateHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderBottomWidth: 0.5 },
  privateTitle: { fontSize: 15, fontWeight: '800' },
  privateSubtitle: { fontSize: 12, marginTop: 2 },
  privateClose: { fontSize: 13, fontWeight: '700' },
  lbHero: { backgroundColor: '#fff', paddingHorizontal: 16, paddingTop: 14, paddingBottom: 16, borderBottomWidth: 0.5, borderBottomColor: '#eee' },
  lbHeroEyebrow: { fontSize: 10, color: '#7a8794', fontWeight: '800', letterSpacing: 1.1 },
  lbHeroTitle: { fontSize: 22, fontWeight: '900', color: '#12212d', marginTop: 4 },
  lbHeroSub: { fontSize: 13, color: '#667281', marginTop: 2 },
  filterDeck: { flexDirection: 'row', gap: 8, marginTop: 14 },
  filterChip: { flex: 1, minHeight: 88, paddingHorizontal: 10, paddingVertical: 12, borderRadius: 16, backgroundColor: '#f4f7f8', borderWidth: 1, borderColor: '#e6ebee' },
  filterChipActive: { backgroundColor: '#153f37', borderColor: '#153f37' },
  filterIconWrap: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  filterIconWrapActive: { backgroundColor: 'rgba(255,255,255,0.18)' },
  filterIcon: { fontSize: 18 },
  filterTitle: { fontSize: 11, color: '#24313d', fontWeight: '800' },
  filterSubtitle: { fontSize: 11, color: '#6d7884', marginTop: 2 },
  filterTextActive: { color: '#fff', fontWeight: '700' },
  filterSubtextActive: { color: 'rgba(255,255,255,0.82)' },
  lbErrorText: { fontSize: 12, color: '#C53A3A', textAlign: 'center', marginTop: 8, paddingHorizontal: 24 },
  lbCard: { backgroundColor: '#fff', borderRadius: 18, padding: 10, marginBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: '#edf1f2' },
  lbCardTop: { borderColor: '#dfe9e5', backgroundColor: '#fbfcfc' },
  lbCardMe: { borderColor: '#1D9E75', backgroundColor: '#f2fbf7' },
  lbRankRail: { width: 38, height: 52, borderRadius: 14, backgroundColor: '#f4f7f8', alignItems: 'center', justifyContent: 'center' },
  lbRank: { fontSize: 20, textAlign: 'center', fontWeight: '800', color: '#22313b' },
  lbAvatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#1D9E75', alignItems: 'center', justifyContent: 'center' },
  lbAvatarText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  lbNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap', paddingRight: 6 },
  lbName: { fontSize: 14, fontWeight: '800', color: '#1a1a1a', flexShrink: 1 },
  lbMeTag: { fontSize: 10, fontWeight: '800', color: '#0c6c52', backgroundColor: '#dff6eb', paddingHorizontal: 6, paddingVertical: 3, borderRadius: 999, alignSelf: 'flex-start' },
  lbSub: { fontSize: 11, color: '#78838f', marginTop: 3 },
  lbMetricPill: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 999, backgroundColor: '#eef8f4', minWidth: 82, alignItems: 'center' },
  lbMetricValue: { fontSize: 12, fontWeight: '900', color: '#11785b' },
  profileOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(5, 14, 20, 0.44)',
  },
  profileCard: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 22,
    paddingTop: 14,
    paddingBottom: Platform.OS === 'ios' ? 34 : 22,
  },
  profileHandle: {
    width: 48,
    height: 5,
    borderRadius: 999,
    alignSelf: 'center',
    marginBottom: 18,
  },
  profileLoadingBox: { alignItems: 'center', paddingVertical: 28, gap: 10 },
  profileLoadingText: { fontSize: 13 },
  profileHeaderRow: { flexDirection: 'row', gap: 14, alignItems: 'center' },
  profileAvatarLarge: { width: 62, height: 62, borderRadius: 31, alignItems: 'center', justifyContent: 'center' },
  profileAvatarLargeText: { color: '#fff', fontSize: 24, fontWeight: '900' },
  profileUsername: { fontSize: 20, fontWeight: '900' },
  profileFullName: { fontSize: 14, marginTop: 4 },
  profileMemberSince: { fontSize: 12, marginTop: 4 },
  profileBioBox: {
    marginTop: 18,
    borderRadius: 18,
    borderWidth: 1,
    padding: 14,
  },
  profileSectionLabel: { fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8 },
  profileBioText: { fontSize: 14, lineHeight: 21 },
  profileStatsRow: { flexDirection: 'row', gap: 10, marginTop: 16 },
  profileStatCard: { flex: 1, borderRadius: 16, paddingVertical: 14, paddingHorizontal: 8, alignItems: 'center' },
  profileStatValue: { fontSize: 22, fontWeight: '900' },
  profileStatLabel: { fontSize: 11, marginTop: 4, textAlign: 'center' },
  profileActionsRow: { flexDirection: 'row', gap: 10, marginTop: 18 },
  profileSecondaryButton: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
  },
  profileSecondaryButtonText: { fontSize: 14, fontWeight: '800' },
  profilePrimaryButton: {
    flex: 1,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
  },
  profilePrimaryButtonText: { fontSize: 14, fontWeight: '900', color: '#fff' },
});
