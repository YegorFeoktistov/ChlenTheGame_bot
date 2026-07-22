# Член: the Game - Telegram Bot (v1.1.0)

Modern, high-performance Node.js & TypeScript Telegram Bot for group chats running a fun interactive turn-based luck game.

## Game Rules
1. **Starting the Game**: Sending `/chlen` (or writing the word `член` / `chlen` in plain text) starts a new game session and announces: `Член - игра началась!`.
2. **Turns**: When a user submits `/chlen` or sends `член` / `chlen` (case-insensitive plain text), they roll for an outcome (a player cannot win on the 1st command starting a session):
   - **90% Probability**: The bot replies with `Член`.
   - **10% Probability**: The bot replies with `Я победил`.
3. **Ending the Game**: When a user rolls `Я победил`, the session ends with: `Член - игра окончена! Победитель - {name}`.
4. **Queue Modes & Anti-Spam (`/chlenqueue`)**:
   - `/chlenqueue 1` (*Строгий Член*, default): Strict turn sequence enforced (`P1 -> P2 -> P3 -> P1...`).
     - **10s Timeout**: If the turn player does not respond in 10s, their turn is skipped (`{name} - ты обронил Член!\nСледующим ходит {next_name}.`).
     - **Order 69 Exclusion**: 3 skips in a session exclude the player (`Обнаружен натурал - {name}! Выполнить Приказ 69!`). Further attempts reply `Натуралам вход закрыт!`.
     - **Active Session Lock**: Changing mode during an active game is blocked with `Не мешай Члену работать!`.
   - `/chlenqueue 0` (*Нестрогий Член*): Standard anti-spam prevents consecutive turns by the same user (`Дождись очереди`).
5. **Classes & Skills System**:
   - `/chlenclasses`: View available game classes (*Членокнижник*, *Членомант*, *Членодин*, *Охотник на Члены*, *Мастер тысячи Членов*).
   - `/becomechlen <1-5>`: Choose your game class.
   - `/whichchlen`: View your assigned class.
   - `/chlenskill`: Activate your class ability once per game session.
6. **Leaderboard & Stats**:
   - `/chlenboard`: Scoreboard of wins in the group chat, sorted highest to lowest.
   - `/longestchlen`: Displays the longest completed game session record (turns, winner, date).
7. **Session Cooldown**: 10-second cooldown between games (`Дай члену отдохнуть`).
8. **Subscriptions**: `/chlensub` to subscribe to start notifications, `/chlenunsub` to unsubscribe.

---

## Installation & Setup

### Prerequisites
- Node.js 20+ (tested on Node.js v24.18.0)
- npm 10+
- Telegram Bot Token from [@BotFather](https://t.me/BotFather)

### Installation
1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Configure Environment**:
   ```bash
   cp .env.example .env
   # Set TELEGRAM_BOT_TOKEN in .env
   ```

3. **Build the Project**:
   ```bash
   npm run build
   ```

---

## Quality Suite & Testing

- **Run Unit Tests (Vitest)**:
  ```bash
  npm test
  ```
- **Check Test Coverage (>80% required)**:
  ```bash
  npm run test:coverage
  ```
- **TypeScript Type Check**:
  ```bash
  npm run typecheck
  ```
- **ESLint & Prettier**:
  ```bash
  npm run lint
  npm run format
  ```

---

## Running the Bot

### Local / Virtual Machine Execution
```bash
npm start
```

### Telegram Serverless Deployment
```bash
npm run deploy
npm run migrate
```
