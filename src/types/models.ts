export interface ChatRecord {
  id: string;
  title: string;
  createdAt?: Date | number;
}

export interface UserRecord {
  id: string;
  firstName: string;
  lastName?: string | null;
  username?: string | null;
  updatedAt?: Date | number;
}

export interface UserStatRecord {
  chatId: string;
  userId: string;
  wins: number;
  displayName: string;
  classIndex: number | null;
}

export interface SubscriberRecord {
  chatId: string;
  userId: string;
  username: string;
}

export interface GameSessionRecord {
  chatId: string;
  isActive: number;
  lastUserId: string | null;
  sessionMessagesCount: number;
  sessionEndedAt: number | null;
  warnedUserIds: string;
  skillUserIds: string;
}

export interface LongestSessionRecord {
  chatId?: string;
  messagesCount: number;
  winnerId?: string;
  winnerDisplayName: string;
  endedAt: string;
}
