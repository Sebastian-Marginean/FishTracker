import React, { useEffect, useRef, useState } from 'react';
import { Clipboard, Modal, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useI18n } from '../i18n';
import { useThemeStore } from '../store/themeStore';
import { getAppTheme } from '../theme';

interface SuccessSheetProps {
  visible: boolean;
  title: string;
  message: string;
  details?: string;
  detailsLabel?: string;
  copyValue?: string;
  buttonLabel?: string;
  autoCloseMs?: number;
  onClose: () => void;
}

export default function SuccessSheet({
  visible,
  title,
  message,
  details,
  detailsLabel,
  copyValue,
  buttonLabel = 'Perfect',
  autoCloseMs = 7000,
  onClose,
}: SuccessSheetProps) {
  const mode = useThemeStore((state) => state.mode);
  const { t } = useI18n();
  const theme = getAppTheme(mode);
  const isDark = mode === 'dark';
  const [copied, setCopied] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState(Math.ceil(autoCloseMs / 1000));
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!visible) {
      setCopied(false);
      setRemainingSeconds(Math.ceil(autoCloseMs / 1000));
      return;
    }

    const deadline = Date.now() + autoCloseMs;
    setRemainingSeconds(Math.ceil(autoCloseMs / 1000));

    const intervalId = setInterval(() => {
      const secondsLeft = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setRemainingSeconds(secondsLeft);
    }, 250);

    const timeoutId = setTimeout(() => {
      onCloseRef.current();
    }, autoCloseMs);

    return () => {
      clearInterval(intervalId);
      clearTimeout(timeoutId);
    };
  }, [autoCloseMs, visible]);

  const handleCopy = () => {
    if (!copyValue) return;
    Clipboard.setString(copyValue);
    setCopied(true);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={[styles.card, { backgroundColor: theme.surface }]}>
          <View style={styles.badgeWrap}>
            <View style={[styles.badgeOuter, { backgroundColor: isDark ? theme.primarySoft : '#DDF7EC' }]}>
              <View style={[styles.badgeInner, { backgroundColor: theme.primary }]}>
                <Text style={styles.badgeIcon}>✓</Text>
              </View>
            </View>
          </View>

          <Text style={[styles.eyebrow, { color: isDark ? theme.textMuted : '#679a8c' }]}>{t('sheet.successEyebrow')}</Text>
          <Text style={[styles.title, { color: theme.text }]}>{title}</Text>
          <Text style={[styles.message, { color: theme.textMuted }]}>{message}</Text>

          {details ? (
            <View style={[styles.detailsBox, { backgroundColor: isDark ? theme.surfaceAlt : '#F4FBF8', borderColor: isDark ? theme.border : '#D7EEE5' }]}>
              {detailsLabel ? <Text style={[styles.detailsLabel, { color: theme.textMuted }]}>{detailsLabel}</Text> : null}
              {copyValue ? (
                <View style={styles.detailsRow}>
                  <Text style={[styles.detailsCode, { color: isDark ? theme.text : '#0E6B52' }]}>{details}</Text>
                  <TouchableOpacity style={[styles.copyButton, { backgroundColor: isDark ? theme.primary : theme.primaryStrong }]} onPress={handleCopy}>
                    <Text style={styles.copyButtonText}>{copied ? t('sheet.copied') : t('sheet.copy')}</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <Text style={[styles.detailsText, { color: isDark ? theme.text : '#0E6B52' }]}>{details}</Text>
              )}
            </View>
          ) : null}

          <Text style={[styles.dismissHint, { color: theme.textSoft }]}>{t('sheet.successAutoClose', { seconds: remainingSeconds })}</Text>

          <TouchableOpacity style={[styles.button, { backgroundColor: isDark ? theme.primary : theme.primaryStrong }]} onPress={onClose}>
            <Text style={styles.buttonText}>{buttonLabel === 'Perfect' ? t('sheet.successButton') : buttonLabel}</Text>
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
    backgroundColor: 'rgba(6, 12, 17, 0.42)',
  },
  card: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    paddingHorizontal: 24,
    paddingTop: 22,
    paddingBottom: Platform.OS === 'ios' ? 34 : 24,
  },
  badgeWrap: {
    alignItems: 'center',
    marginBottom: 12,
  },
  badgeOuter: {
    width: 74,
    height: 74,
    borderRadius: 37,
    backgroundColor: '#DDF7EC',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeInner: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: '#1D9E75',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeIcon: {
    fontSize: 28,
    lineHeight: 30,
    color: '#fff',
    fontWeight: '900',
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: '800',
    color: '#679a8c',
    textTransform: 'uppercase',
    letterSpacing: 1,
    textAlign: 'center',
    marginBottom: 8,
  },
  title: {
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '900',
    color: '#10211c',
    textAlign: 'center',
    marginBottom: 8,
  },
  message: {
    fontSize: 15,
    lineHeight: 22,
    color: '#4d5d58',
    textAlign: 'center',
  },
  detailsBox: {
    marginTop: 16,
    marginBottom: 14,
    backgroundColor: '#F4FBF8',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#D7EEE5',
  },
  detailsLabel: {
    fontSize: 11,
    lineHeight: 16,
    color: '#6b8f84',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    textAlign: 'center',
    fontWeight: '800',
    marginBottom: 8,
  },
  detailsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  detailsCode: {
    flex: 1,
    fontSize: 17,
    lineHeight: 22,
    color: '#0E6B52',
    textAlign: 'center',
    fontWeight: '900',
    letterSpacing: 2,
  },
  detailsText: {
    fontSize: 14,
    lineHeight: 21,
    color: '#0E6B52',
    textAlign: 'center',
    fontWeight: '700',
  },
  copyButton: {
    backgroundColor: '#103B33',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  copyButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '800',
  },
  dismissHint: {
    fontSize: 12,
    color: '#81918c',
    textAlign: 'center',
    marginBottom: 12,
  },
  button: {
    marginTop: 4,
    backgroundColor: '#103B33',
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 15,
  },
  buttonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '800',
  },
});