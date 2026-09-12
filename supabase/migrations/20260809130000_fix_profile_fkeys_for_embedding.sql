/*
# Repoint user-reference foreign keys at profiles, not auth.users

PostgREST can only auto-embed a related table (e.g. `author:profiles(*)`)
when a real foreign key points directly at that table. profiles.id
mirrors auth.users.id, but every user-reference column here was declared
against auth.users(id) - valid for referential integrity, but invisible
to PostgREST's embedding, causing 400s on every query that tries to
embed the actor/author/uploader profile. profiles.id is itself a FK to
auth.users(id) ON DELETE CASCADE, so repointing these at profiles(id)
keeps the same cascade behavior while fixing embedding.
*/

ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_user_id_fkey;
ALTER TABLE tasks ADD CONSTRAINT tasks_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;

ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_assigned_by_fkey;
ALTER TABLE tasks ADD CONSTRAINT tasks_assigned_by_fkey
  FOREIGN KEY (assigned_by) REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE comments DROP CONSTRAINT IF EXISTS comments_author_id_fkey;
ALTER TABLE comments ADD CONSTRAINT comments_author_id_fkey
  FOREIGN KEY (author_id) REFERENCES profiles(id) ON DELETE CASCADE;

ALTER TABLE comments DROP CONSTRAINT IF EXISTS comments_target_user_id_fkey;
ALTER TABLE comments ADD CONSTRAINT comments_target_user_id_fkey
  FOREIGN KEY (target_user_id) REFERENCES profiles(id) ON DELETE CASCADE;

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_user_id_fkey;
ALTER TABLE notifications ADD CONSTRAINT notifications_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;

ALTER TABLE meetings DROP CONSTRAINT IF EXISTS meetings_author_id_fkey;
ALTER TABLE meetings ADD CONSTRAINT meetings_author_id_fkey
  FOREIGN KEY (author_id) REFERENCES profiles(id) ON DELETE CASCADE;

ALTER TABLE announcements DROP CONSTRAINT IF EXISTS announcements_author_id_fkey;
ALTER TABLE announcements ADD CONSTRAINT announcements_author_id_fkey
  FOREIGN KEY (author_id) REFERENCES profiles(id) ON DELETE CASCADE;

ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_uploader_id_fkey;
ALTER TABLE documents ADD CONSTRAINT documents_uploader_id_fkey
  FOREIGN KEY (uploader_id) REFERENCES profiles(id) ON DELETE CASCADE;

ALTER TABLE activity_log DROP CONSTRAINT IF EXISTS activity_log_actor_id_fkey;
ALTER TABLE activity_log ADD CONSTRAINT activity_log_actor_id_fkey
  FOREIGN KEY (actor_id) REFERENCES profiles(id) ON DELETE SET NULL;
