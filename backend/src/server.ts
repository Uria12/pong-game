// FIXED: Complete server.ts with proper synchronization
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { GameManager } from './gameManager';
import {
  ServerToClientEvents,
  ClientToServerEvents,
  GameRoom
} from './types/gameTypes';

const app = express();
const server = createServer(app);

const io = new Server<ClientToServerEvents, ServerToClientEvents>(server, {
  cors: {
    origin: "http://localhost:3000",
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ['websocket', 'polling'],
  pingTimeout: 60000,
  pingInterval: 25000,
  connectTimeout: 45000,
  allowEIO3: true,
  maxHttpBufferSize: 1e6,
  httpCompression: false
});

// Initialize game manager
const gameManager = new GameManager();

const GAME_LOOP_INTERVAL = 1000 / 60;

// Rate limiting
const connectionAttempts = new Map<string, { count: number; firstAttempt: number }>();
const CONNECTION_ATTEMPT_LIMIT = 15;
const CONNECTION_ATTEMPT_WINDOW = 60000;
const RESET_WINDOW = 10000;

function startGameLoop(roomId: string) {
  const room = gameManager.getRoom(roomId);
  if (!room) return;

  if (room.gameLoopIntervalId) {
    clearInterval(room.gameLoopIntervalId);
  }

  room.gameLoopIntervalId = setInterval(() => {
    const currentRoom = gameManager.getRoom(roomId);

    if (!currentRoom || !currentRoom.gameState.gameActive) {
      if (room.gameLoopIntervalId) {
        clearInterval(room.gameLoopIntervalId);
        delete room.gameLoopIntervalId;
      }

      if (currentRoom && currentRoom.gameState.winner) {
        console.log(`Game ${roomId} ended. Winner: ${currentRoom.gameState.winner}`);
        io.to(roomId).emit('gameEnd', { winner: currentRoom.gameState.winner });
      }
      return;
    }

    const scored = gameManager.updateBall(roomId);
    io.to(roomId).emit('gameState', currentRoom.gameState);

    if (currentRoom.gameState.winner) {
      if (room.gameLoopIntervalId) {
        clearInterval(room.gameLoopIntervalId);
        delete room.gameLoopIntervalId;
      }
      console.log(`Game ${roomId} finished. Winner: ${currentRoom.gameState.winner}`);
      io.to(roomId).emit('gameEnd', { winner: currentRoom.gameState.winner });
    }
  }, GAME_LOOP_INTERVAL);
  console.log(`Game loop started for room ${roomId}`);
}

function checkConnectionRate(ip: string): boolean {
  const now = Date.now();
  const record = connectionAttempts.get(ip);
  
  if (!record) {
    connectionAttempts.set(ip, { count: 1, firstAttempt: now });
    return true;
  }
  
  if (now - record.firstAttempt > CONNECTION_ATTEMPT_WINDOW) {
    connectionAttempts.set(ip, { count: 1, firstAttempt: now });
    return true;
  }
  
  if (record.count >= CONNECTION_ATTEMPT_LIMIT) {
    console.log(`Rate limit exceeded for IP: ${ip} (${record.count} attempts)`);
    return false;
  }
  
  record.count++;
  connectionAttempts.set(ip, record);
  return true;
}

// Clean up old connection records
setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of connectionAttempts.entries()) {
    if (now - record.firstAttempt > CONNECTION_ATTEMPT_WINDOW + RESET_WINDOW) {
      connectionAttempts.delete(ip);
    }
  }
}, CONNECTION_ATTEMPT_WINDOW);

