import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./game.css";

export const metadata: Metadata = {
  title: "EM27 · Engineering Manager",
  description: "A Championship Manager–style game about being an engineering manager. Parody; not affiliated with any company named.",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/app-icon.svg", apple: "/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "EM27", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#13015e",
};

// Set the theme before first paint: saved choice, else the OS preference.
const themeScript = `try{var t=localStorage.getItem("em27.theme");if(t!=="light"&&t!=="dark")t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";document.documentElement.dataset.theme=t}catch(e){document.documentElement.dataset.theme="light"}`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
