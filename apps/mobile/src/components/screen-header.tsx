import {router} from 'expo-router';
import type {ReactNode} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';

export function ScreenHeader({
  title,
  back,
  right
}: {
  title: string;
  back?: boolean;
  right?: ReactNode;
}) {
  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <View style={styles.bar}>
        <View style={styles.side}>
          {back ? (
            <Pressable onPress={() => router.back()} hitSlop={8}>
              <Text style={styles.back}>‹ 返回</Text>
            </Pressable>
          ) : null}
        </View>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        <View style={[styles.side, styles.right]}>{right}</View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#d0d7de'
  },
  bar: {flexDirection: 'row', alignItems: 'center', height: 48, paddingHorizontal: 12},
  side: {flex: 1, justifyContent: 'center'},
  right: {alignItems: 'flex-end'},
  back: {color: '#0969da', fontSize: 16},
  title: {flex: 2, fontSize: 17, fontWeight: '600', textAlign: 'center', color: '#1f2328'}
});
