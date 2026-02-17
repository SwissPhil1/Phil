import type { Metadata } from "next";
import "./globals.css";
import { Sidebar } from "@/components/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ErrorBoundary } from "@/components/error-boundary";

export const metadata: Metadata = {
  title: "SmartFlow - Copy Trading Intelligence",
  description:
    "Track and copy-trade Congressional stock trades (STOCK Act disclosures). Built for European investors.",
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
              <div className="p-6 max-w-[1600px] mx-auto">
                <ErrorBoundary>{children}</ErrorBoundary>
              </div>
            </main>
          </div>
        </TooltipProvider>
      </body>
    </html>
  );
}
