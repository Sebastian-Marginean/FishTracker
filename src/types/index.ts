// src/types/index.ts
// Tipurile TypeScript centrale ale aplicației FishTracker

export interface Profile {
  id: string;
  username: string;
  full_name?: string;
  avatar_url?: string;
  bio?: string;
  role: 'user' | 'admin';
  created_at: string;
}

export interface BaitPreset {
  id: number;
  name: string;
  category: 'boilie' | 'pellet' | 'porumb' | 'vierme' | 'lipitoare' | 'aluat' | 'custom';
}

export interface Location {
  id: string;
  created_by?: string;
  name: string;
  description?: string;
  lat: number;
  lng: number;
  photo_url?: string;
  is_public: boolean;
  created_at: string;
}

export interface WeatherSnapshot {
  temp_c: number;
  humidity: number;
  pressure_hpa: number;
  wind_kmh: number;
  description: string;
  icon: string;
}

export interface Session {
  id: string;
  user_id: string;
  location_id?: string;
  started_at: string;
  ended_at?: string;
  weather_snapshot?: WeatherSnapshot;
  notes?: string;
  is_active: boolean;
  // Join
  location?: Location;
}

export interface Rod {
  id: string;
  session_id: string;
  rod_number: 1 | 2 | 3 | 4;
  bait_preset_id?: number;
  bait_custom?: string;
  hook_setup?: string;
  cast_count: number;
  last_cast_at?: string;
  catch_count: number;
  offline_data?: Record<string, unknown>;
  updated_at: string;
  // Join
  bait_preset?: BaitPreset;
}

export interface Catch {
  id: string;
  session_id: string;
  rod_id?: string;
  user_id: string;
  location_id?: string;
  group_id?: string;
  fish_species?: string;
  weight_kg?: number;
  length_cm?: number;
  photo_url?: string;
  is_returned: boolean;
  caught_at: string;
  notes?: string;
  // Joins
  profile?: Profile;
  location?: Location;
  group?: Group;
}

export interface Group {
  id: string;
  owner_id: string;
  name: string;
  description?: string;
  invite_code: string;
  avatar_url?: string;
  is_private: boolean;
  created_at: string;
}

export interface GroupMember {
  id: string;
  group_id: string;
  user_id: string;
  role: 'owner' | 'member';
  last_read_at?: string;
  joined_at: string;
  // Join
  profile?: Profile;
}

export interface Message {
  id: string;
  user_id: string;
  content?: string;
  media_url?: string;
  created_at: string;
  // Join
  profile?: Profile;
}

export interface PrivateConversation {
  id: string;
  created_by?: string;
  created_at: string;
  members?: Profile[];
  last_message?: PrivateMessage;
}

export interface PrivateConversationMember {
  id: string;
  conversation_id: string;
  user_id: string;
  last_read_at?: string;
  joined_at: string;
  profile?: Profile;
}

export interface PrivateMessage {
  id: string;
  conversation_id: string;
  user_id: string;
  content?: string;
  media_url?: string;
  created_at: string;
  profile?: Profile;
}

export interface GroupMessage {
  id: string;
  group_id: string;
  user_id: string;
  content?: string;
  media_url?: string;
  created_at: string;
  profile?: Profile;
}

export interface SearchProfileResult {
  id: string;
  username: string;
  full_name?: string;
  avatar_url?: string;
}

export interface LeaderboardEntry {
  user_id: string;
  username: string;
  avatar_url?: string;
  total_catches: number;
  biggest_fish_kg: number;
  total_weight_kg: number;
  total_sessions: number;
}

// Starea locală a unei lansete (offline-first)
export interface LocalRodState {
  rodNumber: 1 | 2 | 3 | 4;
  baitName: string;
  hookSetup: string;
  castCount: number;
  lastCastTimestamp: number | null; // epoch ms
  catchCount: number;
  rodId: string | null; // UUID din DB, null dacă nu e sync-at
}

// Starea locală a unei partide active (offline-first)
export interface LocalSessionState {
  sessionId: string | null;
  locationId: string | null;
  locationName: string;
  startedAt: number; // epoch ms
  isActive: boolean;
  rods: LocalRodState[];
  isSynced: boolean;
}
