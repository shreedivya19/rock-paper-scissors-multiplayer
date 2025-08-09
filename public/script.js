// Socket connection
// Socket connection
const socket = io();

// Game state
let gameState = {
    roomId: null,
    playerId: null,
    playerName: null,
    isConnected: false,
    currentScreen: 'room'
};

// DOM Elements
const screens = {
    room: document.getElementById('roomScreen'),
    waiting: document.getElementById('waitingScreen'),
    game: document.getElementById('gameScreen'),
    gameOver: document.getElementById('gameOverScreen'),
    disconnect: document.getElementById('disconnectScreen')
};

const elements = {
    roomIdInput: document.getElementById('roomIdInput'),
    playerNameInput: document.getElementById('playerNameInput'),
    createRoomBtn: document.getElementById('createRoomBtn'),
    joinRoomBtn: document.getElementById('joinRoomBtn'),
    copyRoomIdBtn: document.getElementById('copyRoomIdBtn'),
    connectionStatus: document.getElementById('connectionStatus'),
    
    waitingRoomId: document.getElementById('waitingRoomId'),
    gameRoomId: document.getElementById('gameRoomId'),
    currentRound: document.getElementById('currentRound'),
    maxRounds: document.getElementById('maxRounds'),
    
    player1Name: document.getElementById('player1Name'),
    player2Name: document.getElementById('player2Name'),
    player1Score: document.getElementById('player1Score'),
    player2Score: document.getElementById('player2Score'),
    player1Status: document.getElementById('player1Status'),
    player2Status: document.getElementById('player2Status'),
    player1Choice: document.getElementById('player1Choice'),
    player2Choice: document.getElementById('player2Choice'),
    player1Card: document.getElementById('player1Card'),
    player2Card: document.getElementById('player2Card'),
    
    choicesSection: document.getElementById('choicesSection'),
    statusMessage: document.getElementById('statusMessage'),
    roundResult: document.getElementById('roundResult'),
    
    gameOverResult: document.getElementById('gameOverResult'),
    finalScores: document.getElementById('finalScores'),
    playAgainBtn: document.getElementById('playAgainBtn'),
    newRoomBtn: document.getElementById('newRoomBtn'),
    gameStats: document.getElementById('gameStats'),
    
    disconnectMessage: document.getElementById('disconnectMessage'),
    backToMenuBtn: document.getElementById('backToMenuBtn'),
    
    toast: document.getElementById('toast')
};

// Utility Functions
function showScreen(screenName) {
    Object.values(screens).forEach(screen => screen.style.display = 'none');
    screens[screenName].style.display = 'flex';
    gameState.currentScreen = screenName;
}

function showToast(message, type = 'info') {
    elements.toast.textContent = message;
    elements.toast.className = `toast ${type}`;
    elements.toast.classList.add('show');
    
    setTimeout(() => {
        elements.toast.classList.remove('show');
    }, 3000);
}

function getChoiceEmoji(choice) {
    const emojis = { rock: '🪨', paper: '📄', scissors: '✂️' };
    return emojis[choice] || '❓';
}

function updateConnectionStatus(message, type = 'info') {
    elements.connectionStatus.textContent = message;
    elements.connectionStatus.className = `status-message ${type}`;
}

function disableChoices(disabled = true) {
    const choiceBtns = document.querySelectorAll('.choice-btn');
    choiceBtns.forEach(btn => {
        btn.disabled = disabled;
        if (disabled) {
            btn.classList.add('loading');
        } else {
            btn.classList.remove('loading', 'selected');
        }
    });
}

// Event Listeners
elements.createRoomBtn.addEventListener('click', () => {
    const playerName = elements.playerNameInput.value.trim();
    if (!playerName) {
        showToast('Please enter your name!', 'error');
        return;
    }
    
    elements.createRoomBtn.disabled = true;
    elements.joinRoomBtn.disabled = true;
    
    gameState.playerName = playerName;
    socket.emit('join-room', { roomId: null, playerName });
});

elements.joinRoomBtn.addEventListener('click', () => {
    const roomId = elements.roomIdInput.value.trim().toUpperCase();
    const playerName = elements.playerNameInput.value.trim();
    
    if (!playerName) {
        showToast('Please enter your name!', 'error');
        return;
    }
    
    if (!roomId) {
        showToast('Please enter a Room ID!', 'error');
        return;
    }
    
    elements.createRoomBtn.disabled = true;
    elements.joinRoomBtn.disabled = true;
    
    gameState.playerName = playerName;
    socket.emit('join-room', { roomId, playerName });
});

elements.copyRoomIdBtn.addEventListener('click', async () => {
    try {
        await navigator.clipboard.writeText(gameState.roomId);
        showToast('Room ID copied to clipboard!', 'success');
        elements.copyRoomIdBtn.textContent = '✅ Copied!';
        setTimeout(() => {
            elements.copyRoomIdBtn.textContent = '📋 Copy Room ID';
        }, 2000);
    } catch (err) {
        // Fallback for older browsers
        const textArea = document.createElement('textarea');
        textArea.value = gameState.roomId;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        showToast('Room ID copied!', 'success');
    }
});

