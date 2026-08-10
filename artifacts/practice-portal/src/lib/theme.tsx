import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes";
import type { ReactNode } from "react";

/**
 * Theme provider — Tailwind's `class` strategy, light as the strict default.
 *
 * `enableSystem={false}` is the important part: without it, a viewer whose OS is
 * set to dark gets a dark portal on first load, which is not what "light by
 * default" means. The OS preference is ignored entirely; dark is opt-in through
 * the toggle and remembered per browser.
 *
 * The class lands on <html>, which is also `:root` — so the `.dark` token block
 * in index.css overrides the light one by source order, and `color-scheme`
 * flips with it so the browser's own chrome (scrollbars, date pickers, native
 * selects) matches rather than staying light on a dark page.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="light"
      enableSystem={false}
      disableTransitionOnChange
      storageKey="portal:theme"
    >
      {children}
    </NextThemesProvider>
  );
}

export { useTheme };
