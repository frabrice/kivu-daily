import { useEffect, useState, useMemo } from 'react';
import { MessageSquare, Calendar, Reply, Send, ChevronDown, ChevronUp, Clock, Sparkles } from 'lucide-react';
import { supabase, Comment, Profile } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import Avatar from '../components/Avatar';
import { formatDateLabel, todayStr } from '../lib/utils';

interface CommentWithReplies extends Comment {
  replies: CommentWithReplies[];
}

export default function CommentsPage() {
  const { profile } = useAuth();
  const [comments, setComments] = useState<CommentWithReplies[]>([]);
  const [loading, setLoading] = useState(true);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [sendingReply, setSendingReply] = useState(false);

  useEffect(() => {
    if (!profile) return;
    loadComments();

    const channel = supabase
      .channel('employee-comments')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'comments' }, () => loadComments())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [profile]);

  const loadComments = async () => {
    if (!profile) return;

    const { data, error } = await supabase
      .from('comments')
      .select('*, author:profiles!comments_author_id_fkey(*)')
      .or(`target_user_id.eq.${profile.id},author_id.eq.${profile.id}`)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Error loading comments:', error);
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
    const flatten = (cs: CommentWithReplies[]): CommentWithReplies[] =>
      cs.flatMap(c => [c, ...flatten(c.replies)]);

    const allComments = flatten(comments);
    const seen = new Set<string>();
    const uniqueComments = allComments.filter(c => {
      if (seen.has(c.id)) return false;
      seen.add(c.id);
      return true;
    });

    uniqueComments.forEach(c => {
      if (!map[c.task_date]) map[c.task_date] = [];
      if (!c.parent_comment_id) {
        map[c.task_date].push(c);
      }
    });

    return Object.entries(map).sort((a, b) => b[0].localeCompare(a[0]));
  }, [comments]);

  const handleReply = async (parentId: string) => {
    if (!replyText.trim() || !profile) return;
    setSendingReply(true);

    const parent = comments.find(c => c.id === parentId) ||
      comments.find(c => c.replies.some(r => r.id === parentId));

    const { data, error } = await supabase
      .from('comments')
      .insert({
        author_id: profile.id,
        target_user_id: parent?.author_id || profile.id,
        task_date: parent?.task_date || todayStr(),
        parent_comment_id: parentId,
        content: replyText.trim(),
      })
      .select('*, author:profiles!comments_author_id_fkey(*)')
      .single();

    if (!error && data) {
      loadComments();
    }
    setReplyText('');
    setReplyingTo(null);
    setSendingReply(false);
  };

  const totalConversations = groupedByDate.reduce((acc, [, comments]) => acc + comments.length, 0);

  if (loading) return (
    <div className="flex items-center justify-center py-12">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand"></div>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-navy-800 to-brand-700 p-6 text-white shadow-lg">
        <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -translate-y-1/2 translate-x-1/2"></div>
        <div className="absolute bottom-0 left-0 w-24 h-24 bg-white/5 rounded-full translate-y-1/2 -translate-x-1/2"></div>
        <div className="relative">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
              <MessageSquare size={20} />
            </div>
            <div>
              <h2 className="text-xl font-bold">Feedback & Conversations</h2>
              <p className="text-sm text-white/80">Messages from the MD</p>
            </div>
          </div>
          <div className="flex items-center gap-4 mt-4">
            <div className="flex items-center gap-2 bg-white/20 rounded-lg px-3 py-1.5">
              <Sparkles size={14} />
              <span className="text-sm font-medium">{totalConversations} conversation{totalConversations !== 1 ? 's' : ''}</span>
            </div>
          </div>
        </div>
      </div>

      {groupedByDate.length === 0 && (
        <div className="card p-12 text-center">
          <div className="w-16 h-16 rounded-2xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center mx-auto mb-4">
            <MessageSquare size={32} className="text-gray-400" />
          </div>
          <p className="text-gray-500 font-medium mb-1">No conversations yet</p>
          <p className="text-sm text-gray-400">When the MD leaves feedback, it will appear here.</p>
        </div>
      )}

      {groupedByDate.map(([date, dayComments]) => (
        <div key={date} className="space-y-4">
          {/* Date Separator */}
          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-gradient-to-r from-transparent via-gray-200 dark:via-gray-700 to-transparent"></div>
            <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-gray-100 dark:bg-gray-800">
              <Calendar size={14} className="text-brand-500" />
              <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">{formatDateLabel(date)}</span>
            </div>
            <div className="flex-1 h-px bg-gradient-to-r from-transparent via-gray-200 dark:via-gray-700 to-transparent"></div>
          </div>

          {/* Conversations */}
          <div className="space-y-4">
            {dayComments.map((c) => (
              <CommentThread
                key={c.id}
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
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function CommentThread({
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
  handleReply: (parentId: string) => void;
  depth: number;
}) {
  const [expanded, setExpanded] = useState(true);
  const isOwnComment = comment.author_id === profile?.id;
  const maxDepth = 4;
  const canReply = depth < maxDepth;
  const isMD = comment.author?.role === 'managing_director';

  return (
    <div className={`${depth > 0 ? 'ml-8' : ''}`}>
      {/* Message Bubble */}
      <div className={`flex gap-3 ${isOwnComment ? 'flex-row-reverse' : ''}`}>
        {/* Avatar */}
        <div className={`flex-shrink-0 ${depth > 0 ? 'scale-90' : ''}`}>
          <div className="relative">
            <Avatar name={comment.author?.full_name ?? 'User'} url={comment.author?.avatar_url} size={depth > 0 ? 'sm' : 'md'} />
            {isMD && !isOwnComment && (
              <div className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold text-white bg-amber-500">
                MD
              </div>
            )}
          </div>
        </div>

        {/* Message Content */}
        <div className={`flex-1 max-w-[85%] ${isOwnComment ? 'items-end' : 'items-start'} flex flex-col`}>
          {/* Author & Time */}
          <div className={`flex items-center gap-2 mb-1 ${isOwnComment ? 'flex-row-reverse' : ''}`}>
            <span className={`text-sm font-semibold ${isOwnComment ? 'text-brand-600 dark:text-brand-300' : 'text-gray-800 dark:text-gray-200'}`}>
              {comment.author?.full_name}
            </span>
            {isOwnComment && (
              <span className="text-xs text-gray-400 bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded-full">You</span>
            )}
            <span className="text-xs text-gray-400 flex items-center gap-1">
              <Clock size={10} />
              {new Date(comment.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>

          {/* Bubble */}
          <div className={`relative rounded-2xl px-4 py-3 shadow-sm ${
            isOwnComment
              ? 'bg-brand text-white rounded-tr-sm'
              : isMD
                ? 'bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-900/20 dark:to-orange-900/20 border-2 border-amber-200 dark:border-amber-700/50 text-gray-800 dark:text-gray-200 rounded-tl-sm'
                : 'bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200 rounded-tl-sm'
          }`}>
            {/* Arrow pointer */}
            <div className={`absolute top-3 w-3 h-3 ${
              isOwnComment
                ? 'right-0 translate-x-1/2 rotate-45 bg-brand'
                : isMD
                  ? 'left-0 -translate-x-1/2 rotate-45 bg-amber-50 dark:bg-amber-900/20 border-l-2 border-b-2 border-amber-200 dark:border-amber-700/50'
                  : 'left-0 -translate-x-1/2 rotate-45 bg-gray-100 dark:bg-gray-800'
            }`}></div>

            <p className="text-sm leading-relaxed relative z-10">{comment.content}</p>
          </div>

          {/* Reply Button */}
          {canReply && (
            <div className={`flex ${isOwnComment ? 'justify-start' : 'justify-end'} mt-2`}>
              <button
                onClick={() => setReplyingTo(replyingTo === comment.id ? null : comment.id)}
                className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-brand-600 dark:hover:text-brand-300 transition-colors px-2 py-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
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
                className="flex-1 text-sm px-4 py-2.5 rounded-xl border-2 border-gray-200 dark:border-gray-700 focus:border-brand focus:ring-0 focus:outline-none bg-white dark:bg-gray-800"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !sendingReply) {
                    handleReply(comment.id);
                  }
                }}
                autoFocus
              />
              <button
                onClick={() => handleReply(comment.id)}
                disabled={sendingReply || !replyText.trim()}
                className="px-4 py-2.5 rounded-xl bg-brand text-white disabled:opacity-50 disabled:cursor-not-allowed hover:bg-brand-600 transition-colors flex items-center gap-2"
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
          <div className="absolute left-4 top-0 bottom-4 w-0.5 bg-gradient-to-b from-brand/50 to-transparent rounded-full"></div>

          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-2 text-xs text-gray-500 hover:text-brand-600 dark:hover:text-brand-300 transition-colors mb-3 ml-6 group"
          >
            <div className="w-6 h-6 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center group-hover:bg-brand/10 transition-colors">
              {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </div>
            <span className="font-medium">
              {expanded ? 'Hide' : 'Show'} {comment.replies.length} {comment.replies.length === 1 ? 'reply' : 'replies'}
            </span>
          </button>

          {expanded && (
            <div className="space-y-3">
              {comment.replies.map((reply) => (
                <CommentThread
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
