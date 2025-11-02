// ======================================================================
// server/matchmakingManager.ts
// Server-side Matchmaking Manager - Refaktorált verzió
// Felelőssége: A lobby kezelése és meccsek összeállítása.
// ======================================================================

import { Server, Socket } from 'socket.io';
import { EventEmitter } from 'events';
import { PlayerId } from '../shared/interfaces';

/**
 * A lobbyban várakozó játékosokat leíró interfész.
 */
export interface PlayerInLobby {
  userId: PlayerId;
  username: string;
  email?: string;
  socketId: string;
  joinedAt: number;
  isBot: boolean;
  humanOnly?: boolean;
}

/**
 * A matchmaking működését szabályozó konfigurációs opciók.
 */
export interface MatchmakingConfig {
  maxPlayersPerMatch: number;
  aiEnabled: boolean;
  aiDelayMs: number;
  /**
   * Max time (ms) to honor "human-only" preference before allowing AI fallback.
   * Prevents a single client from indefinitely blocking matches by requesting human-only.
   */
  humanOnlyMaxWaitMs: number;
}

/**
 * Kezeli a játékosok várakozását, a botok hozzáadását és a meccsek összeállítását.
 * Ha egy meccs összeáll, egy 'match-found' eseményt bocsát ki a játékosok listájával.
 */
class MatchmakingManager extends EventEmitter {
  private io: Server;
  private config: MatchmakingConfig;

  // Állapotok: már csak a lobbyhoz kapcsolódó adatok.
  private playersInLobby = new Map<PlayerId, PlayerInLobby>();
  private aiSpawnTimer: ReturnType<typeof setTimeout> | null = null;
  private botCounter = 0;
  private pendingRequests: Map<PlayerId, Set<PlayerId>> = new Map(); // toUserId -> Set<fromUserId>

  constructor(io: Server, config: MatchmakingConfig) {
    super();
    this.io = io;
    this.config = config;
    this.log('MatchmakingManager initialized');
  }

  private log(message: string, data?: unknown) {
    console.log(`[MatchmakingManager] ${message}`, data ? JSON.stringify(data, null, 2) : '');
  }

  /**
   * Egy játékos csatlakozik a várólistához.
   */
  public joinLobby(socket: Socket, userId: PlayerId, username: string, options?: { humanOnly?: boolean; email?: string }) {
    // A validációk (pl. már játékban van-e) a fő szerver fájl felelőssége lesz.
    if (this.playersInLobby.has(userId)) {
      socket.emit('matchmaking:error', { message: 'Már a lobbyban vagy!' });
      return;
    }

    const playerData: PlayerInLobby = {
      userId,
      username,
      email: options?.email,
      socketId: socket.id,
      joinedAt: Date.now(),
      isBot: false,
      humanOnly: !!options?.humanOnly,
    };

    this.playersInLobby.set(userId, playerData);
    this.log(`Player ${username} joined lobby. Total players: ${this.playersInLobby.size}`);

    socket.emit('matchmaking:joined', { message: 'Sikeresen csatlakoztál a lobbyba!' });
    this.emitLobbyUpdateToAll();
    this.checkForMatch();
  }

  /**
   * Egy játékos elhagyja a várólistát.
   */
  public leaveLobby(userId: PlayerId) {
    if (!this.playersInLobby.has(userId)) return;

    const player = this.playersInLobby.get(userId);
    this.playersInLobby.delete(userId);
    this.log(`Player ${player?.username} left lobby. Total players: ${this.playersInLobby.size}`);
    
    // Ha kiürült a lobby, leállítjuk az AI időzítőt.
    if (this.playersInLobby.size === 0 && this.aiSpawnTimer) {
        clearTimeout(this.aiSpawnTimer);
        this.aiSpawnTimer = null;
    }
    // Töröljük a függő kéréseket is
    this.pendingRequests.delete(userId);
    for (const [, fromSet] of this.pendingRequests) {
      if (fromSet.has(userId)) {
        fromSet.delete(userId);
      }
    }
    this.emitLobbyUpdateToAll();
  }
  
  /**
   * Elindítja az időzítőt, ami egy botot ad a lobbyhoz, ha nincs elég játékos.
   */
  private scheduleAISpawn() {
    if (!this.config.aiEnabled || this.aiSpawnTimer) return;
    
    const humans = Array.from(this.playersInLobby.values()).filter(p => !p.isBot);
    const humanPlayerCount = humans.length;
    const now = Date.now();

    // Respect human-only preference up to a maximum wait time (server-enforced)
    const humanOnlyPlayers = humans.filter(p => p.humanOnly);
    if (humanOnlyPlayers.length > 0) {
      const earliestJoin = Math.min(...humanOnlyPlayers.map(p => p.joinedAt));
      const waitedMs = Math.max(0, now - earliestJoin);
      if (waitedMs < this.config.humanOnlyMaxWaitMs) {
        // Within grace period: do not spawn AI
        return;
      }
      // Grace expired: allow AI fallback
    }

    if (humanPlayerCount > 0 && this.playersInLobby.size < this.config.maxPlayersPerMatch) {
      this.log(`Scheduling AI spawn in ${this.config.aiDelayMs}ms`);
      this.aiSpawnTimer = setTimeout(() => this.spawnAIBot(), this.config.aiDelayMs);
    }
  }
  
