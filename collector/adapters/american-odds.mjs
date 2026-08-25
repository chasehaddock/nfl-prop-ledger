export function parseAmericanOdds(value) {
  const normalized = String(value).replace(/[−–—]/g, "-").replace(/\s/g, "");
  if (!/^[+-]?\d+$/.test(normalized)) throw new Error(`Invalid American odds: ${value}`);
  return Number(normalized);
}
