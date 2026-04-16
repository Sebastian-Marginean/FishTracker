// src/screens/auth/LoginScreen.tsx

import React, { useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, KeyboardAvoidingView, Platform,
  ScrollView, ActivityIndicator,
  ImageBackground,
  Modal,
} from 'react-native';
import PasswordStrengthMeter from '../../components/PasswordStrengthMeter';
import SuccessSheet from '../../components/SuccessSheet';
import { useAuthStore } from '../../store/authStore';
import { formatDateTime, useI18n } from '../../i18n';
import { useLanguageStore } from '../../store/languageStore';

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

type ResetStep = 'request' | 'confirm';

const EMAIL_ACTION_COOLDOWN_MS = 60_000;

function isRateLimitMessage(message: string) {
  return /email rate limit exceeded|too many requests/i.test(message);
}

function isInvalidCodeMessage(message: string) {
  return /cod invalid|invalid or expired/i.test(message);
}

function getFriendlyAuthMessage(
  message: string,
  t: (key: string, params?: Record<string, string | number>) => string,
) {
  if (isRateLimitMessage(message)) {
    return t('auth.emailRateLimit');
  }

  if (isInvalidCodeMessage(message)) {
    return t('auth.resetCodeInvalid');
  }

  return message;
}

export default function LoginScreen({ navigation }: any) {
  const { signIn, resetPassword, confirmPasswordReset, isLoading, accessBlock, clearAccessBlock } = useAuthStore();
  const { language, t } = useI18n();
  const setLanguage = useLanguageStore((state) => state.setLanguage);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [resetModalVisible, setResetModalVisible] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetCode, setResetCode] = useState('');
  const [resetNewPassword, setResetNewPassword] = useState('');
  const [resetConfirmPassword, setResetConfirmPassword] = useState('');
  const [showResetNewPassword, setShowResetNewPassword] = useState(false);
  const [showResetConfirmPassword, setShowResetConfirmPassword] = useState(false);
  const [resetStep, setResetStep] = useState<ResetStep>('request');
  const [successState, setSuccessState] = useState<SuccessState | null>(null);
  const [noticeState, setNoticeState] = useState<NoticeState | null>(null);
  const [resetCooldownUntil, setResetCooldownUntil] = useState<number | null>(null);
  const [resetCooldownLeft, setResetCooldownLeft] = useState(0);

  const openWarningNotice = (title: string, message: string, details?: string) => {
    setNoticeState({ title, message, details });
  };

  const openAuthErrorNotice = (title: string, message: string) => {
    openWarningNotice(title, getFriendlyAuthMessage(message, t));
  };

  const openRateLimitNotice = (seconds: number) => {
    openWarningNotice(t('auth.rateLimitTitle'), t('auth.rateLimitMessage'), t('auth.emailCooldown', { seconds }));
  };

  const openInvalidCodeNotice = () => {
    openWarningNotice(t('auth.invalidCodeTitle'), t('auth.invalidCodeMessage'));
  };

  useEffect(() => {
    if (!accessBlock || accessBlock.kind !== 'ban') return;

    openWarningNotice(
      t('auth.accountBannedTitle'),
      t('auth.accountBannedMessage'),
      accessBlock.permanent
        ? t('auth.accountBannedPermanent')
        : accessBlock.until
          ? t('auth.accountBannedUntil', { date: formatDateTime(language, accessBlock.until) })
          : undefined,
    );
    clearAccessBlock();
  }, [accessBlock, clearAccessBlock, language, t]);

  useEffect(() => {
    if (!resetCooldownUntil) {
      setResetCooldownLeft(0);
      return;
    }

    const updateRemaining = () => {
      const remainingMs = Math.max(0, resetCooldownUntil - Date.now());
      const remainingSeconds = Math.ceil(remainingMs / 1000);
      setResetCooldownLeft(remainingSeconds);

      if (remainingMs <= 0) {
        setResetCooldownUntil(null);
      }
    };

    updateRemaining();
    const timer = setInterval(updateRemaining, 1000);

    return () => clearInterval(timer);
  }, [resetCooldownUntil]);

  const handleLogin = async () => {
    if (!email.trim() || !password.trim()) {
      openWarningNotice(t('auth.validationTitle'), t('auth.fillLoginFields'));
      return;
    }
    const { error } = await signIn(email.trim(), password);
    if (error) openAuthErrorNotice(t('auth.loginFailed'), error);
  };

  const handleResetPassword = async () => {
    if (!resetEmail.trim()) {
      openWarningNotice(t('auth.validationTitle'), t('auth.emailRequired'));
      return;
    }

    if (resetCooldownLeft > 0) {
      openRateLimitNotice(resetCooldownLeft);
      return;
    }

    const { error } = await resetPassword(resetEmail.trim());
    if (error) {
      if (isRateLimitMessage(error)) {
        setResetCooldownUntil(Date.now() + EMAIL_ACTION_COOLDOWN_MS);
        openRateLimitNotice(60);
        return;
      }

      openAuthErrorNotice(t('common.error'), error);
      return;
    }

    setResetCooldownUntil(Date.now() + EMAIL_ACTION_COOLDOWN_MS);
    setResetStep('confirm');
    setSuccessState({
      title: t('auth.resetPasswordSuccessTitle'),
      message: t('auth.resetPasswordSuccessMessage'),
      details: resetEmail.trim(),
    });
  };

  const closeResetModal = () => {
    setResetModalVisible(false);
    setResetStep('request');
    setResetCode('');
    setResetNewPassword('');
    setResetConfirmPassword('');
  };

  const handleConfirmResetPassword = async () => {
    if (!resetEmail.trim()) {
      openWarningNotice(t('auth.validationTitle'), t('auth.emailRequired'));
      return;
    }

    if (!resetCode.trim()) {
      openWarningNotice(t('auth.validationTitle'), t('auth.resetCodeRequired'));
      return;
    }

    if (resetNewPassword.length < 8) {
      openWarningNotice(t('auth.validationTitle'), t('auth.passwordTooShort'));
      return;
    }

    if (resetNewPassword !== resetConfirmPassword) {
      openWarningNotice(t('auth.validationTitle'), t('auth.passwordMismatch'));
      return;
    }

    const submittedEmail = resetEmail.trim();
    const { error } = await confirmPasswordReset(submittedEmail, resetCode.trim(), resetNewPassword);
    if (error) {
      if (isInvalidCodeMessage(error)) {
        openInvalidCodeNotice();
        return;
      }

      openAuthErrorNotice(t('common.error'), error);
      return;
    }

    closeResetModal();
    setResetEmail('');
    setSuccessState({
      title: t('auth.resetPasswordDoneTitle'),
      message: t('auth.resetPasswordDoneMessage'),
      details: submittedEmail,
    });
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.inner} keyboardShouldPersistTaps="handled">
        <ImageBackground
          source={require('../../../assets/splash-icon.png')}
          style={styles.hero}
          imageStyle={styles.heroImage}
        >
          <View style={styles.heroOverlay}>
            <View style={styles.languageRow}>
              <View>
                <Text style={styles.languageLabel}>{t('auth.languageLabel')}</Text>
                <Text style={styles.languageValue}>{language === 'ro' ? t('auth.languageRo') : t('auth.languageEn')}</Text>
              </View>
              <View style={styles.langButtonsRow}>
                {(['ro', 'en'] as const).map((lang) => (
                  <TouchableOpacity
                    key={lang}
                    style={[styles.langButton, language === lang && styles.langButtonActive]}
                    onPress={() => setLanguage(lang)}
                  >
                    <Text style={[styles.langButtonText, language === lang && styles.langButtonTextActive]}>{lang.toUpperCase()}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View style={styles.header}>
              <Text style={styles.eyebrow}>{t('auth.welcomeEyebrow')}</Text>
              <Text style={styles.logo}>🎣</Text>
              <Text style={styles.appName}>{t('auth.loginTitle')}</Text>
              <Text style={styles.headline}>{t('auth.loginHeadline')}</Text>
              <Text style={styles.tagline}>{t('auth.loginDescription')}</Text>
            </View>
          </View>
        </ImageBackground>

        <View style={styles.formCard}>
          <Text style={styles.formTitle}>{t('auth.loginCardTitle')}</Text>
          <Text style={styles.formSubtitle}>{t('auth.loginCardSubtitle')}</Text>

          <View style={styles.form}>
            <Text style={styles.label}>{t('auth.email')}</Text>
            <TextInput
              style={styles.input}
              placeholder="email@example.com"
              placeholderTextColor="#9AA6A0"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
            />

            <Text style={styles.label}>{t('auth.password')}</Text>
            <View style={styles.passwordInputWrap}>
              <TextInput
                style={[styles.input, styles.passwordInput]}
                placeholder={t('auth.password')}
                placeholderTextColor="#9AA6A0"
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPassword}
              />
              <TouchableOpacity style={styles.passwordToggle} onPress={() => setShowPassword((value) => !value)}>
                <Text style={styles.passwordToggleText}>{showPassword ? t('common.hide') : t('common.show')}</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={[styles.button, isLoading && styles.buttonDisabled]}
              onPress={handleLogin}
              disabled={isLoading}
            >
              {isLoading
                ? <ActivityIndicator color="#fff" />
                : <Text style={styles.buttonText}>{t('auth.login')}</Text>
              }
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.linkButton}
              onPress={() => navigation.navigate('Register')}
            >
              <Text style={styles.linkText}>{t('auth.noAccount')} <Text style={styles.linkBold}>{t('auth.registerNow')}</Text></Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.ghostLinkButton} onPress={() => {
              setResetEmail(email);
              setResetStep('request');
              setResetCode('');
              setResetNewPassword('');
              setResetConfirmPassword('');
              setResetModalVisible(true);
            }}>
              <Text style={styles.ghostLinkText}>{t('auth.forgotPassword')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>

      <Modal visible={resetModalVisible} transparent animationType="slide" onRequestClose={closeResetModal}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHandle} />
            <View style={styles.modalHeroRow}>
              <View style={styles.modalHeroBadge}>
                <Text style={styles.modalHeroIcon}>{resetStep === 'request' ? '📩' : '🔐'}</Text>
              </View>
              <View style={styles.modalHeroCopy}>
                <Text style={styles.modalTitle}>
                  {resetStep === 'request' ? t('auth.resetPasswordTitle') : t('auth.resetPasswordConfirmTitle')}
                </Text>
                <Text style={styles.modalSubtitle}>
                  {resetStep === 'request' ? t('auth.resetPasswordSubtitle') : t('auth.resetPasswordConfirmSubtitle')}
                </Text>
              </View>
            </View>

            <View style={styles.modalInfoCard}>
              <Text style={styles.modalInfoTitle}>
                {resetStep === 'request' ? t('auth.resetPasswordInfoTitle') : t('auth.resetPasswordConfirmInfoTitle')}
              </Text>
              <Text style={styles.modalInfoText}>
                {resetStep === 'request' ? t('auth.resetPasswordInfoBody') : t('auth.resetPasswordConfirmInfoBody')}
              </Text>
            </View>

            <View style={styles.modalFieldGroup}>
              <Text style={styles.modalFieldLabel}>{t('auth.resetPasswordEmailLabel')}</Text>
              <TextInput
                style={styles.modalInput}
                placeholder="email@example.com"
                placeholderTextColor="#9AA6A0"
                value={resetEmail}
                onChangeText={setResetEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
              />
            </View>
            {resetStep === 'confirm' && (
              <>
                <View style={styles.modalFieldGroup}>
                  <Text style={styles.modalFieldLabel}>{t('auth.resetPasswordConfirmTitle')}</Text>
                  <TextInput
                    style={[styles.modalInput, styles.modalCodeInput]}
                    placeholder={t('auth.resetCodePlaceholder')}
                    placeholderTextColor="#9AA6A0"
                    value={resetCode}
                    onChangeText={(value) => setResetCode(value.replace(/\D/g, '').slice(0, 6))}
                    keyboardType="number-pad"
                    autoCapitalize="none"
                    maxLength={6}
                    textAlign="center"
                  />
                </View>
                <View style={styles.modalFieldGroup}>
                  <Text style={styles.modalFieldLabel}>{t('auth.newPassword')}</Text>
                  <View style={styles.passwordInputWrap}>
                    <TextInput
                      style={[styles.modalInput, styles.passwordInput]}
                      placeholder={t('auth.newPassword')}
                      placeholderTextColor="#9AA6A0"
                      value={resetNewPassword}
                      onChangeText={setResetNewPassword}
                      secureTextEntry={!showResetNewPassword}
                    />
                    <TouchableOpacity style={styles.passwordToggle} onPress={() => setShowResetNewPassword((value) => !value)}>
                      <Text style={styles.passwordToggleText}>{showResetNewPassword ? t('common.hide') : t('common.show')}</Text>
                    </TouchableOpacity>
                  </View>
                  <PasswordStrengthMeter password={resetNewPassword} variant="auth" />
                </View>
                <View style={styles.modalFieldGroup}>
                  <Text style={styles.modalFieldLabel}>{t('auth.confirmPassword')}</Text>
                  <View style={styles.passwordInputWrap}>
                    <TextInput
                      style={[styles.modalInput, styles.passwordInput]}
                      placeholder={t('auth.confirmPassword')}
                      placeholderTextColor="#9AA6A0"
                      value={resetConfirmPassword}
                      onChangeText={setResetConfirmPassword}
                      secureTextEntry={!showResetConfirmPassword}
                    />
                    <TouchableOpacity style={styles.passwordToggle} onPress={() => setShowResetConfirmPassword((value) => !value)}>
                      <Text style={styles.passwordToggleText}>{showResetConfirmPassword ? t('common.hide') : t('common.show')}</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </>
            )}
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalSecondaryBtn} onPress={closeResetModal}>
                <Text style={styles.modalSecondaryText}>{t('common.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalPrimaryBtn, (isLoading || resetCooldownLeft > 0) && styles.buttonDisabled]}
                onPress={resetStep === 'request' ? handleResetPassword : handleConfirmResetPassword}
                disabled={isLoading || (resetStep === 'request' && resetCooldownLeft > 0)}
              >
                {isLoading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.modalPrimaryText}>
                    {resetStep === 'request' ? t('auth.resetPasswordButton') : t('auth.resetPasswordConfirmButton')}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
            {resetStep === 'confirm' && (
              <TouchableOpacity
                style={styles.linkButton}
                onPress={() => setResetStep('request')}
                disabled={isLoading}
              >
                <Text style={styles.linkBold}>{t('auth.resetPasswordResend')}</Text>
              </TouchableOpacity>
            )}
            {resetStep === 'request' && resetCooldownLeft > 0 && (
              <Text style={styles.cooldownHint}>{t('auth.emailCooldown', { seconds: resetCooldownLeft })}</Text>
            )}
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
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#E8EFEA' },
  inner: { flexGrow: 1, paddingBottom: 28 },
  hero: {
    minHeight: 360,
    backgroundColor: '#0C2F28',
    justifyContent: 'space-between',
  },
  heroImage: {
    opacity: 0.12,
    resizeMode: 'cover',
    transform: [{ scale: 1.6 }],
  },
  heroOverlay: {
    flex: 1,
    backgroundColor: 'rgba(7, 32, 27, 0.82)',
    paddingHorizontal: 24,
    paddingTop: 56,
    paddingBottom: 36,
  },
  languageRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 40,
    gap: 12,
  },
  languageLabel: {
    fontSize: 11,
    color: 'rgba(232, 243, 238, 0.72)',
    textTransform: 'uppercase',
    letterSpacing: 1,
    fontWeight: '700',
  },
  languageValue: {
    fontSize: 16,
    color: '#F4FBF7',
    fontWeight: '700',
    marginTop: 4,
  },
  langButtonsRow: { flexDirection: 'row', gap: 8 },
  langButton: {
    minWidth: 52,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
  },
  langButtonActive: {
    backgroundColor: '#9BE7C8',
    borderColor: '#9BE7C8',
  },
  langButtonText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#F4FBF7',
  },
  langButtonTextActive: {
    color: '#0D3A31',
  },
  header: { alignItems: 'flex-start' },
  eyebrow: {
    fontSize: 11,
    color: '#9BE7C8',
    textTransform: 'uppercase',
    letterSpacing: 1.4,
    fontWeight: '800',
    marginBottom: 10,
  },
  logo: { fontSize: 54, marginBottom: 8 },
  appName: { fontSize: 34, fontWeight: '800', color: '#F4FBF7' },
  headline: {
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '800',
    color: '#FFFFFF',
    marginTop: 10,
    maxWidth: 320,
  },
  tagline: {
    fontSize: 15,
    lineHeight: 22,
    color: 'rgba(232, 243, 238, 0.84)',
    marginTop: 12,
    maxWidth: 320,
  },
  formCard: {
    marginTop: -34,
    marginHorizontal: 20,
    backgroundColor: '#F7FBF8',
    borderRadius: 24,
    padding: 20,
    shadowColor: '#08261F',
    shadowOpacity: 0.12,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
    borderWidth: 1,
    borderColor: '#D9E7E0',
  },
  formTitle: { fontSize: 24, fontWeight: '800', color: '#123A31' },
  formSubtitle: { fontSize: 14, color: '#6A7E76', marginTop: 6, marginBottom: 14 },
  form: { gap: 8 },
  label: { fontSize: 13, fontWeight: '700', color: '#27473E', marginBottom: 4, marginTop: 8 },
  input: {
    borderWidth: 1,
    borderColor: '#D0DDD6',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 15,
    fontSize: 15,
    color: '#17352D',
    backgroundColor: '#FFFFFF',
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
    right: 14,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#E8F5EF',
  },
  passwordToggleText: {
    color: '#0F6E56',
    fontSize: 12,
    fontWeight: '800',
  },
  button: {
    backgroundColor: '#1D9E75', borderRadius: 16, padding: 17,
    alignItems: 'center', marginTop: 22,
    shadowColor: '#1D9E75',
    shadowOpacity: 0.24,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  linkButton: { alignItems: 'center', marginTop: 16 },
  ghostLinkButton: { alignItems: 'center', marginTop: 10 },
  linkText: { fontSize: 14, color: '#667A73' },
  linkBold: { color: '#1D9E75', fontWeight: '800' },
  ghostLinkText: { fontSize: 13, color: '#0F6E56', fontWeight: '700' },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(7, 32, 27, 0.5)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: '#F7FBF8',
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    padding: 24,
    paddingBottom: 30,
    borderWidth: 1,
    borderColor: '#D7E7DF',
  },
  modalHandle: {
    width: 56,
    height: 5,
    borderRadius: 999,
    backgroundColor: '#D0DED7',
    alignSelf: 'center',
    marginBottom: 18,
  },
  modalHeroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  modalHeroBadge: {
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: '#DDF4E8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalHeroIcon: {
    fontSize: 24,
  },
  modalHeroCopy: {
    flex: 1,
  },
  modalTitle: { fontSize: 22, fontWeight: '800', color: '#123A31' },
  modalSubtitle: { fontSize: 14, lineHeight: 20, color: '#6A7E76', marginTop: 6 },
  modalInfoCard: {
    marginTop: 18,
    marginBottom: 10,
    borderRadius: 18,
    backgroundColor: '#EDF7F2',
    borderWidth: 1,
    borderColor: '#D5EADF',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  modalInfoTitle: {
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    color: '#4A6B61',
    marginBottom: 6,
  },
  modalInfoText: {
    fontSize: 14,
    lineHeight: 20,
    color: '#587169',
  },
  modalFieldGroup: {
    marginTop: 12,
  },
  modalFieldLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: '#45625A',
    textTransform: 'uppercase',
    letterSpacing: 0.7,
    marginBottom: 8,
  },
  modalInput: {
    borderWidth: 1,
    borderColor: '#D0DDD6',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 15,
    fontSize: 15,
    color: '#17352D',
    backgroundColor: '#FFFFFF',
  },
  modalCodeInput: {
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: 4,
  },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 18 },
  modalSecondaryBtn: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: '#EAF1ED',
  },
  modalSecondaryText: { color: '#365149', fontWeight: '700', fontSize: 14 },
  modalPrimaryBtn: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: '#1D9E75',
  },
  modalPrimaryText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  cooldownHint: {
    marginTop: 12,
    fontSize: 12,
    lineHeight: 18,
    color: '#5B6B66',
  },
});