io.on('connection', (socket) => {
  const clientIP = socket.handshake.address;
  
  // Rate limiting check
  if (!checkConnectionRate(clientIP)) {
    console.log(`Rate limit exceeded for IP: ${clientIP}`);
    socket.emit('connected', { 
      message: 'Too many connection attempts. Please wait 60 seconds before trying again.', 
      playerId: socket.id 
    });
    setTimeout(() => {
      socket.disconnect(true);
    }, 1000);
    return;
  }

  console.log(`Player connected: ${socket.id.slice(-8)} from ${clientIP}`);
  socket.emit('connected', { message: 'Welcome to Pong! Click Join Game to start.', playerId: socket.id });

  const connectionTimeout = setTimeout(() => {
    if (socket.connected) {
      console.log(`Connection timeout for ${socket.id.slice(-8)}, disconnecting`);
      socket.disconnect(true);
    }
  }, 15000);

  // 🔥 CRITICAL FIX: Completely rewritten joinGame handler
  socket.on('joinGame', () => {
    clearTimeout(connectionTimeout);
    console.log(`[JOIN] Player ${socket.id.slice(-8)} requesting to join game`);

    try {
      const result = gameManager.addPlayer(socket.id);

      if (result) {
        const { roomId, side, isNewGame, waitingPlayerId } = result;
        const room = gameManager.getRoom(roomId);

        if (!room) {
          console.error(`[ERROR] Room ${roomId} not found after adding player ${socket.id.slice(-8)}`);
          socket.emit('connected', {
            message: 'Error: Game room not found. Please try again.',
            playerId: socket.id
          });
          return;
        }

        console.log(`[JOIN] Player ${socket.id.slice(-8)} joined room ${roomId} as ${side} player`);

        // 🔥 CRITICAL: Add BOTH players to the Socket.IO room
        const currentSocket = io.sockets.sockets.get(socket.id);
        if (currentSocket) {
          currentSocket.join(roomId);
        }

        // If this was a match (not just waiting), add the waiting player to the room too
        if (waitingPlayerId && waitingPlayerId !== socket.id) {
          const waitingSocket = io.sockets.sockets.get(waitingPlayerId);
          if (waitingSocket) {
            waitingSocket.join(roomId);
            console.log(`[JOIN] Waiting player ${waitingPlayerId.slice(-8)} also joined room ${roomId}`);
          } else {
            console.error(`[ERROR] Waiting player socket ${waitingPlayerId.slice(-8)} not found`);
          }
        }

        // Get player info
        const leftPlayer = room.gameState.players.left;
        const rightPlayer = room.gameState.players.right;
        const bothPlayersConnected = leftPlayer?.connected && rightPlayer?.connected;

        console.log(`[JOIN] Room ${roomId} status:`, {
          leftPlayer: leftPlayer ? `${leftPlayer.id.slice(-8)} (${leftPlayer.connected ? 'connected' : 'disconnected'})` : 'none',
          rightPlayer: rightPlayer ? `${rightPlayer.id.slice(-8)} (${rightPlayer.connected ? 'connected' : 'disconnected'})` : 'none',
          bothConnected: bothPlayersConnected
        });

        if (bothPlayersConnected) {
          // 🔥 CRITICAL: Send role assignments to BOTH players individually
          console.log(`[ASSIGN] Sending role assignments to both players in room ${roomId}`);
          
          io.to(leftPlayer.id).emit('playerJoined', { 
            side: 'left', 
            playerId: leftPlayer.id 
          });
          
          io.to(rightPlayer.id).emit('playerJoined', { 
            side: 'right', 
            playerId: rightPlayer.id 
          });

          // 🔥 CRITICAL: Send synchronized game state to ALL players in room
          console.log(`[STATE] Broadcasting initial game state to room ${roomId}`);
          io.to(roomId).emit('gameState', room.gameState);

          // Start game sequence
          console.log(`[START] Both players connected in room ${roomId}, starting game in 2 seconds`);
          
          setTimeout(() => {
            const currentRoom = gameManager.getRoom(roomId);
            if (currentRoom && gameManager.bothPlayersConnected(roomId)) {
              if (gameManager.startGame(roomId)) {
                const updatedRoom = gameManager.getRoom(roomId);
                if (updatedRoom) {
                  console.log(`[START] Game started in room ${roomId}`);
                  
                  // Send game start event to all players
                  io.to(roomId).emit('gameStart');
                  
                  // Send final game state with gameActive: true
                  io.to(roomId).emit('gameState', updatedRoom.gameState);
                  
                  // Start the game loop
                  startGameLoop(roomId);
                  
                  console.log(`[START] Game loop started for room ${roomId}`);
                } else {
                  console.error(`[ERROR] Room ${roomId} disappeared after starting game`);
                }
              } else {
                console.error(`[ERROR] Failed to start game in room ${roomId}`);
              }
            } else {
              console.log(`[START] Cannot start game in room ${roomId} - players disconnected`);
            }
          }, 2000);

        } else {
          // Only one player - send individual status
          console.log(`[WAIT] Only one player in room ${roomId}, waiting for opponent`);
          
          socket.emit('playerJoined', { side, playerId: socket.id });
          socket.emit('gameState', room.gameState);
          socket.emit('connected', {
            message: `You are the ${side} player. Waiting for opponent...`,
            playerId: socket.id
          });
        }
      } else {
        // Player added to waiting list
        console.log(`[WAIT] Player ${socket.id.slice(-8)} added to waiting list`);
        socket.emit('connected', {
          message: 'Waiting for another player to join...',
          playerId: socket.id
        });
      }
    } catch (error) {
      console.error(`[ERROR] Error in joinGame for ${socket.id.slice(-8)}:`, error);
      socket.emit('connected', {
        message: 'Error joining game. Please try again.',
        playerId: socket.id
      });
    }
  });

  socket.on('paddleMove', (data) => {
    try {
      const roomId = gameManager.movePaddle(socket.id, data.direction);
      if (roomId) {
        const room = gameManager.getRoom(roomId);
        if (room) {
          // Send game state updates for paddle movements
          io.to(roomId).emit('gameState', room.gameState);
        }
      }
    } catch (error) {
      console.error(`Error in paddleMove for ${socket.id.slice(-8)}:`, error);
    }
  });

  socket.on('disconnect', (reason) => {
    clearTimeout(connectionTimeout);
    console.log(`Player disconnected: ${socket.id.slice(-8)} (reason: ${reason})`);

    try {
      const removalResult = gameManager.removePlayer(socket.id);
      if (removalResult) {
        const { roomId, disconnectedSide } = removalResult;
        const room = gameManager.getRoom(roomId);

        console.log(`Player ${socket.id.slice(-8)} (${disconnectedSide}) disconnected from room ${roomId}`);
        
        // Notify remaining players
        socket.to(roomId).emit('playerDisconnected', { side: disconnectedSide });
        
        if (room) {
          // Send final game state
          io.to(roomId).emit('gameState', room.gameState);
          
          // End the game
          io.to(roomId).emit('gameEnd', {
            winner: room.gameState.winner,
            message: `Opponent disconnected. You win by forfeit!`
          });
        } else {
          console.log(`Room ${roomId} was deleted due to player ${socket.id.slice(-8)} disconnection.`);
        }
      }
    } catch (error) {
      console.error(`Error handling disconnect for ${socket.id.slice(-8)}:`, error);
    }
  });

  socket.on('error', (error) => {
    console.error(`Socket error for ${socket.id.slice(-8)}:`, error);
    clearTimeout(connectionTimeout);
  });

  socket.on('disconnecting', () => {
    clearTimeout(connectionTimeout);
  });
});

