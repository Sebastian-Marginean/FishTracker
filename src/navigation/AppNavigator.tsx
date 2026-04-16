// src/navigation/AppNavigator.tsx
// Navigarea principală a aplicației

import React, { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '../store/authStore';
import { useSessionStore } from '../store/sessionStore';
import { useThemeStore } from '../store/themeStore';
import { useUnreadStore } from '../store/unreadStore';
import { supabase } from '../lib/supabase';
import { useI18n } from '../i18n';
import { getAppTheme, getNavigationTheme } from '../theme';

// Screens
import LoginScreen from '../screens/auth/LoginScreen';
import RegisterScreen from '../screens/auth/RegisterScreen';
import DashboardScreen from '../screens/dashboard/DashboardScreen';
import LocationsScreen from '../screens/locations/LocationsScreen';
import GroupsScreen from '../screens/groups/GroupsScreen';
import CommunityScreen from '../screens/community/CommunityScreen';
import ProfileScreen from '../screens/profile/ProfileScreen';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

// Tab Navigator (pentru utilizatorii autentificați)
function MainTabs() {
  const insets = useSafeAreaInsets();
  const { user } = useAuthStore();
  const mode = useThemeStore((state) => state.mode);
  const refreshKey = useUnreadStore((state) => state.refreshKey);
  const { t } = useI18n();
  const theme = getAppTheme(mode);
  const [communityUnreadCount, setCommunityUnreadCount] = useState(0);
  const [groupUnreadCount, setGroupUnreadCount] = useState(0);

  useEffect(() => {
    if (!user?.id) {
      setCommunityUnreadCount(0);
      setGroupUnreadCount(0);
      return;
    }

    const fetchUnreadCounts = async () => {
      const { data: privateMemberships } = await supabase
        .from('private_conversation_members')
        .select('conversation_id, last_read_at')
        .eq('user_id', user.id);

      const privateConversationIds = (privateMemberships ?? []).map((row: any) => row.conversation_id);
      const privateReadMap = new Map<string, string | null>();
      for (const row of privateMemberships ?? []) {
        privateReadMap.set((row as any).conversation_id, (row as any).last_read_at ?? null);
      }

      let nextCommunityUnread = 0;
      if (privateConversationIds.length > 0) {
        const { data: privateMessages } = await supabase
          .from('private_messages')
          .select('conversation_id, user_id, created_at')
          .in('conversation_id', privateConversationIds);

        for (const row of privateMessages ?? []) {
          const conversationId = (row as any).conversation_id as string;
          const lastReadAt = privateReadMap.get(conversationId);
          const isUnread = (row as any).user_id !== user.id && (!lastReadAt || new Date((row as any).created_at).getTime() > new Date(lastReadAt).getTime());
          if (isUnread) nextCommunityUnread += 1;
        }
      }

      const { data: groupMemberships } = await supabase
        .from('group_members')
        .select('group_id, last_read_at')
        .eq('user_id', user.id);

      const groupIds = (groupMemberships ?? []).map((row: any) => row.group_id);
      const groupReadMap = new Map<string, string | null>();
      for (const row of groupMemberships ?? []) {
        groupReadMap.set((row as any).group_id, (row as any).last_read_at ?? null);
      }

      let nextGroupUnread = 0;
      if (groupIds.length > 0) {
        const { data: groupMessages } = await supabase
          .from('group_messages')
          .select('group_id, user_id, created_at')
          .in('group_id', groupIds);

        for (const row of groupMessages ?? []) {
          const groupId = (row as any).group_id as string;
          const lastReadAt = groupReadMap.get(groupId);
          const isUnread = (row as any).user_id !== user.id && (!lastReadAt || new Date((row as any).created_at).getTime() > new Date(lastReadAt).getTime());
          if (isUnread) nextGroupUnread += 1;
        }
      }

      setCommunityUnreadCount(nextCommunityUnread);
      setGroupUnreadCount(nextGroupUnread);
    };

    void fetchUnreadCounts();

    const channel = supabase
      .channel(`tab-unread-${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'private_messages' }, () => {
        void fetchUnreadCounts();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'private_conversation_members', filter: `user_id=eq.${user.id}` }, () => {
        void fetchUnreadCounts();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'group_messages' }, () => {
        void fetchUnreadCounts();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'group_members', filter: `user_id=eq.${user.id}` }, () => {
        void fetchUnreadCounts();
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [user?.id, refreshKey]);

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: theme.surface,
          borderTopColor: theme.border,
          borderTopWidth: 0.5,
          paddingTop: 6,
          paddingBottom: Math.max(insets.bottom, 10),
          height: 60 + Math.max(insets.bottom, 10),
        },
        sceneStyle: { backgroundColor: theme.background },
        tabBarActiveTintColor: theme.primary,
        tabBarInactiveTintColor: theme.tabInactive,
        tabBarLabelStyle: { fontSize: 11, marginBottom: 2 },
      }}
    >
      <Tab.Screen
        name="Dashboard"
        component={DashboardScreen}
        options={{ tabBarLabel: t('nav.session'), tabBarIcon: ({ color }) => <TabIcon icon="🎣" color={color} /> }}
      />
      <Tab.Screen
        name="Locations"
        component={LocationsScreen}
        options={{ tabBarLabel: t('nav.locations'), tabBarIcon: ({ color }) => <TabIcon icon="📍" color={color} /> }}
      />
      <Tab.Screen
        name="Groups"
        component={GroupsScreen}
        options={{
          tabBarLabel: t('nav.groups'),
          tabBarIcon: ({ color }) => <TabIcon icon="👥" color={color} />,
          tabBarBadge: groupUnreadCount > 0 ? (groupUnreadCount > 99 ? '99+' : groupUnreadCount) : undefined,
          tabBarBadgeStyle: { backgroundColor: theme.primary, color: '#fff' },
        }}
      />
      <Tab.Screen
        name="Community"
        component={CommunityScreen}
        options={{
          tabBarLabel: t('nav.community'),
          tabBarIcon: ({ color }) => <TabIcon icon="🌍" color={color} />,
          tabBarBadge: communityUnreadCount > 0 ? (communityUnreadCount > 99 ? '99+' : communityUnreadCount) : undefined,
          tabBarBadgeStyle: { backgroundColor: theme.primary, color: '#fff' },
        }}
      />
      <Tab.Screen
        name="Profile"
        component={ProfileScreen}
        options={{ tabBarLabel: t('nav.profile'), tabBarIcon: ({ color }) => <TabIcon icon="👤" color={color} /> }}
      />
    </Tab.Navigator>
  );
}

function TabIcon({ icon, color }: { icon: string; color: string }) {
  const { Text } = require('react-native');
  return <Text style={{ fontSize: 20, opacity: color === '#1D9E75' ? 1 : 0.5 }}>{icon}</Text>;
}

// Navigator principal
export default function AppNavigator() {
  const { user, isInitialized, initialize } = useAuthStore();
  const { loadFromStorage } = useSessionStore();
  const mode = useThemeStore((state) => state.mode);
  const theme = getAppTheme(mode);
  const navigationTheme = getNavigationTheme(mode);

  useEffect(() => {
    initialize();
    loadFromStorage();
  }, []);

  if (!isInitialized) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.background }}>
        <ActivityIndicator size="large" color={theme.primary} />
      </View>
    );
  }

  return (
    <NavigationContainer theme={navigationTheme}>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {user ? (
          <Stack.Screen name="Main" component={MainTabs} />
        ) : (
          <>
            <Stack.Screen name="Login" component={LoginScreen} />
            <Stack.Screen name="Register" component={RegisterScreen} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
