import * as fs from 'fs';
import * as path from 'path';
import {
  initializeGame,
  performPlay,
  advanceTurn,
  getCardDefinition, // Szükséges a kártya típusának ellenőrzéséhez
  loadCardDefinitions, // Biztosítjuk, hogy a kártyák be legyenek töltve
  resolveRound,

} from '../shared/game-engine'; // Módosítsd az elérési utat, ha szükséges
import { IGameState, ICardInstance, IPlayerState } from '../shared/interfaces';
let uuidCounter = 1;
jest.mock('uuid', () => ({
  v4: () => `mock-uuid-${uuidCounter++}`,
}));

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
const scenarioFiles = fs.readdirSync(scenariosDir).filter(file => file.endsWith('.scenario.json'));

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
    filteredHand = filteredHand.filter(card => card.cardId === criteria.cardId);
  } else if (criteria.type) {
    // Keresés kártya típus alapján (pl. az első 'car' típusú kártya)
    filteredHand = filteredHand.filter(card => getCardDefinition(card.cardId)?.type === criteria.type);
  }

  const card = filteredHand[criteria.indexInHand ?? 0];
  if (!card) {
    const availableCards = hand.map(c => c.cardId).join(', ') || 'nincs';
    throw new Error(`Nem található a kritériumnak megfelelő kártya a tesztben: ${JSON.stringify(criteria)}. Elérhető kártyák: [${availableCards}]`);
  }
  return card.instanceId;
};


