import {Link, router} from 'expo-router';
import {useState} from 'react';
import {Pressable, StyleSheet, Text, TextInput, View} from 'react-native';
import {useAuthStore} from '../store/auth';

export default function LoginScreen() {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      await useAuthStore.getState().login(identifier.trim(), password);
      router.replace('/(tabs)');
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>登录</Text>
      <TextInput
        style={styles.input}
        placeholder="邮箱或用户名"
        value={identifier}
        onChangeText={setIdentifier}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="username"
      />
      <TextInput
        style={styles.input}
        placeholder="密码"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="password"
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Pressable
        style={({pressed}) => [styles.button, pressed && styles.buttonPressed]}
        onPress={handleSubmit}
        disabled={submitting}
      >
        <Text style={styles.buttonText}>{submitting ? '登录中…' : '登录'}</Text>
      </Pressable>
      <Link href="/register" style={styles.link}>
        还没有账号？注册
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, padding: 24, justifyContent: 'center', gap: 12},
  title: {fontSize: 28, fontWeight: '700', marginBottom: 12, textAlign: 'center'},
  input: {borderWidth: 1, borderColor: '#d0d7de', borderRadius: 8, padding: 12, fontSize: 16},
  error: {color: '#d73a49', fontSize: 14},
  button: {backgroundColor: '#0969da', borderRadius: 8, padding: 14, alignItems: 'center'},
  buttonPressed: {opacity: 0.85},
  buttonText: {color: '#fff', fontSize: 16, fontWeight: '600'},
  link: {textAlign: 'center', color: '#0969da', marginTop: 8}
});
