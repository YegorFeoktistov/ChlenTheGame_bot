import { api, db } from 'sdk';
import { chatGameSessions } from '../schema.js';
import { eq } from 'sdk/db';
import type { GameSessionRecord } from '../types/models.js';
import { StrictTurnStatus } from '../utils/constants.js';
import { getQueueMode, evaluateStrictTurnTimeout, clearQueueSession } from './queue.service.js';

export const activeTimers = new Map<string, NodeJS.Timeout>();

export function clearTurnTimeout(chatId: string): void {
  const existing = activeTimers.get(chatId);
  if (existing) {
    clearTimeout(existing);
    activeTimers.delete(chatId);
  }
}

export function scheduleTurnTimeout(chatId: string, delayMs = 15100): void {
  clearTurnTimeout(chatId);

  const timer = setTimeout(async () => {
    await processTurnTimeout(chatId);
  }, delayMs);

  activeTimers.set(chatId, timer);
}

export async function processTurnTimeout(chatId: string): Promise<void> {
  const mode = await getQueueMode(chatId);
  if (mode !== 1) {
    clearTurnTimeout(chatId);
    return;
  }

  const res = await evaluateStrictTurnTimeout(chatId);

  if (res.status === StrictTurnStatus.ALL_EXCLUDED) {
    clearTurnTimeout(chatId);

    if (res.order69UserDisplayName) {
      await api.sendMessage({
        chat_id: chatId,
        text: `Обнаружен натурал - ${res.order69UserDisplayName}! Выполнить Приказ 69!`,
      });
    }

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

  if (res.status === StrictTurnStatus.ORDER_69) {
    if (res.order69UserDisplayName) {
      await api.sendMessage({
        chat_id: chatId,
        text: `Обнаружен натурал - ${res.order69UserDisplayName}! Выполнить Приказ 69!`,
      });
    }
    // Schedule next turn timer for remaining active players
    scheduleTurnTimeout(chatId);
    return;
  }

  if (res.status === StrictTurnStatus.TURN_SKIPPED) {
    if (res.skippedUserDisplayName && res.nextUserMention) {
      await api.sendMessage({
        chat_id: chatId,
        text: `${res.skippedUserDisplayName} - ты обронил Член!\nСледующим ходит ${res.nextUserMention}.`,
      });
    }
    // Schedule next turn timer for remaining active players
    scheduleTurnTimeout(chatId);
    return;
  }

  clearTurnTimeout(chatId);
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
      scheduleTurnTimeout(session.chatId, 15100);
    }
  }
}
