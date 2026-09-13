import {router, useLocalSearchParams} from 'expo-router';
import {useEffect} from 'react';
import {FlatList, Pressable, StyleSheet, Text, View} from 'react-native';
import {ScreenHeader} from '../../components/screen-header';
import {EmptyState, ErrorState, LoadingState} from '../../components/states';
import {type FlattenedDocument, flattenDocumentTree} from '../../lib/document-tree';
import {useDocumentStore} from '../../store/document';

export default function WikiScreen() {
  const {wikiId, name} = useLocalSearchParams<{wikiId: string; name?: string}>();
  const tree = useDocumentStore(state => state.tree);
  const status = useDocumentStore(state => state.status);
  const error = useDocumentStore(state => state.error);
  const load = useDocumentStore(state => state.load);

  useEffect(() => {
    if (wikiId) void load(wikiId);
  }, [wikiId, load]);

  const flat = flattenDocumentTree(tree);

  return (
    <View style={styles.container}>
      <ScreenHeader title={name ?? '文档'} back />
      {status === 'loading' && flat.length === 0 ? (
        <LoadingState />
      ) : status === 'error' && flat.length === 0 ? (
        <ErrorState message={error ?? '加载失败'} onRetry={() => void load(wikiId)} />
      ) : (
        <FlatList
          data={flat}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={<EmptyState message="该 Wiki 还没有文档" />}
          renderItem={({item}) => <DocRow doc={item} wikiId={wikiId} />}
        />
      )}
    </View>
  );
}

function DocRow({doc, wikiId}: {doc: FlattenedDocument; wikiId: string}) {
  return (
    <Pressable
      style={({pressed}) => [
        styles.row,
        {paddingLeft: 16 + doc.depth * 18},
        pressed && styles.pressed
      ]}
      onPress={() =>
        router.push({
          pathname: '/document/[documentId]',
          params: {documentId: doc.id, wikiId, title: doc.title}
        })
      }
    >
      <Text style={styles.docTitle} numberOfLines={1}>
        {doc.title}
      </Text>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#f6f8fa'},
  list: {padding: 16, gap: 8},
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingRight: 16,
    borderRadius: 8,
    backgroundColor: '#fff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#d0d7de'
  },
  pressed: {opacity: 0.7},
  docTitle: {flex: 1, fontSize: 15, color: '#1f2328'},
  chevron: {fontSize: 20, color: '#c0c6cd'}
});
