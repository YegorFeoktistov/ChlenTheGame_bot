import { describe, it, expect, vi, beforeEach } from 'vitest';
import { api } from 'sdk';
import {
  sendGameStartNotification,
  sendSkipNotifications,
  sendGameEndNotification,
} from '../src/services/notification.service.js';

describe('Notification Service', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('sendGameStartNotification', () => {
    it('sends start message without subscribers', async () => {
      const spy = vi.spyOn(api, 'sendMessage');
      await sendGameStartNotification('chat1', []);

      expect(spy).toHaveBeenCalledWith({
        chat_id: 'chat1',
        text: 'Член - игра началась!',
      });
    });

    it('sends start message with subscribers and sanitizes handles', async () => {
      const spy = vi.spyOn(api, 'sendMessage');
      await sendGameStartNotification('chat1', ['@Pasha', 'Yegor']);

      expect(spy).toHaveBeenCalledWith({
        chat_id: 'chat1',
        text: 'Член - игра началась!\n@Pasha @Yegor - ловите Член!',
      });
    });

    it('uses singular verb for single subscriber', async () => {
      const spy = vi.spyOn(api, 'sendMessage');
      await sendGameStartNotification('chat1', ['Pasha']);

      expect(spy).toHaveBeenCalledWith({
        chat_id: 'chat1',
        text: 'Член - игра началась!\n@Pasha - лови Член!',
      });
    });
  });

  describe('sendSkipNotifications', () => {
    it('sends notifications for excluded player with next mention', async () => {
      const spy = vi.spyOn(api, 'sendMessage');
      await sendSkipNotifications('chat1', [
        { displayName: 'Pasha', isExcluded: true, nextUserMention: '@Yegor' },
      ]);

      expect(spy).toHaveBeenNthCalledWith(1, {
        chat_id: 'chat1',
        text: 'Обнаружен натурал - Pasha! Выполнить Приказ 69!',
      });
      expect(spy).toHaveBeenNthCalledWith(2, {
        chat_id: 'chat1',
        text: 'Ход переходит к @Yegor.',
      });
    });

    it('sends notifications for excluded player and ignores next mention if flag set', async () => {
      const spy = vi.spyOn(api, 'sendMessage');
      await sendSkipNotifications(
        'chat1',
        [{ displayName: 'Pasha', isExcluded: true, nextUserMention: '@Yegor' }],
        true
      );

      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith({
        chat_id: 'chat1',
        text: 'Обнаружен натурал - Pasha! Выполнить Приказ 69!',
      });
    });

    it('sends notification for normal skip with next mention', async () => {
      const spy = vi.spyOn(api, 'sendMessage');
      await sendSkipNotifications('chat1', [
        { displayName: 'Pasha', isExcluded: false, nextUserMention: '@Yegor' },
      ]);

      expect(spy).toHaveBeenCalledWith({
        chat_id: 'chat1',
        text: 'Pasha - ты обронил Член!\nСледующим ходит @Yegor.',
      });
    });

    it('does not send notification for normal skip without next mention', async () => {
      const spy = vi.spyOn(api, 'sendMessage');
      await sendSkipNotifications('chat1', [{ displayName: 'Pasha', isExcluded: false }]);

      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe('sendGameEndNotification', () => {
    it('sends end message for sole player timeout', async () => {
      const spy = vi.spyOn(api, 'sendMessage');
      await sendGameEndNotification('chat1', 'sole_player_timeout');

      expect(spy).toHaveBeenCalledWith({
        chat_id: 'chat1',
        text: 'Никто не осмелился сыграть с тобой в Член. Игра окончена.',
      });
    });

    it('sends end message for all excluded', async () => {
      const spy = vi.spyOn(api, 'sendMessage');
      await sendGameEndNotification('chat1', 'all_excluded');

      expect(spy).toHaveBeenCalledWith({
        chat_id: 'chat1',
        text: 'Все участники признаны натуралами! Вы расстроили Член. Игра окончена.',
      });
    });

    it('sends win message with regular text', async () => {
      const spy = vi.spyOn(api, 'sendMessage');
      await sendGameEndNotification('chat1', 'success', 'Pasha', 5, false);

      expect(spy).toHaveBeenCalledWith({
        chat_id: 'chat1',
        text: 'Член - игра окончена! Победитель - Pasha\nИгра длилась 5 ходов',
      });
    });

    it('sends win message with record text', async () => {
      const spy = vi.spyOn(api, 'sendMessage');
      await sendGameEndNotification('chat1', 'success', 'Pasha', 12, true);

      expect(spy).toHaveBeenCalledWith({
        chat_id: 'chat1',
        text: 'Член - игра окончена! Победитель - Pasha\nИгра длилась 12 ходов (Новый рекорд! 🚀)',
      });
    });
  });
});
