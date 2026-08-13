const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const MAX_HP = 100;

// Helper Functions
function attack(actor, target, amount, room, ignoreArmor = false) {
    // Apply Weakness Multiplier (10% extra damage per stack)
    let dmg = Math.floor(amount * (1 + target.weakness * 0.1));
    
    if (!ignoreArmor && target.armor > 0) {
        if (target.armor >= dmg) {
            target.armor -= dmg;
            logAction(`🛡️ ${target.name}'s Armor absorbed ${dmg} DMG.`, room, target.id);
            target.weakness += 1; // Still apply weakness even if fully blocked
            return;
        } else {
            dmg -= target.armor;
            logAction(`🛡️ ${target.name}'s Armor absorbed ${target.armor} DMG.`, room, target.id);
            target.armor = 0;
        }
    }
    
    target.hp -= dmg;
    
    if (ignoreArmor) {
        logAction(`🗡️ ${actor.name} PIERCED armor and dealt ${dmg} DMG to ${target.name}!`, room, actor.id);
    } else {
        logAction(`⚔️ ${actor.name} dealt ${dmg} DMG to ${target.name}.`, room, actor.id);
    }
    
    // Apply Weakness after the attack connects
    target.weakness += 1;
}

function heal(target, amount, room) {
    const actualHeal = Math.min(amount, MAX_HP - target.hp);
    target.hp += actualHeal;
    if(actualHeal > 0) logAction(`💚 ${target.name} healed for ${actualHeal} HP.`, room, target.id);
}
function directDamage(target, amount, room) {
    target.hp -= amount;
    logAction(`🩸 ${target.name} took ${amount} direct DMG.`, room, target.id);
}
function addArmor(target, amount, room) {
    if(amount <= 0) return;
    target.armor += amount;
    logAction(`🛡️ ${target.name} gained ${amount} Armor.`, room, target.id);
}
function addStatus(target, type, amount, room) {
    target[type] += amount;
    const emoji = type === 'poison' ? '🧪' : '🌱';
    logAction(`${emoji} ${target.name} gained ${amount} ${type.charAt(0).toUpperCase() + type.slice(1)}.`, room, target.id);
}
function drawCards(actor, count, room) {
    for(let i=0; i<count; i++) {
        actor.hand.push(cardKeys[Math.floor(Math.random() * cardKeys.length)]);
    }
    logAction(`🃏 ${actor.name} drew ${count} card(s).`, room, actor.id);
}
function logAction(msg, room, actorId = 'sys') {
    room.logs.push({ text: msg, actor: actorId });
    if (room.logs.length > 8) room.logs.shift();
}

