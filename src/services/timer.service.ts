import { api, db } from 'sdk';
import { chatGameSessions } from '../schema.js';
import { eq } from 'sdk/db';
import type { GameSessionRecord } from '../types/models.js';
import { StrictTurnStatus, TURN_TIMEOUT_MS } from '../utils/constants.js';
import { getQueueMode, evaluateStrictTurnTimeout, clearQueueSession } from './queue.service.js';
import { withChatLock } from '../utils/mutex.js';

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
        for (const skipped of res.skippedPlayers) {
          if (skipped.isExcluded) {
            await api.sendMessage({
              chat_id: chatId,
              text: `Обнаружен натурал - ${skipped.displayName}! Выполнить Приказ 69!`,
            });
            if (skipped.nextUserMention && res.status !== StrictTurnStatus.ALL_EXCLUDED) {
              await api.sendMessage({
                chat_id: chatId,
                text: `Ход переходит к ${skipped.nextUserMention}.`,
              });
            }
          } else {
            if (skipped.nextUserMention) {
              await api.sendMessage({
                chat_id: chatId,
                text: `${skipped.displayName} - ты обронил Член!\nСледующим ходит ${skipped.nextUserMention}.`,
              });
            }
          }
        }
      }

      if (res.status === StrictTurnStatus.ALL_EXCLUDED) {
        clearTurnTimeout(chatId);

        await api.sendMessage({
          chat_id: chatId,
          text: 'Все участники признаны натуралами! Вы расстроили Член. Игра окончена.',
        });

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
