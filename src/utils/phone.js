export const normalizePhone = (s) => s.replace(/[\s\-().]/g, '')
export const isValidPhone = (s) => /^\+?\d{7,15}$/.test(s)
