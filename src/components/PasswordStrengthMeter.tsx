import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useI18n } from '../i18n';
import { useThemeStore } from '../store/themeStore';
import { getAppTheme } from '../theme';

interface PasswordStrengthMeterProps {
  password: string;
  variant?: 'auth' | 'profile';
}

interface PasswordStrengthResult {
  score: number;
  tone: 'weak' | 'fair' | 'good' | 'strong' | 'excellent';
  rules: {
    minLength: boolean;
    lowercase: boolean;
    uppercase: boolean;
    digit: boolean;
    symbol: boolean;
  };
}

function getPasswordStrength(password: string): PasswordStrengthResult | null {
  const value = password.trim();
  if (!value) {
    return null;
  }

  let score = 0;
  const hasLowercase = /[a-z]/.test(value);
  const hasUppercase = /[A-Z]/.test(value);
  const hasDigit = /\d/.test(value);
  const hasSymbol = /[^A-Za-z0-9]/.test(value);
  const hasMinLength = value.length >= 8;
  const uniqueChars = new Set(value).size;
  const categories = [hasLowercase, hasUppercase, hasDigit, hasSymbol].filter(Boolean).length;

  if (hasMinLength) score += 3;
  else if (value.length >= 6) score += 1;
  if (value.length >= 12) score += 1;
  if (hasLowercase) score += 1;
  if (hasUppercase) score += 1;
  if (hasDigit) score += 1;
  if (hasSymbol) score += 1;
  if (categories >= 3) score += 1;
  if (uniqueChars >= 8) score += 1;

  score = Math.min(10, Math.max(1, score));

  const rules = {
    minLength: hasMinLength,
    lowercase: hasLowercase,
    uppercase: hasUppercase,
    digit: hasDigit,
    symbol: hasSymbol,
  };

  if (score <= 2) return { score, tone: 'weak', rules };
  if (score <= 4) return { score, tone: 'fair', rules };
  if (score <= 6) return { score, tone: 'good', rules };
  if (score <= 8) return { score, tone: 'strong', rules };
  return { score, tone: 'excellent', rules };
}

export default function PasswordStrengthMeter({ password, variant = 'auth' }: PasswordStrengthMeterProps) {
  const { t } = useI18n();
  const mode = useThemeStore((state) => state.mode);
  const theme = getAppTheme(mode);

  const strength = useMemo(() => getPasswordStrength(password), [password]);

  if (!strength) {
    return null;
  }

  const tonePalette = {
    weak: { fill: '#D85A5A', bg: variant === 'auth' ? '#FCE8E8' : theme.dangerSoft },
    fair: { fill: '#E38A2D', bg: '#FFF2DF' },
    good: { fill: '#C2A128', bg: '#FBF4D8' },
    strong: { fill: '#2DA36E', bg: '#E4F6EE' },
    excellent: { fill: '#127A68', bg: '#DDF5F0' },
  } as const;

  const toneLabelMap = {
    weak: t('auth.passwordStrengthWeak'),
    fair: t('auth.passwordStrengthFair'),
    good: t('auth.passwordStrengthGood'),
    strong: t('auth.passwordStrengthStrong'),
    excellent: t('auth.passwordStrengthExcellent'),
  } as const;

  const palette = tonePalette[strength.tone];
  const meterBackground = variant === 'auth' ? '#EEF6F2' : theme.surfaceAlt;
  const meterBorder = variant === 'auth' ? '#D4E6DE' : theme.border;
  const titleColor = variant === 'auth' ? '#20463D' : theme.text;
  const hintColor = variant === 'auth' ? '#627B72' : theme.textMuted;
  const ruleRowBg = variant === 'auth' ? 'rgba(255, 255, 255, 0.72)' : theme.surface;
  const ruleRowBorder = variant === 'auth' ? '#D8E8E1' : theme.borderSoft;

  const rules = [
    { key: 'minLength', label: t('auth.passwordRuleMinLength'), passed: strength.rules.minLength },
    { key: 'lowercase', label: t('auth.passwordRuleLowercase'), passed: strength.rules.lowercase },
    { key: 'uppercase', label: t('auth.passwordRuleUppercase'), passed: strength.rules.uppercase },
    { key: 'digit', label: t('auth.passwordRuleDigit'), passed: strength.rules.digit },
    { key: 'symbol', label: t('auth.passwordRuleSymbol'), passed: strength.rules.symbol },
  ] as const;

  return (
    <View style={[styles.card, { backgroundColor: meterBackground, borderColor: meterBorder }]}> 
      <View style={styles.headerRow}>
        <Text style={[styles.title, { color: titleColor }]}>{t('auth.passwordStrengthLabel')}</Text>
        <View style={[styles.scorePill, { backgroundColor: palette.bg }]}> 
          <Text style={[styles.scoreText, { color: palette.fill }]}>{strength.score}/10</Text>
        </View>
      </View>

      <View style={styles.scaleRow}>
        {Array.from({ length: 10 }).map((_, index) => {
          const filled = index < strength.score;
          return (
            <View
              key={index}
              style={[
                styles.scaleBar,
                { backgroundColor: filled ? palette.fill : 'rgba(116, 138, 128, 0.16)' },
              ]}
            />
          );
        })}
      </View>

      <View style={styles.footerRow}>
        <Text style={[styles.levelText, { color: palette.fill }]}>{toneLabelMap[strength.tone]}</Text>
        <Text style={[styles.hintText, { color: hintColor }]}>{t('auth.passwordStrengthHint')}</Text>
      </View>

      <View style={styles.rulesWrap}>
        {rules.map((rule) => (
          <View
            key={rule.key}
            style={[
              styles.ruleRow,
              { backgroundColor: ruleRowBg, borderColor: rule.passed ? `${palette.fill}22` : ruleRowBorder },
            ]}
          >
            <View style={[styles.ruleIcon, { backgroundColor: rule.passed ? palette.fill : 'rgba(116, 138, 128, 0.16)' }]}>
              <Text style={styles.ruleIconText}>{rule.passed ? '✓' : '•'}</Text>
            </View>
            <Text style={[styles.ruleText, { color: rule.passed ? titleColor : hintColor }]}>{rule.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: 10,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  title: {
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  scorePill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  scoreText: {
    fontSize: 12,
    fontWeight: '900',
  },
  scaleRow: {
    flexDirection: 'row',
    gap: 6,
  },
  scaleBar: {
    flex: 1,
    height: 8,
    borderRadius: 999,
  },
  footerRow: {
    gap: 4,
  },
  levelText: {
    fontSize: 14,
    fontWeight: '800',
  },
  hintText: {
    fontSize: 12,
    lineHeight: 17,
  },
  rulesWrap: {
    gap: 8,
  },
  ruleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  ruleIcon: {
    width: 20,
    height: 20,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ruleIconText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '900',
    lineHeight: 12,
  },
  ruleText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
  },
});