export function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function hasOwnFields(value, fields) {
  return fields.every((field) => Object.hasOwn(value, field));
}

export function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

export function isParseableTimestamp(value) {
  return isNonEmptyString(value) && Number.isFinite(Date.parse(value));
}

export function cloneValue(value) {
  return structuredClone(value);
}
