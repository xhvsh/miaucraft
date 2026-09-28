// Data access for the owner-facing bridge operations page.
//
// Every read here is owner-scoped by RLS, and every write goes through the
// request_bridge_command RPC, which re-checks the role server-side. The UI
// hiding the buttons is a convenience; the database is the actual boundary.

import { supabase } from "./supabaseClient.js";

const SCHEMA = "public";

const db = (table) => (SCHEMA === "public" ? supabase.from(table) : supabase.schema(SCHEMA).from(table));

/** The action symbols the server accepts. Must match the migration's CHECK. */
export const BRIDGE_COMMANDS = [
  { id: "update.check", label: "Check for update", icon: "fa-rotate", hint: "Asks the server to look for a newer jar." },
  { id: "update.apply", label: "Install update", icon: "fa-download", hint: "Applies the staged jar. The server restarts afterwards.", danger: true },
  { id: "config.reload", label: "Reload remote config", icon: "fa-cloud-arrow-down", hint: "Re-fetches the remote config and re-applies it live." },
  { id: "connection.test", label: "Test Supabase connection", icon: "fa-plug", hint: "Runs one read against the database and reports the result." },
  { id: "stats.reconcile", label: "Reconcile stats now", icon: "fa-chart-line", hint: "Forces a stat reconcile for online players." },
  { id: "sinks.drain", label: "Re-send queued rows", icon: "fa-inbox", hint: "Forces the queued achievement rows out immediately." },
  { id: "sinks.flush", label: "Flush all sinks", icon: "fa-bolt", hint: "Pushes every queued row now instead of waiting for the next cycle." },
];

export async function fetchStatus() {
  const { data, error } = await db("bridge_status").select("*").eq("id", 1).maybeSingle();
  if (error) throw new Error(error.message);
  return data ?? null;
}

export async function fetchEvents({ level = null, category = null, limit = 200 } = {}) {
  let query = db("bridge_events").select("*").order("created_at", { ascending: false }).limit(limit);
  if (level) query = query.eq("level", level);
  if (category) query = query.eq("category", category);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function fetchConsole({ level = null, limit = 400 } = {}) {
  let query = db("bridge_console").select("*").order("id", { ascending: false }).limit(limit);
  if (level) query = query.eq("level", level);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  // Oldest first, so copying the view reads top-to-bottom like a terminal.
  return (data ?? []).slice().reverse();
}

export async function fetchCommands(limit = 40) {
  const { data, error } = await db("bridge_commands")
    .select("*")
    .order("requested_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return data ?? [];
}

/**
 * Queues an action. The RPC is the only write path: it records the caller from
 * the session, so a row cannot claim to have come from someone else.
 */
export async function requestCommand(command) {
  const { data, error } = await supabase.rpc("request_bridge_command", {
    p_command: command,
    p_args: {},
  });
  if (error) {
    if (error.code === "42883" || error.code === "PGRST202") {
      throw new Error("request_bridge_command isn't set up yet - run the bridge operations SQL first.");
    }
    if (error.message?.includes("owner role required")) {
      throw new Error("Only the owner account can run server actions.");
    }
    throw new Error(error.message);
  }
  return data;
}

function subscribeTable(table, onChange) {
  const channel = supabase
    .channel(`bridge-${table}-changes`)
    .on("postgres_changes", { event: "*", schema: SCHEMA, table }, onChange)
    .subscribe();
  return () => supabase.removeChannel(channel);
}

export const subscribeEvents = (cb) => subscribeTable("bridge_events", cb);
export const subscribeConsole = (cb) => subscribeTable("bridge_console", cb);
export const subscribeStatus = (cb) => subscribeTable("bridge_status", cb);
export const subscribeCommands = (cb) => subscribeTable("bridge_commands", cb);
