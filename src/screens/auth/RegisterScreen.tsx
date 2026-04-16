import React, { useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, KeyboardAvoidingView, Platform,
  ScrollView, ActivityIndicator, ImageBackground,
} from 'react-native';
import PasswordStrengthMeter from '../../components/PasswordStrengthMeter';
import SuccessSheet from '../../components/SuccessSheet';
import { useAuthStore } from '../../store/authStore';
import { useI18n } from '../../i18n';
import { useLanguageStore } from '../../store/languageStore';

const EMAIL_ACTION_COOLDOWN_MS = 60_000;

interface NoticeState {
  title: string;
  message: string;
  details?: string;
}

interface SuccessState {
  title: string;
  message: string;
  details?: string;
}

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

  if (/username-ul este deja folosit|username is already|username already exists/i.test(message)) {
    return t('auth.usernameTaken');
  }

  if (/exista deja un cont cu acest email|account with this email already exists/i.test(message)) {
    return t('auth.accountAlreadyExists');
  }

  return message;
}

function maskEmail(email: string) {
  const trimmedEmail = email.trim().toLowerCase();
  const [localPart, domain = ''] = trimmedEmail.split('@');

  if (!localPart || !domain) {
    return trimmedEmail;
  }

  if (localPart.length <= 2) {
    return `${localPart[0] ?? ''}*@${domain}`;
  }

  return `${localPart.slice(0, 2)}${'*'.repeat(Math.max(2, localPart.length - 2))}@${domain}`;
}

function normalizeUsername(value: string) {
  return value.trim().replace(/\s+/g, ' ');
}

