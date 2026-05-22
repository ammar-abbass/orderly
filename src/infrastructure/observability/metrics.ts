import { logger } from './logger.js';

/**
 * Lightweight metrics collector.
 *
 * In production, replace MetricsCollector with an OpenTelemetry MeterProvider
 * exporting to Prometheus or an OTLP endpoint. The interface is identical so
 * the swap is a one-line change in the composition root.
 *
 * Metric names follow the SPEC §12.2 table.
 */
class MetricsCollector {
  private readonly counters = new Map<string, number>();
  private readonly histograms = new Map<string, number[]>();

  increment(name: string, labels: Record<string, string> = {}): void {
    const key = this.labeledKey(name, labels);
    this.counters.set(key, (this.counters.get(key) ?? 0) + 1);
    logger.debug({ metric: name, labels, value: this.counters.get(key) }, 'counter.increment');
  }

  recordHistogram(name: string, valueMs: number, labels: Record<string, string> = {}): void {
    const key = this.labeledKey(name, labels);
    const values = this.histograms.get(key) ?? [];
    values.push(valueMs);
    this.histograms.set(key, values);
  }

  getCounter(name: string, labels: Record<string, string> = {}): number {
    return this.counters.get(this.labeledKey(name, labels)) ?? 0;
  }

  getHistogramPercentile(name: string, p: number, labels: Record<string, string> = {}): number {
    const values = this.histograms.get(this.labeledKey(name, labels)) ?? [];
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const idx = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, idx)] ?? 0;
  }

  private labeledKey(name: string, labels: Record<string, string>): string {
    return Object.keys(labels).length
      ? `${name}{${Object.entries(labels)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => `${k}="${v}"`)
          .join(',')}}`
      : name;
  }
}

export const metrics = new MetricsCollector();
