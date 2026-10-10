# Supabase connection

Connection configuration is in `.env.local` (already ignored by Git).
Teammates copy `.env.example` to `.env.local` and enter the project's URL and
publishable key from the Supabase Expo/React Native Connect screen.

`EXPO_PUBLIC_` values are bundled into the app. Only use the client publishable
key here, never a database password or server secret/service-role key.

The reusable client is in `src/lib/supabase.ts`. Native sessions persist through
AsyncStorage. A root-layout effect refreshes sessions while the app is active and
cleans up its listener when unmounted. Web uses the client's browser storage.

This project uses Expo Router, so there is no need to add an `App.tsx` from the
generic Supabase example. Import the client with `@/lib/supabase` in screens.

Restart Expo after configuring environment values:

```powershell
npm start
```

This step configures the client only. The current screens are still the Expo
starter. Caregiver login, patient list, and sign-out screens are the next step.
The database's RLS policies enforce assigned-patient reads. Current schema writes
must go through an authorized backend; do not disable RLS to allow client writes.
