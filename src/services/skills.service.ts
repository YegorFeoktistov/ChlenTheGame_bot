import { db } from 'sdk';
import { chatGameSessions, chatUserStats } from '../schema.js';
import { eq, and } from 'sdk/db';
import { CHLEN_CLASS_SKILLS, ChlenClass } from '../utils/constants.js';
import type { GameSessionRecord } from '../types/models.js';

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
  const classValues = Object.values(ChlenClass).filter(
    (v): v is ChlenClass => typeof v === 'string'
  );
  if (!classIndex || classIndex < 1 || classIndex > classValues.length) {
    return null;
  }

  const skillText = CHLEN_CLASS_SKILLS[classValues[classIndex - 1]];

  const sessionRows = (await db
    .select()
    .from(chatGameSessions)
    .where(eq(chatGameSessions.chatId, chatId))
    .run()) as GameSessionRecord[];

  const session = sessionRows[0];
  if (!session) {
    return { skillText, alreadyUsed: false };
  }

  const skillsUsed: string[] = [];
  try {
    if (session.skillsUsed) {
      const parsed = JSON.parse(session.skillsUsed);
      if (Array.isArray(parsed)) {
        skillsUsed.push(...parsed);
      }
    }
  } catch {
    // ignore
  }

  const alreadyUsed = skillsUsed.includes(userId);

  return { skillText, alreadyUsed };
}

export async function recordSkillUsed(chatId: string, userId: string): Promise<void> {
  const sessionRows = (await db
    .select()
    .from(chatGameSessions)
    .where(eq(chatGameSessions.chatId, chatId))
    .run()) as GameSessionRecord[];

  const session = sessionRows[0];
  if (!session) {
    return;
  }

  const skillsUsed: string[] = [];
  try {
    if (session.skillsUsed) {
      const parsed = JSON.parse(session.skillsUsed);
      if (Array.isArray(parsed)) {
        skillsUsed.push(...parsed);
      }
    }
  } catch {
    // ignore
  }

  if (!skillsUsed.includes(userId)) {
    skillsUsed.push(userId);
    await db
      .insert(chatGameSessions)
      .values({
        chatId,
        isActive: session.isActive,
        lastUserId: session.lastUserId,
        sessionMessagesCount: session.sessionMessagesCount,
        sessionEndedAt: session.sessionEndedAt,
        warnedUserIds: session.warnedUserIds,
        skillsUsed: JSON.stringify(skillsUsed),
      })
      .onConflictDoUpdate({
        target: chatGameSessions.chatId,
        set: { skillsUsed: JSON.stringify(skillsUsed) },
      })
      .run();
  }
}
