import * as axios from 'axios';
import * as SecureStore from 'expo-secure-store';

const TOKEN_KEY = 'auth_token';
const USER_EMAIL_KEY = 'auth_user_email';

export const apiClient = axios.create({
  baseURL: process.env.EXPO_PUBLIC_API_URL || 'http://localhost:4000/api',
  headers: {
    'Content-Type': 'application/json',
  },
});

apiClient.interceptors.request.use(
  async (config) => {
    try {
      const token = await SecureStore.getItemAsync(TOKEN_KEY);
      if (token) {
        if (config.headers) {
          config.headers.set('Authorization', `Bearer ${token}`);
        }
      }
    } catch (error) {
      console.error('Error reading auth token from SecureStore:', error);
    }
    return config;
  },
  (error) => Promise.reject(error)
);

export async function saveAuthToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

export async function getAuthToken(): Promise<string | null> {
  return await SecureStore.getItemAsync(TOKEN_KEY);
}

export async function removeAuthToken(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}

export async function saveAuthUserEmail(email: string): Promise<void> {
  await SecureStore.setItemAsync(USER_EMAIL_KEY, email);
}

export async function getAuthUserEmail(): Promise<string | null> {
  return await SecureStore.getItemAsync(USER_EMAIL_KEY);
}

export async function removeAuthUserEmail(): Promise<void> {
  await SecureStore.deleteItemAsync(USER_EMAIL_KEY);
}