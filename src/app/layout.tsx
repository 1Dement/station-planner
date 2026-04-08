import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Station Planner 3D",
  description: "3D Space Planning from LiDAR Scans",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ro" className="h-full">
      <body className="h-full">{children}</body>
    </html>
  );
}
