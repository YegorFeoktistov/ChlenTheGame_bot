import { db } from 'sdk';
import { chats, chatQueuePlayers, users } from '../schema.js';
import { eq, and } from 'sdk/db';
import type { ChatRecord, QueuePlayerRecord, UserRecord } from '../types/models.js';
import { StrictTurnStatus } from '../utils/constants.js';
import { formatDisplayName } from './user.service.js';

export async function getQueueMode(chatId: string): Promise<number> {
  const rows = (await db.select().from(chats).where(eq(chats.id, chatId)).run()) as ChatRecord[];

  if (rows && rows.length > 0 && rows[0].queueMode !== undefined) {
    return rows[0].queueMode;
  }
  return 1; // Default = 1 (Strict Mode)
}

export async function setQueueMode(chatId: string, mode: number): Promise<void> {
  await db
    .insert(chats)
    .values({
      id: chatId,
      title: 'Chat',
      queueMode: mode,
    })
    .onConflictDoUpdate({
      target: chats.id,
      set: { queueMode: mode },
    })
    .run();
}

export async function clearQueueSession(chatId: string): Promise<void> {
  await db.delete(chatQueuePlayers).where(eq(chatQueuePlayers.chatId, chatId)).run();
}

export async function getUserName(userId: string): Promise<string> {
  const userRows = (await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .run()) as UserRecord[];

  if (userRows && userRows.length > 0) {
    return formatDisplayName(userRows[0].firstName, userRows[0].lastName);
  }
  return 'Игрок';
}

/**
 * Generalized session player registration for both strict & non-strict modes.
 * Registers player in session queue and returns whether this is their 1st move in session.
 */
export async function registerSessionPlayer(
  chatId: string,
  userId: string,
  nowUnix: number
): Promise<boolean> {
  const existingRows = (await db
    .select()
    .from(chatQueuePlayers)
    .where(and(eq(chatQueuePlayers.chatId, chatId), eq(chatQueuePlayers.userId, userId)))
    .run()) as QueuePlayerRecord[];

  const isFirstMove = !existingRows || existingRows.length === 0;

  if (isFirstMove) {
    const allRows = (await db
      .select()
      .from(chatQueuePlayers)
      .where(eq(chatQueuePlayers.chatId, chatId))
      .run()) as QueuePlayerRecord[];

    const nextOrder = (allRows ? allRows.length : 0) + 1;

    await db
      .insert(chatQueuePlayers)
      .values({
        chatId,
        userId,
        turnOrder: nextOrder,
        skipCount: 0,
        isExcluded: 0,
        lastTurnAt: nowUnix,
      })
      .onConflictDoUpdate({
        target: [chatQueuePlayers.chatId, chatQueuePlayers.userId],
        set: { lastTurnAt: nowUnix },
      })
      .run();
  }

  return isFirstMove;
}

export interface StrictTurnResult {
  status: StrictTurnStatus;
  skippedUserDisplayName?: string;
  nextUserDisplayName?: string;
  order69UserDisplayName?: string;
}

