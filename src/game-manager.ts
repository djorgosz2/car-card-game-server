import { Server, Socket } from 'socket.io';
import * as jsonpatch from 'fast-json-patch';
import { IGameState, PlayerId, MetricType } from '../shared/interfaces';
import { initializeGame, performPlay, getClientGameState, advanceTurn, endGameByTimeout, resolveRound, checkGameEndConditions } from '../shared/game-engine';
import { decideMove } from './ai-manager';
import { PlayerInLobby } from './match-making-manager';

export class GameManager {
    public readonly gameId: string;
    public readonly players: { userId: PlayerId; username: string; isBot: boolean }[];
    
    private io: Server;
    private gameState: IGameState;
    private onGameEnd: (gameId: string) => void;

    private lastPlayerStates = new Map<PlayerId, IGameState>();

    private playerSockets = new Map<PlayerId, Socket>();
    private botIds = new Set<PlayerId>();
    private turnTimer: NodeJS.Timeout | null = null;
    private turnTimeLimit: number;

// --- Konstruktor ------------------------------------------------

    constructor(
        gameId: string, 
        players: PlayerInLobby[], 
        io: Server, 
        config: { turnTimeLimitSeconds: number },
        onGameEnd: (gameId: string) => void
    ) {
        this.gameId = gameId;
        this.players = players.map(p => ({ userId: p.userId, username: p.username, isBot: p.isBot }));
        this.io = io;
        this.turnTimeLimit = config.turnTimeLimitSeconds * 1000;
        this.onGameEnd = onGameEnd;

        players.forEach(p => {
            if (p.isBot) {
                this.botIds.add(p.userId);
            } else {
                const socket = this.io.sockets.sockets.get(p.socketId);
                if (socket) {
                    this.playerSockets.set(p.userId, socket);
                    socket.join(this.gameId);
                }
            }
        });

        this.gameState = initializeGame(
            players.map(p => p.userId),
            players.map(p => p.username),
            Date.now(),
            this.turnTimeLimit,
            true
        );

        this.setupSocketListeners();
        this.startGame();
    }

// --- Publikus metódusok (a server.ts hívja őket) ------------------------------------------------

    public handlePlayerDisconnect(playerId: PlayerId) {
        console.log(`[GameManager:${this.gameId}] Player ${playerId} disconnected.`);
        this.playerSockets.delete(playerId);
        // Ha a játék még fut, a másik játékos nyer.
        if (this.gameState.gameStatus === 'playing') {
            const opponent = this.gameState.players.find(p => p.id !== playerId);
            if (opponent) {
                this.gameState.winnerId = opponent.id;
                this.gameState.gameStatus = 'win';
                this.endGame(`Player ${playerId} disconnected.`);
            }
        }
    }

    public handlePlayerReconnect(playerId: PlayerId, newSocket: Socket) {
        console.log(`[GameManager:${this.gameId}] Player ${playerId} reconnected.`);
        this.playerSockets.set(playerId, newSocket);
        newSocket.join(this.gameId);
        this.setupSocketListenersForSocket(newSocket, playerId);
        
        // Visszacsatlakozáskor a TELJES állapotot küldjük el, és frissítjük a tárolónkat.
        const clientState = getClientGameState(this.gameState, playerId);
        newSocket.emit('game:stateUpdate', clientState);
        this.lastPlayerStates.set(playerId, clientState);
    }

    public getPlayers() {
        return this.players;
    }

// --- Privát, belső működés ------------------------------------------------

    private setupSocketListeners() {
        this.playerSockets.forEach((socket, pid) => {
            this.setupSocketListenersForSocket(socket, pid);
        });
    }
    
    private setupSocketListenersForSocket(socket: Socket, playerId: PlayerId) {
        // A listener-eket "off"-oljuk először, hogy a reconnect ne duplikálja őket
        socket.removeAllListeners('game:playCard');
        socket.removeAllListeners('game:advanceTurn');

        socket.on('game:playCard', (data) => this.handlePlayerMove(playerId, data as { cardInstanceId: string; payload?: Record<string, unknown> }));
        socket.on('game:advanceTurn', () => this.handleAdvanceTurn());
    }

