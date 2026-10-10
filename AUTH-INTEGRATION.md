# Supabase authentication integration

This contribution adds reusable authentication components and database setup.
It does not change existing navigation, package files, or API code.
Login is not activated by adding these files alone.

## Dependencies

From frontend, run:
npx expo install @supabase/supabase-js @react-native-async-storage/async-storage react-native-url-polyfill

Commit the resulting package.json and package-lock.json changes when integrating.

## Environment

Copy frontend/.env.example to frontend/.env.local and fill in the project URL
and publishable key. Never commit .env.local or a Supabase server secret.

## Navigation integration

- Wrap the root navigator with AuthProvider from @/contexts/auth-context.
- Use useAuth() to wait for session loading before choosing a route.
- Protect the entire (tabs) group so only signed-in users can enter.
- Show the (auth) group when signed out.
- Render the new login component from the existing (auth)/login.tsx:

export { default } from '@/components/login-screen';

- Reconcile the root index.tsx and (tabs)/index.tsx routes.
- Add logout to Settings with supabase.auth.signOut({ scope: 'local' }).
- Handle sign-out errors before reporting success.

## Database

Read supabase/SIMPLE-SETUP.md first.
Do not rerun simple-schema.sql against the project where it was already installed.
The schema uses local x/y coordinates in meters, not latitude/longitude.

## Verification

Run TypeScript and lint.
Test valid login, invalid login, session restoration, logout, and signed-out access
to protected routes. Use an existing Supabase Auth caregiver account.

Registration, password recovery, and API authorization are separate work.
