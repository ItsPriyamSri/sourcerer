import type { SVGProps } from "react";

/**
 * Line icons, hand-rolled.
 *
 * No icon font and no CDN: the app must render its full interface offline, so the
 * icons ship in the bundle as SVG paths. Stroke-based, 24-unit grid, currentColor.
 */

type P = SVGProps<SVGSVGElement>;

function Base({ children, ...p }: P & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...p}
    >
      {children}
    </svg>
  );
}

export const IconCamera = (p: P) => (
  <Base {...p}>
    <path d="M3 8.5A2.5 2.5 0 0 1 5.5 6h1.7l1.2-1.8h7.2L16.8 6h1.7A2.5 2.5 0 0 1 21 8.5v8A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5z" />
    <circle cx="12" cy="12.5" r="3.2" />
  </Base>
);

export const IconTag = (p: P) => (
  <Base {...p}>
    <path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0l-7.2-7.2A2 2 0 0 1 2.8 12V4.8A2 2 0 0 1 4.8 2.8H12a2 2 0 0 1 1.4.6l7.2 7.2a2 2 0 0 1 0 2.8Z" />
    <circle cx="7.6" cy="7.6" r="1.2" />
  </Base>
);

export const IconEye = (p: P) => (
  <Base {...p}>
    <path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z" />
    <circle cx="12" cy="12" r="2.8" />
  </Base>
);

export const IconBolt = (p: P) => (
  <Base {...p}>
    <path d="M13 2 4.5 13.5H11l-1 8.5L19.5 10H13z" />
  </Base>
);

export const IconSignalOff = (p: P) => (
  <Base {...p}>
    <path d="M3 4l18 16" />
    <path d="M5 12.5a10 10 0 0 1 3-1.9M19 12.5a10 10 0 0 0-5.4-2.8" />
    <path d="M8.5 16a5 5 0 0 1 2.2-1.2M15.5 16a5 5 0 0 0-1.4-.8" />
    <path d="M12 19.5h.01" />
  </Base>
);

export const IconCheck = (p: P) => (
  <Base {...p}>
    <path d="m4.5 12.5 5 5 10-11" />
  </Base>
);

export const IconX = (p: P) => (
  <Base {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Base>
);

export const IconMinus = (p: P) => (
  <Base {...p}>
    <path d="M5 12h14" />
  </Base>
);

export const IconWarn = (p: P) => (
  <Base {...p}>
    <path d="M12 3.5 21.5 20h-19z" />
    <path d="M12 10v4.5M12 17.6h.01" />
  </Base>
);

export const IconChevron = (p: P) => (
  <Base {...p}>
    <path d="m9 5 7 7-7 7" />
  </Base>
);

export const IconPlus = (p: P) => (
  <Base {...p}>
    <path d="M12 5v14M5 12h14" />
  </Base>
);

export const IconCopy = (p: P) => (
  <Base {...p}>
    <rect x="9" y="9" width="12" height="12" rx="2.5" />
    <path d="M6.5 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1.5" />
  </Base>
);

export const IconShare = (p: P) => (
  <Base {...p}>
    <path d="M12 15V3.5M8.5 7 12 3.5 15.5 7" />
    <path d="M5 13v5.5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V13" />
  </Base>
);

export const IconTrash = (p: P) => (
  <Base {...p}>
    <path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13" />
  </Base>
);

export const IconChart = (p: P) => (
  <Base {...p}>
    <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
  </Base>
);

export const IconList = (p: P) => (
  <Base {...p}>
    <path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" />
  </Base>
);

export const IconMic = (p: P) => (
  <Base {...p}>
    <rect x="9" y="2.5" width="6" height="11" rx="3" />
    <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3.5M8.5 21.5h7" />
  </Base>
);

export const IconSun = (p: P) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19" />
  </Base>
);

export const IconMoon = (p: P) => (
  <Base {...p}>
    <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />
  </Base>
);

export const IconGear = (p: P) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2 2 2 0 1 1-4 0 1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 15a2 2 0 1 1 0-4 1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 10 4.1a2 2 0 1 1 4 0 1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.7 1.7 0 0 0 21 11a2 2 0 1 1 0 4Z" />
  </Base>
);

export const IconSparkle = (p: P) => (
  <Base {...p}>
    <path d="M12 3l1.6 4.9L18.5 9.5l-4.9 1.6L12 16l-1.6-4.9L5.5 9.5l4.9-1.6z" />
    <path d="M18.5 16.5l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z" />
  </Base>
);

export const IconShield = (p: P) => (
  <Base {...p}>
    <path d="M12 2.8 20 6v6c0 5-3.4 8.2-8 9.2C7.4 20.2 4 17 4 12V6z" />
    <path d="m8.8 12 2.2 2.2 4.2-4.4" />
  </Base>
);

export const IconCloud = (p: P) => (
  <Base {...p}>
    <path d="M7 18.5h9.5a4 4 0 0 0 .4-8 6 6 0 0 0-11.6 1.4A3.6 3.6 0 0 0 7 18.5Z" />
  </Base>
);

export const IconDevice = (p: P) => (
  <Base {...p}>
    <rect x="3" y="4" width="18" height="12.5" rx="2" />
    <path d="M8 20h8M12 16.5V20" />
  </Base>
);

export const IconRefresh = (p: P) => (
  <Base {...p}>
    <path d="M20 11.5A8 8 0 0 0 6.3 6.3L4 8.5" />
    <path d="M4 4.5v4h4" />
    <path d="M4 12.5a8 8 0 0 0 13.7 5.2l2.3-2.2" />
    <path d="M20 19.5v-4h-4" />
  </Base>
);

export const IconSearch = (p: P) => (
  <Base {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4.5 4.5" />
  </Base>
);

export const IconTrend = (p: P) => (
  <Base {...p}>
    <path d="M3 17l5-5 3.5 3.5L21 6" />
    <path d="M15.5 6H21v5.5" />
  </Base>
);
