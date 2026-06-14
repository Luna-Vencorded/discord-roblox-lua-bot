import fs from "node:fs";
import path from "node:path";

const DATA_DIR = path.resolve("data");
const STORE_FILE = path.join(DATA_DIR, "posted_scripts.json");

export interface PostedScript {
  scriptId: string;
  slug: string;
  threadId: string;
  postedAt: string;
  views: number;
  lastViewUpdate: string;
}

interface StoreData {
  postedScripts: Record<string, PostedScript>;
  lastChecked: string | null;
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadStore(): StoreData {
  ensureDataDir();
  if (!fs.existsSync(STORE_FILE)) return { postedScripts: {}, lastChecked: null };
  try {
    return JSON.parse(fs.readFileSync(STORE_FILE, "utf-8")) as StoreData;
  } catch {
    return { postedScripts: {}, lastChecked: null };
  }
}

function saveStore(data: StoreData) {
  ensureDataDir();
  fs.writeFileSync(STORE_FILE, JSON.stringify(data, null, 2), "utf-8");
}

export function isPosted(scriptId: string): boolean {
  return scriptId in loadStore().postedScripts;
}

export function markPosted(script: PostedScript) {
  const store = loadStore();
  store.postedScripts[script.scriptId] = script;
  store.lastChecked = new Date().toISOString();
  saveStore(store);
}

export function getAllPosted(): PostedScript[] {
  return Object.values(loadStore().postedScripts);
}

export function updateViews(scriptId: string, views: number) {
  const store = loadStore();
  if (store.postedScripts[scriptId]) {
    store.postedScripts[scriptId]!.views = views;
    store.postedScripts[scriptId]!.lastViewUpdate = new Date().toISOString();
    saveStore(store);
  }
}
