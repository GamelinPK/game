const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// Deck Builder Mechanics
function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

function drawCards(player, count, room) {
    let drawn = 0;
    for (let i = 0; i < count; i++) {
        if (player.deck.length === 0) {
            if (player.discard.length === 0) break; // No cards left anywhere
            player.deck = shuffle([...player.discard]);
            player.discard = [];
            logAction(`♻️ ${player.name} shuffled their discard pile into their deck.`, room, player.id);
        }
        player.hand.push(player.deck.pop());
        drawn++;
    }
    if (drawn > 0) logAction(`🃏 ${player.name} drew ${drawn} card(s).`, room, player.id);
}

function logAction(msg, room, actorId = 'sys') {
    room.logs.push({ text: msg, actor: actorId });
    if (room.logs.length > 8) room.logs.shift();
}

function getPrestige(player) {
    const allCards = [...player.deck, ...player.hand, ...player.discard, ...player.played];
    return allCards.reduce((sum, cardId) => sum + (cards[cardId].prestige || 0), 0);
}

function checkGameOver(room) {
    let emptyPiles = 0;
    for (let key in room.supply) {
        if (room.supply[key] <= 0) emptyPiles++;
    }
    if (emptyPiles >= 3) {
        room.gameOver = true;
        const p1Score = getPrestige(room.p1);
        const p2Score = getPrestige(room.p2);
        if (p1Score > p2Score) room.winner = "Player 1";
        else if (p2Score > p1Score) room.winner = "Player 2";
        else room.winner = "Draw";
        logAction(`🏁 Game Over! P1: ${p1Score} Prestige | P2: ${p2Score} Prestige`, room, 'sys');
    }
}

// Card Database
const cards = {
    // Nation Cards (Action Phase)
    'barony': { id: 'barony', name: 'Barony', type: 'nation', cost: 2, desc: '+2 Cards, +1 Action', action: (p, room) => { p.actions += 1; drawCards(p, 2, room); } },
    'county': { id: 'county', name: 'County', type: 'nation', cost: 4, desc: '+2 Cards, +1 Action. 50% +1 Card, else +1 Action.', action: (p, room) => { 
        p.actions += 1; 
        drawCards(p, 2, room); 
        if(Math.random() < 0.5) { drawCards(p, 1, room); logAction(`🎲 County granted +1 extra Card!`, room, p.id); } 
        else { p.actions += 1; logAction(`🎲 County granted +1 extra Action!`, room, p.id); } 
    }},
    'city': { id: 'city', name: 'City', type: 'nation', cost: 6, desc: '+1 Card, +2 Money', action: (p, room) => { drawCards(p, 1, room); p.money += 2; } },
    
    // Money Cards (Buy Phase)
    'coin': { id: 'coin', name: 'Coin', type: 'money', cost: 3, desc: '+1 Money', action: (p, room) => { p.money += 1; } },
    'banknote': { id: 'banknote', name: 'Bank Note', type: 'money', cost: 6, desc: '+2 Money', action: (p, room) => { p.money += 2; } },
    
    // Prestige Cards (Victory Points)
    'knight': { id: 'knight', name: 'Knight', type: 'prestige', cost: 2, prestige: 2, desc: '2 Prestige Points', action: (p, room) => {} },
    'chevalier': { id: 'chevalier', name: 'Chevalier', type: 'prestige', cost: 4, prestige: 4, desc: '4 Prestige Points', action: (p, room) => {} }
};

const initialSupply = { barony: 5, county: 5, city: 5, coin: 5, banknote: 5, knight: 5, chevalier: 5 };
const rooms = {}; 

function createPlayer(id, name) {
    return {
        id, name,
        deck: shuffle(['knight', 'knight', 'coin', 'coin', 'coin']),
        hand: [],
        discard: [],
        played: [],
        actions: 1,
        money: 0,
        buys: 1
    };
}

function broadcastState(roomId) {
    const room = rooms[roomId];
    if(!room) return;
    
    const p1State = { ...room.p1, deckCount: room.p1.deck.length, discardCount: room.p1.discard.length, prestige: getPrestige(room.p1) };
    const p2State = room.p2 ? { ...room.p2, deckCount: room.p2.deck.length, discardCount: room.p2.discard.length, prestige: getPrestige(room.p2) } : null;

    if (room.p1.id) {
        io.to(room.p1.id).emit('game_state', {
            id: room.id, turn: room.turn, phase: room.phase, supply: room.supply, logs: room.logs, gameOver: room.gameOver, winner: room.winner,
            me: p1State,
            opponent: p2State ? { name: p2State.name, deckCount: p2State.deckCount, discardCount: p2State.discardCount, handCount: p2State.hand.length, played: p2State.played, prestige: p2State.prestige } : null
        });
    }
    if (room.p2 && room.p2.id) {
        io.to(room.p2.id).emit('game_state', {
            id: room.id, turn: room.turn, phase: room.phase, supply: room.supply, logs: room.logs, gameOver: room.gameOver, winner: room.winner,
            me: p2State,
            opponent: { name: p1State.name, deckCount: p1State.deckCount, discardCount: p1State.discardCount, handCount: p1State.hand.length, played: p1State.played, prestige: p1State.prestige }
        });
    }
}

