import { db } from 'sdk';
import {
  chatGameSessions,
  chatWarnedUsers,
  chatSkillUsers,
  chatStatusEffectUsers,
} from '../schema.js';
import { eq, and } from 'sdk/db';
import type { GameSessionRecord, WarnedUserRecord } from '../types/models.js';
import {
  CommandStatus,
  StrictTurnStatus,
  StatusEffectId,
  SESSION_COOLDOWN_SECONDS,
  GAME_WIN_CHANCE,
} from '../utils/constants.js';
import { getStatusEffects } from './statusEffects.service.js';
import {
  getQueueMode,
  evaluateStrictTurn,
  clearQueueSession,
  registerNonStrictPlayer,
} from './queue.service.js';
import { scheduleTurnTimeout, clearTurnTimeout } from './timer.service.js';
import { recordAutomaticWin } from './game_rules.js';

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
  skippedPlayers?: { displayName: string; isExcluded: boolean; nextUserMention?: string }[];
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

  if (isWarned && process.env.REPL_MODE !== 'true') {
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

export async function terminateGameSession(
  chatId: string,
  nowUnix = Math.floor(Date.now() / 1000)
): Promise<void> {
  await db
    .insert(chatGameSessions)
    .values({
      chatId,
      isActive: 0,
      lastUserId: null,
      sessionMessagesCount: 0,
      sessionEndedAt: nowUnix,
      currentTurnStartedAt: null,
    })
    .onConflictDoUpdate({
      target: chatGameSessions.chatId,
      set: {
        isActive: 0,
        lastUserId: null,
        sessionMessagesCount: 0,
        sessionEndedAt: nowUnix,
        currentTurnStartedAt: null,
      },
    })
    .run();

  await clearQueueSession(chatId);
  await db.delete(chatSkillUsers).where(eq(chatSkillUsers.chatId, chatId)).run();
  await db.delete(chatStatusEffectUsers).where(eq(chatStatusEffectUsers.chatId, chatId)).run();
  clearTurnTimeout(chatId);
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
  await terminateGameSession(chatId, nowUnix);

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
          currentTurnStartedAt: null,
        };

  let gameStarted = false;

  // 1. Check 10-second session cooldown and initialize state if starting a new game
  if (!session.isActive) {
    if (session.sessionEndedAt) {
      const elapsed = nowUnix - session.sessionEndedAt;
      if (elapsed < SESSION_COOLDOWN_SECONDS) {
        return { status: CommandStatus.SESSION_COOLDOWN };
      }
    }
    // Clean up timers and database queue for a fresh game
    await clearQueueSession(chatId);
    await db.delete(chatSkillUsers).where(eq(chatSkillUsers.chatId, chatId)).run();
    clearTurnTimeout(chatId);

    session.isActive = 1;
    session.sessionEndedAt = null;
    session.lastUserId = null;
    session.sessionMessagesCount = 0;
    session.currentTurnStartedAt = nowUnix;
    gameStarted = true;
  }

  let isFirstMoveForUser = false;
  let strictResSkips: { displayName: string; isExcluded: boolean; nextUserMention?: string }[] = [];

  // 2. Mode-specific turn order & anti-spam evaluation
  if (queueMode === 1) {
    const strictRes = await evaluateStrictTurn(
      chatId,
      userId,
      userDisplayName,
      nowUnix,
      session.lastUserId,
      session.currentTurnStartedAt
    );

    if (strictRes.currentTurnStartedAt !== undefined) {
      session.currentTurnStartedAt = strictRes.currentTurnStartedAt;
    }
    if (strictRes.lastUserId !== undefined) {
      session.lastUserId = strictRes.lastUserId;
    }

    strictResSkips = strictRes.skippedPlayers || [];

    if (strictRes.status === StrictTurnStatus.EXCLUDED) {
      return { status: CommandStatus.EXCLUDED };
    }

    if (strictRes.status === StrictTurnStatus.SOLE_PLAYER_TIMEOUT) {
      await terminateGameSession(chatId, nowUnix);

      return {
        status: CommandStatus.SOLE_PLAYER_TIMEOUT,
      };
    }

    if (strictRes.status === StrictTurnStatus.SINGLE_PLAYER_WIN) {
      const winDetails = await recordAutomaticWin(
        chatId,
        strictRes.winnerId!,
        strictRes.winnerName!,
        nowUnix,
        session.sessionMessagesCount
      );
      await terminateGameSession(chatId, nowUnix);

      return {
        status: CommandStatus.SINGLE_PLAYER_WIN,
        winnerName: strictRes.winnerName,
        turns: winDetails.turns,
        newRecord: winDetails.newRecord,
        skippedPlayers: strictResSkips,
      };
    }

    if (strictRes.status === StrictTurnStatus.ALL_EXCLUDED) {
      await terminateGameSession(chatId, nowUnix);

      return {
        status: CommandStatus.ALL_EXCLUDED,
        skippedPlayers: strictResSkips,
      };
    }

    if (strictRes.status === StrictTurnStatus.OUT_OF_TURN_WARNING) {
      const warnRes = await handleOutOfTurnWarning(chatId, userId);
      return {
        ...warnRes,
        expectedUserName: strictRes.expectedUserDisplayName,
        remainingSeconds: strictRes.remainingSeconds,
        skippedPlayers: strictResSkips,
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

  let newRecord = false;
  let turns = 0;

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
    const roll =
      rollOverride !== undefined
        ? rollOverride
        : process.env.SIMULATION_NO_WIN === 'true'
          ? 0.99
          : Math.random();
    const weaknessEffects = await getStatusEffects(chatId, userId);
    const weaknessCount = weaknessEffects
      .filter((e) => e.statusEffectId === StatusEffectId.WEAKNESS)
      .reduce((sum, e) => sum + e.count, 0);
    const winChance = GAME_WIN_CHANCE / Math.pow(2, weaknessCount);
    if (roll < winChance) {
      outcome = 'Я победил';
      gameEnded = true;

      const winDetails = await recordAutomaticWin(
        chatId,
        userId,
        userDisplayName,
        nowUnix,
        session.sessionMessagesCount
      );
      newRecord = winDetails.newRecord;
      turns = winDetails.turns;
      await terminateGameSession(chatId, nowUnix);
    } else {
      outcome = 'Член';
      gameEnded = false;
    }
  }

  if (!gameEnded) {
    // Save session state
    await db
      .insert(chatGameSessions)
      .values({
        chatId,
        isActive: session.isActive,
        lastUserId: session.lastUserId,
        sessionMessagesCount: session.sessionMessagesCount,
        sessionEndedAt: session.sessionEndedAt,
        currentTurnStartedAt: session.currentTurnStartedAt,
      })
      .onConflictDoUpdate({
        target: chatGameSessions.chatId,
        set: {
          isActive: session.isActive,
          lastUserId: session.lastUserId,
          sessionMessagesCount: session.sessionMessagesCount,
          sessionEndedAt: session.sessionEndedAt,
          currentTurnStartedAt: session.currentTurnStartedAt,
        },
      })
      .run();
  }

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
    skippedPlayers: strictResSkips,
  };
}
