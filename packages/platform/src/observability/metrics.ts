export class PrometheusRegistry {
  private readonly counters = new Map<string, { help: string; values: Map<string, number> }>();
  private readonly gauges = new Map<string, { help: string; values: Map<string, number> }>();
  private readonly histograms = new Map<
    string,
    { help: string; buckets: number[]; values: Map<string, { count: number; sum: number; bucketCounts: number[] }> }
  >();

  public registerCounter(name: string, help: string): void {
    if (!this.counters.has(name)) {
      this.counters.set(name, { help, values: new Map() });
    }
  }

  public registerGauge(name: string, help: string): void {
    if (!this.gauges.has(name)) {
      this.gauges.set(name, { help, values: new Map() });
    }
  }

  public registerHistogram(name: string, help: string, buckets: number[] = [0.05, 0.1, 0.25, 0.5, 1.0, 2.0, 3.0, 5.0]): void {
    if (!this.histograms.has(name)) {
      this.histograms.set(name, { help, buckets: [...buckets].sort((a, b) => a - b), values: new Map() });
    }
  }

  public incrementCounter(name: string, labels: Record<string, string> = {}, value = 1): void {
    const counter = this.counters.get(name);
    if (!counter) return;
    const labelKey = this.formatLabels(labels);
    const curr = counter.values.get(labelKey) ?? 0;
    counter.values.set(labelKey, curr + value);
  }

  public setGauge(name: string, labels: Record<string, string> = {}, value: number): void {
    const gauge = this.gauges.get(name);
    if (!gauge) return;
    const labelKey = this.formatLabels(labels);
    gauge.values.set(labelKey, value);
  }

  public observeHistogram(name: string, labels: Record<string, string> = {}, value: number): void {
    const hist = this.histograms.get(name);
    if (!hist) return;
    const labelKey = this.formatLabels(labels);
    let entry = hist.values.get(labelKey);
    if (!entry) {
      entry = {
        count: 0,
        sum: 0,
        bucketCounts: new Array(hist.buckets.length).fill(0),
      };
      hist.values.set(labelKey, entry);
    }

    entry.count += 1;
    entry.sum += value;

    for (let i = 0; i < hist.buckets.length; i++) {
      if (value <= hist.buckets[i]!) {
        entry.bucketCounts[i] += 1;
      }
    }
  }

  public toPrometheusFormat(): string {
    const lines: string[] = [];

    // Export Counters
    for (const [name, counter] of this.counters) {
      lines.push(`# HELP ${name} ${counter.help}`);
      lines.push(`# TYPE ${name} counter`);
      for (const [labels, val] of counter.values) {
        lines.push(`${name}${labels ? `{${labels}}` : ''} ${val}`);
      }
    }

    // Export Gauges
    for (const [name, gauge] of this.gauges) {
      lines.push(`# HELP ${name} ${gauge.help}`);
      lines.push(`# TYPE ${name} gauge`);
      for (const [labels, val] of gauge.values) {
        lines.push(`${name}${labels ? `{${labels}}` : ''} ${val}`);
      }
    }

    // Export Histograms
    for (const [name, hist] of this.histograms) {
      lines.push(`# HELP ${name} ${hist.help}`);
      lines.push(`# TYPE ${name} histogram`);
      for (const [labelStr, data] of hist.values) {
        const prefix = labelStr ? `${labelStr},` : '';
        for (let i = 0; i < hist.buckets.length; i++) {
          lines.push(`${name}_bucket{${prefix}le="${hist.buckets[i]}"} ${data.bucketCounts[i]}`);
        }
        lines.push(`${name}_bucket{${prefix}le="+Inf"} ${data.count}`);
        lines.push(`${name}_sum${labelStr ? `{${labelStr}}` : ''} ${data.sum.toFixed(4)}`);
        lines.push(`${name}_count${labelStr ? `{${labelStr}}` : ''} ${data.count}`);
      }
    }

    return lines.join('\n') + '\n';
  }

  private formatLabels(labels: Record<string, string>): string {
    const keys = Object.keys(labels).sort();
    if (keys.length === 0) return '';
    return keys.map((k) => `${k}="${labels[k]}"`).join(',');
  }
}

// Global default registry instance initialized with production SLO metrics
export const defaultMetrics = new PrometheusRegistry();

defaultMetrics.registerCounter('vca_turns_total', 'Total conversational turns processed');
defaultMetrics.registerCounter('vca_tool_calls_total', 'Total backend tool invocations');
defaultMetrics.registerCounter('vca_errors_total', 'Total system errors and exceptions');
defaultMetrics.registerGauge('vca_active_sessions', 'Number of active customer sessions');
defaultMetrics.registerHistogram('vca_turn_duration_seconds', 'Turn end-to-end latency in seconds', [
  0.05, 0.1, 0.25, 0.5, 1.0, 1.5, 2.0, 3.0, 5.0,
]);
defaultMetrics.registerHistogram('vca_llm_duration_seconds', 'LLM generation latency in seconds', [
  0.1, 0.25, 0.5, 1.0, 2.0,
]);
