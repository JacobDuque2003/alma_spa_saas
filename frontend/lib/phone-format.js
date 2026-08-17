"use client";

export function formatEcuadorPhone(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "—";
  const digits = raw.replace(/\D/g, "");
  if (digits.startsWith("5939") && digits.length === 12) {
    return `0${digits.slice(3)}`;
  }
  if (digits.startsWith("9") && digits.length === 9) {
    return `0${digits}`;
  }
  if (digits.startsWith("09") && digits.length === 10) {
    return digits;
  }
  return raw;
}

export function phoneSearchText(value = "") {
  const local = formatEcuadorPhone(value);
  return `${value || ""} ${local}`.toLocaleLowerCase("es-EC");
}
