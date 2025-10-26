import { GameManager } from '../src/game-manager';
import { Server } from 'socket.io';
import { initializeGame, performPlay, advanceTurn, getClientGameState } from '../shared/game-engine';
import { decideMove } from '../src/ai-manager';
import { IGameState } from '../shared/interfaces';
import * as jsonpatch from 'fast-json-patch';

// --- Mockok beállítása ---


// Mockoljuk a teljes game-engine-t, mert csak azt akarjuk tesztelni, hogy a GameManager helyesen hívja-e meg.
jest.mock('../shared/game-engine', () => ({
    ...jest.requireActual('../shared/game-engine'), // A többi függvényt meghagyjuk eredetiben
    initializeGame: jest.fn(),
    performPlay: jest.fn(),
    advanceTurn: jest.fn(),
    getClientGameState: jest.fn(),
}));

// Mockoljuk az aiManager-t, hogy irányítani tudjuk a bot döntéseit.
jest.mock('../src/ai-manager', () => ({
    decideMove: jest.fn(),
}));

// Mockoljuk a setTimeout-ot, hogy ne kelljen valós időben várnunk.
jest.useFakeTimers();

// --- Teszt Környezet ---

describe('GameManager', () => {
    let mockIo: Server;
    let mockSocketP1: any;
    let mockSocketP2: any;
    let mockOnGameEnd: jest.Mock;
    let mockGameState: IGameState;
    let players: any[];

    // Minden teszt előtt létrehozunk egy tiszta, alap környezetet.
    beforeEach(() => {
        // Töröljük a korábbi mock hívásokat
        (initializeGame as jest.Mock).mockClear();
        (performPlay as jest.Mock).mockClear();
        (advanceTurn as jest.Mock).mockClear();
        (getClientGameState as jest.Mock).mockClear();
        (decideMove as jest.Mock).mockClear();

        // Egyszerűsített Socket.IO mock
        mockIo = {
            to: jest.fn().mockReturnThis(),
            emit: jest.fn(),
            sockets: { sockets: new Map() },
        } as any;

        mockSocketP1 = { id: 'socket-1', join: jest.fn(), on: jest.fn(), removeAllListeners: jest.fn(), emit: jest.fn() };
        mockSocketP2 = { id: 'socket-2', join: jest.fn(), on: jest.fn(), removeAllListeners: jest.fn(), emit: jest.fn() };

        (mockIo.sockets.sockets as Map<string, any>).set('socket-1', mockSocketP1);
        (mockIo.sockets.sockets as Map<string, any>).set('socket-2', mockSocketP2);

        mockOnGameEnd = jest.fn();

        players = [
            { userId: 'player-1', username: 'P1', isBot: false, socketId: 'socket-1', joinedAt: Date.now() },
            { userId: 'player-2', username: 'P2', isBot: false, socketId: 'socket-2', joinedAt: Date.now() },
        ];

        // Alapértelmezett gameState, amit a mockolt függvények visszaadnak
        mockGameState = {
            gameId: 'test-game',
            players: [{ id: 'player-1', name: 'P1', hand: [], score: 0 }, { id: 'player-2', name: 'P2', hand: [], score: 0 }],
            currentPlayerId: 'player-1',
            gameStatus: 'playing',
            currentPlayerPhase: 'waiting_for_initial_play',
            drawPile: [],
            discardPile: [],
            carCardsOnBoard: { 'player-1': null, 'player-2': null },
            activeActionCardsOnBoard: { 'player-1': null, 'player-2': null },
            pendingMetricModifiers: { 'player-1': null, 'player-2': null },
            selectedMetricForRound: null,
            roundWinnerId: null,
            winnerId: null,
            lastPlayedCardInstanceId: null,
            currentTurnStartTime: Date.now(),
            turnTimeLimit: 60000,
            rngSeed: 12345,
            gameLog: [],
            extraTurnPlayerId: null,
        } as any;

        // A mockolt függvények alapértelmezett viselkedése
        (initializeGame as jest.Mock).mockReturnValue(mockGameState);
        (performPlay as jest.Mock).mockReturnValue({ newState: mockGameState, success: true });
        (advanceTurn as jest.Mock).mockReturnValue(mockGameState);
        (getClientGameState as jest.Mock).mockImplementation((state, playerId) => ({
            ...state,
            requestingPlayerId: playerId
        }));
    });

    it('should initialize correctly, join players to room, and broadcast initial state', () => {
        // Mock getClientGameState to return proper state for each player
        (getClientGameState as jest.Mock).mockImplementation((state, playerId) => ({
            ...mockGameState,
            requestingPlayerId: playerId
        }));

        const gameManager = new GameManager('test-game', players, mockIo, { turnTimeLimitSeconds: 60 }, mockOnGameEnd);

        // Ellenőrizzük, hogy a game-engine helyesen lett-e meghívva
        expect(initializeGame).toHaveBeenCalledWith(['player-1', 'player-2'], ['P1', 'P2'], expect.any(Number), 60000, true);

        // Ellenőrizzük a socket kommunikációt
        expect(mockSocketP1.join).toHaveBeenCalledWith('test-game');
        expect(mockSocketP2.join).toHaveBeenCalledWith('test-game');
        expect(mockIo.to).toHaveBeenCalledWith('test-game');
        expect(mockIo.emit).toHaveBeenCalledWith('game:start', expect.any(Object));

        // Ellenőrizzük, hogy mindkét játékos megkapta a kezdő állapotot (teljes state, nem patch)
        expect(mockSocketP1.emit).toHaveBeenCalledWith('game:stateUpdate', expect.any(Object));
        expect(mockSocketP2.emit).toHaveBeenCalledWith('game:stateUpdate', expect.any(Object));
    });

    it('should handle a player move and update the state with patch', () => {
        // Mock getClientGameState to return different states
        const initialState = { ...mockGameState, turnCount: 0 };
        const updatedState = { ...mockGameState, turnCount: 1 };

        (getClientGameState as jest.Mock)
            .mockReturnValueOnce(initialState)  // Initial state for P1
            .mockReturnValueOnce(initialState)  // Initial state for P2
            .mockReturnValueOnce(updatedState)  // Updated state for P1 after move
            .mockReturnValueOnce(updatedState); // Updated state for P2 after move

        const gameManager = new GameManager('test-game', players, mockIo, { turnTimeLimitSeconds: 60 }, mockOnGameEnd);

        // Szimuláljuk a socket eseményt a handlePlayerMove közvetlen hívásával
        const moveData = { cardInstanceId: 'card-123', payload: { selectedMetric: 'speed' } };
        (gameManager as any).handlePlayerMove('player-1', moveData);

        // Ellenőrizzük, hogy a performPlay meg lett-e hívva a helyes adatokkal
        expect(performPlay).toHaveBeenCalledWith(mockGameState, 'player-1', 'card-123', { selectedMetric: 'speed' });

        // Ellenőrizzük, hogy patch-eket küldtek (nem teljes állapotot)
        // 1. game:stateUpdate (initial), 2. game:patch (after move)
        expect(mockSocketP1.emit).toHaveBeenCalledWith('game:stateUpdate', expect.any(Object));
        expect(mockSocketP1.emit).toHaveBeenCalledWith('game:patch', expect.any(Array));
    });

    it('should trigger a bot move if it is the bot\'s turn', () => {
        const botPlayers = [
            { userId: 'player-1', username: 'P1', isBot: false, socketId: 'socket-1', joinedAt: Date.now() },
            { userId: 'bot-1', username: 'AI', isBot: true, socketId: 'bot-socket', joinedAt: Date.now() },
        ];

        // A bot lépését szimuláljuk
        const botMove = { cardInstanceId: 'bot-card', payload: { selectedMetric: 'hp' } };
        (decideMove as jest.Mock).mockReturnValue(botMove);

        // A performPlay-t úgy állítjuk be, hogy a bot körét adja vissza, majd a bot lépése után visszaadja player-1-et
        const stateAfterHumanMove = { ...mockGameState, currentPlayerId: 'bot-1' };
        const stateAfterBotMove = { ...mockGameState, currentPlayerId: 'player-1' };
        (performPlay as jest.Mock)
            .mockReturnValueOnce({ newState: stateAfterHumanMove, success: true })  // P1 lépése után
            .mockReturnValueOnce({ newState: stateAfterBotMove, success: true });   // Bot lépése után

        const gameManager = new GameManager('test-game', botPlayers, mockIo, { turnTimeLimitSeconds: 60 }, mockOnGameEnd);

        // Szimuláljuk, hogy P1 lépett
        (gameManager as any).handlePlayerMove('player-1', { cardInstanceId: 'p1-card', payload: {} });

        // Ellenőrizzük, hogy a performPlay meghívódott P1 lépésével
        expect(performPlay).toHaveBeenCalledWith(expect.anything(), 'player-1', 'p1-card', {});

        // Tekerjük előre az időt, hogy a bot setTimeout-ja lefusson
        jest.runAllTimers();

        // Ellenőrizzük, hogy a bot logikája lefutott-e
        expect(decideMove).toHaveBeenCalledWith(stateAfterHumanMove, 'bot-1');

        // Ellenőrizzük, hogy a performPlay másodszor is meghívódott, de most már a bot lépésével
        expect(performPlay).toHaveBeenCalledWith(stateAfterHumanMove, 'bot-1', botMove.cardInstanceId, botMove.payload);
    });

    it('should end the game if a player disconnects', () => {
        const gameManager = new GameManager('test-game', players, mockIo, { turnTimeLimitSeconds: 60 }, mockOnGameEnd);

        gameManager.handlePlayerDisconnect('player-1');

        // Ellenőrizzük, hogy a játék vége esemény ki lett-e küldve
        expect(mockIo.emit).toHaveBeenCalledWith('game:end', { winnerId: 'player-2', gameStatus: 'win' });

        // Ellenőrizzük, hogy a cleanup callback meghívódott-e
        expect(mockOnGameEnd).toHaveBeenCalledWith('test-game');
    });
    it('should ignore moves from a player who is not on turn', () => {
        const gameManager = new GameManager('test-game', players, mockIo, { turnTimeLimitSeconds: 60 }, mockOnGameEnd);

        // P2 próbál lépni, pedig P1 van soron
        (gameManager as any).handlePlayerMove('player-2', { cardInstanceId: 'any-card' });

        expect(performPlay).not.toHaveBeenCalled();
    });
    it('should handle invalid move from performPlay and emit a game:error to the correct player', () => {
        (performPlay as jest.Mock).mockReturnValue({
            newState: mockGameState,
            success: false,
            message: 'Szabálytalan lap'
        });

        const gameManager = new GameManager('test-game', players, mockIo, { turnTimeLimitSeconds: 60 }, mockOnGameEnd);

        (gameManager as any).handlePlayerMove('player-1', { cardInstanceId: 'invalid-card' });

        expect(mockSocketP1.emit).toHaveBeenCalledWith('game:error', { message: 'Szabálytalan lap' });
        expect(mockSocketP2.emit).not.toHaveBeenCalledWith('game:error', expect.any(Object));
    });
    // A fájl tetején a mockoknál:
    // jest.mock('../shared/game-engine', () => ({ ... endGameByTimeout: jest.fn() ... }));

    it('should handle turn timeout', () => {
        const gameManager = new GameManager('test-game', players, mockIo, { turnTimeLimitSeconds: 60 }, mockOnGameEnd);

        // Tekerjük előre az időt, hogy a timeout lefusson
        jest.runAllTimers();

        // Itt az endGameByTimeout hívását már a GameManager belső logikája végzi.
        // A végeredményt kell ellenőriznünk: a játék véget ért-e.
        expect(mockOnGameEnd).toHaveBeenCalledWith('test-game');
        expect(mockIo.emit).toHaveBeenCalledWith('game:end', expect.objectContaining({ winnerId: 'player-2' }));
    });
    it('should handle a player reconnecting with a new socket', () => {
        // 1. Létrehozzuk a GameManager-t a normál játékosokkal
        const gameManager = new GameManager('test-game', players, mockIo, { turnTimeLimitSeconds: 60 }, mockOnGameEnd);

        // 2. Létrehozunk egy új, "kamu" socketet a visszacsatlakozáshoz
        const newMockSocket = {
            id: 'new-socket-id',
            join: jest.fn(),
            on: jest.fn(),
            removeAllListeners: jest.fn(),
            emit: jest.fn()
        };

        // 3. Szimuláljuk a visszacsatlakozási eseményt
        gameManager.handlePlayerReconnect('player-1', newMockSocket as any);

        // 4. Ellenőrzések
        // Az új socket csatlakozott a játék szobájához?
        expect(newMockSocket.join).toHaveBeenCalledWith('test-game');

        // Az eseménykezelők újra be lettek állítva az új socketen?
        expect(newMockSocket.removeAllListeners).toHaveBeenCalled();
        expect(newMockSocket.on).toHaveBeenCalledWith('game:playCard', expect.any(Function));
        expect(newMockSocket.on).toHaveBeenCalledWith('game:advanceTurn', expect.any(Function));

        // A visszacsatlakozott játékos megkapta a friss játékállapotot (teljes state, nem patch)?
        expect(newMockSocket.emit).toHaveBeenCalledWith('game:stateUpdate', expect.any(Object));
        // Verify NO patch was sent on reconnect (only full state)
        const patchCall = newMockSocket.emit.mock.calls.find((call: any) => call[0] === 'game:patch');
        expect(patchCall).toBeUndefined();
    });
    it('should send patches instead of full state on subsequent updates', () => {
        const initialState = { ...mockGameState, turnCount: 0, currentPlayerId: 'player-1' };
        const updatedState = { ...mockGameState, turnCount: 1, currentPlayerId: 'player-2' };

        (getClientGameState as jest.Mock)
            .mockReturnValueOnce(initialState)  // Initial for P1
            .mockReturnValueOnce(initialState)  // Initial for P2
            .mockReturnValueOnce(updatedState)  // After move for P1
            .mockReturnValueOnce(updatedState); // After move for P2

        const gameManager = new GameManager('test-game', players, mockIo, { turnTimeLimitSeconds: 60 }, mockOnGameEnd);

        // Clear the initial emit calls
        mockSocketP1.emit.mockClear();
        mockSocketP2.emit.mockClear();

        // Trigger a state update
        (gameManager as any).handlePlayerMove('player-1', { cardInstanceId: 'card-123', payload: {} });

        // Verify patches were sent
        const p1PatchCall = mockSocketP1.emit.mock.calls.find((call: any) => call[0] === 'game:patch');
        const p2PatchCall = mockSocketP2.emit.mock.calls.find((call: any) => call[0] === 'game:patch');

        expect(p1PatchCall).toBeDefined();
        expect(p2PatchCall).toBeDefined();

        // Verify patch is an array (JSON Patch format)
        if (p1PatchCall) {
            expect(Array.isArray(p1PatchCall[1])).toBe(true);
        }
    });

    it('should end the game with the bot as the loser if it cannot make a move', () => {
        const botPlayers = [
            { userId: 'player-1', username: 'P1', isBot: false, socketId: 'socket-1', joinedAt: Date.now() },
            { userId: 'bot-1', username: 'AI', isBot: true, socketId: 'bot-socket', joinedAt: Date.now() },
        ];

        // 1. A bot logikáját úgy mockoljuk, hogy jelezze: nem tud lépni.
        (decideMove as jest.Mock).mockReturnValue(null);

        // 2. A játékállapotot úgy állítjuk be, hogy a bot következzen.
        const stateWhereBotIsCurrentPlayer = {
            ...mockGameState,
            players: [
                { id: 'player-1', name: 'P1', hand: [], score: 0 },
                { id: 'bot-1', name: 'AI', hand: [], score: 0 }
            ],
            currentPlayerId: 'bot-1'
        };
        (performPlay as jest.Mock).mockReturnValue({ newState: stateWhereBotIsCurrentPlayer, success: true });

        const gameManager = new GameManager('test-game', botPlayers, mockIo, { turnTimeLimitSeconds: 60 }, mockOnGameEnd);

        // 3. Szimuláljuk az emberi játékos lépését, ami után a bot kerül sorra.
        (gameManager as any).handlePlayerMove('player-1', { cardInstanceId: 'p1-card' });

        // 4. Tekerjük előre az időt, hogy a bot "gondolkodási ideje" lefusson.
        jest.runAllTimers();

        // 5. Ellenőrzések
        // A bot döntéshozatali logikája lefutott?
        expect(decideMove).toHaveBeenCalledWith(stateWhereBotIsCurrentPlayer, 'bot-1');

        // A játék véget ért, mert a bot feladta? (A cleanup callback lefutott?)
        expect(mockOnGameEnd).toHaveBeenCalledWith('test-game');

        // A győztes az emberi játékos lett?
        expect(mockIo.emit).toHaveBeenCalledWith('game:end', expect.objectContaining({ winnerId: 'player-1' }));
    });
});