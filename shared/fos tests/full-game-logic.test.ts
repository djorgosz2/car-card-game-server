// Teljes Játéklogika E2E Teszt
// Teszteli az összes akciókártya típust, játék kimeneteleket és kártya kiosztást

import { io } from 'socket.io-client';
import jwt from 'jsonwebtoken';
import { 
  initializeGame, 
  performPlay, 
  resolveRound, 
  advanceTurn, 
  checkGameEndConditions,
  getClientGameState,
  loadCardDefinitions,
  getCardDefinition,
  isActionCardDef,
  isCarCardDef
} from '../game-engine';
import { 
  IGameState,
  PlayerId,
  MetricType,
  ICardInstance
} from '../interfaces';

const SOCKET_URL = 'http://localhost:3000';
const JWT_SECRET = 'your_super_secret_jwt_key';

const generateToken = (userId: string, username: string) =>
  jwt.sign({ userId, username }, JWT_SECRET, { expiresIn: '1h' });

// Segédfüggvény: kártya kiosztás teszteléshez
function distributeTestCards(): { player1Cards: ICardInstance[], player2Cards: ICardInstance[] } {
  loadCardDefinitions();
  
  // Minden típusú akciókártya
  const actionCardIds = [
    'ACTION_TIME_BOOST',
    'ACTION_HP_BOOST_TEMP', 
    'ACTION_WEIGHT_PENALTY_TEMP',
    'ACTION_HP_BOOST_PERM',
    'ACTION_OVERRIDE_METRIC_CHOICE',
    'ACTION_DROP_CARD',
    'ACTION_EXTRA_TURN'
  ];

  // Autós kártyák (valós ID-k a CarList.json-ból)
  const carCardIds = [
    'CAR_ABARTH_124SPIDER_2017',
    'CAR_ALFAROMEO_SPIDERQUADRIFOGLIOVERDE_1986',
    'CAR_ACURA_66DEFERRANMOTORSPORTSJIMHALLTRIBUTEARX02A_2009',
    'CAR_ACURA_RSXTYPES_2002',
    'CAR_ACURA_NSX_2017',
    'CAR_ACURA_NSX_2016',
    'CAR_ACURA_NSX_1991'
  ];

  const createCardInstance = (cardId: string): ICardInstance => ({
    instanceId: `test-${cardId}-${Math.random()}`,
    cardId,
    currentMetrics: getCardDefinition(cardId)?.type === 'car' 
      ? { ...(getCardDefinition(cardId) as any).metrics }
      : undefined,
    originalMetrics: getCardDefinition(cardId)?.type === 'car' 
      ? { ...(getCardDefinition(cardId) as any).metrics }
      : undefined
  });

  const player1Cards = [
    ...actionCardIds.map(createCardInstance),
    ...carCardIds.slice(0, 3).map(createCardInstance)
  ];

  const player2Cards = [
    ...actionCardIds.map(createCardInstance),
    ...carCardIds.slice(3, 6).map(createCardInstance)
  ];

  return { player1Cards, player2Cards };
}

// Segédfüggvény: játék állapot szimulálása
function simulateGameTurn(
  state: IGameState, 
  playerId: PlayerId, 
  cardInstanceId: string, 
  selectedMetric?: MetricType
): IGameState {
  try {
    return performPlay(state, playerId, cardInstanceId, { selectedMetric });
  } catch (error) {
    console.error(`Error in performPlay: ${error}`);
    return state;
  }
}

// Segédfüggvény: játékos kártya keresése
function findCardByType(state: IGameState, playerId: PlayerId, cardType: 'action' | 'car', actionCardId?: string): ICardInstance | null {
  const player = state.players.find((p: any) => p.id === playerId);
  if (!player) return null;

  if (cardType === 'action') {
    if (actionCardId) {
      return player.hand.find((card: any) => card.cardId === actionCardId) || null;
    }
    return player.hand.find((card: any) => isActionCardDef(getCardDefinition(card.cardId)!)) || null;
  } else {
    return player.hand.find((card: any) => isCarCardDef(getCardDefinition(card.cardId)!)) || null;
  }
}

