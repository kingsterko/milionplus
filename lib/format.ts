/**
 * Pomocne funkcie na citatelne zobrazenie casu vykopu namiesto suroveho ISO retazca.
 */

const DAY_NAMES = ["Ne", "Po", "Ut", "St", "Št", "Pi", "So"];

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function formatKickoff(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);

  const time = date.toLocaleTimeString("sk-SK", { hour: "2-digit", minute: "2-digit" });

  if (isSameDay(date, now)) return `Dnes ${time}`;
  if (isSameDay(date, tomorrow)) return `Zajtra ${time}`;

  const day = DAY_NAMES[date.getDay()];
  return `${day} ${date.getDate()}.${date.getMonth() + 1}. ${time}`;
}

export function formatDayHeading(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);

  if (isSameDay(date, now)) return "Dnes";
  if (isSameDay(date, tomorrow)) return "Zajtra";

  const day = DAY_NAMES[date.getDay()];
  return `${day} ${date.getDate()}.${date.getMonth() + 1}.`;
}

export function isToday(iso: string): boolean {
  return isSameDay(new Date(iso), new Date());
}

export function dayKey(iso: string): string {
  const date = new Date(iso);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}
