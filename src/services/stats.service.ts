import { db } from 'sdk';
import { chatUserStats, chatLongestSessions } from '../schema.js';
import { eq, desc } from 'sdk/db';
import { pluralizeWins, pluralizeTurns } from '../utils/pluralize.js';
import type { UserStatRecord, LongestSessionRecord } from '../types/models.js';
import { cleanUsername } from './user.service.js';

export async function getLeaderboardText(chatId: string): Promise<string> {
  const rows = (await db
    .select()
    .from(chatUserStats)
    .where(eq(chatUserStats.chatId, chatId))
    .orderBy(desc(chatUserStats.wins))
    .run()) as UserStatRecord[];

  // Filter out users with 0 wins
  const winners = rows.filter((r) => r.wins > 0);

  if (!winners || winners.length === 0) {
    return '🏆 В этом чате еще нет победителей! Начните игру с команды /chlen';
  }

  const lines = ['🏆 Таблица лидеров игры "Член: the Game":\n'];
  winners.forEach((user, idx: number) => {
    let name = user.displayName || 'Игрок';
    if (name.startsWith('@')) {
      name = cleanUsername(name);
    }
    lines.push(`${idx + 1}. ${name} — ${pluralizeWins(user.wins)}`);
  });

  return lines.join('\n');
}

export async function getLongestSessionText(chatId: string): Promise<string> {
  const rows = (await db
    .select()
    .from(chatLongestSessions)
    .where(eq(chatLongestSessions.chatId, chatId))
    .run()) as LongestSessionRecord[];

  if (!rows || rows.length === 0) {
    return '🏆 В этом чате еще не было завершенных игр!';
  }

  const record = rows[0];
  let winner = record.winnerDisplayName || 'Игрок';
  if (winner.startsWith('@')) {
    winner = cleanUsername(winner);
  }

  return (
    `🏆 Самая долгая игра в этом чате:\n\n` +
    `💬 Количество ходов: ${pluralizeTurns(record.messagesCount)}\n` +
    `👑 Победитель: ${winner}\n` +
    `📅 Дата окончания: ${record.endedAt}`
  );
}
