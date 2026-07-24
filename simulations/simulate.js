import { spawn } from 'child_process';

async function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function run() {
  console.log('--- STARTING SIMULATION RUNNER ---');

  const child = spawn('node', ['dist/sandbox.js'], {
    stdio: ['pipe', 'pipe', 'inherit'],
    env: { ...process.env, SIMULATION_NO_WIN: 'true' },
  });

  child.stdout.on('data', (data) => {
    process.stdout.write(data.toString());
  });

  const send = async (line) => {
    console.log(`\n\x1b[32m>>> Sending input:\x1b[0m ${line}`);
    child.stdin.write(line + '\n');
    await delay(1200); // Delay between inputs to let database and timer states process
  };

  // Wait for sandbox to startup
  await delay(1500);

  console.log('\n--- RESETTING CHAT STATE ---');
  await send('1 /abortchlen'); // Abort any active game to clean state
  await send('1 /chlenqueue 1'); // Ensure strict mode

  console.log('\n--- SIMULATION 1: Strict Queue and Out of Turn checks ---');
  // Make first cycle of moves: 1, 2, 3
  await send('1 член');
  await send('2 член');
  await send('3 член');

  // Second cycle: 1, 2
  await send('1 член');
  await send('2 член');

  // 4 joins at this point
  await send('4 член');

  // Out of turn attempts (expected: 3)
  await send('1 член'); // Should say Out of turn warning
  await send('2 член'); // Should say Out of turn warning
  await send('2 член'); // Double move check (should ignore or warning)

  // Expected player 3 plays
  await send('3 член');

  // Full cycle 2: 1, 2, 4, 3
  await send('1 член');
  await send('2 член');
  await send('4 член');
  await send('3 член');

  // Full cycle 3: 1, 2, 4, 3
  await send('1 член');
  await send('2 член');
  await send('4 член');
  await send('3 член');

  console.log('\n--- Make Player 3 skip moves to exclude them ---');
  // Next expected is 1
  await send('1 член');
  // Next expected is 2
  await send('2 член');
  // Next expected is 4
  await send('4 член');
  // Next expected is 3. Instead of 3 moving, we trigger a timeout.
  await send(':timeout'); // Skip count 1 for player 3
  
  // Next expected is 1
  await send('1 член');
  // Next expected is 2
  await send('2 член');
  // Next expected is 4
  await send('4 член');
  // Next expected is 3. Timeout again.
  await send(':timeout'); // Skip count 2 for player 3

  // Next expected is 1
  await send('1 член');
  // Next expected is 2
  await send('2 член');
  // Next expected is 4
  await send('4 член');
  // Next expected is 3. Timeout again. Player 3 should be excluded (Order 69).
  await send(':timeout'); // Skip count 3 -> Excluded!

  // Check that excluded player 3 cannot play
  await send('3 член'); // Should say "Натуралам вход закрыт!" or warning

  console.log('\n--- Make Player 2 skip moves to exclude them ---');
  // Next expected is 1
  await send('1 член');
  // Next expected is 2. Timeout.
  await send(':timeout'); // Skip count 1 for player 2
  
  // Next expected is 4
  await send('4 член');
  // Next expected is 1
  await send('1 член');
  // Next expected is 2. Timeout.
  await send(':timeout'); // Skip count 2 for player 2

  // Next expected is 4
  await send('4 член');
  // Next expected is 1
  await send('1 член');
  // Next expected is 2. Timeout -> Excluded!
  await send(':timeout'); // Skip count 3 -> Excluded!

  console.log('\n--- Make Player 4 skip moves to exclude them ---');
  // Next expected is 4. Timeout.
  await send(':timeout'); // Skip count 1 for player 4
  // Next expected is 1
  await send('1 член');
  // Next expected is 4. Timeout.
  await send(':timeout'); // Skip count 2 for player 4
  // Next expected is 1
  await send('1 член');
  // Next expected is 4. Timeout -> Excluded! Player 1 should win automatically!
  await send(':timeout'); // Skip count 3 -> Excluded!

  console.log('\n--- SIMULATION 2: Lack of players timeout ---');
  // Wait cooldown or session cleanup if any, then start a new session
  await delay(1000);
  await send('1 член'); // Starts new game
  await send(':timeout'); // Player 1 times out. Game should end since only 1 player in the session.

  // Done, exit sandbox
  await send(':exit');
}

run().catch(console.error);
