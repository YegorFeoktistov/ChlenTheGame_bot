import { api } from 'sdk';
import { pluralizeTurns } from '../utils/pluralize.js';
import { cleanUsername } from './user.service.js';

export async function sendGameStartNotification(
  chatId: string,
  subscribers: string[]
): Promise<void> {
  let subText = '';
  if (subscribers && subscribers.length > 0) {
    const subList = subscribers.map((u) => `@${cleanUsername(u)}`);
    const verb = subList.length === 1 ? 'лови' : 'ловите';
    subText = `\n${subList.join(' ')} - ${verb} Член!`;
  }
  await api.sendMessage({
    chat_id: chatId,
    text: `Член - игра началась!${subText}`,
  });
}

export async function sendSkipNotifications(
  chatId: string,
  skippedPlayers: Array<{ displayName: string; isExcluded: boolean; nextUserMention?: string }>,
  ignoreNextMention = false
): Promise<void> {
  for (const skipped of skippedPlayers) {
    if (skipped.isExcluded) {
      await api.sendMessage({
        chat_id: chatId,
        text: `Обнаружен натурал - ${skipped.displayName}! Выполнить Приказ 69!`,
      });
      if (skipped.nextUserMention && !ignoreNextMention) {
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

export async function sendGameEndNotification(
  chatId: string,
  status: string,
  winnerName?: string | null,
  turnsCount?: number,
  newRecord?: boolean
): Promise<void> {
  if (status === 'sole_player_timeout') {
    await api.sendMessage({
      chat_id: chatId,
      text: 'Никто не осмелился сыграть с тобой в Член. Игра окончена.',
    });
  } else if (status === 'all_excluded') {
    await api.sendMessage({
      chat_id: chatId,
      text: 'Все участники признаны натуралами! Вы расстроили Член. Игра окончена.',
    });
  } else if (status === 'single_player_win' || winnerName) {
    const turnStr = pluralizeTurns(turnsCount || 0);
    const recordMsg = newRecord ? ' (Новый рекорд! 🚀)' : '';
    await api.sendMessage({
      chat_id: chatId,
      text:
        `Член - игра окончена! Победитель - ${winnerName}\n` +
        `Игра длилась ${turnStr}${recordMsg}`,
    });
  }
}
