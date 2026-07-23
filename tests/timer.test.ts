import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { db } from 'sdk';
import {
  scheduleTurnTimeout,
  clearTurnTimeout,
  processTurnTimeout,
  initTurnTimersOnStartup,
  activeTimers,
} from '../src/services/timer.service.js';
import { handleGameCommand, abortGameSession } from '../src/services/game.service.js';
import type { GameSessionRecord, QueuePlayerRecord, UserRecord } from '../src/types/models.js';

let mockGameSessions: Record<string, GameSessionRecord> = {};
let mockQueuePlayers: Record<string, QueuePlayerRecord> = {};
let mockUsers: Record<string, UserRecord> = {};
let mockQueueMode = 1;

describe('Timer Service & Session Abort Engine', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockGameSessions = {};
    mockQueuePlayers = {};
    mockQueueMode = 1;
    mockUsers = {
      user1: { id: 'user1', firstName: 'Yegor', username: 'yegor_handle' },
      user2: { id: 'user2', firstName: 'Pasha', username: null },
    };

    activeTimers.clear();

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
              if (!tbl || tbl.name === 'chat_queue_players') {
                mockQueuePlayers = {};
              }
            },
          }),
        }) as unknown as ReturnType<typeof db.delete>
    );

    vi.spyOn(db, 'select').mockImplementation(
      () =>
        ({
          from: (tbl: { name?: string }) => ({
            where: (cond?: unknown) => ({
              run: async () => {
                if (tbl && tbl.name === 'chats')
                  return [{ id: 'chat1', title: 'Chat', queueMode: mockQueueMode }];
                if (tbl && tbl.name === 'users') return Object.values(mockUsers);
                if (tbl && tbl.name === 'chat_game_sessions')
                  return Object.values(mockGameSessions);
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
  });

  afterEach(() => {
    vi.useRealTimers();
    activeTimers.clear();
  });

  it('schedules and clears turn timers correctly', () => {
    scheduleTurnTimeout('chat1', 15100);
    expect(activeTimers.has('chat1')).toBe(true);

    clearTurnTimeout('chat1');
    expect(activeTimers.has('chat1')).toBe(false);
  });

  it('aborts active game session correctly with /abortchlen logic', async () => {
    // Start game
    await handleGameCommand('chat1', 'user1', 'Yegor', 0.5);
    expect(mockGameSessions['chat1']?.isActive).toBe(1);

    // Abort active game
    const abortActiveRes = await abortGameSession('chat1');
    expect(abortActiveRes.wasActive).toBe(true);
    expect(mockGameSessions['chat1']?.isActive).toBe(0);
    expect(Object.keys(mockQueuePlayers).length).toBe(0);

    // Abort when no game is active -> returns wasActive: false ("Нет активного Члена.")
    const abortInactiveRes = await abortGameSession('chat1');
    expect(abortInactiveRes.wasActive).toBe(false);
  });

  it('triggers Order 69 and auto-ends session when all players are excluded', async () => {
    const now = 1000;
    mockGameSessions['chat1'] = {
      chatId: 'chat1',
      isActive: 1,
      lastUserId: 'user2',
      sessionMessagesCount: 5,
      sessionEndedAt: null,
    };
    mockQueuePlayers['chat1_user1'] = {
      chatId: 'chat1',
      userId: 'user1',
      turnOrder: 1,
      skipCount: 2, // Next timeout will make it 3 -> Order 69
      isExcluded: 0,
      lastTurnAt: now,
    };

    vi.setSystemTime((now + 20) * 1000);
    await processTurnTimeout('chat1');

    expect(mockGameSessions['chat1']?.isActive).toBe(0);
    expect(Object.keys(mockQueuePlayers).length).toBe(0);
  });

  it('handles TURN_SKIPPED in processTurnTimeout and reschedules next timer', async () => {
    const now = 1000;
    mockGameSessions['chat1'] = {
      chatId: 'chat1',
      isActive: 1,
      lastUserId: 'user2',
      sessionMessagesCount: 2,
      sessionEndedAt: null,
    };
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
      lastTurnAt: now + 1,
    };

    vi.setSystemTime((now + 20) * 1000);
    await processTurnTimeout('chat1');

    expect(mockQueuePlayers['chat1_user1']?.skipCount).toBe(1);
    expect(activeTimers.has('chat1')).toBe(true);
  });

  it('handles ORDER_69 with multiple active players remaining and reschedules timer', async () => {
    const now = 1000;
    mockGameSessions['chat1'] = {
      chatId: 'chat1',
      isActive: 1,
      lastUserId: 'user2',
      sessionMessagesCount: 2,
      sessionEndedAt: null,
    };
    mockQueuePlayers['chat1_user1'] = {
      chatId: 'chat1',
      userId: 'user1',
      turnOrder: 1,
      skipCount: 2, // 3rd skip -> Order 69
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

    vi.setSystemTime((now + 20) * 1000);
    await processTurnTimeout('chat1');

    expect(mockQueuePlayers['chat1_user1']?.isExcluded).toBe(1);
    expect(activeTimers.has('chat1')).toBe(true);
  });

  it('stops timer if queue mode is not strict (mode === 0)', async () => {
    mockQueueMode = 0;
    scheduleTurnTimeout('chat1', 15100);
    expect(activeTimers.has('chat1')).toBe(true);

    await processTurnTimeout('chat1');
    expect(activeTimers.has('chat1')).toBe(false);
  });

  it('initializes turn timers on startup for active games', async () => {
    mockGameSessions['chat1'] = {
      chatId: 'chat1',
      isActive: 1,
      lastUserId: 'user1',
      sessionMessagesCount: 1,
      sessionEndedAt: null,
    };

    await initTurnTimersOnStartup();

    expect(activeTimers.has('chat1')).toBe(true);
  });
});
