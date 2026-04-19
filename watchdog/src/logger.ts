type Level = "info" | "warn" | "error";

export function log(
  level: Level,
  evt: string,
  data: Record<string, unknown> = {},
): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, evt, ...data });
  if (level === "error") console.error(line);
  else console.log(line);
}