// Card Database
const cards = {
    'strike': { name: 'Strike', icon: '🗡️', desc: 'Deal 15 DMG.', color: '#ff4757', action: (a, t, room) => attack(a, t, 15, room) },
    'heal': { name: 'Bandage', icon: '💚', desc: 'Restore 18 HP.', color: '#2ed573', action: (a, t, room) => heal(a, 18, room) },
    'fireball': { name: 'Fireball', icon: '🔥', desc: 'Deal 25 DMG. You take 5 DMG.', color: '#ff6348', action: (a, t, room) => { attack(a, t, 25, room); directDamage(a, 5, room); } },
    'vampire': { name: 'Vampiric Bite', icon: '🦇', desc: 'Deal 10 DMG. Heal 10 HP.', color: '#a55eea', action: (a, t, room) => { attack(a, t, 10, room); heal(a, 10, room); } },
    'shield': { name: 'Iron Wall', icon: '🛡️', desc: 'Gain 15 Armor.', color: '#3742fa', action: (a, t, room) => addArmor(a, 15, room) },
    'poison': { name: 'Poison Flask', icon: '🧪', desc: 'Deal 5 DMG. Apply 5 Poison.', color: '#2ecc71', action: (a, t, room) => { attack(a, t, 5, room); addStatus(t, 'poison', 5, room); } },
    'execute': { name: 'Execute', icon: '☠️', desc: 'Deal 35 DMG if enemy HP < 40, else 8 DMG.', color: '#2f3542', action: (a, t, room) => { if(t.hp < 40) attack(a, t, 35, room); else attack(a, t, 8, room); } },
    'shatter': { name: 'Shatter', icon: '🔨', desc: 'Deal 15 DMG. Ignores Armor.', color: '#f39c12', action: (a, t, room) => attack(a, t, 15, room, true) },
    'pierce': { name: 'Piercing Lunge', icon: '🤺', desc: 'Deal 10 DMG. Ignores Armor. Draw 1 card.', color: '#747d8c', action: (a, t, room) => { attack(a, t, 10, room, true); drawCards(a, 1, room); } },
    'reckless': { name: 'Reckless Swing', icon: '🎲', desc: '50% chance for 30 DMG, 50% for 0.', color: '#e67e22', action: (a, t, room) => { if(Math.random() > 0.5) attack(a, t, 30, room); else logAction(`💨 ${a.name} swung wildly and missed!`, room, a.id); } },
    'regen': { name: 'Regrowth', icon: '🌱', desc: 'Heal 5 HP. Gain 5 Regen.', color: '#1abc9c', action: (a, t, room) => { heal(a, 5, room); addStatus(a, 'regen', 5, room); } },
    'sacrifice': { name: 'Blood Pact', icon: '🩸', desc: 'Lose 15 HP. Deal 30 DMG.', color: '#c0392b', action: (a, t, room) => { directDamage(a, 15, room); attack(a, t, 30, room); } },
    'quick_strike': { name: 'Quick Strike', icon: '⚡', desc: 'Deal 8 DMG. Draw 1 card.', color: '#f1c40f', action: (a, t, room) => { attack(a, t, 8, room); drawCards(a, 1, room); } },
    'preparation': { name: 'Preparation', icon: '🎒', desc: 'Gain 10 Armor. Draw 2 cards.', color: '#95a5a6', action: (a, t, room) => { addArmor(a, 10, room); drawCards(a, 2, room); } },
    'double_strike': { name: 'Double Strike', icon: '⚔️', desc: 'Deal 8 DMG twice.', color: '#e74c3c', action: (a, t, room) => { attack(a, t, 8, room); attack(a, t, 8, room); } },
    'leech_seed': { name: 'Leech Seed', icon: '🌰', desc: 'Apply 3 Poison. Gain 3 Regen.', color: '#27ae60', action: (a, t, room) => { addStatus(t, 'poison', 3, room); addStatus(a, 'regen', 3, room); } },
    'cursed_blade': { name: 'Cursed Blade', icon: '🗡️', desc: 'Deal 22 DMG. You gain 3 Poison.', color: '#8e44ad', action: (a, t, room) => { attack(a, t, 22, room); addStatus(a, 'poison', 3, room); } },
    'fortify': { name: 'Fortify', icon: '🏰', desc: 'Double your current Armor.', color: '#2980b9', action: (a, t, room) => { const amt = a.armor; addArmor(a, amt, room); } },
    'panic': { name: 'Panic Button', icon: '🚨', desc: 'If HP < 40, gain 40 Armor. Else, gain 12.', color: '#c0392b', action: (a, t, room) => { if (a.hp < 40) addArmor(a, 40, room); else addArmor(a, 12, room); } },
    'venom_bite': { name: 'Venom Bite', icon: '🐍', desc: 'Deal 10 DMG. If target has Poison, deal +15 DMG.', color: '#16a085', action: (a, t, room) => { if (t.poison > 0) attack(a, t, 25, room); else attack(a, t, 10, room); } },
    'meditate': { name: 'Meditate', icon: '🧘', desc: 'Heal 15 HP. Draw 1 card.', color: '#3498db', action: (a, t, room) => { heal(a, 15, room); drawCards(a, 1, room); } },
    'overclock': { name: 'Overclock', icon: '⚙️', desc: 'Lose 10 HP. Draw 3 cards.', color: '#d35400', action: (a, t, room) => { directDamage(a, 10, room); drawCards(a, 3, room); } }
};
const cardKeys = Object.keys(cards);

const rooms = {}; 

function getRandomHand(size = 5) {
    const hand = [];
    for(let i=0; i<size; i++) {
        hand.push(cardKeys[Math.floor(Math.random() * cardKeys.length)]);
    }
    return hand;
}

function checkGameOver(room) {
    if (room.p1.hp <= 0 && room.p2.hp <= 0) { room.gameOver = true; room.winner = "Draw"; }
    else if (room.p1.hp <= 0) { room.gameOver = true; room.winner = "Player 2"; }
    else if (room.p2.hp <= 0) { room.gameOver = true; room.winner = "Player 1"; }
}

