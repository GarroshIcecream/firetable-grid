import {
  DEFAULT_PALETTE,
  type Hue,
  type Level,
  type PaletteSwatch,
} from "./palette";

export type PaletteMap = Record<Hue, Record<Level, PaletteSwatch>>;

/**
 * The hue each shade ramp is generated from. Must stay in step with the
 * `--color-<hue>-base` custom properties in `styles/palette.css`: the CSS
 * drives what the grid renders, these hexes drive what the XLSX export writes,
 * and nothing links the two but this contract.
 */
export const DEFAULT_BASE_HEX: Record<Hue, string> = {
  red: "#ed2939",
  orange: "#ffa000",
  yellow: "#ffce0c",
  green: "#00c276",
  teal: "#00cccc",
  cyan: "#00c3f5",
  blue: "#339aff",
  indigo: "#5a55f5",
  violet: "#6464f7",
  purple: "#8e75f0",
  fuchsia: "#ff7ae7",
  rose: "#ff668b",
  coral: "#ff6d38",
  gray: "#8894aa",
};

export interface GridTheme {
  /** Class names per hue and level. Override to use your own utility classes. */
  readonly palette: PaletteMap;
  /** Base hexes the export colours are derived from. Override to rebrand. */
  readonly baseHex: Record<Hue, string>;
}

// `palette.ts` imports this module for `gridTheme()`, so resolving the defaults
// eagerly here would read `DEFAULT_PALETTE` while that module is still
// initialising. Stay lazy: nothing touches it until the first call.
let overrides: Partial<GridTheme> = {};
let active: GridTheme | null = null;

function defaults(): GridTheme {
  return { palette: DEFAULT_PALETTE, baseHex: DEFAULT_BASE_HEX };
}

/**
 * Point the grid at your own colours. Call once during app start-up, before
 * anything renders — the threshold and export helpers read the active theme at
 * call time, so a later change will not repaint what is already on screen.
 * Omitted keys keep their defaults.
 */
export function configureGridTheme(next: Partial<GridTheme>): void {
  overrides = { ...overrides, ...next };
  active = null;
}

/** Restore the shipped defaults. Mainly for tests. */
export function resetGridTheme(): void {
  overrides = {};
  active = null;
}

export function gridTheme(): GridTheme {
  if (!active) active = { ...defaults(), ...overrides };
  return active;
}
