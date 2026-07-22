import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from 'sdk';
import {
  getQueueMode,
  setQueueMode,
  clearQueueSession,
  evaluateStrictTurn,
} from '../src/services/queue.service.js';
import type { ChatRecord, QueuePlayerRecord, UserRecord } from '../src/types/models.js';
import { StrictTurnStatus } from '../src/utils/constants.js';

let mockChats: Record<string, ChatRecord> = {};
let mockQueuePlayers: Record<string, QueuePlayerRecord> = {};
let mockUsers: Record<string, UserRecord> = {};

describe('Queue Service (Strict Queue Engine)', () => {
  beforeEach(() => {
    mockChats = {};
    mockQueuePlayers = {};
    mockUsers = {
      user1: { id: 'user1', firstName: 'Yegor', lastName: 'Feoktistov' },
      user2: { id: 'user2', firstName: 'Pasha', lastName: null },
      user3: { id: 'user3', firstName: 'Aleh', lastName: null },
    };

    vi.spyOn(db, 'insert').mockImplementation(
      (tbl: { name?: string }) =>
        ({
          values: (val: Record<string, unknown>) => ({
            onConflictDoUpdate: (opts: { set?: Record<string, unknown> }) => ({
              run: async () => {
                if (tbl && tbl.name === 'chats') {
                  const updated = {
                    ...(mockChats[val.id as string] || {}),
                    ...val,
                    ...(opts.set || {}),
                  };
                  mockChats[val.id as string] = updated as ChatRecord;
                }
                if (tbl && tbl.name === 'chat_queue_players') {
                  const key = `${val.chatId}_${val.userId}`;
                  const updated = { ...(mockQueuePlayers[key] || {}), ...val, ...(opts.set || {}) };
                  mockQueuePlayers[key] = updated as QueuePlayerRecord;
                }
              },
            }),
          }),
        }) as unknown as ReturnType<typeof db.insert>
    );

    vi.spyOn(db, 'delete').mockImplementation(
      () =>
        ({
          where: () => ({
            run: async () => {
              mockQueuePlayers = {};
            },
          }),
        }) as unknown as ReturnType<typeof db.delete>
    );

    vi.spyOn(db, 'select').mockImplementation(
      () =>
        ({
          from: (tbl: { name?: string }) => ({
            where: () => ({
              run: async () => {
                if (tbl && tbl.name === 'chats') return Object.values(mockChats);
                if (tbl && tbl.name === 'users') return Object.values(mockUsers);
                if (tbl && tbl.name === 'chat_queue_players')
                  return Object.values(mockQueuePlayers);
                return [];
              },
            }),
          }),
        }) as unknown as ReturnType<typeof db.select>
    );
  });

  it('defaults to strict queue mode (1) and allows toggling to non-strict (0)', async () => {
    const defaultMode = await getQueueMode('chat1');
    expect(defaultMode).toBe(1);

    await setQueueMode('chat1', 0);
    const updatedMode = await getQueueMode('chat1');
    expect(updatedMode).toBe(0);
  });

  it('initializes queue on turn 1 and enforces strict turn order for subsequent turns', async () => {
    const now = 1000;
    // Turn 1 by user1
    const res1 = await evaluateStrictTurn('chat1', 'user1', 'Yegor Feoktistov', now, null);
    expect(res1.status).toBe(StrictTurnStatus.VALID);

    // Turn 2 by user2
    const res2 = await evaluateStrictTurn('chat1', 'user2', 'Pasha', now + 1, 'user1');
    expect(res2.status).toBe(StrictTurnStatus.VALID);

    // Attempt out of turn move by user2 -> warning
    const resWarn = await evaluateStrictTurn('chat1', 'user2', 'Pasha', now + 2, 'user2');
    expect(resWarn.status).toBe(StrictTurnStatus.OUT_OF_TURN_WARNING);
  });

  it('handles 10-second turn timeout and skips turn', async () => {
    const now = 1000;
    await evaluateStrictTurn('chat1', 'user1', 'Yegor Feoktistov', now, null);
    await evaluateStrictTurn('chat1', 'user2', 'Pasha', now + 1, 'user1');

    // Turn should be user1 next, but 12 seconds pass without user1 moving
    const resSkip = await evaluateStrictTurn('chat1', 'user3', 'Aleh', now + 15, 'user2');
    expect(resSkip.status).toBe(StrictTurnStatus.TURN_SKIPPED);
    expect(resSkip.skippedUserDisplayName).toBe('Yegor Feoktistov');
  });

  it('excludes user permanently on 3rd turn skip (Order 69)', async () => {
    const now = 1000;
    // Setup player with 2 skips already
    mockQueuePlayers['chat1_user1'] = {
      chatId: 'chat1',
      userId: 'user1',
      turnOrder: 1,
      skipCount: 2,
      isExcluded: 0,
      lastTurnAt: now,
    };
    mockQueuePlayers['chat1_user2'] = {
      chatId: 'chat1',
      userId: 'user2',
      turnOrder: 2,
      skipCount: 0,
      isExcluded: 0,
      lastTurnAt: now + 1,
    };

    // User1 times out again (> 10s) -> 3rd skip -> Order 69
    const res69 = await evaluateStrictTurn('chat1', 'user3', 'Aleh', now + 15, 'user2');
    expect(res69.status).toBe(StrictTurnStatus.ORDER_69);
    expect(res69.order69UserDisplayName).toBe('Yegor Feoktistov');
  });

  it('rejects excluded players with excluded status', async () => {
    mockQueuePlayers['chat1_user1'] = {
      chatId: 'chat1',
      userId: 'user1',
      turnOrder: 1,
      skipCount: 3,
      isExcluded: 1,
      lastTurnAt: 1000,
    };

    const res = await evaluateStrictTurn('chat1', 'user1', 'Yegor Feoktistov', 1050, 'user2');
    expect(res.status).toBe(StrictTurnStatus.EXCLUDED);
  });

  it('clears queue session correctly', async () => {
    mockQueuePlayers['chat1_user1'] = {
      chatId: 'chat1',
      userId: 'user1',
      turnOrder: 1,
      skipCount: 0,
      isExcluded: 0,
      lastTurnAt: 1000,
    };

    await clearQueueSession('chat1');
    expect(Object.keys(mockQueuePlayers).length).toBe(0);
  });
});
