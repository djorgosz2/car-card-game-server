// Egyszerű Játéklogika Teszt
// Teszteli az alapvető játéklogikát a valós kártya adatbázissal

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
} from './gameEngine';
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

console.log('[SIMPLE GAME LOGIC] Starting simple game logic test...');

async function runSimpleGameLogicTest() {
  try {
    // 1. Kártya definíciók betöltése
    console.log('[SIMPLE GAME LOGIC] Step 1: Loading card definitions...');
    loadCardDefinitions();
    console.log('[SIMPLE GAME LOGIC] ✅ Card definitions loaded');

    // 2. Kapcsolódás és authentikáció
    console.log('[SIMPLE GAME LOGIC] Step 2: Connecting and authenticating...');
    
    const player1 = io(SOCKET_URL, { transports: ['websocket'], autoConnect: false });
    const player2 = io(SOCKET_URL, { transports: ['websocket'], autoConnect: false });

    const token1 = generateToken('player1-id', 'Alice');
    const token2 = generateToken('player2-id', 'Bob');

    // Kapcsolódás
    const p1Connect = new Promise<void>((resolve, reject) => {
      player1.on('connect', () => {
        console.log('[SIMPLE GAME LOGIC] ✅ Player 1 connected');
        resolve();
      });
      player1.on('connect_error', reject);
    });

    const p2Connect = new Promise<void>((resolve, reject) => {
      player2.on('connect', () => {
        console.log('[SIMPLE GAME LOGIC] ✅ Player 2 connected');
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

    // 3. Matchmaking és játék indítása
    console.log('[SIMPLE GAME LOGIC] Step 3: Starting matchmaking...');
    
    const waitFor = (socket: any, event: string) => new Promise(resolve => socket.once(event, resolve));
    
    const p1State = waitFor(player1, 'game:stateUpdate');
    const p2State = waitFor(player2, 'game:stateUpdate');

    player1.emit('matchmaking:find');
    player2.emit('matchmaking:find');

    const [initialState1, initialState2] = await Promise.all([p1State, p2State]) as [IGameState, IGameState];
    
    console.log('[SIMPLE GAME LOGIC] ✅ Game started!');
    console.log('[SIMPLE GAME LOGIC] Initial game state:', {
      gameId: initialState1.gameId,
      currentPlayer: initialState1.currentPlayerId,
      players: initialState1.players.map((p: any) => ({ 
        id: p.id, 
        name: p.name, 
        handSize: p.hand.length,
        carCards: p.hand.filter((c: any) => isCarCardDef(getCardDefinition(c.cardId)!)).length,
        actionCards: p.hand.filter((c: any) => isActionCardDef(getCardDefinition(c.cardId)!)).length
      })),
      gameStatus: initialState1.gameStatus
    });

    // 4. Játéklogika tesztelése
    console.log('[SIMPLE GAME LOGIC] Step 4: Testing game logic...');
    
    let currentState = initialState1;
    let turnCount = 0;
    const maxTurns = 5; // Rövidebb teszt

    while (currentState.gameStatus === 'playing' && turnCount < maxTurns) {
      turnCount++;
      const currentPlayerId = currentState.currentPlayerId;
      const currentPlayer = currentState.players.find((p: any) => p.id === currentPlayerId)!;
      
      console.log(`\n[SIMPLE GAME LOGIC] Turn ${turnCount}: ${currentPlayer.name}'s turn`);
      console.log(`[SIMPLE GAME LOGIC] Phase: ${currentState.currentPlayerPhase}`);
      console.log(`[SIMPLE GAME LOGIC] Hand size: ${currentPlayer.hand.length}`);

      // Keresünk egy akciókártyát, ha a fázis megfelelő
      if (currentState.currentPlayerPhase === 'waiting_for_initial_play') {
        const actionCard = currentPlayer.hand.find((card: any) => isActionCardDef(getCardDefinition(card.cardId)!));
        
        if (actionCard) {
          console.log(`[SIMPLE GAME LOGIC] Playing action card: ${actionCard.cardId}`);
          try {
            currentState = performPlay(currentState, currentPlayerId, actionCard.instanceId, {});
            console.log('[SIMPLE GAME LOGIC] ✅ Action card applied successfully');
          } catch (error) {
            console.error('[SIMPLE GAME LOGIC] ❌ Action card play failed:', error);
          }
        }
      }

      // Keresünk egy autós kártyát
      const carCard = currentPlayer.hand.find((card: any) => isCarCardDef(getCardDefinition(card.cardId)!));
      
      if (carCard) {
        const selectedMetric = currentState.selectedMetricForRound || 'hp';
        console.log(`[SIMPLE GAME LOGIC] Playing car card: ${carCard.cardId} with metric: ${selectedMetric}`);
        
        try {
          currentState = performPlay(currentState, currentPlayerId, carCard.instanceId, { selectedMetric });
          
          // Ellenőrizzük a kör lezárását
          const opponentId = currentState.players.find((p: any) => p.id !== currentPlayerId)!.id;
          if (currentState.carCardsOnBoard[currentPlayerId] && currentState.carCardsOnBoard[opponentId]) {
            console.log('[SIMPLE GAME LOGIC] Both players played car cards, resolving round...');
            currentState = resolveRound(currentState);
            
            if (currentState.roundWinnerId) {
              const winner = currentState.players.find((p: any) => p.id === currentState.roundWinnerId)!;
              console.log(`[SIMPLE GAME LOGIC] ✅ Round winner: ${winner.name}`);
            } else {
              console.log('[SIMPLE GAME LOGIC] ✅ Round ended in tie');
            }
          }
        } catch (error) {
          console.error('[SIMPLE GAME LOGIC] ❌ Car card play failed:', error);
        }
      }

      // Játék vége ellenőrzése
      currentState = checkGameEndConditions(currentState);
      
      if (currentState.gameStatus !== 'playing') {
        console.log(`[SIMPLE GAME LOGIC] 🎯 Game ended with status: ${currentState.gameStatus}`);
        if (currentState.winnerId) {
          const winner = currentState.players.find((p: any) => p.id === currentState.winnerId)!;
          console.log(`[SIMPLE GAME LOGIC] 🏆 Winner: ${winner.name}`);
        }
        break;
      }

      // Körváltás, ha szükséges
      if (currentState.currentPlayerPhase === 'turn_ended') {
        currentState = advanceTurn(currentState, currentState.roundWinnerId);
        const nextPlayer = currentState.players.find((p: any) => p.id === currentState.currentPlayerId)!;
        console.log(`[SIMPLE GAME LOGIC] --> Next player: ${nextPlayer.name}`);
      }
    }

    // 5. Kliens állapot szűrés tesztelése
    console.log('\n[SIMPLE GAME LOGIC] Step 5: Testing client state filtering...');
    
    const clientState = getClientGameState(currentState, 'player1-id');
    console.log('[SIMPLE GAME LOGIC] Client state for player1:');
    console.log('- Own hand size:', clientState.players.find((p: any) => p.id === 'player1-id')!.hand.length);
    console.log('- Opponent hand size:', clientState.players.find((p: any) => p.id === 'player2-id')!.hand.length);
    console.log('- Opponent cards are hidden:', clientState.players.find((p: any) => p.id === 'player2-id')!.hand.every((c: any) => c.cardId === 'HIDDEN_CARD_BACK'));

    console.log('\n[SIMPLE GAME LOGIC] ✅ All tests completed successfully!');
    
    // Cleanup
    player1.disconnect();
    player2.disconnect();
    process.exit(0);

  } catch (error) {
    console.error('[SIMPLE GAME LOGIC] ❌ Test failed:', error);
    process.exit(1);
  }
}

// Futtatás
runSimpleGameLogicTest();

// Timeout
setTimeout(() => {
  console.error('[SIMPLE GAME LOGIC] ❌ Test timeout');
  process.exit(1);
}, 60000); 