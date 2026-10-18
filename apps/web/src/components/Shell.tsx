import type { ReactNode } from "react";

/**
 * One container width, shared by the top bar, the content and the bottom nav.
 *
 * The chrome and the content used to each hard-code `max-w-xl`, which meant they could
 * only ever agree by luck. Naming the width in one place means the desktop composition
 * (where the verdict splits into a decision column and a rail) widens the header and the
 * nav with it, instead of leaving them behind as a narrow ribbon over a wide page.
 */
export const PAGE = "mx-auto w-full max-w-xl px-4 lg:max-w-5xl";

/**
 * The page container.
 *
 * `pb-28` reserves room for the bottom nav plus the home-indicator safe area, so the
 * primary action is never trapped under the browser chrome on a phone.
 */
export function Shell({ children }: { children: ReactNode }) {
  return <main className={`${PAGE} pb-28 pt-4`}>{children}</main>;
}
