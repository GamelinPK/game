const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

const MAX_HP = 100;

// Card Database
const cards = {
    'strike': { name: 'Strike', icon: '🗡️', desc: 'Deal 15 DMG.', color: '#ff4757', action: (a, t) => attack(a, t, 15) },
    'heal': { name: 'Bandage', icon: '💚', desc: 'Restore 18 HP.', color: '#2ed573', action: (a, t) => heal(a, 18) },
    'fireball': { name: 'Fireball', icon: '🔥', desc: 'Deal 25 DMG. You take 5 DMG.', color: '#ff6348', action: (a, t) => { attack(a, t, 25); directDamage(a, 5); } },
    'vampire': { name: 'Vampiric Bite', icon: '🦇', desc: 'Deal 10 DMG. Heal 10 HP.', color: '#a55eea', action: (a, t) => { attack(a, t, 10); heal(a, 10); } },
    'shield': { name: 'Iron Wall', icon: '🛡️', desc: 'Gain 20 Block.', color: '#3742fa', action: (a, t) => addBlock(a, 20) },
    'poison': { name: 'Poison Flask', icon: '🧪', desc: 'Deal 5 DMG. Apply 5 Poison.', color: '#2ecc71', action: (a, t, room) => { attack(a, t, 5); addStatus(t, 'poison', 5, room); } },
    'execute': { name: 'Execute', icon: '☠️', desc: 'Deal 35 DMG if enemy HP < 40, else 8 DMG.', color: '#2f3542', action: (a, t) => { if(t.hp < 40) attack(a, t, 35); else attack(a, t, 8); } },
    'shatter': { name: 'Shatter', icon: '🔨', desc: 'Destroy enemy Block. Deal 10 DMG.', color: '#f39c12', action: (a, t, room) => { t.block = 0; logAction(`💥 ${a.name} shattered ${t.name}'s Block!`, room, a.id); attack(a, t, 10); } },
    'reckless': { name: 'Reckless Swing', icon: '🎲', desc: '50% chance for 30 DMG, 50% for 0.', color: '#e67e22', action: (a, t, room) => { if(Math.random() > 0.5) attack(a, t, 30); else logAction(`💨 ${a.name} swung wildly and missed!`, room, a.id); } },
    'regen': { name: 'Regrowth', icon: '🌱', desc: 'Heal 5 HP. Gain 5 Regen.', color: '#1abc9c', action: (a, t, room) => { heal(a, 5); addStatus(a, 'regen', 5, room); } },
    'thief': { name: 'Siphon', icon: '🧤', desc: 'Steal all enemy Block. Deal 5 DMG.', color: '#747d8c', action: (a, t, room) => { const stolen = t.block; t.block = 0; a.block += stolen; if(stolen>0) logAction(`🧤 ${a.name} stole ${stolen} Block!`, room, a.id); attack(a, t, 5); } },
    'sacrifice': { name: 'Blood Pact', icon: '🩸', desc: 'Lose 15 HP. Deal 30 DMG.', color: '#c0392b', action: (a, t) => { directDamage(a, 15); attack(a, t, 30); } }
};
const cardKeys = Object.keys(cards);

const rooms = {}; // Store active games

function getRandomHand() {
    return [cardKeys[Math.floor(Math.random() * cardKeys.length)], cardKeys[Math.floor(Math.random() * cardKeys.length)], cardKeys[Math.floor(Math.random() * cardKeys.length)]];
}

// Action Helpers
function attack(actor, target, amount) {
    let dmg = amount;
    if (target.block > 0) {
        if (target.block >= dmg) { target.block -= dmg; return; } 
        else { dmg -= target.block; target.block = 0; }
    }
    target.hp -= dmg;
}
function heal(target, amount) { target.hp = Math.min(MAX_HP, target.hp + amount); }
function directDamage(target, amount) { target.hp -= amount; }
function addBlock(target, amount) { target.block += amount; }
function addStatus(target, type, amount) { target[type] += amount; }
function logAction(msg, room, actorId = 'sys') {
    room.logs.push({ text: msg, actor: actorId });
    if (room.logs.length > 8) room.logs.shift();
}

