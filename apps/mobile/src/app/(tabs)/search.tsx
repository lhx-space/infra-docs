import {router} from 'expo-router';
import {useEffect, useState} from 'react';
import {FlatList, Pressable, StyleSheet, Text, TextInput, View} from 'react-native';
import {EmptyState, LoadingState} from '../../components/states';
import {useSearchStore} from '../../store/search';

type SearchItem = {
  kind: 'wiki' | 'document';
  id: string;
  title: string;
  sub: string;
  wikiId: string;
};

export default function SearchScreen() {
  const [input, setInput] = useState('');
  const results = useSearchStore(state => state.results);
  const status = useSearchStore(state => state.status);
  const search = useSearchStore(state => state.search);

  useEffect(() => {
    const timer = setTimeout(() => {
      void search(input);
    }, 300);
    return () => clearTimeout(timer);
  }, [input, search]);

  const items: SearchItem[] = [
    ...(results?.wikis ?? []).map(w => ({
      kind: 'wiki' as const,
      id: w.id,
      title: w.name,
      sub: `${w.documentCount ?? 0} 篇文档`,
      wikiId: w.id
    })),
    ...(results?.documents ?? []).map(d => ({
      kind: 'document' as const,
      id: d.id,
      title: d.title,
      sub: '文档',
      wikiId: d.wikiId
    }))
  ];

  const hasQuery = input.trim().length > 0;

  return (
    <View style={styles.container}>
      <TextInput
        style={styles.input}
        placeholder="搜索文档 / Wiki"
        value={input}
        onChangeText={setInput}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
      />
      {!hasQuery ? (
        <EmptyState message="输入关键词开始搜索" />
      ) : status === 'loading' ? (
        <LoadingState />
      ) : (
        <FlatList
          data={items}
          keyExtractor={item => `${item.kind}:${item.id}`}
          contentContainerStyle={styles.list}
          ListEmptyComponent={<EmptyState message="没有匹配结果" />}
          renderItem={({item}) => <SearchRow item={item} />}
        />
      )}
    </View>
  );
}

function SearchRow({item}: {item: SearchItem}) {
  function open() {
    if (item.kind === 'wiki') {
      router.push({pathname: '/wiki/[wikiId]', params: {wikiId: item.wikiId, name: item.title}});
      return;
    }
    router.push({
      pathname: '/document/[documentId]',
      params: {documentId: item.id, wikiId: item.wikiId, title: item.title}
    });
  }

  return (
    <Pressable style={({pressed}) => [styles.row, pressed && styles.pressed]} onPress={open}>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {item.title}
        </Text>
        <Text style={styles.rowMeta}>
          {item.kind === 'wiki' ? 'Wiki' : '文档'} · {item.sub}
        </Text>
      </View>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1},
  input: {
    margin: 16,
    borderWidth: 1,
    borderColor: '#d0d7de',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    backgroundColor: '#fff'
  },
  list: {paddingHorizontal: 16, gap: 12},
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 10,
    backgroundColor: '#fff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#d0d7de'
  },
  pressed: {opacity: 0.7},
  rowText: {flex: 1, gap: 4},
  rowTitle: {fontSize: 16, fontWeight: '600', color: '#1f2328'},
  rowMeta: {fontSize: 13, color: '#59636e'},
  chevron: {fontSize: 22, color: '#c0c6cd'}
});
