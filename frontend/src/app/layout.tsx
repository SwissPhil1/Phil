import type { Metadata } from "next";
import { Sidebar } from "@/components/sidebar";
import "./globals.css";

export const metadata: Metadata = {
  title: "RadioRevise - FMH2 Radiology Study App",
  description:
    "Study app for Swiss FMH2 radiology specialty exam with spaced repetition, QCM, and active recall",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fr">
      <body className="font-sans antialiased">
        <Sidebar />
        <main className="md:ml-64 min-h-screen">
          <div className="p-6 md:p-8 pt-16 md:pt-8 max-w-5xl">{children}</div>
        </main>
      </body>
    </html>
  );
}
