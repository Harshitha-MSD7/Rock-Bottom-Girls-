module.exports = ({ config }) => ({
  ...config,
  extra: {
    ...config.extra,
    mapsConfigured: !!process.env.GOOGLE_MAPS_ANDROID_API_KEY,
    ...(process.env.EAS_PROJECT_ID ? { eas: { projectId: process.env.EAS_PROJECT_ID } } : {}),
  },
  android: {
    ...config.android,
    ...(process.env.GOOGLE_SERVICES_JSON
      ? { googleServicesFile: process.env.GOOGLE_SERVICES_JSON }
      : {}),
  },
  plugins: [
    ...(config.plugins || []).filter((p) => (Array.isArray(p) ? p[0] : p) !== 'expo-audio'),
    [
      'expo-audio',
      {
        microphonePermission: 'Allow careQ to record an emergency message for the watch.',
        enableBackgroundPlayback: false,
        enableBackgroundRecording: false,
      },
    ],
    ...(process.env.GOOGLE_MAPS_ANDROID_API_KEY
      ? [
          [
            'react-native-maps',
            { androidGoogleMapsApiKey: process.env.GOOGLE_MAPS_ANDROID_API_KEY },
          ],
        ]
      : []),
  ],
});
