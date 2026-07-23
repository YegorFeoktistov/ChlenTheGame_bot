import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from 'sdk';
import {
  getUserSkillText,
  recordSkillUsed,
  applyWeaknessToTarget,
} from '../src/services/skills.service.js';
import type { UserStatRecord, SkillUserRecord } from '../src/types/models.js';

let mockUserStats: Record<string, UserStatRecord> = {};
let mockSkillUsers: Record<string, SkillUserRecord> = {};
let mockUsers: Record<string, any> = {};
let mockStatusEffects: Record<string, any> = {};

describe('Skills Service', () => {
  beforeEach(() => {
    mockUserStats = {};
    mockSkillUsers = {};
    mockUsers = {};
    mockStatusEffects = {};

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
                if (tbl && tbl.name === 'users') {
                  mockUsers[String(val.id)] = { ...val };
                }
                if (tbl && tbl.name === 'chat_status_effect_users') {
                  const key = `${String(val.chatId)}_${String(val.userId)}_${String(val.statusEffectId)}`;
                  if (mockStatusEffects[key]) {
                    mockStatusEffects[key].count += 1;
                  } else {
                    mockStatusEffects[key] = {
                      chatId: String(val.chatId),
                      userId: String(val.userId),
                      statusEffectId: String(val.statusEffectId),
                      count: 1,
                    };
                  }
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
                if (tbl && tbl.name === 'users') return Object.values(mockUsers);
                if (tbl && tbl.name === 'chat_status_effect_users')
                  return Object.values(mockStatusEffects);
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

  describe('applyWeaknessToTarget', () => {
    beforeEach(() => {
      mockUsers = {};
      mockStatusEffects = {};
    });

    it('applies weakness to target by @username', async () => {
      mockUsers['target1'] = {
        id: 'target1',
        username: 'targetuser',
        firstName: 'Target',
        lastName: null,
      };

      const res = await applyWeaknessToTarget('chat1', 'user1', '@targetuser');
      expect(res.success).toBe(true);
      expect(res.message).toContain('Target');
      expect(res.message).toContain('Членослабость');

      const key = 'chat1_target1_' + 'Членослабость';
      expect(mockStatusEffects[key]).toBeDefined();
      expect(mockStatusEffects[key].count).toBe(1);
    });

    it('applies weakness to target by numeric ID', async () => {
      mockUsers['2'] = { id: '2', username: null, firstName: 'Numeric', lastName: null };

      const res = await applyWeaknessToTarget('chat1', 'user1', '2');
      expect(res.success).toBe(true);
      expect(res.message).toContain('Numeric');

      const key = 'chat1_2_Членослабость';
      expect(mockStatusEffects[key]).toBeDefined();
      expect(mockStatusEffects[key].count).toBe(1);
    });

    it('fails when target not found', async () => {
      const res = await applyWeaknessToTarget('chat1', 'user1', '@nonexistent');
      expect(res.success).toBe(false);
      expect(res.message).toContain('Цель не найдена');
    });

    it('fails when targeting self', async () => {
      mockUsers['user1'] = { id: 'user1', username: 'me', firstName: 'Self', lastName: null };

      const res = await applyWeaknessToTarget('chat1', 'user1', '@me');
      expect(res.success).toBe(false);
      expect(res.message).toContain('Нельзя наложить Членослабость на себя');
    });

    it('stacks multiple weakness instances', async () => {
      mockUsers['target3'] = {
        id: 'target3',
        username: 'stackuser',
        firstName: 'Stack',
        lastName: null,
      };

      const res1 = await applyWeaknessToTarget('chat1', 'user1', '@stackuser');
      expect(res1.success).toBe(true);

      const res2 = await applyWeaknessToTarget('chat1', 'user2', '@stackuser');
      expect(res2.success).toBe(true);

      const key = 'chat1_target3_Членослабость';
      expect(mockStatusEffects[key].count).toBe(2);
    });
  });
});
