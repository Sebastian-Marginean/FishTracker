// App.tsx — Punctul de intrare al aplicației FishTracker

import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import AppNavigator from './src/navigation/AppNavigator';
import { useThemeStore } from './src/store/themeStore';
import { getAppTheme } from './src/theme';

export default function App() {
  const mode = useThemeStore((state) => state.mode);
  const theme = getAppTheme(mode);

  return (
    <SafeAreaProvider>
      <StatusBar style={theme.statusBar} />
      <AppNavigator />
    </SafeAreaProvider>
  );
}
