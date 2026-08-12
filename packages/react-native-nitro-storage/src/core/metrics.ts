import { now } from "../shared";
import type { StorageMetricSummary, StorageMetricsObserver } from "../shared";
import type { StorageScope } from "../Storage.types";

export type MetricsRegistry = {
  setObserver(observer?: StorageMetricsObserver): void;
  record(
    operation: string,
    scope: StorageScope,
    durationMs: number,
    keysCount?: number,
  ): void;
  measure<T>(
    operation: string,
    scope: StorageScope,
    fn: () => T,
    keysCount?: number,
  ): T;
  getSnapshot(): Record<string, StorageMetricSummary>;
  getScopedSnapshot(): Record<string, StorageMetricSummary>;
  reset(): void;
};

export function createMetricsRegistry(): MetricsRegistry {
  let observer: StorageMetricsObserver | undefined;
  const counters = new Map<
    string,
    { count: number; totalDurationMs: number; maxDurationMs: number }
  >();

  function record(
    operation: string,
    scope: StorageScope,
    durationMs: number,
    keysCount = 1,
  ): void {
    const counterKey = `${operation}:${scope}`;
    const existing = counters.get(counterKey);
    if (!existing) {
      counters.set(counterKey, {
        count: 1,
        totalDurationMs: durationMs,
        maxDurationMs: durationMs,
      });
    } else {
      existing.count += 1;
      existing.totalDurationMs += durationMs;
      existing.maxDurationMs = Math.max(existing.maxDurationMs, durationMs);
    }

    observer?.({
      operation,
      scope,
      durationMs,
      keysCount,
    });
  }

  function measure<T>(
    operation: string,
    scope: StorageScope,
    fn: () => T,
    keysCount = 1,
  ): T {
    if (!observer) {
      return fn();
    }
    const start = now();
    try {
      return fn();
    } finally {
      record(operation, scope, now() - start, keysCount);
    }
  }

  function toSummary(value: {
    count: number;
    totalDurationMs: number;
    maxDurationMs: number;
  }): StorageMetricSummary {
    return {
      count: value.count,
      totalDurationMs: value.totalDurationMs,
      avgDurationMs:
        value.count === 0 ? 0 : value.totalDurationMs / value.count,
      maxDurationMs: value.maxDurationMs,
    };
  }

  return {
    setObserver(next) {
      observer = next;
    },
    record,
    measure,
    getSnapshot(): Record<string, StorageMetricSummary> {
      const aggregated = new Map<
        string,
        { count: number; totalDurationMs: number; maxDurationMs: number }
      >();
      counters.forEach((value, key) => {
        const separator = key.lastIndexOf(":");
        const operation = separator === -1 ? key : key.slice(0, separator);
        const existing = aggregated.get(operation);
        if (!existing) {
          aggregated.set(operation, { ...value });
          return;
        }
        existing.count += value.count;
        existing.totalDurationMs += value.totalDurationMs;
        existing.maxDurationMs = Math.max(
          existing.maxDurationMs,
          value.maxDurationMs,
        );
      });
      const snapshot: Record<string, StorageMetricSummary> = {};
      aggregated.forEach((value, operation) => {
        snapshot[operation] = toSummary(value);
      });
      return snapshot;
    },
    getScopedSnapshot(): Record<string, StorageMetricSummary> {
      const snapshot: Record<string, StorageMetricSummary> = {};
      counters.forEach((value, key) => {
        snapshot[key] = toSummary(value);
      });
      return snapshot;
    },
    reset() {
      counters.clear();
    },
  };
}
