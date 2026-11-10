import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "emma-mcp · Cloud Launchpad",
  description: "Describe compute once. Compare live multi-cloud capacity through emma. Approve a precise plan and launch it.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
