import { db } from 'sdk';
import { chatUserStats, chatSkillUsers, users } from '../schema.js';
import { eq, and } from 'sdk/db';
import { CHLEN_CLASS_SKILLS, ChlenClass, StatusEffectId } from '../utils/constants.js';
import type { SkillUserRecord, UserRecord } from '../types/models.js';
import { addStatusEffect } from './statusEffects.service.js';
import { formatDisplayName, cleanUsername } from './user.service.js';

export async function getUserSkillText(
  chatId: string,
  userId: string
): Promise<{ skillText: string; alreadyUsed: boolean } | null> {
  const userStatsRows = (await db
    .select()
    .from(chatUserStats)
    .where(and(eq(chatUserStats.chatId, chatId), eq(chatUserStats.userId, userId)))
    .run()) as { classIndex: number | null }[];

  const classIndex = userStatsRows[0]?.classIndex;
  const classValues = Object.values(ChlenClass);

  if (!classIndex || classIndex < 1 || classIndex > classValues.length) {
    return null;
  }

  const skillText = CHLEN_CLASS_SKILLS[classValues[classIndex - 1]];

  const skillRows = (await db
    .select()
    .from(chatSkillUsers)
    .where(and(eq(chatSkillUsers.chatId, chatId), eq(chatSkillUsers.userId, userId)))
    .run()) as SkillUserRecord[];

  const alreadyUsed = skillRows && skillRows.length > 0;

  return { skillText, alreadyUsed };
}

export async function recordSkillUsed(chatId: string, userId: string): Promise<void> {
  await db
    .insert(chatSkillUsers)
    .values({ chatId, userId })
    .onConflictDoUpdate({
      target: [chatSkillUsers.chatId, chatSkillUsers.userId],
      set: { chatId, userId },
    })
    .run();
}

export interface TargetResult {
  success: boolean;
  message: string;
}

export async function applyWeaknessToTarget(
  chatId: string,
  userId: string,
  targetText: string
): Promise<TargetResult> {
  let targetUserId: string | null = null;

  if (targetText.startsWith('@')) {
    const username = cleanUsername(targetText).toLowerCase();
    const userRows = (await db
      .select()
      .from(users)
      .where(and(eq(users.username, username)))
      .run()) as UserRecord[];
    if (userRows.length > 0) {
      targetUserId = userRows[0].id;
    }
  } else if (/^\d+$/.test(targetText)) {
    targetUserId = targetText;
  }

  if (!targetUserId) {
    return { success: false, message: 'Цель не найдена. Укажите @username или ID пользователя.' };
  }

  if (targetUserId === userId) {
    return { success: false, message: 'Нельзя наложить Членослабость на себя!' };
  }

  await addStatusEffect(chatId, targetUserId, StatusEffectId.WEAKNESS);

  const targetRows = (await db
    .select()
    .from(users)
    .where(and(eq(users.id, targetUserId)))
    .run()) as UserRecord[];

  const targetName =
    targetRows.length > 0
      ? formatDisplayName(targetRows[0].firstName, targetRows[0].lastName)
      : 'Неизвестный пользователь';

  return {
    success: true,
    message: `${targetName} получил Членослабость! Шанс победы уменьшен в 2 раза.`,
  };
}
