import { Tabs } from 'expo-router';
import { Text } from 'react-native';
import { useSSE } from '../../src/hooks/useSSE';

function TabIcon({ label, focused }: { label: string; focused: boolean }) {
  const icons: Record<string, string> = {
    Overview: '\u{1F4CA}',
    Containers: '\u{1F4E6}',
    Stacks: '\u{1F5C2}',
    Alerts: '\u{1F514}',
    Manage: '\u{2699}',
  };
  return (
    <Text style={{ fontSize: 20, opacity: focused ? 1 : 0.5 }}>
      {icons[label] || '\u{2699}'}
    </Text>
  );
}

export default function TabLayout() {
  useSSE();

  return (
    <Tabs
      screenOptions={{
        tabBarStyle: {
          backgroundColor: '#111827',
          borderTopColor: '#1F2937',
          height: 80,
          paddingBottom: 20,
        },
        tabBarActiveTintColor: '#60A5FA',
        tabBarInactiveTintColor: '#6B7280',
        tabBarLabelStyle: { fontSize: 11, fontWeight: '500' },
        headerStyle: { backgroundColor: '#0D0D0D' },
        headerTintColor: '#F9FAFB',
        headerShadowVisible: false,
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
