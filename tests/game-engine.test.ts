import * as fs from 'fs';
import * as path from 'path';
import {
  initializeGame,
  performPlay,
  advanceTurn,
  getCardDefinition, // Szükséges a kártya típusának ellenőrzéséhez
  loadCardDefinitions, // Biztosítjuk, hogy a kártyák be legyenek töltve
  resolveRound,
  checkGameEndConditions,
} from '../shared/game-engine'; // Módosítsd az elérési utat, ha szükséges
import { IGameState, ICardInstance, IPlayerState } from '../shared/interfaces';

let uuidCounter = 1;
jest.mock('uuid', () => ({
  v4: () => `mock-uuid-${uuidCounter++}`,
}));

// <<< VÁLTOZTATÁS: Logolási rendszer beállítása
const logDir = path.join(__dirname, 'test-logs');
fs.mkdirSync(logDir, { recursive: true }); // Biztosítja, hogy a mappa létezik

const getTimestampString = () => {
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  // Format: YYYY-MM-DD_HH-mm-ss
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(
    d.getDate()
  )}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
};

const logFilename = `test-run_${getTimestampString()}.log`;
const logFilePath = path.join(logDir, logFilename);

/**
 * Egyszerű, szinkron fájl-logoló a tesztekhez.
 * @param level A log szintje (pl. INFO, ERROR, STEP)
 * @param message A log üzenet
 */
