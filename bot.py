import os
import sys
import logging
from dotenv import load_dotenv
from telegram import Update, BotCommand
from telegram.ext import ApplicationBuilder, CommandHandler, ContextTypes, MessageHandler, filters
from game import GameStateManager

# Configure logging
logging.basicConfig(
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    level=logging.INFO,
    handlers=[
        logging.StreamHandler(sys.stdout)
    ]
)
logger = logging.getLogger(__name__)

# Load environment variables from .env
load_dotenv()
TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")

# Initialize the game manager
manager = GameStateManager()

# Secret easter egg feature toggle
YEGOR_LOVE_FEATURE = False

async def chlen_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handler for the /chlen command."""
    if not update.message or not update.effective_chat or not update.effective_user:
        return

    chat_id = update.effective_chat.id
    user = update.effective_user
    user_id = user.id

    # Format the user's name/surname (no username tagging)
    username = user.first_name
    if user.last_name:
        username += f" {user.last_name}"

    logger.info(f"Received /chlen from user_id={user_id} ({username}) in chat_id={chat_id}")

    cleaned_text = update.message.text.strip().lower() if update.message.text else ""
    force_win = YEGOR_LOVE_FEATURE and cleaned_text in ("i love yegor", "yegor is my best friend")

    # Process the command logic
    res = manager.handle_command(chat_id, user_id, username, force_win=force_win)
    status = res.get("status")

    if status == "ignored":
        # Silently ignore spam
        logger.info(f"Ignored spam command from user_id={user_id}")
        return

    if status == "warning":
        # Send one-time warning message "Дождись очереди"
        logger.info(f"Sent cooldown warning to user_id={user_id}")
        await update.message.reply_text("Дождись очереди")
        return

    if status == "session_cooldown":
        # Send cooldown warning "Дай члену отдохнуть."
        logger.info(f"Sent session cooldown warning in chat_id={chat_id}")
        await update.message.reply_text("Дай члену отдохнуть")
        return

    if status == "success":
        # Announce start of game session if it was just triggered
        if res.get("game_started"):
            logger.info(f"New game session started in chat_id={chat_id}")
            subscribers = manager.get_subscribers(chat_id)
            sub_text = ""
            if subscribers:
                sub_list = [f"@{u.lstrip('@')}" for u in subscribers.values() if u]
                if sub_list:
                    verb = "лови" if len(sub_list) == 1 else "ловите"
                    sub_text = f"\n{' '.join(sub_list)} - {verb} Член!"
            await context.bot.send_message(
                chat_id=chat_id,
                text=f"Член - игра началась!{sub_text}"
            )

        # Post the main outcome message (either "Член" or "Я победил") as a reply to the user.
        # However, if they typed plain text "член", do not post "Член" to avoid chat clutter.
        outcome = res.get("outcome")
        logger.info(f"Game outcome for user_id={user_id}: {outcome}")
        
        is_command = update.message.text.startswith("/") if update.message.text else True
        if outcome == "Я победил" or is_command:
            await update.message.reply_text(outcome)

        # Announce end of game session if winner rolled
        if res.get("game_ended"):
            winner_name = res.get("winner_name")
            turns = res.get("turns", 0)
            new_record = res.get("new_record", False)

            from game import pluralize_turns
            turn_str = pluralize_turns(turns)
            record_msg = " (Новый рекорд! 🚀)" if new_record else ""

            logger.info(f"Game session ended in chat_id={chat_id}. Winner: {winner_name}")
            await context.bot.send_message(
                chat_id=chat_id,
                text=f"Член - игра окончена! Победитель - {winner_name}\n"
                     f"Игра длилась {turn_str}{record_msg}"
            )

async def chlenboard_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handler for the /chlenboard command."""
    if not update.message or not update.effective_chat:
        return
    chat_id = update.effective_chat.id
    logger.info(f"Received /chlenboard request in chat_id={chat_id}")
    text = manager.get_leaderboard_text(chat_id)
    await update.message.reply_text(text)

