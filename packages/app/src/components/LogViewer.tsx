import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useRef, useEffect } from 'react';

interface LogViewerProps {
  lines: string[];
  autoScroll?: boolean;
}

export default function LogViewer({ lines, autoScroll = true }: LogViewerProps) {
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollToEnd({ animated: false });
    }
  }, [lines, autoScroll]);

  return (
    <ScrollView
      ref={scrollRef}
      style={styles.container}
      horizontal={false}
      showsVerticalScrollIndicator
    >
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={styles.content}>
          {lines.map((line, i) => (
            <Text key={i} style={styles.line} selectable>
              {line}
            </Text>
          ))}
          {lines.length === 0 && <Text style={styles.empty}>No logs available</Text>}
        </View>
      </ScrollView>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0A0A',
    borderRadius: 8,
    padding: 12,
  },
  content: { minWidth: '100%' },
  line: {
    color: '#D1D5DB',
    fontFamily: 'monospace',
    fontSize: 11,
    lineHeight: 18,
  },
  empty: { color: '#6B7280', fontSize: 13, fontStyle: 'italic' },
});
