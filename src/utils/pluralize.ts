export function pluralizeTurns(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod100 >= 11 && mod100 <= 19) {
    return `${count} ходов`;
  }
  if (mod10 === 1) {
    return `${count} ход`;
  }
  if (mod10 >= 2 && mod10 <= 4) {
    return `${count} хода`;
  }
  return `${count} ходов`;
}

export function pluralizeWins(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod100 >= 11 && mod100 <= 19) {
    return `${count} побед`;
  }
  if (mod10 === 1) {
    return `${count} победа`;
  }
  if (mod10 >= 2 && mod10 <= 4) {
    return `${count} победы`;
  }
  return `${count} побед`;
}

export function pluralizeSeconds(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod100 >= 11 && mod100 <= 19) {
    return `${count} секунд`;
  }
  if (mod10 === 1) {
    return `${count} секунду`;
  }
  if (mod10 >= 2 && mod10 <= 4) {
    return `${count} секунды`;
  }
  return `${count} секунд`;
}
