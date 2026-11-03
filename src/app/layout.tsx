import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Foundry System-One · Microsoft-Decision-1 vs gpt-6.1-terra Playground",
  description:
    "Real-time WebSocket showcase comparing Microsoft-Decision-1 (/providers/microsoft/v1/systemone) and gpt-6.1-terra on Azure AI Foundry with Entra ID authentication.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
