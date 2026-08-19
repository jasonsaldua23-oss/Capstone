import AsyncStorage from "@react-native-async-storage/async-storage";

import { ApiError, apiRequest } from "./api";
import { getToken } from "./auth";
import { mergeQueuedOperation } from "../lib/driver-logic";

const QUEUE_KEY = "driver_offline_operation_queue";

export type OfflineOperationKind = "LOCATION" | "START_TRIP" | "UPDATE_STOP";
export type OfflineQueueState = "QUEUED" | "SYNCING" | "FAILED";

export type OfflineQueueItem = {
  id: string;
  kind: OfflineOperationKind;
  method: "POST" | "PATCH";
  path: string;
  body: Record<string, unknown>;
  createdAt: string;
  attempts: number;
  lastError: string | null;
  state: OfflineQueueState;
};

let syncPromise: Promise<OfflineQueueItem[]> | null = null;

export async function readOfflineQueue(): Promise<OfflineQueueItem[]> {
  const raw = await AsyncStorage.getItem(QUEUE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeOfflineQueue(queue: OfflineQueueItem[]): Promise<void> {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

export async function queueOfflineOperation(
  input: Pick<OfflineQueueItem, "kind" | "method" | "path" | "body">,
): Promise<OfflineQueueItem[]> {
  const queue = await readOfflineQueue();
  const item: OfflineQueueItem = {
    ...input,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    createdAt: new Date().toISOString(),
    attempts: 0,
    lastError: null,
    state: "QUEUED",
  };

  // Only the newest unsent location is useful; delivery mutations retain FIFO order.
  const next = mergeQueuedOperation(queue, item);
  await writeOfflineQueue(next);
  return next;
}

export async function clearOfflineQueue(): Promise<void> {
  await AsyncStorage.removeItem(QUEUE_KEY);
}

export async function syncOfflineQueue(): Promise<OfflineQueueItem[]> {
  if (syncPromise) return syncPromise;
  syncPromise = (async () => {
    const token = await getToken();
    if (!token) return readOfflineQueue();

    const queue = await readOfflineQueue();
    const remaining: OfflineQueueItem[] = [];
    for (let index = 0; index < queue.length; index += 1) {
      const item = queue[index];
      try {
        await apiRequest(item.path, {
          method: item.method,
          token,
          body: JSON.stringify(item.body),
        });
      } catch (error) {
        const permanentClientError = error instanceof ApiError && error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 429;
        remaining.push({
          ...item,
          attempts: item.attempts + 1,
          lastError: error instanceof Error ? error.message : "Synchronization failed.",
          state: permanentClientError ? "FAILED" : "QUEUED",
        });
        // Preserve FIFO ordering after any transient failure or permanent conflict.
        remaining.push(...queue.slice(index + 1));
        break;
      }
    }
    await writeOfflineQueue(remaining);
    return remaining;
  })().finally(() => {
    syncPromise = null;
  });
  return syncPromise;
}
