import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Dimensions,
  Platform,
  UIManager,
} from 'react-native';
import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { Stack, useRouter } from 'expo-router';
import { apiFetch } from '../../src/lib/api';
import { COLORS, RADIUS, SPACING } from '../../src/theme/tokens';
import { sanitizeErrorMessage } from '../../src/lib/errors';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

/* ────────────────────────────── Types ────────────────────────────── */

interface Container {
  id: string;
  name: string;
  state: string;
  image: string;
  composeProject?: string;
  composeService?: string;
  networkMode?: string;
  health?: string;
}

interface NetworkContainer {
  id: string;
  name: string;
  ipv4: string;
}

interface DockerNetwork {
  id: string;
  name: string;
  driver: string;
  containers: NetworkContainer[];
}

interface StackData {
  name: string;
  containerCount: number;
  running: number;
  stopped: number;
  status: string;
  containers: string[];
}

/* ────────────────────────────── Constants ────────────────────────── */

const REFRESH_INTERVAL = 30_000;
const NODE_W = 100;
const NODE_H = 100;
const NODE_GAP_X = 20;
const NODE_GAP_Y = 24;
const GROUP_PAD_X = 20;
const GROUP_PAD_Y = 50;
const GROUP_GAP = 28;
const COLS_PER_GROUP = 3;

const SCREEN_W = Dimensions.get('window').width;

const STACK_COLORS = [
  COLORS.blue + '1F',     // blue
  COLORS.purple + '1F',   // violet
  COLORS.pink + '1F',     // pink
  COLORS.teal + '1F',     // teal
  COLORS.yellow + '1F',   // amber
  COLORS.indigo + '1F',   // indigo
  COLORS.green + '1F',    // emerald
  COLORS.rose + '1F',     // rose
];

const STACK_BORDER_COLORS = [
  COLORS.blue + '59',
  COLORS.purple + '59',
  COLORS.pink + '59',
  COLORS.teal + '59',
  COLORS.yellow + '59',
  COLORS.indigo + '59',
  COLORS.green + '59',
  COLORS.rose + '59',
];

const STACK_LABEL_COLORS = [
  COLORS.blue,
  COLORS.purple,
  COLORS.pink,
  COLORS.teal,
  COLORS.yellow,
  COLORS.indigo,
  COLORS.green,
  COLORS.rose,
];

/* ────────────────────────────── Helpers ────────────────────────────── */

function getNodeColor(state: string, health?: string): string {
  if (health === 'unhealthy') return COLORS.yellow;  // yellow
  if (state === 'running') return COLORS.green;       // green
  return COLORS.red;                                   // red
}

function getGlowColor(state: string, health?: string): string {
  if (health === 'unhealthy') return COLORS.yellow + '66';
  if (state === 'running') return COLORS.green + '40';
  return COLORS.red + '59';
}

function getNodeSize(health?: string): number {
  return health === 'unhealthy' ? 64 : 52;
}

function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  return str.slice(0, max - 1) + '\u2026';
}

