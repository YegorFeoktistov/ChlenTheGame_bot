import json
import os
import random
import datetime
import time

def pluralize_turns(n):
    """Pluralize turns/messages in Russian."""
    if n % 10 == 1 and n % 100 != 11:
        return f"{n} ход"
    elif 2 <= n % 10 <= 4 and (n % 100 < 10 or n % 100 >= 20):
        return f"{n} хода"
    else:
        return f"{n} ходов"

class GameStateManager:
    def __init__(self, state_file="game_state.json"):
        self.state_file = state_file
        self.states = {}
        self.load_state()

    def load_state(self):
        """Loads game state from a JSON file. Handles file not found or corrupted JSON."""
        if os.path.exists(self.state_file):
            try:
                with open(self.state_file, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    # Convert chat_states keys to strings and ensure structures are correct
                    self.states = {str(k): v for k, v in data.get("chat_states", {}).items()}
            except (json.JSONDecodeError, IOError) as e:
                # If reading fails, initialize as empty to protect against crashes
                self.states = {}
        else:
            self.states = {}

    def save_state(self):
        """Saves game state to a JSON file."""
        try:
            with open(self.state_file, 'w', encoding='utf-8') as f:
                json.dump({"chat_states": self.states}, f, ensure_ascii=False, indent=4)
        except IOError as e:
            # Log issue or print to stderr (can be captured in logs)
            print(f"Error saving game state: {e}")

    def get_chat_state(self, chat_id):
        """Gets or initializes the state for a specific chat."""
        chat_key = str(chat_id)
        if chat_key not in self.states:
            self.states[chat_key] = {
                "game_active": False,
                "last_user_id": None,
                "warned_users": [],
                "leaderboard": {},
                "current_session_messages": 0,
                "longest_session": None,
                "session_ended_at": None,
                "subscribers": {}
            }
        else:
            # Ensure backward compatibility for pre-existing state files
            if "leaderboard" not in self.states[chat_key]:
                self.states[chat_key]["leaderboard"] = {}
            if "current_session_messages" not in self.states[chat_key]:
                self.states[chat_key]["current_session_messages"] = 0
            if "longest_session" not in self.states[chat_key]:
                self.states[chat_key]["longest_session"] = None
            if "session_ended_at" not in self.states[chat_key]:
                self.states[chat_key]["session_ended_at"] = None
            if "subscribers" not in self.states[chat_key]:
                self.states[chat_key]["subscribers"] = {}
        return self.states[chat_key]

    def handle_command(self, chat_id, user_id, user_display_name, roll_override=None, force_win=False):
        """
        Handles the /chlen command for a given chat and user.
        
        Args:
            chat_id (str/int): The Telegram chat ID.
            user_id (int): The Telegram user ID.
            user_display_name (str): The display name/username of the user.
            roll_override (float): Optional override for the random roll (used for testing).
            
        Returns:
            dict: Instructions for the bot on how to respond.
        """
        chat_key = str(chat_id)
        state = self.get_chat_state(chat_key)

        # 1. Cooldown/turn verification (no user can send multiple times in a row)
        if state["last_user_id"] is not None and user_id == state["last_user_id"]:
            if user_id in state["warned_users"]:
                # Silently ignore spam
                return {"status": "ignored"}
            else:
                # Issue warning and register the user as warned
                state["warned_users"].append(user_id)
                self.save_state()
                return {"status": "warning"}

        # 2. Check session cooldown if starting a new game (before changing turn history)
        game_started = False
        new_record = False
        turns = 0
        if not state["game_active"]:
            if state.get("session_ended_at") is not None and not force_win:
                elapsed = time.time() - state["session_ended_at"]
                if elapsed < 10:
                    return {"status": "session_cooldown"}
                else:
                    state["session_ended_at"] = None
            state["game_active"] = True
            game_started = True

        # 3. Valid command execution (update turn history)
        state["warned_users"] = []
        state["last_user_id"] = user_id

        # Track turn count for the current session
        if game_started:
            state["current_session_messages"] = 1
        else:
            state["current_session_messages"] += 1

        # Roll outcome (10% probability of "Я победил"), but cannot win on the first turn of a session unless forced
        if game_started and not force_win:
            outcome = "Член"
            game_ended = False
        else:
            roll = roll_override if roll_override is not None else random.random()
            if roll < 0.1 or force_win:
                outcome = "Я победил"
                state["game_active"] = False
                state["last_user_id"] = None  # Reset last user so anyone can start the next session!
                state["warned_users"] = []    # Reset warned users
                state["session_ended_at"] = time.time()  # Record session end time
                game_ended = True

                # Record win in leaderboard
                leaderboard = state["leaderboard"]
                user_key = str(user_id)
                if user_key in leaderboard:
                    leaderboard[user_key]["wins"] += 1
                    leaderboard[user_key]["name"] = user_display_name
                else:
                    leaderboard[user_key] = {
                        "name": user_display_name,
                        "wins": 1
                    }

                # Update longest session stats
                turns = state["current_session_messages"]
                longest = state.get("longest_session")
                if longest is None or turns > longest["messages"]:
                    new_record = True
                    ended_at = datetime.datetime.now().strftime("%d.%m.%Y %H:%M")
                    state["longest_session"] = {
                        "messages": turns,
                        "winner_name": user_display_name,
                        "ended_at": ended_at
                    }
            else:
                outcome = "Член"
                game_ended = False


        self.save_state()

        return {
            "status": "success",
            "game_started": game_started,
            "outcome": outcome,
            "game_ended": game_ended,
            "winner_name": user_display_name if game_ended else None,
            "turns": turns,
            "new_record": new_record
        }

    def get_leaderboard_text(self, chat_id):
        """
        Generates a sorted leaderboard text for the chat.
        
        Args:
            chat_id (str/int): The Telegram chat ID.
            
        Returns:
            str: Pluralized and sorted leaderboard table.
        """
        state = self.get_chat_state(chat_id)
        leaderboard = state.get("leaderboard", {})

        if not leaderboard:
            return "🏆 В этом чате еще нет победителей! Начните игру с команды /chlen"

        # Sort users by win count descending
        sorted_users = sorted(leaderboard.values(), key=lambda x: x["wins"], reverse=True)

        def pluralize_wins(n):
            if n % 10 == 1 and n % 100 != 11:
                return f"{n} победа"
            elif 2 <= n % 10 <= 4 and (n % 100 < 10 or n % 100 >= 20):
                return f"{n} победы"
            else:
                return f"{n} побед"

        lines = ["🏆 Таблица лидеров игры \"Член: the Game\":\n"]
        for idx, user_data in enumerate(sorted_users, 1):
            name = user_data["name"]
            if name.startswith("@"):
                name = name.lstrip("@")
            wins = user_data["wins"]
            lines.append(f"{idx}. {name} — {pluralize_wins(wins)}")

        return "\n".join(lines)

    def get_longest_session_text(self, chat_id):
        """
        Generates a formatted text showing the longest game session.
        
        Args:
            chat_id (str/int): The Telegram chat ID.
            
        Returns:
            str: Pluralized longest session details.
        """
        state = self.get_chat_state(chat_id)
        longest = state.get("longest_session")
        if not longest:
            return "🏆 В этом чате еще не было завершенных игр!"

        messages = longest["messages"]
        winner = longest["winner_name"]
        if winner.startswith("@"):
            winner = winner.lstrip("@")
        ended_at = longest["ended_at"]

        return (
            f"🏆 Самая долгая игра в этом чате:\n\n"
            f"💬 Количество ходов: {pluralize_turns(messages)}\n"
            f"👑 Победитель: {winner}\n"
            f"📅 Дата окончания: {ended_at}"
        )

    def subscribe_user(self, chat_id, user_id, username):
        """Subscribes a user to session starts in a chat."""
        state = self.get_chat_state(chat_id)
        state["subscribers"][str(user_id)] = username
        self.save_state()

    def unsubscribe_user(self, chat_id, user_id):
        """Unsubscribes a user from session starts in a chat."""
        state = self.get_chat_state(chat_id)
        user_key = str(user_id)
        if user_key in state["subscribers"]:
            del state["subscribers"][user_key]
            self.save_state()

    def get_subscribers(self, chat_id):
        """Gets subscribers for a chat."""
        state = self.get_chat_state(chat_id)
        return state["subscribers"]
