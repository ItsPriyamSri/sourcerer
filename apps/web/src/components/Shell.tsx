import type { ReactNode } from "react";

/**
 * The page container.
 *
 * `pb-28` reserves room for the bottom nav plus the home-indicator safe area, so the
 * primary action is never trapped under the browser chrome on a phone.
 */
export function Shell({ children }: { children: ReactNode }) {
  return <main className="mx-auto w-full max-w-xl px-4 pb-28 pt-4">{children}</main>;
}
