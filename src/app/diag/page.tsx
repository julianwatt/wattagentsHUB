'use client';
import { useEffect, useState, useRef } from 'react';
import { createClient } from '@supabase/supabase-js';

interface LogEntry { time: string; msg: string; type: 'info' | 'ok' | 'err' }

export default function DiagPage() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [wsState, setWsState] = useState('unknown');
  const [channels, setChannels] = useState<string[]>([]);
  const ran = useRef(false);

  const log = (msg: string, type: LogEntry['type'] = 'info') => {
    setLogs(p => [...p, { time: new Date().toISOString().split('T')[1].split('.')[0], msg, type }]);
  };

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    // 1. Check env vars
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    log(`SUPABASE_URL: ${url || 'MISSING'}`, url ? 'ok' : 'err');
    log(`ANON_KEY: ${key ? key.substring(0, 10) + '...' + key.substring(key.length - 5) : 'MISSING'}`, key ? 'ok' : 'err');

    if (!url || !key) {
      log('Cannot proceed without SUPABASE_URL and ANON_KEY', 'err');
      return;
    }

    // Create a FRESH client (not the app singleton) to isolate the test
    log('Creating fresh Supabase client (not app singleton)...');
    const sb = createClient(url, key, {
      auth: { persistSession: false },
    });

    // Expose on window for manual inspection
    (window as any).__diagSb = sb;

    // 2. Subscribe to a test channel on shift_logs
    log('Creating channel "diag-test" on shift_logs...');
    const channel = sb.channel('diag-test')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shift_logs' }, (payload) => {
        log(`REALTIME EVENT received: ${payload.eventType} on shift_logs (id: ${(payload as any).new?.id?.substring(0, 8) || 'n/a'})`, 'ok');
      })
      .subscribe((status, err) => {
        log(`Channel status: ${status}${err ? ' | Error: ' + JSON.stringify(err.message) : ''}`, status === 'SUBSCRIBED' ? 'ok' : status === 'CHANNEL_ERROR' ? 'err' : 'info');
        setWsState(status);
      });

    // 3. Also subscribe to admin_notifications
    const channel2 = sb.channel('diag-notifs')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'admin_notifications' }, (payload) => {
        log(`REALTIME EVENT received: ${payload.eventType} on admin_notifications`, 'ok');
      })
      .subscribe((status, err) => {
        log(`Notifs channel status: ${status}${err ? ' | Error: ' + JSON.stringify(err.message) : ''}`, status === 'SUBSCRIBED' ? 'ok' : status === 'CHANNEL_ERROR' ? 'err' : 'info');
      });

    // 4. Check channels after 4s
    setTimeout(() => {
      const ch = sb.getChannels();
      const names = ch.map((c: any) => `${c.topic} (${c.state})`);
      setChannels(names);
      log(`Active channels (${ch.length}): ${names.join(', ')}`, ch.length > 0 ? 'ok' : 'err');

      // Also log the realtime connection state
      const rt = (sb as any).realtime;
      log(`Realtime endpoint: ${rt?.endPoint || rt?.socketAdapter?.endPoint || 'unknown'}`, 'info');
      log(`Realtime state: ${rt?.socketAdapter?.readyState ?? rt?.conn?.readyState ?? 'unknown'}`, 'info');
    }, 4000);

    return () => {
      sb.removeChannel(channel);
      sb.removeChannel(channel2);
    };
  }, []);

  return (
    <div style={{ fontFamily: 'monospace', padding: 20, background: '#111', color: '#eee', minHeight: '100vh' }}>
      <h1 style={{ fontSize: 18, marginBottom: 10 }}>Realtime Diagnostic — Production</h1>
      <div style={{ marginBottom: 10, padding: 8, background: '#222', borderRadius: 4 }}>
        <strong>WebSocket state:</strong> <span style={{ color: wsState === 'SUBSCRIBED' ? '#4f4' : wsState === 'CHANNEL_ERROR' ? '#f44' : '#ff4' }}>{wsState}</span>
      </div>
      <div style={{ marginBottom: 10, padding: 8, background: '#222', borderRadius: 4 }}>
        <strong>Channels:</strong> {channels.length > 0 ? channels.join(' | ') : 'none yet...'}
      </div>
      <div style={{ padding: 8, background: '#1a1a1a', borderRadius: 4 }}>
        <strong>Log:</strong>
        {logs.map((l, i) => (
          <div key={i} style={{ color: l.type === 'ok' ? '#4f4' : l.type === 'err' ? '#f44' : '#aaa', fontSize: 13, marginTop: 2 }}>
            [{l.time}] {l.msg}
          </div>
        ))}
        {logs.length === 0 && <div style={{ color: '#666' }}>Starting diagnostics...</div>}
      </div>
      <p style={{ marginTop: 20, fontSize: 12, color: '#666' }}>
        This page tests Supabase Realtime connectivity. Insert a row into shift_logs or admin_notifications to see if events arrive.
      </p>
    </div>
  );
}
