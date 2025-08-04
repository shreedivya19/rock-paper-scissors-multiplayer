// server.js - Node.js Server with Socket.IO
// server.js - Node.js Server with Socket.IO
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Game state
const games = new Map();
const waitingPlayers = [];

// AI Player class
class AIPlayer {
    constructor() {
        this.id = 'ai-player';
        this.name = 'Computer';
        this.choices = ['rock', 'paper', 'scissors'];
    }

    makeChoice() {
        // AI strategy: 70% random, 30% counter-strategy
        const strategies = [
            () => this.choices[Math.floor(Math.random() * 3)], // Random
            () => this.getCounterChoice(), // Counter last player choice
            () => this.choices[Math.floor(Math.random() * 3)] // Random again
        ];
        
        const strategy = strategies[Math.floor(Math.random() * strategies.length)];
        return strategy();
    }

    getCounterChoice() {
        // Simple counter-strategy (beats rock most often since players tend to choose rock)
        const weights = { rock: 0.4, paper: 0.3, scissors: 0.3 };
        const counters = { rock: 'paper', paper: 'scissors', scissors: 'rock' };
        
        const rand = Math.random();
        if (rand < weights.rock) return counters.rock;
        if (rand < weights.rock + weights.paper) return counters.paper;
        return counters.scissors;
    }

    emit(event, data) {
        // AI doesn't need to emit events, but we keep this for compatibility
    }

    join() {
        // AI doesn't need to join rooms
    }
}

class Game {
    constructor(player1, player2, isAIGame = false) {
        this.id = Math.random().toString(36).substr(2, 9);
        this.isAIGame = isAIGame;
        this.players = {
            [player1.id]: { 
                socket: player1, 
                name: player1.name,
                choice: null,
                score: 0
            },
            [player2.id]: { 
                socket: player2, 
                name: player2.name,
                choice: null,
                score: 0
            }
        };
        this.round = 1;
        this.maxRounds = 5;
        this.gameOver = false;
        this.aiPlayer = isAIGame ? player2 : null;
    }

    makeChoice(playerId, choice) {
        if (this.players[playerId]) {
            this.players[playerId].choice = choice;
        }
        
        // If it's an AI game and human player made choice, make AI choice
        if (this.isAIGame && playerId !== 'ai-player') {
            const aiChoice = this.aiPlayer.makeChoice();
            this.players['ai-player'].choice = aiChoice;
        }
        
        // Check if both players have made their choices
        const choices = Object.values(this.players).map(p => p.choice);
        if (choices.every(choice => choice !== null)) {
            this.resolveRound();
        }
    }

    resolveRound() {
        const playerIds = Object.keys(this.players);
        const player1 = this.players[playerIds[0]];
        const player2 = this.players[playerIds[1]];

        const result = this.determineWinner(player1.choice, player2.choice);
        
        if (result === 1) {
            player1.score++;
        } else if (result === 2) {
            player2.score++;
        }

        // Send round result to both players
        const roundData = {
            round: this.round,
            choices: {
                [playerIds[0]]: { name: player1.name, choice: player1.choice },
                [playerIds[1]]: { name: player2.name, choice: player2.choice }
            },
            winner: result === 0 ? 'tie' : (result === 1 ? player1.name : player2.name),
            scores: {
                [playerIds[0]]: { name: player1.name, score: player1.score },
                [playerIds[1]]: { name: player2.name, score: player2.score }
            }
        };

        Object.values(this.players).forEach(player => {
            player.socket.emit('roundResult', roundData);
        });

        // Reset choices for next round
        Object.values(this.players).forEach(player => {
            player.choice = null;
        });

        this.round++;

        // Check if game is over
        if (this.round > this.maxRounds) {
            this.endGame();
        }
    }

    determineWinner(choice1, choice2) {
        if (choice1 === choice2) return 0; // Tie
        
        const winConditions = {
            rock: 'scissors',
            paper: 'rock',
            scissors: 'paper'
        };
        
        return winConditions[choice1] === choice2 ? 1 : 2;
    }