  /**
   * Létrehoz egy bot játékost és hozzáadja a lobbyhoz.
   */
  private spawnAIBot() {
    this.aiSpawnTimer = null;
    if (this.playersInLobby.size === 0 || this.playersInLobby.size >= this.config.maxPlayersPerMatch) return;

    const botId = `bot-${++this.botCounter}`;
    const botData: PlayerInLobby = {
      userId: botId,
      username: `AI Bot ${this.botCounter}`,
      socketId: 'bot-socket', // Nincs valós socketje
      joinedAt: Date.now(),
      isBot: true
    };

    this.playersInLobby.set(botId, botData);
    this.log(`AI Bot spawned: ${botData.username}`);
    
    this.emitLobbyUpdateToAll();
    this.checkForMatch();
  }

  /**
   * Ellenőrzi, hogy van-e elég játékos egy meccs indításához.
   * Ha igen, eltávolítja őket a lobbyból és kibocsát egy 'match-found' eseményt.
   */
  private checkForMatch() {
    if (this.playersInLobby.size < this.config.maxPlayersPerMatch) {
      this.scheduleAISpawn(); // Ha még nincs meccs, újrapróbáljuk időzíteni a botot.
      return;
    }

    // Leállítjuk az AI időzítőt, mert találtunk meccset.
    if (this.aiSpawnTimer) {
        clearTimeout(this.aiSpawnTimer);
        this.aiSpawnTimer = null;
    }

    // Preferáljuk a két emberi játékost, ha elérhető
    const lobbyArr = Array.from(this.playersInLobby.values());
    const humans = lobbyArr.filter(p => !p.isBot).sort((a, b) => a.joinedAt - b.joinedAt);
    const bots = lobbyArr.filter(p => p.isBot).sort((a, b) => a.joinedAt - b.joinedAt);
    let playersForMatch: PlayerInLobby[] = [];
    if (humans.length >= this.config.maxPlayersPerMatch) {
      playersForMatch = humans.slice(0, this.config.maxPlayersPerMatch);
    } else {
      playersForMatch = humans.concat(bots).slice(0, this.config.maxPlayersPerMatch);
    }
    playersForMatch.forEach(player => this.playersInLobby.delete(player.userId));
    
    this.log('Match found! Emitting event for players:', playersForMatch.map(p => p.username));

    // A kulcsfontosságú változás: eseményt bocsátunk ki ahelyett, hogy magunk kezelnénk a játékot.
    this.emit('match-found', { players: playersForMatch });

    this.emitLobbyUpdateToAll();

    // Ha maradtak még játékosok a lobbyban, újra ellenőrizzük, hátha újabb meccs is indítható.
    if (this.playersInLobby.size >= this.config.maxPlayersPerMatch) {
      this.checkForMatch();
    }
  }
  
  /**
   * Kiküldi a lobby aktuális állapotát minden kliensnek, személyre szabott relációs flag-ekkel.
   */
  private emitLobbyUpdateToAll() {
    const lobbyData = Array.from(this.playersInLobby.values());
    for (const viewer of lobbyData) {
      const socket = this.io.sockets.sockets.get(viewer.socketId);
      if (!socket) continue;
      const players = lobbyData.map(p => {
        const relation = this.getRelation(viewer.userId, p.userId);
        return {
          id: p.userId,
          username: p.username,
          email: p.email,
          isBot: p.isBot,
          canJoin: relation === 'incoming',
          canRequest: relation === 'none',
        };
      });
      socket.emit('lobby:update', {
        players,
      playerCount: lobbyData.length,
    });
    }
  }

  private getRelation(viewerId: PlayerId, otherId: PlayerId): 'self' | 'incoming' | 'outgoing' | 'none' {
    if (viewerId === otherId) return 'self';
    const incomingFromOther = this.pendingRequests.get(viewerId)?.has(otherId) || false; // other -> me
    if (incomingFromOther) return 'incoming';
    const myOutgoingToOther = this.pendingRequests.get(otherId)?.has(viewerId) || false; // me -> other stored under otherId
    if (myOutgoingToOther) return 'outgoing';
    return 'none';
  }

  /** Request/Accept matchmaking between two human players */
  public requestMatch(fromUserId: PlayerId, toUserId: PlayerId) {
    if (!this.playersInLobby.has(fromUserId) || !this.playersInLobby.has(toUserId)) {
      return;
    }
    if (fromUserId === toUserId) return;
    let fromSet = this.pendingRequests.get(toUserId);
    if (!fromSet) {
      fromSet = new Set<PlayerId>();
      this.pendingRequests.set(toUserId, fromSet);
    }
    fromSet.add(fromUserId);
    this.emitLobbyUpdateToAll();
  }

  public acceptMatch(targetUserId: PlayerId, fromUserId: PlayerId) {
    const fromSet = this.pendingRequests.get(targetUserId);
    if (!fromSet || !fromSet.has(fromUserId)) return;
    // Clear the pending request
    fromSet.delete(fromUserId);
    if (fromSet.size === 0) this.pendingRequests.delete(targetUserId);

    const a = this.playersInLobby.get(targetUserId);
    const b = this.playersInLobby.get(fromUserId);
    if (!a || !b) {
      this.emitLobbyUpdateToAll();
      return;
    }
    // Start direct match between a and b
    const playersForMatch = [a, b];
    playersForMatch.forEach(player => this.playersInLobby.delete(player.userId));
    if (this.aiSpawnTimer) { clearTimeout(this.aiSpawnTimer); this.aiSpawnTimer = null; }
    this.log('Direct match accepted! Emitting event for players:', playersForMatch.map(p => p.username));
    this.emit('match-found', { players: playersForMatch });
    this.emitLobbyUpdateToAll();
  }
}

export default MatchmakingManager;