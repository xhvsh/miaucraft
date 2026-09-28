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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Rejects instead of hanging forever if a request stalls mid-resume. */
function withTimeout(promise, ms, label) {
  let timer;
  // Promise.resolve() is what makes .finally safe here: a PostgREST builder is
  // a bare thenable, not a real Promise.
  return Promise.race([
    Promise.resolve(promise).finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms);
    }),
  ]);
}

/**
 * Runs a query with a timeout and a couple of quiet retries.
 *
 * An idle Supabase project pauses itself, and the first requests after it
 * resumes can stall for tens of seconds or fail outright. Measured against this
 * project: 25s for a cold read, 0.16s for the very next one. That is a cold
 * start rather than a broken page, so absorb it here instead of showing the
 * user an empty panel.
 */
async function query(build, label) {
  let lastError;
  // Two attempts, not more: a cold read is followed by an instant warm one, so
  // a retry rescues the pause without leaving the user staring at ~60s of blank
  // page before the retry banner finally appears.
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const { data, error } = await withTimeout(build(), 20_000, label);
      if (!error) return data;
      lastError = new Error(error.message);
      // A missing table or a refused role will not fix itself on a retry.
      if (error.code === "PGRST205" || error.code === "42P01" || error.code === "42501") throw lastError;
    } catch (err) {
      lastError = err;
    }
    if (attempt < 2) await sleep(600 * attempt);
  }
  throw lastError;
}

export async function fetchStatus() {
  const data = await query(() => db("bridge_status").select("*").eq("id", 1).maybeSingle(), "status");
  return data ?? null;
}

export async function fetchEvents({ level = null, category = null, limit = 200 } = {}) {
  const data = await query(() => {
    let q = db("bridge_events").select("*").order("created_at", { ascending: false }).limit(limit);
    if (level) q = q.eq("level", level);
    if (category) q = q.eq("category", category);
    return q;
  }, "events");
  return data ?? [];
}

/**
 * Like query(), but also returns the matched row count. Used by the console,
 * which server-side pages: the count lets the page controls show a total.
 */
async function queryWithCount(build, label) {
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const { data, error, count } = await withTimeout(build(), 20_000, label);
      if (!error) return { rows: data ?? [], count };
      lastError = new Error(error.message);
      if (error.code === "PGRST205" || error.code === "42P01" || error.code === "42501") throw lastError;
    } catch (err) {
      lastError = err;
    }
    if (attempt < 2) await sleep(600 * attempt);
  }
  throw lastError;
}

/**
 * Fetches one page of console lines. Rows come back oldest first within the
 * page so the view (and the copy button) reads top-to-bottom like a terminal.
 * count is the total number of matched lines, for the page last-page math.
 */
export async function fetchConsolePage({ level = null, page = 1, perPage = 150 } = {}) {
  const from = Math.max(0, (page - 1) * perPage);
  const to = from + perPage - 1;
  const { rows, count } = await queryWithCount(() => {
    let q = db("bridge_console").select("id,created_at,level,message", { count: "exact" })
      .order("id", { ascending: false })
      .range(from, to);
    if (level) q = q.eq("level", level);
    return q;
  }, "console");
  return { rows: rows.slice().reverse(), count };
}

export async function fetchCommands(limit = 40) {
  const data = await query(
    () =>
      db("bridge_commands")
        .select("*")
        .order("requested_at", { ascending: false })
        .limit(limit),
    "commands",
  );
  return data ?? [];
}

/**
 * Queues an action. The RPC is the only write path: it records the caller from
 * the session, so a row cannot claim to have come from someone else.
 */
export async function requestCommand(command) {
  const { data, error } = await supabase.rpc("request_bridge_command", {
    p_command: command,
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

/**
 * Subscribes to one table.
 *
 * `onStatus` reports the channel state, because Supabase reports a subscription
 * to a table missing from the supabase_realtime publication as simply
 * SUBSCRIBED with no events ever arriving. Surfacing the state is the only way
 * to tell a working live view from a silently dead one.
 */
function subscribeTable(table, onChange, onStatus) {
  const channel = supabase
    .channel(`bridge-${table}-changes`)
    .on("postgres_changes", { event: "*", schema: SCHEMA, table }, onChange)
    .subscribe((status) => onStatus?.(status, table));
  return () => supabase.removeChannel(channel);
}

export const subscribeEvents = (cb, onStatus) => subscribeTable("bridge_events", cb, onStatus);
export const subscribeConsole = (cb, onStatus) => subscribeTable("bridge_console", cb, onStatus);
export const subscribeStatus = (cb, onStatus) => subscribeTable("bridge_status", cb, onStatus);
export const subscribeCommands = (cb, onStatus) => subscribeTable("bridge_commands", cb, onStatus);
