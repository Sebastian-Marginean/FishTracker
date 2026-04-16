import React from 'react';
import { Modal, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useI18n } from '../i18n';
import { useThemeStore } from '../store/themeStore';
import { getAppTheme } from '../theme';

interface MessageActionSheetProps {
  visible: boolean;
  title: string;
  messagePreview?: string;
  username?: string;
  onEdit: () => void;
  onDelete: () => void;
  onClose: () => void;
}

export default function MessageActionSheet({
  visible,
  title,
  messagePreview,
  username,
  onEdit,
  onDelete,
  onClose,
}: MessageActionSheetProps) {
  const mode = useThemeStore((state) => state.mode);
  const { t } = useI18n();
  const theme = getAppTheme(mode);
  const isDark = mode === 'dark';

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />
        <View style={[styles.card, { backgroundColor: theme.surface }]}> 
          <View style={[styles.handle, { backgroundColor: isDark ? theme.border : '#D6DEE3' }]} />
          <Text style={[styles.title, { color: theme.text }]}>{title}</Text>
          <Text style={[styles.subtitle, { color: theme.textMuted }]}>{username ? `@${username}` : t('sheet.messageActionSubtitle')}</Text>

          <View style={[styles.previewBox, { backgroundColor: theme.surfaceAlt, borderColor: theme.borderSoft }]}> 
            <Text style={[styles.previewText, { color: theme.text }]} numberOfLines={4}>{messagePreview?.trim() || t('sheet.emptyMessage')}</Text>
          </View>

          <View style={styles.actionsRow}>
            <TouchableOpacity style={[styles.secondaryButton, { backgroundColor: theme.surfaceAlt, borderColor: theme.border }]} onPress={onEdit}>
              <Text style={[styles.secondaryText, { color: theme.text }]}>{t('common.edit')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.primaryButton, { backgroundColor: theme.dangerSoft }]} onPress={onDelete}>
              <Text style={[styles.primaryText, { color: theme.dangerText }]}>{t('common.delete')}</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={styles.cancelButton} onPress={onClose}>
            <Text style={[styles.cancelText, { color: theme.textSoft }]}>{t('common.cancel')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(5, 14, 20, 0.44)',
  },
  card: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 22,
    paddingTop: 14,
    paddingBottom: Platform.OS === 'ios' ? 34 : 22,
  },
  handle: {
    width: 48,
    height: 5,
    borderRadius: 999,
    alignSelf: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 21,
    fontWeight: '900',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 13,
    textAlign: 'center',
    marginTop: 6,
    marginBottom: 14,
  },
  previewBox: {
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  previewText: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
  },
  secondaryButton: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
  },
  secondaryText: {
    fontSize: 14,
    fontWeight: '800',
  },
  primaryButton: {
    flex: 1,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
  },
  primaryText: {
    fontSize: 14,
    fontWeight: '900',
  },
  cancelButton: {
    alignSelf: 'center',
    marginTop: 14,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  cancelText: {
    fontSize: 13,
    fontWeight: '700',
  },
});