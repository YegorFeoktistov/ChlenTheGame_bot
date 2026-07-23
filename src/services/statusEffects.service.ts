import { db } from 'sdk';
import { chatStatusEffectUsers } from '../schema.js';
import { eq, and, sql } from 'sdk/db';
import type { StatusEffectUserRecord } from '../types/models.js';

export async function addStatusEffect(
  chatId: string,
  userId: string,
  statusEffectId: string
): Promise<void> {
  await db
    .insert(chatStatusEffectUsers)
    .values({ chatId, userId, statusEffectId, count: 1 })
    .onConflictDoUpdate({
      target: [
        chatStatusEffectUsers.chatId,
        chatStatusEffectUsers.userId,
        chatStatusEffectUsers.statusEffectId,
      ],
      set: { count: sql`count + 1` },
    })
    .run();
}

export async function getStatusEffects(
  chatId: string,
  userId: string
): Promise<StatusEffectUserRecord[]> {
  const rows = (await db
    .select()
    .from(chatStatusEffectUsers)
    .where(and(eq(chatStatusEffectUsers.chatId, chatId), eq(chatStatusEffectUsers.userId, userId)))
    .run()) as StatusEffectUserRecord[];

  return rows;
}

export async function hasStatusEffect(
  chatId: string,
  userId: string,
  statusEffectId: string
): Promise<boolean> {
  const rows = (await db
    .select()
    .from(chatStatusEffectUsers)
    .where(
      and(
        eq(chatStatusEffectUsers.chatId, chatId),
        eq(chatStatusEffectUsers.userId, userId),
        eq(chatStatusEffectUsers.statusEffectId, statusEffectId)
      )
    )
    .run()) as StatusEffectUserRecord[];

  return rows.length > 0;
}

export async function removeStatusEffect(
  chatId: string,
  userId: string,
  statusEffectId: string
): Promise<void> {
  const rows = (await db
    .select()
    .from(chatStatusEffectUsers)
    .where(
      and(
        eq(chatStatusEffectUsers.chatId, chatId),
        eq(chatStatusEffectUsers.userId, userId),
        eq(chatStatusEffectUsers.statusEffectId, statusEffectId)
      )
    )
    .run()) as StatusEffectUserRecord[];

  const row = rows[0];
  if (!row) return;

  if (row.count <= 1) {
    await db
      .delete(chatStatusEffectUsers)
      .where(
        and(
          eq(chatStatusEffectUsers.chatId, chatId),
          eq(chatStatusEffectUsers.userId, userId),
          eq(chatStatusEffectUsers.statusEffectId, statusEffectId)
        )
      )
      .run();
  } else {
    await db
      .update(chatStatusEffectUsers)
      .set({ count: row.count - 1 })
      .where(
        and(
          eq(chatStatusEffectUsers.chatId, chatId),
          eq(chatStatusEffectUsers.userId, userId),
          eq(chatStatusEffectUsers.statusEffectId, statusEffectId)
        )
      )
      .run();
  }
}

export async function clearAllStatusEffects(chatId: string): Promise<void> {
  await db.delete(chatStatusEffectUsers).where(eq(chatStatusEffectUsers.chatId, chatId)).run();
}
