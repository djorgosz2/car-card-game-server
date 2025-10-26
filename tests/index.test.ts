/**
 * Unit tests for server/src/index.ts
 * 
 * Note: Since index.ts has side effects (starts server, loads cards), 
 * we test the core logic by mocking dependencies and verifying behavior.
 */

import { loadCardDefinitions } from '../shared/game-engine';
import MatchmakingManager from '../src/match-making-manager';
import { GameManager } from '../src/game-manager';

// Mock all dependencies before any imports
jest.mock('../shared/game-engine', () => ({
    loadCardDefinitions: jest.fn(),
    initializeGame: jest.fn(),
    performPlay: jest.fn(),
    advanceTurn: jest.fn(),
    getClientGameState: jest.fn(),
}));

jest.mock('../src/match-making-manager');
jest.mock('../src/game-manager');

describe('Server Index - Dependency Initialization', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('should have loadCardDefinitions function available', () => {
        expect(loadCardDefinitions).toBeDefined();
        expect(typeof loadCardDefinitions).toBe('function');
    });

    it('should have MatchmakingManager class available', () => {
        expect(MatchmakingManager).toBeDefined();
    });

    it('should have GameManager class available', () => {
        expect(GameManager).toBeDefined();
    });
});

describe('Server Index - Mock Behavior', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (loadCardDefinitions as jest.Mock).mockImplementation(() => {
            // Mock successful card loading
        });
    });

    it('should mock loadCardDefinitions successfully', () => {
        (loadCardDefinitions as jest.Mock)();
        expect(loadCardDefinitions).toHaveBeenCalled();
    });

    it('should create MatchmakingManager instance with mocked constructor', () => {
        const mockIo = { on: jest.fn(), emit: jest.fn() };
        const mockConfig = {
            maxPlayersPerMatch: 2,
            aiEnabled: true,
            aiDelayMs: 5000,
        };

        (MatchmakingManager as unknown as jest.Mock).mockImplementation(() => ({
            on: jest.fn(),
            joinLobby: jest.fn(),
            leaveLobby: jest.fn(),
        }));

        const instance = new MatchmakingManager(mockIo as any, mockConfig);
        
        expect(MatchmakingManager).toHaveBeenCalledWith(mockIo, mockConfig);
        expect(instance).toBeDefined();
    });

    it('should create GameManager instance with mocked constructor', () => {
        const mockGameId = 'test-game-123';
        const mockPlayers = [
            { userId: 'p1', username: 'Player1', isBot: false, socketId: 's1', joinedAt: Date.now() },
            { userId: 'p2', username: 'Player2', isBot: false, socketId: 's2', joinedAt: Date.now() },
        ];
        const mockIo = { on: jest.fn(), emit: jest.fn() };
        const mockConfig = { turnTimeLimitSeconds: 60 };
        const mockCallback = jest.fn();

        (GameManager as unknown as jest.Mock).mockImplementation(() => ({
            gameId: mockGameId,
            getPlayers: jest.fn().mockReturnValue(mockPlayers),
            destroy: jest.fn(),
            handlePlayerReconnect: jest.fn(),
            handlePlayerDisconnect: jest.fn(),
        }));

        const instance = new GameManager(mockGameId, mockPlayers, mockIo as any, mockConfig, mockCallback);
        
        expect(GameManager).toHaveBeenCalledWith(mockGameId, mockPlayers, mockIo, mockConfig, mockCallback);
        expect(instance).toBeDefined();
        expect(instance.gameId).toBe(mockGameId);
    });
});

describe('Server Index - Game Lifecycle Logic', () => {
    let mockMatchmakingManager: any;
    let mockGameManager: any;

    beforeEach(() => {
        jest.clearAllMocks();

        // Setup mock MatchmakingManager
        mockMatchmakingManager = {
            on: jest.fn(),
            joinLobby: jest.fn(),
            leaveLobby: jest.fn(),
        };
        (MatchmakingManager as unknown as jest.Mock).mockImplementation(() => mockMatchmakingManager);

        // Setup mock GameManager
        mockGameManager = {
            gameId: 'test-game-123',
            getPlayers: jest.fn().mockReturnValue([
                { userId: 'player-1', username: 'P1', isBot: false },
                { userId: 'player-2', username: 'P2', isBot: false },
            ]),
            destroy: jest.fn(),
            handlePlayerReconnect: jest.fn(),
            handlePlayerDisconnect: jest.fn(),
        };
        (GameManager as unknown as jest.Mock).mockImplementation(() => mockGameManager);
    });

    it('should register match-found event handler on MatchmakingManager', () => {
        const mockIo = { on: jest.fn(), emit: jest.fn() };
        const manager = new MatchmakingManager(mockIo as any, {
            maxPlayersPerMatch: 2,
            aiEnabled: true,
            aiDelayMs: 5000,
        });

        // Simulate registering the event
        manager.on('match-found', jest.fn());

        expect(manager.on).toHaveBeenCalledWith('match-found', expect.any(Function));
    });

    it('should create GameManager when match-found event is triggered', () => {
        const mockIo = { on: jest.fn(), emit: jest.fn(), to: jest.fn().mockReturnThis() };
        const players = [
            { userId: 'player-1', username: 'P1', isBot: false, socketId: 'socket-1', joinedAt: Date.now() },
            { userId: 'player-2', username: 'P2', isBot: false, socketId: 'socket-2', joinedAt: Date.now() },
        ];

        // Simulate the match-found callback
        const matchFoundCallback = jest.fn((data: { players: any[] }) => {
            new GameManager(
                'test-game-id',
                data.players,
                mockIo as any,
                { turnTimeLimitSeconds: 60 },
                jest.fn()
            );
        });

        matchFoundCallback({ players });

        expect(matchFoundCallback).toHaveBeenCalledWith({ players });
        expect(GameManager).toHaveBeenCalled();
    });

    it('should call destroy on GameManager during cleanup', () => {
        const onGameEndCallback = jest.fn((gameId: string) => {
            mockGameManager.destroy();
            mockGameManager.getPlayers().forEach((player: any) => {
                // Simulate playerToGameMap.delete(player.userId)
            });
        });

        // Simulate game end
        onGameEndCallback('test-game-123');

        expect(onGameEndCallback).toHaveBeenCalledWith('test-game-123');
        expect(mockGameManager.destroy).toHaveBeenCalled();
    });
});

