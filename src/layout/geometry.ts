// Hex code points keep arbitrary accessor IDs valid and collision-free in CSS.
export function columnSizeProperty(id: string) {
  return `--ftg-size-${Array.from(id, (char) => char.codePointAt(0)?.toString(16)).join("-")}`;
}

export function columnLeftProperty(id: string) {
  return columnSizeProperty(id).replace("--ftg-size-", "--ftg-left-");
}

export function columnWidth(id: string, fallback: number) {
  return `var(${columnSizeProperty(id)}, ${fallback}px)`;
}

export function columnLeft(id: string, fallback: number) {
  return `var(${columnLeftProperty(id)}, ${fallback}px)`;
}

export function tableGeometry(
  name: "pinned" | "total" | "before" | "after",
  fallback: number,
) {
  return `var(--ftg-${name}, ${fallback}px)`;
}
