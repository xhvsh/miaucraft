import { supabase } from "./supabaseClient.js";

// Live server chat.
//
// * kind='web'    messages are written by logged-in site users. The in-game
//   bridge plugin reads them and forwards them into the server as
//   `[web] <username>: <message>`.
// * kind='server' messages are written by that same plugin with the
//   service-role key and render here as ordinary player chat (`player: msg`).
// * kind='system' rows are server online/offline notices. Until the plugin
//   handles them, the website inserts them when it detects a status change
//   through server_status_public.
//
// Required schema (run in the Supabase SQL editor; the plugin writes
// kind='server' rows with the service-role key, which bypasses RLS):
//
//   create table public.chat_messages (
//     id         uuid primary key default gen_random_uuid(),
//     kind       text not null check (kind in ('web', 'server', 'system')),
//     username   text,
//     user_id    uuid references auth.users (id) on delete set null,
//     message    text not null,
//     created_at timestamptz not null default now()
//   );
//
//   create index chat_messages_created_at_idx
//     on public.chat_messages (created_at desc);
//
//   alter table public.chat_messages enable row level security;
//
//   create policy "chat_select_authed" on public.chat_messages
//     for select to authenticated using (true);
//   create policy "chat_insert_web" on public.chat_messages
//     for insert to authenticated with check (kind in ('web', 'system'));

export const CHAT_TABLE = "chat_messages";
export const CHAT_MESSAGE_MAX = 300;

function db() {
  return supabase.from(CHAT_TABLE);
}

export async function listChatMessages(limit = 200) {
  const { data, error } = await db().select("*").order("created_at", { ascending: false }).limit(limit);
  if (error) throw error;
  return (data ?? []).reverse();
}

export function subscribeChatMessages(onChange) {
  const channel = supabase
    .channel("chat-messages-changes")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: CHAT_TABLE }, onChange)
    .subscribe();
  return () => supabase.removeChannel(channel);
}

export async function sendWebMessage({ userId, username, message }) {
  const { data, error } = await db()
    .insert({ kind: "web", user_id: userId ?? null, username: username ?? null, message: message.trim() })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function insertSystemChatMessage(message) {
  const { data, error } = await db().insert({ kind: "system", username: null, message }).select().single();
  if (error) throw error;
  return data;
}