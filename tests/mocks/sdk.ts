export const api = {
  sendMessage: async () => ({ ok: true }),
};

export const db = {
  select: () => ({
    from: () => ({
      where: () => ({
        orderBy: () => ({
          run: async () => [],
        }),
        run: async () => [],
      }),
      run: async () => [],
    }),
  }),
  insert: () => ({
    values: () => ({
      onConflictDoUpdate: () => ({
        run: async () => [],
      }),
      run: async () => [],
    }),
  }),
  update: () => ({
    set: () => ({
      where: () => ({
        run: async () => [],
      }),
    }),
  }),
  delete: () => ({
    where: () => ({
      run: async () => [],
    }),
  }),
  $count: async () => 0,
};
