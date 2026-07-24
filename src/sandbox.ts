process.env.REPL_MODE = 'true';

import readline from 'readline';
import { db } from './adapters/db.js';
import { users, chats, chatGameSessions } from './schema.js';
import messageHandler from './handlers/message.js';
import type { UserRecord } from './types/models.js';
import { processTurnTimeout } from './services/timer.service.js';
import { TURN_TIMEOUT_SECONDS } from './utils/constants.js';

const nameToUser = new Map<string, UserRecord>();
let currentChatId = 'chat_test';
let currentChatTitle = 'Тестовый Чат';

async function refreshUsers() {
  const allUsers = (await db.select().from(users).run()) as UserRecord[];
  nameToUser.clear();
  for (const user of allUsers) {
    if (user.firstName) {
      nameToUser.set(user.firstName.toLowerCase(), user);
    }
  }
}

async function startSandbox() {
  await refreshUsers();

  // Ensure default chat exists in the database
  await db
    .insert(chats)
    .values({
      id: currentChatId,
      title: currentChatTitle,
      queueMode: 1,
    })
    .onConflictDoUpdate({
      target: [chats.id],
      set: { title: currentChatTitle },
    })
    .run();

  console.log('\n\x1b[36m====================================================\x1b[0m');
  console.log('\x1b[36m⚡️ ДОБРО ПОЖАЛОВАТЬ В ЛОКАЛЬНУЮ ПЕСОЧНИЦУ ЧЛЕН-БОТА ⚡️\x1b[0m');
  console.log('\x1b[36m====================================================\x1b[0m\n');

  if (nameToUser.size > 0) {
    const names = Array.from(nameToUser.values())
      .map((u) => u.firstName)
      .join(', ');
    console.log(`Загружены сохраненные пользователи: \x1b[33m${names}\x1b[0m`);
    console.log(`\x1b[32mСимуляция готова! Начните вводить команды от лица игроков.\x1b[0m\n`);
  } else {
    console.log('\x1b[33mВ базе данных еще нет пользователей.\x1b[0m');
    console.log('Для начала зарегистрируйте их с помощью: \x1b[35m:setup Имя1 Имя2 ...\x1b[0m\n');
  }

  console.log(`Текущий чат: \x1b[35m${currentChatTitle} (${currentChatId})\x1b[0m`);
  console.log('\x1b[33mФормат отправки сообщений:\x1b[0m Имя_игрока команда');
  console.log('  \x1b[90mПример:\x1b[0m Егор член');
  console.log('  \x1b[90mПример:\x1b[0m Паша /chlenskill');
  console.log('  \x1b[90mПример:\x1b[0m Олег chlenqueue\n');
  console.log('Дополнительные системные команды:');
  console.log('  \x1b[35m:setup Имя1 Имя2 ...\x1b[0m  — Зарегистрировать новых игроков');
  console.log('  \x1b[35m:chat НазваниеЧата\x1b[0m    — Сменить или создать групповой чат');
  console.log('  \x1b[35m:timeout\x1b[0m              — Симулировать таймаут хода (15 секунд)');
  console.log('  \x1b[35m:exit\x1b[0m                 — Выйти из песочницы\n');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '\x1b[36msandbox>\x1b[0m ',
  });

  rl.prompt();

  rl.on('line', async (line) => {
    const input = line.trim();
    if (!input) {
      rl.prompt();
      return;
    }

    if (input.startsWith(':')) {
      const [cmd, ...args] = input.split(/\s+/);
      if (cmd === ':exit') {
        console.log('\nВыход из песочницы. До встречи!');
        process.exit(0);
      } else if (cmd === ':setup') {
        if (args.length === 0) {
          console.log(
            '\x1b[31mОшибка: укажите хотя бы одно имя (например, :setup Егор Паша)\x1b[0m\n'
          );
        } else {
          for (const name of args) {
            const userId = `user_${name.toLowerCase()}`;
            await db
              .insert(users)
              .values({
                id: userId,
                firstName: name,
                lastName: null,
                username: `${name.toLowerCase()}_handle`,
                updatedAt: new Date(),
              })
              .onConflictDoUpdate({
                target: [users.id],
                set: { firstName: name },
              })
              .run();
          }
          await refreshUsers();
          const names = Array.from(nameToUser.values())
            .map((u) => u.firstName)
            .join(', ');
          console.log(`\x1b[32mУспешно зарегистрировано! Текущие пользователи: ${names}\x1b[0m\n`);
        }
      } else if (cmd === ':chat') {
        const chatName = args.join(' ');
        if (!chatName) {
          console.log(
            '\x1b[31mОшибка: укажите название чата (например, :chat Разработка)\x1b[0m\n'
          );
        } else {
          currentChatId = `chat_${chatName.toLowerCase()}`;
          currentChatTitle = `${chatName} Чат`;
          await db
            .insert(chats)
            .values({
              id: currentChatId,
              title: currentChatTitle,
              queueMode: 1,
            })
            .onConflictDoUpdate({
              target: [chats.id],
              set: { title: currentChatTitle },
            })
            .run();
          console.log(
            `\x1b[32mПереключено на чат: ${currentChatTitle} (${currentChatId})\x1b[0m\n`
          );
        }
      } else if (cmd === ':timeout') {
        console.log(`\x1b[33m⏳ Симулируем таймаут для чата ${currentChatId}...\x1b[0m`);
        try {
          // Shift session turn start time backwards so the timeout condition triggers immediately
          const nowUnix = Math.floor(Date.now() / 1000);
          const fakeStart = nowUnix - TURN_TIMEOUT_SECONDS - 1;
          await db
            .insert(chatGameSessions)
            .values({
              chatId: currentChatId,
              isActive: 1,
              lastUserId: null,
              sessionMessagesCount: 0,
              sessionEndedAt: null,
              currentTurnStartedAt: fakeStart,
            })
            .onConflictDoUpdate({
              target: chatGameSessions.chatId,
              set: { currentTurnStartedAt: fakeStart },
            })
            .run();
          await processTurnTimeout(currentChatId);
        } catch (err) {
          console.error('\x1b[31mОшибка во время симуляции таймаута:\x1b[0m', err);
        }
      } else {
        console.log(`\x1b[31mНеизвестная системная команда: ${cmd}\x1b[0m\n`);
      }
      rl.prompt();
      return;
    }

    // Process game command: "Name Command"
    const match = input.match(/^([^\s]+)\s+(.+)$/);
    if (match) {
      const nameKey = match[1].toLowerCase();
      let text = match[2].trim();
      const userObj = nameToUser.get(nameKey);

      if (userObj) {
        const lowerText = text.toLowerCase();
        if (!text.startsWith('/') && lowerText !== 'член' && lowerText !== 'chlen') {
          text = '/' + text;
        }

        console.log(`\x1b[34m👤 [${userObj.firstName}]:\x1b[0m ${text}`);

        const messagePayload = {
          message_id: Math.floor(Math.random() * 100000),
          date: Math.floor(Date.now() / 1000),
          text: text,
          chat: {
            id: currentChatId,
            title: currentChatTitle,
            type: 'group',
          },
          from: {
            id: userObj.id,
            first_name: userObj.firstName,
            last_name: userObj.lastName,
            username: userObj.username,
            is_bot: false,
          },
        };

        try {
          await messageHandler(messagePayload as any);
        } catch (err) {
          console.error('\x1b[31mОшибка во время обработки команды:\x1b[0m', err);
        }
      } else {
        console.log(
          `\x1b[31mПользователь "${match[1]}" не найден. Зарегистрируйте его с помощью: :setup ${match[1]}\x1b[0m\n`
        );
      }
    } else {
      console.log(
        '\x1b[31mНеверный формат ввода. Введите команду в формате "Имя команда" (например: "Егор член").\x1b[0m\n'
      );
    }

    rl.prompt();
  });
}

startSandbox().catch((err) => {
  console.error('Ошибка запуска песочницы:', err);
});
