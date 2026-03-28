import { Tabs } from 'expo-router';
import { View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSSE } from '../../src/hooks/useSSE';
import { COLORS } from '../../src/theme/tokens';

const TAB_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  Overview: 'bar-chart-outline',
  Containers: 'cube-outline',
  Stacks: 'layers-outline',
  Monitoring: 'analytics-outline',
  Alerts: 'notifications-outline',
  Manage: 'settings-outline',
};

function TabIcon({ label, focused }: { label: string; focused: boolean }) {
  const iconName = TAB_ICONS[label] || 'settings-outline';
  return (
    <View style={tabIconStyles.wrapper}>
      <Ionicons
        name={iconName}
        size={24}
        color={focused ? COLORS.blue : COLORS.textTertiary}
        style={{ opacity: focused ? 1 : 0.6 }}
      />
      {focused && <View style={tabIconStyles.activeDot} />}
    </View>
  );
}

const tabIconStyles = StyleSheet.create({
  wrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 44,
    minHeight: 44,
  },
  activeDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.blue,
    marginTop: 4,
  },
});

export default function TabLayout() {
  useSSE();

  return (
    <Tabs
      screenOptions={{
        tabBarStyle: {
          backgroundColor: COLORS.bg,
          borderTopColor: COLORS.border,
          borderTopWidth: 1,
          height: 85,
          paddingBottom: 25,
          paddingTop: 8,
        },
        tabBarActiveTintColor: COLORS.blue,
        tabBarInactiveTintColor: COLORS.textTertiary,
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
          marginTop: -2,
        },
        headerStyle: {
          backgroundColor: COLORS.bg,
        },
        headerTintColor: COLORS.textPrimary,
        headerShadowVisible: false,
        headerTitleStyle: {
          fontWeight: '700',
        },
      }}
    >
      <Tabs.Screen
        name="overview"
        options={{
          title: 'Overview',
          tabBarIcon: ({ focused }) => <TabIcon label="Overview" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="containers"
        options={{
          title: 'Containers',
          tabBarIcon: ({ focused }) => <TabIcon label="Containers" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="stacks"
        options={{
          title: 'Stacks',
          tabBarIcon: ({ focused }) => <TabIcon label="Stacks" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="monitoring"
        options={{
          title: 'Monitoring',
          tabBarIcon: ({ focused }) => <TabIcon label="Monitoring" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="alerts"
        options={{
          title: 'Alerts',
          tabBarIcon: ({ focused }) => <TabIcon label="Alerts" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="manage"
        options={{
          title: 'Manage',
          tabBarIcon: ({ focused }) => <TabIcon label="Manage" focused={focused} />,
        }}
      />
      {/* Hide status tab from tab bar but keep it accessible via direct navigation */}
      <Tabs.Screen
        name="status"
        options={{
          href: null,
        }}
      />
    </Tabs>
  );
}
