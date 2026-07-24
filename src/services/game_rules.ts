import { db } from 'sdk';
import { chatUserStats, chatLongestSessions } from '../schema.js';
import { eq, and } from 'sdk/db';
import type { UserStatRecord, LongestSessionRecord } from '../types/models.js';

export interface WinResult {
  newRecord: boolean;
  turns: number;
}

/**
 * Helper to record game win, update leaderboards, reset queue/skills, and set session inactive.
 */
export async function recordAutomaticWin(
  chatId: string,
  winnerId: string,
  winnerName: string,
  nowUnix: number,
  turns: number
): Promise<WinResult> {
  // 1. Update wins in chatUserStats
  const userStatsRows = (await db
    .select()
    .from(chatUserStats)
    .where(and(eq(chatUserStats.chatId, chatId), eq(chatUserStats.userId, winnerId)))
    .run()) as UserStatRecord[];

  const currentWins = userStatsRows && userStatsRows.length > 0 ? userStatsRows[0].wins : 0;
  const classIdx = userStatsRows && userStatsRows.length > 0 ? userStatsRows[0].classIndex : null;

  await db
    .insert(chatUserStats)
    .values({
      chatId,
      userId: winnerId,
      wins: currentWins + 1,
      displayName: winnerName,
      classIndex: classIdx,
    })
    .onConflictDoUpdate({
      target: [chatUserStats.chatId, chatUserStats.userId],
      set: {
        wins: currentWins + 1,
        displayName: winnerName,
      },
    })
    .run();

  // 2. Check and update longest session record
  const longestRows = (await db
    .select()
    .from(chatLongestSessions)
    .where(eq(chatLongestSessions.chatId, chatId))
    .run()) as LongestSessionRecord[];

  const longestRecord = longestRows && longestRows.length > 0 ? longestRows[0] : null;
  let newRecord = false;

  if (!longestRecord || turns > longestRecord.messagesCount) {
    newRecord = true;
    const nowFormatted = new Date()
      .toLocaleString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Europe/Moscow',
      })
      .replace(',', '');

    await db
      .insert(chatLongestSessions)
      .values({
        chatId,
        messagesCount: turns,
        winnerId,
        winnerDisplayName: winnerName,
        endedAt: nowFormatted,
      })
      .onConflictDoUpdate({
        target: chatLongestSessions.chatId,
        set: {
          messagesCount: turns,
          winnerId,
          winnerDisplayName: winnerName,
          endedAt: nowFormatted,
        },
      })
      .run();
  }

  return { newRecord, turns };
}
