const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Game rooms storage
const rooms = new Map();
const playerSockets = new Map();

// Game logic
const CHOICES = ['rock', 'paper', 'scissors'];
const MAX_ROUNDS = 5;

function determineWinner(choice1, choice2) {
    if (choice1 === choice2) return 'tie';
    
    const winConditions = {
        rock: 'scissors',
        paper: 'rock',
        scissors: 'paper'
    };
    
    return winConditions[choice1] === choice2 ? 'player1' : 'player2';
}

function createRoom() {
    return {
        id: uuidv4().slice(0, 6).toUpperCase(),
        players: {},
        gameState: {
            currentRound: 1,
            maxRounds: MAX_ROUNDS,
            scores: {},
            choices: {},
            gameStarted: false,
            gameOver: false,
            roundResults: []
        },
        createdAt: new Date()
    };
}

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    // Create or join room
    socket.on('join-room', (data) => {
        const { roomId, playerName } = data;
        let room;

        if (roomId && rooms.has(roomId)) {
            room = rooms.get(roomId);
            
            // Check if room is full
            if (Object.keys(room.players).length >= 2) {
                socket.emit('room-error', { message: 'Room is full!' });
                return;
            }
        } else {
            // Create new room
            room = createRoom();
            rooms.set(room.id, room);
        }

        // Add player to room
        const playerId = Object.keys(room.players).length === 0 ? 'player1' : 'player2';
        room.players[playerId] = {
            id: socket.id,
            name: playerName,
            connected: true
        };
        
        room.gameState.scores[playerId] = 0;
        playerSockets.set(socket.id, { roomId: room.id, playerId });

        socket.join(room.id);

        // Notify players
        socket.emit('room-joined', {
            roomId: room.id,
            playerId: playerId,
            room: room
        });

        io.to(room.id).emit('player-joined', {
            players: room.players,
            gameState: room.gameState
        });

        // Start game if both players are present
        if (Object.keys(room.players).length === 2) {
            room.gameState.gameStarted = true;
            io.to(room.id).emit('game-start', {
                message: 'Both players ready! Make your choices!',
                gameState: room.gameState
            });
        }

        console.log(`Player ${playerName} joined room ${room.id} as ${playerId}`);
    });

    // Handle player choice
    socket.on('make-choice', (data) => {
        const playerInfo = playerSockets.get(socket.id);
        if (!playerInfo) return;

        const { roomId, playerId } = playerInfo;
        const room = rooms.get(roomId);
        if (!room || room.gameState.gameOver) return;

        const { choice } = data;
        if (!CHOICES.includes(choice)) return;

        // Record choice
        room.gameState.choices[playerId] = choice;

        // Notify room that choice was made (without revealing the choice)
        socket.to(roomId).emit('choice-made', {
            playerId: playerId,
            choiceMade: true
        });

        socket.emit('choice-confirmed', { choice });

        // Check if both players have made choices
        const playerIds = Object.keys(room.players);
        const allChoicesMade = playerIds.every(id => room.gameState.choices[id]);

        if (allChoicesMade && playerIds.length === 2) {
            // Reveal choices and determine winner
            const [p1, p2] = playerIds;
            const p1Choice = room.gameState.choices[p1];
            const p2Choice = room.gameState.choices[p2];
            
            const winner = determineWinner(p1Choice, p2Choice);
            
            // Update scores
            if (winner !== 'tie') {
                room.gameState.scores[winner]++;
            }

            const roundResult = {
                round: room.gameState.currentRound,
                choices: {
                    [p1]: p1Choice,
                    [p2]: p2Choice
                },
                winner: winner,
                scores: { ...room.gameState.scores }
            };

            room.gameState.roundResults.push(roundResult);

            // Send round results
            io.to(roomId).emit('round-result', roundResult);

            // Check if game is over
            if (room.gameState.currentRound >= room.gameState.maxRounds) {
                room.gameState.gameOver = true;
                
                const finalWinner = room.gameState.scores.player1 > room.gameState.scores.player2 
                    ? 'player1' 
                    : room.gameState.scores.player2 > room.gameState.scores.player1 
                        ? 'player2' 
                        : 'tie';

                io.to(roomId).emit('game-over', {
                    winner: finalWinner,
                    finalScores: room.gameState.scores,
                    gameStats: room.gameState.roundResults
                });
            } else {
                // Prepare for next round
                setTimeout(() => {
                    room.gameState.currentRound++;
                    room.gameState.choices = {};
                    
                    io.to(roomId).emit('next-round', {
                        round: room.gameState.currentRound,
                        gameState: room.gameState
                    });
                }, 3000);
            }
        }
    });

    // Start new game
    socket.on('new-game', () => {
        const playerInfo = playerSockets.get(socket.id);
        if (!playerInfo) return;

        const { roomId } = playerInfo;
        const room = rooms.get(roomId);
        if (!room) return;

        // Reset game state
        room.gameState = {
            currentRound: 1,
            maxRounds: MAX_ROUNDS,
            scores: { player1: 0, player2: 0 },
            choices: {},
            gameStarted: true,
            gameOver: false,
            roundResults: []
        };

        io.to(roomId).emit('game-restart', {
            gameState: room.gameState,
            message: 'New game started!'
        });
    });

    // Handle disconnection
    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
        
        const playerInfo = playerSockets.get(socket.id);
        if (playerInfo) {
            const { roomId, playerId } = playerInfo;
            const room = rooms.get(roomId);
            
            if (room) {
                room.players[playerId].connected = false;
                
                socket.to(roomId).emit('player-disconnected', {
                    playerId: playerId,
                    playerName: room.players[playerId].name
                });

                // Clean up empty rooms after 5 minutes
                setTimeout(() => {
                    if (room && !Object.values(room.players).some(p => p.connected)) {
                        rooms.delete(roomId);
                        console.log(`Room ${roomId} deleted due to inactivity`);
                    }
                }, 300000);
            }
            
            playerSockets.delete(socket.id);
        }
    });
});

// Clean up old rooms every hour
setInterval(() => {
    const now = new Date();
    for (const [roomId, room] of rooms.entries()) {
        const timeDiff = now - room.createdAt;
        const hoursOld = timeDiff / (1000 * 60 * 60);
        
        if (hoursOld > 2) { // Remove rooms older than 2 hours
            rooms.delete(roomId);
            console.log(`Cleaned up old room: ${roomId}`);
        }
    }
}, 3600000);

// API endpoint to get room info
app.get('/api/room/:roomId', (req, res) => {
    const room = rooms.get(req.params.roomId);
    if (room) {
        res.json({
            roomId: room.id,
            playerCount: Object.keys(room.players).length,
            gameStarted: room.gameState.gameStarted,
            gameOver: room.gameState.gameOver
        });
    } else {
        res.status(404).json({ error: 'Room not found' });
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        activeRooms: rooms.size,
        activePlayers: playerSockets.size
    });
});

server.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`🌍 Visit: http://localhost:${PORT}`);
});