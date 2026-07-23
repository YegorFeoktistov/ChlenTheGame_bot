import { db } from 'sdk';
import {
  chatGameSessions,
  chatUserStats,
  chatLongestSessions,
  chatWarnedUsers,
  chatSkillUsers,
} from '../schema.js';
import { eq, and } from 'sdk/db';
import type {
  GameSessionRecord,
  UserStatRecord,
  LongestSessionRecord,
  WarnedUserRecord,
} from '../types/models.js';
import { CommandStatus, StrictTurnStatus } from '../utils/constants.js';
import {
  getQueueMode,
  evaluateStrictTurn,
  clearQueueSession,
  registerNonStrictPlayer,
} from './queue.service.js';
import { scheduleTurnTimeout, clearTurnTimeout } from './timer.service.js';

export interface CommandResult {
  status: CommandStatus;
  gameStarted?: boolean;
  outcome?: string;
  gameEnded?: boolean;
  winnerName?: string | null;
  turns?: number;
  newRecord?: boolean;
  skippedUserName?: string;
  nextUserName?: string;
  order69UserName?: string;
  expectedUserName?: string;
  remainingSeconds?: number;
}

/**
 * Helper to handle warning logic for out-of-turn or consecutive move attempts.
 */
async function handleOutOfTurnWarning(chatId: string, userId: string): Promise<CommandResult> {
  const warnedRows = (await db
    .select()
    .from(chatWarnedUsers)
    .where(and(eq(chatWarnedUsers.chatId, chatId), eq(chatWarnedUsers.userId, userId)))
    .run()) as WarnedUserRecord[];

  const isWarned = warnedRows && warnedRows.length > 0;

  if (isWarned) {
    return { status: CommandStatus.IGNORED };
  }

  await db
    .insert(chatWarnedUsers)
    .values({ chatId, userId })
    .onConflictDoUpdate({
      target: [chatWarnedUsers.chatId, chatWarnedUsers.userId],
      set: { chatId, userId },
    })
    .run();

  return { status: CommandStatus.WARNING };
}

export async function abortGameSession(chatId: string): Promise<{ wasActive: boolean }> {
  const sessionRows = (await db
    .select()
    .from(chatGameSessions)
    .where(eq(chatGameSessions.chatId, chatId))
    .run()) as GameSessionRecord[];

  const session = sessionRows && sessionRows.length > 0 ? sessionRows[0] : null;

  if (!session || !session.isActive) {
    return { wasActive: false };
  }

  const nowUnix = Math.floor(Date.now() / 1000);

  await db
    .insert(chatGameSessions)
    .values({
      chatId,
      isActive: 0,
      lastUserId: null,
      sessionMessagesCount: 0,
      sessionEndedAt: nowUnix,
    })
    .onConflictDoUpdate({
      target: chatGameSessions.chatId,
      set: {
        isActive: 0,
        lastUserId: null,
        sessionEndedAt: nowUnix,
      },
    })
    .run();

  await clearQueueSession(chatId);
  await db.delete(chatSkillUsers).where(eq(chatSkillUsers.chatId, chatId)).run();
  clearTurnTimeout(chatId);

  return { wasActive: true };
}

