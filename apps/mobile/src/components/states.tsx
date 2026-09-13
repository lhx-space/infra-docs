import {ActivityIndicator, Pressable, StyleSheet, Text, View} from 'react-native';

export function LoadingState() {
  return (
    <View style={styles.center}>
      <ActivityIndicator size="large" />
    </View>
  );
}

export function ErrorState({message, onRetry}: {message: string; onRetry: () => void}) {
  return (
    <View style={styles.center}>
      <Text style={styles.error}>{message}</Text>
      <Pressable style={styles.retryBtn} onPress={onRetry}>
        <Text style={styles.retryText}>重试</Text>
      </Pressable>
    </View>
  );
}

export function EmptyState({message}: {message: string}) {
  return (
    <View style={styles.center}>
      <Text style={styles.empty}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: {flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12},
  error: {color: '#d73a49', textAlign: 'center'},
  retryBtn: {
    backgroundColor: '#0969da',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 16
  },
  retryText: {color: '#fff', fontWeight: '600'},
  empty: {color: '#59636e', textAlign: 'center'}
});
