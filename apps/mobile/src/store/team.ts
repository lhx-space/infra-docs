import {
  listMyTeams,
  listTeamWikis,
  type Team,
  type TeamWikiDirectoryEntry
} from '@luhanxin/api-client';
import {create} from 'zustand';
import {toErrorMessage} from '../lib/errors';

type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

interface TeamState {
  teams: Team[];
  teamsStatus: LoadStatus;
  teamsError: string | null;
  wikis: TeamWikiDirectoryEntry[];
  wikisStatus: LoadStatus;
  wikisError: string | null;
  loadTeams: () => Promise<void>;
  loadTeamWikis: (teamId: string) => Promise<void>;
  reset: () => void;
}

export const useTeamStore = create<TeamState>(set => ({
  teams: [],
  teamsStatus: 'idle',
  teamsError: null,
  wikis: [],
  wikisStatus: 'idle',
  wikisError: null,

  loadTeams: async () => {
    set({teamsStatus: 'loading', teamsError: null});
    try {
      const {teams} = await listMyTeams();
      set({teams, teamsStatus: 'ready'});
    } catch (err) {
      set({teamsError: toErrorMessage(err), teamsStatus: 'error'});
    }
  },

  loadTeamWikis: async teamId => {
    set({wikisStatus: 'loading', wikisError: null});
    try {
      const {wikis} = await listTeamWikis(teamId);
      set({wikis, wikisStatus: 'ready'});
    } catch (err) {
      set({wikisError: toErrorMessage(err), wikisStatus: 'error'});
    }
  },

  reset: () =>
    set({
      teams: [],
      teamsStatus: 'idle',
      teamsError: null,
      wikis: [],
      wikisStatus: 'idle',
      wikisError: null
    })
}));
