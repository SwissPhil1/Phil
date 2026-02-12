"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api, type OptimizerResult, type TestWeightsResult } from "@/lib/api";
import { Brain, Play, CheckCircle, XCircle, TrendingUp, Clock, Zap, BarChart3, Info, Sliders, RotateCcw, FlaskConical, Upload, Shield } from "lucide-react";

export default function OptimizerPage() {
  const [result, setResult] = useState<OptimizerResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [available, setAvailable] = useState<boolean | null>(null);

  // Custom formula builder
  const WEIGHT_FACTORS = [
    { key: "position_size_max", label: "Position Size", default: 25, max: 40, desc: "Bigger trade = more conviction" },
    { key: "committee_overlap_max", label: "Committee Overlap", default: 30, max: 50, desc: "Politician's committee oversees stock's sector" },
    { key: "disclosure_speed_max", label: "Disclosure Speed", default: 15, max: 30, desc: "Late disclosure = trying to hide the trade" },
    { key: "cluster_max", label: "Political Cluster", default: 20, max: 35, desc: "Multiple politicians buying the same stock" },
    { key: "cross_source_insider_max", label: "Insider Confirmation", default: 15, max: 30, desc: "Corporate insiders also buying" },
    { key: "cross_source_fund_max", label: "Hedge Fund Confirmation", default: 10, max: 25, desc: "Top hedge funds also hold position" },
    { key: "track_record_max", label: "Track Record", default: 15, max: 30, desc: "Politician's historical win rate & avg return" },
    { key: "contrarian_max", label: "Contrarian Signal", default: 10, max: 25, desc: "Buying while others are selling" },
    { key: "small_cap_committee_max", label: "Small-Cap Committee", default: 15, max: 30, desc: "Small/mid-cap + committee overlap (very suspicious)" },
  ] as const;

  const defaultWeights = Object.fromEntries(WEIGHT_FACTORS.map(f => [f.key, f.default]));
  const [customWeights, setCustomWeights] = useState<Record<string, number>>(defaultWeights);
  const [testResult, setTestResult] = useState<TestWeightsResult | null>(null);
  const [testLoading, setTestLoading] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);
  const [applyLoading, setApplyLoading] = useState(false);
  const [appliedStatus, setAppliedStatus] = useState<string | null>(null);
  const [weightsSource, setWeightsSource] = useState<string | null>(null);

  const totalPoints = Object.values(customWeights).reduce((a, b) => a + b, 0);
  const defaultTotal = WEIGHT_FACTORS.reduce((a, f) => a + f.default, 0);

  function resetWeights() {
    setCustomWeights({ ...defaultWeights });
    setTestResult(null);
    setTestError(null);
  }

  async function testFormula() {
    setTestLoading(true);
    setTestError(null);
    try {
      const params: Record<string, string> = {};
      for (const [k, v] of Object.entries(customWeights)) {
        params[k] = String(v);
      }
      const data = await api.testCustomWeights(params);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((data as any)?.error) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        throw new Error((data as any).error as string);
      }
      setTestResult(data);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Test failed";
      setTestError(msg);
    } finally {
      setTestLoading(false);
    }
  }

  useEffect(() => {
    async function checkStatus() {
      try {
        const status = await api.getOptimizerStatus();
        setAvailable(true);
        if (status.has_applied_weights) {
          setWeightsSource("optimizer");
        } else {
          setWeightsSource("defaults");
        }
      } catch {
        setAvailable(false);
      }
    }
    checkStatus();
  }, []);

  async function applyBestWeights() {
    if (!result?.best_robust_formula?.weights) return;
    setApplyLoading(true);
    setAppliedStatus(null);
    try {
      await api.applyWeights(result.best_robust_formula.weights);
      setAppliedStatus("applied");
      setWeightsSource("optimizer");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Apply failed";
      setAppliedStatus(`error: ${msg}`);
    } finally {
      setApplyLoading(false);
    }
  }

  async function applyCustomWeights() {
    setApplyLoading(true);
    setAppliedStatus(null);
    try {
      await api.applyWeights(customWeights);
      setAppliedStatus("applied");
      setWeightsSource("optimizer");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Apply failed";
      setAppliedStatus(`error: ${msg}`);
    } finally {
      setApplyLoading(false);
    }
  }

  async function runOptimizer() {
    setLoading(true);
    setError(null);
    try {
      const data = await api.runOptimizer({
        lookback_days: "730",
        max_trades: "500",
        generations: "3",
        top_n: "10",
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (!data?.data_summary || !data?.top_formulas) {
        throw new Error((data as any)?.error || "Optimizer returned incomplete data — not enough trades with price data yet. Try again after more prices have been fetched.");
      }
      setResult(data);
      if (data.applied) {
        setAppliedStatus("auto-applied");
        setWeightsSource("optimizer");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Optimizer failed";
      if (msg.includes("404")) {
        setError("Optimizer endpoint not available on the current backend deployment. A backend redeployment is needed to enable this feature.");
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">Conviction Score Optimizer</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Automatically test thousands of weight combinations against historical PnL data.
            Finds formulas that best predict profitable trades, then validates on out-of-sample data.
          </p>
        </div>
        <Button
          onClick={runOptimizer}
          disabled={loading}
          className="gap-2"
          size="lg"
        >
          {loading ? (
            <>
              <Clock className="w-4 h-4 animate-spin" />
              Running...
            </>
          ) : (
            <>
              <Play className="w-4 h-4" />
              Run Optimizer
            </>
          )}
        </Button>
      </div>

      {/* Active weights status */}
      {weightsSource && (
        <div className={`flex items-center gap-3 p-3 rounded-lg ${weightsSource === "optimizer" ? "bg-green-500/5 border border-green-500/10" : "bg-muted/30 border border-border/50"}`}>
          <Shield className={`w-4 h-4 shrink-0 ${weightsSource === "optimizer" ? "text-green-400" : "text-muted-foreground"}`} />
          <div className="text-sm">
            <span className="font-medium">{weightsSource === "optimizer" ? "Optimizer weights active" : "Default weights active"}</span>
            <span className="text-muted-foreground ml-2">
              {weightsSource === "optimizer"
                ? "Scoring uses optimizer-determined weights"
                : "Run the optimizer to find better weights for your data"}
            </span>
          </div>
        </div>
      )}

      {/* Availability warning */}
      {available === false && (
        <div className="flex items-start gap-3 p-4 rounded-lg bg-yellow-500/5 border border-yellow-500/10">
          <Info className="w-4 h-4 text-yellow-400 mt-0.5 shrink-0" />
          <div className="text-sm text-muted-foreground">
            <span className="text-foreground font-medium">Backend update needed:</span>{" "}
            The optimizer module exists in the codebase but is not yet deployed to the backend server. A Railway redeployment will enable this feature.
          </div>
        </div>
      )}

      {/* How it works */}
      {!result && !loading && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Brain className="w-4 h-4" />
              How the Optimizer Works
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="p-4 rounded-lg bg-muted/30 space-y-2">
                <div className="text-foreground font-medium">1. Data Collection</div>
                <p>Pulls all historical trades with actual returns (30d, 90d, 180d forward + exit-based PnL)</p>
              </div>
              <div className="p-4 rounded-lg bg-muted/30 space-y-2">
                <div className="text-foreground font-medium">2. Weight Search</div>
                <p>Tests 700+ weight combinations using grid search + evolutionary optimization over 3 generations</p>
              </div>
              <div className="p-4 rounded-lg bg-muted/30 space-y-2">
                <div className="text-foreground font-medium">3. Validation</div>
                <p>Cross-validates top formulas on out-of-sample data to prevent overfitting. Only recommends robust formulas.</p>
              </div>
            </div>
            <p className="text-xs">
              Factors optimized: position size, committee overlap, disclosure speed, political cluster, cross-source confirmation, track record, contrarian signal, small-cap committee bonus, mega-cap discount
            </p>
          </CardContent>
        </Card>
      )}

      {/* Custom Formula Builder */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Sliders className="w-4 h-4" />
              Custom Formula Builder
            </CardTitle>
            <div className="flex items-center gap-3">
              <div className="text-sm font-mono-data">
                <span className="text-muted-foreground">Points: </span>
                <span className={totalPoints > defaultTotal * 1.3 ? "text-yellow-400" : totalPoints < defaultTotal * 0.7 ? "text-red-400" : "text-foreground"}>
                  {totalPoints}
                </span>
                <span className="text-muted-foreground"> / {defaultTotal} default</span>
              </div>
              <Button variant="ghost" size="sm" onClick={resetWeights} className="gap-1 h-7 text-xs">
                <RotateCcw className="w-3 h-3" />
                Reset
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Distribute points across factors, then test your formula against historical trades. Higher points = that factor matters more in the conviction score.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3">
            {WEIGHT_FACTORS.map((factor) => (
              <div key={factor.key} className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium">{factor.label}</label>
                  <span className="font-mono-data text-sm w-8 text-right">{customWeights[factor.key]}</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={factor.max}
                  step={1}
                  value={customWeights[factor.key]}
                  onChange={(e) => setCustomWeights(prev => ({ ...prev, [factor.key]: Number(e.target.value) }))}
                  className="w-full h-1.5 bg-muted rounded-full appearance-none cursor-pointer accent-primary"
                />
                <div className="flex justify-between text-[10px] text-muted-foreground">
                  <span>{factor.desc}</span>
                  <span>0–{factor.max}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-3 pt-2">
            <Button onClick={testFormula} disabled={testLoading} className="gap-2">
              {testLoading ? (
                <>
                  <Clock className="w-4 h-4 animate-spin" />
                  Testing...
                </>
              ) : (
                <>
                  <FlaskConical className="w-4 h-4" />
                  Test My Formula
                </>
              )}
            </Button>
            <span className="text-xs text-muted-foreground">Tests against ~300 historical trades with actual returns</span>
            {testResult && testResult.cross_validation.is_robust && (
              <Button
                onClick={applyCustomWeights}
                disabled={applyLoading}
                variant="outline"
                size="sm"
                className="gap-2"
              >
                <Upload className="w-3 h-3" />
                Apply to Scoring
              </Button>
            )}
          </div>

          {testError && (
            <div className="flex items-center gap-2 text-destructive text-sm">
              <XCircle className="w-4 h-4" />
              {testError}
            </div>
          )}

          {testResult && (
            <div className="border border-border rounded-lg p-4 space-y-4 mt-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium">Your Formula Results</h3>
                <span className="text-xs text-muted-foreground">{testResult.trades_analyzed} trades analyzed</span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <div className="text-xs text-muted-foreground">Fitness</div>
                  <div className="text-lg font-bold font-mono-data">{testResult.result.fitness.toFixed(4)}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Correlation (90d)</div>
                  <div className="text-lg font-bold font-mono-data">{testResult.result.correlation_90d.toFixed(4)}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Hit Rate (90d)</div>
                  <div className="text-lg font-bold font-mono-data">{testResult.result.hit_rate_90d.toFixed(1)}%</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Edge (90d)</div>
                  <div className={`text-lg font-bold font-mono-data ${testResult.result.edge_90d >= 0 ? "text-green-400" : "text-red-400"}`}>
                    {testResult.result.edge_90d >= 0 ? "+" : ""}{testResult.result.edge_90d.toFixed(2)}%
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <div className="text-xs text-muted-foreground">Hit Rate (30d)</div>
                  <div className="font-mono-data">{testResult.result.hit_rate_30d.toFixed(1)}%</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Edge (30d)</div>
                  <div className={`font-mono-data ${testResult.result.edge_30d >= 0 ? "text-green-400" : "text-red-400"}`}>
                    {testResult.result.edge_30d >= 0 ? "+" : ""}{testResult.result.edge_30d.toFixed(2)}%
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">High Score Avg (90d)</div>
                  <div className={`font-mono-data ${testResult.result.high_score_avg_return_90d >= 0 ? "text-green-400" : "text-red-400"}`}>
                    {testResult.result.high_score_avg_return_90d >= 0 ? "+" : ""}{testResult.result.high_score_avg_return_90d.toFixed(2)}%
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Low Score Avg (90d)</div>
                  <div className={`font-mono-data ${testResult.result.low_score_avg_return_90d >= 0 ? "text-green-400" : "text-red-400"}`}>
                    {testResult.result.low_score_avg_return_90d >= 0 ? "+" : ""}{testResult.result.low_score_avg_return_90d.toFixed(2)}%
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-4 pt-1 border-t border-border/50 text-sm">
                <div className="flex items-center gap-2">
                  {testResult.cross_validation.is_robust ? (
                    <CheckCircle className="w-4 h-4 text-green-400" />
                  ) : (
                    <XCircle className="w-4 h-4 text-yellow-400" />
                  )}
                  <span>{testResult.cross_validation.is_robust ? "Cross-validation: Robust" : "Cross-validation: Not robust (may overfit)"}</span>
                </div>
                <span className="text-muted-foreground">Overfit ratio: {testResult.cross_validation.avg_overfit_ratio.toFixed(2)}</span>
                <span className="text-muted-foreground">Trades: {testResult.result.n_high_score} high / {testResult.result.n_low_score} low</span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Loading state */}
      {loading && (
        <div className="space-y-4">
          <Card>
            <CardContent className="p-6 space-y-4">
              <div className="flex items-center gap-3">
                <Brain className="w-5 h-5 text-primary animate-pulse" />
                <div>
                  <div className="font-medium">Optimizer is running...</div>
                  <div className="text-sm text-muted-foreground">
                    Testing weight combinations, evolving best performers, cross-validating. This may take 1-5 minutes.
                  </div>
                </div>
              </div>
              <div className="space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {error && (
        <Card className="border-destructive/50">
          <CardContent className="p-4 flex items-center gap-2 text-destructive">
            <XCircle className="w-4 h-4" />
            <span className="text-sm">{error}</span>
          </CardContent>
        </Card>
      )}

      {/* Results */}
      {result && (
        <div className="space-y-4">
          {/* Summary */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="p-4">
                <div className="text-sm text-muted-foreground">Trades Analyzed</div>
                <div className="text-2xl font-bold font-mono-data">{result.data_summary.trades_with_returns}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="text-sm text-muted-foreground">Configs Tested</div>
                <div className="text-2xl font-bold font-mono-data">{result.optimization_params.total_configs_tested}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="text-sm text-muted-foreground">Time Elapsed</div>
                <div className="text-2xl font-bold font-mono-data">{result.optimization_params.elapsed_seconds}s</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="text-sm text-muted-foreground">Improvement</div>
                <div className={`text-2xl font-bold font-mono-data ${result.recommendation.improvement_pct > 0 ? "text-green-400" : "text-muted-foreground"}`}>
                  {result.recommendation.improvement_pct > 0 ? "+" : ""}{result.recommendation.improvement_pct}%
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Recommendation */}
          <Card className={result.recommendation.use_new_formula ? "border-green-500/30" : "border-border"}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                {result.recommendation.use_new_formula ? (
                  <CheckCircle className="w-4 h-4 text-green-400" />
                ) : (
                  <Zap className="w-4 h-4 text-yellow-400" />
                )}
                Recommendation
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm">{result.recommendation.detail}</p>

              {result.applied ? (
                <div className="flex items-center gap-2 text-sm text-green-400">
                  <CheckCircle className="w-4 h-4" />
                  Optimized weights auto-applied to live scoring
                </div>
              ) : result.best_robust_formula && (
                <div className="flex items-center gap-3">
                  <Button
                    onClick={applyBestWeights}
                    disabled={applyLoading || appliedStatus === "applied"}
                    variant={appliedStatus === "applied" ? "outline" : "default"}
                    size="sm"
                    className="gap-2"
                  >
                    {applyLoading ? (
                      <Clock className="w-3 h-3 animate-spin" />
                    ) : appliedStatus === "applied" ? (
                      <CheckCircle className="w-3 h-3 text-green-400" />
                    ) : (
                      <Upload className="w-3 h-3" />
                    )}
                    {appliedStatus === "applied" ? "Weights Applied" : "Apply Best Weights to Scoring"}
                  </Button>
                  {appliedStatus?.startsWith("error") && (
                    <span className="text-xs text-red-400">{appliedStatus}</span>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Generation History */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <TrendingUp className="w-4 h-4" />
                Evolution Progress
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-end gap-4 h-32">
                {(result.generation_history || []).map((gen) => {
                  const maxFitness = Math.max(...(result.generation_history || []).map(g => g.best_fitness));
                  const height = maxFitness > 0 ? (gen.best_fitness / maxFitness) * 100 : 0;
                  return (
                    <div key={gen.generation} className="flex-1 flex flex-col items-center gap-1">
                      <span className="text-xs font-mono-data text-muted-foreground">
                        {gen.best_fitness.toFixed(3)}
                      </span>
                      <div
                        className="w-full bg-primary/60 rounded-t"
                        style={{ height: `${Math.max(height, 5)}%` }}
                      />
                      <span className="text-xs text-muted-foreground">Gen {gen.generation}</span>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Current vs Best */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground">Current Formula (Production)</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-sm">Fitness</span>
                    <span className="font-mono-data">{result.current_formula.fitness.toFixed(4)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm">Correlation (90d)</span>
                    <span className="font-mono-data">{result.current_formula.correlation_90d.toFixed(4)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm">Hit Rate (90d)</span>
                    <span className="font-mono-data">{result.current_formula.hit_rate_90d.toFixed(1)}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm">Edge (90d)</span>
                    <span className={`font-mono-data ${result.current_formula.edge_90d >= 0 ? "text-green-400" : "text-red-400"}`}>
                      {result.current_formula.edge_90d >= 0 ? "+" : ""}{result.current_formula.edge_90d.toFixed(2)}%
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {result.best_robust_formula && (
              <Card className="border-green-500/20">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-green-400">Best Robust Formula (Optimized)</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-sm">Fitness</span>
                      <span className="font-mono-data">{result.best_robust_formula.fitness.toFixed(4)}</span>
                    </div>
                    {result.top_formulas[0] && (
                      <>
                        <div className="flex justify-between">
                          <span className="text-sm">Correlation (90d)</span>
                          <span className="font-mono-data">{result.top_formulas[0].correlation_90d.toFixed(4)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-sm">Hit Rate (90d)</span>
                          <span className="font-mono-data">{result.top_formulas[0].hit_rate_90d.toFixed(1)}%</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-sm">Edge (90d)</span>
                          <span className={`font-mono-data ${result.top_formulas[0].edge_90d >= 0 ? "text-green-400" : "text-red-400"}`}>
                            {result.top_formulas[0].edge_90d >= 0 ? "+" : ""}{result.top_formulas[0].edge_90d.toFixed(2)}%
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-sm">Cross-Validated</span>
                          <span className={result.top_formulas[0].cross_validation.is_robust ? "text-green-400" : "text-yellow-400"}>
                            {result.top_formulas[0].cross_validation.is_robust ? "Robust" : "Needs more data"}
                          </span>
                        </div>
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Top Formulas Table */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <BarChart3 className="w-4 h-4" />
                Top {result.top_formulas.length} Formulas
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-xs text-muted-foreground">
                      <th className="text-left py-2 pr-3">#</th>
                      <th className="text-right py-2 px-3">Fitness</th>
                      <th className="text-right py-2 px-3">Corr 30d</th>
                      <th className="text-right py-2 px-3">Corr 90d</th>
                      <th className="text-right py-2 px-3">Hit 30d</th>
                      <th className="text-right py-2 px-3">Hit 90d</th>
                      <th className="text-right py-2 px-3">Edge 90d</th>
                      <th className="text-right py-2 px-3">Robust</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.top_formulas.map((formula) => (
                      <tr key={formula.rank} className="border-b border-border/30 hover:bg-muted/30">
                        <td className="py-2 pr-3 font-medium">{formula.rank}</td>
                        <td className="text-right py-2 px-3 font-mono-data">{formula.fitness.toFixed(4)}</td>
                        <td className="text-right py-2 px-3 font-mono-data">{formula.correlation_30d.toFixed(3)}</td>
                        <td className="text-right py-2 px-3 font-mono-data">{formula.correlation_90d.toFixed(3)}</td>
                        <td className="text-right py-2 px-3 font-mono-data">{formula.hit_rate_30d.toFixed(0)}%</td>
                        <td className="text-right py-2 px-3 font-mono-data">{formula.hit_rate_90d.toFixed(0)}%</td>
                        <td className={`text-right py-2 px-3 font-mono-data ${formula.edge_90d >= 0 ? "text-green-400" : "text-red-400"}`}>
                          {formula.edge_90d >= 0 ? "+" : ""}{formula.edge_90d.toFixed(1)}%
                        </td>
                        <td className="text-right py-2 px-3">
                          {formula.cross_validation.is_robust ? (
                            <CheckCircle className="w-4 h-4 text-green-400 inline" />
                          ) : (
                            <XCircle className="w-4 h-4 text-muted-foreground inline" />
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Weight Comparison */}
          {result.best_robust_formula && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Weight Comparison: Current vs Optimized</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {Object.entries(result.best_robust_formula.weights).map(([key, optimized]) => {
                    const current = result.current_formula.weights[key];
                    if (current === undefined) return null;
                    const diff = Number(optimized) - Number(current);
                    return (
                      <div key={key} className="flex items-center justify-between py-1">
                        <span className="text-sm">{key.replace(/_/g, " ")}</span>
                        <div className="flex items-center gap-3 font-mono-data text-sm">
                          <span className="text-muted-foreground">{Number(current).toFixed(1)}</span>
                          <span className="text-muted-foreground">→</span>
                          <span className={diff > 0 ? "text-green-400" : diff < 0 ? "text-red-400" : ""}>
                            {Number(optimized).toFixed(1)}
                          </span>
                          {diff !== 0 && (
                            <span className={`text-xs ${diff > 0 ? "text-green-400" : "text-red-400"}`}>
                              ({diff > 0 ? "+" : ""}{diff.toFixed(1)})
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
