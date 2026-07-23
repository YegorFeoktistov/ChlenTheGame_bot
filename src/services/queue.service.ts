import { db } from 'sdk';
import { chats, chatQueuePlayers, users } from '../schema.js';
import { eq, and, sql } from 'sdk/db';
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
  skippedPlayers?: { displayName: string; isExcluded: boolean; nextUserMention?: string }[];
}

export async function evaluateStrictTurnTimeout(chatId: string): Promise<StrictTurnResult> {
  const nowUnix = Math.floor(Date.now() / 1000);
  let allQueueRows = (await db
    .select()
    .from(chatQueuePlayers)
    .where(eq(chatQueuePlayers.chatId, chatId))
    .run()) as QueuePlayerRecord[];

  let activeQueue = (allQueueRows || [])
    .filter((p) => !p.isExcluded)
    .sort((a, b) => a.turnOrder - b.turnOrder);

  if (activeQueue.length === 0) {
    return { status: StrictTurnStatus.ALL_EXCLUDED };
  }

  const skippedPlayers: { displayName: string; isExcluded: boolean; nextUserMention?: string }[] =
    [];
  let allExcluded = false;

  while (true) {
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
      allExcluded = true;
      break;
    }

    if (expectedPlayer.lastTurnAt) {
      const elapsed = nowUnix - expectedPlayer.lastTurnAt;
      if (elapsed > 15) {
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

        allQueueRows = (await db
          .select()
          .from(chatQueuePlayers)
          .where(eq(chatQueuePlayers.chatId, chatId))
          .run()) as QueuePlayerRecord[];

        activeQueue = (allQueueRows || [])
          .filter((p) => !p.isExcluded)
          .sort((a, b) => a.turnOrder - b.turnOrder);

        let nextMention = skippedName;
        if (activeQueue.length > 0) {
          let nextPlayer = activeQueue[0];
          const lastTurnPlayersRemaining = activeQueue
            .filter((p) => p.lastTurnAt !== null)
            .sort((a, b) => (b.lastTurnAt || 0) - (a.lastTurnAt || 0));

          if (lastTurnPlayersRemaining.length > 0) {
            const lastPlayerId = lastTurnPlayersRemaining[0].userId;
            const lastIdx = activeQueue.findIndex((p) => p.userId === lastPlayerId);
            if (lastIdx !== -1) {
              nextPlayer = activeQueue[(lastIdx + 1) % activeQueue.length];
            }
          }
          nextMention = await getUserMention(nextPlayer.userId);
        }

        skippedPlayers.push({
          displayName: skippedName,
          isExcluded: isNowExcluded === 1,
          nextUserMention: nextMention,
        });

        continue;
      }
    }
    break;
  }

  if (allExcluded || activeQueue.length === 0) {
    return {
      status: StrictTurnStatus.ALL_EXCLUDED,
      skippedPlayers,
    };
  }

  if (skippedPlayers.length > 0) {
    const lastSkip = skippedPlayers[skippedPlayers.length - 1];
    return {
      status: lastSkip.isExcluded ? StrictTurnStatus.ORDER_69 : StrictTurnStatus.TURN_SKIPPED,
      skippedUserDisplayName: lastSkip.displayName,
      nextUserMention: lastSkip.nextUserMention,
      skippedPlayers,
    };
  }

  return { status: StrictTurnStatus.VALID };
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

  // Fetch all queue players
  let allQueueRows = (await db
    .select()
    .from(chatQueuePlayers)
    .where(eq(chatQueuePlayers.chatId, chatId))
    .run()) as QueuePlayerRecord[];

  let activeQueue = (allQueueRows || [])
    .filter((p) => !p.isExcluded)
    .sort((a, b) => a.turnOrder - b.turnOrder);

  // If queue is empty, this user starts the queue as player #1
  if (activeQueue.length === 0) {
    const nextTurnAt = nowUnix;
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

  // Iteratively process timeouts for expected players who have timed out
  const skippedPlayers: { displayName: string; isExcluded: boolean; nextUserMention?: string }[] =
    [];
  let allExcluded = false;

  while (true) {
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
      allExcluded = true;
      break;
    }

    // Check if expected player has timed out (only if it is a different player)
    if (expectedPlayer.userId !== userId && expectedPlayer.lastTurnAt) {
      const elapsed = nowUnix - expectedPlayer.lastTurnAt;
      if (elapsed > 15) {
        // Skip expected player
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

        allQueueRows = (await db
          .select()
          .from(chatQueuePlayers)
          .where(eq(chatQueuePlayers.chatId, chatId))
          .run()) as QueuePlayerRecord[];

        activeQueue = (allQueueRows || [])
          .filter((p) => !p.isExcluded)
          .sort((a, b) => a.turnOrder - b.turnOrder);

        let nextMention = skippedName;
        if (activeQueue.length > 0) {
          let nextPlayer = activeQueue[0];
          const lastTurnPlayersRemaining = activeQueue
            .filter((p) => p.lastTurnAt !== null)
            .sort((a, b) => (b.lastTurnAt || 0) - (a.lastTurnAt || 0));

          if (lastTurnPlayersRemaining.length > 0) {
            const lastPlayerId = lastTurnPlayersRemaining[0].userId;
            const lastIdx = activeQueue.findIndex((p) => p.userId === lastPlayerId);
            if (lastIdx !== -1) {
              nextPlayer = activeQueue[(lastIdx + 1) % activeQueue.length];
            }
          }
          nextMention = await getUserMention(nextPlayer.userId);
        }

        skippedPlayers.push({
          displayName: skippedName,
          isExcluded: isNowExcluded === 1,
          nextUserMention: nextMention,
        });

        continue;
      }
    }
    break;
  }

  if (allExcluded || activeQueue.length === 0) {
    return {
      status: StrictTurnStatus.ALL_EXCLUDED,
      skippedPlayers,
    };
  }

  // If user is not yet in active queue, append them first (ensures proper queue ordering).
  const isUserInQueue = activeQueue.some((p) => p.userId === userId);
  if (!isUserInQueue) {
    let insertAfterOrder = 0;
    const lastTurnPlayersActive = activeQueue
      .filter((p) => p.lastTurnAt !== null)
      .sort((a, b) => (b.lastTurnAt || 0) - (a.lastTurnAt || 0));

    if (lastTurnPlayersActive.length > 0) {
      insertAfterOrder = lastTurnPlayersActive[0].turnOrder;
    }

    const maxLastTurnAt = (allQueueRows || []).reduce(
      (max, p) => Math.max(max, p.lastTurnAt || 0),
      0
    );
    const nextTurnAt = Math.max(nowUnix, maxLastTurnAt + 1);

    if (insertAfterOrder > 0) {
      // Shift all players (active or excluded) with turnOrder > insertAfterOrder
      await db
        .update(chatQueuePlayers)
        .set({ turnOrder: sql`${chatQueuePlayers.turnOrder} + 1` })
        .where(sql`chat_id = ${chatId} AND turn_order > ${insertAfterOrder}`)
        .run();

      // Insert new player with turnOrder = insertAfterOrder + 1
      const newOrder = insertAfterOrder + 1;
      await db
        .insert(chatQueuePlayers)
        .values({
          chatId,
          userId,
          turnOrder: newOrder,
          skipCount: playerRecord ? playerRecord.skipCount : 0,
          isExcluded: 0,
          lastTurnAt: nextTurnAt,
        })
        .onConflictDoUpdate({
          target: [chatQueuePlayers.chatId, chatQueuePlayers.userId],
          set: { turnOrder: newOrder, lastTurnAt: nextTurnAt },
        })
        .run();
    } else {
      // If no active players have played yet, just append to the end
      const newOrder = (allQueueRows ? allQueueRows.length : 0) + 1;
      await db
        .insert(chatQueuePlayers)
        .values({
          chatId,
          userId,
          turnOrder: newOrder,
          skipCount: playerRecord ? playerRecord.skipCount : 0,
          isExcluded: 0,
          lastTurnAt: nextTurnAt,
        })
        .onConflictDoUpdate({
          target: [chatQueuePlayers.chatId, chatQueuePlayers.userId],
          set: { turnOrder: newOrder, lastTurnAt: nextTurnAt },
        })
        .run();
    }

    // Since they just joined, they roll immediately and we update their lastTurnAt, returning VALID
    const isFirstMove = playerRecord ? playerRecord.lastTurnAt === null : true;
    return {
      status: StrictTurnStatus.VALID,
      isFirstMove,
      skippedPlayers,
    };
  }

  // Re-calculate expected player
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

  // Check consecutive move attempt by same user
  if (lastUserId && lastUserId === userId) {
    const expectedName = await getUserName(expectedPlayer.userId);
    const remainingSeconds = expectedPlayer.lastTurnAt
      ? Math.max(0, 15 - (nowUnix - expectedPlayer.lastTurnAt))
      : 15;

    return {
      status: StrictTurnStatus.OUT_OF_TURN_WARNING,
      expectedUserDisplayName: expectedName,
      remainingSeconds,
      skippedPlayers,
    };
  }

  // Check if it's the expected turn
  if (expectedPlayer.userId === userId) {
    const maxLastTurnAt = (allQueueRows || []).reduce(
      (max, p) => Math.max(max, p.lastTurnAt || 0),
      0
    );
    const nextTurnAt = Math.max(nowUnix, maxLastTurnAt + 1);

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

    const isFirstMove = playerRecord ? playerRecord.lastTurnAt === null : !isUserInQueue;
    return {
      status: StrictTurnStatus.VALID,
      isFirstMove,
      skippedPlayers,
    };
  }

  // Out of turn move
  const expectedName = await getUserName(expectedPlayer.userId);
  const remainingSeconds = expectedPlayer.lastTurnAt
    ? Math.max(0, 15 - (nowUnix - expectedPlayer.lastTurnAt))
    : 15;

  return {
    status: StrictTurnStatus.OUT_OF_TURN_WARNING,
    expectedUserDisplayName: expectedName,
    remainingSeconds,
    skippedPlayers,
  };
}
