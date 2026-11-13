"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "./api";

function toMessage(err: unknown) {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return "Something went wrong";
}

export function useAsync<T>(
  loader: (signal: AbortSignal) => Promise<T>,
  deps: unknown[] = [],
  options?: { keepPreviousData?: boolean },
) {
  const keepPreviousData = options?.keepPreviousData ?? true;
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const requestId = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const dataRef = useRef<T | null>(null);

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  const reload = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const id = ++requestId.current;
    const hasData = dataRef.current !== null;

    setError(null);
    if (keepPreviousData && hasData) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      const result = await loader(controller.signal);
      if (id !== requestId.current) return;
      setData(result);
      setError(null);
    } catch (err) {
      if (controller.signal.aborted) return;
      if (id !== requestId.current) return;
      setError(toMessage(err));
      if (!keepPreviousData) setData(null);
    } finally {
      if (id === requestId.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    void reload();
    return () => {
      abortRef.current?.abort();
    };
  }, [reload]);

  return { data, error, loading, refreshing, reload, setData };
}