export async function handleGameCommand(
  chatId: string,
  userId: string,
  userDisplayName: string,
  rollOverride?: number
): Promise<CommandResult> {
  const nowUnix = Math.floor(Date.now() / 1000);
  const queueMode = await getQueueMode(chatId);

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
        };

  let isFirstMoveForUser = false;

  // 1. Mode-specific turn order & anti-spam evaluation
  if (queueMode === 1) {
    const strictRes = await evaluateStrictTurn(
      chatId,
      userId,
      userDisplayName,
      nowUnix,
      session.lastUserId
    );

    if (strictRes.status === StrictTurnStatus.EXCLUDED) {
      return { status: CommandStatus.EXCLUDED };
    }

    if (strictRes.status === StrictTurnStatus.ALL_EXCLUDED) {
      await db
        .insert(chatGameSessions)
        .values({
          chatId,
          isActive: 0,
          lastUserId: null,
          sessionMessagesCount: 0,
          sessionEndedAt: nowUnix,
        })
        .onConflictDoUpdate({
          target: chatGameSessions.chatId,
          set: {
            isActive: 0,
            lastUserId: null,
            sessionEndedAt: nowUnix,
          },
        })
        .run();

      await clearQueueSession(chatId);
      clearTurnTimeout(chatId);

      return {
        status: CommandStatus.ALL_EXCLUDED,
        order69UserName: strictRes.order69UserDisplayName,
      };
    }

    if (strictRes.status === StrictTurnStatus.ORDER_69) {
      scheduleTurnTimeout(chatId);
      return {
        status: CommandStatus.ORDER_69,
        order69UserName: strictRes.order69UserDisplayName,
      };
    }

    if (strictRes.status === StrictTurnStatus.TURN_SKIPPED) {
      scheduleTurnTimeout(chatId);
      return {
        status: CommandStatus.TURN_SKIPPED,
        skippedUserName: strictRes.skippedUserDisplayName,
        nextUserName: strictRes.nextUserMention,
      };
    }

    if (strictRes.status === StrictTurnStatus.OUT_OF_TURN_WARNING) {
      const warnRes = await handleOutOfTurnWarning(chatId, userId);
      return {
        ...warnRes,
        expectedUserName: strictRes.expectedUserDisplayName,
        remainingSeconds: strictRes.remainingSeconds,
      };
    }

    if (strictRes.isFirstMove) {
      isFirstMoveForUser = true;
    }
  } else {
    // Non-strict mode consecutive move check
    if (session.lastUserId && session.lastUserId === userId) {
      return handleOutOfTurnWarning(chatId, userId);
    }

    isFirstMoveForUser = await registerNonStrictPlayer(chatId, userId, nowUnix);
  }

  // 2. Check 10-second session cooldown if starting a new game
  let gameStarted = false;
  let newRecord = false;
  let turns = 0;

  if (!session.isActive) {
    if (session.sessionEndedAt) {
      const elapsed = nowUnix - session.sessionEndedAt;
      if (elapsed < 10) {
        return { status: CommandStatus.SESSION_COOLDOWN };
      }
    }
    session.isActive = 1;
    session.sessionEndedAt = null;
    gameStarted = true;
  }

  // 3. Reset warned users list on valid turn or game start
  await db.delete(chatWarnedUsers).where(eq(chatWarnedUsers.chatId, chatId)).run();

  session.lastUserId = userId;

  if (gameStarted) {
    session.sessionMessagesCount = 1;
  } else {
    session.sessionMessagesCount = (session.sessionMessagesCount || 0) + 1;
  }

  // 4. Calculate roll outcome (10% chance to win; no player can win on their 1st turn)
  let outcome = 'Член';
  let gameEnded = false;

  if (gameStarted || isFirstMoveForUser) {
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

      // Reset skill usage, queue, and timers for next game
      await db.delete(chatSkillUsers).where(eq(chatSkillUsers.chatId, chatId)).run();
      await clearQueueSession(chatId);
      clearTurnTimeout(chatId);

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
    })
    .onConflictDoUpdate({
      target: chatGameSessions.chatId,
      set: {
        isActive: session.isActive,
        lastUserId: session.lastUserId,
        sessionMessagesCount: session.sessionMessagesCount,
        sessionEndedAt: session.sessionEndedAt,
      },
    })
    .run();

  if (queueMode === 1 && !gameEnded) {
    scheduleTurnTimeout(chatId);
  }

  return {
    status: CommandStatus.SUCCESS,
    gameStarted,
    outcome,
    gameEnded,
    winnerName: gameEnded ? userDisplayName : null,
    turns: gameEnded ? turns : 0,
    newRecord: gameEnded ? newRecord : false,
  };
}
