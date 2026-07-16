import unittest
import os
import shutil
from game import GameStateManager

class TestGameStateManager(unittest.TestCase):
    def setUp(self):
        # Use a temporary state file for testing
        self.state_file = "test_game_state.json"
        if os.path.exists(self.state_file):
            os.remove(self.state_file)
        self.manager = GameStateManager(state_file=self.state_file)

    def tearDown(self):
        # Clean up temporary state file
        if os.path.exists(self.state_file):
            os.remove(self.state_file)

    def test_first_play_starts_session(self):
        chat_id = 100
        user_id = 1
        res = self.manager.handle_command(chat_id, user_id, "User One", roll_override=0.5)
        
        self.assertEqual(res["status"], "success")
        self.assertTrue(res["game_started"])
        self.assertEqual(res["outcome"], "Член")
        self.assertFalse(res["game_ended"])
        
        # Verify state is saved
        state = self.manager.get_chat_state(chat_id)
        self.assertTrue(state["game_active"])
        self.assertEqual(state["last_user_id"], user_id)

    def test_alternate_users_taking_turns(self):
        chat_id = 100
        
        # User 1 plays
        res1 = self.manager.handle_command(chat_id, 1, "User One", roll_override=0.5)
        self.assertEqual(res1["status"], "success")
        self.assertTrue(res1["game_started"])
        
        # User 2 plays
        res2 = self.manager.handle_command(chat_id, 2, "User Two", roll_override=0.5)
        self.assertEqual(res2["status"], "success")
        self.assertFalse(res2["game_started"])  # Session already active

        # User 1 plays again
        res3 = self.manager.handle_command(chat_id, 1, "User One", roll_override=0.5)
        self.assertEqual(res3["status"], "success")

    def test_same_user_twice_in_a_row(self):
        chat_id = 100
        
        # User 1 plays
        res1 = self.manager.handle_command(chat_id, 1, "User One", roll_override=0.5)
        self.assertEqual(res1["status"], "success")
        
        # User 1 plays again (first retry -> warning)
        res2 = self.manager.handle_command(chat_id, 1, "User One", roll_override=0.5)
        self.assertEqual(res2["status"], "warning")
        
        # User 1 plays a third time (second retry -> ignored)
        res3 = self.manager.handle_command(chat_id, 1, "User One", roll_override=0.5)
        self.assertEqual(res3["status"], "ignored")

        # User 1 plays a fourth time (ignored)
        res4 = self.manager.handle_command(chat_id, 1, "User One", roll_override=0.5)
        self.assertEqual(res4["status"], "ignored")

        # Now User 2 plays (success)
        res5 = self.manager.handle_command(chat_id, 2, "User Two", roll_override=0.5)
        self.assertEqual(res5["status"], "success")

        # User 1 plays again (now they can play since User 2 played!)
        res6 = self.manager.handle_command(chat_id, 1, "User One", roll_override=0.5)
        self.assertEqual(res6["status"], "success")

    def test_winning_rolls(self):
        chat_id = 100
        
        # First play starts the session, even with roll_override=0.01 it must NOT win
        res_start = self.manager.handle_command(chat_id, 1, "User One", roll_override=0.01)
        self.assertEqual(res_start["status"], "success")
        self.assertTrue(res_start["game_started"])
        self.assertEqual(res_start["outcome"], "Член")
        self.assertFalse(res_start["game_ended"])

        # Second play (User 2) with roll_override=0.01 -> Win!
        res = self.manager.handle_command(chat_id, 2, "Winner", roll_override=0.01)
        self.assertEqual(res["status"], "success")
        self.assertEqual(res["outcome"], "Я победил")
        self.assertTrue(res["game_ended"])
        self.assertEqual(res["winner_name"], "Winner")

        # Verify session is ended
        state = self.manager.get_chat_state(chat_id)
        self.assertFalse(state["game_active"])

    def test_new_session_after_win(self):
        chat_id = 100
        
        # User 1 starts session
        self.manager.handle_command(chat_id, 1, "User One", roll_override=0.5)
        # User 2 plays and wins
        self.manager.handle_command(chat_id, 2, "User Two", roll_override=0.01)
        
        # Bypass cooldown
        self.manager.get_chat_state(chat_id)["session_ended_at"] = None
        
        # User 2 (the winner) tries to play again (should succeed and start a new game session, because last_user_id was reset!)
        res2 = self.manager.handle_command(chat_id, 2, "User Two", roll_override=0.5)
        self.assertEqual(res2["status"], "success")
        self.assertTrue(res2["game_started"])
        self.assertEqual(res2["outcome"], "Член")

    def test_state_persistence(self):
        chat_id = 200
        
        # User 1 plays
        self.manager.handle_command(chat_id, 10, "Ten", roll_override=0.5)
        
        # Load a new manager pointing to the same file
        new_manager = GameStateManager(state_file=self.state_file)
        state = new_manager.get_chat_state(chat_id)
        self.assertTrue(state["game_active"])
        self.assertEqual(state["last_user_id"], 10)

    def test_leaderboard_tracking_and_formatting(self):
        chat_id = 500
        
        # Initial empty leaderboard check
        empty_text = self.manager.get_leaderboard_text(chat_id)
        self.assertIn("еще нет победителей", empty_text)
        
        # Play 1: User 1 starts session
        self.manager.handle_command(chat_id, 1, "User One", roll_override=0.5)
        # Play 2: User 2 wins (1 win)
        self.manager.handle_command(chat_id, 2, "User Two", roll_override=0.01)
        
        # Bypass cooldown
        self.manager.get_chat_state(chat_id)["session_ended_at"] = None
        
        # Play 3: User 1 starts session
        self.manager.handle_command(chat_id, 1, "User One", roll_override=0.5)
        # Play 4: User 2 plays (not win)
        self.manager.handle_command(chat_id, 2, "User Two", roll_override=0.5)
        # Play 5: User 1 wins (1 win)
        self.manager.handle_command(chat_id, 1, "User One", roll_override=0.01)

        # Bypass cooldown
        self.manager.get_chat_state(chat_id)["session_ended_at"] = None

        # Play 6: User 2 starts session
        self.manager.handle_command(chat_id, 2, "User Two", roll_override=0.5)
        # Play 7: User 1 wins (2 wins)
        self.manager.handle_command(chat_id, 1, "User One", roll_override=0.01)

        # Bypass cooldown
        self.manager.get_chat_state(chat_id)["session_ended_at"] = None

        # Retrieve text
        text = self.manager.get_leaderboard_text(chat_id)
        self.assertIn("1. User One — 2 победы", text)
        self.assertIn("2. User Two — 1 победа", text)
        # Check ordering: User One is first
        self.assertTrue(text.index("User One") < text.index("User Two"))

        # Verify win counts are correct in state
        state = self.manager.get_chat_state(chat_id)
        self.assertEqual(state["leaderboard"]["1"]["wins"], 2)
        self.assertEqual(state["leaderboard"]["2"]["wins"], 1)

        # Name updates correctly on subsequent wins
        self.manager.handle_command(chat_id, 2, "User Two", roll_override=0.5)
        self.manager.handle_command(chat_id, 1, "User One Updated", roll_override=0.01)
        text2 = self.manager.get_leaderboard_text(chat_id)
        self.assertIn("User One Updated", text2)
        self.assertNotIn("User One —", text2)

    def test_longest_session_tracking(self):
        chat_id = 600
        
        # Initial empty longest session check
        empty_text = self.manager.get_longest_session_text(chat_id)
        self.assertIn("еще не было завершенных игр", empty_text)
        
        # Game 1: 2 turns (User 1 starts, User 2 wins)
        self.manager.handle_command(chat_id, 1, "User One", roll_override=0.5)
        self.manager.handle_command(chat_id, 2, "Winner One", roll_override=0.01)
        
        # Bypass cooldown
        self.manager.get_chat_state(chat_id)["session_ended_at"] = None

        text1 = self.manager.get_longest_session_text(chat_id)
        self.assertIn("Количество ходов: 2 хода", text1)
        self.assertIn("Победитель: Winner One", text1)
        
        # Game 2: 4 turns (User 1 starts, User 2 play, User 1 play, User 2 wins)
        self.manager.handle_command(chat_id, 1, "User One", roll_override=0.5)
        self.manager.handle_command(chat_id, 2, "User Two", roll_override=0.5)
        self.manager.handle_command(chat_id, 1, "User One", roll_override=0.5)
        self.manager.handle_command(chat_id, 2, "Winner Two", roll_override=0.01)

        # Bypass cooldown
        self.manager.get_chat_state(chat_id)["session_ended_at"] = None

        text2 = self.manager.get_longest_session_text(chat_id)
        self.assertIn("Количество ходов: 4 хода", text2)
        self.assertIn("Победитель: Winner Two", text2)

        # Game 3: 2 turns (shorter session, should not overwrite the 4-turn record)
        self.manager.handle_command(chat_id, 1, "User One", roll_override=0.5)
        self.manager.handle_command(chat_id, 2, "Winner Three", roll_override=0.01)

        text3 = self.manager.get_longest_session_text(chat_id)
        self.assertIn("Количество ходов: 4 хода", text3)
        self.assertIn("Победитель: Winner Two", text3)

    def test_force_win(self):
        chat_id = 700
        
        # Test force_win on the first command (which normally prevents winning)
        res = self.manager.handle_command(chat_id, 1, "Winner", roll_override=0.5, force_win=True)
        self.assertEqual(res["status"], "success")
        self.assertEqual(res["outcome"], "Я победил")
        self.assertTrue(res["game_ended"])
        self.assertEqual(res["winner_name"], "Winner")
        self.assertEqual(res["turns"], 1)
        self.assertTrue(res["new_record"])

    def test_session_cooldown(self):
        chat_id = 800
        
        # Start game and win
        self.manager.handle_command(chat_id, 1, "User One", roll_override=0.5)
        self.manager.handle_command(chat_id, 2, "Winner", roll_override=0.01)
        
        # Try to start next session immediately -> should fail with session_cooldown
        res = self.manager.handle_command(chat_id, 1, "User One", roll_override=0.5)
        self.assertEqual(res["status"], "session_cooldown")
        
        # Simulate 11 seconds passing by setting ended_at timestamp into the past
        import time
        state = self.manager.get_chat_state(chat_id)
        state["session_ended_at"] = time.time() - 11
        
        # Try to start again -> should succeed
        res2 = self.manager.handle_command(chat_id, 1, "User One", roll_override=0.5)
        self.assertEqual(res2["status"], "success")
        self.assertTrue(res2["game_started"])

if __name__ == "__main__":
    unittest.main()





