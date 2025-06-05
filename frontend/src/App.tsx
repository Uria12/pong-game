import React, { useEffect, useState, useCallback, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import './App.css';
import GameCanvas from './components/GameCanvas';
import {
  GameState,
  ServerToClientEvents,
  ClientToServerEvents,
  PlayerSide
} from './types/gameTypes';

const App: React.FC = () => {
  const [socket, setSocket] = useState<Socket<ServerToClientEvents, ClientToServerEvents> | null>(null);
  const [connected, setConnected] = useState(false);
  const [playerId, setPlayerId] = useState<string>('');
  const [connectionMessage, setConnectionMessage] = useState<string>('Connecting...');
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [playerSide, setPlayerSide] = useState<PlayerSide | null>(null);
  const [gameStatus, setGameStatus] = useState<'waiting' | 'joining' | 'playing' | 'ended'>('waiting');
  const [roomId, setRoomId] = useState<string>('');
  
  // Refs to prevent stale closures and manage connection state
  const playerIdRef = useRef<string>('');
  const socketRef = useRef<Socket<ServerToClientEvents, ClientToServerEvents> | null>(null);
  const mountedRef = useRef(true);
  const connectionInitializedRef = useRef(false);
  const connectionTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Update refs when state changes
  useEffect(() => {
    playerIdRef.current = playerId;
    socketRef.current = socket;
  }, [playerId, socket]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (connectionTimeoutRef.current) {
        clearTimeout(connectionTimeoutRef.current);
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (socketRef.current) {
        socketRef.current.removeAllListeners();
        socketRef.current.disconnect();
      }
    };
  }, []);

  const handleKeyPress = useCallback((event: KeyboardEvent) => {
    const currentSocket = socketRef.current;
    if (!currentSocket || !gameState) return;

    const currentPlayerId = playerIdRef.current;
    const isMyPaddleLeft = gameState.players.left?.id === currentPlayerId;
    const isMyPaddleRight = gameState.players.right?.id === currentPlayerId;

    if (isMyPaddleLeft || isMyPaddleRight) {
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        currentSocket.emit('paddleMove', { direction: 'up' });
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        currentSocket.emit('paddleMove', { direction: 'down' });
      }
    }
  }, [gameState]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyPress);
    return () => {
      window.removeEventListener('keydown', handleKeyPress);
    };
  }, [handleKeyPress]);

  const createSocketConnection = useCallback(() => {
    console.log('🔌 Creating new socket connection...');
    
    const newSocket = io('http://localhost:3001', {
      forceNew: true,
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 5,
      timeout: 10000,
      transports: ['websocket', 'polling'],
      autoConnect: true,
      upgrade: true,
      rememberUpgrade: true
    });

    // Connection timeout
    connectionTimeoutRef.current = setTimeout(() => {
      if (!newSocket.connected) {
        console.log('⏰ Connection timeout - destroying socket');
        newSocket.disconnect();
        setConnectionMessage('Connection timeout. Please try again.');
        setConnected(false);
      }
    }, 15000);

    // Connection handlers
    newSocket.on('connect', () => {
      if (!mountedRef.current) return;
      
      console.log('✅ Connected to server with ID:', newSocket.id?.slice(-8));
      setConnected(true);
      setConnectionMessage('Connected to server, click Join Game!');
      setGameStatus('waiting');
      
      if (connectionTimeoutRef.current) {
        clearTimeout(connectionTimeoutRef.current);
      }
    });

    newSocket.on('connect_error', (error) => {
      if (!mountedRef.current) return;
      
      console.error('❌ Connection error:', error);
      setConnected(false);
      
      if (error.message.includes('Too many connection attempts')) {
        setConnectionMessage('Rate limited. Please wait 60 seconds and refresh the page.');
      } else {
        setConnectionMessage('Connection failed. Please check if server is running.');
      }
      
      if (connectionTimeoutRef.current) {
        clearTimeout(connectionTimeoutRef.current);
      }
    });

    newSocket.on('disconnect', (reason) => {
      if (!mountedRef.current) return;
      
      console.log('💔 Disconnected from server, reason:', reason);
      setConnected(false);
      setGameStatus('waiting');
      setGameState(null);
      setPlayerSide(null);
      setPlayerId('');
      setRoomId('');
      
      if (reason === 'io server disconnect') {
        setConnectionMessage('Disconnected by server. Please refresh to reconnect.');
      } else {
        setConnectionMessage('Disconnected from server.');
      }
      
      if (connectionTimeoutRef.current) {
        clearTimeout(connectionTimeoutRef.current);
      }
    });

    newSocket.on('connected', (data) => {
      if (!mountedRef.current) return;
      
      console.log('🎉 Received welcome:', data);
      setPlayerId(data.playerId);
      setConnectionMessage(data.message);
      
      // Handle rate limiting message
      if (data.message.includes('Too many connection attempts')) {
        setTimeout(() => {
          if (mountedRef.current) {
            setConnectionMessage('Rate limited. Please wait and refresh the page.');
          }
        }, 2000);
      }
    });

    // 🔥 CRITICAL FIX: Proper playerJoined handling with enhanced logging
    newSocket.on('playerJoined', (data) => {
      if (!mountedRef.current) return;
      
      console.log('🎮 RECEIVED playerJoined:', data);
      console.log('🔍 Current playerId:', playerIdRef.current?.slice(-8));
      console.log('🔍 Event playerId:', data.playerId?.slice(-8));
      
      const currentPlayerId = playerIdRef.current;
      
      // FIXED: Check if this event is for the current player
      if (data.playerId === currentPlayerId) {
        console.log(`🎯 I am the ${data.side} player (confirmed by server)`);
        setPlayerSide(data.side);
        setConnectionMessage(`You are the ${data.side} player!`);
        setGameStatus('playing');
      } else {
        console.log(`👥 Opponent is the ${data.side} player`);
        setConnectionMessage(`Opponent (${data.side}) joined!`);
        // Don't change our game status yet - wait for game state
      }
    });

    newSocket.on('gameStart', () => {
      if (!mountedRef.current) return;
      
      console.log('🚀 Game started event received!');
      setGameStatus('playing');
      setConnectionMessage('Game in progress!');
    });

    // 🔥 CRITICAL FIX: Enhanced game state synchronization with detailed logging
    newSocket.on('gameState', (state) => {
      if (!mountedRef.current) return;
      
      console.log('📊 RECEIVED gameState:', {
        gameActive: state.gameActive,
        winner: state.winner?.slice(-8) || 'none',
        leftPlayer: state.players.left ? `${state.players.left.id.slice(-8)} (score: ${state.players.left.score})` : 'none',
        rightPlayer: state.players.right ? `${state.players.right.id.slice(-8)} (score: ${state.players.right.score})` : 'none',
        ball: { x: Math.round(state.ball.x), y: Math.round(state.ball.y) }
      });
      
      // Always update game state immediately for synchronization
      setGameState(state);
      
      const currentPlayerId = playerIdRef.current;
      console.log('🔍 My playerId:', currentPlayerId?.slice(-8));
      
      // 🔥 CRITICAL: Determine and confirm player side from authoritative game state
      let confirmedSide: PlayerSide | null = null;
      if (state.players.left?.id === currentPlayerId) {
        confirmedSide = 'left';
        console.log('✅ Confirmed: I am LEFT player from game state');
      } else if (state.players.right?.id === currentPlayerId) {
        confirmedSide = 'right';
        console.log('✅ Confirmed: I am RIGHT player from game state');
      } else {
        console.log('⚠️ I am not found in this game state');
      }
      
      // Update player side if we found ourselves in game state
      if (confirmedSide && (!playerSide || playerSide !== confirmedSide)) {
        console.log(`🎯 Setting/updating player side to ${confirmedSide}`);
        setPlayerSide(confirmedSide);
      }
      
      // 🔥 ENHANCED: More precise game status and message handling
      if (state.winner) {
        // Game ended with a winner
        setGameStatus('ended');
        if (state.winner === currentPlayerId) {
          setConnectionMessage('🏆 Game Over: You Win!');
          console.log('🏆 I won the game!');
        } else {
          setConnectionMessage('💀 Game Over: You Lose!');
          console.log('💀 I lost the game...');
        }
      } else if (state.gameActive) {
        // Game is actively running
        setGameStatus('playing');
        setConnectionMessage('🎮 Game in progress!');
        console.log('🎮 Game is actively running');
      } else if (state.players.left && state.players.right) {
        // Both players present but game not yet active
        setGameStatus('playing');
        setConnectionMessage('⏳ Both players connected - Game starting...');
        console.log('⏳ Both players connected, waiting for game start');
      } else if (state.players.left || state.players.right) {
        // Only one player present
        setGameStatus('playing');
        const myPlayer = state.players.left?.id === currentPlayerId ? state.players.left : 
                         state.players.right?.id === currentPlayerId ? state.players.right : null;
        if (myPlayer) {
          setConnectionMessage(`👤 You are the ${myPlayer.side} player. Waiting for opponent...`);
          console.log(`👤 I am ${myPlayer.side} player, waiting for opponent`);
        } else {
          setConnectionMessage('⏰ Waiting for opponent...');
          console.log('⏰ Spectating - waiting for opponent');
        }
      } else {
        // No players in game state - shouldn't happen but handle gracefully
        setGameStatus('waiting');
        setConnectionMessage('🎯 Ready to join a game');
        console.log('🎯 Empty game state - ready to join');
      }
    });

    newSocket.on('gameEnd', (data) => {
      if (!mountedRef.current) return;
      
      console.log('🏁 Game ended event:', data);
      setGameStatus('ended');
      
      const currentPlayerId = playerIdRef.current;
      if (data.winner === currentPlayerId) {
        setConnectionMessage('🏆 Game Over: You Win!');
        console.log('🏆 Game end - I won!');
      } else if (data.winner !== null) {
        setConnectionMessage('💀 Game Over: You Lose!');
        console.log('💀 Game end - I lost...');
      } else {
        setConnectionMessage(data.message || '🏁 Game Over: Game ended.');
        console.log('🏁 Game end - no winner:', data.message);
      }
    });

    newSocket.on('reconnect_attempt', (attemptNumber) => {
      console.log(`🔄 Reconnection attempt #${attemptNumber}`);
      setConnectionMessage(`Reconnecting... (attempt ${attemptNumber})`);
    });

    newSocket.on('reconnect', (attemptNumber) => {
      console.log(`✅ Reconnected after ${attemptNumber} attempts`);
      setConnectionMessage('Reconnected to server!');
    });

    newSocket.on('reconnect_failed', () => {
      console.log('❌ Failed to reconnect');
      setConnectionMessage('Failed to reconnect. Please refresh the page.');
    });
    
    newSocket.on('playerDisconnected', (data) => {
      if (!mountedRef.current) return;
      
      console.log('👋 Player disconnected:', data);
      setConnectionMessage(`Opponent (${data.side}) disconnected!`);
      
      // Update game state to remove disconnected player
      setGameState(prev => {
        if (!prev) return null;
        const newPlayers = { ...prev.players };
        if (data.side === 'left') {
          newPlayers.left = null;
        } else {
          newPlayers.right = null;
        }
        return { ...prev, players: newPlayers, gameActive: false };
      });
      
      setGameStatus('ended');
      // Keep playerSide - player retains their identity
    });

    return newSocket;
  }, [playerSide]);

  // Initialize socket connection - runs only once
  useEffect(() => {
    if (connectionInitializedRef.current) {
      return;
    }

    connectionInitializedRef.current = true;
    const newSocket = createSocketConnection();
    setSocket(newSocket);
  }, [createSocketConnection]);

  const handleJoinGame = useCallback(() => {
    if (socket && connected && (gameStatus === 'waiting' || gameStatus === 'ended')) {
      console.log('🎯 Requesting to join game...');
      console.log('🔍 Current state:', { gameStatus, connected, playerId: playerId?.slice(-8) });
      
      setGameStatus('joining');
      setConnectionMessage('🔍 Looking for opponent...');
      
      // Reset game-specific state for new game
      setPlayerSide(null);
      setGameState(null);
      
      socket.emit('joinGame');
      console.log('📤 joinGame event sent to server');
    } else {
      console.log('❌ Cannot join game:', { 
        hasSocket: !!socket, 
        connected, 
        gameStatus,
        playerId: playerId?.slice(-8)
      });
    }
  }, [socket, connected, gameStatus, playerId]);

  const getStatusMessage = useCallback(() => {
    if (!connected) return '❌ Disconnected from server';
    
    switch (gameStatus) {
      case 'waiting':
        return '🎯 Ready to join a game';
      case 'joining':
        return '🔍 Looking for opponent...';
      case 'playing':
        if (gameState?.gameActive) {
          return '🎮 Game in progress';
        } else if (gameState?.players.left && gameState?.players.right) {
          return '⏳ Both players ready - Game starting...';
        } else {
          return '⏰ Waiting for opponent...';
        }
      case 'ended':
        return connectionMessage;
      default:
        return connectionMessage;
    }
  }, [gameStatus, gameState, connectionMessage, connected]);

  const getPlayerInfo = useCallback(() => {
    if (!gameState || !playerId) return null;
    
    const isLeftPlayer = gameState.players.left?.id === playerId;
    const isRightPlayer = gameState.players.right?.id === playerId;
    
    if (isLeftPlayer) {
      return {
        side: 'left' as PlayerSide,
        score: gameState.players.left?.score || 0,
        opponentScore: gameState.players.right?.score || 0
      };
    } else if (isRightPlayer) {
      return {
        side: 'right' as PlayerSide,
        score: gameState.players.right?.score || 0,
        opponentScore: gameState.players.left?.score || 0
      };
    }
    
    return null;
  }, [gameState, playerId]);

  const handleReconnect = useCallback(() => {
    console.log('🔄 Manual reconnection requested');
    
    if (socket) {
      socket.removeAllListeners();
      socket.disconnect();
    }
    
    // Reset state
    setConnected(false);
    setConnectionMessage('🔄 Reconnecting...');
    setGameStatus('waiting');
    setGameState(null);
    setPlayerSide(null);
    setPlayerId('');
    setRoomId('');
    
    // Clear any existing timeouts
    if (connectionTimeoutRef.current) {
      clearTimeout(connectionTimeoutRef.current);
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
    
    // Reset connection initialized flag
    connectionInitializedRef.current = false;
    
    // Create new connection after a short delay
    reconnectTimeoutRef.current = setTimeout(() => {
      if (mountedRef.current) {
        connectionInitializedRef.current = true;
        const newSocket = createSocketConnection();
        setSocket(newSocket);
      }
    }, 1000);
  }, [socket, createSocketConnection]);

  const playerInfo = getPlayerInfo();

  return (
    <div className="App">
      <header className="App-header">
        <h1>Multiplayer Pong Game</h1>

        <div className="connection-status">
          <p>Connection Status: {connected ? '✅ Connected' : '❌ Disconnected'}</p>
          <p>Status: {getStatusMessage()}</p>
          {playerId && <p>Your ID: {playerId.slice(-8)}</p>}
          {playerInfo && (
            <div>
              <p>You are the {playerInfo.side} player</p>
              <p>Score: You {playerInfo.score} - {playerInfo.opponentScore} Opponent</p>
            </div>
          )}
          
          {/* ENHANCED DEBUGGING INFO with better formatting */}
          <div style={{fontSize: '12px', color: '#666', marginTop: '10px', fontFamily: 'monospace'}}>
            <p>
              🎮 Status: {gameStatus} | 
              ⚡ Active: {gameState?.gameActive ? '✅' : '❌'} | 
              👥 Players: L:{gameState?.players.left ? '✅' : '❌'} R:{gameState?.players.right ? '✅' : '❌'}
            </p>
            <p>
              🎯 My Side: {playerSide || 'None'} | 
              🏆 Winner: {gameState?.winner ? gameState.winner.slice(-8) : 'None'}
            </p>
            {gameState && (
              <p>
                ⚽ Ball: ({Math.round(gameState.ball.x)}, {Math.round(gameState.ball.y)}) | 
                🎭 Velocity: ({gameState.ball.vx.toFixed(1)}, {gameState.ball.vy.toFixed(1)})
              </p>
            )}
            {gameState && playerInfo && (
              <p>
                📊 Scores: L:{gameState.players.left?.score || 0} - R:{gameState.players.right?.score || 0} | 
                🎯 My Score: {playerInfo.score}
              </p>
            )}
          </div>
          
          {!connected && (
            <button onClick={handleReconnect} className="join-button" style={{marginTop: '10px'}}>
              🔄 Reconnect
            </button>
          )}
        </div>

        <div className="game-controls">
          <button
            onClick={handleJoinGame}
            disabled={!connected || (gameStatus !== 'waiting' && gameStatus !== 'ended')}
            className="join-button"
          >
            {gameStatus === 'waiting' || gameStatus === 'ended' ? '🎯 Join New Game' :
             gameStatus === 'joining' ? '🔍 Finding Opponent...' :
             '🎮 In Game'}
          </button>
          
          {gameState && (gameStatus === 'playing' || gameStatus === 'ended') && (
            <div style={{marginTop: '10px', fontSize: '14px', color: '#ccc'}}>
              Use ↑ and ↓ arrow keys to control your paddle
            </div>
          )}
        </div>

        <div className="game-area">
          <GameCanvas gameState={gameState} playerId={playerId} />
        </div>
      </header>
    </div>
  );
};

export default App;