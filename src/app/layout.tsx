import type { Metadata } from "next";
import { Poppins } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const poppins = Poppins({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-poppins',
})

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
        className={`${poppins.className} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