io.on('connection', (socket) => {
    
    socket.on('create_room', () => {
        const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
        rooms[roomId] = {
            id: roomId,
            p1: createPlayer(socket.id, "Player 1"),
            p2: null,
            turn: 'p1',
            phase: 'action',
            supply: { ...initialSupply },
            logs: [{ text: "Room created. Waiting for opponent...", actor: "sys" }],
            gameOver: false,
            winner: null
        };
        drawCards(rooms[roomId].p1, 5, rooms[roomId]);
        socket.join(roomId);
        socket.emit('room_created', roomId);
        broadcastState(roomId);
    });

    socket.on('join_room', (roomId) => {
        roomId = roomId.toUpperCase();
        if (rooms[roomId] && !rooms[roomId].p2) {
            rooms[roomId].p2 = createPlayer(socket.id, "Player 2");
            drawCards(rooms[roomId].p2, 5, rooms[roomId]);
            socket.join(roomId);
            logAction("Player 2 joined! Game started.", rooms[roomId], 'sys');
            socket.emit('room_joined', roomId);
            broadcastState(roomId);
        } else {
            socket.emit('error_msg', "Room not found or already full.");
        }
    });

    socket.on('play_card', (data) => {
        const { roomId, cardIndex } = data;
        const room = rooms[roomId];
        if (!room || room.gameOver) return;

        const isP1 = room.p1.id === socket.id;
        const actorKey = isP1 ? 'p1' : 'p2';
        const actor = room[actorKey];

        if (room.turn !== actorKey) return;

        const cardId = actor.hand[cardIndex];
        const card = cards[cardId];

        // Phase Logic
        if (room.phase === 'action') {
            if (card.type !== 'nation') return; 
            if (actor.actions <= 0) return;
            actor.actions -= 1;
        } else if (room.phase === 'buy') {
            if (card.type !== 'money') return; 
        } else {
            return;
        }

        actor.hand.splice(cardIndex, 1);
        actor.played.push(cardId);
        
        logAction(`👉 ${actor.name} played [${card.name}]`, room, actorKey);
        card.action(actor, room);
        
        broadcastState(roomId);
    });
    
    socket.on('play_all_money', (roomId) => {
        const room = rooms[roomId];
        if (!room || room.gameOver) return;
        
        const isP1 = room.p1.id === socket.id;
        const actorKey = isP1 ? 'p1' : 'p2';
        const actor = room[actorKey];

        if (room.turn !== actorKey || room.phase !== 'buy') return;
        
        let moneyPlayed = 0;
        // Loop backwards to splice correctly
        for (let i = actor.hand.length - 1; i >= 0; i--) {
            const cardId = actor.hand[i];
            if (cards[cardId].type === 'money') {
                actor.hand.splice(i, 1);
                actor.played.push(cardId);
                cards[cardId].action(actor, room);
                moneyPlayed++;
            }
        }
        
        if (moneyPlayed > 0) {
            logAction(`💰 ${actor.name} played all their money cards.`, room, actorKey);
            broadcastState(roomId);
        }
    });
    
    socket.on('buy_card', (data) => {
        const { roomId, cardId } = data;
        const room = rooms[roomId];
        if (!room || room.gameOver) return;

        const isP1 = room.p1.id === socket.id;
        const actorKey = isP1 ? 'p1' : 'p2';
        const actor = room[actorKey];

        if (room.turn !== actorKey || room.phase !== 'buy') return;
        if (actor.buys <= 0) return;
        
        const card = cards[cardId];
        if (room.supply[cardId] <= 0 || actor.money < card.cost) return;
        
        // Purchase
        actor.money -= card.cost;
        actor.buys -= 1;
        room.supply[cardId] -= 1;
        actor.discard.push(cardId);
        
        logAction(`🛒 ${actor.name} bought a [${card.name}]!`, room, actorKey);
        checkGameOver(room);
        broadcastState(roomId);
    });

    socket.on('next_phase', (roomId) => {
        const room = rooms[roomId];
        if (!room || room.gameOver) return;

        const isP1 = room.p1.id === socket.id;
        const actorKey = isP1 ? 'p1' : 'p2';
        const targetKey = isP1 ? 'p2' : 'p1';
        
        if (room.turn !== actorKey) return;
        const actor = room[actorKey];

        if (room.phase === 'action') {
            room.phase = 'buy';
            logAction(`⏩ ${actor.name} entered the Buy Phase.`, room, actorKey);
        } else {
            // End Turn: Cleanup
            actor.discard.push(...actor.hand, ...actor.played);
            actor.hand = [];
            actor.played = [];
            actor.actions = 1;
            actor.money = 0;
            actor.buys = 1;
            
            drawCards(actor, 5, room);
            
            room.turn = targetKey;
            room.phase = 'action';
            logAction(`🛑 ${actor.name} ended their turn.`, room, actorKey);
        }
        
        broadcastState(roomId);
    });

    socket.on('disconnect', () => {
        for (let roomId in rooms) {
            let room = rooms[roomId];
            if (room.p1.id === socket.id || (room.p2 && room.p2.id === socket.id)) {
                io.to(roomId).emit('opponent_disconnected');
                delete rooms[roomId];
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Deckbuilder server running on http://localhost:${PORT}`);
});