describe('Game Engine Scenarios', () => {
  // A tesztek előtt egyszer betöltjük az összes kártyadefiníciót
  beforeAll(() => {
    loadCardDefinitions();
    }
  );
  beforeEach(() => {
    uuidCounter = 1;
    // JAVÍTÁS: Mockoljuk a Date.now()-t, hogy a currentTurnStartTime is determinisztikus legyen.
    jest.spyOn(Date, 'now').mockImplementation(() => 1234567890123);
  });
  scenarioFiles.forEach(file => {
    const scenario = JSON.parse(fs.readFileSync(path.join(scenariosDir, file), 'utf-8'));

    test(scenario.description, () => {
      // 1. Játék inicializálása a forgatókönyv alapján
      const playerIds = scenario.playerIds || ['player-1', 'player-2'];
      const playerNames = scenario.playerNames || ['Player 1', 'Player 2'];
      let gameState: IGameState = initializeGame(
        playerIds,
        playerNames,
        scenario.initialSeed,
        300,
        true
      );
      if (scenario.overrideInitialState) {
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
          activeActionCardsOnBoard: { [playerIds[0]]: null, [playerIds[1]]: null },
          carCardsOnBoard: { [playerIds[0]]: null, [playerIds[1]]: null },
          discardPile: [],
          drawPile: [],
          extraTurnPlayerId: null,
          pendingMetricModifiers: { [playerIds[0]]: null, [playerIds[1]]: null },
          gameLog: ['A teszt egyedi állapottal indult.'],
        };

        // 2. Alakítsuk át a kártyákat a kézben instance-okká
        (overrideState.players as OverridePlayer[]).forEach((player) => {
          player.hand = player.hand.map((card: OverrideHandCard) => ({
            instanceId: `mock-uuid-${uuidCounter++}`,
            cardId: card.cardId,
            currentMetrics: card.type === 'car' ? getCardDefinition(card.cardId)?.metrics : undefined,
            originalMetrics: card.type === 'car' ? getCardDefinition(card.cardId)?.metrics : undefined,
          }));
        });

        // 3. Egyesítsük az alap állapotot a felülírással
        // Ami az overrideState-ben meg van adva, az felülírja az alapértelmezettet.
        gameState = { ...baseGameState, ...overrideState } as IGameState;
      } else {
        const playerIds = scenario.playerIds || ['player-1', 'player-2'];
        const playerNames = scenario.playerNames || ['Player 1', 'Player 2'];
        gameState = initializeGame(playerIds, playerNames, scenario.initialSeed, 300, true);
      }
      // 2. Végigmegyünk a forgatókönyv lépésein
      (scenario.steps as ScenarioStep[]).forEach((step, index: number) => {
        let newState: IGameState;

        // Akció végrehajtása a scenario alapján
        switch (step.action) {
          case 'playCard': {
            const playerState = gameState.players.find((p: IPlayerState) => p.id === step.playerId);
            if (!playerState) throw new Error(`Player not found: ${step.playerId}`);

            const cardInstanceIdToPlay = findCardInstanceIdFromHand(playerState.hand, step.findCard ?? {});

            const result = performPlay(gameState, step.playerId!, cardInstanceIdToPlay, step.payload || {});
            
            // Check if the play was successful
            if (!result.success) {
                throw new Error(`PerformPlay failed: ${result.message}`);
            }
            
            newState = result.newState;
            break;
          }
          case 'advanceTurn': {
            // If both cards are on board, resolve first (server-timer simulated), then advance
            if (gameState.currentPlayerPhase === 'both_cards_on_board') {
              const resolved = resolveRound(gameState);
              newState = advanceTurn(resolved, resolved.roundWinnerId);
            } else {
              newState = advanceTurn(gameState, gameState.roundWinnerId);
            }
            break;
          }
          default:
            throw new Error(`Ismeretlen akció a scenarioban: ${step.action}`);
        }

        gameState = newState; // Frissítjük a játékállapotot a következő lépéshez

        // 3. Ellenőrzés és Snapshot
        if (step.expectedState) {
          const expectedState = step.expectedState as Record<string, unknown>;
          Object.keys(expectedState).forEach(key => {
            const expectedValue = expectedState[key];
            const actualPlayerState = (playerId: string): IPlayerState => {
              const p = gameState.players.find((p: IPlayerState) => p.id === playerId);
              if (!p) throw new Error(`Player ID not found for assertion: ${playerId}`);
              return p;
            };

            // Speciális asserciók kezelése a gameState komplexebb részeire
            if (key.endsWith('_handSize')) {
              const playerId = key.split('_')[0];
              expect(actualPlayerState(playerId).hand.length).toBe(expectedValue);
            } else if (key.endsWith('_score')) {
              const playerId = key.split('_')[0];
              expect(actualPlayerState(playerId).score).toBe(expectedValue);
            } else if (key.startsWith('carOnBoardFor_')) {
              const playerId = key.replace('carOnBoardFor_', '');
              expect(!!gameState.carCardsOnBoard[playerId]).toBe(expectedValue);
            } else if (key.startsWith('actionCardOnBoardFor_')) {
              const playerId = key.replace('actionCardOnBoardFor_', '');
              expect(!!gameState.activeActionCardsOnBoard[playerId]).toBe(expectedValue);
            } else {
              // Általános asserciók a gameState gyökerében lévő tulajdonságokra
              expect((gameState as unknown as Record<string, unknown>)[key]).toEqual(expectedValue as unknown);
            }
          });
        }

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
    });

    test('should enter both_cards_on_board phase when both players play cards', () => {
      // Initialize game
      const playerIds = ['player1', 'player2'];
      const playerNames = ['Player 1', 'Player 2'];
      let gameState: IGameState = initializeGame(playerIds, playerNames, 42, 300, true);

      // Find car cards in both players' hands
      const player1 = gameState.players.find(p => p.id === 'player1')!;
      const player2 = gameState.players.find(p => p.id === 'player2')!;

      const player1CarCard = player1.hand.find(card => 
        getCardDefinition(card.cardId)?.type === 'car'
      );
      const player2CarCard = player2.hand.find(card => 
        getCardDefinition(card.cardId)?.type === 'car'
      );

      expect(player1CarCard).toBeDefined();
      expect(player2CarCard).toBeDefined();

      // Player 1 plays a car card
      const result1 = performPlay(gameState, 'player1', player1CarCard!.instanceId, { 
        selectedMetric: 'hp' 
      });
      if (!result1.success) throw new Error(result1.message);
      gameState = result1.newState;

      // Verify player 1's card is on board
      expect(gameState.carCardsOnBoard['player1']).not.toBeNull();
      expect(gameState.carCardsOnBoard['player2']).toBeNull();
      expect(gameState.currentPlayerPhase).toBe('waiting_for_initial_play');
      expect(gameState.currentPlayerId).toBe('player2');

      // Player 2 plays a car card
      const result2 = performPlay(gameState, 'player2', player2CarCard!.instanceId, { 
        selectedMetric: 'hp' 
      });
      if (!result2.success) throw new Error(result2.message);
      gameState = result2.newState;

      // Verify both cards are on board and phase is both_cards_on_board
      expect(gameState.carCardsOnBoard['player1']).not.toBeNull();
      expect(gameState.carCardsOnBoard['player2']).not.toBeNull();
      expect(gameState.currentPlayerPhase).toBe('both_cards_on_board');
      // Ensure server also logs the comparison moment
      expect(gameState.gameLog).toContain('Mindkét játékos kijátszotta a kártyáját!');
      
      // CRITICAL: Game should still be playing (not ended prematurely)
      expect(gameState.gameStatus).toBe('playing');
      expect(gameState.winnerId).toBeNull();
    });

    test('resolveRound then advanceTurn should resolve and advance', () => {
      // Initialize game
      const playerIds = ['player1', 'player2'];
      const playerNames = ['Player 1', 'Player 2'];
      let gameState: IGameState = initializeGame(playerIds, playerNames, 42, 300, true);

      // Find car cards in both players' hands
      const player1 = gameState.players.find(p => p.id === 'player1')!;
      const player2 = gameState.players.find(p => p.id === 'player2')!;

      const player1CarCard = player1.hand.find(card => 
        getCardDefinition(card.cardId)?.type === 'car'
      );
      const player2CarCard = player2.hand.find(card => 
        getCardDefinition(card.cardId)?.type === 'car'
      );

      // Both players play cards
      const result1 = performPlay(gameState, 'player1', player1CarCard!.instanceId, { 
        selectedMetric: 'hp' 
      });
      if (!result1.success) throw new Error(result1.message);
      gameState = result1.newState;

      const result2 = performPlay(gameState, 'player2', player2CarCard!.instanceId, { 
        selectedMetric: 'hp' 
      });
      if (!result2.success) throw new Error(result2.message);
      gameState = result2.newState;

      // Verify we're in both_cards_on_board phase
      expect(gameState.currentPlayerPhase).toBe('both_cards_on_board');

      // Store card count before resolution
      const player1HandSizeBefore = gameState.players.find(p => p.id === 'player1')!.hand.length;
      const player2HandSizeBefore = gameState.players.find(p => p.id === 'player2')!.hand.length;

      // Resolve round then advance turn
      gameState = resolveRound(gameState);
      gameState = advanceTurn(gameState, gameState.roundWinnerId);

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
});