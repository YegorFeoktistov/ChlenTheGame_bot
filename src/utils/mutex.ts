const chatLocks = new Map<string, Promise<void>>();

/**
 * Sequential execution lock (Mutex) per chatId.
 * Guarantees that concurrent messages within the same Telegram chat are processed sequentially FIFO,
 * eliminating race conditions and SQLite lock contention. Automatically cleans up map entries when idle.
 */
export async function withChatLock<T>(chatId: string, fn: () => Promise<T>): Promise<T> {
  const previousLock = chatLocks.get(chatId) || Promise.resolve();

  let release: () => void;
  const nextLock = new Promise<void>((resolve) => {
    release = resolve;
  });

  chatLocks.set(
    chatId,
    previousLock.then(() => nextLock)
  );

  try {
    await previousLock;
    return await fn();
  } finally {
    if (chatLocks.get(chatId) === nextLock) {
      chatLocks.delete(chatId);
    }
    release!();
  }
}
