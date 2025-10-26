
// Felelőssége: A kapcsolatok kezelése és a kérések továbbítása a megfelelő menedzsernek.

import express from 'express';
import { createServer } from 'http';
import { Server, Socket } from 'socket.io';
import { loadCardDefinitions } from '../shared/game-engine';
import { PlayerId } from '../shared/interfaces';
import path from 'path';

import MatchmakingManager, { PlayerInLobby } from './match-making-manager';
import { GameManager } from './game-manager';
import { v4 as uuidv4 } from 'uuid';
// --- Konfiguráció ---
const PORT = process.env.PORT || 3000;

// --- A Szerver Fő Állapottárolói ---
// Ezek a globális tárolók fogják össze a teljes szerver állapotát.
const activeGames = new Map<string, GameManager>();
const playerToGameMap = new Map<PlayerId, string>();

interface CustomSocket extends Socket {
  data: {
    userId?: PlayerId;
    username?: string;
  };
}

const app = express();

// Serve static images
const imagesPath = path.join(__dirname, '..', 'public', 'images');
app.use('/images', express.static(imagesPath));

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*", methods: ["GET", "POST"] },
});

// A kártyadefiníciók betöltése a szerver indításakor
try {
  loadCardDefinitions();
  console.log("✅ Server starting... Card definitions loaded successfully.");
} catch (error) {
  console.error("❌ CRITICAL: Failed to load card definitions. Server cannot start.", error);
  process.exit(1); // Kilépünk, ha a kártyák nélkül nem tud elindulni
}

// MatchmakingManager inicializálása
const matchmakingManager = new MatchmakingManager(io, {
  maxPlayersPerMatch: 2,
  aiEnabled: true,
  aiDelayMs: 500,  // Reduced from 5000ms to 500ms for faster bot matching in tests
});

// --- A Rendszer Magja: Eseménykezelők ---

/**
 * Ezt az eseményt a MatchmakingManager bocsátja ki, amikor talált egy meccset.
 * Itt hozzuk létre az új GameManager példányt.
 */
matchmakingManager.on('match-found', ({ players }: { players: PlayerInLobby[] }) => {
  const gameId = uuidv4(); // Vagy a GameManager generálja
  const game = new GameManager(gameId, players, io, { turnTimeLimitSeconds: 600 }, (endedGameId) => {
    // Ez a callback lefut, amikor a játék véget ér.
    console.log(`[Server] Cleaning up game ${endedGameId}`);
    const gameToEnd = activeGames.get(endedGameId);
    if (gameToEnd) {
      gameToEnd.destroy();
      gameToEnd.getPlayers().forEach((player: any) => playerToGameMap.delete(player.userId));
      activeGames.delete(endedGameId);
    }
  });

  console.log(`[Server] Game created with ID: ${game.gameId}`);
  activeGames.set(game.gameId, game);
  players.forEach((player: any) => playerToGameMap.set(player.userId, game.gameId));
});

io.on('connection', (socket: CustomSocket) => {
  console.log(`[Server] User connected: ${socket.id}`);

  // Az authentikáció egyszerűsítve: a kliens küld egy user ID-t és nevet.
  // Éles rendszerben itt JWT token validálás történne.
  socket.on('auth:authenticate', ({ userId, username }) => {
    if (!userId || !username) {
      socket.emit('auth:error', { message: 'Hiányzó userId vagy username.' });
      return;
    }
    socket.data.userId = userId;
    socket.data.username = username;
    socket.emit('auth:success', { userId, username });
    console.log(`[Server] User ${username} (${userId}) identified for socket ${socket.id}.`);

    // Visszacsatlakozás kezelése
    const gameId = playerToGameMap.get(userId);
    const ongoingGame = gameId ? activeGames.get(gameId) : null;
    if (ongoingGame) {
      console.log(`[Server] Player ${username} rejoining game ${gameId}`);
      ongoingGame.handlePlayerReconnect(userId, socket);
    }
  });

  // A kérést egyszerűen továbbítjuk a matchmakingManager-nek.
  socket.on('matchmaking:join', () => {
    const { userId, username } = socket.data;
    if (!userId || !username) {
      socket.emit('error:auth', { message: 'Authentikáció szükséges.' });
      return;
    }
    // Ellenőrizzük, hogy nincs-e már játékban
    if (playerToGameMap.has(userId)) {
      socket.emit('matchmaking:error', { message: 'Már egy futó játékban vagy!' });
      return;
    }
    matchmakingManager.joinLobby(socket, userId, username);
  });

  socket.on('matchmaking:cancel', () => {
    if (socket.data.userId) {
      matchmakingManager.leaveLobby(socket.data.userId);
    }
  });

  // A disconnect esemény kezelése sokkal robusztusabb lett.
  socket.on('disconnect', () => {
    console.log(`[Server] User disconnected: ${socket.id}`);
    const { userId } = socket.data;
    if (!userId) return;

    // Megpróbáljuk kivenni a lobbyból
    matchmakingManager.leaveLobby(userId);

    // Ha játékban volt, értesítjük a megfelelő GameManager-t
    const gameId = playerToGameMap.get(userId);
    const ongoingGame = gameId ? activeGames.get(gameId) : null;
    if (ongoingGame) {
      ongoingGame.handlePlayerDisconnect(userId);
    }
  });
});

// A szerver indítása
httpServer.listen(PORT, () => {
  console.log(`✅ Server is running on port ${PORT}`);
});