const logToFile = (
  level: 'INFO' | 'ERROR' | 'STEP' | 'ASSERT',
  message: string
) => {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] [${level}] ${message}\n`;
  try {
    fs.appendFileSync(logFilePath, logMessage);
  } catch (err) {
    console.error('Hiba a log fájl írása közben:', err);
  }
};

// <<< VÁLTOZTATÁS: Logoljuk a tesztfutás kezdetét
logToFile('INFO', `===== TESZTFUTÁS ELINDÍTVA =====`);
logToFile('INFO', `Log fájl helye: ${logFilePath}`);
// >>> VÁLTOZTATÁS VÉGE

// Local helper types to avoid 'any'
type OverrideHandCard = { cardId: string; type?: 'car' | 'action' };
type OverridePlayer = { hand: OverrideHandCard[] } & Partial<IPlayerState>;
type ScenarioStep = {
  action: 'playCard' | 'advanceTurn';
  playerId?: string;
  findCard?: { type?: 'car' | 'action'; cardId?: string; indexInHand?: number };
  payload?: Record<string, unknown>;
  expectedState?: Record<string, unknown>;
};

// A forgatókönyveket tartalmazó mappa
const scenariosDir = path.join(__dirname, 'scenarios');

// Beolvassuk az összes .scenario.json fájlt a mappából
const scenarioFiles = fs
  .readdirSync(scenariosDir)
  .filter((file) => file.endsWith('.scenario.json'));

/**
 * Robusztus segédfüggvény a kártya instanceId-jának megtalálásához a játékos kezében lévő lapok közül.
 * @param hand A játékos kezében lévő kártyák.
 * @param criteria A keresési feltétel (típus, cardId, vagy index a szűrt listában).
 * @returns A megtalált kártya instanceId-ja.
 */
const findCardInstanceIdFromHand = (
  hand: ICardInstance[],
  criteria: { type?: 'car' | 'action'; cardId?: string; indexInHand?: number }
): string => {
  let filteredHand = [...hand]; // Másolattal dolgozunk

  if (criteria.cardId) {
    // Keresés konkrét kártya ID alapján (pl. "ACTION_HP_BOOST_TEMP")
    filteredHand = filteredHand.filter((card) => card.cardId === criteria.cardId);
  } else if (criteria.type) {
    // Keresés kártya típus alapján (pl. az első 'car' típusú kártya)
    filteredHand = filteredHand.filter(
      (card) => getCardDefinition(card.cardId)?.type === criteria.type
    );
  }

  const card = filteredHand[criteria.indexInHand ?? 0];
  if (!card) {
    const availableCards = hand.map((c) => c.cardId).join(', ') || 'nincs';
    // <<< VÁLTOZTATÁS: Hiba logolása fájlba, mielőtt kivételt dobunk
    const errorMsg = `Nem található a kritériumnak megfelelő kártya a tesztben: ${JSON.stringify(
      criteria
    )}. Elérhető kártyák: [${availableCards}]`;
    logToFile('ERROR', errorMsg);
    // >>> VÁLTOZTATÁS VÉGE
    throw new Error(errorMsg);
  }
  return card.instanceId;
};

describe('Game Engine Scenarios', () => {
  // A tesztek előtt egyszer betöltjük az összes kártyadefiníciót
  beforeAll(() => {
    loadCardDefinitions();
    logToFile('INFO', 'Kártyadefiníciók betöltve (beforeAll)'); // <<< VÁLTOZTATÁS
  });

  beforeEach(() => {
    uuidCounter = 1;
    // JAVÍTÁS: Mockoljuk a Date.now()-t, hogy a currentTurnStartTime is determinisztikus legyen.
    jest.spyOn(Date, 'now').mockImplementation(() => 1234567890123);
    logToFile('INFO', '--- Teszt Eset Indul (beforeEach) ---'); // <<< VÁLTOZTATÁS
  });

  scenarioFiles.forEach((file) => {
    const scenario = JSON.parse(
      fs.readFileSync(path.join(scenariosDir, file), 'utf-8')
    );

    test(scenario.description, () => {
      // <<< VÁLTOZTATÁS: Forgatókönyv indításának logolása
      logToFile(
        'STEP',
        `[FORGATÓKÖNYV INDUL] ${scenario.description} (Fájl: ${file})`
      );
      // >>> VÁLTOZTATÁS VÉGE

      // 1. Játék inicializálása a forgatókönyv alapján
      const playerIds = scenario.playerIds || ['player-1', 'player-2'];
      const playerNames = scenario.playerNames || ['Player 1', 'Player 2'];
      let gameState: IGameState;

      if (scenario.overrideInitialState) {
        // <<< VÁLTOZTATÁS
        logToFile('INFO', 'Egyedi kezdőállapot felülírása...');
        // >>> VÁLTOZTATÁS VÉGE

        // Ha van egyedi kezdőállapot, azt használjuk
        // A kézben lévő kártyákat instance-okká kell alakítani
        const overrideState = scenario.overrideInitialState;

        // 1. Hozzunk létre egy minimális, de valid alap állapotot
        const baseGameState: Partial<IGameState> = {
          gameId: `mock-uuid-${uuidCounter++}`,
          gameStatus: 'playing',
          currentPlayerPhase: 'waiting_for_initial_play',
          roundWinnerId: null,
          winnerId: null,
          selectedMetricForRound: null,
          activeActionCardsOnBoard: {
            [playerIds[0]]: null,
            [playerIds[1]]: null,
          },
          carCardsOnBoard: { [playerIds[0]]: null, [playerIds[1]]: null },
          discardPile: [],
          drawPile: [],
          extraTurnPlayerId: null,
          pendingMetricModifiers: {
            [playerIds[0]]: null,
            [playerIds[1]]: null,
          },
          gameLog: ['A teszt egyedi állapottal indult.'],
        };

        // 2. Alakítsuk át a kártyákat a kézben instance-okká
        (overrideState.players as OverridePlayer[]).forEach((player) => {
          player.hand = player.hand.map((card: OverrideHandCard) => ({
            instanceId: `mock-uuid-${uuidCounter++}`,
            cardId: card.cardId,
            currentMetrics:
              card.type === 'car'
                ? getCardDefinition(card.cardId)?.metrics
                : undefined,
            originalMetrics:
              card.type === 'car'
                ? getCardDefinition(card.cardId)?.metrics
                : undefined,
          }));
        });

        // 3. Egyesítsük az alap állapotot a felülírással
        // Ami az overrideState-ben meg van adva, az felülírja az alapértelmezettet.
        gameState = { ...baseGameState, ...overrideState } as IGameState;
      } else {
        // <<< VÁLTOZTATÁS
        logToFile(
          'INFO',
          `Játék inicializálása. Seed: ${scenario.initialSeed}`
        );
        // >>> VÁLTOZTATÁS VÉGE
        gameState = initializeGame(
          playerIds,
          playerNames,
          scenario.initialSeed,
          300,
          true
        );
      }

      // 2. Végigmegyünk a forgatókönyv lépésein
      (scenario.steps as ScenarioStep[]).forEach((step, index: number) => {
        // <<< VÁLTOZTATÁS: Lépés logolása
        logToFile('STEP', `[Lépés ${index + 1}] Akció: ${step.action}`);
        // >>> VÁLTOZTATÁS VÉGE

        let newState: IGameState;

        // Akció végrehajtása a scenario alapján
        switch (step.action) {
          case 'playCard': {
            const playerState = gameState.players.find(
              (p: IPlayerState) => p.id === step.playerId
            );
            if (!playerState) {
              logToFile('ERROR', `Player not found: ${step.playerId}`); // <<< VÁLTOZTATÁS
              throw new Error(`Player not found: ${step.playerId}`);
            }

            // <<< VÁLTOZTATÁS: Kártyakeresés logolása
            logToFile(
              'INFO',
              `Játékos: ${step.playerId}, Kártya keresése: ${JSON.stringify(
                step.findCard
              )}`
            );
            // >>> VÁLTOZTATÁS VÉGE
            const cardInstanceIdToPlay = findCardInstanceIdFromHand(
              playerState.hand,
              step.findCard ?? {}
            );
            
            // <<< VÁLTOZTATÁS
            logToFile(
              'INFO',
              `Kártya kijátszása: ${cardInstanceIdToPlay}, Payload: ${JSON.stringify(
                step.payload
              )}`
            );
            // >>> VÁLTOZTATÁS VÉGE

            const result = performPlay(
              gameState,
              step.playerId!,
              cardInstanceIdToPlay,
              step.payload || {}
            );

            // Check if the play was successful
            if (!result.success) {
              logToFile('ERROR', `PerformPlay failed: ${result.message}`); // <<< VÁLTOZTATÁS
              throw new Error(`PerformPlay failed: ${result.message}`);
            }

            newState = result.newState;
            break;
          }
          case 'advanceTurn': {
            // <<< VÁLTOZTATÁS: Kör logolása
            logToFile(
              'INFO',
              `Kör léptetése. Jelenlegi fázis: ${gameState.currentPlayerPhase}`
            );
            // >>> VÁLTOZTATÁS VÉGE
            
            // If both cards are on board, resolve first (server-timer simulated), then advance
            if (gameState.currentPlayerPhase === 'both_cards_on_board') {
              // <<< VÁLTOZTATÁS: console.log cseréje
              logToFile(
                'INFO',
                `[TEST] resolveRound called - phase: ${
                  gameState.currentPlayerPhase
                }, selectedMetric: ${
                  gameState.selectedMetricForRound
                }, player1Card: ${
                  !!gameState.carCardsOnBoard[gameState.players[0].id]
                }, player2Card: ${
                  !!gameState.carCardsOnBoard[gameState.players[1].id]
                }`
              );
              // >>> VÁLTOZTATÁS VÉGE
              const resolved = resolveRound(gameState);
              logToFile('INFO', `[TEST] After resolveRound - phase: ${resolved.currentPlayerPhase}, roundWinnerId: ${resolved.roundWinnerId}, gameStatus: ${resolved.gameStatus}`);
              newState = advanceTurn(resolved, resolved.roundWinnerId);
              logToFile('INFO', `[TEST] After advanceTurn - phase: ${newState.currentPlayerPhase}, currentPlayerId: ${newState.currentPlayerId}`);
            } else {
              newState = advanceTurn(gameState, gameState.roundWinnerId);
              logToFile('INFO', `[TEST] After advanceTurn (no resolve) - phase: ${newState.currentPlayerPhase}, currentPlayerId: ${newState.currentPlayerId}`);
            }
            break;
          }
          default:
            logToFile('ERROR', `Ismeretlen akció: ${step.action}`); // <<< VÁLTOZTATÁS
            throw new Error(`Ismeretlen akció a scenarioban: ${step.action}`);
        }

        gameState = newState; // Frissítjük a játékállapotot a következő lépéshez

        // 3. Ellenőrzés és Snapshot
        if (step.expectedState) {
          const expectedState = step.expectedState as Record<string, unknown>;
          Object.keys(expectedState).forEach((key) => {
            const expectedValue = expectedState[key];
            
            // <<< VÁLTOZTATÁS: Asszerció logolása
            logToFile(
              'ASSERT',
              `Ellenőrzés: '${key}' | Elvárt: ${expectedValue}`
            );
            // >>> VÁLTOZTATÁS VÉGE

            const actualPlayerState = (playerId: string): IPlayerState => {
              const p = gameState.players.find(
                (p: IPlayerState) => p.id === playerId
              );
              if (!p)
                throw new Error(
                  `Player ID not found for assertion: ${playerId}`
                );
              return p;
            };

            // Speciális asserciók kezelése a gameState komplexebb részeire
            if (key.endsWith('_handSize')) {
              const playerId = key.split('_')[0];
              expect(actualPlayerState(playerId).hand.length).toBe(
                expectedValue
              );
            } else if (key.endsWith('_score')) {
              const playerId = key.split('_')[0];
              expect(actualPlayerState(playerId).score).toBe(expectedValue);
            } else if (key.startsWith('carOnBoardFor_')) {
              const playerId = key.replace('carOnBoardFor_', '');
              expect(!!gameState.carCardsOnBoard[playerId]).toBe(expectedValue);
            } else if (key.startsWith('actionCardOnBoardFor_')) {
              const playerId = key.replace('actionCardOnBoardFor_', '');
              expect(!!gameState.activeActionCardsOnBoard[playerId]).toBe(
                expectedValue
              );
            } else {
              // Általános asserciók a gameState gyökerében lévő tulajdonságokra
              expect(
                (gameState as unknown as Record<string, unknown>)[key]
              ).toEqual(expectedValue as unknown);
            }
          });
        }

        // <<< VÁLTOZTATÁS: Snapshot logolása
        logToFile(
          'ASSERT',
          `Snapshot ellenőrzése: 'Step ${index + 1}: ${step.action}'`
        );
        // >>> VÁLTOZTATÁS VÉGE
        // A teljes játékállapotot összehasonlítjuk egy elmentett "pillanatképpel".
        expect(gameState).toMatchSnapshot(`Step ${index + 1}: ${step.action}`);
      });
    });
  });

  // New test for both_cards_on_board phase
  describe('Both Cards On Board Phase', () => {
    beforeEach(() => {
      uuidCounter = 1;
      jest.spyOn(Date, 'now').mockImplementation(() => 1234567890123);
      logToFile('INFO', '--- Teszt Eset Indul (beforeEach) ---'); // <<< VÁLTOZTATÁS
    });

    test('should enter both_cards_on_board phase when both players play cards', () => {
      // <<< VÁLTOZTATÁS
      logToFile(
        'STEP',
        '[TESZT INDUL] should enter both_cards_on_board phase...'
      );
      // >>> VÁLTOZTATÁS VÉGE
      
      // Initialize game
      const playerIds = ['player1', 'player2'];
      const playerNames = ['Player 1', 'Player 2'];
      let gameState: IGameState = initializeGame(
        playerIds,
        playerNames,
        42,
        300,
        true
      );
      logToFile('INFO', 'Játék inicializálva, seed: 42'); // <<< VÁLTOZTATÁS

      // Find car cards in both players' hands
      const player1 = gameState.players.find((p) => p.id === 'player1')!;
      const player2 = gameState.players.find((p) => p.id === 'player2')!;

      const player1CarCard = player1.hand.find(
        (card) => getCardDefinition(card.cardId)?.type === 'car'
      );
      const player2CarCard = player2.hand.find(
        (card) => getCardDefinition(card.cardId)?.type === 'car'
      );

      expect(player1CarCard).toBeDefined();
      expect(player2CarCard).toBeDefined();

      // Player 1 plays a car card
      logToFile('INFO', 'Player 1 kijátszik egy autót (hp)...'); // <<< VÁLTOZTATÁS
      const result1 = performPlay(
        gameState,
        'player1',
        player1CarCard!.instanceId,
        {
          selectedMetric: 'hp',
        }
      );
      if (!result1.success) throw new Error(result1.message);
      gameState = result1.newState;

      // Verify player 1's card is on board
      expect(gameState.carCardsOnBoard['player1']).not.toBeNull();
      expect(gameState.carCardsOnBoard['player2']).toBeNull();
      expect(gameState.currentPlayerPhase).toBe('waiting_for_initial_play');
      expect(gameState.currentPlayerId).toBe('player2');

      // Player 2 plays a car card
      logToFile('INFO', 'Player 2 kijátszik egy autót (hp)...'); // <<< VÁLTOZTATÁS
      const result2 = performPlay(
        gameState,
        'player2',
        player2CarCard!.instanceId,
        {
          selectedMetric: 'hp',
        }
      );
      if (!result2.success) throw new Error(result2.message);
      gameState = result2.newState;

      // <<< VÁLTOZTATÁS: Asszerciók logolása
      logToFile(
        'ASSERT',
        `Ellenőrzés: Fázis 'both_cards_on_board'. Jelenlegi: ${gameState.currentPlayerPhase}`
      );
      logToFile(
        'ASSERT',
        `Ellenőrzés: Játék státusz 'playing'. Jelenlegi: ${gameState.gameStatus}`
      );
      // >>> VÁLTOZTATÁS VÉGE

      // Verify both cards are on board and phase is both_cards_on_board
      expect(gameState.carCardsOnBoard['player1']).not.toBeNull();
      expect(gameState.carCardsOnBoard['player2']).not.toBeNull();
      expect(gameState.currentPlayerPhase).toBe('both_cards_on_board');
      // Ensure server also logs the comparison moment
      expect(gameState.gameLog).toContain(
        'Mindkét játékos kijátszotta a kártyáját!'
      );
      
      // CRITICAL: Game should still be playing (not ended prematurely)
      expect(gameState.gameStatus).toBe('playing');
      expect(gameState.winnerId).toBeNull();
    });

    test('resolveRound then advanceTurn should resolve and advance', () => {
      // <<< VÁLTOZTATÁS
      logToFile(
        'STEP',
        '[TESZT INDUL] resolveRound then advanceTurn should resolve and advance'
      );
      // >>> VÁLTOZTATÁS VÉGE

      // Initialize game
      const playerIds = ['player1', 'player2'];
      const playerNames = ['Player 1', 'Player 2'];
      let gameState: IGameState = initializeGame(
        playerIds,
        playerNames,
        42,
        300,
        true
      );
      logToFile('INFO', 'Játék inicializálva, seed: 42'); // <<< VÁLTOZTATÁS

      // Find car cards in both players' hands
      const player1 = gameState.players.find((p) => p.id === 'player1')!;
      const player2 = gameState.players.find((p) => p.id === 'player2')!;

      const player1CarCard = player1.hand.find(
        (card) => getCardDefinition(card.cardId)?.type === 'car'
      );
      const player2CarCard = player2.hand.find(
        (card) => getCardDefinition(card.cardId)?.type === 'car'
      );

      // Both players play cards
      logToFile('INFO', 'Player 1 és 2 kijátssza a kártyáit...'); // <<< VÁLTOZTATÁS
      const result1 = performPlay(
        gameState,
        'player1',
        player1CarCard!.instanceId,
        {
          selectedMetric: 'hp',
        }
      );
      if (!result1.success) throw new Error(result1.message);
      gameState = result1.newState;

      const result2 = performPlay(
        gameState,
        'player2',
        player2CarCard!.instanceId,
        {
          selectedMetric: 'hp',
        }
      );
      if (!result2.success) throw new Error(result2.message);
      gameState = result2.newState;

      // Verify we're in both_cards_on_board phase
      expect(gameState.currentPlayerPhase).toBe('both_cards_on_board');
      logToFile('INFO', `Állapot: ${gameState.currentPlayerPhase}. Kör kiértékelése...`); // <<< VÁLTOZTATÁS

      // Store card count before resolution
      const player1HandSizeBefore = gameState.players.find(p => p.id === 'player1')!.hand.length;
      const player2HandSizeBefore = gameState.players.find(p => p.id === 'player2')!.hand.length;

      // Resolve round then advance turn
      gameState = resolveRound(gameState);
      gameState = advanceTurn(gameState, gameState.roundWinnerId);

      // <<< VÁLTOZTATÁS: Asszerciók logolása
      logToFile(
        'ASSERT',
        `Ellenőrzés: Fázis 'waiting_for_initial_play'. Jelenlegi: ${gameState.currentPlayerPhase}`
      );
      logToFile(
        'ASSERT',
        `Ellenőrzés: Kártyák eltűntek az asztalról (P1: ${!!gameState
          .carCardsOnBoard['player1']}, P2: ${!!gameState.carCardsOnBoard[
          'player2'
        ]})`
      );
      // >>> VÁLTOZTATÁS VÉGE
      
      // Verify round was resolved and next turn prepared
      expect(gameState.currentPlayerPhase).toBe('waiting_for_initial_play');
      expect(gameState.carCardsOnBoard['player1']).toBeNull();
      expect(gameState.carCardsOnBoard['player2']).toBeNull();
      expect(gameState.selectedMetricForRound).toBeNull();

      // Winner should have received both cards
      const player1HandSizeAfter = gameState.players.find(p => p.id === 'player1')!.hand.length;
      const player2HandSizeAfter = gameState.players.find(p => p.id === 'player2')!.hand.length;
      
      const totalHandSizeBefore = player1HandSizeBefore + player2HandSizeBefore;
      const totalHandSizeAfter = player1HandSizeAfter + player2HandSizeAfter;
      
      // Total cards should be the same (winner gets both cards)
      expect(totalHandSizeAfter).toBe(totalHandSizeBefore + 2);
    });
  });

  test('should end immediately after resolveRound when loser runs out of car cards', () => {
    // <<< VÁLTOZTATÁS
    logToFile(
      'STEP',
      '[TESZT INDUL] should end immediately after resolveRound when loser runs out of car cards'
    );
    // >>> VÁLTOZTATÁS VÉGE

    // Initialize game
    const playerIds = ['player1', 'player2'];
    const playerNames = ['Player 1', 'Player 2'];
    let gameState: IGameState = initializeGame(
      playerIds,
      playerNames,
      42,
      300,
      true
    );
    logToFile('INFO', 'Játék inicializálva, seed: 42'); // <<< VÁLTOZTATÁS

    const p1 = gameState.players.find((p) => p.id === 'player1')!;
    const p2 = gameState.players.find((p) => p.id === 'player2')!;

    // Ensure player2 has exactly one car card in hand (so losing it means 0 cars left)
    const p2Cars = p2.hand.filter(
      (c) => getCardDefinition(c.cardId)?.type === 'car'
    );
    expect(p2Cars.length).toBeGreaterThan(0);
    p2.hand = [p2Cars[0]]; // keep only one car card
    logToFile('INFO', 'Setup: Player 2 kezébe 1 autó kártya helyezve.'); // <<< VÁLTOZTATÁS

    // Find car cards to play
    const p1Car = p1.hand.find(
      (c) => getCardDefinition(c.cardId)?.type === 'car'
    );
    const p2Car = p2.hand.find(
      (c) => getCardDefinition(c.cardId)?.type === 'car'
    );
    expect(p1Car).toBeDefined();
    expect(p2Car).toBeDefined();

    // Player 1 plays a car (select hp)
    let result = performPlay(gameState, 'player1', p1Car!.instanceId, {
      selectedMetric: 'hp',
    });
    if (!result.success) throw new Error(result.message);
    gameState = result.newState;
    logToFile('INFO', 'Player 1 kijátszott egy autót.'); // <<< VÁLTOZTATÁS

    // Player 2 plays their only car (select hp)
    result = performPlay(gameState, 'player2', p2Car!.instanceId, {
      selectedMetric: 'hp',
    });
    if (!result.success) throw new Error(result.message);
    gameState = result.newState;
    logToFile('INFO', 'Player 2 kijátszotta az utolsó autóját.'); // <<< VÁLTOZTATÁS

    // Force a deterministic win for player1 by adjusting currentMetrics on board
    const p1Board = gameState.carCardsOnBoard['player1']!;
    const p2Board = gameState.carCardsOnBoard['player2']!;
    expect(p1Board).toBeTruthy();
    expect(p2Board).toBeTruthy();
    // Ensure currentMetrics exist and set hp values
    (p1Board.currentMetrics as any).hp = 9999;
    (p2Board.currentMetrics as any).hp = 1;
    // Selected metric must be hp
    (gameState as any).selectedMetricForRound = 'hp';
    logToFile('INFO', 'Győzelem kényszerítése (P1 HP: 9999, P2 HP: 1), "hp" metrika alapján.'); // <<< VÁLTOZTATÁS

    // Resolve the round - loser will have 0 car cards
    gameState = resolveRound(gameState);
    logToFile('INFO', 'Kör kiértékelve. P2 elvesztette az utolsó kártyáját.'); // <<< VÁLTOZTATÁS

    // <<< VÁLTOZTATÁS: Asszerciók logolása
    logToFile(
      'ASSERT',
      `Ellenőrzés: Játék státusz 'win'. Jelenlegi: ${gameState.gameStatus}`
    );
    logToFile(
      'ASSERT',
      `Ellenőrzés: Győztes 'player1'. Jelenlegi: ${gameState.winnerId}`
    );
    // >>> VÁLTOZTATÁS VÉGE

    // Game should end immediately with player1 as winner (no extra play required)
    expect(gameState.gameStatus).toBe('win');
    expect(gameState.winnerId).toBe('player1');
  });

  describe('Game End Conditions - Out of Car Cards', () => {
    beforeEach(() => {
      uuidCounter = 1;
      jest.spyOn(Date, 'now').mockImplementation(() => 1234567890123);
      logToFile('INFO', '--- Teszt Eset Indul (beforeEach) ---'); // <<< VÁLTOZTATÁS
    });

    test('should end game automatically when player runs out of car cards in waiting_for_initial_play phase', () => {
      // <<< VÁLTOZTATÁS
      logToFile(
        'STEP',
        '[TESZT INDUL] should end game automatically when player runs out of car cards in waiting_for_initial_play phase'
      );
      // >>> VÁLTOZTATÁS VÉGE

      // Initialize game
      const playerIds = ['player-1', 'player-2'];
      const playerNames = ['Player 1', 'Player 2'];
      let gameState: IGameState = initializeGame(
        playerIds,
        playerNames,
        42,
        300,
        true
      );
      logToFile('INFO', 'Játék inicializálva, seed: 42'); // <<< VÁLTOZTATÁS

      // Find an action card to give to player-1 (so they have cards but no car cards)
      const actionCardId = 'ACTION_HP_BOOST_TEMP';
      const actionCardDef = getCardDefinition(actionCardId);
      expect(actionCardDef).toBeDefined();

      // Set up state: player-1 has only action cards, no car cards, and it's their turn
      const player1 = gameState.players.find((p) => p.id === 'player-1')!;
      const player2 = gameState.players.find((p) => p.id === 'player-2')!;

      // Remove all car cards from player-1's hand, keep only action cards (or empty if needed)
      player1.hand = player1.hand.filter((c) => {
        const def = getCardDefinition(c.cardId);
        return def?.type === 'action';
      });
      logToFile('INFO', 'Setup: Player 1 összes autó kártya eltávolítva.'); // <<< VÁLTOZTATÁS

      // Add an action card to player-1's hand to show they have cards, just not car cards
      if (actionCardDef) {
        player1.hand.push({
          instanceId: `mock-uuid-${uuidCounter++}`,
          cardId: actionCardId,
        });
        logToFile('INFO', 'Setup: Player 1 kapott egy akció kártyát.'); // <<< VÁLTOZTATÁS
      }

      // Set up game state: player-1's turn, waiting for initial play
      gameState.currentPlayerId = 'player-1';
      gameState.currentPlayerPhase = 'waiting_for_initial_play';
      gameState.gameStatus = 'playing';
      gameState.winnerId = null;
      logToFile(
        'INFO',
        "Setup: Állapot beállítva: 'waiting_for_initial_play', Játékos: 'player-1'"
      ); // <<< VÁLTOZTATÁS

      // Check game end conditions
      const resultState = checkGameEndConditions(gameState);
      logToFile('INFO', 'checkGameEndConditions lefutott.'); // <<< VÁLTOZTATÁS

      // <<< VÁLTOZTATÁS: Asszerciók logolása
      logToFile(
        'ASSERT',
        `Ellenőrzés: Játék státusz 'win'. Jelenlegi: ${resultState.gameStatus}`
      );
      logToFile(
        'ASSERT',
        `Ellenőrzés: Győztes 'player-2'. Jelenlegi: ${resultState.winnerId}`
      );
      // >>> VÁLTOZTATÁS VÉGE

      // Verify game ended automatically
      expect(resultState.gameStatus).toBe('win');
      expect(resultState.winnerId).toBe('player-2');
      expect(resultState.gameLog).toContain(
        'Játék vége! Player 2 nyert. Ok: Player 1 kifogyott az autós kártyákból!'
      );
    });

    test('should end game automatically when player runs out of car cards in waiting_for_car_card_after_action phase', () => {
      // <<< VÁLTOZTATÁS
      logToFile(
        'STEP',
        '[TESZT INDUL] should end game automatically when player runs out of car cards in waiting_for_car_card_after_action phase'
      );
      // >>> VÁLTOZTATÁS VÉGE

      // Initialize game
      const playerIds = ['player-1', 'player-2'];
      const playerNames = ['Player 1', 'Player 2'];
      let gameState: IGameState = initializeGame(
        playerIds,
        playerNames,
        42,
        300,
        true
      );
      logToFile('INFO', 'Játék inicializálva, seed: 42'); // <<< VÁLTOZTATÁS

      const player1 = gameState.players.find((p) => p.id === 'player-1')!;
      const player2 = gameState.players.find((p) => p.id === 'player-2')!;

      // Find an action card
      const actionCardId = 'ACTION_HP_BOOST_TEMP';
      const actionCardDef = getCardDefinition(actionCardId);
      expect(actionCardDef).toBeDefined();

      // Remove all car cards from player-1's hand
      player1.hand = player1.hand.filter((c) => {
        const def = getCardDefinition(c.cardId);
        return def?.type === 'action';
      });
      logToFile('INFO', 'Setup: Player 1 összes autó kártya eltávolítva.'); // <<< VÁLTOZTATÁS

      // Add only action card to player-1's hand
      if (actionCardDef) {
        player1.hand.push({
          instanceId: `mock-uuid-${uuidCounter++}`,
          cardId: actionCardId,
        });
        logToFile('INFO', 'Setup: Player 1 kapott egy akció kártyát.'); // <<< VÁLTOZTATÁS
      }

      // Set up game state: player-1 just played an action card, now needs to play car card
      gameState.currentPlayerId = 'player-1';
      gameState.currentPlayerPhase = 'waiting_for_car_card_after_action';
      gameState.gameStatus = 'playing';
      gameState.winnerId = null;
      logToFile(
        'INFO',
        "Setup: Állapot beállítva: 'waiting_for_car_card_after_action', Játékos: 'player-1'"
      ); // <<< VÁLTOZTATÁS

      // Check game end conditions
      const resultState = checkGameEndConditions(gameState);
      logToFile('INFO', 'checkGameEndConditions lefutott.'); // <<< VÁLTOZTATÁS

      // <<< VÁLTOZTATÁS: Asszerciók logolása
      logToFile(
        'ASSERT',
        `Ellenőrzés: Játék státusz 'win'. Jelenlegi: ${resultState.gameStatus}`
      );
      logToFile(
        'ASSERT',
        `Ellenőrzés: Győztes 'player-2'. Jelenlegi: ${resultState.winnerId}`
      );
      // >>> VÁLTOZTATÁS VÉGE

      // Verify game ended automatically
      expect(resultState.gameStatus).toBe('win');
      expect(resultState.winnerId).toBe('player-2');
      expect(resultState.gameLog).toContain(
        'Játék vége! Player 2 nyert. Ok: Player 1 kifogyott az autós kártyákból!'
      );
    });

    test('should end game automatically when AI bot runs out of car cards', () => {
      // <<< VÁLTOZTATÁS
      logToFile(
        'STEP',
        '[TESZT INDUL] should end game automatically when AI bot runs out of car cards'
      );
      // >>> VÁLTOZTATÁS VÉGE

      // Initialize game with bot player
      const playerIds = ['bot-1', 'player-2'];
      const playerNames = ['AI Bot', 'Player 2'];
      let gameState: IGameState = initializeGame(
        playerIds,
        playerNames,
        42,
        300,
        true
      );
      logToFile('INFO', 'Játék inicializálva (AI bottal), seed: 42'); // <<< VÁLTOZTATÁS

      const bot = gameState.players.find((p) => p.id === 'bot-1')!;
      const player2 = gameState.players.find((p) => p.id === 'player-2')!;

      // Remove all car cards from bot's hand
      bot.hand = bot.hand.filter((c) => {
        const def = getCardDefinition(c.cardId);
        return def?.type === 'action';
      });
      logToFile('INFO', 'Setup: AI Bot összes autó kártya eltávolítva.'); // <<< VÁLTOZTATÁS

      // Set up game state: bot's turn, waiting for initial play
      gameState.currentPlayerId = 'bot-1';
      gameState.currentPlayerPhase = 'waiting_for_initial_play';
      gameState.gameStatus = 'playing';
      gameState.winnerId = null;
      logToFile(
        'INFO',
        "Setup: Állapot beállítva: 'waiting_for_initial_play', Játékos: 'bot-1'"
      ); // <<< VÁLTOZTATÁS

      // Check game end conditions
      const resultState = checkGameEndConditions(gameState);
      logToFile('INFO', 'checkGameEndConditions lefutott.'); // <<< VÁLTOZTATÁS

      // <<< VÁLTOZTATÁS: Asszerciók logolása
      logToFile(
        'ASSERT',
        `Ellenőrzés: Játék státusz 'win'. Jelenlegi: ${resultState.gameStatus}`
      );
      logToFile(
        'ASSERT',
        `Ellenőrzés: Győztes 'player-2'. Jelenlegi: ${resultState.winnerId}`
      );
      // >>> VÁLTOZTATÁS VÉGE

      // Verify game ended automatically with player-2 as winner
      expect(resultState.gameStatus).toBe('win');
      expect(resultState.winnerId).toBe('player-2');
      expect(resultState.gameLog).toContain(
        'Játék vége! Player 2 nyert. Ok: AI Bot kifogyott az autós kártyákból!'
      );
    });

    test('should NOT end game if player has car cards available', () => {
      // <<< VÁLTOZTATÁS
      logToFile(
        'STEP',
        '[TESZT INDUL] should NOT end game if player has car cards available'
      );
      // >>> VÁLTOZTATÁS VÉGE

      // Initialize game
      const playerIds = ['player-1', 'player-2'];
      const playerNames = ['Player 1', 'Player 2'];
      let gameState: IGameState = initializeGame(
        playerIds,
        playerNames,
        42,
        300,
        true
      );
      logToFile('INFO', 'Játék inicializálva, seed: 42'); // <<< VÁLTOZTATÁS

      const player1 = gameState.players.find((p) => p.id === 'player-1')!;

      // Ensure player-1 has at least one car card
      const carCardsInHand = player1.hand.filter((c) => {
        const def = getCardDefinition(c.cardId);
        return def?.type === 'car';
      });
      expect(carCardsInHand.length).toBeGreaterThan(0);
      logToFile(
        'INFO',
        `Setup: Player 1-nek van ${carCardsInHand.length} db autó kártyája.`
      ); // <<< VÁLTOZTATÁS

      // Set up game state: player-1's turn, waiting for initial play
      gameState.currentPlayerId = 'player-1';
      gameState.currentPlayerPhase = 'waiting_for_initial_play';
      gameState.gameStatus = 'playing';
      gameState.winnerId = null;

      // Check game end conditions
      const resultState = checkGameEndConditions(gameState);
      logToFile('INFO', 'checkGameEndConditions lefutott.'); // <<< VÁLTOZTATÁS

      // <<< VÁLTOZTATÁS: Asszerciók logolása
      logToFile(
        'ASSERT',
        `Ellenőrzés: Játék státusz 'playing'. Jelenlegi: ${resultState.gameStatus}`
      );
      logToFile(
        'ASSERT',
        `Ellenőrzés: Győztes 'null'. Jelenlegi: ${resultState.winnerId}`
      );
      // >>> VÁLTOZTATÁS VÉGE

      // Verify game continues
      expect(resultState.gameStatus).toBe('playing');
      expect(resultState.winnerId).toBeNull();
    });
  });
});