export default function RegisterScreen({ navigation }: any) {
  const { signUp, confirmSignUp, isLoading } = useAuthStore();
  const { language, t } = useI18n();
  const setLanguage = useLanguageStore((state) => state.setLanguage);
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [verificationCode, setVerificationCode] = useState('');
  const [pendingVerificationEmail, setPendingVerificationEmail] = useState('');
  const [awaitingVerification, setAwaitingVerification] = useState(false);
  const [registerCooldownUntil, setRegisterCooldownUntil] = useState<number | null>(null);
  const [registerCooldownLeft, setRegisterCooldownLeft] = useState(0);
  const [noticeState, setNoticeState] = useState<NoticeState | null>(null);
  const [successState, setSuccessState] = useState<SuccessState | null>(null);

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

  const handleVerificationCodeChange = (value: string) => {
    setVerificationCode(value.replace(/\D/g, '').slice(0, 6));
  };

  useEffect(() => {
    if (!registerCooldownUntil) {
      setRegisterCooldownLeft(0);
      return;
    }

    const updateRemaining = () => {
      const remainingMs = Math.max(0, registerCooldownUntil - Date.now());
      const remainingSeconds = Math.ceil(remainingMs / 1000);
      setRegisterCooldownLeft(remainingSeconds);

      if (remainingMs <= 0) {
        setRegisterCooldownUntil(null);
      }
    };

    updateRemaining();
    const timer = setInterval(updateRemaining, 1000);

    return () => clearInterval(timer);
  }, [registerCooldownUntil]);

  const handleRegister = async () => {
    const normalizedUsername = normalizeUsername(username);

    if (!normalizedUsername || !email.trim() || !password.trim()) {
      openWarningNotice(t('auth.validationTitle'), t('auth.fillAllFields'));
      return;
    }
    if (password !== confirmPassword) {
      openWarningNotice(t('auth.validationTitle'), t('auth.passwordMismatch'));
      return;
    }
    if (password.length < 8) {
      openWarningNotice(t('auth.validationTitle'), t('auth.passwordTooShort'));
      return;
    }
    if (normalizedUsername.length < 3) {
      openWarningNotice(t('auth.validationTitle'), t('auth.usernameTooShort'));
      return;
    }

    if (registerCooldownLeft > 0) {
      openRateLimitNotice(registerCooldownLeft);
      return;
    }

    const submittedEmail = email.trim();
    const { error } = await signUp(submittedEmail, password, normalizedUsername);
    if (error) {
      if (isRateLimitMessage(error)) {
        setRegisterCooldownUntil(Date.now() + EMAIL_ACTION_COOLDOWN_MS);
        openRateLimitNotice(60);
        return;
      }

      openAuthErrorNotice(t('auth.registerFailed'), error);
    } else {
      setUsername(normalizedUsername);
      setRegisterCooldownUntil(Date.now() + EMAIL_ACTION_COOLDOWN_MS);
      setPendingVerificationEmail(submittedEmail);
      setAwaitingVerification(true);
      setVerificationCode('');
      setSuccessState({
        title: t('auth.registerVerificationSentTitle'),
        message: t('auth.registerVerificationSentMessage'),
        details: `${maskEmail(submittedEmail)}\n${t('auth.emailCooldown', { seconds: 60 })}`,
      });
    }
  };

  const handleConfirmSignUp = async () => {
    if (!pendingVerificationEmail.trim()) {
      openWarningNotice(t('auth.validationTitle'), t('auth.emailRequired'));
      return;
    }

    if (!verificationCode.trim()) {
      openWarningNotice(t('auth.validationTitle'), t('auth.registerVerificationCodeRequired'));
      return;
    }

    const { error } = await confirmSignUp(pendingVerificationEmail.trim(), verificationCode.trim());
    if (error) {
      if (isInvalidCodeMessage(error)) {
        openInvalidCodeNotice();
        return;
      }

      openAuthErrorNotice(t('common.error'), error);
      return;
    }

    setAwaitingVerification(false);
    setPendingVerificationEmail('');
    setVerificationCode('');
    setSuccessState({
      title: t('auth.registerVerifiedTitle'),
      message: t('auth.registerVerifiedMessage'),
    });
  };

  useEffect(() => {
    if (!successState || successState.title !== t('auth.registerVerifiedTitle')) {
      return;
    }

    const timeoutId = setTimeout(() => {
      setSuccessState(null);
      navigation.navigate('Login');
    }, 2200);

    return () => clearTimeout(timeoutId);
  }, [navigation, successState, t]);

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
              <Text style={styles.eyebrow}>{t('auth.registerEyebrow')}</Text>
              <Text style={styles.logo}>🪝</Text>
              <Text style={styles.appName}>{t('auth.registerTitle')}</Text>
              <Text style={styles.headline}>{t('auth.registerHeadline')}</Text>
              <Text style={styles.tagline}>{t('auth.registerDescription')}</Text>
            </View>
          </View>
        </ImageBackground>

        <View style={styles.formCard}>
          <Text style={styles.formTitle}>{t('auth.registerCardTitle')}</Text>
          <Text style={styles.formSubtitle}>{t('auth.registerCardSubtitle')}</Text>

          <View style={styles.form}>
            <Text style={styles.label}>{t('auth.username')}</Text>
            <TextInput
              style={styles.input}
              placeholder="pescar_profesionist"
              placeholderTextColor="#9AA6A0"
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
            />

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
                placeholder={t('auth.passwordMinPlaceholder')}
                placeholderTextColor="#9AA6A0"
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPassword}
              />
              <TouchableOpacity style={styles.passwordToggle} onPress={() => setShowPassword((value) => !value)}>
                <Text style={styles.passwordToggleText}>{showPassword ? t('common.hide') : t('common.show')}</Text>
              </TouchableOpacity>
            </View>
            <PasswordStrengthMeter password={password} variant="auth" />

            <Text style={styles.label}>{t('auth.confirmPassword')}</Text>
            <View style={styles.passwordInputWrap}>
              <TextInput
                style={[styles.input, styles.passwordInput]}
                placeholder={t('auth.confirmPassword')}
                placeholderTextColor="#9AA6A0"
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                secureTextEntry={!showConfirmPassword}
              />
              <TouchableOpacity style={styles.passwordToggle} onPress={() => setShowConfirmPassword((value) => !value)}>
                <Text style={styles.passwordToggleText}>{showConfirmPassword ? t('common.hide') : t('common.show')}</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={[styles.button, (isLoading || registerCooldownLeft > 0) && styles.buttonDisabled]}
              onPress={handleRegister}
              disabled={isLoading || registerCooldownLeft > 0}
            >
              {isLoading
                ? <ActivityIndicator color="#fff" />
                : <Text style={styles.buttonText}>{awaitingVerification ? t('auth.registerVerificationResend') : t('auth.createAccount')}</Text>
              }
            </TouchableOpacity>

            {registerCooldownLeft > 0 && (
              <Text style={styles.cooldownHint}>{t('auth.emailCooldown', { seconds: registerCooldownLeft })}</Text>
            )}

            {awaitingVerification && (
              <View style={styles.verificationCard}>
                <View style={styles.verificationHeaderRow}>
                  <View style={styles.verificationIconWrap}>
                    <Text style={styles.verificationIcon}>✉️</Text>
                  </View>
                  <View style={styles.verificationHeaderTextWrap}>
                    <Text style={styles.verificationTitle}>{t('auth.registerVerificationTitle')}</Text>
                    <Text style={styles.verificationStatus}>{t('auth.registerVerificationStatus')}</Text>
                  </View>
                </View>
                <Text style={styles.verificationSubtitle}>
                  {t('auth.registerVerificationSubtitle')}
                </Text>
                <View style={styles.verificationEmailPill}>
                  <Text style={styles.verificationEmailLabel}>{t('auth.registerVerificationEmailLabel')}</Text>
                  <Text style={styles.verificationEmailValue}>{maskEmail(pendingVerificationEmail)}</Text>
                </View>
                <View style={styles.verificationCodePanel}>
                  <Text style={styles.verificationCodeLabel}>{t('auth.registerVerificationCodeLabel')}</Text>
                  <TextInput
                    style={styles.verificationCodeInput}
                    placeholder={t('auth.resetCodePlaceholder')}
                    placeholderTextColor="#9AA6A0"
                    value={verificationCode}
                    onChangeText={handleVerificationCodeChange}
                    keyboardType="number-pad"
                    autoCapitalize="none"
                    maxLength={6}
                    textAlign="center"
                  />
                  <Text style={styles.verificationHint}>{t('auth.registerVerificationHint')}</Text>
                </View>
                {registerCooldownLeft > 0 && (
                  <View style={styles.verificationMetaRow}>
                    <View style={styles.verificationCooldownBadge}>
                      <Text style={styles.verificationCooldownText}>{t('auth.emailCooldown', { seconds: registerCooldownLeft })}</Text>
                    </View>
                  </View>
                )}
                <TouchableOpacity
                  style={[styles.button, styles.verifyButton, isLoading && styles.buttonDisabled]}
                  onPress={handleConfirmSignUp}
                  disabled={isLoading}
                >
                  {isLoading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>{t('auth.registerVerificationButton')}</Text>}
                </TouchableOpacity>
              </View>
            )}

            <TouchableOpacity
              style={styles.linkButton}
              onPress={() => navigation.navigate('Login')}
            >
              <Text style={styles.linkText}>{t('auth.haveAccount')} <Text style={styles.linkBold}>{t('auth.loginNow')}</Text></Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>

      <SuccessSheet
        visible={!!successState}
        title={successState?.title ?? ''}
        message={successState?.message ?? ''}
        details={successState?.details}
        detailsLabel={t('auth.registerVerificationSentDetailsLabel')}
        buttonLabel={t('auth.ok')}
        autoCloseMs={6500}
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
    minHeight: 350,
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
    marginBottom: 34,
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
  logo: { fontSize: 52, marginBottom: 8 },
  appName: { fontSize: 32, fontWeight: '800', color: '#F4FBF7' },
  headline: {
    fontSize: 26,
    lineHeight: 33,
    fontWeight: '800',
    color: '#FFFFFF',
    marginTop: 10,
    maxWidth: 330,
  },
  tagline: {
    fontSize: 15,
    lineHeight: 22,
    color: 'rgba(232, 243, 238, 0.84)',
    marginTop: 12,
    maxWidth: 330,
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
    backgroundColor: '#1D9E75',
    borderRadius: 16,
    padding: 17,
    alignItems: 'center',
    marginTop: 22,
    shadowColor: '#1D9E75',
    shadowOpacity: 0.24,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  linkButton: { alignItems: 'center', marginTop: 16 },
  linkText: { fontSize: 14, color: '#667A73' },
  linkBold: { color: '#1D9E75', fontWeight: '800' },
  cooldownHint: {
    marginTop: 12,
    fontSize: 12,
    lineHeight: 18,
    color: '#62706B',
    textAlign: 'center',
  },
  verificationCard: {
    marginTop: 18,
    padding: 18,
    borderRadius: 22,
    backgroundColor: '#F2FAF6',
    borderWidth: 1,
    borderColor: '#D3E9DE',
    gap: 12,
    shadowColor: '#0D3A31',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  verificationHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  verificationIconWrap: {
    width: 46,
    height: 46,
    borderRadius: 14,
    backgroundColor: '#DDF4E8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  verificationIcon: {
    fontSize: 22,
  },
  verificationHeaderTextWrap: {
    flex: 1,
    gap: 2,
  },
  verificationTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#123A31',
  },
  verificationStatus: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: '#123A31',
    color: '#F4FBF7',
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  verificationSubtitle: {
    fontSize: 13,
    lineHeight: 20,
    color: '#5B6B66',
  },
  verificationEmailPill: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#D7E7DE',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 4,
  },
  verificationEmailLabel: {
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    color: '#6E847C',
  },
  verificationEmailValue: {
    fontSize: 15,
    color: '#123A31',
    fontWeight: '700',
  },
  verificationCodePanel: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: '#D7E7DE',
    gap: 10,
  },
  verificationCodeLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: '#537269',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  verificationCodeInput: {
    borderWidth: 1,
    borderColor: '#B7D7C8',
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 16,
    fontSize: 22,
    color: '#123A31',
    backgroundColor: '#F8FCFA',
    fontWeight: '800',
    letterSpacing: 4,
  },
  verificationHint: {
    fontSize: 12,
    lineHeight: 18,
    color: '#6A7E76',
  },
  verificationMetaRow: {
    flexDirection: 'row',
  },
  verificationCooldownBadge: {
    backgroundColor: '#E0F1E8',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  verificationCooldownText: {
    fontSize: 12,
    color: '#1A5A4A',
    fontWeight: '700',
  },
  verifyButton: {
    marginTop: 2,
  },
});