// Enhanced debug endpoints
app.get('/debug/rooms', (req, res) => {
  const rooms = gameManager.getAllRooms();
  const debugInfo = rooms.map(room => ({
    roomId: room.id,
    gameActive: room.gameState.gameActive,
    winner: room.gameState.winner,
    players: {
      left: room.gameState.players.left ? {
        id: room.gameState.players.left.id.slice(-8),
        connected: room.gameState.players.left.connected,
        score: room.gameState.players.left.score
      } : null,
      right: room.gameState.players.right ? {
        id: room.gameState.players.right.id.slice(-8),
        connected: room.gameState.players.right.connected,
        score: room.gameState.players.right.score
      } : null
    },
    ball: {
      x: Math.round(room.gameState.ball.x),
      y: Math.round(room.gameState.ball.y),
      vx: room.gameState.ball.vx,
      vy: room.gameState.ball.vy
    },
    hasGameLoop: !!room.gameLoopIntervalId
  }));
  
  res.json({
    totalRooms: rooms.length,
    rooms: debugInfo,
    waitingPlayers: gameManager.getWaitingPlayers().map(id => id.slice(-8)),
    timestamp: new Date().toISOString()
  });
});

// 🔥 NEW: Enhanced debug endpoint for socket room memberships
app.get('/debug/socket-rooms', (req, res) => {
  const socketRooms: Record<string, string[]> = {};
  const roomMembers: Record<string, string[]> = {};
  
  io.sockets.sockets.forEach((socket, socketId) => {
    const shortId = socketId.slice(-8);
    socketRooms[shortId] = Array.from(socket.rooms).filter(room => room !== socketId);
    
    // Build reverse mapping
    socket.rooms.forEach(roomId => {
      if (roomId !== socketId) {
        if (!roomMembers[roomId]) {
          roomMembers[roomId] = [];
        }
        roomMembers[roomId].push(shortId);
      }
    });
  });
  
  res.json({
    socketRooms,
    roomMembers,
    totalSockets: io.sockets.sockets.size,
    timestamp: new Date().toISOString()
  });
});

app.get('/debug/connections', (req, res) => {
  const connectedSockets = Array.from(io.sockets.sockets.values()).map(socket => ({
    id: socket.id.slice(-8),
    connected: socket.connected,
    rooms: Array.from(socket.rooms).filter(room => room !== socket.id)
  }));
  
  res.json({
    totalConnections: io.sockets.sockets.size,
    connections: connectedSockets,
    timestamp: new Date().toISOString()
  });
});

io.engine.on('connection_error', (err) => {
  console.log('Connection error details:', {
    message: err.message,
    code: err.code,
    context: err.context
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log('CORS enabled for http://localhost:3000');
  console.log(`Rate limiting: ${CONNECTION_ATTEMPT_LIMIT} attempts per ${CONNECTION_ATTEMPT_WINDOW/1000}s`);
});