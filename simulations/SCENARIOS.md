# Simulation scenarios for the game

## Preconditions

Before starting the sandbox:

1. Examine the code to be sure you understand the logic of the game.
2. Examine the way how sandbox.ts works.
3. Setup the database with the schema from schema.ts if database tables are not created yet.
4. Check if users table has players with names 1, 2, 3 and 4. If not - add them.
5. Change SESSION_COOLDOWN_SECONDS to 0.
6. If you want to quickly emulate timeout for a user, you can use :timeout command, without waiting for the timer to expire.

After starting the sandbox, make sure that you are in strict queue mode.

## Simulations

_Note: if by any chance during simulation some user gets to win before finishing the final outcome of the simulation, restart the sandbox and start a new simulation._

### Simulation 1

- Make one move with users 1, 2 and 3 each. If possible, make a couple of seconds delays between moves.
- After 3 users made a move, and then user 1 and 2 made another move, make a move with user 4, to check that new user can join game session at any point, and not just being added as a last indexed player.
- Starting from that point between each move begin to make moves by the players that don't have current turn in the queue. This way you can check that game session is resilient to users trying to play out of turn.
- Also check one user trying to move multiple times in a row.
- After you have done 2-3 more full cycles, start making player 3 skipping their moves. We need to achieve a scenario when this user is completely blocked from the game session.
- After player 3 is blocked, make them try to play again between other players moves, to check that at no point they are allowed to play.
- After that make player 2 skip their moves.
- Then player 4 skip their moves.
- At that point only player 1 is left in the game session. This player should get the automatic win.

### Simulation 2

- Start the game with user 1 making the move.
- Make him get the timeout.
- Observe that the game was ended due to the lack of players.

## After simulations are done

1. Terminate the sandbox process.
2. Undo constants changes made in Preconditions section.
