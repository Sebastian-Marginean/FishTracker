import { DarkTheme, DefaultTheme, type Theme } from '@react-navigation/native';
import type { ThemeMode } from '../store/themeStore';

export const appThemes = {
  light: {
    background: '#f4f6f8',
    surface: '#ffffff',
    surfaceMuted: '#fafafa',
    surfaceAlt: '#f0f3f6',
    border: '#e1e7eb',
    borderSoft: '#e9e9e9',
    text: '#1a1a1a',
    textMuted: '#6f7a83',
    textSoft: '#96a0a8',
    primary: '#1D9E75',
    primaryStrong: '#103B33',
    primarySoft: '#E1F5EE',
    inputBg: '#fafafa',
    dangerSoft: '#FFF1F1',
    dangerText: '#C53A3A',
    badgeBg: '#FAEEDA',
    badgeText: '#8A560A',
    tabInactive: '#888888',
    statusBar: 'dark' as const,
  },
  dark: {
    background: '#0f1417',
    surface: '#182127',
    surfaceMuted: '#1c262c',
    surfaceAlt: '#222e35',
    border: '#2d3b44',
    borderSoft: '#243038',
    text: '#eef4f6',
    textMuted: '#b6c2c9',
    textSoft: '#87959d',
    primary: '#36c497',
    primaryStrong: '#0d312b',
    primarySoft: '#15342d',
    inputBg: '#131b20',
    dangerSoft: '#3a1f24',
    dangerText: '#ff8f96',
    badgeBg: '#3e3320',
    badgeText: '#f1ca78',
    tabInactive: '#8e9aa2',
    statusBar: 'light' as const,
  },
};

export function getAppTheme(mode: ThemeMode) {
  return appThemes[mode];
}

export function getNavigationTheme(mode: ThemeMode): Theme {
  const palette = appThemes[mode];
  const baseTheme = mode === 'dark' ? DarkTheme : DefaultTheme;

  return {
    ...baseTheme,
    colors: {
      ...baseTheme.colors,
      background: palette.background,
      card: palette.surface,
      text: palette.text,
      border: palette.border,
      primary: palette.primary,
      notification: palette.primary,
    },
  };
}