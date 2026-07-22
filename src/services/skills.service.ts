import { db } from 'sdk';
import { chatUserStats, chatSkillUsers } from '../schema.js';
import { eq, and } from 'sdk/db';
import { CHLEN_CLASS_SKILLS, ChlenClass } from '../utils/constants.js';
import type { SkillUserRecord } from '../types/models.js';

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
