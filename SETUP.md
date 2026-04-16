# 🎣 FishTracker App — Setup Guide (Faza 1)

## Pas 1: Creează proiectul Expo

```bash
npx create-expo-app@latest FishTracker --template blank-typescript
cd FishTracker
```

## Pas 2: Instalează toate dependințele

```bash
npx expo install expo-location expo-camera expo-image-picker expo-notifications
npx expo install @react-native-async-storage/async-storage
npm install @supabase/supabase-js
npm install react-native-url-polyfill
npm install zustand
npm install react-native-mmkv
npm install @react-navigation/native @react-navigation/bottom-tabs @react-navigation/native-stack
npx expo install react-native-screens react-native-safe-area-context
npm install react-native-dotenv
```

## Pas 3: Creează fișierul .env în rădăcina proiectului

```
EXPO_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI...
EXPO_PUBLIC_WEATHER_API_KEY=your_openweathermap_key
```

> Găsești URL și Anon Key în Supabase Dashboard → Settings → API

## Pas 4: Copiază fișierele din acest proiect în structura ta

```
FishTracker/
├── .env
├── app.json
├── App.tsx                    ← înlocuiește cel existent
├── src/
│   ├── lib/
│   │   ├── supabase.ts        ← clientul Supabase
│   │   └── storage.ts         ← stocare offline MMKV
│   ├── store/
│   │   ├── authStore.ts       ← starea autentificării
│   │   └── sessionStore.ts    ← starea partidei active
│   ├── navigation/
│   │   └── AppNavigator.tsx   ← navigarea principală
│   ├── screens/
│   │   ├── auth/
│   │   │   ├── LoginScreen.tsx
│   │   │   └── RegisterScreen.tsx
│   │   ├── dashboard/
│   │   │   └── DashboardScreen.tsx
│   │   ├── locations/
│   │   │   └── LocationsScreen.tsx
│   │   ├── groups/
│   │   │   └── GroupsScreen.tsx
│   │   └── community/
│   │       └── CommunityScreen.tsx
│   ├── components/
│   │   ├── RodCard.tsx        ← cardul unei lansete
│   │   └── WeatherWidget.tsx  ← widgetul meteo
│   └── types/
│       └── index.ts           ← tipurile TypeScript
└── supabase/
    └── schema.sql             ← rulează în Supabase SQL Editor
```

## Pas 5: Rulează schema SQL în Supabase

- Deschide Supabase Dashboard → SQL Editor
- Copiază conținutul din `supabase/schema.sql`
- Click "Run"

Schema actualizata creeaza si bucketurile publice `photos` si `avatars`. Daca ai rulat o versiune mai veche a fisierului, ruleaza din nou schema curenta ca sa adaugi politicile storage pentru upload si afisare imagini.

## Pas 6: Configureaza emailurile tranzactionale prin cod

Fluxul de resetare a parolei si confirmarea contului nu mai depind de linkurile standard Supabase. Aplicatia foloseste Edge Functions care trimit coduri pe email si confirma actiunile direct in app.

### 6.1 Instaleaza Supabase CLI

```bash
npm install -g supabase
supabase login
```

### 6.2 Leaga proiectul local la proiectul tau Supabase

```bash
cd FishTracker
supabase link --project-ref YOUR_PROJECT_REF
```

### 6.3 Creeaza un cont gratuit Resend

- Intra pe https://resend.com
- Creeaza un API key
- Configureaza un expeditor validat, de exemplu `FishTracker <noreply@domeniul-tau.ro>`

### 6.4 Seteaza secretele pentru functii

```bash
supabase secrets set SERVICE_ROLE_KEY=your_service_role_key
supabase secrets set RESEND_API_KEY=your_resend_api_key
supabase secrets set RESET_EMAIL_FROM="FishTracker <noreply@your-domain.com>"
supabase secrets set APP_NAME="FishTracker"
```

> Valoarea pentru `SERVICE_ROLE_KEY` se gaseste in Supabase Dashboard → Settings → API → `service_role`. Nu o pune in `.env` din aplicatia mobila.

### 6.5 Deploy pentru functii

```bash
supabase functions deploy request-sign-up
supabase functions deploy confirm-sign-up
supabase functions deploy request-password-reset
supabase functions deploy confirm-password-reset
```

### 6.6 Testare rapida

- Deschide ecranul de inregistrare
- Creeaza un cont nou
- Verifica email-ul primit prin Resend
- Introdu codul direct in aplicatie pentru confirmarea contului

- Deschide ecranul de login
- Apasa pe `Ai uitat parola?`
- Introdu email-ul contului si cere codul
- Verifica email-ul primit prin Resend
- Introdu codul si parola noua direct in aplicatie

## Pas 7: Porneste aplicatia

```bash
npx expo start
```

Scanează QR code cu aplicația **Expo Go** de pe telefon.
