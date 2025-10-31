# Testing Lessons Learned

## 🐛 Bug That Slipped Through Tests: Instant Game Over

### What Happened?

When we introduced the `both_cards_played` phase, a critical bug was introduced:
- The `checkGameEndConditions()` was called **before** cards were returned to winner's hand
- This caused the game to end immediately (1 round) when both players had 0 cards in hand
- **The tests did NOT catch this bug!**

### Why Did Tests Miss It?

#### 1️⃣ **Snapshot Tests Updated Automatically**

```bash
npm test  # Runs: jest --updateSnapshot
```

The `--updateSnapshot` flag **automatically updated** the snapshots to match the buggy behavior:
- Buggy state became the new "expected" state
- Tests passed with incorrect behavior ❌

**Lesson**: Be careful with `--updateSnapshot` after logic changes. Review diffs carefully!

---

#### 2️⃣ **Missing Explicit Assertions**

The tests checked phase transitions but **not the critical game state**:

```typescript
// ❌ WEAK TEST (Missed the bug)
expect(gameState.currentPlayerPhase).toBe('both_cards_played');
// Missing: gameStatus, winnerId checks!

// ✅ STRONG TEST (Would have caught the bug)
expect(gameState.currentPlayerPhase).toBe('both_cards_played');
expect(gameState.gameStatus).toBe('playing');        // CRITICAL!
expect(gameState.winnerId).toBeNull();               // CRITICAL!
```

**Lesson**: Always assert the most critical invariants explicitly, don't rely only on snapshots.

---

#### 3️⃣ **Test Structure Assumed Happy Path**

Scenario files assumed `advanceTurn` would always be called immediately:

```json
{
  "steps": [
    { "action": "playCard", "playerId": "player-1" },
    { "action": "playCard", "playerId": "player-2" },
    { "action": "advanceTurn" }  // ← Always called right away
  ]
}
```

The bug occurred **between step 2 and 3**, but was never checked!

**Lesson**: Test intermediate states, not just final outcomes.

---

## ✅ How We Fixed the Tests

### 1. Added Explicit Assertions

**File**: `tests/game-engine.test.ts`

```typescript
// Verify both cards are on board and phase is both_cards_played
expect(gameState.carCardsOnBoard['player1']).not.toBeNull();
expect(gameState.carCardsOnBoard['player2']).not.toBeNull();
expect(gameState.currentPlayerPhase).toBe('both_cards_played');
expect(gameState.gameLog).toContain('Mindkét játékos kijátszotta a kártyáját!');

// CRITICAL: Game should still be playing (not ended prematurely)
expect(gameState.gameStatus).toBe('playing');  // ← NEW!
expect(gameState.winnerId).toBeNull();         // ← NEW!
```

### 2. Enhanced Scenario Expectations

**File**: `tests/scenarios/dontetlen-kor.scenario.json`

```json
{
  "action": "playCard",
  "playerId": "player-2",
  "expectedState": {
    "currentPlayerPhase": "both_cards_played",
    "gameStatus": "playing",                // ← NEW!
    "carOnBoardFor_player-1": true,        // ← NEW!
    "carOnBoardFor_player-2": true         // ← NEW!
  }
}
```

---

## 📋 Best Practices Going Forward

### ✅ DO:
1. **Test intermediate states** between actions
2. **Assert critical invariants** explicitly (gameStatus, winnerId, etc.)
3. **Review snapshot diffs** carefully before updating
4. **Run tests WITHOUT** `--updateSnapshot` first to see real failures

### ❌ DON'T:
1. Blindly run `jest --updateSnapshot` after logic changes
2. Rely only on snapshots for critical business logic
3. Assume the happy path is the only path
4. Skip assertions for "obvious" invariants

---

## 🧪 Recommended Test Structure

```typescript
describe('Critical Game State Transitions', () => {
  test('should maintain game integrity during phase transitions', () => {
    // Setup
    let gameState = initializeGame(...);
    
    // Action 1
    gameState = performAction1(gameState);
    
    // Assert intermediate state (CRITICAL!)
    expect(gameState.gameStatus).toBe('playing');
    expect(gameState.winnerId).toBeNull();
    
    // Action 2
    gameState = performAction2(gameState);
    
    // Assert intermediate state again
    expect(gameState.gameStatus).toBe('playing');
    
    // Final action
    gameState = finalAction(gameState);
    
    // Assert final state
    expect(gameState.gameStatus).toBe('expected_final_status');
  });
});
```

---

## 🎯 Summary

The `both_cards_played` bug taught us:
- **Snapshot tests are not enough** for critical logic
- **Explicit assertions** are your best defense
- **Test intermediate states**, not just outcomes
- **Review all diffs** when updating snapshots

These improvements ensure similar bugs will be caught in the future! 🚀

