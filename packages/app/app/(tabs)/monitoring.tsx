import { useState, useRef, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Platform,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { Ionicons } from '@expo/vector-icons';
import { useServerStore } from '../../src/stores/serverStore';
import { COLORS, RADIUS, SPACING } from '../../src/theme/tokens';

/* ---------- Constants ---------- */

const GRAFANA_BASE = 'https://grafana.lagoontechsystems.com';

const LINUX_DASHBOARD = { uid: 'lagoon-infra', slug: 'lagoon-infrastructure' };
const WINDOWS_DASHBOARD = { uid: 'lagoon-windows', slug: 'windows-server' };

const LINUX_PANELS = [
  { label: 'Overview', panelId: null },
  { label: 'CPU', panelId: 2 },
  { label: 'Memory', panelId: 4 },
  { label: 'Containers', panelId: 6 },
] as const;

const WINDOWS_PANELS = [
  { label: 'Overview', panelId: null },
  { label: 'CPU', panelId: 2 },
  { label: 'Memory', panelId: 4 },
  { label: 'Services', panelId: 10 },
] as const;

type PanelDef = { label: string; panelId: number | null };

/* ---------- Helpers ---------- */

function isWindowsServer(name: string, url: string): boolean {
  const combined = (name + ' ' + url).toLowerCase();
  return combined.includes('win') || combined.includes('windows');
}

function buildGrafanaUrl(
  dashboard: { uid: string; slug: string },
  panel: PanelDef,
): string {
  if (panel.panelId == null) {
    return `${GRAFANA_BASE}/d/${dashboard.uid}/${dashboard.slug}?theme=dark`;
  }
  return `${GRAFANA_BASE}/d-solo/${dashboard.uid}/${dashboard.slug}?panelId=${panel.panelId}&theme=dark`;
}

const AUTO_LOGIN_JS = `
  (function() {
    if (document.querySelector('form[name="loginForm"], input[name="user"]')) {
      fetch('${GRAFANA_BASE}/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user: 'admin', password: 'lagoon-grafana-2026' }),
        credentials: 'include'
      }).then(function() {
        window.location.reload();
      });
    }
  })();
  true;
`;

/* ---------- Screen ---------- */

export default function MonitoringTab() {
  const serverName = useServerStore((s) => s.serverName) ?? '';
  const activeProfileId = useServerStore((s) => s.activeProfileId);
  const profiles = useServerStore((s) => s.profiles);
  const activeProfile = profiles.find((p) => p.id === activeProfileId);
  const serverUrl = activeProfile?.url ?? '';

  const isWindows = useMemo(
    () => isWindowsServer(serverName, serverUrl),
    [serverName, serverUrl],
  );

  const dashboard = isWindows ? WINDOWS_DASHBOARD : LINUX_DASHBOARD;
  const panels: PanelDef[] = isWindows
    ? [...WINDOWS_PANELS]
    : [...LINUX_PANELS];

  const [activePanel, setActivePanel] = useState<PanelDef>(panels[0]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const webviewRef = useRef<WebView>(null);

  const currentUrl = buildGrafanaUrl(dashboard, activePanel);

  const handlePanelChange = useCallback((panel: PanelDef) => {
    setActivePanel(panel);
    setLoading(true);
    setError(false);
  }, []);

  const handleRefresh = useCallback(() => {
    setLoading(true);
    setError(false);
    webviewRef.current?.reload();
  }, []);

  const handleRetry = useCallback(() => {
    setLoading(true);
    setError(false);
    setActivePanel((prev) => ({ ...prev }));
  }, []);

  // No server connected
  if (!activeProfileId) {
    return (
      <View style={styles.screen}>
        <View style={styles.center}>
          <Ionicons
            name="analytics-outline"
            size={48}
            color={COLORS.textTertiary}
            style={{ marginBottom: SPACING.lg }}
          />
          <Text style={styles.errorTitle}>No Server Connected</Text>
          <Text style={styles.errorText}>
            Connect to a server to view its monitoring dashboard.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      {/* Server indicator */}
      <View style={styles.serverBar}>
        <Ionicons
          name={isWindows ? 'desktop-outline' : 'server-outline'}
          size={16}
          color={isWindows ? COLORS.blue : COLORS.green}
        />
        <Text style={styles.serverLabel} numberOfLines={1}>
          {serverName || activeProfile?.name || 'Server'}
        </Text>
        <View
          style={[
            styles.platformBadge,
            { backgroundColor: isWindows ? COLORS.blue + '20' : COLORS.green + '20' },
          ]}
        >
          <Text
            style={[
              styles.platformText,
              { color: isWindows ? COLORS.blue : COLORS.green },
            ]}
          >
            {isWindows ? 'Windows' : 'Linux'}
          </Text>
        </View>
      </View>

      {/* Panel Selector */}
      <View style={styles.selectorRow}>
        {panels.map((panel) => {
          const isActive = activePanel.label === panel.label;
          return (
            <TouchableOpacity
              key={panel.label}
              style={[styles.selectorBtn, isActive && styles.selectorBtnActive]}
              onPress={() => handlePanelChange(panel)}
            >
              <Text
                style={[
                  styles.selectorBtnText,
                  isActive && styles.selectorBtnTextActive,
                ]}
              >
                {panel.label}
              </Text>
            </TouchableOpacity>
          );
        })}
        <TouchableOpacity style={styles.refreshBtn} onPress={handleRefresh}>
          <Ionicons name="refresh" size={20} color={COLORS.textSecondary} />
        </TouchableOpacity>
      </View>

      {/* WebView / Loading / Error */}
      <View style={styles.webviewContainer}>
        {error ? (
          <View style={styles.center}>
            <Ionicons
              name="warning"
              size={48}
              color={COLORS.yellow}
              style={{ marginBottom: SPACING.lg }}
            />
            <Text style={styles.errorTitle}>Grafana Unreachable</Text>
            <Text style={styles.errorText}>
              Could not connect to the monitoring dashboard. Check that Grafana
              is running and accessible.
            </Text>
            <TouchableOpacity style={styles.retryBtn} onPress={handleRetry}>
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            {loading && (
              <View style={styles.loaderOverlay}>
                <ActivityIndicator size="large" color={COLORS.blue} />
                <Text style={styles.loaderText}>Loading dashboard...</Text>
              </View>
            )}
            {Platform.OS === 'web' ? (
              <iframe
                src={currentUrl}
                style={{
                  flex: 1,
                  width: '100%',
                  height: '100%',
                  border: 'none',
                  backgroundColor: COLORS.bg,
                }}
                onLoad={() => setLoading(false)}
                onError={() => {
                  setLoading(false);
                  setError(true);
                }}
              />
            ) : (
              <WebView
                ref={webviewRef}
                source={{ uri: currentUrl }}
                style={styles.webview}
                onLoadEnd={() => setLoading(false)}
                onError={() => {
                  setLoading(false);
                  setError(true);
                }}
                onHttpError={(syntheticEvent) => {
                  const { statusCode } = syntheticEvent.nativeEvent;
                  if (statusCode >= 400) {
                    setLoading(false);
                    setError(true);
                  }
                }}
                javaScriptEnabled
                domStorageEnabled
                startInLoadingState={false}
                originWhitelist={['https://*']}
                allowsInlineMediaPlayback
                mixedContentMode="compatibility"
                injectedJavaScript={
                  AUTO_LOGIN_JS +
                  `
                  (function() {
                    var meta = document.createElement('meta');
                    meta.name = 'viewport';
                    meta.content = 'width=device-width, initial-scale=1, maximum-scale=1';
                    document.head.appendChild(meta);
                  })();
                  true;
                `
                }
              />
            )}
          </>
        )}
      </View>
    </View>
  );
}

/* ---------- Styles ---------- */

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },

  /* Server Bar */
  serverBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.sm,
    gap: SPACING.sm,
  },
  serverLabel: {
    flex: 1,
    color: COLORS.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
  platformBadge: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: 2,
    borderRadius: RADIUS.sm,
  },
  platformText: {
    fontSize: 11,
    fontWeight: '700',
  },

  /* Panel Selector */
  selectorRow: {
    flexDirection: 'row',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    gap: SPACING.sm,
    alignItems: 'center',
  },
  selectorBtn: {
    flex: 1,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.sm,
    backgroundColor: COLORS.border,
    alignItems: 'center',
  },
  selectorBtnActive: {
    backgroundColor: COLORS.blue,
  },
  selectorBtnText: {
    color: COLORS.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
  selectorBtnTextActive: {
    color: COLORS.bg,
  },
  refreshBtn: {
    minWidth: 44,
    minHeight: 44,
    borderRadius: RADIUS.sm,
    backgroundColor: COLORS.border,
    justifyContent: 'center',
    alignItems: 'center',
  },

  /* WebView */
  webviewContainer: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  webview: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },

  /* Loading */
  loaderOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.bg,
    zIndex: 10,
  },
  loaderText: {
    color: COLORS.textSecondary,
    fontSize: 13,
    marginTop: SPACING.md,
  },

  /* Error / Empty */
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: SPACING.xxl,
  },
  errorTitle: {
    color: COLORS.textPrimary,
    fontSize: 18,
    fontWeight: '700',
    marginBottom: SPACING.sm,
  },
  errorText: {
    color: COLORS.textSecondary,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: SPACING.xl,
  },
  retryBtn: {
    backgroundColor: COLORS.border,
    paddingHorizontal: SPACING.xl,
    paddingVertical: 10,
    borderRadius: RADIUS.sm,
  },
  retryText: {
    color: COLORS.blue,
    fontWeight: '600',
    fontSize: 14,
  },
});
