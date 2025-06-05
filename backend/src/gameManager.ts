import {
  GameState,
  Player,
  GameRoom,
  GAME_WIDTH,
  GAME_HEIGHT,
  PADDLE_HEIGHT,
  PADDLE_WIDTH,
  BALL_SIZE,
  BALL_SPEED,
  PADDLE_SPEED,
  PlayerSide
} from './types/gameTypes';

export class GameManager {
  private rooms: Map<string, GameRoom> = new Map();
  private waitingPlayers: string[] = [];
  private playerToRoom: Map<string, string> = new Map(); // Track which room each player is in

  // Create initial game state
  private createInitialGameState(): GameState {
    return {
      ball: {
        x: GAME_WIDTH / 2,
        y: GAME_HEIGHT / 2,
        vx: BALL_SPEED * (Math.random() > 0.5 ? 1 : -1),
        vy: BALL_SPEED * (Math.random() > 0.5 ? 1 : -1)
      },
      players: {
        left: null,
        right: null
      },
      gameActive: false,
      winner: null
    };
  }

  // Create a new player
  private createPlayer(playerId: string, side: PlayerSide): Player {
    const paddleX = side === 'left' ? 20 : GAME_WIDTH - 20 - PADDLE_WIDTH;

    return {
      id: playerId,
      side,
      paddle: {
        x: paddleX,
        y: GAME_HEIGHT / 2 - PADDLE_HEIGHT / 2
      },
      score: 0,
      connected: true
    };
  }

