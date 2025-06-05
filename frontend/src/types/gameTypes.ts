// Game constants
export const GAME_WIDTH = 800;
export const GAME_HEIGHT = 400;
export const PADDLE_WIDTH = 20;
export const PADDLE_HEIGHT = 80;
export const BALL_SIZE = 20;
export const BALL_SPEED = 3;
export const PADDLE_SPEED = 8;

// Types
export type PlayerSide = 'left' | 'right';

export interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface Paddle {
  x: number;
  y: number;
}

export interface Player {
  id: string;
  side: PlayerSide;
  paddle: Paddle;
  score: number;
  connected: boolean;
}

export interface GameState {
  ball: Ball;
  players: {
    left: Player | null;
    right: Player | null;
  };
  gameActive: boolean;
  winner: string | null;
}

export interface GameRoom {
  id: string;
  gameState: GameState;
  players: Map<string, Player>;
  gameLoopIntervalId?: NodeJS.Timeout;
}

// Socket.IO event interfaces
export interface ServerToClientEvents {
  connected: (data: { message: string; playerId: string }) => void;
  playerJoined: (data: { side: PlayerSide; playerId: string }) => void;
  gameState: (gameState: GameState) => void;
  gameStart: () => void;
  gameEnd: (data: { winner: string | null; message?: string }) => void;
  playerDisconnected: (data: { side: PlayerSide }) => void;
}

export interface ClientToServerEvents {
  joinGame: () => void;
  paddleMove: (data: { direction: 'up' | 'down' }) => void;
}

export interface InterServerEvents {
  // For future use if needed
}

export interface SocketData {
  playerId: string;
  roomId?: string;
}