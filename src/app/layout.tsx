import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { CHUNK_RECOVERY_SCRIPT } from "@/lib/chunk-recovery-script";

export const metadata: Metadata = {
  title: "Ann Ann's Beverages Trading",
  description: "Logistics operations portal for admin, warehouse, driver, and customer workflows.",
  keywords: ["logistics", "delivery", "warehouse", "inventory", "tracking"],
  authors: [{ name: "Ann Ann's Beverages Trading" }],
  icons: {
    icon: "/ann-anns-logo.png",
    shortcut: "/ann-anns-logo.png",
    apple: "/ann-anns-logo.png",
  },
  openGraph: {
    title: "Ann Ann's Beverages Trading",
    description: "Logistics operations portal",
    siteName: "Ann Ann's Beverages Trading",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Ann Ann's Beverages Trading",
    description: "Logistics operations portal",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/*
          Must run before Next's own chunk scripts, and must not itself be a chunk:
          when the initial chunks 404 nothing hydrates, so an error boundary or a
          client component would never get the chance to react. See the module for
          why cross-instance chunk mismatches happen at all.
        */}
        <script dangerouslySetInnerHTML={{ __html: CHUNK_RECOVERY_SCRIPT }} />
      </head>
      <body
        suppressHydrationWarning
        className="antialiased bg-background text-foreground"
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
