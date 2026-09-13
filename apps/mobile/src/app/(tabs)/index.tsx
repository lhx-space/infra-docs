import type {Team} from '@luhanxin/api-client';
import {router} from 'expo-router';
import {useEffect} from 'react';
import {FlatList, Pressable, StyleSheet, Text, View} from 'react-native';
import {EmptyState, ErrorState, LoadingState} from '../../components/states';
import {useTeamStore} from '../../store/team';

export default function HomeScreen() {
  const teams = useTeamStore(state => state.teams);
  const status = useTeamStore(state => state.teamsStatus);
  const error = useTeamStore(state => state.teamsError);
  const loadTeams = useTeamStore(state => state.loadTeams);

  useEffect(() => {
    if (teams.length === 0) void loadTeams();
  }, [teams.length, loadTeams]);

  if (status === 'loading' && teams.length === 0) return <LoadingState />;
  if (status === 'error' && teams.length === 0) {
    return <ErrorState message={error ?? '加载失败'} onRetry={() => void loadTeams()} />;
  }

  return (
    <FlatList
      data={teams}
      keyExtractor={item => item.id}
      contentContainerStyle={styles.list}
      ListEmptyComponent={<EmptyState message="还没有团队" />}
      renderItem={({item}) => <TeamRow team={item} />}
    />
  );
}

function TeamRow({team}: {team: Team}) {
  return (
    <Pressable
      style={({pressed}) => [styles.row, pressed && styles.pressed]}
      onPress={() =>
        router.push({pathname: '/team/[teamId]', params: {teamId: team.id, name: team.name}})
      }
    >
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{team.name}</Text>
        <Text style={styles.rowMeta}>
          {team.wikiCount ?? 0} 个 Wiki · {team.documentCount ?? 0} 篇文档
        </Text>
      </View>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
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
