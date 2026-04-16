import React from 'react';
import { Modal, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useI18n } from '../i18n';
import { useThemeStore } from '../store/themeStore';
import { getAppTheme } from '../theme';

interface ConfirmActionSheetProps {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onClose: () => void;
}

export default function ConfirmActionSheet({
  visible,
  title,
  message,
  confirmLabel = 'Șterge',
  cancelLabel = 'Renunță',
  onConfirm,
  onClose,
}: ConfirmActionSheetProps) {
  const mode = useThemeStore((state) => state.mode);
  const { t } = useI18n();
  const theme = getAppTheme(mode);
  const isDark = mode === 'dark';

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />
        <View style={[styles.card, { backgroundColor: theme.surface }]}> 
          <View style={[styles.badgeOuter, { backgroundColor: isDark ? theme.dangerSoft : '#FFE8E8' }]}>
            <View style={[styles.badgeInner, { backgroundColor: theme.dangerText }]}> 
              <Text style={styles.badgeIcon}>!</Text>
            </View>
          </View>

          <Text style={[styles.title, { color: theme.text }]}>{title}</Text>
          <Text style={[styles.message, { color: theme.textMuted }]}>{message}</Text>

          <View style={styles.actionsRow}>
            <TouchableOpacity style={[styles.secondaryButton, { backgroundColor: theme.surfaceAlt, borderColor: theme.border }]} onPress={onClose}>
              <Text style={[styles.secondaryText, { color: theme.text }]}>{cancelLabel === 'Renunță' ? t('sheet.keep') : cancelLabel}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.primaryButton, { backgroundColor: theme.dangerSoft }]} onPress={onConfirm}>
              <Text style={[styles.primaryText, { color: theme.dangerText }]}>{confirmLabel === 'Șterge' ? t('common.delete') : confirmLabel}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 22,
    backgroundColor: 'rgba(6, 12, 17, 0.5)',
  },
  card: {
    borderRadius: 26,
    paddingHorizontal: 22,
    paddingTop: 24,
    paddingBottom: Platform.OS === 'ios' ? 24 : 20,
  },
  badgeOuter: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 14,
  },
  badgeInner: {
    width: 50,
    height: 50,
    borderRadius: 25,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeIcon: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '900',
    lineHeight: 24,
  },
  title: {
    fontSize: 22,
    fontWeight: '900',
    textAlign: 'center',
  },
  message: {
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
    marginTop: 8,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 20,
  },
  secondaryButton: {
    flex: 1,
    borderRadius: 16,
    borderWidth: 1,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryText: {
    fontSize: 14,
    fontWeight: '800',
  },
  primaryButton: {
    flex: 1,
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: {
    fontSize: 14,
    fontWeight: '900',
  },
});