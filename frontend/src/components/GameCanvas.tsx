import React, { useRef, useEffect } from 'react';
import { GameState, GAME_WIDTH, GAME_HEIGHT, PADDLE_WIDTH, PADDLE_HEIGHT, BALL_SIZE } from '../types/gameTypes';

interface GameCanvasProps {
  gameState: GameState | null;
  playerId: string;
}

const GameCanvas: React.FC<GameCanvasProps> = ({ gameState, playerId }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

    if (!gameState) {
      // Draw empty game area with instructions
      ctx.fillStyle = '#333';
      ctx.font = '24px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('Waiting for game...', GAME_WIDTH / 2, GAME_HEIGHT / 2);
      return;
    }

    // Draw center line
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 2;
    ctx.setLineDash([10, 10]);
    ctx.beginPath();
    ctx.moveTo(GAME_WIDTH / 2, 0);
    ctx.lineTo(GAME_WIDTH / 2, GAME_HEIGHT);
    ctx.stroke();
    ctx.setLineDash([]);

    // Draw left paddle
    if (gameState.players.left) {
      const isMyPaddle = gameState.players.left.id === playerId;
      ctx.fillStyle = isMyPaddle ? '#00ff00' : '#ffffff';
      ctx.fillRect(
        gameState.players.left.paddle.x,
        gameState.players.left.paddle.y,
        PADDLE_WIDTH,
        PADDLE_HEIGHT
      );
      
      // Draw left player score
      ctx.fillStyle = '#ffffff';
      ctx.font = '36px Arial';
      ctx.textAlign = 'center';
      ctx.fillText(
        gameState.players.left.score.toString(),
        GAME_WIDTH / 4,
        50
      );
      
      // Draw player indicator
      if (isMyPaddle) {
        ctx.fillStyle = '#00ff00';
        ctx.font = '14px Arial';
        ctx.fillText('YOU', GAME_WIDTH / 4, 80);
      }
    }

    // Draw right paddle
    if (gameState.players.right) {
      const isMyPaddle = gameState.players.right.id === playerId;
      ctx.fillStyle = isMyPaddle ? '#00ff00' : '#ffffff';
      ctx.fillRect(
        gameState.players.right.paddle.x,
        gameState.players.right.paddle.y,
        PADDLE_WIDTH,
        PADDLE_HEIGHT
      );
      
      // Draw right player score
      ctx.fillStyle = '#ffffff';
      ctx.font = '36px Arial';
      ctx.textAlign = 'center';
      ctx.fillText(
        gameState.players.right.score.toString(),
        (3 * GAME_WIDTH) / 4,
        50
      );
      
      // Draw player indicator
      if (isMyPaddle) {
        ctx.fillStyle = '#00ff00';
        ctx.font = '14px Arial';
        ctx.fillText('YOU', (3 * GAME_WIDTH) / 4, 80);
      }
    }

    // Draw ball
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(
      gameState.ball.x + BALL_SIZE / 2,
      gameState.ball.y + BALL_SIZE / 2,
      BALL_SIZE / 2,
      0,
      2 * Math.PI
    );
    ctx.fill();

    // Draw game status overlay
    if (!gameState.gameActive) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
      
      ctx.fillStyle = '#ffffff';
      ctx.font = '24px Arial';
      ctx.textAlign = 'center';
      
      if (gameState.winner) {
        const isWinner = gameState.winner === playerId;
        ctx.fillStyle = isWinner ? '#00ff00' : '#ff0000';
        ctx.fillText(
          isWinner ? 'YOU WIN!' : 'YOU LOSE!',
          GAME_WIDTH / 2,
          GAME_HEIGHT / 2 - 20
        );
        
        ctx.fillStyle = '#ffffff';
        ctx.font = '16px Arial';
        ctx.fillText(
          'Game Over - Join a new game to play again',
          GAME_WIDTH / 2,
          GAME_HEIGHT / 2 + 20
        );
      } else if (gameState.players.left && gameState.players.right) {
        ctx.fillText('Game Starting...', GAME_WIDTH / 2, GAME_HEIGHT / 2);
      } else {
        ctx.fillText('Waiting for opponent...', GAME_WIDTH / 2, GAME_HEIGHT / 2);
      }
    }

    // Draw connection indicators
    const leftConnected = gameState.players.left?.connected ?? false;
    const rightConnected = gameState.players.right?.connected ?? false;
    
    // Left player connection indicator
    ctx.fillStyle = leftConnected ? '#00ff00' : '#ff0000';
    ctx.beginPath();
    ctx.arc(30, GAME_HEIGHT - 30, 8, 0, 2 * Math.PI);
    ctx.fill();
    
    ctx.fillStyle = '#ffffff';
    ctx.font = '12px Arial';
    ctx.textAlign = 'left';
    ctx.fillText('Left Player', 45, GAME_HEIGHT - 25);
    
    // Right player connection indicator
    ctx.fillStyle = rightConnected ? '#00ff00' : '#ff0000';
    ctx.beginPath();
    ctx.arc(GAME_WIDTH - 30, GAME_HEIGHT - 30, 8, 0, 2 * Math.PI);
    ctx.fill();
    
    ctx.fillStyle = '#ffffff';
    ctx.font = '12px Arial';
    ctx.textAlign = 'right';
    ctx.fillText('Right Player', GAME_WIDTH - 45, GAME_HEIGHT - 25);

  }, [gameState, playerId]);

  return (
    <div style={{ 
      border: '2px solid #333', 
      display: 'inline-block',
      background: '#000'
    }}>
      <canvas
        ref={canvasRef}
        width={GAME_WIDTH}
        height={GAME_HEIGHT}
        style={{
          display: 'block',
          imageRendering: 'crisp-edges'
        }}
      />
    </div>
  );
};

export default GameCanvas;