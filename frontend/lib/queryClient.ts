"use client";

import { QueryClient } from "@tanstack/react-query";
import { stale } from "./queryKeys";

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: stale.list,
        gcTime: 15 * 60_000,
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
        retry: 1,
      },
      mutations: {
        retry: 0,
      },
    },
  });
}

let browserClient: QueryClient | null = null;

export function getQueryClient() {
  if (typeof window === "undefined") {
    return createQueryClient();
  }
  if (!browserClient) browserClient = createQueryClient();
  return browserClient;
}

/** Wipe all cached admin data — call on logout / account switch. */
export function clearAdminQueryCache() {
  const client = getQueryClient();
  client.clear();
}
