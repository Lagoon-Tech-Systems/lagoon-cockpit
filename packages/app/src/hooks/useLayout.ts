import { useState, useEffect } from 'react';
import { Dimensions } from 'react-native';

export type ScreenSize = 'phone' | 'tablet' | 'desktop';

interface LayoutInfo {
  width: number;
  height: number;
  screenSize: ScreenSize;
  isTablet: boolean;
  /** Number of columns for stat-card grids */
  statColumns: number;
  /** Number of columns for container/service list grids */
  listColumns: number;
}

function classify(width: number): LayoutInfo {
  const height = Dimensions.get('window').height;
  const isTablet = width >= 768;
  const isDesktop = width >= 1024;
  const screenSize: ScreenSize = isDesktop ? 'desktop' : isTablet ? 'tablet' : 'phone';

  return {
    width,
    height,
    screenSize,
    isTablet,
    statColumns: isDesktop ? 4 : isTablet ? 4 : 2,
    listColumns: isDesktop ? 3 : isTablet ? 2 : 1,
  };
}

/**
 * Reactive layout hook — returns screen size classification and column counts.
 * Updates on dimension changes (rotation, split-screen).
 */
export function useLayout(): LayoutInfo {
  const [layout, setLayout] = useState(() => classify(Dimensions.get('window').width));

  useEffect(() => {
    const sub = Dimensions.addEventListener('change', ({ window }) => {
      setLayout(classify(window.width));
    });
    return () => sub.remove();
  }, []);

  return layout;
}
