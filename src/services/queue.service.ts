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
  const existingRows = (await db
    .select()
    .from(chats)
    .where(eq(chats.id, chatId))
    .run()) as ChatRecord[];

  const title = existingRows && existingRows.length > 0 ? existingRows[0].title : 'Chat';

  await db
    .insert(chats)
    .values({
      id: chatId,
      title,
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

export async function getUserMention(userId: string): Promise<string> {
  const userRows = (await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .run()) as UserRecord[];

  if (userRows && userRows.length > 0) {
    const user = userRows[0];
    if (user.username) {
      const handle = user.username.replace(/^@+/, '');
      return `@${handle}`;
    }
    return formatDisplayName(user.firstName, user.lastName);
  }
  return 'Игрок';
}

/**
 * Register player first move in non-strict mode without affecting strict turn order timestamps.
 */
export async function registerNonStrictPlayer(
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
    await db
      .insert(chatQueuePlayers)
      .values({
        chatId,
        userId,
        turnOrder: 1,
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
  isFirstMove?: boolean;
  skippedUserDisplayName?: string;
  nextUserMention?: string;
  order69UserDisplayName?: string;
  expectedUserDisplayName?: string;
  remainingSeconds?: number;
}

async function createOutOfTurnWarning(
  expectedPlayer: QueuePlayerRecord | undefined,
  userDisplayName: string,
  nowUnix: number
): Promise<StrictTurnResult> {
  const expectedName = expectedPlayer ? await getUserName(expectedPlayer.userId) : userDisplayName;
  const remainingSeconds =
    expectedPlayer && expectedPlayer.lastTurnAt
      ? Math.max(0, 15 - (nowUnix - expectedPlayer.lastTurnAt))
      : 15;

  return {
    status: StrictTurnStatus.OUT_OF_TURN_WARNING,
    expectedUserDisplayName: expectedName,
    remainingSeconds,
  };
}

export async function evaluateStrictTurnTimeout(chatId: string): Promise<StrictTurnResult> {
  const nowUnix = Math.floor(Date.now() / 1000);
  const allQueueRows = (await db
    .select()
    .from(chatQueuePlayers)
    .where(eq(chatQueuePlayers.chatId, chatId))
    .run()) as QueuePlayerRecord[];

  const activeQueue = (allQueueRows || [])
    .filter((p) => !p.isExcluded)
    .sort((a, b) => a.turnOrder - b.turnOrder);

  if (activeQueue.length === 0) {
    return { status: StrictTurnStatus.ALL_EXCLUDED };
  }

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

  const expectedPlayer = activeQueue[currentExpectedIdx];
  if (!expectedPlayer) {
    return { status: StrictTurnStatus.ALL_EXCLUDED };
  }

  const maxLastTurnAt = (allQueueRows || []).reduce(
    (max, p) => Math.max(max, p.lastTurnAt || 0),
    0
  );
  const nextTurnAt = Math.max(nowUnix, maxLastTurnAt + 1);

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
  const remainingActive = activeQueue.filter((p) => p.userId !== expectedPlayer.userId);

  if (isNowExcluded && remainingActive.length === 0) {
    return {
      status: StrictTurnStatus.ALL_EXCLUDED,
      order69UserDisplayName: skippedName,
    };
  }

  if (isNowExcluded) {
    return {
      status: StrictTurnStatus.ORDER_69,
      order69UserDisplayName: skippedName,
    };
  }

  const nextIdx = (currentExpectedIdx + 1) % activeQueue.length;
  const nextPlayer = activeQueue[nextIdx];
  const nextMention = nextPlayer ? await getUserMention(nextPlayer.userId) : skippedName;

  return {
    status: StrictTurnStatus.TURN_SKIPPED,
    skippedUserDisplayName: skippedName,
    nextUserMention: nextMention,
  };
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

  // If queue is empty, this user starts the queue as player #1
  if (activeQueue.length === 0) {
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

    return { status: StrictTurnStatus.VALID, isFirstMove: true };
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

  const expectedPlayer = activeQueue[currentExpectedIdx];

  // Fail-safe check for 15-second timeout (delegates directly to evaluateStrictTurnTimeout)
  if (expectedPlayer && expectedPlayer.userId !== userId && expectedPlayer.lastTurnAt) {
    const elapsed = nowUnix - expectedPlayer.lastTurnAt;
    if (elapsed > 15) {
      return await evaluateStrictTurnTimeout(chatId);
    }
  }

  // 2. Check consecutive move attempt by same user
  if (lastUserId && lastUserId === userId) {
    return await createOutOfTurnWarning(expectedPlayer, userDisplayName, nowUnix);
  }

  // If user is not yet in active queue, append them to queue and allow their turn
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

    return { status: StrictTurnStatus.VALID, isFirstMove: true };
  }

  // User is already in queue: check if it's their expected turn
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

    const isFirstMove = playerRecord ? playerRecord.lastTurnAt === null : false;
    return { status: StrictTurnStatus.VALID, isFirstMove };
  }

  // Player is attempting out of turn move
  return await createOutOfTurnWarning(expectedPlayer, userDisplayName, nowUnix);
}
