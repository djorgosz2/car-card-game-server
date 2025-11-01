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

---

## 🔌 Socket.IO Integrációs Tesztelés (PVP Smoke Test)

### Mi volt a feladat?
Első PVP (Player vs Player) matchmaking integrációs teszt készítése, amely:
- Két külön Socket.IO klienst szimulál
- Mindkét kliens PVP módban (`humanOnly: true`) csatlakozik
- Várja a játék indítását
- Mindkét kliens játszik egy kártyát

### Tanulságok

#### 1️⃣ **TypeScript Closure Típuskövetés Limitációi**

**Probléma:**
A `aState` és `bState` változókat closure-ökben használtuk, és a TypeScript nem tudta követni a típusokat:

```typescript
let aState: GameStateClient | null = null;

const applyA = (patch: jsonpatch.Operation[]) => {
  if (!aState) return;
  const patched = jsonpatch.applyPatch(...).newDocument;
  aState = patched as GameStateClient;  // ← Type assertion szükséges
};

// Később a while loop-ban:
if (aState && aState.gameStatus === 'playing') {  // ← TS hiba: 'never' típus
  // ...
}
```

**Megoldás:**
Explicit type assertion használata a hozzáféréskor:

```typescript
if (!ready.aPlayed && aState) {
  const currentA = aState as GameStateClient;  // ← Explicit assertion
  if (currentA.gameStatus === 'playing') {
    // Most már működik
  }
}
```

**Tanulság:** Closure-ökben lévő változók típusait a TypeScript nem mindig követi helyesen, explicit type assertion használata szükséges lehet.

---

#### 2️⃣ **Socket.IO Event Lifecycle Követése**

**Fontos láncolat:**
```
1. connect
   ↓
2. emit('auth:authenticate', { userId, username })
   ↓
3. on('auth:success')
   ↓
4. emit('matchmaking:join', { humanOnly: true })
   ↓
5. on('matchmaking:joined')  (opcionális)
   ↓
6. on('game:start')  ← EZ jelzi, hogy a játék elindult!
   ↓
7. on('game:stateUpdate')  ← TELJES állapot (első alkalommal)
   ↓
8. on('game:patch')  ← INKREMENTÁLIS frissítések (JSON Patch)
```

**Tanulság:** A `game:start` esemény a kritikus pont - onnantól lehet biztonságosan játszani. A `game:stateUpdate` és `game:patch` eseményeket külön kezelni kell.

---

#### 3️⃣ **JSON Patch Alkalmazása**

**Probléma:**
A szerver inkrementális frissítéseket küld JSON Patch formátumban. A state-et patchelni kell:

```typescript
const applyA = (patch: jsonpatch.Operation[]) => {
  if (!aState) return;
  // Deep clone + patch alkalmazás
  const patched = jsonpatch.applyPatch(
    JSON.parse(JSON.stringify(aState)),  // Deep clone
    patch,
    false,  // don't validate
    false   // don't mutate original
  ).newDocument;
  aState = patched as GameStateClient;
};
```

**Tanulság:** 
- **Deep clone szükséges** mielőtt patchelnénk (immutability)
- A `fast-json-patch` library `applyPatch` metódusa új dokumentumot ad vissza
- Type assertion szükséges, mert a patch result típusa `any`

---

#### 4️⃣ **Timeout Kezelés Integrációs Tesztekben**

**Megközelítés:**
```typescript
// Game start várakozás
const startDeadline = Date.now() + 15000;  // 15 másodperc
while (!(ready.aStarted && ready.bStarted)) {
  if (Date.now() > startDeadline) {
    throw new Error('Timeout waiting for game:start');
  }
  await delay(100);  // Polling 100ms-enként
}

// Card play várakozás
const playLoopDeadline = Date.now() + 30000;  // 30 másodperc
while (!(ready.aPlayed && ready.bPlayed)) {
  // ... play logic ...
  await delay(100);
}
```

**Tanulság:**
- **Polling pattern** használata timeout-tal
- Realisztikus időkorlátok (15s game start, 30s card play)
- Hibás esetben explicit hibaüzenet timeout-ról
- `delay()` helper függvény használata (Promise alapú)

---

#### 5️⃣ **Game State Phase Ellenőrzés**

**Fontos:**
Csak akkor játszhatunk kártyát, ha:
- `gameStatus === 'playing'`
- `currentPlayerId === myId` (sorunk van)
- `currentPlayerPhase === 'waiting_for_initial_play'` VAGY `'waiting_for_car_card_after_action'`

```typescript
if (currentA.gameStatus === 'playing' &&
    currentA.currentPlayerId === aId &&
    (currentA.currentPlayerPhase === 'waiting_for_initial_play' ||
     currentA.currentPlayerPhase === 'waiting_for_car_card_after_action')) {
  // Játszhatunk!
}
```

**Tanulság:** A játéklogika fázisait a szerver vezérli, a kliens csak reagál. A phase ellenőrzés kritikus a valid játékmenethez.

---

#### 6️⃣ **Két Klienst Egyszerre Kezelni**

**Struktúra:**
```typescript
const a = io(SERVER_URL, { transports: ['websocket'], autoConnect: false });
const b = io(SERVER_URL, { transports: ['websocket'], autoConnect: false });

let aState: GameStateClient | null = null;
let bState: GameStateClient | null = null;

const ready = { 
  aStarted: false, 
  bStarted: false, 
  aPlayed: false, 
  bPlayed: false 
};

// Mindkét kliensnek ugyanazt az event listener struktúrát kell felállítani
a.on('connect', () => { /* ... */ });
b.on('connect', () => { /* ... */ });
```

**Tanulság:**
- **Paralelizált socket kezelés** - mindkét kliens ugyanúgy működik
- **Külön state változók** minden klienshez
- **Közös ready flag objektum** a koordinációhoz
- **Promise-based async flow** a timeout-okkal

---

#### 7️⃣ **Car Card Keresés a Kézből**

**Logika:**
```typescript
function firstCarCardInHand(state: GameStateClient, myId: PlayerId): CardInstance | null {
  const me = state.players.find(p => p.id === myId);
  if (!me) return null;
  // Car card = van currentMetrics (autóskártyák metrikákkal rendelkeznek)
  const car = me.hand.find(c => !!c.currentMetrics);
  return car || null;
}
```

**Tanulság:**
- Car card azonosítása: `currentMetrics` megléte (action kártyáknak nincs)
- Első elérhető autós kártya választása egyszerű stratégiával
- Null check minden lépésben (defensív programozás)

---

### ✅ Best Practices Socket.IO Tesztekhez

1. **Mindig használj `autoConnect: false`** és manuálisan hívd a `connect()` metódust
2. **Type assertions** használata closure-ökben lévő változókhoz
3. **Polling pattern** timeout-okkal ahelyett, hogy Promise.race-tel várnánk
4. **Deep clone** JSON Patch alkalmazása előtt
5. **Explicit phase checks** a játéklogika validálásához
6. **Timeout értékek** realisztikusak legyenek (15-30s network op-okhoz)
7. **Error handling** minden timeout-ban és state check-ben

---

### 🎯 Összefoglalás

A PVP smoke teszt sikeresen validálta:
- ✅ Human-only matchmaking működése
- ✅ Két emberi játékos párosítása bot nélkül
- ✅ Game state szinkronizálás (stateUpdate + patch)
- ✅ Card play működése mindkét kliensnél

A fő tanulságok:
- **TypeScript closure limitációk** → explicit type assertions
- **Socket.IO lifecycle** követése event sorrenddel
- **JSON Patch kezelés** deep clone-nal
- **Polling + timeout** pattern integrációs tesztekhez

---

