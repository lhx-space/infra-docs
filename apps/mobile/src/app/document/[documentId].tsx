import {renderDocument} from '@luhanxin/api-client';
import {useLocalSearchParams} from 'expo-router';
import {useCallback, useEffect, useState} from 'react';
import {StyleSheet, View} from 'react-native';
import {WebView} from 'react-native-webview';
import {ScreenHeader} from '../../components/screen-header';
import {ErrorState, LoadingState} from '../../components/states';

type LoadStatus = 'loading' | 'ready' | 'error';

export default function DocumentScreen() {
  const {
    documentId,
    wikiId,
    title: initialTitle
  } = useLocalSearchParams<{
    documentId: string;
    wikiId?: string;
    title?: string;
  }>();
  const [html, setHtml] = useState<string | null>(null);
  const [title, setTitle] = useState(initialTitle ?? '文档');
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!documentId || !wikiId) {
      setStatus('error');
      setError('缺少文档参数');
      return;
    }
    setStatus('loading');
    setError(null);
    try {
      const res = await renderDocument(wikiId, documentId);
      setHtml(res.html);
      setTitle(res.title);
      setStatus('ready');
    } catch {
      setStatus('error');
      setError('文档加载失败，请稍后重试');
    }
  }, [documentId, wikiId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <View style={styles.container}>
      <ScreenHeader title={title} back />
      {status === 'loading' ? (
        <LoadingState />
      ) : status === 'error' ? (
        <ErrorState message={error ?? '加载失败'} onRetry={() => void load()} />
      ) : (
        <WebView originWhitelist={['*']} source={{html: html ?? ''}} style={styles.webview} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#fff'},
  webview: {flex: 1}
});
