import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const imageUrl = `${protocol}://${host}/og.png`;

  return {
    title: "Filokreto | Cost & Margin Monitor",
    description:
      "Cost allocation and margin monitoring for Filokreto's Australian floor-placement operations.",
    openGraph: {
      title: "Filokreto | Cost & Margin Monitor",
      description: "Australian floor-placement cost allocation and margin intelligence.",
      type: "website",
      images: [{ url: imageUrl, width: 1200, height: 630, alt: "Filokreto Cost & Margin Monitor" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "Filokreto | Cost & Margin Monitor",
      description: "Australian floor-placement cost allocation and margin intelligence.",
      images: [imageUrl],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