function processTurnStart(entity, room) {
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
    
    const p2HandCount = room.p2 ? room.p2.hand.length : 0;
    const p1HandCount = room.p1 ? room.p1.hand.length : 0;
    
    const p1Rematch = room.rematchRequests ? !!room.rematchRequests[room.p1.id] : false;
    const p2Rematch = (room.p2 && room.rematchRequests) ? !!room.rematchRequests[room.p2.id] : false;

    // Send oppRematch so the client knows if the other player already clicked it
    io.to(room.p1.id).emit('game_state', { ...room, me: 'p1', opponent: 'p2', myHand: room.p1.hand, oppHandCount: p2HandCount, hasMulliganed: room.p1.hasMulliganed, myRematch: p1Rematch, oppRematch: p2Rematch });
    if(room.p2) {
        io.to(room.p2.id).emit('game_state', { ...room, me: 'p2', opponent: 'p1', myHand: room.p2.hand, oppHandCount: p1HandCount, hasMulliganed: room.p2.hasMulliganed, myRematch: p2Rematch, oppRematch: p1Rematch });
    }
}

io.on('connection', (socket) => {
    
    socket.on('create_room', () => {
        const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
        rooms[roomId] = {
            id: roomId,
            p1: { id: socket.id, name: "Player 1", hp: MAX_HP, armor: 0, poison: 0, regen: 0, weakness: 0, hand: getRandomHand(5), hasMulliganed: false },
            p2: null,
            turn: 'p1',
            logs: [{ text: "Room created. Waiting for opponent...", actor: "sys" }],
            gameOver: false,
            winner: null,
            rematchRequests: {}
        };
        socket.join(roomId);
        socket.emit('room_created', roomId);
        broadcastState(roomId);
    });

    socket.on('join_room', (roomId) => {
        roomId = roomId.toUpperCase();
        if (rooms[roomId] && !rooms[roomId].p2) {
            rooms[roomId].p2 = { id: socket.id, name: "Player 2", hp: MAX_HP, armor: 0, poison: 0, regen: 0, weakness: 0, hand: getRandomHand(5), hasMulliganed: false };
            socket.join(roomId);
            logAction("Player 2 joined! Game started.", rooms[roomId], 'sys');
            socket.emit('room_joined', roomId);
            broadcastState(roomId);
        } else {
            socket.emit('error_msg', "Room not found or already full.");
        }
    });

    socket.on('mulligan', (roomId) => {
        const room = rooms[roomId];
        if (!room || room.gameOver) return;

        const isP1 = room.p1.id === socket.id;
        const actorKey = isP1 ? 'p1' : 'p2';
        const actor = room[actorKey];

        if (room.turn !== actorKey) return;
        if (actor.hasMulliganed) return;

        actor.hand = getRandomHand(5);
        actor.hasMulliganed = true;
        
        logAction(`🔄 ${actor.name} discarded their hand and Mulliganed!`, room, actorKey);
        broadcastState(roomId);
    });
    
    socket.on('request_rematch', (roomId) => {
        const room = rooms[roomId];
        if (!room || !room.gameOver) return;

        room.rematchRequests = room.rematchRequests || {};
        room.rematchRequests[socket.id] = true;

        const isP1 = room.p1.id === socket.id;
        const actorName = isP1 ? room.p1.name : room.p2.name;
        logAction(`🔄 ${actorName} wants a rematch...`, room, 'sys');
        
        if (room.rematchRequests[room.p1.id] && room.rematchRequests[room.p2.id]) {
            room.p1 = { ...room.p1, hp: MAX_HP, armor: 0, poison: 0, regen: 0, weakness: 0, hand: getRandomHand(5), hasMulliganed: false };
            room.p2 = { ...room.p2, hp: MAX_HP, armor: 0, poison: 0, regen: 0, weakness: 0, hand: getRandomHand(5), hasMulliganed: false };
            room.turn = 'p1';
            room.gameOver = false;
            room.winner = null;
            room.rematchRequests = {};
            room.logs = [{ text: "Rematch started! Player 1 goes first.", actor: "sys" }];
        }
        
        broadcastState(roomId);
    });

    socket.on('play_card', (data) => {
        const { roomId, cardIndex } = data;
        const room = rooms[roomId];
        if (!room || room.gameOver) return;

        const isP1 = room.p1.id === socket.id;
        const actorKey = isP1 ? 'p1' : 'p2';
        const targetKey = isP1 ? 'p2' : 'p1';

        if (room.turn !== actorKey) return;

        const actor = room[actorKey];
        const target = room[targetKey];
        const cardId = actor.hand[cardIndex];
        const card = cards[cardId];

        actor.hand.splice(cardIndex, 1);
        logAction(`👉 ${actor.name} played [${card.name}]!`, room, actorKey);
        card.action(actor, target, room);
        checkGameOver(room);

        if (!room.gameOver) {
            drawCards(actor, 1, room);
            room.turn = targetKey;
            processTurnStart(target, room);
            checkGameOver(room);
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
    console.log(`Game server running on http://localhost:${PORT}`);
});