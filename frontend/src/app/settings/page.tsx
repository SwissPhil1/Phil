"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Settings, Server, Database, Clock } from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "https://phil-production.up.railway.app";

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-muted-foreground text-sm mt-1">
          System configuration and data source status
        </p>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Server className="w-4 h-4" />
            API Connection
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm">Backend URL</span>
            <code className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded">{API_URL}</code>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm">Status</span>
            <Badge variant="outline" className="bg-green-500/10 text-green-400 border-green-500/20">Connected</Badge>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="w-4 h-4" />
            Data Ingestion Schedule
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {[
              { name: "Congressional Trades", interval: "Every 60 min", source: "House Clerk + Senate EFD" },
              { name: "Hedge Fund 13F", interval: "Every 6 hours", source: "SEC EDGAR" },
              { name: "Insider Trades (Form 4)", interval: "Every 2 hours", source: "SEC RSS" },
              { name: "Polymarket", interval: "Every 30 min", source: "Polymarket API" },
              { name: "Kalshi", interval: "Every 1 hour", source: "Kalshi API" },
              { name: "Committee Assignments", interval: "Every 24 hours", source: "Congress API" },
              { name: "Trump & Inner Circle", interval: "On startup", source: "SEC EDGAR + FEC" },
            ].map((source) => (
              <div key={source.name} className="flex items-center justify-between py-2 border-b border-border/30 last:border-0">
                <div>
                  <div className="text-sm font-medium">{source.name}</div>
                  <div className="text-xs text-muted-foreground">{source.source}</div>
                </div>
                <span className="text-xs font-mono-data text-muted-foreground">{source.interval}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Database className="w-4 h-4" />
            API Endpoints
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
            {[
              "/api/v1/trades", "/api/v1/politicians", "/api/v1/signals",
              "/api/v1/hedge-funds", "/api/v1/insiders", "/api/v1/trump",
              "/api/v1/prediction-markets", "/api/v1/leaderboard",
              "/api/v1/optimizer", "/api/v1/autopilot",
            ].map((ep) => (
              <code key={ep} className="text-xs text-muted-foreground bg-muted px-2 py-1.5 rounded block">
                {ep}
              </code>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