async def longestchlen_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handler for the /longestchlen command."""
    if not update.message or not update.effective_chat:
        return
    chat_id = update.effective_chat.id
    logger.info(f"Received /longestchlen request in chat_id={chat_id}")
    text = manager.get_longest_session_text(chat_id)
    await update.message.reply_text(text)

async def chlensub_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handler for the /chlensub command."""
    if not update.message or not update.effective_chat or not update.effective_user:
        return

    chat_id = update.effective_chat.id
    user = update.effective_user
    user_id = user.id
    telegram_username = user.username

    # Format the user's name/surname (display name)
    display_name = user.first_name
    if user.last_name:
        display_name += f" {user.last_name}"

    logger.info(f"Received /chlensub from user_id={user_id} ({display_name}) in chat_id={chat_id}")

    if not telegram_username:
        await update.message.reply_text(
            "Для подписки на уведомления необходимо установить никнейм (username) в настройках Телеграма."
        )
        return

    manager.subscribe_user(chat_id, user_id, telegram_username)

    await update.message.reply_text(
        f"{display_name} подписался на Член. Уважаемый мужчина!"
    )

async def chlenunsub_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handler for the /chlenunsub command."""
    if not update.message or not update.effective_chat or not update.effective_user:
        return

    chat_id = update.effective_chat.id
    user = update.effective_user
    user_id = user.id

    display_name = user.first_name
    if user.last_name:
        display_name += f" {user.last_name}"

    logger.info(f"Received /chlenunsub from user_id={user_id} ({display_name}) in chat_id={chat_id}")

    manager.unsubscribe_user(chat_id, user_id)

    await update.message.reply_text(
        f"{display_name} отписался от Члена. Ты что натурал?"
    )

async def text_message_handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handler to capture plain text messages like 'член' and route them as /chlen."""
    if not update.message or not update.message.text:
        return
    
    cleaned_text = update.message.text.strip().lower()
    if cleaned_text == "член":
        logger.info(f"Routing plain text message '{update.message.text}' as /chlen command")
        await chlen_command(update, context)
    elif YEGOR_LOVE_FEATURE and cleaned_text in ("i love yegor", "yegor is my best friend"):
        logger.info(f"Routing secret win phrase '{update.message.text}'")
        await chlen_command(update, context)

async def start_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handler for the /start command."""
    if not update.message:
        return
    logger.info(f"Received /start from user_id={update.effective_user.id if update.effective_user else 'unknown'}")
    await update.message.reply_text(
        "Член - игра началась!\n\n"
        "Отправь команду /chlen в групповом чате, чтобы испытать удачу. "
        "Каждый ход дает тебе 10% шанс выиграть. Но помни: ты не можешь ходить дважды подряд!\n\n"
        "Доступные команды:\n"
        "/chlenboard - посмотреть таблицу лидеров\n"
        "/longestchlen - посмотреть статистику самой долгой игры"
    )

async def post_init(application) -> None:
    """Register bot commands for suggestions in the client UI on startup."""
    logger.info("Registering command suggestions with Telegram...")
    await application.bot.set_my_commands([
        BotCommand("chlen", "Испытать удачу"),
        BotCommand("chlenboard", "Таблица лидеров"),
        BotCommand("longestchlen", "Самая долгая игра"),
        BotCommand("chlensub", "Подписаться на уведомления о старте"),
        BotCommand("chlenunsub", "Отписаться от уведомлений о старте"),
        BotCommand("start", "Инструкция к игре")
    ])

def main() -> None:
    """Main entry point to start the bot."""
    if not TOKEN:
        logger.error("Error: TELEGRAM_BOT_TOKEN environment variable not set in .env file.")
        sys.exit(1)

    logger.info("Initializing Telegram bot application...")
    # Build python-telegram-bot application with post_init registration
    app = ApplicationBuilder().token(TOKEN).post_init(post_init).build()

    # Register handlers
    app.add_handler(CommandHandler("chlen", chlen_command))
    app.add_handler(CommandHandler("chlenboard", chlenboard_command))
    app.add_handler(CommandHandler("longestchlen", longestchlen_command))
    app.add_handler(CommandHandler("chlensub", chlensub_command))
    app.add_handler(CommandHandler("chlenunsub", chlenunsub_command))
    app.add_handler(CommandHandler("start", start_command))
    # Route plain text messages (e.g. "член") to text_message_handler
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, text_message_handler))

    logger.info("Bot is starting polling...")
    app.run_polling(drop_pending_updates=True)

if __name__ == "__main__":
    main()

