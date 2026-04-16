import React, { useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, KeyboardAvoidingView, Platform,
  ScrollView, Alert, ActivityIndicator, ImageBackground,
} from 'react-native';
import { useAuthStore } from '../../store/authStore';
import { useI18n } from '../../i18n';
import { useLanguageStore } from '../../store/languageStore';

const EMAIL_ACTION_COOLDOWN_MS = 60_000;

function getFriendlyAuthMessage(
  message: string,
  t: (key: string, params?: Record<string, string | number>) => string,
) {
  if (/email rate limit exceeded/i.test(message)) {
    return t('auth.emailRateLimit');
  }

  return message;
}

export default function RegisterScreen({ navigation }: any) {
  const { signUp, isLoading } = useAuthStore();
  const { language, t } = useI18n();
  const setLanguage = useLanguageStore((state) => state.setLanguage);
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [registerCooldownUntil, setRegisterCooldownUntil] = useState<number | null>(null);
  const [registerCooldownLeft, setRegisterCooldownLeft] = useState(0);

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
    if (!username.trim() || !email.trim() || !password.trim()) {
      Alert.alert(t('common.error'), t('auth.fillAllFields'));
      return;
    }
    if (password !== confirmPassword) {
      Alert.alert(t('common.error'), t('auth.passwordMismatch'));
      return;
    }
    if (password.length < 6) {
      Alert.alert(t('common.error'), t('auth.passwordTooShort'));
      return;
    }
    if (username.length < 3) {
      Alert.alert(t('common.error'), t('auth.usernameTooShort'));
      return;
    }

    if (registerCooldownLeft > 0) {
      Alert.alert(t('common.info'), t('auth.emailCooldown', { seconds: registerCooldownLeft }));
      return;
    }

    const { error } = await signUp(email.trim(), password, username.trim());
    if (error) {
      if (/email rate limit exceeded/i.test(error)) {
        setRegisterCooldownUntil(Date.now() + EMAIL_ACTION_COOLDOWN_MS);
      }

      Alert.alert(t('auth.registerFailed'), getFriendlyAuthMessage(error, t));
    } else {
      setRegisterCooldownUntil(Date.now() + EMAIL_ACTION_COOLDOWN_MS);
      Alert.alert(
        t('auth.accountCreatedTitle'),
        `${t('auth.accountCreatedMessage')}\n\n${t('auth.emailCooldown', { seconds: 60 })}`,
        [{ text: t('auth.ok'), onPress: () => navigation.navigate('Login') }]
      );
    }
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
            <TextInput
              style={styles.input}
              placeholder={t('auth.passwordMinPlaceholder')}
              placeholderTextColor="#9AA6A0"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
            />

            <Text style={styles.label}>{t('auth.confirmPassword')}</Text>
            <TextInput
              style={styles.input}
              placeholder={t('auth.confirmPassword')}
              placeholderTextColor="#9AA6A0"
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              secureTextEntry
            />

            <TouchableOpacity
              style={[styles.button, (isLoading || registerCooldownLeft > 0) && styles.buttonDisabled]}
              onPress={handleRegister}
              disabled={isLoading || registerCooldownLeft > 0}
            >
              {isLoading
                ? <ActivityIndicator color="#fff" />
                : <Text style={styles.buttonText}>{t('auth.createAccount')}</Text>
              }
            </TouchableOpacity>

            {registerCooldownLeft > 0 && (
              <Text style={styles.cooldownHint}>{t('auth.emailCooldown', { seconds: registerCooldownLeft })}</Text>
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
});