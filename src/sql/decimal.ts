import { GridRequestError } from "./errors";

/** Shift decimal text exactly, without a round trip through an IEEE-754 number. */
export function decimal(
  value: string,
  ratio: boolean,
): { value: string; scale: number; integerDigits: number } {
  const [mantissa, exponentText = "0"] = value.trim().toLowerCase().split("e");
  const negative = mantissa.startsWith("-");
  const unsigned = mantissa.replace(/^[+-]/, "");
  const [whole, fraction = ""] = unsigned.split(".");
  let digits = (whole + fraction).replace(/^0+/, "");
  if (!digits) return { value: "0", scale: 0, integerDigits: 1 };
  const exponent = Number(exponentText);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 1000)
    throw new GridRequestError([
      {
        path: "view.filter.value",
        message: "Decimal exponent must be between -1000 and 1000",
      },
    ]);
  let scale = fraction.length - exponent + (ratio ? 2 : 0);
  while (scale > 0 && digits.endsWith("0")) {
    digits = digits.slice(0, -1);
    scale--;
  }
  if (scale < 0) {
    digits += "0".repeat(-scale);
    scale = 0;
  }
  const integerDigits = Math.max(0, digits.length - scale);
  const padded = digits.padStart(scale + 1, "0");
  const point = padded.length - scale;
  const result = scale
    ? `${padded.slice(0, point)}.${padded.slice(point)}`
    : padded;
  return { value: negative ? `-${result}` : result, scale, integerDigits };
}
