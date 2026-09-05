import { createContext, useContext, useEffect } from "react";

/**
 * The registration side of the notice strip, kept apart from the component.
 *
 * Split from `components/notice-strip.tsx` for a mundane reason with a real
 * consequence: a module that exports both a component and a hook defeats React
 * Fast Refresh, so every edit to the strip would reload the whole app instead
 * of hot-swapping it. The eslint rule that says so is right.
 */

export type NoticeContext = {
  register: (id: string) => void;
  deregister: (id: string) => void;
};

export const NoticeSlotContext = createContext<NoticeContext | null>(null);

/**
 * Registers a notice with the surrounding strip. Returns whether to render.
 *
 * Outside a strip it simply returns `applies`, so a notice dropped onto a page
 * on its own still works — the strip is a presentation choice, not a
 * dependency.
 */
export function useNoticeSlot(id: string, applies: boolean): boolean {
  const ctx = useContext(NoticeSlotContext);

  useEffect(() => {
    if (!ctx) return;
    if (applies) {
      ctx.register(id);
      return () => ctx.deregister(id);
    }
    ctx.deregister(id);
    return;
  }, [ctx, id, applies]);

  return applies;
}
