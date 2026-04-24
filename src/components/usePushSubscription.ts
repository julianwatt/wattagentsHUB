'use client';
import { useState, useEffect, useCallback } from 'react';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export interface PushState {
  isSupported: boolean;
  permission: NotificationPermission | 'unsupported';
  isSubscribed: boolean;
  subscribe: () => Promise<boolean>;
  loading: boolean;
  isIOSSafariNoPWA: boolean;
}

function detectIOSSafariNoPWA(): boolean {
  if (typeof window === 'undefined') return false;
  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (!isIOS) return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  const isStandalone = nav.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
  return !isStandalone;
}

async function syncSubscription(): Promise<void> {
  try {
    const reg = await navigator.serviceWorker.getRegistration('/sw.js');
    if (!reg) return;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return;
    await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription: sub.toJSON() }),
    });
  } catch {}
}

export function usePushSubscription(): PushState {
  const isSupported = typeof window !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && 'Notification' in window;

  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(
    isSupported ? Notification.permission : 'unsupported',
  );
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [loading, setLoading] = useState(false);
  const isIOSSafariNoPWA = typeof window !== 'undefined' && detectIOSSafariNoPWA();

  useEffect(() => {
    if (!isSupported) return;
    (async () => {
      try {
        const reg = await navigator.serviceWorker.getRegistration('/sw.js');
        if (!reg) return;
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          setIsSubscribed(true);
          syncSubscription();
        }
      } catch {}
    })();
  }, [isSupported]);

  const subscribe = useCallback(async (): Promise<boolean> => {
    if (!isSupported) return false;
    setLoading(true);

    try {
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== 'granted') {
        setLoading(false);
        return false;
      }

      const reg = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;

      const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!vapidKey) {
        console.error('[usePush] VAPID public key not available');
        setLoading(false);
        return false;
      }

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey).buffer as ArrayBuffer,
      });

      const res = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: sub.toJSON() }),
      });

      if (res.ok) {
        setIsSubscribed(true);
        setLoading(false);
        return true;
      }

      console.error('[usePush] subscribe API error:', await res.text());
      setLoading(false);
      return false;
    } catch (err) {
      console.error('[usePush] subscribe error:', err);
      setLoading(false);
      return false;
    }
  }, [isSupported]);

  return { isSupported, permission, isSubscribed, subscribe, loading, isIOSSafariNoPWA };
}
