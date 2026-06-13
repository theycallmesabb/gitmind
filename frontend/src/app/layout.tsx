import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GitMind AI - GitHub Repository Assistant",
  description: "Retrieve, index, and chat with any GitHub Repository using AI-powered RAG.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full dark">
      <body className="min-h-full flex flex-col antialiased">
        {children}
      </body>
    </html>
  );
}
