import { db } from 'sdk';
import { chatGameSessions, chatUserStats, chatLongestSessions } from '../schema.js';
import { eq, and } from 'sdk/db';
import type { GameSessionRecord, UserStatRecord, LongestSessionRecord } from '../types/models.js';

export interface CommandResult {
  status: 'ignored' | 'warning' | 'session_cooldown' | 'success';
  gameStarted?: boolean;
  outcome?: string;
  gameEnded?: boolean;
  winnerName?: string | null;
  turns?: number;
  newRecord?: boolean;
}

export async function handleGameCommand(
  chatId: string,
  userId: string,
  userDisplayName: string,
  rollOverride?: number
): Promise<CommandResult> {
  const nowUnix = Math.floor(Date.now() / 1000);

  // Fetch or initialize chat session state
  const sessionRows = (await db
    .select()
    .from(chatGameSessions)
    .where(eq(chatGameSessions.chatId, chatId))
    .run()) as GameSessionRecord[];

  let session: GameSessionRecord =
    sessionRows && sessionRows.length > 0
      ? sessionRows[0]
      : {
          chatId,
          isActive: 0,
          lastUserId: null,
          sessionMessagesCount: 0,
          sessionEndedAt: null,
          warnedUserIds: '[]',
          skillUserIds: '[]',
        };

  let warnedUsers: string[] = [];
  try {
    warnedUsers = JSON.parse(session.warnedUserIds || '[]');
  } catch {
    warnedUsers = [];
  }

  // 1. Turn order verification (consecutive moves check)
  if (session.lastUserId && session.lastUserId === userId) {
    if (warnedUsers.includes(userId)) {
      return { status: 'ignored' };
    } else {
      warnedUsers.push(userId);
      await db
        .insert(chatGameSessions)
        .values({
          chatId,
          isActive: session.isActive,
          lastUserId: session.lastUserId,
          sessionMessagesCount: session.sessionMessagesCount,
          sessionEndedAt: session.sessionEndedAt,
          warnedUserIds: JSON.stringify(warnedUsers),
        })
        .onConflictDoUpdate({
          target: chatGameSessions.chatId,
          set: { warnedUserIds: JSON.stringify(warnedUsers) },
        })
        .run();

      return { status: 'warning' };
    }
  }

  // 2. Check 10-second session cooldown if starting a new game
  let gameStarted = false;
  let newRecord = false;
  let turns = 0;

  if (!session.isActive) {
    if (session.sessionEndedAt) {
      const elapsed = nowUnix - session.sessionEndedAt;
      if (elapsed < 10) {
        return { status: 'session_cooldown' };
      }
    }
    session.isActive = 1;
    session.sessionEndedAt = null;
    gameStarted = true;
  }

  // 3. Update turn history
  warnedUsers = [];
  session.lastUserId = userId;

  if (gameStarted) {
    session.sessionMessagesCount = 1;
  } else {
    session.sessionMessagesCount = (session.sessionMessagesCount || 0) + 1;
  }

  // 4. Calculate roll outcome (10% chance to win, cannot win on turn 1)
  let outcome = 'Член';
  let gameEnded = false;

  if (gameStarted) {
    outcome = 'Член';
    gameEnded = false;
  } else {
    const roll = rollOverride !== undefined ? rollOverride : Math.random();
    if (roll < 0.1) {
      outcome = 'Я победил';
      gameEnded = true;
      session.isActive = 0;
      session.lastUserId = null;
      session.sessionEndedAt = nowUnix;
      turns = session.sessionMessagesCount;

      // Update win count in leaderboard stats
      const userStatsRows = (await db
        .select()
        .from(chatUserStats)
        .where(and(eq(chatUserStats.chatId, chatId), eq(chatUserStats.userId, userId)))
        .run()) as UserStatRecord[];

      const currentWins = userStatsRows && userStatsRows.length > 0 ? userStatsRows[0].wins : 0;
      const classIdx =
        userStatsRows && userStatsRows.length > 0 ? userStatsRows[0].classIndex : null;

      await db
        .insert(chatUserStats)
        .values({
          chatId,
          userId,
          wins: currentWins + 1,
          displayName: userDisplayName,
          classIndex: classIdx,
        })
        .onConflictDoUpdate({
          target: [chatUserStats.chatId, chatUserStats.userId],
          set: {
            wins: currentWins + 1,
            displayName: userDisplayName,
          },
        })
        .run();

      // Check and update longest session record
      const longestRows = (await db
        .select()
        .from(chatLongestSessions)
        .where(eq(chatLongestSessions.chatId, chatId))
        .run()) as LongestSessionRecord[];

      const longestRecord = longestRows && longestRows.length > 0 ? longestRows[0] : null;

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
            winnerId: userId,
            winnerDisplayName: userDisplayName,
            endedAt: nowFormatted,
          })
          .onConflictDoUpdate({
            target: chatLongestSessions.chatId,
            set: {
              messagesCount: turns,
              winnerId: userId,
              winnerDisplayName: userDisplayName,
              endedAt: nowFormatted,
            },
          })
          .run();
      }
    } else {
      outcome = 'Член';
      gameEnded = false;
    }
  }

  // Save session state
  await db
    .insert(chatGameSessions)
    .values({
      chatId,
      isActive: session.isActive,
      lastUserId: session.lastUserId,
      sessionMessagesCount: session.sessionMessagesCount,
      sessionEndedAt: session.sessionEndedAt,
      warnedUserIds: '[]',
    })
    .onConflictDoUpdate({
      target: chatGameSessions.chatId,
      set: {
        isActive: session.isActive,
        lastUserId: session.lastUserId,
        sessionMessagesCount: session.sessionMessagesCount,
        sessionEndedAt: session.sessionEndedAt,
        warnedUserIds: '[]',
      },
    })
    .run();

  return {
    status: 'success',
    gameStarted,
    outcome,
    gameEnded,
    winnerName: gameEnded ? userDisplayName : null,
    turns: gameEnded ? turns : 0,
    newRecord: gameEnded ? newRecord : false,
  };
}
