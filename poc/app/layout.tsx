import type { Metadata } from "next";
import "./globals.css";
import NavBar from "@/components/NavBar";
import { ToastProvider } from "@/components/ToastProvider";

export const metadata: Metadata = {
  title: "Master-Service POC",
  description: "Living design document for the central customer config dispatcher",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <ToastProvider>
          <NavBar />
          <main className="mx-auto max-w-7xl px-6 py-6">{children}</main>
        </ToastProvider>
      </body>
    </html>
  );
}