// Game Logic
function checkGameOver(room) {
    if (room.p1.hp <= 0 && room.p2.hp <= 0) { room.gameOver = true; room.winner = "Draw"; }
    else if (room.p1.hp <= 0) { room.gameOver = true; room.winner = "Player 2"; }
    else if (room.p2.hp <= 0) { room.gameOver = true; room.winner = "Player 1"; }
}

function processTurnStart(entity, room) {
    entity.block = 0;
    if (entity.poison > 0) {
        entity.hp -= entity.poison;
        logAction(`🧪 Poison dealt ${entity.poison} DMG to ${entity.name}.`, room, 'sys');
        entity.poison -= 1;
    }
    if (entity.regen > 0) {
        const h = Math.min(entity.regen, MAX_HP - entity.hp);
        entity.hp += h;
        if (h > 0) logAction(`🌱 Regen restored ${h} HP to ${entity.name}.`, room, 'sys');
        entity.regen -= 1;
    }
}

function broadcastState(roomId) {
    const room = rooms[roomId];
    if(!room) return;
    
    // Safely check if Player 2 exists before trying to count their cards
    const p2HandCount = room.p2 ? room.p2.hand.length : 0;
    const p1HandCount = room.p1 ? room.p1.hand.length : 0;

    // Send state to Player 1
    io.to(room.p1.id).emit('game_state', { 
        ...room, 
        me: 'p1', 
        opponent: 'p2', 
        myHand: room.p1.hand, 
        oppHandCount: p2HandCount 
    });
    
    // If Player 2 has joined, send state to them too
    if(room.p2) {
        io.to(room.p2.id).emit('game_state', { 
            ...room, 
            me: 'p2', 
            opponent: 'p1', 
            myHand: room.p2.hand, 
            oppHandCount: p1HandCount 
        });
    }
}

// Socket Connections
io.on('connection', (socket) => {
    
    socket.on('create_room', () => {
        const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
        rooms[roomId] = {
            id: roomId,
            p1: { id: socket.id, name: "Player 1", hp: MAX_HP, block: 0, poison: 0, regen: 0, hand: getRandomHand() },
            p2: null,
            turn: 'p1',
            logs: [{ text: "Room created. Waiting for opponent...", actor: "sys" }],
            gameOver: false,
            winner: null
        };
        socket.join(roomId);
        socket.emit('room_created', roomId);
        broadcastState(roomId);
    });

    socket.on('join_room', (roomId) => {
        roomId = roomId.toUpperCase();
        if (rooms[roomId] && !rooms[roomId].p2) {
            rooms[roomId].p2 = { id: socket.id, name: "Player 2", hp: MAX_HP, block: 0, poison: 0, regen: 0, hand: getRandomHand() };
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
        const targetKey = isP1 ? 'p2' : 'p1';

        // Check if it's their turn
        if (room.turn !== actorKey) return;

        const actor = room[actorKey];
        const target = room[targetKey];
        const cardId = actor.hand[cardIndex];
        const card = cards[cardId];

        logAction(`👉 ${actor.name} played [${card.name}]!`, room, actorKey);
        card.action(actor, target, room);
        
        // Draw new card
        actor.hand[cardIndex] = cardKeys[Math.floor(Math.random() * cardKeys.length)];
        
        checkGameOver(room);

        if (!room.gameOver) {
            // Switch Turn & Process Start of Turn
            room.turn = targetKey;
            processTurnStart(target, room);
            checkGameOver(room);
        }

        broadcastState(roomId);
    });

    socket.on('disconnect', () => {
        // Simple cleanup: end any room this player was in
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
    console.log(`Game server running on http://localhost:${PORT}`);
});