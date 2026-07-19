# Chlen: the Game - Telegram Bot

Telegram bot for group chats running a fun interactive turn-based luck game.

## Game Rules
1. **Starting the Game**: The very first time anyone sends `/chlen` (or writes the word `член` in the chat) in a group chat, the bot starts a new game session and announces: `Член - игра началась!`.
2. **Turns**: When a user submits the `/chlen` command (or sends `член` as plain text, which is case-insensitive), they automatically roll for an outcome (a player cannot win on the very first command starting a session):
   - **90% Probability**: The bot replies with `Член`.
   - **10% Probability**: The bot replies with `Я победил`.
3. **Ending the Game**: When a user rolls `Я победил`, the game session ends. The bot announces: `Член - игра окончена! Победитель - {username}`. Cooldown turn tracking is reset upon session end.
4. **Subsequent Games**: Sending `/chlen` or `член` after a game session has ended starts a new session.
5. **Anti-Spam / Turn Order**:
   - One user cannot send the command multiple times in a row.
   - If a user tries to send the command consecutively, the first retry is met with the warning: `Дождись очереди`.
   - All subsequent spam attempts by the same user are **silently ignored** until someone else sends a command.
   - Once another player runs the command, the previous player is allowed to play again.
6. **Leaderboard**: Sending the `/chlenboard` command displays the scoreboard of wins in the group chat, sorted from highest to lowest.
7. **Longest Session**: Sending the `/longestchlen` command displays statistics on the longest completed game session in the chat (number of turns, winner name, and ending date/time).
8. **Session Cooldown**: Once a session ends, there is a 10-second cooldown before a new game session can be started. Any attempt to start a session within this window triggers the warning: `Дай члену отдохнуть`.
9. **Subscriptions**: Users can subscribe to receive notifications when a new game session starts.
   - `/chlensub`: Subscribes the user (requires them to have a Telegram username set in their profile). The bot replies: `{username} подписался на Член. Уважаемый мужчина!`
   - `/chlenunsub`: Unsubscribes the user. The bot replies: `{username} отписался от Члена. Ты что натурал?`
   - When a session starts, all subscribers are tagged on a new line: `{usernames} - лови(те) Член!` ("лови" is used for one subscriber, and "ловите" for multiple).

---

## Command Suggestions
The bot automatically configures the command suggestions menu in Telegram when it starts up (via `post_init` registration). The available commands are:
- `/chlen` - Испытать удачу в игре
- `/chlenboard` - Посмотреть таблицу лидеров
- `/longestchlen` - Посмотреть самую долгую игру
- `/chlensub` - Подписаться на уведомления о старте
- `/chlenunsub` - Отписаться от уведомлений о старте
- `/start` - Прочитать инструкцию


## Installation & Setup

### Prerequisites
- Python 3.9+ (tested with Python 3.9.6)
- A Telegram Bot Token. Create one by messaging [@BotFather](https://t.me/BotFather) on Telegram. Make sure to **disable Group Privacy** if you want the bot to see commands without being mentioned (alternatively, users will need to run `/chlen@YourBotUsername`).

### Steps
1. **Clone/extract the repository** and open the project directory.

2. **Create a Virtual Environment & Install Dependencies**:
   ```bash
   python3 -m venv venv
   source venv/bin/activate
   pip install -r requirements.txt
   ```

3. **Configure Environment Variables**:
   - Copy `.env.example` to `.env`:
     ```bash
     cp .env.example .env
     ```
   - Edit `.env` and fill in your `TELEGRAM_BOT_TOKEN`:
     ```env
     TELEGRAM_BOT_TOKEN=123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ
     ```

---

## Running the Bot

To start the bot, run:
```bash
# Ensure virtual env is active
source venv/bin/activate

# Start the bot
python3 bot.py
```

---

## Running Unit Tests

We have a comprehensive unit test suite covering the game state manager, cooldowns, and session resets. To execute the tests, run:
```bash
python3 -m unittest test_game.py
```
