"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  BookOpen,
  Brain,
  Layers,
  Menu,
  X,
  Library,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/chapters", label: "Chapters", icon: BookOpen },
  { href: "/quiz", label: "Quiz", icon: Brain },
  { href: "/flashcards", label: "Flashcards", icon: Layers },
  { href: "/ingest", label: "Sources", icon: Library },
];

export function Sidebar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Mobile toggle */}
      <button
        onClick={() => setOpen(!open)}
        className="fixed top-4 left-4 z-50 md:hidden rounded-lg bg-card p-2 shadow-md border"
      >
        {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>

      {/* Overlay */}
      {open && (
        <div
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed left-0 top-0 z-40 h-full w-64 bg-card border-r transition-transform duration-200 md:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="flex h-16 items-center gap-2 px-6 border-b">
          <Brain className="h-6 w-6 text-primary" />
          <h1 className="text-lg font-bold">RadioRevise</h1>
        </div>

        <nav className="mt-4 px-3 space-y-1">
          {navItems.map((item) => {
            const isActive =
              item.href === "/"
                ? pathname === "/"
                : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="absolute bottom-4 left-0 right-0 px-4">
          <div className="rounded-lg bg-muted p-3 text-xs text-muted-foreground">
            <p className="font-medium text-foreground mb-1">FMH2 Radiology</p>
            <p>Core Radiology + Crack the Core</p>
            <p className="mt-1">Exam: August 2026</p>
          </div>
        </div>
      </aside>
    </>
  );
}
