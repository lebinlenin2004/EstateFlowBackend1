// Money is stored as integer minor units (paise). Never do arithmetic on floating-point rupees.
export const toMinor = (major) => Math.round(Number(major) * 100)
export const fromMinor = (minor) => (minor == null ? null : minor / 100)
export const hasAtMostTwoDecimals = (n) => Number.isFinite(n) && Math.abs(n * 100 - Math.round(n * 100)) < 1e-6
