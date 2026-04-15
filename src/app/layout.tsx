import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

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
      <body
        className="antialiased bg-background text-foreground"
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
