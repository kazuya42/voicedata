// Zeit-/Datumsformat (lokale Zeit), einheitlich für Markdown, Prompts und UI.
const pad = (n: number) => String(n).padStart(2, '0');

// HH:MM:SS
export function formatClock(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// TT.MM.JJJJ
export function formatDate(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
}
