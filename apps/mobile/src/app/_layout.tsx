import {Stack} from 'expo-router';
import {StatusBar} from 'expo-status-bar';
import {useEffect} from 'react';
import {ActivityIndicator, StyleSheet, View} from 'react-native';
import {bootstrapMobile} from '../lib/bootstrap';
import {useAuthStore} from '../store/auth';

// 装配 api-client（bearer 模式），在任何业务请求前调用一次；模块加载即执行
bootstrapMobile();

export default function RootLayout() {
  const status = useAuthStore(state => state.status);

  useEffect(() => {
    void useAuthStore.getState().initAuth();
  }, []);

  // 启动静默恢复会话期间先渲染 loading，避免鉴权状态未定前闪出错误页面
  if (status === 'idle' || status === 'loading') {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  const authenticated = status === 'authenticated';

  return (
    <>
      <StatusBar style="auto" />
      <Stack screenOptions={{headerShown: false}}>
        <Stack.Protected guard={authenticated}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="team/[teamId]" />
          <Stack.Screen name="wiki/[wikiId]" />
          <Stack.Screen name="document/[documentId]" />
        </Stack.Protected>
        <Stack.Protected guard={!authenticated}>
          <Stack.Screen name="login" />
          <Stack.Screen name="register" />
        </Stack.Protected>
      </Stack>
    </>
  );
}

const styles = StyleSheet.create({
  loading: {flex: 1, alignItems: 'center', justifyContent: 'center'}
});
