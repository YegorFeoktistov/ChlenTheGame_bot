import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from 'sdk';
import { handleGameCommand } from '../src/services/game.service.js';
import type {
  GameSessionRecord,
  UserStatRecord,
  LongestSessionRecord,
  WarnedUserRecord,
  QueuePlayerRecord,
  UserRecord,
} from '../src/types/models.js';
import { CommandStatus } from '../src/utils/constants.js';

let mockGameSessions: Record<string, GameSessionRecord> = {};
let mockUserStats: Record<string, UserStatRecord> = {};
let mockLongestSessions: Record<string, LongestSessionRecord> = {};
let mockWarnedUsers: Record<string, WarnedUserRecord> = {};
let mockQueuePlayers: Record<string, QueuePlayerRecord> = {};
let mockUsers: Record<string, UserRecord> = {};

describe('Game Engine Service', () => {
  beforeEach(() => {
    mockGameSessions = {};
    mockUserStats = {};
    mockLongestSessions = {};
    mockWarnedUsers = {};
    mockQueuePlayers = {};
    mockUsers = {
      user1: {
        id: 'user1',
        firstName: 'Yegor',
        lastName: null,
        username: 'yegor_handle',
        updatedAt: 0,
      },
      user2: {
        id: 'user2',
        firstName: 'SecondPerson',
        lastName: null,
        username: null,
        updatedAt: 0,
      },
    };

    vi.spyOn(db, 'insert').mockImplementation(
      (tbl: { name?: string }) =>
        ({
          values: (val: Record<string, unknown>) => ({
            onConflictDoUpdate: (opts: { set?: Record<string, unknown> }) => ({
              run: async () => {
                if (tbl && tbl.name === 'chat_game_sessions') {
                  const updated = {
                    ...(mockGameSessions[val.chatId as string] || {}),
                    ...val,
                    ...(opts.set || {}),
                  };
                  mockGameSessions[val.chatId as string] = updated as GameSessionRecord;
                }
                if (tbl && tbl.name === 'chat_user_stats') {
                  const updated = { ...val, ...(opts.set || {}) };
                  mockUserStats[`${val.chatId}_${val.userId}`] =
                    updated as unknown as UserStatRecord;
                }
                if (tbl && tbl.name === 'chat_longest_sessions') {
                  const updated = { ...val, ...(opts.set || {}) };
                  mockLongestSessions[val.chatId as string] =
                    updated as unknown as LongestSessionRecord;
                }
                if (tbl && tbl.name === 'chat_warned_users') {
                  mockWarnedUsers[`${val.chatId}_${val.userId}`] =
                    val as unknown as WarnedUserRecord;
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
      (tbl: { name?: string }) =>
        ({
          where: () => ({
            run: async () => {
              if (!tbl || tbl.name === 'chat_warned_users') {
                mockWarnedUsers = {};
              }
              if (!tbl || tbl.name === 'chat_queue_players') {
                mockQueuePlayers = {};
              }
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
                if (tbl && tbl.name === 'users') {
                  if (cond && typeof cond === 'object') {
                    const condStr = JSON.stringify(cond);
                    if (condStr.includes('user1')) return [mockUsers.user1];
                    if (condStr.includes('user2')) return [mockUsers.user2];
                  }
                  return Object.values(mockUsers);
                }
                if (tbl && tbl.name === 'chat_game_sessions')
                  return Object.values(mockGameSessions);
                if (tbl && tbl.name === 'chat_user_stats') return Object.values(mockUserStats);
                if (tbl && tbl.name === 'chat_longest_sessions')
                  return Object.values(mockLongestSessions);
                if (tbl && tbl.name === 'chat_warned_users') return Object.values(mockWarnedUsers);
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

  it('prevents winning on turn 1 of a new session or on player first move', async () => {
    const res = await handleGameCommand('chat1', 'user1', 'Pasha', 0.05); // Winning roll (5%)
    expect(res.status).toBe(CommandStatus.SUCCESS);
    expect(res.gameStarted).toBe(true);
    expect(res.gameEnded).toBe(false);
    expect(res.outcome).toBe('Член');
  });

  it('warns user on consecutive move and ignores repeat moves', async () => {
    // Turn 1
    await handleGameCommand('chat1', 'user1', 'Pasha', 0.5);

    // Turn 2 by same user -> should get warning
    const warnRes = await handleGameCommand('chat1', 'user1', 'Pasha', 0.5);
    expect(warnRes.status).toBe(CommandStatus.WARNING);

    // Repeat turn by same user -> ignored
    const ignoreRes = await handleGameCommand('chat1', 'user1', 'Pasha', 0.5);
    expect(ignoreRes.status).toBe(CommandStatus.IGNORED);
  });

  it('enforces 10-second cooldown between games', async () => {
    // Start game (turn 1 - Pasha 1st move)
    await handleGameCommand('chat1', 'user1', 'Pasha', 0.5);
    // Turn 2 by user2 (Yegor 1st move)
    await handleGameCommand('chat1', 'user2', 'Yegor', 0.5);
    // Turn 3 by user1 (Pasha 2nd move with winning roll -> game ends)
    await handleGameCommand('chat1', 'user1', 'Pasha', 0.05);

    // Attempt to start a new game immediately -> cooldown
    const res = await handleGameCommand('chat1', 'user1', 'Pasha', 0.5);
    expect(res.status).toBe(CommandStatus.SESSION_COOLDOWN);
  });

  it('updates stats and sets longest record on game win', async () => {
    // Turn 1 (Pasha - 1st move)
    await handleGameCommand('chat1', 'user1', 'Pasha', 0.5);
    // Turn 2 (Yegor - 1st move)
    await handleGameCommand('chat1', 'user2', 'Yegor', 0.5);
    // Turn 3 (Pasha - 2nd move - winning roll)
    const winRes = await handleGameCommand('chat1', 'user1', 'Pasha', 0.05);

    expect(winRes.status).toBe(CommandStatus.SUCCESS);
    expect(winRes.gameEnded).toBe(true);
    expect(winRes.winnerName).toBe('Pasha');
    expect(winRes.turns).toBe(3);
    expect(winRes.newRecord).toBe(true);
  });

  it('correctly handles real multi-player playtest scenario in strict queue mode', async () => {
    // Turn 1: User 1 (Yegor) starts the game
    const res1 = await handleGameCommand('chat1', 'user1', 'Yegor', 0.5);
    expect(res1.status).toBe(CommandStatus.SUCCESS);
    expect(res1.gameStarted).toBe(true);
    expect(res1.gameEnded).toBe(false);

    // Turn 2: User 2 (SecondPerson) joins game immediately -> MUST BE SUCCESS (VALID JOIN)
    const res2 = await handleGameCommand('chat1', 'user2', 'SecondPerson', 0.5);
    expect(res2.status).toBe(CommandStatus.SUCCESS);
    expect(res2.gameEnded).toBe(false);

    // Turn 3: User 2 tries to make a 2nd consecutive move -> MUST BE WARNING
    const res3 = await handleGameCommand('chat1', 'user2', 'SecondPerson', 0.5);
    expect(res3.status).toBe(CommandStatus.WARNING);
    expect(res3.expectedUserName).toBe('Yegor');

    // Turn 4: User 1 makes their 2nd move -> MUST BE SUCCESS
    const res4 = await handleGameCommand('chat1', 'user1', 'Yegor', 0.5);
    expect(res4.status).toBe(CommandStatus.SUCCESS);
    expect(res4.gameEnded).toBe(false);

    // Turn 5: User 2 makes their 2nd move with winning roll (5%) -> MUST WIN!
    const res5 = await handleGameCommand('chat1', 'user2', 'SecondPerson', 0.05);
    expect(res5.status).toBe(CommandStatus.SUCCESS);
    expect(res5.gameEnded).toBe(true);
    expect(res5.winnerName).toBe('SecondPerson');
  });

  it('prevents any user from winning on their very first move in non-strict mode', async () => {
    mockGameSessions = {};
    mockQueuePlayers = {};
    mockWarnedUsers = {};

    vi.spyOn(db, 'select').mockImplementation(
      () =>
        ({
          from: (tbl: { name?: string }) => ({
            where: (cond?: unknown) => ({
              run: async () => {
                if (tbl && tbl.name === 'chats')
                  return [{ id: 'chat1', title: 'Chat', queueMode: 0 }];
                if (tbl && tbl.name === 'chat_game_sessions')
                  return Object.values(mockGameSessions);
                if (tbl && tbl.name === 'chat_user_stats') return Object.values(mockUserStats);
                if (tbl && tbl.name === 'chat_longest_sessions')
                  return Object.values(mockLongestSessions);
                if (tbl && tbl.name === 'chat_warned_users') return Object.values(mockWarnedUsers);
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

    // Turn 1 (Pasha - 1st move)
    await handleGameCommand('chat1', 'user1', 'Pasha', 0.5);

    // Turn 2 (Yegor joins - 1st move with winning roll 5%) -> CANNOT WIN IN NON-STRICT MODE
    const yegorRes1 = await handleGameCommand('chat1', 'user2', 'Yegor', 0.05);
    expect(yegorRes1.status).toBe(CommandStatus.SUCCESS);
    expect(yegorRes1.gameEnded).toBe(false);
    expect(yegorRes1.outcome).toBe('Член');
  });

  it('resets session and clears queue when starting a new game after a timeout', async () => {
    // Start game
    await handleGameCommand('chat1', 'user1', 'Pasha', 0.5);
    expect(mockGameSessions['chat1']?.isActive).toBe(1);

    // Force mock abort (simulate timeout aborting session)
    mockGameSessions['chat1'] = {
      chatId: 'chat1',
      isActive: 0,
      lastUserId: null,
      sessionMessagesCount: 0,
      sessionEndedAt: 1000,
    };
    mockQueuePlayers['chat1_user1'] = {
      chatId: 'chat1',
      userId: 'user1',
      turnOrder: 1,
      skipCount: 3,
      isExcluded: 1,
      lastTurnAt: 1000,
    };

    // User 2 joins after cooldown -> Starts a fresh game session cleanly
    const res = await handleGameCommand('chat1', 'user2', 'Yegor', 0.5);
    expect(res.status).toBe(CommandStatus.SUCCESS);
    expect(res.gameStarted).toBe(true);
    // User1 was excluded previously, but starting new game should have cleared the queue
    expect(mockQueuePlayers['chat1_user1']).toBeUndefined();
  });

  it('respects non-strict mode consecutive play block', async () => {
    // Override select for this test to return queueMode = 0 (non-strict)
    vi.spyOn(db, 'select').mockImplementation(
      () =>
        ({
          from: (tbl: { name?: string }) => ({
            where: (cond?: unknown) => ({
              run: async () => {
                if (tbl && tbl.name === 'chats')
                  return [{ id: 'chat1', title: 'Chat', queueMode: 0 }];
                if (tbl && tbl.name === 'chat_game_sessions')
                  return Object.values(mockGameSessions);
                if (tbl && tbl.name === 'chat_user_stats') return Object.values(mockUserStats);
                if (tbl && tbl.name === 'chat_longest_sessions')
                  return Object.values(mockLongestSessions);
                if (tbl && tbl.name === 'chat_warned_users') return Object.values(mockWarnedUsers);
                if (tbl && tbl.name === 'chat_queue_players') {
                  const all = Object.values(mockQueuePlayers);
                  if (cond && typeof cond === 'object') {
                    const condStr = JSON.stringify(cond);
                    if (condStr.includes('user1')) return all.filter((p) => p.userId === 'user1');
                    if (condStr.includes('user2')) return all.filter((p) => p.userId === 'user2');
                  }
                  return all;
                }
                return [];
              },
            }),
          }),
        }) as unknown as ReturnType<typeof db.select>
    );

    // Turn 1: User 1 starts game
    const res1 = await handleGameCommand('chat1', 'user1', 'Yegor', 0.5);
    expect(res1.status).toBe(CommandStatus.SUCCESS);

    // Turn 2: User 2 plays
    const res2 = await handleGameCommand('chat1', 'user2', 'SecondPerson', 0.5);
    expect(res2.status).toBe(CommandStatus.SUCCESS);

    // Turn 3: User 2 plays again immediately -> warning (spam filter)
    const res3 = await handleGameCommand('chat1', 'user2', 'SecondPerson', 0.5);
    expect(res3.status).toBe(CommandStatus.WARNING);

    // Turn 4: User 1 plays -> SUCCESS (since it's a different user)
    const res4 = await handleGameCommand('chat1', 'user1', 'Yegor', 0.5);
    expect(res4.status).toBe(CommandStatus.SUCCESS);
  });
});
