import {Link, router} from 'expo-router';
import {useState} from 'react';
import {Pressable, StyleSheet, Text, TextInput, View} from 'react-native';
import {useAuthStore} from '../store/auth';

export default function RegisterScreen() {
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      await useAuthStore.getState().register(email.trim(), username.trim(), password);
      router.replace('/(tabs)');
    } catch (err) {
      setError(err instanceof Error ? err.message : '注册失败，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>注册</Text>
      <TextInput
        style={styles.input}
        placeholder="邮箱"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        autoComplete="email"
      />
      <TextInput
        style={styles.input}
        placeholder="用户名（3-32 位）"
        value={username}
        onChangeText={setUsername}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <TextInput
        style={styles.input}
        placeholder="密码（至少 8 位）"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="new-password"
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Pressable
        style={({pressed}) => [styles.button, pressed && styles.buttonPressed]}
        onPress={handleSubmit}
        disabled={submitting}
      >
        <Text style={styles.buttonText}>{submitting ? '注册中…' : '注册'}</Text>
      </Pressable>
      <Link href="/login" style={styles.link}>
        已有账号？登录
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
