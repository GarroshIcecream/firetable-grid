import { gridTheme } from "./theme";

export const HUES = [
  "red",
  "orange",
  "yellow",
  "green",
  "teal",
  "cyan",
  "blue",
  "indigo",
  "violet",
  "purple",
  "fuchsia",
  "rose",
  "coral",
  "gray",
] as const;

export type Hue = (typeof HUES)[number];

export const LEVELS = ["light", "medium", "dark"] as const;
export type Level = (typeof LEVELS)[number];

type Shade = 5 | 10 | 20 | 30 | 40 | 50 | 60 | 70 | 80 | 90 | 100;

export interface PaletteColor {
  readonly hue: Hue;
  readonly level: Level;
}

export interface PaletteSwatch {
  readonly shade: Shade;
  readonly bg: string;
  readonly text: string;
  readonly inlineText: string;
  /** Border at the same shade as `bg`. Written out longhand like every other
   *  class here: Tailwind scans for literals and prunes built specifiers. */
  readonly border: string;
}

export const DEFAULT_PALETTE: Record<Hue, Record<Level, PaletteSwatch>> = {
  red: {
    light: {
      shade: 10,
      bg: "bg-red-10",
      border: "border-red-10",
      text: "text-red-80",
      inlineText: "text-red-60",
    },
    medium: {
      shade: 30,
      bg: "bg-red-30",
      border: "border-red-30",
      text: "text-red-90",
      inlineText: "text-red-70",
    },
    dark: {
      shade: 60,
      bg: "bg-red-60",
      border: "border-red-60",
      text: "text-white",
      inlineText: "text-red-80",
    },
  },
  orange: {
    light: {
      shade: 10,
      bg: "bg-orange-10",
      border: "border-orange-10",
      text: "text-orange-80",
      inlineText: "text-orange-60",
    },
    medium: {
      shade: 30,
      bg: "bg-orange-30",
      border: "border-orange-30",
      text: "text-orange-100",
      inlineText: "text-orange-70",
    },
    dark: {
      shade: 50,
      bg: "bg-orange-50",
      border: "border-orange-50",
      text: "text-orange-100",
      inlineText: "text-orange-80",
    },
  },
  yellow: {
    light: {
      shade: 10,
      bg: "bg-yellow-10",
      border: "border-yellow-10",
      text: "text-yellow-80",
      inlineText: "text-yellow-70",
    },
    medium: {
      shade: 30,
      bg: "bg-yellow-30",
      border: "border-yellow-30",
      text: "text-yellow-100",
      inlineText: "text-yellow-80",
    },
    dark: {
      shade: 50,
      bg: "bg-yellow-50",
      border: "border-yellow-50",
      text: "text-yellow-100",
      inlineText: "text-yellow-90",
    },
  },
  green: {
    light: {
      shade: 10,
      bg: "bg-green-10",
      border: "border-green-10",
      text: "text-green-80",
      inlineText: "text-green-60",
    },
    medium: {
      shade: 30,
      bg: "bg-green-30",
      border: "border-green-30",
      text: "text-green-90",
      inlineText: "text-green-70",
    },
    dark: {
      shade: 60,
      bg: "bg-green-60",
      border: "border-green-60",
      text: "text-white",
      inlineText: "text-green-80",
    },
  },
  teal: {
    light: {
      shade: 10,
      bg: "bg-teal-10",
      border: "border-teal-10",
      text: "text-teal-80",
      inlineText: "text-teal-60",
    },
    medium: {
      shade: 30,
      bg: "bg-teal-30",
      border: "border-teal-30",
      text: "text-teal-90",
      inlineText: "text-teal-70",
    },
    dark: {
      shade: 60,
      bg: "bg-teal-60",
      border: "border-teal-60",
      text: "text-white",
      inlineText: "text-teal-80",
    },
  },
  cyan: {
    light: {
      shade: 10,
      bg: "bg-cyan-10",
      border: "border-cyan-10",
      text: "text-cyan-80",
      inlineText: "text-cyan-60",
    },
    medium: {
      shade: 30,
      bg: "bg-cyan-30",
      border: "border-cyan-30",
      text: "text-cyan-90",
      inlineText: "text-cyan-70",
    },
    dark: {
      shade: 60,
      bg: "bg-cyan-60",
      border: "border-cyan-60",
      text: "text-white",
      inlineText: "text-cyan-80",
    },
  },
  blue: {
    light: {
      shade: 10,
      bg: "bg-blue-10",
      border: "border-blue-10",
      text: "text-blue-80",
      inlineText: "text-blue-60",
    },
    medium: {
      shade: 30,
      bg: "bg-blue-30",
      border: "border-blue-30",
      text: "text-blue-90",
      inlineText: "text-blue-70",
    },
    dark: {
      shade: 60,
      bg: "bg-blue-60",
      border: "border-blue-60",
      text: "text-white",
      inlineText: "text-blue-80",
    },
  },
  indigo: {
    light: {
      shade: 10,
      bg: "bg-indigo-10",
      border: "border-indigo-10",
      text: "text-indigo-80",
      inlineText: "text-indigo-60",
    },
    medium: {
      shade: 30,
      bg: "bg-indigo-30",
      border: "border-indigo-30",
      text: "text-indigo-90",
      inlineText: "text-indigo-70",
    },
    dark: {
      shade: 60,
      bg: "bg-indigo-60",
      border: "border-indigo-60",
      text: "text-white",
      inlineText: "text-indigo-80",
    },
  },
  violet: {
    light: {
      shade: 10,
      bg: "bg-violet-10",
      border: "border-violet-10",
      text: "text-violet-80",
      inlineText: "text-violet-60",
    },
    medium: {
      shade: 30,
      bg: "bg-violet-30",
      border: "border-violet-30",
      text: "text-violet-90",
      inlineText: "text-violet-70",
    },
    dark: {
      shade: 60,
      bg: "bg-violet-60",
      border: "border-violet-60",
      text: "text-white",
      inlineText: "text-violet-80",
    },
  },
  purple: {
    light: {
      shade: 10,
      bg: "bg-purple-10",
      border: "border-purple-10",
      text: "text-purple-80",
      inlineText: "text-purple-60",
    },
    medium: {
      shade: 30,
      bg: "bg-purple-30",
      border: "border-purple-30",
      text: "text-purple-90",
      inlineText: "text-purple-70",
    },
    dark: {
      shade: 60,
      bg: "bg-purple-60",
      border: "border-purple-60",
      text: "text-white",
      inlineText: "text-purple-80",
    },
  },
  fuchsia: {
    light: {
      shade: 10,
      bg: "bg-fuchsia-10",
      border: "border-fuchsia-10",
      text: "text-fuchsia-80",
      inlineText: "text-fuchsia-60",
    },
    medium: {
      shade: 30,
      bg: "bg-fuchsia-30",
      border: "border-fuchsia-30",
      text: "text-fuchsia-90",
      inlineText: "text-fuchsia-70",
    },
    dark: {
      shade: 60,
      bg: "bg-fuchsia-60",
      border: "border-fuchsia-60",
      text: "text-white",
      inlineText: "text-fuchsia-80",
    },
  },
  rose: {
    light: {
      shade: 10,
      bg: "bg-rose-10",
      border: "border-rose-10",
      text: "text-rose-80",
      inlineText: "text-rose-60",
    },
    medium: {
      shade: 30,
      bg: "bg-rose-30",
      border: "border-rose-30",
      text: "text-rose-90",
      inlineText: "text-rose-70",
    },
    dark: {
      shade: 60,
      bg: "bg-rose-60",
      border: "border-rose-60",
      text: "text-white",
      inlineText: "text-rose-80",
    },
  },
  coral: {
    light: {
      shade: 10,
      bg: "bg-coral-10",
      border: "border-coral-10",
      text: "text-coral-80",
      inlineText: "text-coral-60",
    },
    medium: {
      shade: 30,
      bg: "bg-coral-30",
      border: "border-coral-30",
      text: "text-coral-90",
      inlineText: "text-coral-70",
    },
    dark: {
      shade: 60,
      bg: "bg-coral-60",
      border: "border-coral-60",
      text: "text-white",
      inlineText: "text-coral-80",
    },
  },
  gray: {
    light: {
      shade: 10,
      bg: "bg-gray-10",
      border: "border-gray-10",
      text: "text-gray-80",
      inlineText: "text-gray-60",
    },
    medium: {
      shade: 30,
      bg: "bg-gray-30",
      border: "border-gray-30",
      text: "text-gray-90",
      inlineText: "text-gray-70",
    },
    dark: {
      shade: 60,
      bg: "bg-gray-60",
      border: "border-gray-60",
      text: "text-white",
      inlineText: "text-gray-80",
    },
  },
};

