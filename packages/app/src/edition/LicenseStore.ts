import { create } from "zustand";
import { apiFetch } from "../lib/api";
import { EDITION_RANK } from "./features";

export interface EditionLimits {
  servers?: number;
  alertRules?: number;
  users?: number;
  webhooks?: number;
  schedules?: number;
  integrations?: number;
  [key: string]: number | undefined;
}

export interface EditionState {
  edition: string;
  features: string[];
  limits: EditionLimits;
  org: string | null;
  expiresAt: string | null;
  graceMode: boolean;
  extensions: string[];
  isLoaded: boolean;
  isLoading: boolean;
  error: string | null;

  fetchEdition: () => Promise<void>;
  hasFeature: (feature: string) => boolean;
  getLimit: (resource: string) => number;
}

export const useLicenseStore = create<EditionState>((set, get) => ({
  edition: "ce",
  features: [],
  limits: {},
  org: null,
  expiresAt: null,
  graceMode: false,
  extensions: [],
  isLoaded: false,
  isLoading: false,
  error: null,

  fetchEdition: async () => {
    set({ isLoading: true, error: null });
    try {
      const data = await apiFetch<{
        edition: string;
        features: string[];
        limits: EditionLimits;
        org: string | null;
        expiresAt: string | null;
        graceMode: boolean;
        extensions: string[];
      }>("/api/edition");

      set({
        edition: data.edition,
        features: data.features,
        limits: data.limits,
        org: data.org,
        expiresAt: data.expiresAt,
        graceMode: data.graceMode,
        extensions: data.extensions || [],
        isLoaded: true,
        isLoading: false,
      });
    } catch (err: any) {
      // Default to CE on failure (don't block the app)
      set({
        edition: "ce",
        features: [],
        limits: {},
        isLoaded: true,
        isLoading: false,
        error: err.message,
      });
    }
  },

  hasFeature: (feature: string) => {
    const state = get();
    if (state.edition === "private") return true;

    // Check if the feature is in the features array from the server
    if (state.features.length > 0) {
      return state.features.includes(feature);
    }

    // Fallback: check edition rank
    const { FEATURE_EDITIONS } = require("./features");
    const required = FEATURE_EDITIONS[feature];
    if (!required) return false;
    return (EDITION_RANK[state.edition] ?? 0) >= (EDITION_RANK[required] ?? 0);
  },

  getLimit: (resource: string) => {
    const state = get();
    if (state.edition === "private" || state.edition === "enterprise") {
      return Infinity;
    }
    return state.limits[resource] ?? Infinity;
  },
}));
