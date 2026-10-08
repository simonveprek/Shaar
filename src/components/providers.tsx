"use client";

import type { ReactNode } from "react";
import { brand, theme } from "@/app.config";
import { FragmsTheme } from "@/components/fragms/theme";
import { ThemeProvider, Toaster } from "@/components/ui";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      {/* Every Fragms component takes its accent and glow from here. They follow theme in src/app.config.ts. */}
      <FragmsTheme theme={{ accent: brand.accent, glow: brand.glow, roundness: theme?.radius ?? 1, pace: 1 }}>
        {children}
      </FragmsTheme>
      <Toaster />
    </ThemeProvider>
  );
}
