import type { Metadata } from "next";
import "./globals.css";
import { Sidebar } from "@/components/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";

export const metadata: Metadata = {
  title: "SmartFlow - Copy the Smartest Money",
  description:
    "Track insider trades from politicians, hedge funds, corporate insiders, prediction markets, and Trump's inner circle. Built for European investors.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="font-sans antialiased">
        <TooltipProvider>
          <div className="flex h-screen overflow-hidden">
            <Sidebar />
            <main className="flex-1 overflow-y-auto">
              <div className="p-6 max-w-[1600px] mx-auto">{children}</div>
            </main>
          </div>
        </TooltipProvider>
      </body>
    </html>
  );
}
