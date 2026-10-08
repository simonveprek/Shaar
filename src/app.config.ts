import type { AppTheme, Glow } from "@/components/ui/tokens";

/*
 * The look, from Fragms Personal. Make a theme on the Fragms Personal site
 * under Theme, pick a colour or a preset, and paste it over the line below.
 * It sets every colour for light and dark, the corners, and the accent and
 * glow the Fragms components use. Null keeps the Fragms defaults.
 */
export const theme: AppTheme | null = null;

/** The accent and glow the Fragms components (Point, Composer, Aura and the rest) read. */
// Read as the wider type, or TypeScript sees only the null above.
const picked = theme as AppTheme | null;
export const brand: { accent?: string; glow?: Glow } = {
  accent: picked?.accent ?? "#3d7bff",
  glow: picked?.glow,
};