// The outcome vocabulary every status surface reduces to.
//
// `bad` is `red`, not `rose`, because `--color-destructive` is `var(--color-red-50)`
// - one answer for "this is wrong" across shadcn's destructive variants and the
// app's own status surfaces. Rose stays free as a decorative hue (view pills,
// chart series). Before this existed, "bad" was rose on three surfaces and red
// on three others.
export const SEMANTIC_HUE = {
  good: "green",
  warn: "orange",
  bad: "red",
  info: "blue",
} as const satisfies Record<string, Hue>;

const HUE_DOT: Record<Hue, string> = {
  red: "bg-red-50",
  orange: "bg-orange-50",
  yellow: "bg-yellow-50",
  green: "bg-green-50",
  teal: "bg-teal-50",
  cyan: "bg-cyan-50",
  blue: "bg-blue-50",
  indigo: "bg-indigo-50",
  violet: "bg-violet-50",
  purple: "bg-purple-50",
  fuchsia: "bg-fuchsia-50",
  rose: "bg-rose-50",
  coral: "bg-coral-50",
  gray: "bg-gray-50",
};

const HUE_ACTIVE_ROW: Record<Hue, string> = {
  red: "bg-red-5",
  orange: "bg-orange-5",
  yellow: "bg-yellow-5",
  green: "bg-green-5",
  teal: "bg-teal-5",
  cyan: "bg-cyan-5",
  blue: "bg-blue-5",
  indigo: "bg-indigo-5",
  violet: "bg-violet-5",
  purple: "bg-purple-5",
  fuchsia: "bg-fuchsia-5",
  rose: "bg-rose-5",
  coral: "bg-coral-5",
  gray: "bg-gray-5",
};

/** The saturated shade-50 fill used for dots and small status markers. */
export function paletteDotClass(hue: Hue): string {
  return HUE_DOT[hue];
}

export function paletteDotClasses(color: PaletteColor): {
  bgClass: string;
  dotClass: string;
} {
  return {
    bgClass: gridTheme().palette[color.hue].light.bg,
    dotClass: paletteDotClass(color.hue),
  };
}

/** The shade-5 wash - the faintest tint, for an active row or a card backdrop. */
export function paletteWashClass(hue: Hue): string {
  return HUE_ACTIVE_ROW[hue];
}

export function paletteActiveRowClass(color: PaletteColor): string {
  return paletteWashClass(color.hue);
}
