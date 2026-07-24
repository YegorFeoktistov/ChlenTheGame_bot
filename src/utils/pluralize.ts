export function pluralize(count: number, one: string, two: string, five: string): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod100 >= 11 && mod100 <= 19) {
    return `${count} ${five}`;
  }
  if (mod10 === 1) {
    return `${count} ${one}`;
  }
  if (mod10 >= 2 && mod10 <= 4) {
    return `${count} ${two}`;
  }
  return `${count} ${five}`;
}

export function pluralizeTurns(count: number): string {
  return pluralize(count, 'ход', 'хода', 'ходов');
}

export function pluralizeWins(count: number): string {
  return pluralize(count, 'победа', 'победы', 'побед');
}

export function pluralizeSeconds(count: number): string {
  return pluralize(count, 'секунду', 'секунды', 'секунд');
}
