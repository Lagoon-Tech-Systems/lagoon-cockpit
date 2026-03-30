import { useEffect } from 'react';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, withDelay, Easing } from 'react-native-reanimated';

interface FadeInProps {
  index: number;
  stagger?: number;
  duration?: number;
  slide?: boolean;
  children: React.ReactNode;
  style?: any;
}

export function FadeIn({ index, stagger = 60, duration = 400, slide = false, children, style }: FadeInProps) {
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(slide ? 16 : 0);

  useEffect(() => {
    const delay = index * stagger;
    opacity.value = withDelay(delay, withTiming(1, { duration, easing: Easing.out(Easing.ease) }));
    if (slide) {
      translateY.value = withDelay(delay, withTiming(0, { duration, easing: Easing.out(Easing.ease) }));
    }
  }, []);

  const animStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    ...(slide ? { transform: [{ translateY: translateY.value }] } : {}),
  }));

  return (
    <Animated.View style={[animStyle, style]}>
      {children}
    </Animated.View>
  );
}
