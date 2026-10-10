import type { PropsWithChildren } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { ReduceMotion, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

export function AuthShell({ children }: PropsWithChildren) {
  return <SafeAreaView style={s.page}>
    <View pointerEvents="none" style={s.glow} />
    <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.scroll}>
        <View style={s.content}>
          <View style={s.brand}><View style={s.mark}><Text style={s.markText}>cQ</Text></View><Text style={s.brandText}>careQ</Text></View>
          {children}
          <Text style={s.footer}>A little closer. Even from afar.</Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}

export function AuthButton({ label, busy = false, onPress }: { label: string; busy?: boolean; onPress: () => void }) {
  const scale = useSharedValue(1);
  const motion = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));
  const animate = (value: number) => { scale.set(withSpring(value, { damping: 18, stiffness: 250, reduceMotion: ReduceMotion.System })); };
  return <Animated.View style={motion}><Pressable accessibilityRole="button" accessibilityState={{ disabled: busy, busy }} disabled={busy} onPress={onPress} onPressIn={() => animate(0.98)} onPressOut={() => animate(1)} style={[s.button, busy && { opacity: 0.7 }]}>
    {busy && <ActivityIndicator color="#123D36" />}<Text style={s.buttonText}>{label}</Text>
  </Pressable></Animated.View>;
}

export const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#102D2A' }, flex: { flex: 1 },
  glow: { position: 'absolute', right: -120, top: 60, width: 340, height: 340, borderRadius: 180, backgroundColor: '#22453D', opacity: 0.65 },
  scroll: { flexGrow: 1, paddingHorizontal: 24, paddingVertical: 24 },
  content: { width: '100%', maxWidth: 480, alignSelf: 'center', flex: 1, gap: 24 },
  brand: { flexDirection: 'row', gap: 12, alignItems: 'center', marginBottom: 20 },
  mark: { borderRadius: 14, backgroundColor: '#D9EBAA', width: 44, height: 44, alignItems: 'center', justifyContent: 'center', transform: [{ rotate: '-6deg' }] },
  markText: { fontSize: 23, fontWeight: '700', color: '#123D36' }, brandText: { color: '#F6F6ED', fontWeight: '600', fontSize: 26, letterSpacing: -1 },
  eyebrow: { color: '#D9EBAA', fontSize: 12, fontWeight: '700', letterSpacing: 2, marginBottom: 12 },
  title: { color: '#F6F6ED', fontSize: 42, lineHeight: 47, fontWeight: '600', letterSpacing: -1.5 },
  subtitle: { color: '#C1D2CB', fontSize: 16, lineHeight: 25, marginTop: 14 },
  panel: { backgroundColor: 'rgba(255,255,255,0.07)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', padding: 24, borderRadius: 28, gap: 18 },
  label: { color: '#EDF3ED', fontSize: 14, fontWeight: '600', marginBottom: 8 },
  input: { color: '#F6F6ED', fontSize: 16, minHeight: 54, paddingHorizontal: 15, paddingVertical: 12, borderWidth: 1, borderColor: '#66857A', borderRadius: 13, backgroundColor: '#163731' },
  focused: { borderColor: '#D9EBAA' }, passwordRow: { flexDirection: 'row', alignItems: 'center' },
  reveal: { minHeight: 48, minWidth: 58, alignItems: 'center', justifyContent: 'center', marginLeft: 8 },
  link: { color: '#D9EBAA', fontSize: 14, fontWeight: '600' },
  button: { backgroundColor: '#D9EBAA', borderRadius: 14, minHeight: 56, padding: 15, flexDirection: 'row', gap: 10, justifyContent: 'center', alignItems: 'center' },
  buttonText: { color: '#123D36', fontWeight: '700', fontSize: 16 },
  error: { color: '#FFD6CC', fontSize: 14, lineHeight: 21 },
  note: { color: '#C1D2CB', fontSize: 14, lineHeight: 22 },
  footer: { color: '#AAC0B7', fontSize: 12, lineHeight: 20, paddingTop: 12, paddingBottom: 8, marginTop: 'auto' },
});

