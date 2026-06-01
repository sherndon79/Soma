export function sanitizeDisplayText(value = "", maxChars = 160) {
  const limit = Number.isInteger(maxChars) && maxChars > 0 ? maxChars : 160;
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/[<>&]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}
