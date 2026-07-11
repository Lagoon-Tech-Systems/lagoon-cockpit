const EDITION = process.env.COCKPIT_EDITION || "production";

module.exports = {
  expo: {
    name: EDITION === "ce" ? "Lagoon Cockpit CE" : "Lagoon Cockpit",
    slug: "lagoon-cockpit",
    version: "2.0.0",
    orientation: "portrait",
    scheme: "lagoon-cockpit",
    userInterfaceStyle: "dark",
    icon: "./assets/icon.png",
    splash: {
      image: "./assets/splash-icon.png",
      resizeMode: "contain",
      backgroundColor: "#0D0D0D",
    },
    ios: {
      bundleIdentifier: "com.lagoontechsystems.cockpit",
      supportsTablet: true,
      icon: "./assets/icon.png",
      entitlements: {
        // Lets severity=critical alerts render as Time Sensitive (surfaces during
        // Focus modes the user allows). Standard entitlement - not Apple's
        // review-gated Critical Alerts. Server sets interruptionLevel in push/expo.js.
        "com.apple.developer.usernotifications.time-sensitive": true,
      },
    },
    android: {
      package: "com.lagoontechsystems.cockpit",
      adaptiveIcon: {
        foregroundImage: "./assets/adaptive-icon.png",
        backgroundColor: "#0D0D0D",
      },
      usesCleartextTraffic: true,
      permissions: [
        "android.permission.USE_BIOMETRIC",
        "android.permission.USE_FINGERPRINT",
      ],
    },
    web: {
      favicon: "./assets/favicon.png",
      name: "Lagoon Cockpit",
      shortName: "Cockpit",
      themeColor: "#0D0D0D",
      backgroundColor: "#0D0D0D",
      description: "Self-hosted Docker management from your phone",
    },
    plugins: [
      "expo-router",
      "expo-secure-store",
      "expo-local-authentication",
      ["expo-notifications", { color: "#0D0D0D" }],
      ["expo-build-properties", { android: { usesCleartextTraffic: true } }],
      ["expo-splash-screen", { image: "./assets/splash-icon.png", backgroundColor: "#0D0D0D", imageWidth: 288 }],
      "expo-font",
    ],
    extra: {
      edition: EDITION,
      router: {},
      eas: {
        projectId: "4254fbcc-5b16-4aab-b308-6c45db806390",
      },
    },
    owner: "bigabou007-dev",
  },
};
