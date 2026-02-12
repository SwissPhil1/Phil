"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import {
  Server,
  Database,
  Clock,
  CheckCircle,
  XCircle,
  Download,
  Bell,
  Palette,
  Shield,
  RefreshCw,
} from "lucide-react";

const SETTINGS_KEY = "smartflow_settings";

interface UserSettings {
  refreshInterval: number;
  defaultDays: number;
  alertPoliticians: string;
  alertTickers: string;
  alertMinAmount: string;
  theme: "dark" | "system";
}

const DEFAULT_SETTINGS: UserSettings = {
  refreshInterval: 60,
  defaultDays: 90,
  alertPoliticians: "",
  alertTickers: "",
  alertMinAmount: "",
  theme: "dark",
};

function loadSettings(): UserSettings {
  try {
    const stored = localStorage.getItem(SETTINGS_KEY);
    if (stored) return { ...DEFAULT_SETTINGS, ...JSON.parse(stored) };
  } catch {
    // ignore
  }
  return DEFAULT_SETTINGS;
}

function saveSettings(settings: UserSettings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // ignore
  }
}

export default function SettingsPage() {
  const [apiStatus, setApiStatus] = useState<"checking" | "connected" | "error">("checking");
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [saved, setSaved] = useState(false);
  const [exporting, setExporting] = useState<string | null>(null);

  useEffect(() => {
    setSettings(loadSettings());
    async function check() {
      try {
        await api.getStats();
        setApiStatus("connected");
      } catch {
        setApiStatus("error");
      }
    }
    check();
  }, []);

  const updateSetting = useCallback(<K extends keyof UserSettings>(key: K, value: UserSettings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  }, []);

  const handleSave = () => {
    saveSettings(settings);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleExport = async (type: "trades" | "insiders" | "hedge-funds") => {
    setExporting(type);
    try {
      const url = `/api/v1/export/${type}/csv?days=${settings.defaultDays}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `smartflow_${type}_${settings.defaultDays}d.csv`;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch {
      alert("Export failed. Please try again.");
    } finally {
      setExporting(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Settings</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Configure your SmartFlow experience
          </p>
        </div>
        <Button onClick={handleSave} disabled={saved}>
          {saved ? (
            <>
              <CheckCircle className="w-4 h-4 mr-1" /> Saved
            </>
          ) : (
            "Save Settings"
          )}
        </Button>
      </div>

      <Tabs defaultValue="general" className="w-full">
        <TabsList>
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="alerts">Alert Config</TabsTrigger>
          <TabsTrigger value="export">Data Export</TabsTrigger>
          <TabsTrigger value="status">System Status</TabsTrigger>
        </TabsList>

        {/* General Tab */}
        <TabsContent value="general">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <RefreshCw className="w-4 h-4" />
                  Auto-Refresh Interval
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  How often data refreshes automatically (in seconds)
                </p>
                <div className="flex gap-2">
                  {[30, 60, 120, 300].map((s) => (
                    <Button
                      key={s}
                      variant={settings.refreshInterval === s ? "default" : "outline"}
                      size="sm"
                      onClick={() => updateSetting("refreshInterval", s)}
                    >
                      {s < 60 ? `${s}s` : `${s / 60}m`}
                    </Button>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Clock className="w-4 h-4" />
                  Default Lookback Period
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  Default number of days to show in trade views
                </p>
                <div className="flex gap-2">
                  {[30, 90, 180, 365].map((d) => (
                    <Button
                      key={d}
                      variant={settings.defaultDays === d ? "default" : "outline"}
                      size="sm"
                      onClick={() => updateSetting("defaultDays", d)}
                    >
                      {d}d
                    </Button>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Palette className="w-4 h-4" />
                  Theme
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex gap-2">
                  {[
                    { label: "Dark", value: "dark" as const },
                    { label: "System", value: "system" as const },
                  ].map((opt) => (
                    <Button
                      key={opt.value}
                      variant={settings.theme === opt.value ? "default" : "outline"}
                      size="sm"
                      onClick={() => updateSetting("theme", opt.value)}
                    >
                      {opt.label}
                    </Button>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Shield className="w-4 h-4" />
                  Data Storage
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  Settings and watchlist are stored locally in your browser. No account required.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (confirm("Clear all local data (watchlist, settings)?")) {
                      localStorage.clear();
                      window.location.reload();
                    }
                  }}
                >
                  Clear Local Data
                </Button>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Alert Config Tab */}
        <TabsContent value="alerts">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Bell className="w-4 h-4" />
                Alert Configuration
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-xs text-muted-foreground">
                Configure which trades generate alerts on the Alerts page. Leave blank for all trades.
              </p>

              <div className="space-y-3">
                <div>
                  <label className="text-sm font-medium">Watch Politicians</label>
                  <p className="text-xs text-muted-foreground mb-1">
                    Comma-separated names (e.g., &quot;Nancy Pelosi, Tommy Tuberville&quot;)
                  </p>
                  <input
                    type="text"
                    value={settings.alertPoliticians}
                    onChange={(e) => updateSetting("alertPoliticians", e.target.value)}
                    placeholder="All politicians"
                    className="w-full h-9 px-3 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>

                <div>
                  <label className="text-sm font-medium">Watch Tickers</label>
                  <p className="text-xs text-muted-foreground mb-1">
                    Comma-separated tickers (e.g., &quot;AAPL, MSFT, NVDA&quot;)
                  </p>
                  <input
                    type="text"
                    value={settings.alertTickers}
                    onChange={(e) => updateSetting("alertTickers", e.target.value)}
                    placeholder="All tickers"
                    className="w-full h-9 px-3 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>

                <div>
                  <label className="text-sm font-medium">Minimum Trade Amount ($)</label>
                  <p className="text-xs text-muted-foreground mb-1">
                    Only alert on trades above this dollar amount
                  </p>
                  <input
                    type="number"
                    value={settings.alertMinAmount}
                    onChange={(e) => updateSetting("alertMinAmount", e.target.value)}
                    placeholder="No minimum"
                    className="w-40 h-9 px-3 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Data Export Tab */}
        <TabsContent value="export">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Download className="w-4 h-4" />
                Export Data
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-xs text-muted-foreground">
                Download trade data as CSV files for your own analysis. Exports use your configured lookback period ({settings.defaultDays} days).
              </p>

              <div className="space-y-3">
                {[
                  { type: "trades" as const, label: "Congressional Trades", desc: "STOCK Act filings from House & Senate" },
                  { type: "insiders" as const, label: "Corporate Insider Trades", desc: "SEC Form 4 filings" },
                  { type: "hedge-funds" as const, label: "Hedge Fund Holdings", desc: "13F quarterly filings" },
                ].map((exp) => (
                  <div key={exp.type} className="flex items-center justify-between p-3 border border-border/40 rounded-lg">
                    <div>
                      <div className="text-sm font-medium">{exp.label}</div>
                      <div className="text-xs text-muted-foreground">{exp.desc}</div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleExport(exp.type)}
                      disabled={exporting === exp.type}
                    >
                      <Download className="w-3 h-3 mr-1" />
                      {exporting === exp.type ? "Exporting..." : "CSV"}
                    </Button>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* System Status Tab */}
        <TabsContent value="status">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Server className="w-4 h-4" />
                  API Connection
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm">Backend</span>
                  <code className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded">
                    Railway (proxied via Next.js)
                  </code>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm">Status</span>
                  {apiStatus === "checking" ? (
                    <Badge variant="outline" className="text-yellow-400 border-yellow-500/20">
                      Checking...
                    </Badge>
                  ) : apiStatus === "connected" ? (
                    <Badge
                      variant="outline"
                      className="bg-green-500/10 text-green-400 border-green-500/20 gap-1"
                    >
                      <CheckCircle className="w-3 h-3" /> Connected
                    </Badge>
                  ) : (
                    <Badge
                      variant="outline"
                      className="bg-red-500/10 text-red-400 border-red-500/20 gap-1"
                    >
                      <XCircle className="w-3 h-3" /> Error
                    </Badge>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Clock className="w-4 h-4" />
                  Data Sources & Refresh Rates
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-1">
                  {[
                    { name: "Congressional Trades", source: "House Clerk + Senate EFD", freq: "60 min" },
                    { name: "Hedge Fund 13F", source: "SEC EDGAR", freq: "6 hours" },
                    { name: "Corporate Insiders", source: "SEC Form 4 RSS", freq: "2 hours" },
                    { name: "Polymarket", source: "Polymarket API", freq: "30 min" },
                    { name: "Kalshi Markets", source: "Kalshi API", freq: "1 hour" },
                    { name: "Committee Data", source: "Congress.gov", freq: "24 hours" },
                    { name: "Trump & Inner Circle", source: "SEC + FEC", freq: "On startup" },
                    { name: "Price Updates", source: "Yahoo Finance", freq: "15 min" },
                  ].map((source) => (
                    <div
                      key={source.name}
                      className="flex items-center justify-between py-2 border-b border-border/30 last:border-0"
                    >
                      <div>
                        <div className="text-sm font-medium">{source.name}</div>
                        <div className="text-xs text-muted-foreground">{source.source}</div>
                      </div>
                      <Badge variant="outline" className="text-[10px] bg-green-500/10 text-green-400 border-green-500/20">
                        {source.freq}
                      </Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card className="md:col-span-2">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Database className="w-4 h-4" />
                  About SmartFlow
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground space-y-2">
                <p>
                  SmartFlow aggregates publicly available financial disclosure data from multiple
                  sources to help you track what the &quot;smart money&quot; is doing.
                </p>
                <p>
                  Data includes congressional STOCK Act filings, SEC 13F hedge fund filings,
                  Form 4 corporate insider trades, prediction market whales, and Trump
                  administration financial disclosures.
                </p>
                <p className="text-xs">
                  v0.5.0 | Built with Next.js, FastAPI, and PostgreSQL. Deployed on Railway.
                </p>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
