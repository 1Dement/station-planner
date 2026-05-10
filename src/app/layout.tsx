import type { Metadata } from "next";
import Script from "next/script";
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
      <body className="h-full">
        <Script
          type="module"
          src="https://ajax.googleapis.com/ajax/libs/model-viewer/4.2.0/model-viewer.min.js"
          strategy="afterInteractive"
        />
        {children}
      </body>
    </html>
  );
}
