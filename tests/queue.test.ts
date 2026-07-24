import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from 'sdk';
import {
  getQueueMode,
  setQueueMode,
  clearQueueSession,
  evaluateStrictTurn,
  registerNonStrictPlayer,
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

    vi.spyOn(db, 'update').mockImplementation(
      (tbl: { name?: string }) =>
        ({
          set: () => ({
            where: (cond: any) => ({
              run: async () => {
                if (tbl && tbl.name === 'chat_queue_players') {
                  let insertAfterOrder = 0;
                  if (cond && cond.values && cond.values.length >= 2) {
                    insertAfterOrder = cond.values[1];
                  }
                  for (const key of Object.keys(mockQueuePlayers)) {
                    const p = mockQueuePlayers[key];
                    if (p && p.turnOrder > insertAfterOrder) {
                      p.turnOrder += 1;
                    }
                  }
                }
              },
            }),
          }),
        }) as unknown as ReturnType<typeof db.update>
    );

    vi.spyOn(db, 'select').mockImplementation(
      () =>
        ({
          from: (tbl: { name?: string }) => ({
            where: (cond?: unknown) => ({
              run: async () => {
                if (tbl && tbl.name === 'chats') return Object.values(mockChats);
                if (tbl && tbl.name === 'users') {
                  if (cond && typeof cond === 'object') {
                    const condStr = JSON.stringify(cond);
                    if (condStr.includes('user1')) return [mockUsers.user1];
                    if (condStr.includes('user2')) return [mockUsers.user2];
                    if (condStr.includes('user3')) return [mockUsers.user3];
                  }
                  return Object.values(mockUsers);
                }
                if (tbl && tbl.name === 'chat_queue_players') {
                  const all = Object.values(mockQueuePlayers);
                  if (cond && typeof cond === 'object') {
                    const condStr = JSON.stringify(cond);
                    if (condStr.includes('user1')) return all.filter((p) => p.userId === 'user1');
                    if (condStr.includes('user2')) return all.filter((p) => p.userId === 'user2');
                    if (condStr.includes('user3')) return all.filter((p) => p.userId === 'user3');
                  }
                  return all;
                }
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
    let turnStart: number | null = null;

    // Turn 1 by user1
    const res1 = await evaluateStrictTurn(
      'chat1',
      'user1',
      'Yegor Feoktistov',
      now,
      null,
      turnStart
    );
    expect(res1.status).toBe(StrictTurnStatus.VALID);
    expect(res1.isFirstMove).toBe(true);
    turnStart = res1.currentTurnStartedAt ?? null;

    // Turn 2 by user2 (joining mid-game)
    const res2 = await evaluateStrictTurn('chat1', 'user2', 'Pasha', now + 2, 'user1', turnStart);
    expect(res2.status).toBe(StrictTurnStatus.VALID);
    expect(res2.isFirstMove).toBe(true);
    turnStart = res2.currentTurnStartedAt ?? null;

    // Turn 3 by user1 (2nd move in strict sequence)
    const res3 = await evaluateStrictTurn(
      'chat1',
      'user1',
      'Yegor Feoktistov',
      now + 4,
      'user2',
      turnStart
    );
    expect(res3.status).toBe(StrictTurnStatus.VALID);
    expect(res3.isFirstMove).toBe(false);
    turnStart = res3.currentTurnStartedAt ?? null;

    // Attempt out of turn move by user1 -> warning
    const resWarn = await evaluateStrictTurn(
      'chat1',
      'user1',
      'Yegor Feoktistov',
      now + 5,
      'user1',
      turnStart
    );
    expect(resWarn.status).toBe(StrictTurnStatus.OUT_OF_TURN_WARNING);
  });

  it('handles 3-player round-robin sequence (user1 -> user2 -> user3 -> user1)', async () => {
    const now = 1000;
    let turnStart: number | null = null;
    // user1 starts
    const r1 = await evaluateStrictTurn('chat1', 'user1', 'Yegor', now, null, turnStart);
    expect(r1.status).toBe(StrictTurnStatus.VALID);
    turnStart = r1.currentTurnStartedAt ?? null;

    // user2 joins
    const r2 = await evaluateStrictTurn('chat1', 'user2', 'Pasha', now + 2, 'user1', turnStart);
    expect(r2.status).toBe(StrictTurnStatus.VALID);
    turnStart = r2.currentTurnStartedAt ?? null;

    // user3 joins
    const r3 = await evaluateStrictTurn('chat1', 'user3', 'Aleh', now + 4, 'user2', turnStart);
    expect(r3.status).toBe(StrictTurnStatus.VALID);
    turnStart = r3.currentTurnStartedAt ?? null;

    // user1 turn 2 -> expected!
    const r4 = await evaluateStrictTurn('chat1', 'user1', 'Yegor', now + 6, 'user3', turnStart);
    expect(r4.status).toBe(StrictTurnStatus.VALID);
    turnStart = r4.currentTurnStartedAt ?? null;

    // user2 turn 2 -> expected!
    const r5 = await evaluateStrictTurn('chat1', 'user2', 'Pasha', now + 8, 'user1', turnStart);
    expect(r5.status).toBe(StrictTurnStatus.VALID);
  });

  it('handles 15-second turn timeout and skips turn', async () => {
    const now = 1000;
    let turnStart: number | null = null;
    const res1 = await evaluateStrictTurn(
      'chat1',
      'user1',
      'Yegor Feoktistov',
      now,
      null,
      turnStart
    );
    turnStart = res1.currentTurnStartedAt ?? null;
    const res2 = await evaluateStrictTurn('chat1', 'user2', 'Pasha', now + 1, 'user1', turnStart);
    turnStart = res2.currentTurnStartedAt ?? null;

    // Turn should be user1 next, but 35 seconds pass without user1 moving (so both user1 and user2 time out)
    const resSkip = await evaluateStrictTurn(
      'chat1',
      'user3',
      'Aleh',
      now + 35,
      'user2',
      turnStart
    );
    expect(resSkip.status).toBe(StrictTurnStatus.VALID);
    expect(resSkip.skippedPlayers).toBeDefined();
    expect(resSkip.skippedPlayers!.length).toBe(2);
    expect(resSkip.skippedPlayers![0].displayName).toBe('Yegor Feoktistov');
    expect(resSkip.skippedPlayers![0].isExcluded).toBe(false);
    expect(resSkip.skippedPlayers![1].displayName).toBe('Pasha');
    expect(resSkip.skippedPlayers![1].isExcluded).toBe(false);
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
    mockQueuePlayers['chat1_user4'] = {
      chatId: 'chat1',
      userId: 'user4',
      turnOrder: 3,
      skipCount: 0,
      isExcluded: 0,
      lastTurnAt: now + 2,
    };

    // User1 was expected after User4 played at now + 2. So currentTurnStartedAt = now + 2
    const turnStart = now + 2;

    // User1 times out again -> 3rd skip -> Order 69 (both time out over 35 seconds)
    const res69 = await evaluateStrictTurn('chat1', 'user3', 'Aleh', now + 35, 'user2', turnStart);
    expect(res69.status).toBe(StrictTurnStatus.VALID);
    expect(res69.skippedPlayers).toBeDefined();
    expect(res69.skippedPlayers!.length).toBe(2);
    expect(res69.skippedPlayers![0].displayName).toBe('Yegor Feoktistov');
    expect(res69.skippedPlayers![0].isExcluded).toBe(true);
    expect(res69.skippedPlayers![1].displayName).toBe('Pasha');
    expect(res69.skippedPlayers![1].isExcluded).toBe(false);
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

    const res = await evaluateStrictTurn('chat1', 'user1', 'Yegor Feoktistov', 1050, 'user2', null);
    expect(res.status).toBe(StrictTurnStatus.EXCLUDED);
  });

  it('registers non-strict player correctly on first move', async () => {
    const now = 1000;
    const isFirst1 = await registerNonStrictPlayer('chat1', 'user1', now);
    expect(isFirst1).toBe(true);

    const isFirst2 = await registerNonStrictPlayer('chat1', 'user1', now + 5);
    expect(isFirst2).toBe(false);
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

  it('asserts correct shift alignment when a new player joins strict queue', async () => {
    const now = 1000;
    let turnStart: number | null = now;
    // Set up queue with user1 and user2
    mockQueuePlayers['chat1_user1'] = {
      chatId: 'chat1',
      userId: 'user1',
      turnOrder: 1,
      skipCount: 0,
      isExcluded: 0,
      lastTurnAt: now, // user1 played last
    };
    mockQueuePlayers['chat1_user2'] = {
      chatId: 'chat1',
      userId: 'user2',
      turnOrder: 2,
      skipCount: 0,
      isExcluded: 0,
      lastTurnAt: now - 2, // user2 played earlier
    };

    // User3 (Aleh) joins.
    const res = await evaluateStrictTurn('chat1', 'user3', 'Aleh', now + 2, 'user1', turnStart);
    expect(res.status).toBe(StrictTurnStatus.VALID);
    turnStart = res.currentTurnStartedAt ?? null;

    // Verify User3 is inserted after User1 (the last player who played, turnOrder = 1)
    // So User3 should get turnOrder = 2, and User2 should shift to turnOrder = 3
    expect(mockQueuePlayers['chat1_user3']?.turnOrder).toBe(2);
    expect(mockQueuePlayers['chat1_user2']?.turnOrder).toBe(3);

    // Now evaluate who is expected next.
    // Last player who played is User3 (lastTurnAt = 1002, turnOrder = 2).
    // Expected next should be User2 (turnOrder = 3).
    const nextCheck = await evaluateStrictTurn(
      'chat1',
      'user1',
      'Yegor',
      now + 4,
      'user3',
      turnStart
    );
    // User1 should get out of turn warning because it is User2's turn
    expect(nextCheck.status).toBe(StrictTurnStatus.OUT_OF_TURN_WARNING);
    expect(nextCheck.expectedUserDisplayName).toBe('Pasha');
  });

  it('handles multiple skipped players when a new player joins after a long delay', async () => {
    const now = 1000;
    let turnStart: number | null = now;
    // Setup player1 and player2 in queue
    mockQueuePlayers['chat1_user1'] = {
      chatId: 'chat1',
      userId: 'user1',
      turnOrder: 1,
      skipCount: 0,
      isExcluded: 0,
      lastTurnAt: now,
    };
    mockQueuePlayers['chat1_user2'] = {
      chatId: 'chat1',
      userId: 'user2',
      turnOrder: 2,
      skipCount: 0,
      isExcluded: 0,
      lastTurnAt: now - 5,
    };

    // 35 seconds pass. Both user1 and user2 should time out when user3 joins.
    const res = await evaluateStrictTurn('chat1', 'user3', 'Aleh', now + 35, 'user1', turnStart);
    expect(res.status).toBe(StrictTurnStatus.VALID);
    expect(res.skippedPlayers).toBeDefined();
    expect(res.skippedPlayers!.length).toBe(2);
    expect(res.skippedPlayers![0].displayName).toBe('Pasha');
    expect(res.skippedPlayers![0].isExcluded).toBe(false);
    expect(res.skippedPlayers![1].displayName).toBe('Yegor Feoktistov');
    expect(res.skippedPlayers![1].isExcluded).toBe(false);
  });

  it('resets consecutive move restriction when turn changes due to timeout skips', async () => {
    const now = 1000;
    let turnStart: number | null = now;

    // Setup player1 and player2
    mockQueuePlayers['chat1_user1'] = {
      chatId: 'chat1',
      userId: 'user1',
      turnOrder: 1,
      skipCount: 0,
      isExcluded: 0,
      lastTurnAt: now,
    };
    mockQueuePlayers['chat1_user2'] = {
      chatId: 'chat1',
      userId: 'user2',
      turnOrder: 2,
      skipCount: 0,
      isExcluded: 0,
      lastTurnAt: now - 5,
    };

    // user1 played last (lastUserId = 'user1').
    // Over 15 seconds pass (now + 20), user2 times out.
    // Turn wraps back to user1. Since skips occurred, user1 is expected and should be allowed to play!
    const res = await evaluateStrictTurn('chat1', 'user1', 'Yegor', now + 20, 'user1', turnStart);

    // Check that user1's roll is valid and skips were processed, and lastUserId is reset to null
    expect(res.status).toBe(StrictTurnStatus.VALID);
    expect(res.skippedPlayers).toBeDefined();
    expect(res.skippedPlayers!.length).toBe(1);
    expect(res.skippedPlayers![0].displayName).toBe('Pasha');
    expect(res.lastUserId).toBeNull();
  });

  it('triggers SOLE_PLAYER_TIMEOUT when the game has only 1 player and they time out', async () => {
    const now = 1000;
    mockQueuePlayers['chat1_user1'] = {
      chatId: 'chat1',
      userId: 'user1',
      turnOrder: 1,
      skipCount: 0,
      isExcluded: 0,
      lastTurnAt: now,
    };

    // User2 (who is not in the queue) attempts to roll out of turn after 20 seconds.
    // The sole expected player (user1) times out, and since they are the only player, it triggers SOLE_PLAYER_TIMEOUT.
    const res = await evaluateStrictTurn('chat1', 'user2', 'Pasha', now + 20, null, now);
    expect(res.status).toBe(StrictTurnStatus.SOLE_PLAYER_TIMEOUT);
  });

  it('triggers SINGLE_PLAYER_WIN when exclusions leave only 1 active player', async () => {
    const now = 1000;
    mockQueuePlayers['chat1_user1'] = {
      chatId: 'chat1',
      userId: 'user1',
      turnOrder: 1,
      skipCount: 0,
      isExcluded: 0,
      lastTurnAt: now,
    };
    mockQueuePlayers['chat1_user2'] = {
      chatId: 'chat1',
      userId: 'user2',
      turnOrder: 2,
      skipCount: 2, // Next skip excludes them
      isExcluded: 0,
      lastTurnAt: now - 5,
    };

    // expected player user2 times out. Once excluded, only user1 remains.
    // user1 (who is rolling now) should trigger SINGLE_PLAYER_WIN.
    const res = await evaluateStrictTurn('chat1', 'user1', 'Yegor', now + 20, null, now);
    expect(res.status).toBe(StrictTurnStatus.SINGLE_PLAYER_WIN);
    expect(res.winnerId).toBe('user1');
    expect(res.winnerName).toBe('Yegor Feoktistov');
    expect(res.skippedPlayers).toBeDefined();
    expect(res.skippedPlayers!.length).toBe(1);
    expect(res.skippedPlayers![0].displayName).toBe('Pasha');
    expect(res.skippedPlayers![0].isExcluded).toBe(true);
  });
});
