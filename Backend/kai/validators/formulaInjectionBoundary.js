export const FORMULA_INJECTION_DANGEROUS_FIRST_BYTES = Object.freeze([
  0x3D,
  0x2B,
  0x2D,
  0x40,
  0x09,
  0x0D,
]);

const ASCII_APOSTROPHE = "'";
const DANGEROUS_FIRST_BYTE_SET = new Set(FORMULA_INJECTION_DANGEROUS_FIRST_BYTES);

export function hasFormulaInjectionDangerousPrefix(value) {
  if (typeof value !== "string" || value.length === 0) return false;
  if (value.startsWith(ASCII_APOSTROPHE)) return false;
  const firstCodeUnit = value.charCodeAt(0);
  return DANGEROUS_FIRST_BYTE_SET.has(firstCodeUnit);
}

export function escapeFormulaInjectionDangerousPrefix(value) {
  if (typeof value !== "string") return value;
  if (!hasFormulaInjectionDangerousPrefix(value)) return value;
  return `${ASCII_APOSTROPHE}${value}`;
}
