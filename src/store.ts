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
  progress: {
    currentPage: number;
    totalPosted: number;
  };
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadStore(): StoreData {
  ensureDataDir();
  if (!fs.existsSync(STORE_FILE)) return { postedScripts: {}, lastChecked: null, progress: { currentPage: 1, totalPosted: 0 } };
  try {
    const data = JSON.parse(fs.readFileSync(STORE_FILE, "utf-8")) as StoreData;
    if (!data.progress) data.progress = { currentPage: 1, totalPosted: 0 };
    return data;
  } catch {
    return { postedScripts: {}, lastChecked: null, progress: { currentPage: 1, totalPosted: 0 } };
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

export function saveProgress(currentPage: number, totalPosted: number) {
  const store = loadStore();
  store.progress = { currentPage, totalPosted };
  saveStore(store);
}

export function getProgress(): { currentPage: number; totalPosted: number } {
  return loadStore().progress;
}

export function resetProgress() {
  const store = loadStore();
  store.progress = { currentPage: 1, totalPosted: 0 };
  saveStore(store);
}
