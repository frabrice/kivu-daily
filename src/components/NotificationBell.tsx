import { useState, useRef, useEffect } from 'react';
import { Bell, CheckCheck } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { useNotifications } from '../lib/notifications';
import { timeAgo } from '../lib/utils';

export default function NotificationBell() {
  const { profile } = useAuth();
  const { notifications, unreadCount, markRead, markAllRead } = useNotifications(profile?.id);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative p-2 rounded-xl text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/5 transition-colors"
      >
        <Bell size={19} />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 max-h-96 overflow-y-auto card p-2 z-50 animate-scale-in shadow-lg">
          <div className="flex items-center justify-between px-2 py-1.5">
            <p className="text-sm font-semibold">Notifications</p>
            {unreadCount > 0 && (
              <button onClick={markAllRead} className="text-xs text-brand-600 dark:text-brand-300 flex items-center gap-1 hover:underline">
                <CheckCheck size={13} /> Mark all read
              </button>
            )}
          </div>

          {notifications.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-6">No notifications yet.</p>
          )}

          <div className="space-y-0.5">
            {notifications.map((n) => (
              <button
                key={n.id}
                onClick={() => markRead(n.id)}
                className={`w-full text-left p-2.5 rounded-xl transition-colors ${
                  n.read ? 'hover:bg-gray-50 dark:hover:bg-white/5' : 'bg-brand/5 hover:bg-brand/10'
                }`}
              >
                <p className={`text-sm ${n.read ? 'text-gray-500 dark:text-gray-400' : 'text-gray-800 dark:text-gray-100'}`}>{n.message}</p>
                <p className="text-xs text-gray-400 mt-0.5">{timeAgo(n.created_at)}</p>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