    endGame() {
        this.gameOver = true;
        const playerIds = Object.keys(this.players);
        const player1 = this.players[playerIds[0]];
        const player2 = this.players[playerIds[1]];

        let winner;
        if (player1.score > player2.score) {
            winner = player1.name;
        } else if (player2.score > player1.score) {
            winner = player2.name;
        } else {
            winner = 'tie';
        }

        const gameResult = {
            winner,
            finalScores: {
                [playerIds[0]]: { name: player1.name, score: player1.score },
                [playerIds[1]]: { name: player2.name, score: player2.score }
            }
        };

        Object.values(this.players).forEach(player => {
            if (player.socket.emit) { // Only emit to real players, not AI
                player.socket.emit('gameEnd', gameResult);
            }
        });

        // Clean up
        games.delete(this.id);
    }
}

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('joinGame', (playerName) => {
        socket.name = playerName;
        
        if (waitingPlayers.length === 0) {
            // First player, add to waiting list
            waitingPlayers.push(socket);
            socket.emit('waiting', 'Waiting for another player...');
        } else {
            // Second player, start game
            const opponent = waitingPlayers.pop();
            const game = new Game(opponent, socket);
            games.set(game.id, game);
            
            // Join both players to game room
            opponent.join(game.id);
            socket.join(game.id);
            
            // Store game reference in socket
            opponent.gameId = game.id;
            socket.gameId = game.id;
            
            // Notify both players that game started
            const gameData = {
                gameId: game.id,
                opponent: opponent.name,
                round: game.round,
                maxRounds: game.maxRounds
            };
            
            opponent.emit('gameStart', { ...gameData, opponent: socket.name });
            socket.emit('gameStart', gameData);
        }
    });

    socket.on('playWithAI', (playerName) => {
        socket.name = playerName;
        
        // Create AI opponent
        const aiOpponent = new AIPlayer();
        const game = new Game(socket, aiOpponent, true);
        games.set(game.id, game);
        
        // Store game reference in socket
        socket.gameId = game.id;
        
        // Join player to game room
        socket.join(game.id);
        
        // Notify player that AI game started
        const gameData = {
            gameId: game.id,
            opponent: aiOpponent.name,
            round: game.round,
            maxRounds: game.maxRounds,
            isAI: true
        };
        
        socket.emit('gameStart', gameData);
    });

    socket.on('makeChoice', (choice) => {
        if (socket.gameId && games.has(socket.gameId)) {
            const game = games.get(socket.gameId);
            game.makeChoice(socket.id, choice);
        }
    });

    socket.on('playAgain', () => {
        // Remove from any existing game
        if (socket.gameId && games.has(socket.gameId)) {
            games.delete(socket.gameId);
        }
        socket.gameId = null;
        
        // Add to waiting list
        if (!waitingPlayers.includes(socket)) {
            waitingPlayers.push(socket);
            socket.emit('waiting', 'Waiting for another player...');
        }
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        
        // Remove from waiting players
        const waitingIndex = waitingPlayers.indexOf(socket);
        if (waitingIndex > -1) {
            waitingPlayers.splice(waitingIndex, 1);
        }
        
        // Handle game disconnection
        if (socket.gameId && games.has(socket.gameId)) {
            const game = games.get(socket.gameId);
            // Notify other player
            Object.values(game.players).forEach(player => {
                if (player.socket.id !== socket.id) {
                    player.socket.emit('playerDisconnected', 'Your opponent disconnected');
                }
            });
            games.delete(socket.gameId);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

// public/index.html - Client-side HTML
const clientHTML = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Multiplayer Rock Paper Scissors</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: 'Arial', sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            justify-content: center;
            align-items: center;
            color: white;
        }

        .container {
            background: rgba(255, 255, 255, 0.1);
            backdrop-filter: blur(10px);
            border-radius: 20px;
            padding: 2rem;
            text-align: center;
            box-shadow: 0 8px 32px rgba(31, 38, 135, 0.37);
            border: 1px solid rgba(255, 255, 255, 0.18);
            max-width: 600px;
            width: 90%;
        }

        h1 {
            margin-bottom: 2rem;
            font-size: 2.5rem;
            text-shadow: 2px 2px 4px rgba(0,0,0,0.3);
        }

        .login-screen {
            display: block;
        }

        .game-screen {
            display: none;
        }

        .waiting-screen {
            display: none;
        }

        input[type="text"] {
            padding: 12px 20px;
            font-size: 1.1rem;
            border: none;
            border-radius: 25px;
            margin: 10px;
            background: rgba(255, 255, 255, 0.9);
            color: #333;
            width: 250px;
        }

        button {
            padding: 12px 25px;
            font-size: 1.1rem;
            border: none;
            border-radius: 25px;
            cursor: pointer;
            margin: 10px;
            transition: all 0.3s ease;
            background: linear-gradient(45deg, #FF6B6B, #4ECDC4);
            color: white;
            font-weight: bold;
        }

        button:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 8px rgba(0,0,0,0.2);
        }

        button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
            transform: none;
        }

        .choice-buttons {
            display: flex;
            justify-content: center;
            gap: 20px;
            margin: 2rem 0;
            flex-wrap: wrap;
        }

        .choice-btn {
            font-size: 3rem;
            width: 120px;
            height: 120px;
            border-radius: 50%;
            background: rgba(255, 255, 255, 0.2);
            border: 3px solid rgba(255, 255, 255, 0.3);
            transition: all 0.3s ease;
        }

        .choice-btn:hover {
            background: rgba(255, 255, 255, 0.3);
            transform: scale(1.1);
        }

        .game-info {
            margin: 1rem 0;
            font-size: 1.2rem;
        }

        .scores {
            display: flex;
            justify-content: space-around;
            margin: 1rem 0;
            background: rgba(0, 0, 0, 0.2);
            border-radius: 15px;
            padding: 1rem;
        }

        .round-result {
            margin: 2rem 0;
            padding: 1rem;
            background: rgba(255, 255, 255, 0.1);
            border-radius: 15px;
            border-left: 4px solid #4ECDC4;
        }

        .choices-display {
            display: flex;
            justify-content: space-around;
            margin: 1rem 0;
        }

        .player-choice {
            text-align: center;
            padding: 1rem;
            background: rgba(255, 255, 255, 0.1);
            border-radius: 10px;
            min-width: 150px;
        }

        .waiting-message {
            font-size: 1.3rem;
            margin: 2rem 0;
            color: #4ECDC4;
        }

        .game-over {
            background: linear-gradient(45deg, #FFD700, #FFA500);
            color: #333;
            padding: 2rem;
            border-radius: 15px;
            margin: 1rem 0;
        }

        @media (max-width: 768px) {
            .choice-btn {
                width: 80px;
                height: 80px;
                font-size: 2rem;
            }
            
            .scores {
                flex-direction: column;
                gap: 10px;
            }
            
            .choices-display {
                flex-direction: column;
                gap: 10px;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🎮 Rock Paper Scissors</h1>
        
        <!-- Login Screen -->
        <div id="loginScreen" class="login-screen">
            <p>Enter your name to start playing!</p>
            <input type="text" id="playerName" placeholder="Your name" maxlength="20">
            <br>
            <button onclick="joinGame()">Join Game</button>
        </div>

        <!-- Waiting Screen -->
        <div id="waitingScreen" class="waiting-screen">
            <div class="waiting-message" id="waitingMessage">Waiting for another player...</div>
            <button onclick="cancelWaiting()">Cancel</button>
        </div>

        <!-- Game Screen -->
        <div id="gameScreen" class="game-screen">
            <div class="game-info">
                <div>Playing against: <strong id="opponentName"></strong></div>
                <div>Round: <span id="currentRound">1</span> / <span id="maxRounds">5</span></div>
            </div>

            <div class="scores">
                <div>
                    <strong id="playerName1"></strong><br>
                    Score: <span id="playerScore1">0</span>
                </div>
                <div>
                    <strong id="playerName2"></strong><br>
                    Score: <span id="playerScore2">0</span>
                </div>
            </div>

            <div id="choiceSection">
                <p>Make your choice:</p>
                <div class="choice-buttons">
                    <button class="choice-btn" onclick="makeChoice('rock')">🪨</button>
                    <button class="choice-btn" onclick="makeChoice('paper')">📄</button>
                    <button class="choice-btn" onclick="makeChoice('scissors')">✂️</button>
                </div>
            </div>

            <div id="roundResult" class="round-result" style="display: none;">
                <div class="choices-display" id="choicesDisplay"></div>
                <div id="roundWinner"></div>
                <button id="nextRoundBtn" onclick="nextRound()" style="display: none;">Next Round</button>
            </div>

            <div id="gameOverScreen" style="display: none;">
                <div class="game-over">
                    <h2 id="gameWinner"></h2>
                    <div id="finalScores"></div>
                    <button onclick="playAgain()">Play Again</button>
                    <button onclick="backToLobby()">Back to Lobby</button>
                </div>
            </div>
        </div>
    </div>

    <script src="/socket.io/socket.io.js"></script>
    <script>
        const socket = io();
        let currentPlayer = '';
        let gameState = 'login'; // login, waiting, playing

        // DOM elements
        const loginScreen = document.getElementById('loginScreen');
        const waitingScreen = document.getElementById('waitingScreen');
        const gameScreen = document.getElementById('gameScreen');
        const choiceSection = document.getElementById('choiceSection');
        const roundResult = document.getElementById('roundResult');
        const gameOverScreen = document.getElementById('gameOverScreen');

        function joinGame() {
            const nameInput = document.getElementById('playerName');
            const name = nameInput.value.trim();
            
            if (name.length === 0) {
                alert('Please enter your name!');
                return;
            }
            
            currentPlayer = name;
            socket.emit('joinGame', name);
            showWaitingScreen();
        }

        function showWaitingScreen() {
            loginScreen.style.display = 'none';
            waitingScreen.style.display = 'block';
            gameScreen.style.display = 'none';
            gameState = 'waiting';
        }

        function showGameScreen() {
            loginScreen.style.display = 'none';
            waitingScreen.style.display = 'none';
            gameScreen.style.display = 'block';
            gameState = 'playing';
        }

        function showLoginScreen() {
            loginScreen.style.display = 'block';
            waitingScreen.style.display = 'none';
            gameScreen.style.display = 'none';
            gameState = 'login';
            document.getElementById('playerName').value = '';
        }

        function cancelWaiting() {
            socket.disconnect();
            socket.connect();
            showLoginScreen();
        }

        function makeChoice(choice) {
            socket.emit('makeChoice', choice);
            choiceSection.innerHTML = '<p>Waiting for opponent...</p>';
        }

        function nextRound() {
            roundResult.style.display = 'none';
            choiceSection.innerHTML = \`
                <p>Make your choice:</p>
                <div class="choice-buttons">
                    <button class="choice-btn" onclick="makeChoice('rock')">🪨</button>
                    <button class="choice-btn" onclick="makeChoice('paper')">📄</button>
                    <button class="choice-btn" onclick="makeChoice('scissors')">✂️</button>
                </div>
            \`;
        }

        function playAgain() {
            gameOverScreen.style.display = 'none';
            socket.emit('playAgain');
            showWaitingScreen();
        }

        function backToLobby() {
            socket.disconnect();
            socket.connect();
            showLoginScreen();
        }

        // Socket event listeners
        socket.on('waiting', (message) => {
            document.getElementById('waitingMessage').textContent = message;
        });

        socket.on('gameStart', (data) => {
            showGameScreen();
            document.getElementById('opponentName').textContent = data.opponent;
            document.getElementById('currentRound').textContent = data.round;
            document.getElementById('maxRounds').textContent = data.maxRounds;
            
            // Reset game display
            roundResult.style.display = 'none';
            gameOverScreen.style.display = 'none';
            nextRound();
        });

        socket.on('roundResult', (data) => {
            document.getElementById('currentRound').textContent = data.round;
            
            // Update scores
            const scoreKeys = Object.keys(data.scores);
            document.getElementById('playerName1').textContent = data.scores[scoreKeys[0]].name;
            document.getElementById('playerScore1').textContent = data.scores[scoreKeys[0]].score;
            document.getElementById('playerName2').textContent = data.scores[scoreKeys[1]].name;
            document.getElementById('playerScore2').textContent = data.scores[scoreKeys[1]].score;
            
            // Show choices
            const choicesDisplay = document.getElementById('choicesDisplay');
            const choiceKeys = Object.keys(data.choices);
            const choiceEmojis = { rock: '🪨', paper: '📄', scissors: '✂️' };
            
            choicesDisplay.innerHTML = \`
                <div class="player-choice">
                    <div><strong>\${data.choices[choiceKeys[0]].name}</strong></div>
                    <div style="font-size: 3rem;">\${choiceEmojis[data.choices[choiceKeys[0]].choice]}</div>
                    <div>\${data.choices[choiceKeys[0]].choice}</div>
                </div>
                <div class="player-choice">
                    <div><strong>\${data.choices[choiceKeys[1]].name}</strong></div>
                    <div style="font-size: 3rem;">\${choiceEmojis[data.choices[choiceKeys[1]].choice]}</div>
                    <div>\${data.choices[choiceKeys[1]].choice}</div>
                </div>
            \`;
            
            // Show winner
            const roundWinner = document.getElementById('roundWinner');
            if (data.winner === 'tie') {
                roundWinner.innerHTML = '<h3>🤝 It\'s a tie!</h3>';
            } else {
                roundWinner.innerHTML = \`<h3>🎉 \${data.winner} wins this round!</h3>\`;
            }
            
            roundResult.style.display = 'block';
            document.getElementById('nextRoundBtn').style.display = 'block';
        });

        socket.on('gameEnd', (data) => {
            const gameWinner = document.getElementById('gameWinner');
            const finalScores = document.getElementById('finalScores');
            
            if (data.winner === 'tie') {
                gameWinner.textContent = 'Game Over - It\'s a Tie!';
            } else {
                gameWinner.textContent = \`🏆 \${data.winner} Wins the Game!\`;
            }
            
            const scoreKeys = Object.keys(data.finalScores);
            finalScores.innerHTML = \`
                <p><strong>\${data.finalScores[scoreKeys[0]].name}:</strong> \${data.finalScores[scoreKeys[0]].score} points</p>
                <p><strong>\${data.finalScores[scoreKeys[1]].name}:</strong> \${data.finalScores[scoreKeys[1]].score} points</p>
            \`;
            
            gameOverScreen.style.display = 'block';
        });

        socket.on('playerDisconnected', (message) => {
            alert(message);
            showLoginScreen();
        });

        // Handle page refresh/close
        window.addEventListener('beforeunload', () => {
            socket.disconnect();
        });
    </script>
</body>
</html>
`;

// To create the complete project structure:
console.log('=== SETUP INSTRUCTIONS ===');
console.log('1. Create a new directory for your project');
console.log('2. Run: npm init -y');
console.log('3. Run: npm install express socket.io');
console.log('4. Save the server code above as server.js');
console.log('5. Create a "public" directory');
console.log('6. Save the HTML code as public/index.html');
console.log('7. Run: node server.js');
console.log('8. Open http://localhost:3000 in two browser tabs to test');
console.log('===============================');