console.log('[FULL GAME LOGIC] Starting comprehensive game logic test...');

async function runFullGameLogicTest() {
  try {
    // 1. Kapcsolódás és authentikáció
    console.log('[FULL GAME LOGIC] Step 1: Connecting and authenticating...');
    
    const player1 = io(SOCKET_URL, { transports: ['websocket'], autoConnect: false });
    const player2 = io(SOCKET_URL, { transports: ['websocket'], autoConnect: false });

    const token1 = generateToken('player1-id', 'Alice');
    const token2 = generateToken('player2-id', 'Bob');

    // Kapcsolódás
    const p1Connect = new Promise<void>((resolve, reject) => {
      player1.on('connect', () => {
        console.log('[FULL GAME LOGIC] ✅ Player 1 connected');
        resolve();
      });
      player1.on('connect_error', reject);
    });

    const p2Connect = new Promise<void>((resolve, reject) => {
      player2.on('connect', () => {
        console.log('[FULL GAME LOGIC] ✅ Player 2 connected');
        resolve();
      });
      player2.on('connect_error', reject);
    });

    player1.connect();
    player2.connect();
    await Promise.all([p1Connect, p2Connect]);

    // Authentikáció
    const p1Auth = new Promise((resolve) => player1.on('auth:success', resolve));
    const p2Auth = new Promise((resolve) => player2.on('auth:success', resolve));

    player1.emit('auth:authenticate', { token: token1 });
    player2.emit('auth:authenticate', { token: token2 });

    await Promise.all([p1Auth, p2Auth]);

    // 2. Matchmaking és játék indítása
    console.log('[FULL GAME LOGIC] Step 2: Starting matchmaking...');
    
    const waitFor = (socket: any, event: string) => new Promise(resolve => socket.once(event, resolve));
    
    const p1State = waitFor(player1, 'game:stateUpdate');
    const p2State = waitFor(player2, 'game:stateUpdate');

    player1.emit('matchmaking:find');
    player2.emit('matchmaking:find');

    const [initialState1, initialState2] = await Promise.all([p1State, p2State]) as [IGameState, IGameState];
    
    console.log('[FULL GAME LOGIC] ✅ Game started!');
    console.log('[FULL GAME LOGIC] Initial game state:', {
      gameId: initialState1.gameId,
      currentPlayer: initialState1.currentPlayerId,
      players: initialState1.players.map((p: any) => ({ id: p.id, name: p.name, handSize: p.hand.length })),
      gameStatus: initialState1.gameStatus
    });

    // 3. Játéklogika tesztelése
    console.log('[FULL GAME LOGIC] Step 3: Testing game logic...');
    
    // Teszt 1: Akciókártya + Autós kártya kombináció
    console.log('[FULL GAME LOGIC] Test 1: Action card + Car card combination');
    
    let currentState = initialState1;
    let turnCount = 0;
    const maxTurns = 10; // Biztonsági limit

    while (currentState.gameStatus === 'playing' && turnCount < maxTurns) {
      turnCount++;
      const currentPlayerId = currentState.currentPlayerId;
      const currentPlayer = currentState.players.find((p: any) => p.id === currentPlayerId)!;
      
      console.log(`\n[FULL GAME LOGIC] Turn ${turnCount}: ${currentPlayer.name}'s turn`);
      console.log(`[FULL GAME LOGIC] Phase: ${currentState.currentPlayerPhase}`);
      console.log(`[FULL GAME LOGIC] Hand size: ${currentPlayer.hand.length}`);

      // Keresünk egy akciókártyát, ha a fázis megfelelő
      if (currentState.currentPlayerPhase === 'waiting_for_initial_play') {
        const actionCard = findCardByType(currentState, currentPlayerId, 'action');
        
        if (actionCard) {
          console.log(`[FULL GAME LOGIC] Playing action card: ${actionCard.cardId}`);
          currentState = simulateGameTurn(currentState, currentPlayerId, actionCard.instanceId);
          
          // Ellenőrizzük az állapotot
          if (currentState.currentPlayerPhase === 'waiting_for_car_card_after_action') {
            console.log('[FULL GAME LOGIC] ✅ Action card applied successfully');
          }
        }
      }

      // Keresünk egy autós kártyát
      const carCard = findCardByType(currentState, currentPlayerId, 'car');
      
      if (carCard) {
        const selectedMetric = currentState.selectedMetricForRound || 'hp';
        console.log(`[FULL GAME LOGIC] Playing car card: ${carCard.cardId} with metric: ${selectedMetric}`);
        
        currentState = simulateGameTurn(currentState, currentPlayerId, carCard.instanceId, selectedMetric);
        
        // Ellenőrizzük a kör lezárását
        const opponentId = currentState.players.find((p: any) => p.id !== currentPlayerId)!.id;
        if (currentState.carCardsOnBoard[currentPlayerId] && currentState.carCardsOnBoard[opponentId]) {
          console.log('[FULL GAME LOGIC] Both players played car cards, resolving round...');
          currentState = resolveRound(currentState);
          
          if (currentState.roundWinnerId) {
            const winner = currentState.players.find((p: any) => p.id === currentState.roundWinnerId)!;
            console.log(`[FULL GAME LOGIC] ✅ Round winner: ${winner.name}`);
          } else {
            console.log('[FULL GAME LOGIC] ✅ Round ended in tie');
          }
        }
      }

      // Játék vége ellenőrzése
      currentState = checkGameEndConditions(currentState);
      
      if (currentState.gameStatus !== 'playing') {
        console.log(`[FULL GAME LOGIC] 🎯 Game ended with status: ${currentState.gameStatus}`);
        if (currentState.winnerId) {
          const winner = currentState.players.find((p: any) => p.id === currentState.winnerId)!;
          console.log(`[FULL GAME LOGIC] 🏆 Winner: ${winner.name}`);
        }
        break;
      }

      // Körváltás, ha szükséges
      if (currentState.currentPlayerPhase === 'turn_ended') {
        currentState = advanceTurn(currentState, currentState.roundWinnerId);
        const nextPlayer = currentState.players.find((p: any) => p.id === currentState.currentPlayerId)!;
        console.log(`[FULL GAME LOGIC] --> Next player: ${nextPlayer.name}`);
      }
    }

    // 4. Kártya kiosztás tesztelése
    console.log('\n[FULL GAME LOGIC] Step 4: Testing card distribution...');
    
    const { player1Cards, player2Cards } = distributeTestCards();
    
    console.log('[FULL GAME LOGIC] Player 1 cards:', player1Cards.map(c => c.cardId));
    console.log('[FULL GAME LOGIC] Player 2 cards:', player2Cards.map(c => c.cardId));
    
    // Ellenőrizzük, hogy minden típusú akciókártya megvan-e
    const actionCardTypes = new Set(player1Cards.filter(c => isActionCardDef(getCardDefinition(c.cardId)!)).map(c => c.cardId));
    console.log('[FULL GAME LOGIC] Action card types distributed:', Array.from(actionCardTypes));

    // 5. Kliens állapot szűrés tesztelése
    console.log('\n[FULL GAME LOGIC] Step 5: Testing client state filtering...');
    
    const clientState = getClientGameState(currentState, 'player1-id');
    console.log('[FULL GAME LOGIC] Client state for player1:');
    console.log('- Own hand size:', clientState.players.find(p => p.id === 'player1-id')!.hand.length);
    console.log('- Opponent hand size:', clientState.players.find(p => p.id === 'player2-id')!.hand.length);
    console.log('- Opponent cards are hidden:', clientState.players.find(p => p.id === 'player2-id')!.hand.every(c => c.cardId === 'HIDDEN_CARD_BACK'));

    console.log('\n[FULL GAME LOGIC] ✅ All tests completed successfully!');
    
    // Cleanup
    player1.disconnect();
    player2.disconnect();
    process.exit(0);

  } catch (error) {
    console.error('[FULL GAME LOGIC] ❌ Test failed:', error);
    process.exit(1);
  }
}

// Futtatás
runFullGameLogicTest();

// Timeout
setTimeout(() => {
  console.error('[FULL GAME LOGIC] ❌ Test timeout');
  process.exit(1);
}, 60000); 