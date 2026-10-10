import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_KEY;

if (!url || !key) {
  throw new Error(
    'Add EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_KEY to .env.local, then restart Expo.',
  );
}

if (!key.startsWith('sb_publishable_')) {
  throw new Error('Use a Supabase publishable key in the mobile app, never a server secret.');
}

export const supabase = createClient(url, key, {
  auth: {
    ...(Platform.OS !== 'web' ? { storage: AsyncStorage } : {}),
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});

// Register from one root effect. Cleanup prevents duplicate listeners on remount.
export function startSupabaseSessionRefresh() {
  if (Platform.OS === 'web') return undefined;

  const updateRefresh = (state: string | null) => {
    if (state === 'active') {
      void supabase.auth.startAutoRefresh();
    } else {
      void supabase.auth.stopAutoRefresh();
    }
  };

  updateRefresh(AppState.currentState);
  const subscription = AppState.addEventListener('change', updateRefresh);

  return () => {
    subscription.remove();
    void supabase.auth.stopAutoRefresh();
  };
}
