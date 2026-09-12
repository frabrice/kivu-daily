import { useEffect, useState, useMemo } from 'react';
import { MessageSquare, Calendar, User, Reply, Send, ChevronDown, ChevronUp, Clock, Users, Search } from 'lucide-react';
import { supabase, Comment, Profile } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import Avatar from '../components/Avatar';
import { formatDateLabel, todayStr } from '../lib/utils';

interface CommentWithReplies extends Comment {
  replies: CommentWithReplies[];
}

export default function MDCommentsPage() {
  const { profile } = useAuth();
  const [comments, setComments] = useState<CommentWithReplies[]>([]);
  const [loading, setLoading] = useState(true);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [sendingReply, setSendingReply] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (!profile) return;
    loadComments();

    const channel = supabase
      .channel('md-comments')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'comments' }, () => loadComments())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [profile]);

  const loadComments = async () => {
    if (!profile) return;

    const { data, error } = await supabase
      .from('comments')
      .select('*, author:profiles!comments_author_id_fkey(*), target_user:profiles!comments_target_user_id_fkey(*)')
      .or(`author_id.eq.${profile.id},target_user_id.eq.${profile.id}`)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Error loading MD comments:', error);
    } else {
      const threaded = buildThread(data as Comment[] || []);
      setComments(threaded);
    }
    setLoading(false);

    await supabase.from('profiles').update({ last_comment_seen_at: new Date().toISOString() }).eq('id', profile.id);
  };

  const buildThread = (flatComments: Comment[]): CommentWithReplies[] => {
    const commentMap = new Map<string, CommentWithReplies>();
    const roots: CommentWithReplies[] = [];

    flatComments.forEach(c => {
      commentMap.set(c.id, { ...c, replies: [] });
    });

    flatComments.forEach(c => {
      const node = commentMap.get(c.id)!;
      if (c.parent_comment_id && commentMap.has(c.parent_comment_id)) {
        commentMap.get(c.parent_comment_id)!.replies.push(node);
      } else {
        roots.push(node);
      }
    });

    return roots.reverse();
  };

  const groupedByDate = useMemo(() => {
    const map: Record<string, CommentWithReplies[]> = {};

    comments.forEach(c => {
      if (!c.parent_comment_id) {
        if (!map[c.task_date]) map[c.task_date] = [];
        map[c.task_date].push(c);
      }
    });

    return Object.entries(map).sort((a, b) => b[0].localeCompare(a[0]));
  }, [comments]);

  // Filter by search
  const filteredGroups = useMemo(() => {
    if (!searchQuery.trim()) return groupedByDate;

    return groupedByDate.map(([date, dayComments]) => {
      const filtered = dayComments.filter(c =>
        c.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.target_user?.full_name?.toLowerCase().includes(searchQuery.toLowerCase())
      );
      return [date, filtered] as [string, CommentWithReplies[]];
    }).filter(([, comments]) => comments.length > 0);
  }, [groupedByDate, searchQuery]);

  // Get unique employees in conversations
  const uniqueEmployees = useMemo(() => {
    const employees = new Map<string, { id: string; name: string; count: number }>();
    comments.forEach(c => {
      if (c.target_user && c.target_user.id !== profile?.id) {
        const existing = employees.get(c.target_user.id);
        if (existing) {
          existing.count++;
        } else {
          employees.set(c.target_user.id, {
            id: c.target_user.id,
            name: c.target_user.full_name || 'Unknown',
            count: 1
          });
        }
      }
    });
    return Array.from(employees.values()).sort((a, b) => b.count - a.count);
  }, [comments, profile]);

  const handleReply = async (parentId: string, targetUserId: string) => {
    if (!replyText.trim() || !profile) return;
    setSendingReply(true);

    const parent = comments.find(c => c.id === parentId) ||
      comments.find(c => c.replies.some(r => r.id === parentId));

    const { data, error } = await supabase
      .from('comments')
      .insert({
        author_id: profile.id,
        target_user_id: targetUserId,
        task_date: parent?.task_date || todayStr(),
        parent_comment_id: parentId,
        content: replyText.trim(),
      })
      .select('*, author:profiles!comments_author_id_fkey(*), target_user:profiles!comments_target_user_id_fkey(*)')
      .single();

    if (!error && data) {
      loadComments();

      try {
        await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/comment-notification`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
          },
          body: JSON.stringify({
            comment_id: data.id,
            target_user_id: targetUserId,
            author_id: profile.id,
            content: replyText.trim(),
            task_date: parent?.task_date || todayStr(),
          }),
        });
      } catch (e) {
        console.error('Failed to send notification:', e);
      }
    }
    setReplyText('');
    setReplyingTo(null);
    setSendingReply(false);
  };

  const totalConversations = groupedByDate.reduce((acc, [, comments]) => acc + comments.length, 0);

  if (loading) return (
    <div className="flex items-center justify-center py-12">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#007BFF]"></div>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 p-6 text-white shadow-lg">
        <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -translate-y-1/2 translate-x-1/2"></div>
        <div className="absolute bottom-0 left-0 w-24 h-24 bg-white/5 rounded-full translate-y-1/2 -translate-x-1/2"></div>
        <div className="relative">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
              <MessageSquare size={20} />
            </div>
            <div>
              <h2 className="text-xl font-bold">Team Conversations</h2>
              <p className="text-sm text-white/80">Your feedback threads with employees</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3 mt-4">
            <div className="flex items-center gap-2 bg-white/20 rounded-lg px-3 py-1.5">
              <MessageSquare size={14} />
              <span className="text-sm font-medium">{totalConversations} conversation{totalConversations !== 1 ? 's' : ''}</span>
            </div>
            <div className="flex items-center gap-2 bg-white/20 rounded-lg px-3 py-1.5">
              <Users size={14} />
              <span className="text-sm font-medium">{uniqueEmployees.length} employee{uniqueEmployees.length !== 1 ? 's' : ''}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search conversations..."
          className="w-full pl-11 pr-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-700 focus:border-amber-500 focus:ring-0 focus:outline-none bg-white dark:bg-gray-800 text-sm"
        />
      </div>

      {/* Employees Quick Access */}
      {uniqueEmployees.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {uniqueEmployees.slice(0, 6).map(emp => (
            <button
              key={emp.id}
              onClick={() => setSearchQuery(emp.name)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-gray-100 dark:bg-gray-800 hover:bg-amber-100 dark:hover:bg-amber-900/30 text-sm text-gray-700 dark:text-gray-300 hover:text-amber-700 dark:hover:text-amber-400 transition-colors"
            >
              <User size={12} />
              <span>{emp.name}</span>
              <span className="text-xs text-gray-400 bg-gray-200 dark:bg-gray-700 px-1.5 py-0.5 rounded-full">{emp.count}</span>
            </button>
          ))}
        </div>
      )}

      {filteredGroups.length === 0 && (
        <div className="card p-12 text-center">
          <div className="w-16 h-16 rounded-2xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center mx-auto mb-4">
            <MessageSquare size={32} className="text-gray-400" />
          </div>
          <p className="text-gray-500 font-medium mb-1">
            {searchQuery ? 'No matching conversations' : 'No conversations yet'}
          </p>
          <p className="text-sm text-gray-400">
            {searchQuery ? 'Try a different search term' : 'When you provide feedback to employees, it will appear here.'}
          </p>
        </div>
      )}

      {filteredGroups.map(([date, dayComments]) => (
        <div key={date} className="space-y-4">
          {/* Date Separator */}
          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-gradient-to-r from-transparent via-gray-200 dark:via-gray-700 to-transparent"></div>
            <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-gray-100 dark:bg-gray-800">
              <Calendar size={14} className="text-amber-500" />
              <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">{formatDateLabel(date)}</span>
            </div>
            <div className="flex-1 h-px bg-gradient-to-r from-transparent via-gray-200 dark:via-gray-700 to-transparent"></div>
          </div>

          {/* Conversations */}
          <div className="space-y-6">
            {dayComments.map((c) => (
              <div key={c.id} className="space-y-3">
                {/* Conversation Header */}
                <div className="flex items-center gap-3 px-1">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-amber-100 to-orange-100 dark:from-amber-900/30 dark:to-orange-900/30 flex items-center justify-center">
                    <User size={14} className="text-amber-600 dark:text-amber-400" />
                  </div>
                  <div>
                    <span className="text-xs text-gray-500">Conversation with</span>
                    <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">
                      {c.target_user?.full_name ?? 'Unknown'}
                    </p>
                  </div>
                </div>

                {/* Thread */}
                <MDCommentThread
                  comment={c}
                  profile={profile}
                  replyingTo={replyingTo}
                  setReplyingTo={setReplyingTo}
                  replyText={replyText}
                  setReplyText={setReplyText}
                  sendingReply={sendingReply}
                  handleReply={handleReply}
                  depth={0}
                />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function MDCommentThread({
  comment,
  profile,
  replyingTo,
  setReplyingTo,
  replyText,
  setReplyText,
  sendingReply,
  handleReply,
  depth,
}: {
  comment: CommentWithReplies;
  profile: Profile | null;
  replyingTo: string | null;
  setReplyingTo: (id: string | null) => void;
  replyText: string;
  setReplyText: (text: string) => void;
  sendingReply: boolean;
  handleReply: (parentId: string, targetUserId: string) => void;
  depth: number;
}) {
  const [expanded, setExpanded] = useState(true);
  const isOwnComment = comment.author_id === profile?.id;
  const maxDepth = 4;
  const canReply = depth < maxDepth;

  return (
    <div className={`${depth > 0 ? 'ml-8' : ''}`}>
      {/* Message Bubble */}
      <div className={`flex gap-3 ${isOwnComment ? 'flex-row-reverse' : ''}`}>
        {/* Avatar */}
        <div className={`flex-shrink-0 ${depth > 0 ? 'scale-90' : ''}`}>
          <Avatar name={comment.author?.full_name ?? 'User'} url={comment.author?.avatar_url} size={depth > 0 ? 'sm' : 'md'} />
        </div>

        {/* Message Content */}
        <div className={`flex-1 max-w-[85%] ${isOwnComment ? 'items-end' : 'items-start'} flex flex-col`}>
          {/* Author & Time */}
          <div className={`flex items-center gap-2 mb-1 ${isOwnComment ? 'flex-row-reverse' : ''}`}>
            <span className={`text-sm font-semibold ${isOwnComment ? 'text-amber-600' : 'text-gray-800 dark:text-gray-200'}`}>
              {comment.author?.full_name}
            </span>
            {isOwnComment && (
              <span className="text-xs text-amber-600 bg-amber-100 dark:bg-amber-900/30 px-2 py-0.5 rounded-full">You (MD)</span>
            )}
            {!isOwnComment && comment.target_user && (
              <span className="text-xs text-gray-400 flex items-center gap-1">
                <span>→</span>
                <span className="font-medium">{comment.target_user.full_name}</span>
              </span>
            )}
            <span className="text-xs text-gray-400 flex items-center gap-1">
              <Clock size={10} />
              {new Date(comment.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>

          {/* Bubble */}
          <div className={`relative rounded-2xl px-4 py-3 shadow-sm ${
            isOwnComment
              ? 'bg-gradient-to-br from-amber-500 to-orange-500 text-white rounded-tr-sm'
              : 'bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200 rounded-tl-sm'
          }`}>
            {/* Arrow pointer */}
            <div className={`absolute top-3 w-3 h-3 ${
              isOwnComment
                ? 'right-0 translate-x-1/2 rotate-45 bg-orange-500'
                : 'left-0 -translate-x-1/2 rotate-45 bg-gray-100 dark:bg-gray-800'
            }`}></div>

            <p className="text-sm leading-relaxed relative z-10">{comment.content}</p>
          </div>

          {/* Reply Button */}
          {canReply && (
            <div className={`flex ${isOwnComment ? 'justify-start' : 'justify-end'} mt-2`}>
              <button
                onClick={() => setReplyingTo(replyingTo === comment.id ? null : comment.id)}
                className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-amber-500 dark:hover:text-amber-400 transition-colors px-2 py-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                <Reply size={12} />
                {replyingTo === comment.id ? 'Cancel' : 'Reply'}
              </button>
            </div>
          )}

          {/* Reply Input */}
          {replyingTo === comment.id && (
            <div className="mt-3 flex gap-2">
              <input
                type="text"
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                placeholder="Write your reply..."
                className="flex-1 text-sm px-4 py-2.5 rounded-xl border-2 border-gray-200 dark:border-gray-700 focus:border-amber-500 focus:ring-0 focus:outline-none bg-white dark:bg-gray-800"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !sendingReply) {
                    handleReply(comment.id, comment.author_id);
                  }
                }}
                autoFocus
              />
              <button
                onClick={() => handleReply(comment.id, comment.author_id)}
                disabled={sendingReply || !replyText.trim()}
                className="px-4 py-2.5 rounded-xl bg-amber-500 text-white disabled:opacity-50 disabled:cursor-not-allowed hover:bg-amber-600 transition-colors flex items-center gap-2"
              >
                {sendingReply ? (
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                ) : (
                  <Send size={16} />
                )}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Replies Section */}
      {comment.replies.length > 0 && (
        <div className="relative ml-6 mt-3">
          {/* Thread Line */}
          <div className="absolute left-4 top-0 bottom-4 w-0.5 bg-gradient-to-b from-amber-500/50 to-transparent rounded-full"></div>

          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-2 text-xs text-gray-500 hover:text-amber-500 dark:hover:text-amber-400 transition-colors mb-3 ml-6 group"
          >
            <div className="w-6 h-6 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center group-hover:bg-amber-100 dark:group-hover:bg-amber-900/30 transition-colors">
              {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </div>
            <span className="font-medium">
              {expanded ? 'Hide' : 'Show'} {comment.replies.length} {comment.replies.length === 1 ? 'reply' : 'replies'}
            </span>
          </button>

          {expanded && (
            <div className="space-y-3">
              {comment.replies.map((reply) => (
                <MDCommentThread
                  key={reply.id}
                  comment={reply}
                  profile={profile}
                  replyingTo={replyingTo}
                  setReplyingTo={setReplyingTo}
                  replyText={replyText}
                  setReplyText={setReplyText}
                  sendingReply={sendingReply}
                  handleReply={handleReply}
                  depth={depth + 1}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