  // FIXED: Complete rewrite with proper match result for both players
  addPlayer(playerId: string): { roomId: string; side: PlayerSide; isNewGame: boolean; waitingPlayerId?: string } | null {
    console.log(`[GameManager] Adding player ${playerId.slice(-8)} to game`);
    
    // Check if player is already in a game (reconnection case)
    const existingRoomId = this.playerToRoom.get(playerId);
    if (existingRoomId) {
      const room = this.rooms.get(existingRoomId);
      if (room) {
        const player = room.players.get(playerId);
        if (player) {
          console.log(`[GameManager] Player ${playerId.slice(-8)} reconnecting to room ${existingRoomId} as ${player.side}`);
          player.connected = true;
          
          // Update game state
          if (player.side === 'left') {
            room.gameState.players.left = player;
          } else {
            room.gameState.players.right = player;
          }
          
          return { roomId: existingRoomId, side: player.side, isNewGame: false };
        }
      }
      // Clean up invalid mapping
      this.playerToRoom.delete(playerId);
    }

    // CRITICAL FIX: Proper waiting player matching with return info for both players
    if (this.waitingPlayers.length > 0) {
      const waitingPlayerId = this.waitingPlayers.shift()!;
      
      // Safety check - don't match player with themselves
      if (waitingPlayerId === playerId) {
        console.log(`[GameManager] Player ${playerId.slice(-8)} tried to match with themselves`);
        this.waitingPlayers.push(playerId);
        return null;
      }

      // Create new game room
      const roomId = `room_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      console.log(`[GameManager] Creating new game room: ${roomId}`);
      console.log(`[GameManager] Matching players: ${waitingPlayerId.slice(-8)} (left) vs ${playerId.slice(-8)} (right)`);

      // Create players
      const leftPlayer = this.createPlayer(waitingPlayerId, 'left');
      const rightPlayer = this.createPlayer(playerId, 'right');

      // Create game state
      const gameState = this.createInitialGameState();
      gameState.players.left = leftPlayer;
      gameState.players.right = rightPlayer;

      // Create room
      const room: GameRoom = {
        id: roomId,
        gameState,
        players: new Map([
          [waitingPlayerId, leftPlayer],
          [playerId, rightPlayer]
        ])
      };

      // Store everything
      this.rooms.set(roomId, room);
      this.playerToRoom.set(waitingPlayerId, roomId);
      this.playerToRoom.set(playerId, roomId);

      console.log(`[GameManager] Game room ${roomId} created successfully`);
      console.log(`[GameManager] Room state: Left=${leftPlayer.id.slice(-8)}, Right=${rightPlayer.id.slice(-8)}`);

      // FIXED: Return match info INCLUDING waiting player ID for server notification
      return { 
        roomId, 
        side: 'right', 
        isNewGame: true, 
        waitingPlayerId: waitingPlayerId 
      };
    } else {
      // Add to waiting list
      console.log(`[GameManager] No waiting players, adding ${playerId.slice(-8)} to waiting list`);
      this.waitingPlayers.push(playerId);
      return null;
    }
  }

  // FIXED: Better player removal
  removePlayer(playerId: string): { roomId: string; disconnectedSide: PlayerSide } | null {
    console.log(`[GameManager] Removing player ${playerId.slice(-8)}`);
    
    // Remove from waiting list
    const waitingIndex = this.waitingPlayers.indexOf(playerId);
    if (waitingIndex > -1) {
      this.waitingPlayers.splice(waitingIndex, 1);
      console.log(`[GameManager] Removed ${playerId.slice(-8)} from waiting list`);
      return null;
    }

    // Find player in active room
    const roomId = this.playerToRoom.get(playerId);
    if (!roomId) {
      console.log(`[GameManager] Player ${playerId.slice(-8)} not found in any room`);
      return null;
    }

    const room = this.rooms.get(roomId);
    if (!room) {
      console.log(`[GameManager] Room ${roomId} not found for player ${playerId.slice(-8)}`);
      this.playerToRoom.delete(playerId);
      return null;
    }

    const player = room.players.get(playerId);
    if (!player) {
      console.log(`[GameManager] Player ${playerId.slice(-8)} not found in room ${roomId}`);
      this.playerToRoom.delete(playerId);
      return null;
    }

    const disconnectedSide = player.side;
    console.log(`[GameManager] Player ${playerId.slice(-8)} disconnected from room ${roomId} (${disconnectedSide} side)`);

    // Mark player as disconnected and remove from game state
    player.connected = false;
    if (player.side === 'left') {
      room.gameState.players.left = null;
    } else {
      room.gameState.players.right = null;
    }

    // Check if any other players remain
    const remainingPlayers = Array.from(room.players.values()).filter(p => p.id !== playerId && p.connected);
    
    if (remainingPlayers.length === 0) {
      // No players left - clean up room
      if (room.gameLoopIntervalId) {
        clearInterval(room.gameLoopIntervalId);
      }
      this.rooms.delete(roomId);
      this.playerToRoom.delete(playerId);
      console.log(`[GameManager] Room ${roomId} deleted - no active players`);
    } else {
      // Other player wins by forfeit
      const otherPlayer = remainingPlayers[0];
      room.gameState.gameActive = false;
      room.gameState.winner = otherPlayer.id;
      
      if (room.gameLoopIntervalId) {
        clearInterval(room.gameLoopIntervalId);
      }
      
      console.log(`[GameManager] ${otherPlayer.id.slice(-8)} wins by forfeit in room ${roomId}`);
      this.playerToRoom.delete(playerId);
    }

    return { roomId, disconnectedSide };
  }

  // Move player paddle
  movePaddle(playerId: string, direction: 'up' | 'down'): string | null {
    const roomId = this.playerToRoom.get(playerId);
    if (!roomId) return null;

    const room = this.rooms.get(roomId);
    if (!room) return null;

    const player = room.players.get(playerId);
    if (!player || !player.connected) return null;

    // Update paddle position
    const newY = direction === 'up'
      ? Math.max(0, player.paddle.y - PADDLE_SPEED)
      : Math.min(GAME_HEIGHT - PADDLE_HEIGHT, player.paddle.y + PADDLE_SPEED);

    player.paddle.y = newY;

    // Update game state
    if (player.side === 'left') {
      room.gameState.players.left = player;
    } else {
      room.gameState.players.right = player;
    }

    return roomId;
  }

  // FIXED: Better game start logic
  startGame(roomId: string): boolean {
    const room = this.rooms.get(roomId);
    if (!room) {
      console.log(`[GameManager] Cannot start game - room ${roomId} not found`);
      return false;
    }

    const leftPlayer = room.gameState.players.left;
    const rightPlayer = room.gameState.players.right;

    if (!leftPlayer || !rightPlayer) {
      console.log(`[GameManager] Cannot start game - missing players in room ${roomId}`);
      return false;
    }

    if (!leftPlayer.connected || !rightPlayer.connected) {
      console.log(`[GameManager] Cannot start game - players not connected in room ${roomId}`);
      return false;
    }

    // Reset game state for new game
    room.gameState.gameActive = true;
    room.gameState.winner = null;
    
    // Reset scores
    leftPlayer.score = 0;
    rightPlayer.score = 0;
    
    // Reset ball
    this.resetBall(room.gameState);

    console.log(`[GameManager] Game started in room ${roomId}`);
    console.log(`[GameManager] Players: Left=${leftPlayer.id.slice(-8)}, Right=${rightPlayer.id.slice(-8)}`);
    
    return true;
  }

  // Update ball physics (unchanged but with better logging)
  updateBall(roomId: string): boolean {
    const room = this.rooms.get(roomId);
    if (!room || !room.gameState.gameActive) return false;

    const { ball } = room.gameState;
    const { players } = room.gameState;

    // Move ball
    ball.x += ball.vx;
    ball.y += ball.vy;

    // Bounce off top/bottom walls
    if (ball.y <= 0 || ball.y >= GAME_HEIGHT - BALL_SIZE) {
      ball.vy = -ball.vy;
      ball.y = Math.max(0, Math.min(GAME_HEIGHT - BALL_SIZE, ball.y));
    }

    // Paddle collisions
    const leftPaddle = players.left?.paddle;
    const rightPaddle = players.right?.paddle;

    // Left paddle collision
    if (leftPaddle &&
        ball.vx < 0 &&
        ball.x <= leftPaddle.x + PADDLE_WIDTH &&
        ball.x + BALL_SIZE >= leftPaddle.x &&
        ball.y + BALL_SIZE >= leftPaddle.y &&
        ball.y <= leftPaddle.y + PADDLE_HEIGHT) {
      ball.vx = -ball.vx;
      ball.x = leftPaddle.x + PADDLE_WIDTH;
    }

    // Right paddle collision
    if (rightPaddle &&
        ball.vx > 0 &&
        ball.x + BALL_SIZE >= rightPaddle.x &&
        ball.x <= rightPaddle.x + PADDLE_WIDTH &&
        ball.y + BALL_SIZE >= rightPaddle.y &&
        ball.y <= rightPaddle.y + PADDLE_HEIGHT) {
      ball.vx = -ball.vx;
      ball.x = rightPaddle.x - BALL_SIZE;
    }

    // Scoring
    if (ball.x < 0) {
      // Right player scores
      if (players.right) {
        players.right.score++;
        console.log(`[GameManager] Right player scored! Score: L${players.left?.score || 0} - R${players.right.score}`);
        this.resetBall(room.gameState);
        if (players.right.score >= 5) {
          room.gameState.winner = players.right.id;
          room.gameState.gameActive = false;
          console.log(`[GameManager] Right player wins!`);
        }
      }
      return true;
    }

    if (ball.x > GAME_WIDTH) {
      // Left player scores
      if (players.left) {
        players.left.score++;
        console.log(`[GameManager] Left player scored! Score: L${players.left.score} - R${players.right?.score || 0}`);
        this.resetBall(room.gameState);
        if (players.left.score >= 5) {
          room.gameState.winner = players.left.id;
          room.gameState.gameActive = false;
          console.log(`[GameManager] Left player wins!`);
        }
      }
      return true;
    }

    return false;
  }

  // Reset ball to center
  private resetBall(gameState: GameState): void {
    gameState.ball.x = GAME_WIDTH / 2;
    gameState.ball.y = GAME_HEIGHT / 2;
    
    let newVx = BALL_SPEED * (Math.random() > 0.5 ? 1 : -1);
    let newVy = BALL_SPEED * (Math.random() > 0.5 ? 1 : -1);

    // Ensure ball doesn't move too horizontally
    if (Math.abs(newVy) < 0.1) {
      newVy = BALL_SPEED * (Math.random() > 0.5 ? 0.5 : -0.5);
    }

    gameState.ball.vx = newVx;
    gameState.ball.vy = newVy;
  }

  // Get room by ID
  getRoom(roomId: string): GameRoom | undefined {
    return this.rooms.get(roomId);
  }

  // Get room by player ID
  getRoomByPlayer(playerId: string): GameRoom | null {
    const roomId = this.playerToRoom.get(playerId);
    if (!roomId) return null;
    return this.rooms.get(roomId) || null;
  }

  // Get all rooms (for debugging)
  getAllRooms(): GameRoom[] {
    return Array.from(this.rooms.values());
  }

  // Get waiting players
  getWaitingPlayers(): string[] {
    return [...this.waitingPlayers];
  }

  // Clear all games
  clearAllGames(): void {
    console.log(`[GameManager] Clearing all games and waiting players`);
    
    // Clear all game loops
    for (const room of this.rooms.values()) {
      if (room.gameLoopIntervalId) {
        clearInterval(room.gameLoopIntervalId);
      }
    }
    
    // Clear everything
    this.rooms.clear();
    this.waitingPlayers.length = 0;
    this.playerToRoom.clear();
  }

  // ADDED: Get player's current side in their room
  getPlayerSide(playerId: string): PlayerSide | null {
    const roomId = this.playerToRoom.get(playerId);
    if (!roomId) return null;
    
    const room = this.rooms.get(roomId);
    if (!room) return null;
    
    const player = room.players.get(playerId);
    return player ? player.side : null;
  }

  // ADDED: Check if both players are connected in a room
  bothPlayersConnected(roomId: string): boolean {
    const room = this.rooms.get(roomId);
    if (!room) return false;
    
    const leftPlayer = room.gameState.players.left;
    const rightPlayer = room.gameState.players.right;
    
    return !!(leftPlayer?.connected && rightPlayer?.connected);
  }
}