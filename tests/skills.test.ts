import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from 'sdk';
import { getUserSkillText, recordSkillUsed } from '../src/services/skills.service.js';
import type { UserStatRecord, SkillUserRecord } from '../src/types/models.js';

let mockUserStats: Record<string, UserStatRecord> = {};
let mockSkillUsers: Record<string, SkillUserRecord> = {};

describe('Skills Service', () => {
  beforeEach(() => {
    mockUserStats = {};
    mockSkillUsers = {};

    vi.spyOn(db, 'insert').mockImplementation(
      (tbl: { name?: string }) =>
        ({
          values: (val: Record<string, unknown>) => ({
            onConflictDoUpdate: (opts: { set?: Record<string, unknown> }) => ({
              run: async () => {
                if (tbl && tbl.name === 'chat_user_stats') {
                  const updated = { ...val, ...(opts.set || {}) };
                  mockUserStats[`${val.chatId}_${val.userId}`] =
                    updated as unknown as UserStatRecord;
                }
                if (tbl && tbl.name === 'chat_skill_users') {
                  mockSkillUsers[`${val.chatId}_${val.userId}`] = val as unknown as SkillUserRecord;
                }
              },
            }),
          }),
        }) as unknown as ReturnType<typeof db.insert>
    );

    vi.spyOn(db, 'select').mockImplementation(
      () =>
        ({
          from: (tbl: { name?: string }) => ({
            where: () => ({
              run: async () => {
                if (tbl && tbl.name === 'chat_user_stats') return Object.values(mockUserStats);
                if (tbl && tbl.name === 'chat_skill_users') return Object.values(mockSkillUsers);
                return [];
              },
            }),
          }),
        }) as unknown as ReturnType<typeof db.select>
    );
  });

  it('returns null when user has no class', async () => {
    const res = await getUserSkillText('chat1', 'user1');
    expect(res).toBeNull();
  });

  it('returns skill text when user has a class and no session', async () => {
    mockUserStats['chat1_user1'] = {
      chatId: 'chat1',
      userId: 'user1',
      displayName: 'Pasha',
      classIndex: 2,
      wins: 0,
    } as unknown as UserStatRecord;

    const res = await getUserSkillText('chat1', 'user1');
    expect(res).not.toBeNull();
    expect(res!.alreadyUsed).toBe(false);
    expect(res!.skillText).toBe('Членомант: "Я призываю силу Члена!"');
  });

  it('returns alreadyUsed false when user has not used skill', async () => {
    mockUserStats['chat1_user1'] = {
      chatId: 'chat1',
      userId: 'user1',
      displayName: 'Pasha',
      classIndex: 1,
      wins: 0,
    } as unknown as UserStatRecord;

    const res = await getUserSkillText('chat1', 'user1');
    expect(res).not.toBeNull();
    expect(res!.alreadyUsed).toBe(false);
  });

  it('returns alreadyUsed true when user has used skill', async () => {
    mockUserStats['chat1_user1'] = {
      chatId: 'chat1',
      userId: 'user1',
      displayName: 'Pasha',
      classIndex: 3,
      wins: 0,
    } as unknown as UserStatRecord;

    mockSkillUsers['chat1_user1'] = {
      chatId: 'chat1',
      userId: 'user1',
    };

    const res = await getUserSkillText('chat1', 'user1');
    expect(res).not.toBeNull();
    expect(res!.alreadyUsed).toBe(true);
  });

  it('records skill used for a user', async () => {
    await recordSkillUsed('chat1', 'user1');
    expect(mockSkillUsers['chat1_user1']).toBeDefined();
  });

  it('returns null for invalid class index', async () => {
    mockUserStats['chat1_user1'] = {
      chatId: 'chat1',
      userId: 'user1',
      displayName: 'Pasha',
      classIndex: 99,
      wins: 0,
    } as unknown as UserStatRecord;

    const res = await getUserSkillText('chat1', 'user1');
    expect(res).toBeNull();
  });
});