elements.playAgainBtn.addEventListener('click', () => {
    socket.emit('new-game');
});

elements.newRoomBtn.addEventListener('click', () => {
    location.reload();
});

elements.backToMenuBtn.addEventListener('click', () => {
    location.reload();
});

// Choice buttons
document.addEventListener('click', (e) => {
    if (e.target.closest('.choice-btn')) {
        const btn = e.target.closest('.choice-btn');
        const choice = btn.dataset.choice;
        
        if (btn.disabled) return;
        
        // Visual feedback
        document.querySelectorAll('.choice-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        
        // Disable all choices
        disableChoices(true);
        
        // Send choice to server
        socket.emit('make-choice', { choice });
        
        elements.statusMessage.textContent = 'Choice made! Waiting for opponent...';
        updatePlayerStatus(gameState.playerId, '⏱️');
    }
});

// Keyboard support
document.addEventListener('keydown', (e) => {
    if (gameState.currentScreen === 'game') {
        switch(e.key) {
            case '1':
            case 'r':
            case 'R':
                document.querySelector('[data-choice="rock"]')?.click();
                break;
            case '2':
            case 'p':
            case 'P':
                document.querySelector('[data-choice="paper"]')?.click();
                break;
            case '3':
            case 's':
            case 'S':
                document.querySelector('[data-choice="scissors"]')?.click();
                break;
        }
    }
    
    if (e.key === 'Enter') {
        if (gameState.currentScreen === 'room') {
            if (elements.roomIdInput.value.trim()) {
                elements.joinRoomBtn.click();
            } else {
                elements.createRoomBtn.click();
            }
        }
    }
});

// Helper Functions
function updatePlayerStatus(playerId, status) {
    const statusElement = playerId === 'player1' ? elements.player1Status : elements.player2Status;
    statusElement.textContent = status;
}

function updatePlayerChoice(playerId, choice, revealed = false) {
    const choiceElement = playerId === 'player1' ? elements.player1Choice : elements.player2Choice;
    choiceElement.textContent = revealed ? getChoiceEmoji(choice) : '🤔';
}

function highlightCurrentPlayer(playerId) {
    elements.player1Card.classList.remove('current-player');
    elements.player2Card.classList.remove('current-player');
    
    if (playerId) {
        const card = playerId === 'player1' ? elements.player1Card : elements.player2Card;
        card.classList.add('current-player');
    }
}

function updateScores(scores) {
    elements.player1Score.textContent = scores.player1 || 0;
    elements.player2Score.textContent = scores.player2 || 0;
}

function displayRoundResult(result, winner, choices) {
    elements.roundResult.innerHTML = '';
    elements.roundResult.classList.remove('win', 'lose', 'tie');
    
    let resultText = '';
    let resultClass = '';
    
    if (winner === 'tie') {
        resultText = "It's a tie! 🤝";
        resultClass = 'tie';
    } else if (winner === gameState.playerId) {
        resultText = "You won this round! 🎉";
        resultClass = 'win';
    } else {
        resultText = "You lost this round 😔";
        resultClass = 'lose';
    }
    
    elements.roundResult.textContent = resultText;
    elements.roundResult.classList.add(resultClass);
}

// Socket Event Handlers
socket.on('connect', () => {
    gameState.isConnected = true;
    updateConnectionStatus('Connected to server', 'success');
    console.log('Connected to server');
});

socket.on('disconnect', () => {
    gameState.isConnected = false;
    updateConnectionStatus('Disconnected from server', 'error');
    console.log('Disconnected from server');
});

socket.on('room-joined', (data) => {
    console.log('Joined room:', data);
    gameState.roomId = data.roomId;
    gameState.playerId = data.playerId;
    
    // Update UI
    elements.waitingRoomId.textContent = data.roomId;
    elements.gameRoomId.textContent = data.roomId;
    elements.maxRounds.textContent = data.room.gameState.maxRounds;
    
    // Show waiting screen
    showScreen('waiting');
    showToast(`Joined room ${data.roomId}!`, 'success');
});

socket.on('room-error', (data) => {
    console.log('Room error:', data);
    showToast(data.message, 'error');
    
    // Re-enable buttons
    elements.createRoomBtn.disabled = false;
    elements.joinRoomBtn.disabled = false;
    
    updateConnectionStatus(data.message, 'error');
});

socket.on('player-joined', (data) => {
    console.log('Player joined:', data);
    
    // Update player names
    const players = data.players;
    if (players.player1) {
        elements.player1Name.textContent = players.player1.name;
    }
    if (players.player2) {
        elements.player2Name.textContent = players.player2.name;
    }
    
    updateScores(data.gameState.scores);
    elements.currentRound.textContent = data.gameState.currentRound;
});

socket.on('game-start', (data) => {
    console.log('Game started:', data);
    showScreen('game');
});