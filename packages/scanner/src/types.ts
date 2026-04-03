export type Severity = 'critical' | 'high' | 'medium' | 'low';

export interface Finding {
  id: string;
  severity: Severity;
  title: string;
  file: string;
  line?: number;
  snippet?: string;
  description: string;
  fix: string;
}

export interface ScanSummary {
  critical: number;
  high: number;
  medium: number;
  low: number;
}

export interface ScanMeta {
  filesScanned: number;
  timeMs: number;
}

export interface ScanResult {
  score: number;
  summary: ScanSummary;
  findings: Finding[];
  meta: ScanMeta;
}

export interface SecretPattern {
  name: string;
  pattern: RegExp;
  severity: Severity;
  id: string;
  description: string;
  fix: string;
  context?: string;
}
