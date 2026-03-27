import { Tabs } from 'expo-router';
import { View, Text, StyleSheet } from 'react-native';
import { useSSE } from '../../src/hooks/useSSE';

const TAB_ICONS: Record<string, string> = {
  Overview: '\u{1F4CA}',
  Containers: '\u{1F4E6}',
  Stacks: '\u{1F5C2}',
  Alerts: '\u{1F514}',
  Manage: '\u{2699}',
};

function TabIcon({ label, focused }: { label: string; focused: boolean }) {
  return (
    <View style={tabIconStyles.wrapper}>
      <Text
        style={[
          tabIconStyles.icon,
          { opacity: focused ? 1 : 0.6 },
        ]}
      >
        {TAB_ICONS[label] || '\u{2699}'}
      </Text>
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
  icon: {
    fontSize: 24,
  },
  activeDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#4A90FF',
    marginTop: 4,
  },
});

export default function TabLayout() {
  useSSE();

  return (
    <Tabs
      screenOptions={{
        tabBarStyle: {
          backgroundColor: '#1C1C1E',
          borderTopColor: '#3A3A3C',
          borderTopWidth: 1,
          height: 85,
          paddingBottom: 25,
          paddingTop: 8,
        },
        tabBarActiveTintColor: '#4A90FF',
        tabBarInactiveTintColor: '#636366',
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
          marginTop: -2,
        },
        headerStyle: {
          backgroundColor: '#1C1C1E',
        },
        headerTintColor: '#FFFFFF',
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
