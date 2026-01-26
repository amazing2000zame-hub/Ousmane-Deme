/**
 * Cost tracking dashboard panel.
 * Shows daily/weekly/monthly LLM usage costs with provider breakdown.
 */

import { useEffect, useState } from 'react';
import { apiCall } from '../../services/api';
import { useAuthStore } from '../../stores/auth';

interface CostSummaryResponse {
  period: string;
  total: number;
  summary: Array<{
    model: string | null;
    totalCost: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    messageCount: number;
  }>;
}

interface BudgetResponse {
  dailyLimit: number;
  spent: number;
  remaining: number;
  percentUsed: number;
  exceeded: boolean;
}

type Period = 'daily' | 'weekly' | 'monthly';

export function CostPanel() {
  const token = useAuthStore((s) => s.token);
  const [period, setPeriod] = useState<Period>('daily');
  const [summary, setSummary] = useState<CostSummaryResponse | null>(null);
  const [budget, setBudget] = useState<BudgetResponse | null>(null);

  useEffect(() => {
    if (!token) return;

    let cancelled = false;

    async function fetchData() {
      try {
        const [s, b] = await Promise.all([
          apiCall<CostSummaryResponse>(`/api/cost/summary?period=${period}`, {}, token ?? undefined),
          apiCall<BudgetResponse>('/api/cost/budget', {}, token ?? undefined),
        ]);
        if (!cancelled) {
          setSummary(s);
          setBudget(b);
        }
      } catch {
        // Non-critical panel, silently ignore errors
      }
    }

    fetchData();
    const interval = setInterval(fetchData, 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [token, period]);

  const claudeData = summary?.summary.find((s) => s.model === 'claude');
  const qwenData = summary?.summary.find((s) => s.model === 'qwen');

  return (
    <div className="p-3 border-b border-jarvis-amber/10">
      {/* Header */}
      <div className="text-[10px] font-display tracking-widest text-jarvis-text-dim mb-3 text-center">
        LLM COST TRACKER
      </div>

      {/* Period selector */}
      <div className="flex gap-1 mb-3">
        {(['daily', 'weekly', 'monthly'] as const).map((p) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={`flex-1 py-1 text-[9px] font-display tracking-wider uppercase border transition-colors ${
              period === p
                ? 'bg-cyan-400/20 border-cyan-400/50 text-cyan-400'
                : 'bg-transparent border-jarvis-amber/10 text-jarvis-text-dim hover:border-jarvis-amber/30'
            }`}
          >
            {p}
          </button>
        ))}
      </div>

      {!summary ? (
        <div className="text-center text-jarvis-text-dim text-[10px] py-4">LOADING...</div>
      ) : (
        <>
          {/* Daily budget bar */}
          {period === 'daily' && budget && (
            <div className="mb-3 p-2 border border-jarvis-amber/10">
              <div className="flex justify-between text-[9px] mb-1">
                <span className="text-jarvis-text-dim">DAILY BUDGET</span>
                <span className={budget.exceeded ? 'text-red-400' : 'text-cyan-400'}>
                  ${budget.spent.toFixed(3)} / ${budget.dailyLimit.toFixed(2)}
                </span>
              </div>
              <div className="h-1 bg-jarvis-bg rounded overflow-hidden">
                <div
                  className="h-full transition-all duration-300"
                  style={{
                    width: `${Math.min(budget.percentUsed, 100)}%`,
                    backgroundColor: budget.exceeded ? '#f87171' : '#22d3ee',
                  }}
                />
              </div>
              {budget.exceeded && (
                <div className="text-[8px] text-red-400 mt-1">
                  BUDGET EXCEEDED - Auto-fallback to Qwen
                </div>
              )}
            </div>
          )}

          {/* Total cost */}
          <div className="text-center mb-3">
            <div className="text-[9px] text-jarvis-text-dim mb-0.5">
              {period.toUpperCase()} TOTAL
            </div>
            <div className="text-lg font-bold" style={{ color: '#D4A574' }}>
              ${(summary.total ?? 0).toFixed(3)}
            </div>
          </div>

          {/* Provider breakdown */}
          <div className="space-y-2">
            {claudeData && (
              <div className="p-2 border" style={{ borderColor: '#D4A57433' }}>
                <div className="flex justify-between text-[9px] mb-0.5">
                  <span style={{ color: '#D4A574' }}>{'\u{1F9E0}'} CLAUDE</span>
                  <span style={{ color: '#D4A574' }}>${claudeData.totalCost.toFixed(3)}</span>
                </div>
                <div className="text-[8px] text-jarvis-text-dim">
                  {claudeData.messageCount} msgs
                  {' \u2022 '}
                  {(claudeData.totalInputTokens / 1000).toFixed(1)}K in
                  {' \u2022 '}
                  {(claudeData.totalOutputTokens / 1000).toFixed(1)}K out
                </div>
              </div>
            )}
            {qwenData && (
              <div className="p-2 border" style={{ borderColor: '#00D9FF33' }}>
                <div className="flex justify-between text-[9px] mb-0.5">
                  <span className="text-cyan-400">{'\u26A1'} QWEN LOCAL</span>
                  <span className="text-cyan-400">FREE</span>
                </div>
                <div className="text-[8px] text-jarvis-text-dim">
                  {qwenData.messageCount} msgs
                  {' \u2022 '}
                  {(qwenData.totalOutputTokens / 1000).toFixed(1)}K tokens
                </div>
              </div>
            )}
          </div>

          {/* Savings estimate */}
          {claudeData && qwenData && (
            <div className="mt-3 p-2 border border-jarvis-amber/10 bg-jarvis-bg/50">
              <div className="text-[8px] text-jarvis-text-dim mb-0.5">
                ROUTING SAVINGS vs CLAUDE-ONLY
              </div>
              <div className="text-sm font-bold text-green-400">
                {(() => {
                  const total = claudeData.messageCount + qwenData.messageCount;
                  return total > 0
                    ? `${((qwenData.messageCount / total) * 100).toFixed(0)}%`
                    : '0%';
                })()}
              </div>
              <div className="text-[7px] text-jarvis-text-dim">
                {qwenData.messageCount} of {claudeData.messageCount + qwenData.messageCount} messages routed to local Qwen
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
