/** «Иванов Иван Иванович» → «Иван И.»: на плитке и в сообщениях место дорогое */
export function shortName(fullName: string): string {
  const [last, first] = fullName.trim().split(/\s+/);
  if (!first) return last ?? '';
  return `${first} ${last.charAt(0)}.`;
}