    private startGame() {
        this.io.to(this.gameId).emit('game:start', { gameId: this.gameId, players: this.players });
        
        // A játék indításakor mindenki megkapja a teljes kezdőállapotot.
        this.gameState.players.forEach(p => {
            if (!this.botIds.has(p.id)) {
                const socket = this.playerSockets.get(p.id);
                if (socket) {
                    const clientState = getClientGameState(this.gameState, p.id);
                    socket.emit('game:stateUpdate', clientState);
                    // Eltároljuk a legelső állapotot, amihez képest majd a patcheket generáljuk.
                    this.lastPlayerStates.set(p.id, clientState);
                }
            }
        });

        this.startTurnTimer();
    }

    private handlePlayerMove(playerId: PlayerId, data: { cardInstanceId: string; payload?: Record<string, unknown> }) {
        console.log(`[GameManager:${this.gameId}] handlePlayerMove from ${playerId} in phase=${this.gameState.currentPlayerPhase}`);
        if (this.gameState.currentPlayerId !== playerId || this.gameState.gameStatus !== 'playing') {
            return; 
        }

        // Block moves during comparison phase
        if (this.gameState.currentPlayerPhase === 'both_cards_on_board') {
            console.warn(`[GameManager:${this.gameId}] Move rejected during both_cards_on_board phase from ${playerId}`);
            this.playerSockets.get(playerId)?.emit('game:error', { message: 'Összehasonlítás folyamatban, várj a kör lezárására.' });
            return;
        }

        // No more try-catch here
        const result = performPlay(this.gameState, playerId, data.cardInstanceId, (data.payload || {}) as { selectedMetric?: MetricType; targetPlayerId?: string });
        
        if (result.success) {
            // SUCCESS: Update the game state
            this.updateState(result.newState);
        } else {
            // INVALID MOVE: Send error to the player only
            console.error(`[GameManager:${this.gameId}] Invalid move by ${playerId}: ${result.message}`);
            this.playerSockets.get(playerId)?.emit('game:error', { message: result.message });
            // Do NOT update the state or broadcast anything else
        }
    }
    
    private handleAdvanceTurn() {
        if (this.gameState.currentPlayerPhase === 'round_resolved' && this.gameState.gameStatus === 'playing') {
            const newState = advanceTurn(this.gameState, this.gameState.roundWinnerId);
            this.updateState(newState);
        }
    }
    
