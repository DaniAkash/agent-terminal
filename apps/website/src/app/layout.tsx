import type { Metadata } from "next";
import { Geist, JetBrains_Mono } from "next/font/google";
import Nav from "@/components/site/Nav";
import StatusStrip from "@/components/site/StatusStrip";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Agent Terminal, a terminal for AI coding agents on macOS",
  description:
    "Group tabs by project. See what your agents are actually doing. Answer permission prompts from your phone. macOS terminal for Claude Code, Codex, and OpenCode. Free and open source.",
  metadataBase: new URL("https://agent-terminal.dev"),
  openGraph: {
    title: "Agent Terminal",
    description:
      "A terminal that reads what your agents are doing. macOS + mobile companion. Free and open source.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Agent Terminal",
    description:
      "A terminal that reads what your agents are doing. macOS + mobile companion.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${jetbrainsMono.variable} antialiased`}
    >
      <body className="min-h-[100dvh] bg-bg text-text-primary">
        <StatusStrip />
        <Nav />
        {children}
      </body>
    </html>
  );
}
