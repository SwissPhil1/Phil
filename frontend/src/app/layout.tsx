import type { Metadata, Viewport } from "next";
import { Sidebar } from "@/components/sidebar";
import { ServiceWorkerRegister } from "@/components/sw-register";
import { OfflineBanner } from "@/components/offline-banner";
import "./globals.css";

export const metadata: Metadata = {
  title: "RadioRevise - FMH2 Radiology Study App",
  description:
    "Study app for Swiss FMH2 radiology specialty exam with spaced repetition, QCM, and active recall",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "RadioRevise",
  },
};

export const viewport: Viewport = {
  themeColor: "#2563eb",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fr">
      <head>
        <link rel="apple-touch-icon" href="/icon.svg" />
      </head>
      <body className="font-sans antialiased">
        <ServiceWorkerRegister />
        <OfflineBanner />
        <Sidebar />
        <main className="md:ml-64 min-h-screen">
          <div className="p-6 md:p-8 pt-16 md:pt-8 max-w-5xl">{children}</div>
        </main>
      </body>
    </html>
  );
}