    private updateState(newState: IGameState) {
        this.gameState = newState;
        this.broadcastState();
        
        // Immediate game-end check after any state change
        const afterEndCheck = checkGameEndConditions(this.gameState);
        this.gameState = afterEndCheck;
        if (this.gameState.gameStatus !== 'playing') {
            // Ensure clients receive the final status/winner patch before ending
            this.broadcastState();
            this.endGame('Game finished normally.');
            return;
        }
        
        {
            // Handle special phases
            if (this.gameState.currentPlayerPhase === 'both_cards_on_board') {
                // No turn timer during comparison; schedule resolve
                this.clearTurnTimer();
                console.log(`[GameManager:${this.gameId}] Entered both_cards_on_board. Scheduling resolve in 1000ms...`);
                setTimeout(() => {
                    // Ensure we are still in the same phase and game not ended
                    if (this.gameState.gameStatus !== 'playing' || this.gameState.currentPlayerPhase !== 'both_cards_on_board') {
                        console.log(`[GameManager:${this.gameId}] Resolve skipped: phase changed to ${this.gameState.currentPlayerPhase} or game ended.`);
                        return;
                    }
                    console.log(`[GameManager:${this.gameId}] Resolving round now...`);
                    const resolved = resolveRound(this.gameState);
                    // After resolving, move to round_resolved unless we require a discard phase
                    if (resolved.currentPlayerPhase !== 'must_discard') {
                        resolved.currentPlayerPhase = 'round_resolved';
                    }
                    this.updateState(resolved);
                }, 1000);
                return; // Do not schedule bots or timers in this interim phase
            }

            if (this.gameState.currentPlayerPhase === 'round_resolved') {
                this.clearTurnTimer();
                console.log(`[GameManager:${this.gameId}] Round resolved, auto-advancing turn in 1500ms...`);
                setTimeout(() => this.handleAdvanceTurn(), 1500);
                return;
            }

            // Regular interactive phase: start timer and trigger bot if needed
            this.startTurnTimer();
            const shouldTriggerBot = this.botIds.has(this.gameState.currentPlayerId)
              && (this.gameState.currentPlayerPhase === 'waiting_for_initial_play' || this.gameState.currentPlayerPhase === 'waiting_for_car_card_after_action');
            if (shouldTriggerBot) {
                console.log(`[GameManager:${this.gameId}] Scheduling bot move in 1500ms for ${this.gameState.currentPlayerId}...`);
                setTimeout(() => this.triggerBotMove(), 1500);
            }
        }
    }
    private triggerBotMove() {
        if (!this.botIds.has(this.gameState.currentPlayerId) || this.gameState.gameStatus !== 'playing') return;

        if (this.gameState.currentPlayerPhase === 'both_cards_on_board') {
            console.log(`[GameManager:${this.gameId}] Bot move suppressed during both_cards_on_board phase.`);
            return;
        }

        const botId = this.gameState.currentPlayerId;
        
        const move = decideMove(this.gameState, botId);

        if (move) {
            // No more try-catch here
            const result = performPlay(this.gameState, botId, move.cardInstanceId, move.payload);
            
            if (result.success) {
                this.updateState(result.newState);
            } else {
                // This indicates a bug either in decideMove or performPlay validation logic
                // as the bot's move should ideally always be valid if one exists.
                console.error(`[GameManager:${this.gameId}] Bot ${botId} attempted an invalid move: ${result.message}. Forcing forfeit.`);
                // Force forfeit as the bot is stuck
                const opponent = this.gameState.players.find(p => p.id !== botId);
                if (opponent) {
                    this.gameState.winnerId = opponent.id;
                    this.gameState.gameStatus = 'win';
                    this.endGame(`Bot ${botId} failed to make a valid move.`);
                }
            }
        } else {
            // Bot has no moves, handle forfeit (logic remains the same)
            console.log(`[GameManager:${this.gameId}] Bot ${botId} has no valid moves and forfeits.`);
            const opponent = this.gameState.players.find(p => p.id !== botId);
            if (opponent) {
                this.gameState.winnerId = opponent.id;
                this.gameState.gameStatus = 'win';
                this.endGame(`Bot ${botId} could not make a move.`);
            }
        }
    }
    private broadcastState() {
        this.gameState.players.forEach(p => {
            if (this.botIds.has(p.id)) return; // Botoknak nem küldünk socket üzenetet

            const socket = this.playerSockets.get(p.id);
            const lastState = this.lastPlayerStates.get(p.id);

            if (socket && lastState) {
                const newStateForPlayer = getClientGameState(this.gameState, p.id);
                const patch = jsonpatch.compare(lastState, newStateForPlayer);

                if (patch.length > 0) {
                    socket.emit('game:patch', patch);
                    this.lastPlayerStates.set(p.id, newStateForPlayer);
                }
            }
        });
    }
    
    private startTurnTimer() {
        this.clearTurnTimer();
        this.turnTimer = setTimeout(() => {
            this.handleTimeout();
        }, this.turnTimeLimit);
    }

    private clearTurnTimer() {
        if (this.turnTimer) {
            clearTimeout(this.turnTimer);
            this.turnTimer = null;
        }
    }
    
    private handleTimeout() {
        if (this.gameState.gameStatus !== 'playing') return;

        console.log(`[GameManager:${this.gameId}] Player ${this.gameState.currentPlayerId} timed out.`);
        const newState = endGameByTimeout(this.gameState, this.gameState.currentPlayerId);
        this.updateState(newState); // Az updateState kezeli az endGame-et és a broadcast-ot
    }

    private endGame(reason: string) {
        this.clearTurnTimer();
        console.log(`[GameManager:${this.gameId}] Game has ended. Reason: ${reason}. Winner: ${this.gameState.winnerId}`);
        this.io.to(this.gameId).emit('game:end', { 
            winnerId: this.gameState.winnerId,
            gameStatus: this.gameState.gameStatus,
        });
        
        // Szólunk a fő szervernek, hogy végzett, és törölhető.
        this.onGameEnd(this.gameId);
    }
    public destroy() {
        this.clearTurnTimer();
        this.playerSockets.forEach((socket) => {
            socket.removeAllListeners('game:playCard');
            socket.removeAllListeners('game:advanceTurn');
            socket.leave(this.gameId);
        });
        console.log(`[GameManager:${this.gameId}] Cleaned up and destroyed.`);
    }
}