"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import { Server, Database, Clock, CheckCircle, XCircle } from "lucide-react";

export default function SettingsPage() {
  const [apiStatus, setApiStatus] = useState<"checking" | "connected" | "error">("checking");

  useEffect(() => {
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-muted-foreground text-sm mt-1">
          System status and data source information
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
            <span className="text-sm">Backend</span>
            <code className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded">Railway (proxied via Next.js)</code>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm">Status</span>
            {apiStatus === "checking" ? (
              <Badge variant="outline" className="text-yellow-400 border-yellow-500/20">Checking...</Badge>
            ) : apiStatus === "connected" ? (
              <Badge variant="outline" className="bg-green-500/10 text-green-400 border-green-500/20 gap-1">
                <CheckCircle className="w-3 h-3" /> Connected
              </Badge>
            ) : (
              <Badge variant="outline" className="bg-red-500/10 text-red-400 border-red-500/20 gap-1">
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
            Data Sources
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-1">
            {[
              { name: "Congressional Trades", source: "House Clerk + Senate EFD", status: "active" },
              { name: "Hedge Fund 13F", source: "SEC EDGAR", status: "active" },
              { name: "Trump & Inner Circle", source: "SEC EDGAR + FEC", status: "active" },
              { name: "Polymarket", source: "Polymarket API", status: "active" },
              { name: "Committee Assignments", source: "Congress API", status: "active" },
              { name: "Corporate Insiders (Form 4)", source: "SEC RSS", status: "pending" },
            ].map((source) => (
              <div key={source.name} className="flex items-center justify-between py-2.5 border-b border-border/30 last:border-0">
                <div>
                  <div className="text-sm font-medium">{source.name}</div>
                  <div className="text-xs text-muted-foreground">{source.source}</div>
                </div>
                {source.status === "active" ? (
                  <Badge variant="outline" className="text-[10px] bg-green-500/10 text-green-400 border-green-500/20">Active</Badge>
                ) : (
                  <Badge variant="outline" className="text-[10px] bg-yellow-500/10 text-yellow-400 border-yellow-500/20">Coming soon</Badge>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Database className="w-4 h-4" />
            About SmartFlow
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>
            SmartFlow aggregates publicly available financial disclosure data from multiple sources to help you track what the &quot;smart money&quot; is doing.
          </p>
          <p>
            Data includes congressional STOCK Act filings, SEC 13F hedge fund filings, Trump administration financial disclosures, and prediction market performance data.
          </p>
          <p className="text-xs">
            Built with Next.js, FastAPI, and SQLite. Deployed on Vercel + Railway.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
