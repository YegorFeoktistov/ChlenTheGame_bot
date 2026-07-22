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

  const skillUserIds: string[] = [];
  try {
    if (session.skillUserIds) {
      const parsed = JSON.parse(session.skillUserIds);
      if (Array.isArray(parsed)) {
        skillUserIds.push(...parsed);
      }
    }
  } catch {
    // ignore
  }

  const alreadyUsed = skillUserIds.includes(userId);

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

  const skillUserIds: string[] = [];
  try {
    if (session.skillUserIds) {
      const parsed = JSON.parse(session.skillUserIds);
      if (Array.isArray(parsed)) {
        skillUserIds.push(...parsed);
      }
    }
  } catch {
    // ignore
  }

  if (!skillUserIds.includes(userId)) {
    skillUserIds.push(userId);
    await db
      .insert(chatGameSessions)
      .values({
        chatId,
        isActive: session.isActive,
        lastUserId: session.lastUserId,
        sessionMessagesCount: session.sessionMessagesCount,
        sessionEndedAt: session.sessionEndedAt,
        warnedUserIds: session.warnedUserIds,
        skillUserIds: JSON.stringify(skillUserIds),
      })
      .onConflictDoUpdate({
        target: chatGameSessions.chatId,
        set: { skillUserIds: JSON.stringify(skillUserIds) },
      })
      .run();
  }
}
