import React from 'react';
import { View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClientProvider } from '@tanstack/react-query';
import { useFonts, Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from '@expo-google-fonts/inter';
import { NotoSansArabic_500Medium, NotoSansArabic_700Bold } from '@expo-google-fonts/noto-sans-arabic';
import { SpaceGrotesk_700Bold } from '@expo-google-fonts/space-grotesk';
import { queryClient, useAppFocusRefetch } from '../src/api/hooks';
import { MapProvider } from '../src/map/MapContext';
import { AppProvider, LocationProvider } from '../src/state/app';
import { NavigationProvider } from '../src/state/navigation';
import { PanelProvider } from '../src/state/panels';
import { color } from '../src/ui/theme';

export default function RootLayout() {
  useAppFocusRefetch();
  const [loaded] = useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold, NotoSansArabic_500Medium, NotoSansArabic_700Bold, SpaceGrotesk_700Bold });
  if (!loaded) return <View style={{ flex: 1, backgroundColor: color.night }} />;
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <AppProvider>
            <LocationProvider>
              <NavigationProvider>
                <MapProvider>
                  <PanelProvider>
                    <StatusBar style="dark" />
                    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: color.map } }}>
                      <Stack.Screen name="index" />
                      {/* the 2D map stays mounted underneath, so switching back is instant */}
                      <Stack.Screen name="ar" options={{ presentation: 'fullScreenModal', animation: 'fade' }} />
                      <Stack.Screen name="faculty-status" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
                    </Stack>
                  </PanelProvider>
                </MapProvider>
              </NavigationProvider>
            </LocationProvider>
          </AppProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
