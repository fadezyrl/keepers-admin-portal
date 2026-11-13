"use client";

import {
  keepPreviousData,
  useQuery,
  useQueryClient,
  type QueryKey,
} from "@tanstack/react-query";
import { useCallback } from "react";
import { ApiError } from "./api";
import { stale } from "./queryKeys";

function toMessage(err: unknown) {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return "Something went wrong";
}

type SetDataAction<T> = T | null | ((prev: T | null) => T | null);

/**
 * TanStack Query wrapper with the previous useAsync shape so modules
 * show cached data immediately and refresh in the background.
 */
export function useAdminQuery<T>(
  queryKey: QueryKey,
  loader: (signal: AbortSignal) => Promise<T>,
  options?: {
    staleTime?: number;
    enabled?: boolean;
    gcTime?: number;
  },
) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => loader(signal),
    staleTime: options?.staleTime ?? stale.list,
    gcTime: options?.gcTime,
    enabled: options?.enabled ?? true,
    placeholderData: keepPreviousData,
  });

  const setData = useCallback(
    (action: SetDataAction<T>) => {
      queryClient.setQueryData<T | null>(queryKey, (prev) => {
        const current = (prev ?? null) as T | null;
        return typeof action === "function"
          ? (action as (p: T | null) => T | null)(current)
          : action;
      });
    },
    [queryClient, queryKey],
  );

  const reload = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey });
    await query.refetch();
  }, [queryClient, queryKey, query]);

  const hasData = query.data !== undefined;
  const loading = query.isPending && !hasData;
  const refreshing = query.isFetching && hasData;

  return {
    data: (query.data ?? null) as T | null,
    error: query.error ? toMessage(query.error) : null,
    loading,
    refreshing,
    reload,
    setData,
    queryClient,
  };
}
