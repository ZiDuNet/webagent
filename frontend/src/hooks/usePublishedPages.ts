import { useCallback, useEffect, useRef, useState } from "react";
import {
  apiErrorMessage,
  pagePilotClient,
  type PagePilotClient,
  type Publication,
} from "../api/pagepilot";

export interface UsePublishedPagesOptions {
  client?: PagePilotClient;
  enabled?: boolean;
  query?: string;
  sessionId?: string;
  limit?: number;
}

export function usePublishedPages({
  client = pagePilotClient,
  enabled = true,
  query = "",
  sessionId,
  limit = 50,
}: UsePublishedPagesOptions = {}) {
  const [items, setItems] = useState<Publication[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const generationRef = useRef(0);
  const nextRequestRef = useRef<AbortController | null>(null);
  const loadingMoreRef = useRef(false);

  useEffect(() => {
    const generation = ++generationRef.current;
    nextRequestRef.current?.abort();
    loadingMoreRef.current = false;
    setLoadingMore(false);
    if (!enabled) {
      setItems([]);
      setTotal(0);
      setLoading(false);
      setError(null);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    client.list({ q: query, sessionId, limit, offset: 0 }, controller.signal)
      .then((result) => {
        if (generationRef.current !== generation) return;
        setItems(result.items);
        setTotal(result.total);
      })
      .catch((failure: unknown) => {
        if (controller.signal.aborted || generationRef.current !== generation) return;
        setItems([]);
        setTotal(0);
        setError(apiErrorMessage(failure));
      })
      .finally(() => {
        if (generationRef.current === generation && !controller.signal.aborted) {
          setLoading(false);
        }
      });
    return () => {
      controller.abort();
      nextRequestRef.current?.abort();
    };
  }, [client, enabled, query, sessionId, limit, revision]);

  const refresh = useCallback(() => setRevision((value) => value + 1), []);

  const loadMore = useCallback(async () => {
    if (!enabled || loading || loadingMoreRef.current || items.length >= total) return;
    const generation = generationRef.current;
    const controller = new AbortController();
    nextRequestRef.current = controller;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    setError(null);
    try {
      const result = await client.list(
        { q: query, sessionId, limit, offset: items.length },
        controller.signal,
      );
      if (generationRef.current !== generation || controller.signal.aborted) return;
      setItems((previous) => {
        const existing = new Set(previous.map((item) => item.id));
        return [...previous, ...result.items.filter((item) => !existing.has(item.id))];
      });
      setTotal(result.total);
    } catch (failure) {
      if (!controller.signal.aborted && generationRef.current === generation) {
        setError(apiErrorMessage(failure));
      }
    } finally {
      if (generationRef.current === generation) {
        loadingMoreRef.current = false;
        setLoadingMore(false);
      }
    }
  }, [client, enabled, loading, items.length, total, query, sessionId, limit]);

  return { items, total, loading, loadingMore, error, refresh, loadMore };
}
