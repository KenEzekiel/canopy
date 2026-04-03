import { Finding, ScanSummary } from './types';

const SEVERITY_PENALTIES: Record<string, number> = {
  critical: 20,
  high: 10,
  medium: 5,
  low: 2,
};

export function calculateScore(findings: Finding[]): { score: number; summary: ScanSummary } {
  const summary: ScanSummary = { critical: 0, high: 0, medium: 0, low: 0 };
  let score = 100;

  for (const f of findings) {
    summary[f.severity]++;
    score -= SEVERITY_PENALTIES[f.severity] || 0;
  }

  return { score: Math.max(0, score), summary };
}
