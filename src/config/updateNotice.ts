export const UPDATE_NOTICE = {
  enabled: true,
  id: '1.0.0-update-2026-04-20',
  versionLabel: '1.0.0',
  content: {
    ro: {
      eyebrow: 'Noutati in versiunea 1.0.0',
      title: 'Aplicatia a fost actualizata',
      message: 'Chatul afiseaza acum numele setat in profil, iar comunitatea si grupurile au imbunatatiri noi.',
      action: 'Am inteles',
    },
    en: {
      eyebrow: 'What is new in version 1.0.0',
      title: 'The app has been updated',
      message: 'Chat now shows the profile display name first, and the community and groups include new improvements.',
      action: 'Got it',
    },
  },
} as const;

export type UpdateNoticeLanguage = keyof typeof UPDATE_NOTICE.content;