function shortName(name: string): string {
  // Strip leading slash and common prefixes
  let s = name.replace(/^\//, '');
  // Remove compose project prefix if present (e.g. "myproject-web-1" → "web-1")
  const parts = s.split(/[-_]/);
  if (parts.length > 2) {
    s = parts.slice(1).join('-');
  }
  return truncate(s, 14);
}

/* ────────────────────────────── Component ────────────────────────── */

export default function SystemMapScreen() {
  const router = useRouter();
  const [containers, setContainers] = useState<Container[]>([]);
  const [networks, setNetworks] = useState<DockerNetwork[]>([]);
  const [stacks, setStacks] = useState<StackData[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      const [cRes, nRes, sRes] = await Promise.all([
        apiFetch<{ containers: Container[] }>('/api/containers'),
        apiFetch<{ networks: DockerNetwork[] }>('/api/networks'),
        apiFetch<{ stacks: StackData[] }>('/api/stacks'),
      ]);
      setContainers(cRes.containers);
      setNetworks(nRes.networks);
      setStacks(sRes.stacks);
      setLastRefresh(new Date());
    } catch (err) {
      console.error('[SystemMap] fetch error:', err);
      Alert.alert('Error', sanitizeErrorMessage(err, 'Failed to load system data'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
    intervalRef.current = setInterval(fetchAll, REFRESH_INTERVAL);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchAll]);

  /* ── Build layout data ── */

  const layoutData = useMemo(() => {
    // Group containers by compose project
    const stackMap = new Map<string, Container[]>();
    const ungrouped: Container[] = [];

    for (const c of containers) {
      const proj = c.composeProject;
      if (proj) {
        if (!stackMap.has(proj)) stackMap.set(proj, []);
        stackMap.get(proj)!.push(c);
      } else {
        ungrouped.push(c);
      }
    }

    // Build network lookup: containerId → [networkName, ...]
    const containerNetworks = new Map<string, string[]>();
    for (const net of networks) {
      // Skip default system networks
      if (['bridge', 'host', 'none'].includes(net.name)) continue;
      for (const nc of net.containers) {
        if (!containerNetworks.has(nc.id)) containerNetworks.set(nc.id, []);
        containerNetworks.get(nc.id)!.push(net.name);
      }
    }

    // Build shared-network pairs for connection lines
    const connections: Array<{ fromId: string; toId: string; network: string }> = [];
    for (const net of networks) {
      if (['bridge', 'host', 'none'].includes(net.name)) continue;
      const ids = net.containers.map((c) => c.id);
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          connections.push({ fromId: ids[i], toId: ids[j], network: net.name });
        }
      }
    }

    // Position nodes within groups
    type NodePos = { container: Container; x: number; y: number; size: number; networks: string[] };
    type GroupLayout = {
      name: string;
      x: number;
      y: number;
      w: number;
      h: number;
      colorIdx: number;
      nodes: NodePos[];
    };

    const groups: GroupLayout[] = [];
    const nodePositions = new Map<string, { x: number; y: number; size: number }>();

    let cursorY = 20;
    let colorIdx = 0;

    const stackNames = Array.from(stackMap.keys()).sort();

    for (const stackName of stackNames) {
      const members = stackMap.get(stackName)!;
      // Sort: unhealthy first, then stopped, then running
      members.sort((a, b) => {
        const priority = (c: Container) => {
          if (c.health === 'unhealthy') return 0;
          if (c.state !== 'running') return 1;
          return 2;
        };
        return priority(a) - priority(b);
      });

      const cols = Math.min(COLS_PER_GROUP, members.length);
      const rows = Math.ceil(members.length / cols);
      const groupW = cols * (NODE_W + NODE_GAP_X) - NODE_GAP_X + GROUP_PAD_X * 2;
      const groupH = rows * (NODE_H + NODE_GAP_Y) - NODE_GAP_Y + GROUP_PAD_Y + GROUP_PAD_X;
      const groupX = Math.max(16, (SCREEN_W - groupW) / 2);

      const nodes: NodePos[] = [];
      members.forEach((c, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const size = getNodeSize(c.health);
        const nx = groupX + GROUP_PAD_X + col * (NODE_W + NODE_GAP_X) + (NODE_W - size) / 2;
        const ny = cursorY + GROUP_PAD_Y + row * (NODE_H + NODE_GAP_Y) + (NODE_H - size) / 2;
        const nets = containerNetworks.get(c.id) || [];
        nodes.push({ container: c, x: nx, y: ny, size, networks: nets });
        nodePositions.set(c.id, { x: nx + size / 2, y: ny + size / 2, size });
      });

      groups.push({
        name: stackName,
        x: groupX,
        y: cursorY,
        w: groupW,
        h: groupH,
        colorIdx: colorIdx % STACK_COLORS.length,
        nodes,
      });

      cursorY += groupH + GROUP_GAP;
      colorIdx++;
    }

    // Ungrouped section
    if (ungrouped.length > 0) {
      ungrouped.sort((a, b) => a.name.localeCompare(b.name));
      const cols = Math.min(COLS_PER_GROUP, ungrouped.length);
      const rows = Math.ceil(ungrouped.length / cols);
      const groupW = cols * (NODE_W + NODE_GAP_X) - NODE_GAP_X + GROUP_PAD_X * 2;
      const groupH = rows * (NODE_H + NODE_GAP_Y) - NODE_GAP_Y + GROUP_PAD_Y + GROUP_PAD_X;
      const groupX = Math.max(16, (SCREEN_W - groupW) / 2);

      const nodes: NodePos[] = [];
      ungrouped.forEach((c, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const size = getNodeSize(c.health);
        const nx = groupX + GROUP_PAD_X + col * (NODE_W + NODE_GAP_X) + (NODE_W - size) / 2;
        const ny = cursorY + GROUP_PAD_Y + row * (NODE_H + NODE_GAP_Y) + (NODE_H - size) / 2;
        const nets = containerNetworks.get(c.id) || [];
        nodes.push({ container: c, x: nx, y: ny, size, networks: nets });
        nodePositions.set(c.id, { x: nx + size / 2, y: ny + size / 2, size });
      });

      groups.push({
        name: 'Ungrouped',
        x: groupX,
        y: cursorY,
        w: groupW,
        h: groupH,
        colorIdx: 7, // rose
        nodes,
      });

      cursorY += groupH + GROUP_GAP;
    }

    // Calculate connection lines (only between nodes in different groups)
    type LineData = { x1: number; y1: number; x2: number; y2: number; network: string };
    const lines: LineData[] = [];
    const seen = new Set<string>();

    for (const conn of connections) {
      const from = nodePositions.get(conn.fromId);
      const to = nodePositions.get(conn.toId);
      if (!from || !to) continue;
      const key = [conn.fromId, conn.toId].sort().join('-');
      if (seen.has(key)) continue;
      seen.add(key);
      lines.push({
        x1: from.x,
        y1: from.y,
        x2: to.x,
        y2: to.y,
        network: conn.network,
      });
    }

    const totalH = cursorY + 20;

    return { groups, lines, totalH, nodePositions };
  }, [containers, networks]);

  /* ── Stats ── */

  const stats = useMemo(() => {
    const running = containers.filter((c) => c.state === 'running').length;
    const stopped = containers.filter((c) => c.state !== 'running').length;
    const unhealthy = containers.filter((c) => c.health === 'unhealthy').length;
    return { total: containers.length, running, stopped, unhealthy, stacks: stacks.length };
  }, [containers, stacks]);

  /* ── Render ── */

  if (loading) {
    return (
      <>
        <Stack.Screen
          options={{
            title: 'System Map',
            headerBackTitle: 'Back',
            headerStyle: { backgroundColor: COLORS.bg },
            headerTintColor: COLORS.textPrimary,
          }}
        />
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={COLORS.blue} />
          <Text style={styles.loadingText}>Mapping infrastructure...</Text>
        </View>
      </>
    );
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: 'System Map',
          headerBackTitle: 'Back',
          headerStyle: { backgroundColor: COLORS.bg },
          headerTintColor: COLORS.textPrimary,
          headerTitleStyle: { fontWeight: '700' },
        }}
      />
      <View style={styles.container}>
        {/* ── Top Stats Bar ── */}
        <View style={styles.statsBar}>
          <View style={styles.statsRow}>
            <StatPill label="Containers" value={stats.total} color={COLORS.blue} />
            <StatPill label="Running" value={stats.running} color={COLORS.green} />
            <StatPill label="Stopped" value={stats.stopped} color={COLORS.red} />
            {stats.unhealthy > 0 && (
              <StatPill label="Unhealthy" value={stats.unhealthy} color={COLORS.yellow} />
            )}
          </View>
          <View style={styles.statsRow}>
            <StatPill label="Stacks" value={stats.stacks} color={COLORS.purple} />
            <StatPill label="Networks" value={networks.length} color={COLORS.teal} />
          </View>
          {lastRefresh && (
            <Text style={styles.refreshLabel}>
              Auto-refresh 30s {'\u00B7'} Last: {lastRefresh.toLocaleTimeString()}
            </Text>
          )}
        </View>

        {/* ── Scrollable Map Canvas ── */}
        <ScrollView
          style={styles.scrollOuter}
          contentContainerStyle={[
            styles.canvas,
            { minHeight: layoutData.totalH + 200 },
          ]}
          showsVerticalScrollIndicator={true}
          showsHorizontalScrollIndicator={true}
          bounces={true}
        >
          <ScrollView
            horizontal
            contentContainerStyle={{
              minWidth: Math.max(SCREEN_W, 420),
              minHeight: layoutData.totalH + 200,
            }}
            showsHorizontalScrollIndicator={false}
            nestedScrollEnabled
          >
            <View style={{ width: '100%', minWidth: Math.max(SCREEN_W, 420) }}>
              {/* ── Connection Lines ── */}
              {layoutData.lines.map((line, i) => {
                const dx = line.x2 - line.x1;
                const dy = line.y2 - line.y1;
                const length = Math.sqrt(dx * dx + dy * dy);
                const angle = Math.atan2(dy, dx) * (180 / Math.PI);
                return (
                  <View
                    key={`line-${i}`}
                    style={{
                      position: 'absolute',
                      left: line.x1,
                      top: line.y1,
                      width: length,
                      height: 1.5,
                      backgroundColor: COLORS.blue + '26',
                      transform: [{ rotate: `${angle}deg` }],
                      transformOrigin: 'left center',
                      zIndex: 1,
                    }}
                  />
                );
              })}

              {/* ── Stack Groups ── */}
              {layoutData.groups.map((group) => (
                <View
                  key={group.name}
                  style={[
                    styles.groupBox,
                    {
                      position: 'absolute',
                      left: group.x,
                      top: group.y,
                      width: group.w,
                      height: group.h,
                      backgroundColor: STACK_COLORS[group.colorIdx],
                      borderColor: STACK_BORDER_COLORS[group.colorIdx],
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.groupLabel,
                      { color: STACK_LABEL_COLORS[group.colorIdx] },
                    ]}
                  >
                    {group.name}
                  </Text>
                </View>
              ))}

              {/* ── Container Nodes ── */}
              {layoutData.groups.flatMap((group) =>
                group.nodes.map(({ container: c, x, y, size, networks: nets }) => {
                  const borderColor = getNodeColor(c.state, c.health);
                  const glowColor = getGlowColor(c.state, c.health);
                  const isRunning = c.state === 'running';
                  const isUnhealthy = c.health === 'unhealthy';

                  return (
                    <TouchableOpacity
                      key={c.id}
                      activeOpacity={0.7}
                      onPress={() => router.push(`/containers/${c.id}`)}
                      style={{
                        position: 'absolute',
                        left: x,
                        top: y,
                        width: size,
                        height: size,
                        zIndex: 10,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      {/* Outer glow ring */}
                      <View
                        style={[
                          styles.nodeGlow,
                          {
                            width: size + 8,
                            height: size + 8,
                            borderRadius: (size + 8) / 2,
                            backgroundColor: glowColor,
                          },
                        ]}
                      />

                      {/* Node circle */}
                      <View
                        style={[
                          styles.nodeCircle,
                          {
                            width: size,
                            height: size,
                            borderRadius: size / 2,
                            borderColor,
                            shadowColor: borderColor,
                            shadowOpacity: 0.6,
                            shadowRadius: 8,
                            shadowOffset: { width: 0, height: 0 },
                            elevation: 8,
                          },
                        ]}
                      >
                        {/* Inner status dot */}
                        <View
                          style={[
                            styles.nodeInnerDot,
                            {
                              width: isUnhealthy ? 16 : 10,
                              height: isUnhealthy ? 16 : 10,
                              borderRadius: isUnhealthy ? 8 : 5,
                              backgroundColor: borderColor,
                            },
                          ]}
                        />
                        {/* State icon */}
                        <Text style={styles.nodeStateIcon}>
                          {isUnhealthy ? '!' : isRunning ? '\u25CF' : '\u25A0'}
                        </Text>
                      </View>

                      {/* Name label below node */}
                      <Text style={styles.nodeLabel} numberOfLines={1}>
                        {shortName(c.name)}
                      </Text>

                      {/* Network badges */}
                      {nets.length > 0 && (
                        <View style={styles.netBadgeRow}>
                          {nets.slice(0, 2).map((n) => (
                            <View key={n} style={styles.netBadge}>
                              <Text style={styles.netBadgeText}>
                                {truncate(n, 10)}
                              </Text>
                            </View>
                          ))}
                          {nets.length > 2 && (
                            <View style={styles.netBadge}>
                              <Text style={styles.netBadgeText}>+{nets.length - 2}</Text>
                            </View>
                          )}
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                })
              )}
            </View>
          </ScrollView>
        </ScrollView>

        {/* ── Legend ── */}
        <View style={styles.legend}>
          <View style={styles.legendRow}>
            <LegendItem color={COLORS.green} label="Running" />
            <LegendItem color={COLORS.red} label="Stopped" />
            <LegendItem color={COLORS.yellow} label="Unhealthy" />
          </View>
          <View style={styles.legendRow}>
            <View style={styles.legendItem}>
              <View style={[styles.legendLine, { backgroundColor: COLORS.blue + '66' }]} />
              <Text style={styles.legendText}>Shared Network</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendSwatch, { backgroundColor: COLORS.blue + '33', borderColor: COLORS.blue + '66' }]} />
              <Text style={styles.legendText}>Stack Group</Text>
            </View>
          </View>
        </View>
      </View>
    </>
  );
}

/* ────────────────────────────── Sub-Components ────────────────────── */

function StatPill({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View style={styles.statPill}>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: color, shadowColor: color, shadowOpacity: 0.6, shadowRadius: 4, elevation: 4 }]} />
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

/* ────────────────────────────── Styles ────────────────────────────── */

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  centered: {
    flex: 1,
    backgroundColor: COLORS.bg,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: COLORS.textSecondary,
    fontSize: 14,
    marginTop: SPACING.md,
  },

  /* ── Stats Bar ── */
  statsBar: {
    backgroundColor: COLORS.card,
    marginHorizontal: SPACING.md,
    marginTop: SPACING.md,
    marginBottom: SPACING.sm,
    borderRadius: 14,
    paddingVertical: SPACING.md,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: SPACING.sm,
    marginBottom: 6,
  },
  statPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.border,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: RADIUS.sm,
    gap: 5,
  },
  statValue: {
    fontSize: 16,
    fontWeight: '800',
  },
  statLabel: {
    fontSize: 11,
    color: COLORS.textSecondary,
    fontWeight: '500',
  },
  refreshLabel: {
    color: COLORS.textTertiary,
    fontSize: 10,
    textAlign: 'center',
    marginTop: 2,
  },

  /* ── Canvas ── */
  scrollOuter: {
    flex: 1,
  },
  canvas: {
    paddingBottom: 40,
  },

  /* ── Group Boxes ── */
  groupBox: {
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    zIndex: 2,
  },
  groupLabel: {
    position: 'absolute',
    top: SPACING.md,
    left: SPACING.lg,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },

  /* ── Nodes ── */
  nodeGlow: {
    position: 'absolute',
  },
  nodeCircle: {
    backgroundColor: COLORS.card,
    borderWidth: 2.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nodeInnerDot: {
    position: 'absolute',
    opacity: 0.25,
  },
  nodeStateIcon: {
    color: COLORS.textPrimary,
    fontSize: 10,
    fontWeight: '800',
  },
  nodeLabel: {
    color: COLORS.textSecondary,
    fontSize: 10,
    fontWeight: '600',
    marginTop: 6,
    textAlign: 'center',
    maxWidth: NODE_W,
  },
  netBadgeRow: {
    flexDirection: 'row',
    marginTop: 3,
    gap: 3,
    flexWrap: 'wrap',
    justifyContent: 'center',
    maxWidth: NODE_W + 20,
  },
  netBadge: {
    backgroundColor: COLORS.blue + '1F',
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1.5,
    borderWidth: 0.5,
    borderColor: COLORS.blue + '40',
  },
  netBadgeText: {
    color: COLORS.blue,
    fontSize: 8,
    fontWeight: '500',
  },

  /* ── Legend ── */
  legend: {
    backgroundColor: COLORS.card,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingVertical: 10,
    paddingHorizontal: SPACING.lg,
    gap: 6,
  },
  legendRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: SPACING.lg,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  legendLine: {
    width: 18,
    height: 2,
    borderRadius: 1,
  },
  legendSwatch: {
    width: 14,
    height: 14,
    borderRadius: 4,
    borderWidth: 1,
  },
  legendText: {
    color: COLORS.textSecondary,
    fontSize: 11,
    fontWeight: '500',
  },
});
