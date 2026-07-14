import type { Metadata } from "next";
import { Outfit } from "next/font/google";
import "./globals.css";

const outfit = Outfit({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: "Netchat - Modern Temporary Anonymous Chat",
  description: "Instant anonymous global communication with E2EE and in-memory security.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full">
      <body className={`${outfit.className} min-h-full flex flex-col antialiased`}>
        {children}
      </body>
    </html>
  );
}
