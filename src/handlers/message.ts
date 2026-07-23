import { api, db } from 'sdk';
import {
  formatDisplayName,
  ensureUserAndChat,
  subscribeUser,
  unsubscribeUser,
  getSubscribers,
} from '../services/user.service.js';
import { handleGameCommand, abortGameSession } from '../services/game.service.js';
import { getLeaderboardText, getLongestSessionText } from '../services/stats.service.js';
import { getClassesText, setUserClass, getUserClass } from '../services/class.service.js';
import { pluralizeTurns, pluralizeSeconds } from '../utils/pluralize.js';
import {
  getUserSkillText,
  recordSkillUsed,
  applyWeaknessToTarget,
} from '../services/skills.service.js';
import { getQueueMode, setQueueMode } from '../services/queue.service.js';
import { chatGameSessions } from '../schema.js';
import { eq } from 'sdk/db';
import { CommandStatus, ChlenClass } from '../utils/constants.js';
import { withChatLock } from '../utils/mutex.js';
import type { TelegramMessage } from '../types/sdk.d.js';

export default async function (message: TelegramMessage) {
  if (!message || !message.chat || !message.from || !message.text) {
    return;
  }

  const chatId = String(message.chat.id);
  const chatTitle = message.chat.title || message.chat.first_name || 'Chat';
  const userId = String(message.from.id);
  const firstName = message.from.first_name || 'Игрок';
  const lastName = message.from.last_name || null;
  const username = message.from.username || null;
  const rawText = message.text.trim();
  const lowerText = rawText.toLowerCase();

  const userDisplayName = formatDisplayName(firstName, lastName);

  // Ensure user and chat exist in database
  await ensureUserAndChat(chatId, chatTitle, userId, firstName, lastName, username);

  // 1. Command /start
  if (lowerText.startsWith('/start')) {
    await api.sendMessage({
      chat_id: chatId,
      text:
        'Член - игра началась!\n\n' +
        'Отправь команду /chlen (или напиши "член" / "chlen") в групповом чате, чтобы испытать удачу. ' +
        'Каждый ход дает тебе 10% шанс выиграть. Но помни: ты не можешь ходить дважды подряд!\n\n' +
        'Доступные команды:\n' +
        '/chlenboard - посмотреть таблицу лидеров\n' +
        '/longestchlen - посмотреть статистику самой долгой игры\n' +
        '/chlenclasses - посмотреть классы в игре\n' +
        '/becomechlen - выбрать класс\n' +
        '/whichchlen - посмотреть свой класс\n' +
        '/chlenskill - использовать способность класса\n' +
        '/chlenqueue - переключить режим очередности (строгий/нестрогий)\n' +
        '/chlensub - подписаться на уведомления о старте\n' +
        '/chlenunsub - отписаться от уведомлений о старте',
    });
    return;
  }

  // 2. Command /chlenboard
  if (lowerText.startsWith('/chlenboard')) {
    const text = await getLeaderboardText(chatId);
    await api.sendMessage({ chat_id: chatId, text });
    return;
  }

  // 3. Command /longestchlen
  if (lowerText.startsWith('/longestchlen')) {
    const text = await getLongestSessionText(chatId);
    await api.sendMessage({ chat_id: chatId, text });
    return;
  }

  // 4. Command /chlenclasses
  if (lowerText.startsWith('/chlenclasses')) {
    const text = getClassesText();
    await api.sendMessage({ chat_id: chatId, text });
    return;
  }

  // 5. Command /becomechlen
  if (lowerText.startsWith('/becomechlen')) {
    const parts = rawText.split(/\s+/);
    if (parts.length < 2) {
      await api.sendMessage({ chat_id: chatId, text: 'Укажите индекс класса: /becomechlen 1' });
      return;
    }
    const idx = parseInt(parts[1], 10);
    if (isNaN(idx)) {
      await api.sendMessage({ chat_id: chatId, text: 'Индекс должен быть числом.' });
      return;
    }
    const assignedClass = await setUserClass(chatId, userId, userDisplayName, idx);
    if (!assignedClass) {
      await api.sendMessage({ chat_id: chatId, text: 'Неверный индекс. Доступные классы: 1-5' });
    } else {
      await api.sendMessage({ chat_id: chatId, text: `${userDisplayName} стал ${assignedClass}!` });
    }
    return;
  }

  // 6. Command /whichchlen
  if (lowerText.startsWith('/whichchlen')) {
    const cls = await getUserClass(chatId, userId);
    if (cls) {
      await api.sendMessage({ chat_id: chatId, text: `${userDisplayName} — ${cls}!` });
    } else {
      await api.sendMessage({ chat_id: chatId, text: `${userDisplayName} ещё не выбрал класс.` });
    }
    return;
  }

  // 7. Command /chlensub
  if (lowerText.startsWith('/chlensub')) {
    if (!username) {
      await api.sendMessage({
        chat_id: chatId,
        text: 'Для подписки на уведомления необходимо установить никнейм (username) в настройках Телеграма.',
      });
      return;
    }
    await subscribeUser(chatId, userId, username);
    await api.sendMessage({
      chat_id: chatId,
      text: `${userDisplayName} подписался на Член. Уважаемый мужчина!`,
    });
    return;
  }

  // 8. Command /chlenunsub
  if (lowerText.startsWith('/chlenunsub')) {
    await unsubscribeUser(chatId, userId);
    await api.sendMessage({
      chat_id: chatId,
      text: `${userDisplayName} отписался от Члена. Ты что натурал?`,
    });
    return;
  }

  // 9. Command /chlenskill
  if (lowerText.startsWith('/chlenskill')) {
    const skillResult = await getUserSkillText(chatId, userId);
    if (!skillResult) {
      await api.sendMessage({
        chat_id: chatId,
        text: `${userDisplayName} ещё не выбрал класс. Используй /becomechlen, чтобы выбрать класс.`,
      });
      return;
    }

    if (skillResult.alreadyUsed) {
      await api.sendMessage({
        chat_id: chatId,
        text: `${userDisplayName} уже использовал свою способность в этой игре!`,
        reply_to_message_id: message.message_id,
      });
      return;
    }

    await recordSkillUsed(chatId, userId);

    const skillClass = await getUserClass(chatId, userId);
    if (skillClass === ChlenClass.CHLENOKNIZHNIK) {
      const targetText = rawText.split(/\s+/).slice(1).join(' ').trim();
      const targetResult = await applyWeaknessToTarget(chatId, userId, targetText);
      if (!targetResult.success) {
        await api.sendMessage({
          chat_id: chatId,
          text: targetResult.message,
          reply_to_message_id: message.message_id,
        });
        return;
      }
      await api.sendMessage({
        chat_id: chatId,
        text: targetResult.message,
        reply_to_message_id: message.message_id,
      });
      return;
    }

    await api.sendMessage({
      chat_id: chatId,
      text: `${userDisplayName} использует способность: ${skillResult.skillText}`,
      reply_to_message_id: message.message_id,
    });
    return;
  }

  // 10. Command /chlenqueue
  if (lowerText.startsWith('/chlenqueue')) {
    await withChatLock(chatId, async () => {
      const parts = rawText.split(/\s+/);
      const hasParam = parts.length > 1;

      // Check if session is active
      const sessionRows = (await db
        .select()
        .from(chatGameSessions)
        .where(eq(chatGameSessions.chatId, chatId))
        .run()) as { isActive?: number }[];

      const isSessionActive =
        sessionRows && sessionRows.length > 0 && sessionRows[0].isActive === 1;

      if (hasParam) {
        const modeParam = parseInt(parts[1], 10);
        if (isSessionActive && (modeParam === 0 || modeParam === 1)) {
          await api.sendMessage({
            chat_id: chatId,
            text: 'Не мешай Члену работать!',
          });
          return;
        }

        if (modeParam === 1) {
          await setQueueMode(chatId, 1);
          await api.sendMessage({ chat_id: chatId, text: 'Включен строгий Член' });
        } else if (modeParam === 0) {
          await setQueueMode(chatId, 0);
          await api.sendMessage({ chat_id: chatId, text: 'Включен нестрогий Член' });
        } else {
          await api.sendMessage({
            chat_id: chatId,
            text: 'Укажите режим: /chlenqueue 1 (строгий) или /chlenqueue 0 (нестрогий)',
          });
        }
      } else {
        const currentMode = await getQueueMode(chatId);
        const modeText = currentMode === 1 ? 'Строгий Член' : 'Нестрогий Член';
        await api.sendMessage({ chat_id: chatId, text: modeText });
      }
    });
    return;
  }

  // 11. Command /abortchlen
  if (lowerText.startsWith('/abortchlen')) {
    await withChatLock(chatId, async () => {
      const { wasActive } = await abortGameSession(chatId);
      if (wasActive) {
        await api.sendMessage({ chat_id: chatId, text: 'Вы оборвали Член. Игра окончена.' });
      } else {
        await api.sendMessage({ chat_id: chatId, text: 'Нет активного Члена.' });
      }
    });
    return;
  }

  // 12. Command /chlen OR plain text "член" / "chlen"
  const isChlenCommand =
    lowerText.startsWith('/chlen') || lowerText === 'член' || lowerText === 'chlen';
  if (!isChlenCommand) {
    return;
  }

  const res = await withChatLock(chatId, () => handleGameCommand(chatId, userId, userDisplayName));

  // Notify the chat about any skipped/excluded players
  if (res.skippedPlayers && res.skippedPlayers.length > 0) {
    for (const skipped of res.skippedPlayers) {
      if (skipped.isExcluded) {
        await api.sendMessage({
          chat_id: chatId,
          text: `Обнаружен натурал - ${skipped.displayName}! Выполнить Приказ 69!`,
        });
        if (
          skipped.nextUserMention &&
          res.status !== CommandStatus.ALL_EXCLUDED &&
          res.status !== CommandStatus.SINGLE_PLAYER_WIN
        ) {
          await api.sendMessage({
            chat_id: chatId,
            text: `Ход переходит к ${skipped.nextUserMention}.`,
          });
        }
      } else {
        if (skipped.nextUserMention) {
          await api.sendMessage({
            chat_id: chatId,
            text: `${skipped.displayName} - ты обронил Член!\nСледующим ходит ${skipped.nextUserMention}.`,
          });
        }
      }
    }
  }

  if (res.status === CommandStatus.EXCLUDED) {
    await api.sendMessage({
      chat_id: chatId,
      text: 'Натуралам вход закрыт!',
      reply_to_message_id: message.message_id,
    });
    return;
  }

  if (res.status === CommandStatus.SOLE_PLAYER_TIMEOUT) {
    await api.sendMessage({
      chat_id: chatId,
      text: 'Никто не осмелился сыграть с тобой в Член. Игра окончена.',
    });
    return;
  }

  if (res.status === CommandStatus.SINGLE_PLAYER_WIN) {
    const turnStr = pluralizeTurns(res.turns || 0);
    const recordMsg = res.newRecord ? ' (Новый рекорд! 🚀)' : '';
    await api.sendMessage({
      chat_id: chatId,
      text:
        `Член - игра окончена! Победитель - ${res.winnerName}\n` +
        `Игра длилась ${turnStr}${recordMsg}`,
    });
    return;
  }

  if (res.status === CommandStatus.ALL_EXCLUDED) {
    await api.sendMessage({
      chat_id: chatId,
      text: 'Все участники признаны натуралами! Вы расстроили Член. Игра окончена.',
    });
    return;
  }

  if (res.status === CommandStatus.IGNORED) {
    return;
  }

  if (res.status === CommandStatus.WARNING) {
    let text = 'Дождись очереди.';
    if (res.expectedUserName && res.remainingSeconds !== undefined) {
      text = `Дождись очереди. Сейчас ходит ${res.expectedUserName} (осталось ${pluralizeSeconds(res.remainingSeconds)}).`;
    }
    await api.sendMessage({
      chat_id: chatId,
      text,
      reply_to_message_id: message.message_id,
    });
    return;
  }

  if (res.status === CommandStatus.SESSION_COOLDOWN) {
    await api.sendMessage({
      chat_id: chatId,
      text: 'Дай члену отдохнуть',
      reply_to_message_id: message.message_id,
    });
    return;
  }

  if (res.status === CommandStatus.SUCCESS) {
    if (res.gameStarted) {
      const subs = await getSubscribers(chatId);
      let subText = '';
      if (subs && subs.length > 0) {
        const subList = subs.map((u) => `@${u.replace(/^@+/, '')}`);
        const verb = subList.length === 1 ? 'лови' : 'ловите';
        subText = `\n${subList.join(' ')} - ${verb} Член!`;
      }
      await api.sendMessage({ chat_id: chatId, text: `Член - игра началась!${subText}` });
    }

    const isCommand = rawText.startsWith('/');
    if (res.outcome === 'Я победил' || isCommand) {
      await api.sendMessage({
        chat_id: chatId,
        text: res.outcome || 'Член',
        reply_to_message_id: message.message_id,
      });
    }

    if (res.gameEnded) {
      const turnStr = pluralizeTurns(res.turns || 0);
      const recordMsg = res.newRecord ? ' (Новый рекорд! 🚀)' : '';
      await api.sendMessage({
        chat_id: chatId,
        text:
          `Член - игра окончена! Победитель - ${res.winnerName}\n` +
          `Игра длилась ${turnStr}${recordMsg}`,
      });
    }
  }
}
