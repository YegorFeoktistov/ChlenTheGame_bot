import { db } from 'sdk';
import { chatGameSessions } from '../schema.js';
import { eq } from 'sdk/db';
import type { GameSessionRecord } from '../types/models.js';
import { StrictTurnStatus, TURN_TIMEOUT_MS } from '../utils/constants.js';
import { getQueueMode, evaluateStrictTurnTimeout } from './queue.service.js';
import { withChatLock } from '../utils/mutex.js';
import { recordAutomaticWin } from './game_rules.js';
import { terminateGameSession } from './game.service.js';
import { sendSkipNotifications, sendGameEndNotification } from './notification.service.js';

export const activeTimers = new Map<string, NodeJS.Timeout>();
export const activeTimerIds = new Map<string, number>();
let timerIdSequence = 0;

export function clearTurnTimeout(chatId: string): void {
  const existing = activeTimers.get(chatId);
  if (existing) {
    clearTimeout(existing);
    activeTimers.delete(chatId);
  }
  activeTimerIds.delete(chatId);
}

export function scheduleTurnTimeout(chatId: string, delayMs = TURN_TIMEOUT_MS): void {
  clearTurnTimeout(chatId);

  const myId = ++timerIdSequence;
  activeTimerIds.set(chatId, myId);

  const timer = setTimeout(async () => {
    await processTurnTimeout(chatId, myId);
  }, delayMs);

  activeTimers.set(chatId, timer);
}

export async function processTurnTimeout(chatId: string, myId?: number): Promise<void> {
  try {
    await withChatLock(chatId, async () => {
      // Prevent execution if this timer has been cleared or superseded
      if (myId !== undefined && activeTimerIds.get(chatId) !== myId) {
        return;
      }

      const mode = await getQueueMode(chatId);
      if (mode !== 1) {
        clearTurnTimeout(chatId);
        return;
      }

      const res = await evaluateStrictTurnTimeout(chatId);

      // Notify the chat about any skipped/excluded players
      if (res.skippedPlayers && res.skippedPlayers.length > 0) {
        await sendSkipNotifications(
          chatId,
          res.skippedPlayers,
          res.status === StrictTurnStatus.ALL_EXCLUDED
        );
      }

      if (res.status === StrictTurnStatus.SOLE_PLAYER_TIMEOUT) {
        await terminateGameSession(chatId);
        await sendGameEndNotification(chatId, res.status);
        return;
      }

      if (res.status === StrictTurnStatus.SINGLE_PLAYER_WIN) {
        const nowUnix = Math.floor(Date.now() / 1000);
        const sessionRows = (await db
          .select()
          .from(chatGameSessions)
          .where(eq(chatGameSessions.chatId, chatId))
          .run()) as GameSessionRecord[];

        const turnsCount =
          sessionRows && sessionRows.length > 0 ? sessionRows[0].sessionMessagesCount || 0 : 0;

        const winDetails = await recordAutomaticWin(
          chatId,
          res.winnerId!,
          res.winnerName!,
          nowUnix,
          turnsCount
        );
        await terminateGameSession(chatId, nowUnix);

        await sendGameEndNotification(
          chatId,
          res.status,
          res.winnerName,
          winDetails.turns,
          winDetails.newRecord
        );
        return;
      }

      if (res.status === StrictTurnStatus.ALL_EXCLUDED) {
        await terminateGameSession(chatId);
        await sendGameEndNotification(chatId, res.status);
        return;
      }

      if (
        res.status === StrictTurnStatus.ORDER_69 ||
        res.status === StrictTurnStatus.TURN_SKIPPED
      ) {
        scheduleTurnTimeout(chatId);
        return;
      }

      clearTurnTimeout(chatId);
    });
  } catch (err) {
    console.error(`Error processing turn timeout for chat ${chatId}:`, err);
    // Even if it failed, ensure we clear the crashed timer state
    clearTurnTimeout(chatId);
  }
}

export async function initTurnTimersOnStartup(): Promise<void> {
  const activeSessions = (await db
    .select()
    .from(chatGameSessions)
    .where(eq(chatGameSessions.isActive, 1))
    .run()) as GameSessionRecord[];

  for (const session of activeSessions) {
    const mode = await getQueueMode(session.chatId);
    if (mode === 1) {
      scheduleTurnTimeout(session.chatId, TURN_TIMEOUT_MS);
    }
  }
}
