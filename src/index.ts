import dotenv from 'dotenv';
import messageHandler from './handlers/message.js';

dotenv.config();

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;

if (!TOKEN) {
  console.error('Error: TELEGRAM_BOT_TOKEN environment variable not set in .env file.');
  process.exit(1);
}

async function registerCommands() {
  console.log('Registering bot commands with Telegram...');
  const commands = [
    { command: 'chlen', description: 'Испытать удачу' },
    { command: 'chlenboard', description: 'Таблица лидеров' },
    { command: 'longestchlen', description: 'Самая долгая игра' },
    { command: 'chlenclasses', description: 'Классы в игре' },
    { command: 'becomechlen', description: 'Выбрать класс' },
    { command: 'whichchlen', description: 'Посмотреть свой класс' },
    { command: 'chlensub', description: 'Подписаться на уведомления о старте' },
    { command: 'chlenunsub', description: 'Отписаться от уведомлений о старте' },
    { command: 'chlenskill', description: 'Использовать способность класса' },
    { command: 'chlenqueue', description: 'Настроить режим очередности' },
    { command: 'start', description: 'Инструкция к игре' },
  ];

  try {
    await fetch(`https://api.telegram.org/bot${TOKEN}/setMyCommands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commands }),
    });
    console.log('Commands successfully registered!');
  } catch (err) {
    console.error('Failed to register commands:', err);
  }
}

async function startPolling() {
  await registerCommands();

  console.log('Dropping pending updates...');
  let offset = 0;
  try {
    const initRes = await fetch(`https://api.telegram.org/bot${TOKEN}/getUpdates?offset=-1`);
    const initData = (await initRes.json()) as { result?: { update_id: number }[] };
    if (initData.result && initData.result.length > 0) {
      offset = initData.result[initData.result.length - 1].update_id + 1;
    }
  } catch (err) {
    console.warn('Could not drop pending updates:', err);
  }

  console.log('Bot is starting long polling on Node.js...');

  while (true) {
    try {
      const res = await fetch(
        `https://api.telegram.org/bot${TOKEN}/getUpdates?offset=${offset}&timeout=30`
      );
      const data = (await res.json()) as {
        result?: { update_id: number; message?: unknown }[];
      };

      if (data.result && Array.isArray(data.result)) {
        for (const update of data.result) {
          offset = update.update_id + 1;
          if (update.message) {
            await messageHandler(update.message as any);
          }
        }
      }
    } catch (err) {
      console.error('Polling error:', err);
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
}

startPolling();
