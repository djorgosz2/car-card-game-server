import * as fs from 'fs';
import * as path from 'path';
import {
  initializeGame,
  performPlay,
  advanceTurn,
  getCardDefinition, // Szükséges a kártya típusának ellenőrzéséhez
  loadCardDefinitions, // Biztosítjuk, hogy a kártyák be legyenek töltve

} from '../shared/game-engine'; // Módosítsd az elérési utat, ha szükséges
import { IGameState, ICardInstance, IPlayerState } from '../shared/interfaces';
let uuidCounter = 1;
jest.mock('uuid', () => ({
  v4: () => `mock-uuid-${uuidCounter++}`,
}));

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
        overrideState.players.forEach((player: any) => {
          player.hand = player.hand.map((card: any) => ({
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
      scenario.steps.forEach((step: any, index: number) => {
        let newState: IGameState;

        // Akció végrehajtása a scenario alapján
        switch (step.action) {
          case 'playCard': {
            const playerState = gameState.players.find((p: IPlayerState) => p.id === step.playerId);
            if (!playerState) throw new Error(`Player not found: ${step.playerId}`);

            const cardInstanceIdToPlay = findCardInstanceIdFromHand(playerState.hand, step.findCard);

            const result = performPlay(gameState, step.playerId, cardInstanceIdToPlay, step.payload || {});
            
            // Check if the play was successful
            if (!result.success) {
                throw new Error(`PerformPlay failed: ${result.message}`);
            }
            
            newState = result.newState;
            break;
          }
          case 'advanceTurn': {
            newState = advanceTurn(gameState, gameState.roundWinnerId);
            break;
          }
          default:
            throw new Error(`Ismeretlen akció a scenarioban: ${step.action}`);
        }

        gameState = newState; // Frissítjük a játékállapotot a következő lépéshez

        // 3. Ellenőrzés és Snapshot
        if (step.expectedState) {
          Object.keys(step.expectedState).forEach(key => {
            const expectedValue = step.expectedState[key];
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
              expect((gameState as any)[key]).toEqual(expectedValue);
            }
          });
        }

        // A teljes játékállapotot összehasonlítjuk egy elmentett "pillanatképpel".
        expect(gameState).toMatchSnapshot(`Step ${index + 1}: ${step.action}`);
      });
    });
  });
});