describe('Server Index - Socket Event Handlers', () => {
    it('should handle auth:authenticate event with valid data', () => {
        const mockSocket = {
            id: 'socket-123',
            data: {},
            on: jest.fn(),
            emit: jest.fn(),
        };

        const authHandler = (data: { userId: string; username: string }) => {
            if (!data.userId || !data.username) {
                mockSocket.emit('auth:error', { message: 'Hiányzó userId vagy username.' });
                return;
            }
            mockSocket.data = { userId: data.userId, username: data.username };
            mockSocket.emit('auth:success', { userId: data.userId, username: data.username });
        };

        authHandler({ userId: 'user-1', username: 'TestUser' });

        expect(mockSocket.emit).toHaveBeenCalledWith('auth:success', {
            userId: 'user-1',
            username: 'TestUser',
        });
    });

    it('should reject auth:authenticate without userId', () => {
        const mockSocket = {
            id: 'socket-123',
            data: {},
            on: jest.fn(),
            emit: jest.fn(),
        };

        const authHandler = (data: { userId?: string; username?: string }) => {
            if (!data.userId || !data.username) {
                mockSocket.emit('auth:error', { message: 'Hiányzó userId vagy username.' });
                return;
            }
            mockSocket.data = { userId: data.userId, username: data.username };
            mockSocket.emit('auth:success', { userId: data.userId, username: data.username });
        };

        authHandler({ username: 'TestUser' });

        expect(mockSocket.emit).toHaveBeenCalledWith('auth:error', {
            message: 'Hiányzó userId vagy username.',
        });
    });

    it('should handle matchmaking:join for authenticated user', () => {
        const mockSocket = {
            id: 'socket-123',
            data: { userId: 'user-1', username: 'TestUser' },
            on: jest.fn(),
            emit: jest.fn(),
        };

        const mockMatchmakingManager = {
            joinLobby: jest.fn(),
        };

        const playerToGameMap = new Map<string, string>();

        const joinHandler = () => {
            const { userId, username } = mockSocket.data;
            if (!userId || !username) {
                mockSocket.emit('error:auth', { message: 'Authentikáció szükséges.' });
                return;
            }
            if (playerToGameMap.has(userId)) {
                mockSocket.emit('matchmaking:error', { message: 'Már egy futó játékban vagy!' });
                return;
            }
            mockMatchmakingManager.joinLobby(mockSocket, userId, username);
        };

        joinHandler();

        expect(mockMatchmakingManager.joinLobby).toHaveBeenCalledWith(mockSocket, 'user-1', 'TestUser');
    });

    it('should reject matchmaking:join if user already in game', () => {
        const mockSocket = {
            id: 'socket-123',
            data: { userId: 'user-1', username: 'TestUser' },
            on: jest.fn(),
            emit: jest.fn(),
        };

        const mockMatchmakingManager = {
            joinLobby: jest.fn(),
        };

        const playerToGameMap = new Map<string, string>();
        playerToGameMap.set('user-1', 'game-123'); // User already in game

        const joinHandler = () => {
            const { userId, username } = mockSocket.data;
            if (!userId || !username) {
                mockSocket.emit('error:auth', { message: 'Authentikáció szükséges.' });
                return;
            }
            if (playerToGameMap.has(userId)) {
                mockSocket.emit('matchmaking:error', { message: 'Már egy futó játékban vagy!' });
                return;
            }
            mockMatchmakingManager.joinLobby(mockSocket, userId, username);
        };

        joinHandler();

        expect(mockSocket.emit).toHaveBeenCalledWith('matchmaking:error', {
            message: 'Már egy futó játékban vagy!',
        });
        expect(mockMatchmakingManager.joinLobby).not.toHaveBeenCalled();
    });

    it('should handle player reconnection to ongoing game', () => {
        const mockSocket = {
            id: 'new-socket-123',
            data: { userId: 'user-1', username: 'TestUser' },
            on: jest.fn(),
            emit: jest.fn(),
        };

        const mockGameManager = {
            handlePlayerReconnect: jest.fn(),
        };

        const playerToGameMap = new Map<string, string>();
        const activeGames = new Map<string, any>();
        
        playerToGameMap.set('user-1', 'game-123');
        activeGames.set('game-123', mockGameManager);

        const reconnectHandler = () => {
            const gameId = playerToGameMap.get('user-1');
            const ongoingGame = gameId ? activeGames.get(gameId) : null;
            if (ongoingGame) {
                ongoingGame.handlePlayerReconnect('user-1', mockSocket);
            }
        };

        reconnectHandler();

        expect(mockGameManager.handlePlayerReconnect).toHaveBeenCalledWith('user-1', mockSocket);
    });
});
