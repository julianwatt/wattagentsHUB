'use client';
import { useState, useEffect, useCallback } from 'react';
import { Session } from 'next-auth';
import AppLayout from './AppLayout';
import { useLanguage } from './LanguageContext';
import { getSupabaseBrowser } from '@/lib/supabase-browser';
import ToggleSwitch from './ToggleSwitch';

interface RosterUser {
  id: string;
  name: string;
  username: string;
  role: string;
  manager_id: string | null;
  is_active: boolean;
  hire_date: string;
}

interface TeamCard {
  jrManager: RosterUser | null; // null = direct agents under SR
  srManager: RosterUser | null;
  agents: RosterUser[];
}

interface SrSection {
  srManager: RosterUser;
  teams: TeamCard[];
}

export default function RosterClient({ session }: { session: Session }) {
  const { t } = useLanguage();
  const [users, setUsers] = useState<RosterUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState<string | null>(null);

  const fetchRoster = useCallback(async () => {
    const res = await fetch('/api/roster');
    if (res.ok) setUsers(await res.json());
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchRoster();
    // Supabase Realtime — re-fetch when any user changes
    const sb = getSupabaseBrowser();
    const channel = sb.channel('roster-users').on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'users' },
      () => { fetchRoster(); },
    ).subscribe();
    return () => { sb.removeChannel(channel); };
  }, [fetchRoster]);

  const handleToggle = async (userId: string, newActive: boolean) => {
    setToggling(userId);
    const res = await fetch('/api/roster', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: userId, is_active: newActive }),
    });
    if (res.ok) {
      setUsers((prev) => prev.map((u) => u.id === userId ? { ...u, is_active: newActive } : u));
    }
    setToggling(null);
  };

  // Build the grouped structure
  const srManagers = users.filter((u) => u.role === 'sr_manager');
  const jrManagers = users.filter((u) => u.role === 'jr_manager');
  const agents = users.filter((u) => u.role === 'agent');

  const sections: SrSection[] = srManagers.map((sr) => {
    const srsJrs = jrManagers.filter((jr) => jr.manager_id === sr.id);
    const teams: TeamCard[] = srsJrs.map((jr) => ({
      jrManager: jr,
      srManager: sr,
      agents: agents.filter((a) => a.manager_id === jr.id),
    }));
    // Direct agents under this SR (no JR manager)
    const directAgents = agents.filter((a) => a.manager_id === sr.id);
    if (directAgents.length > 0) {
      teams.push({ jrManager: null, srManager: sr, agents: directAgents });
    }
    return { srManager: sr, teams };
  });

  // Agents without any manager or under JR managers without SR
  const orphanJrs = jrManagers.filter((jr) => !jr.manager_id || !srManagers.some((sr) => sr.id === jr.manager_id));
  const orphanTeams: TeamCard[] = orphanJrs.map((jr) => ({
    jrManager: jr,
    srManager: null,
    agents: agents.filter((a) => a.manager_id === jr.id),
  }));
  const unassignedAgents = agents.filter((a) => !a.manager_id || (!jrManagers.some((jr) => jr.id === a.manager_id) && !srManagers.some((sr) => sr.id === a.manager_id)));

  return (
    <AppLayout session={session}>
      <div className="max-w-6xl mx-auto px-3 sm:px-6 py-4 sm:py-8 space-y-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100">{t('roster.title')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{t('roster.subtitle')}</p>
        </div>

        {loading ? (
          <div className="text-center py-20 text-gray-400">{t('common.loading')}</div>
        ) : agents.length === 0 && unassignedAgents.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-4xl mb-3">📋</p>
            <p className="text-gray-600 dark:text-gray-300 font-medium">{t('roster.noAgents')}</p>
          </div>
        ) : (
          <div className="space-y-8">
            {/* SR Manager sections */}
            {sections.map((section) => (
              <div key={section.srManager.id}>
                {/* SR Manager header */}
                <div className="flex items-center gap-3 mb-4">
                  <div className="h-px flex-1 bg-gray-200 dark:bg-gray-700" />
                  <span className="text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
                    {t('roster.srManager')}: {section.srManager.name}
                  </span>
                  <div className="h-px flex-1 bg-gray-200 dark:bg-gray-700" />
                </div>

                {/* Team cards */}
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {section.teams.map((team, i) => (
                    <TeamCardComponent key={team.jrManager?.id ?? `direct-${i}`} team={team} toggling={toggling} onToggle={handleToggle} t={t} />
                  ))}
                </div>
              </div>
            ))}

            {/* Orphan JR teams (no SR) */}
            {orphanTeams.length > 0 && (
              <div>
                <div className="flex items-center gap-3 mb-4">
                  <div className="h-px flex-1 bg-gray-200 dark:bg-gray-700" />
                  <span className="text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    {t('roster.srManager')}: —
                  </span>
                  <div className="h-px flex-1 bg-gray-200 dark:bg-gray-700" />
                </div>
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {orphanTeams.map((team) => (
                    <TeamCardComponent key={team.jrManager?.id} team={team} toggling={toggling} onToggle={handleToggle} t={t} />
                  ))}
                </div>
              </div>
            )}

            {/* Unassigned agents */}
            {unassignedAgents.length > 0 && (
              <div>
                <div className="flex items-center gap-3 mb-4">
                  <div className="h-px flex-1 bg-gray-200 dark:bg-gray-700" />
                  <span className="text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    {t('roster.unassigned')}
                  </span>
                  <div className="h-px flex-1 bg-gray-200 dark:bg-gray-700" />
                </div>
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm overflow-hidden">
                    <div className="px-4 py-3 border-b border-gray-50 dark:border-gray-800" style={{ backgroundColor: 'var(--primary-light)' }}>
                      <p className="text-xs font-bold text-gray-800 dark:text-gray-100">{t('roster.unassignedTeam')}</p>
                    </div>
                    <div className="divide-y divide-gray-50 dark:divide-gray-800">
                      {unassignedAgents.map((a) => (
                        <AgentRow key={a.id} agent={a} toggling={toggling} onToggle={handleToggle} t={t} />
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </AppLayout>
  );
}

function TeamCardComponent({ team, toggling, onToggle, t }: {
  team: TeamCard;
  toggling: string | null;
  onToggle: (id: string, active: boolean) => void;
  t: (k: string) => string;
}) {
  return (
    <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-50 dark:border-gray-800" style={{ backgroundColor: 'var(--primary-light)' }}>
        <p className="text-xs font-bold text-gray-800 dark:text-gray-100">
          {team.jrManager
            ? `${t('roster.teamOf')} ${team.jrManager.name}`
            : t('roster.directAgents')}
        </p>
        {team.srManager && team.jrManager && (
          <p className="text-[10px] text-gray-500 dark:text-gray-400">{t('roster.srManager')}: {team.srManager.name}</p>
        )}
      </div>
      <div className="divide-y divide-gray-50 dark:divide-gray-800">
        {team.agents.length === 0 ? (
          <p className="text-xs text-gray-400 px-4 py-3 text-center">—</p>
        ) : team.agents.map((a) => (
          <AgentRow key={a.id} agent={a} toggling={toggling} onToggle={onToggle} t={t} />
        ))}
      </div>
    </div>
  );
}

function AgentRow({ agent, toggling, onToggle, t }: {
  agent: RosterUser;
  toggling: string | null;
  onToggle: (id: string, active: boolean) => void;
  t: (k: string) => string;
}) {
  const isToggling = toggling === agent.id;
  return (
    <div className="px-4 py-2.5 flex items-center justify-between gap-2">
      <div className="flex items-center gap-2 min-w-0">
        <div className="w-7 h-7 rounded-full flex items-center justify-center font-bold text-xs flex-shrink-0"
          style={{ backgroundColor: 'var(--primary-light)', color: 'var(--primary)' }}>
          {agent.name.charAt(0).toUpperCase()}
        </div>
        <p className="text-xs font-semibold text-gray-800 dark:text-gray-100 truncate">{agent.name}</p>
      </div>
      <ToggleSwitch checked={agent.is_active} onChange={(v) => onToggle(agent.id, v)} disabled={isToggling} />
    </div>
  );
}
