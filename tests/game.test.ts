import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from 'sdk';
import { handleGameCommand } from '../src/services/game.service.js';
import type {
  GameSessionRecord,
  UserStatRecord,
  LongestSessionRecord,
  WarnedUserRecord,
} from '../src/types/models.js';

let mockGameSessions: Record<string, GameSessionRecord> = {};
let mockUserStats: Record<string, UserStatRecord> = {};
let mockLongestSessions: Record<string, LongestSessionRecord> = {};
let mockWarnedUsers: Record<string, WarnedUserRecord> = {};

describe('Game Engine Service', () => {
  beforeEach(() => {
    mockGameSessions = {};
    mockUserStats = {};
    mockLongestSessions = {};
    mockWarnedUsers = {};

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
              mockWarnedUsers = {};
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
                if (tbl && tbl.name === 'chat_game_sessions')
                  return Object.values(mockGameSessions);
                if (tbl && tbl.name === 'chat_user_stats') return Object.values(mockUserStats);
                if (tbl && tbl.name === 'chat_longest_sessions')
                  return Object.values(mockLongestSessions);
                if (tbl && tbl.name === 'chat_warned_users') return Object.values(mockWarnedUsers);
                return [];
              },
            }),
          }),
        }) as unknown as ReturnType<typeof db.select>
    );
  });

  it('prevents winning on turn 1 of a new session', async () => {
    const res = await handleGameCommand('chat1', 'user1', 'Pasha', 0.05); // Winning roll (5%)
    expect(res.status).toBe('success');
    expect(res.gameStarted).toBe(true);
    expect(res.gameEnded).toBe(false);
    expect(res.outcome).toBe('Член');
  });

  it('warns user on consecutive move and ignores repeat moves', async () => {
    // Turn 1
    await handleGameCommand('chat1', 'user1', 'Pasha', 0.5);

    // Turn 2 by same user -> should get warning
    const warnRes = await handleGameCommand('chat1', 'user1', 'Pasha', 0.5);
    expect(warnRes.status).toBe('warning');

    // Repeat turn by same user -> ignored
    const ignoreRes = await handleGameCommand('chat1', 'user1', 'Pasha', 0.5);
    expect(ignoreRes.status).toBe('ignored');
  });

  it('enforces 10-second cooldown between games', async () => {
    // Start game (turn 1)
    await handleGameCommand('chat1', 'user1', 'Pasha', 0.5);
    // Turn 2 by user2 with winning roll
    await handleGameCommand('chat1', 'user2', 'Yegor', 0.05);

    // Attempt to start a new game immediately -> cooldown
    const res = await handleGameCommand('chat1', 'user1', 'Pasha', 0.5);
    expect(res.status).toBe('session_cooldown');
  });

  it('updates stats and sets longest record on game win', async () => {
    // Turn 1 (Pasha)
    await handleGameCommand('chat1', 'user1', 'Pasha', 0.5);
    // Turn 2 (Yegor)
    await handleGameCommand('chat1', 'user2', 'Yegor', 0.5);
    // Turn 3 (Pasha - winning roll)
    const winRes = await handleGameCommand('chat1', 'user1', 'Pasha', 0.05);

    expect(winRes.status).toBe('success');
    expect(winRes.gameEnded).toBe(true);
    expect(winRes.winnerName).toBe('Pasha');
    expect(winRes.turns).toBe(3);
    expect(winRes.newRecord).toBe(true);
  });
});
