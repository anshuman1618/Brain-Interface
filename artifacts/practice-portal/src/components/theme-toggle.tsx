import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/lib/theme";

/**
 * Light/dark toggle.
 *
 * Renders a placeholder until mounted: the resolved theme is only known in the
 * browser, so rendering the icon on the first pass would flash the wrong one and
 * announce the wrong label to a screen reader.
 */
export function ThemeToggle({ className = "" }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const isDark = theme === "dark";

  if (!mounted) {
    return <div className={`h-9 w-9 ${className}`} aria-hidden="true" />;
  }

  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      aria-pressed={isDark}
      className={`h-9 w-9 flex items-center justify-center rounded-lg bg-card shadow-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors ${className}`}
    >
      {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}
