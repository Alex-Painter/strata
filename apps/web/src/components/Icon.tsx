import type { LayerId } from "@strata/core/model";

/** 16 px line icons, 1.5 px stroke. */
const PATHS = {
  data: (
    <>
      <ellipse cx="8" cy="3.75" rx="5" ry="2" />
      <path d="M3 3.75v8.5c0 1.1 2.24 2 5 2s5-.9 5-2v-8.5" />
      <path d="M3 8c0 1.1 2.24 2 5 2s5-.9 5-2" />
    </>
  ),
  service: (
    <>
      <path d="M8 1.75l5.25 3v6.5L8 14.25l-5.25-3v-6.5z" />
      <path d="M2.75 4.75L8 7.75l5.25-3M8 7.75v6.5" />
    </>
  ),
  infra: (
    <>
      <rect x="2.25" y="2.25" width="11.5" height="4.75" rx="1.25" />
      <rect x="2.25" y="9" width="11.5" height="4.75" rx="1.25" />
      <path d="M5 4.625h.5M5 11.375h.5" />
    </>
  ),
  api: <path d="M5.5 3.5L2 8l3.5 4.5M10.5 3.5L14 8l-3.5 4.5" />,
  ui: (
    <>
      <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="1.75" />
      <path d="M1.75 6h12.5" />
    </>
  ),
  tests: (
    <path d="M6 1.75v4.5L2.6 12.9a1 1 0 0 0 .9 1.35h9a1 1 0 0 0 .9-1.35L10 6.25v-4.5M5 1.75h6M4.25 10.25h7.5" />
  ),
  doc: (
    <>
      <path d="M4 1.75h5.25L12.25 4.75v9.5H4z" />
      <path d="M9 1.75v3.25h3.25" />
    </>
  ),
  other: (
    <>
      <rect x="2.25" y="2.25" width="11.5" height="11.5" rx="2" strokeDasharray="2 2" />
    </>
  ),
  review: (
    <>
      <path d="M2 4.25L8 1.75l6 2.5-6 2.5z" />
      <path d="M2 8l6 2.5L14 8" />
      <path d="M2 11.75l6 2.5 6-2.5" />
    </>
  ),
  search: (
    <>
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.5 10.5l3.25 3.25" />
    </>
  ),
  panel: (
    <>
      <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="1.75" />
      <path d="M10 2.75v10.5" />
    </>
  ),
  sliders: (
    <>
      <path d="M2.5 4.5h6M11.5 4.5h2M2.5 11.5h2M7.5 11.5h6" />
      <circle cx="10" cy="4.5" r="1.5" />
      <circle cx="6" cy="11.5" r="1.5" />
    </>
  ),
  chev: <path d="M6 3.5L10.5 8 6 12.5" />,
  chevd: <path d="M3.5 6L8 10.5 12.5 6" />,
  x: <path d="M4 4l8 8M12 4l-8 8" />,
  menu: <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" />,
  info: (
    <>
      <circle cx="8" cy="8" r="6.25" />
      <path d="M8 7.25v4M8 4.9h.01" />
    </>
  ),
  help: (
    <>
      <circle cx="8" cy="8" r="6.25" />
      <path d="M6.25 6.25a1.85 1.85 0 0 1 3.5.75c0 1.25-1.75 1.5-1.75 2.75M8 11.75h.01" />
    </>
  ),
  pr: (
    <>
      <circle cx="4.5" cy="3.75" r="1.75" />
      <circle cx="4.5" cy="12.25" r="1.75" />
      <circle cx="11.5" cy="12.25" r="1.75" />
      <path d="M4.5 5.5v5M11.5 10.5V7a2 2 0 0 0-2-2H7" />
    </>
  ),
  theme: (
    <>
      <circle cx="8" cy="8" r="5.75" />
      <path d="M8 2.25v11.5a5.75 5.75 0 0 0 0-11.5z" fill="currentColor" stroke="none" />
    </>
  ),
  arrow: <path d="M3 8h10M9 4l4 4-4 4" />,
  file: (
    <>
      <path d="M4 1.75h5.25L12.25 4.75v9.5H4z" />
      <path d="M9 1.75v3.25h3.25" />
    </>
  ),
  external: <path d="M9.5 2.75h3.75V6.5M13.25 2.75L7.5 8.5M11.5 9.5v3.75h-8.75V4.5H6.5" />,
  out: <path d="M9.5 3.25H12.75v9.5H9.5M6.5 5L3.5 8l3 3M3.5 8h7" />,
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, className = "i" }: { name: IconName; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}

export const LAYER_ICON: Record<LayerId, IconName> = {
  "data-model": "data",
  api: "api",
  logic: "service",
  ui: "ui",
  tests: "tests",
  config: "infra",
  docs: "doc",
  other: "other",
};

/** The Strata mark: three strata. */
export function Logo() {
  return (
    <span className="logo" aria-hidden="true">
      <svg
        aria-hidden="true"
        viewBox="0 0 16 16"
        width="12"
        height="12"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      >
        <path d="M3 4.5h10M3 8h10M3 11.5h10" />
      </svg>
    </span>
  );
}
