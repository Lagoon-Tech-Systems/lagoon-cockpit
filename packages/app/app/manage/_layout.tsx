import { Stack } from 'expo-router';
import { COLORS } from '../../src/theme/tokens';

export default function ManageLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: COLORS.bg },
        headerTintColor: COLORS.textPrimary,
        headerTitleStyle: { fontFamily: 'Inter_700Bold' },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: COLORS.bg },
        animation: 'slide_from_right',
      }}
    />
  );
}
