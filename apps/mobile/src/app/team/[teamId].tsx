import type {TeamWikiDirectoryEntry} from '@luhanxin/api-client';
import {router, useLocalSearchParams} from 'expo-router';
import {useEffect} from 'react';
import {FlatList, Pressable, StyleSheet, Text, View} from 'react-native';
import {ScreenHeader} from '../../components/screen-header';
import {EmptyState, ErrorState, LoadingState} from '../../components/states';
import {relativeTime} from '../../lib/format';
import {useTeamStore} from '../../store/team';

export default function TeamScreen() {
  const {teamId, name} = useLocalSearchParams<{teamId: string; name?: string}>();
  const wikis = useTeamStore(state => state.wikis);
  const status = useTeamStore(state => state.wikisStatus);
  const error = useTeamStore(state => state.wikisError);
  const loadTeamWikis = useTeamStore(state => state.loadTeamWikis);

  useEffect(() => {
    if (teamId) void loadTeamWikis(teamId);
  }, [teamId, loadTeamWikis]);

  if (status === 'loading' && wikis.length === 0) {
    return (
      <View style={styles.container}>
        <ScreenHeader title={name ?? 'Wiki'} back />
        <LoadingState />
      </View>
    );
  }
  if (status === 'error' && wikis.length === 0) {
    return (
      <View style={styles.container}>
        <ScreenHeader title={name ?? 'Wiki'} back />
        <ErrorState message={error ?? '加载失败'} onRetry={() => void loadTeamWikis(teamId)} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScreenHeader title={name ?? 'Wiki'} back />
      <FlatList
        data={wikis}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={<EmptyState message="该团队还没有 Wiki" />}
        renderItem={({item}) => <WikiRow wiki={item} />}
      />
    </View>
  );
}

function WikiRow({wiki}: {wiki: TeamWikiDirectoryEntry}) {
  return (
    <Pressable
      style={({pressed}) => [styles.row, pressed && styles.pressed]}
      onPress={() =>
        router.push({pathname: '/wiki/[wikiId]', params: {wikiId: wiki.id, name: wiki.name}})
      }
    >
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{wiki.name}</Text>
        <Text style={styles.rowMeta}>
          {wiki.documentCount} 篇文档 · {wiki.memberCount} 名成员 · {relativeTime(null)}
        </Text>
      </View>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#f6f8fa'},
  list: {padding: 16, gap: 12},
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
