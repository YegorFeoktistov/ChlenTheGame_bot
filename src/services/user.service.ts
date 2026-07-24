import { db } from 'sdk';
import { chats, users, chatSubscribers } from '../schema.js';
import { eq, and } from 'sdk/db';

import type { SubscriberRecord } from '../types/models.js';

export function cleanUsername(username: string): string {
  if (!username) return '';
  return username.replace(/^@+/, '');
}

export function formatDisplayName(firstName: string, lastName?: string | null): string {
  let name = firstName || 'Игрок';
  if (lastName) {
    name += ` ${lastName}`;
  }
  if (name.startsWith('@')) {
    name = cleanUsername(name);
  }
  return name.trim();
}

export async function ensureUserAndChat(
  chatId: string,
  chatTitle: string | undefined,
  userId: string,
  firstName: string,
  lastName?: string | null,
  username?: string | null
): Promise<void> {
  const now = new Date();

  // Upsert Chat
  await db
    .insert(chats)
    .values({
      id: chatId,
      title: chatTitle || 'Chat',
      createdAt: now,
    })
    .onConflictDoUpdate({
      target: chats.id,
      set: { title: chatTitle || 'Chat' },
    })
    .run();

  // Upsert User
  await db
    .insert(users)
    .values({
      id: userId,
      firstName: firstName,
      lastName: lastName || null,
      username: username || null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: users.id,
      set: {
        firstName: firstName,
        lastName: lastName || null,
        username: username || null,
        updatedAt: now,
      },
    })
    .run();
}

export async function subscribeUser(
  chatId: string,
  userId: string,
  username: string
): Promise<void> {
  const cleaned = cleanUsername(username);
  await db
    .insert(chatSubscribers)
    .values({
      chatId,
      userId,
      username: cleaned,
    })
    .onConflictDoUpdate({
      target: [chatSubscribers.chatId, chatSubscribers.userId],
      set: { username: cleaned },
    })
    .run();
}

export async function unsubscribeUser(chatId: string, userId: string): Promise<void> {
  await db
    .delete(chatSubscribers)
    .where(and(eq(chatSubscribers.chatId, chatId), eq(chatSubscribers.userId, userId)))
    .run();
}

export async function getSubscribers(chatId: string): Promise<string[]> {
  const rows = (await db
    .select()
    .from(chatSubscribers)
    .where(eq(chatSubscribers.chatId, chatId))
    .run()) as SubscriberRecord[];

  return rows.map((r) => r.username).filter(Boolean);
}
