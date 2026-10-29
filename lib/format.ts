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

/** "pred 5 min" / "pred 3 h" / "pred 2 d" - ako stare su ulozene kurzy (obnovuju sa len rucne). */
export function formatAge(iso: string): string {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return "práve teraz";
  if (minutes < 60) return `pred ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `pred ${hours} h`;
  return `pred ${Math.floor(hours / 24)} d`;
}