export async function evaluateStrictTurn(
  chatId: string,
  userId: string,
  userDisplayName: string,
  nowUnix: number,
  lastUserId: string | null
): Promise<StrictTurnResult> {
  // 1. Check if user is permanently excluded from current session (Order 69)
  const existingPlayerRows = (await db
    .select()
    .from(chatQueuePlayers)
    .where(and(eq(chatQueuePlayers.chatId, chatId), eq(chatQueuePlayers.userId, userId)))
    .run()) as QueuePlayerRecord[];

  const playerRecord =
    existingPlayerRows && existingPlayerRows.length > 0 ? existingPlayerRows[0] : null;

  if (playerRecord && playerRecord.isExcluded) {
    return { status: StrictTurnStatus.EXCLUDED };
  }

  // 2. Check consecutive move attempt by same user
  if (lastUserId && lastUserId === userId) {
    return { status: StrictTurnStatus.OUT_OF_TURN_WARNING };
  }

  // Fetch all queue players for this chat ordered by turnOrder
  const allQueueRows = (await db
    .select()
    .from(chatQueuePlayers)
    .where(eq(chatQueuePlayers.chatId, chatId))
    .run()) as QueuePlayerRecord[];

  const activeQueue = (allQueueRows || [])
    .filter((p) => !p.isExcluded)
    .sort((a, b) => a.turnOrder - b.turnOrder);

  const maxLastTurnAt = (allQueueRows || []).reduce(
    (max, p) => Math.max(max, p.lastTurnAt || 0),
    0
  );
  const nextTurnAt = Math.max(nowUnix, maxLastTurnAt + 1);

  // If queue has 1 player (just registered), valid 1st turn
  if (activeQueue.length <= 1) {
    await db
      .insert(chatQueuePlayers)
      .values({
        chatId,
        userId,
        turnOrder: 1,
        skipCount: 0,
        isExcluded: 0,
        lastTurnAt: nextTurnAt,
      })
      .onConflictDoUpdate({
        target: [chatQueuePlayers.chatId, chatQueuePlayers.userId],
        set: { turnOrder: 1, lastTurnAt: nextTurnAt },
      })
      .run();

    return { status: StrictTurnStatus.VALID };
  }

  // Determine current expected turn player
  let currentExpectedIdx = 0;
  const lastTurnPlayers = activeQueue
    .filter((p) => p.lastTurnAt !== null)
    .sort((a, b) => (b.lastTurnAt || 0) - (a.lastTurnAt || 0));

  if (lastTurnPlayers.length > 0) {
    const lastPlayerId = lastTurnPlayers[0].userId;
    const lastIdx = activeQueue.findIndex((p) => p.userId === lastPlayerId);
    if (lastIdx !== -1) {
      currentExpectedIdx = (lastIdx + 1) % activeQueue.length;
    }
  }

  let expectedPlayer = activeQueue[currentExpectedIdx];

  // 3. Check 10-second timeout for expectedPlayer
  if (expectedPlayer && expectedPlayer.userId !== userId && expectedPlayer.lastTurnAt) {
    const elapsed = nowUnix - expectedPlayer.lastTurnAt;
    if (elapsed > 10) {
      // Expected player timed out! Increment skip count
      const newSkipCount = expectedPlayer.skipCount + 1;
      const isNowExcluded = newSkipCount >= 3 ? 1 : 0;

      await db
        .insert(chatQueuePlayers)
        .values({
          chatId,
          userId: expectedPlayer.userId,
          turnOrder: expectedPlayer.turnOrder,
          skipCount: newSkipCount,
          isExcluded: isNowExcluded,
          lastTurnAt: nextTurnAt,
        })
        .onConflictDoUpdate({
          target: [chatQueuePlayers.chatId, chatQueuePlayers.userId],
          set: { skipCount: newSkipCount, isExcluded: isNowExcluded, lastTurnAt: nextTurnAt },
        })
        .run();

      const skippedName = await getUserName(expectedPlayer.userId);

      if (isNowExcluded) {
        return {
          status: StrictTurnStatus.ORDER_69,
          order69UserDisplayName: skippedName,
        };
      }

      // Next expected player after skip
      const nextIdx = (currentExpectedIdx + 1) % activeQueue.length;
      const nextPlayer = activeQueue[nextIdx];
      const nextName = nextPlayer ? await getUserName(nextPlayer.userId) : userDisplayName;

      return {
        status: StrictTurnStatus.TURN_SKIPPED,
        skippedUserDisplayName: skippedName,
        nextUserDisplayName: nextName,
      };
    }
  }

  // Re-evaluate expected player after possible timeouts
  if (expectedPlayer.userId === userId) {
    // Valid turn! Update lastTurnAt
    await db
      .insert(chatQueuePlayers)
      .values({
        chatId,
        userId,
        turnOrder: expectedPlayer.turnOrder,
        skipCount: expectedPlayer.skipCount,
        isExcluded: 0,
        lastTurnAt: nextTurnAt,
      })
      .onConflictDoUpdate({
        target: [chatQueuePlayers.chatId, chatQueuePlayers.userId],
        set: { lastTurnAt: nextTurnAt },
      })
      .run();

    return { status: StrictTurnStatus.VALID };
  }

  // If user is not yet in active queue, append them to queue
  const isUserInQueue = activeQueue.some((p) => p.userId === userId);
  if (!isUserInQueue) {
    const nextOrder = (allQueueRows ? allQueueRows.length : 0) + 1;
    await db
      .insert(chatQueuePlayers)
      .values({
        chatId,
        userId,
        turnOrder: nextOrder,
        skipCount: playerRecord ? playerRecord.skipCount : 0,
        isExcluded: 0,
        lastTurnAt: nextTurnAt,
      })
      .onConflictDoUpdate({
        target: [chatQueuePlayers.chatId, chatQueuePlayers.userId],
        set: { turnOrder: nextOrder, lastTurnAt: nextTurnAt },
      })
      .run();

    return { status: StrictTurnStatus.VALID };
  }

  // Player is attempting out of turn move
  return { status: StrictTurnStatus.OUT_OF_TURN_WARNING };
}
