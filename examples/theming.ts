// The README theming example, kept compiling.

import { configureGridTheme, DEFAULT_PALETTE, gridTheme } from "../src";

export function applyBrandTheme(): void {
  configureGridTheme({
    // change what renders on screen
    palette: {
      ...DEFAULT_PALETTE,
      red: {
        ...DEFAULT_PALETTE.red,
        dark: { ...DEFAULT_PALETTE.red.dark, bg: "bg-brand-danger" },
      },
    },
    // change what the XLSX export writes
    baseHex: { ...gridTheme().baseHex, green: "#00a86b" },
  });
}
