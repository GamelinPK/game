const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

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
            if (player.discard.length === 0) break;
            player.deck = shuffle([...player.discard]);
            player.discard = [];
            logAction(`♻️ ${player.name} triggered a deck shuffle!`, room, player.id);
        }
        player.hand.push(player.deck.pop());
        drawn++;
    }
    if (drawn > 0) logAction(`🃏 ${player.name} drew ${drawn} card(s).`, room, player.id);
}

function logAction(msg, room, actorId = 'sys') {
    room.logs.push({ text: msg, actor: actorId });
    if (room.logs.length > 12) room.logs.shift(); // Increased log size slightly for the chaos
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

// THE STUPIDLY OVERPOWERED CARD DATABASE
const cards = {
    // ---- UPGRADED NATION CARDS ----
    'god_barony': { id: 'god_barony', name: "God-Emperor's Barony", type: 'nation', cost: 10, desc: '+5 Cards, +5 Actions. (90% chance to yield Cursed Wasteland)', action: (p, room) => { p.actions += 5; drawCards(p, 5, room); } },
    'cursed_wasteland': { id: 'cursed_wasteland', name: 'Cursed Wasteland', type: 'nation', cost: 5, prestige: -10, desc: '+10 Cards, -10 Prestige. The greed consumes you.', action: (p, room) => { p.actions += 1; drawCards(p, 10, room); } },
    'quantum_county': { id: 'quantum_county', name: 'Quantum County', type: 'nation', cost: 15, desc: '+3 Cards, +3 Acts. 50% chance for +5 Cards, else +5 Acts.', action: (p, room) => { 
        p.actions += 3; drawCards(p, 3, room); 
        if(Math.random() < 0.5) { drawCards(p, 5, room); logAction(`🎲 Quantum Shift: +5 Cards!`, room, p.id); } 
        else { p.actions += 5; logAction(`🎲 Quantum Shift: +5 Actions!`, room, p.id); } 
    }},
    'megalopolis': { id: 'megalopolis', name: 'Megalopolis', type: 'nation', cost: 20, desc: '+5 Cards, +5 Actions, +15 Money', action: (p, room) => { p.actions += 5; p.money += 15; drawCards(p, 5, room); } },
    'galactic_armada': { id: 'galactic_armada', name: 'Galactic Armada', type: 'nation', cost: 18, desc: 'Steal up to 3 random Nation Cards from opponent.', action: (p, room) => { 
        const target = p.id === room.p1.id ? room.p2 : room.p1;
        let stolen = 0;
        for(let i=0; i<3; i++) {
            const allOppCards = [...target.deck, ...target.hand, ...target.discard, ...target.played];
            const nationCards = allOppCards.filter(c => cards[c].type === 'nation');
            if (nationCards.length > 0) {
                const stolenId = nationCards[Math.floor(Math.random() * nationCards.length)];
                const removeCard = (arr, id) => { const idx = arr.indexOf(id); if(idx !== -1) { arr.splice(idx, 1); return true; } return false; };
                if (!removeCard(target.hand, stolenId)) if (!removeCard(target.deck, stolenId)) if (!removeCard(target.discard, stolenId)) removeCard(target.played, stolenId);
                p.discard.push(stolenId);
                stolen++;
            }
        }
        logAction(`🛸 Galactic Armada stole ${stolen} cards from ${target.name}!`, room, p.id);
    }},
    'orbital_strike': { id: 'orbital_strike', name: 'Orbital Strike', type: 'nation', cost: 15, desc: 'Opponent discards entire hand, draws 3. +20 Money.', action: (p, room) => { 
        p.money += 20;
        const target = p.id === room.p1.id ? room.p2 : room.p1;
        target.discard.push(...target.hand);
        target.hand = [];
        drawCards(target, 3, room);
        logAction(`💥 ORBITAL STRIKE! ${target.name}'s hand was vaporized!`, room, p.id);
    }},
    'universe_core': { id: 'universe_core', name: 'The Universe Core', type: 'nation', cost: 35, prestige: 10, desc: '+10 Cards, +10 Acts, +30 Money, +5 Buys.', action: (p, room) => { p.actions += 10; p.money += 30; p.buys += 5; drawCards(p, 10, room); } },
    'supreme_commander': { id: 'supreme_commander', name: 'Supreme Cmdr.', type: 'nation', cost: 12, desc: 'Discard selected cards. Draw DOUBLE that amount. +5 Acts.', action: (p, room) => {} }, 
    'guillotine': { id: 'guillotine', name: 'Guillotine', type: 'nation', cost: 15, desc: 'Trash selected cards. For each, +3 Acts & +3 Cards.', action: (p, room) => {} }, 

    // ---- BRAND NEW CRAZY CARDS ----
    'time_machine': { id: 'time_machine', name: 'Time Machine', type: 'nation', cost: 25, desc: '+10 Actions. Move your entire discard pile into your hand.', action: (p, room) => { p.actions += 10; p.hand.push(...p.discard); p.discard = []; logAction(`⏳ ${p.name} reversed time!`, room, p.id); } },
    'tax_fraud': { id: 'tax_fraud', name: 'Tax Fraud', type: 'nation', cost: 5, prestige: -15, desc: '+60 Money. -15 Prestige. The IRS is watching.', action: (p, room) => { p.money += 60; p.actions += 1; } },
    'clone_vat': { id: 'clone_vat', name: 'Clone Vat', type: 'nation', cost: 30, desc: '+1 Action. Gain 3 copies of The Universe Core.', action: (p, room) => { p.actions += 1; p.discard.push('universe_core', 'universe_core', 'universe_core'); logAction(`🧬 ${p.name} cloned 3 Universe Cores!`, room, p.id); } },
    'black_hole': { id: 'black_hole', name: 'Black Hole', type: 'nation', cost: 22, desc: 'Trash your hand. Opponent trashes their hand. +100 Money.', action: (p, room) => { 
        p.hand = []; 
        const target = p.id === room.p1.id ? room.p2 : room.p1;
        target.hand = [];
        p.money += 100;
        logAction(`🌌 A Black Hole consumed both players' hands!`, room, p.id);
    }},
    'propaganda': { id: 'propaganda', name: 'Propaganda', type: 'nation', cost: 12, prestige: 30, desc: '30 Prestige. Opponent draws 5 cards. +1 Action.', action: (p, room) => { p.actions += 1; const target = p.id === room.p1.id ? room.p2 : room.p1; drawCards(target, 5, room); } },
    'lootbox': { id: 'lootbox', name: 'Lootbox', type: 'nation', cost: 2, desc: '+1 Act. 10% chance to gain Holy Grail. 90% chance: 3 Cursed Wastelands.', action: (p, room) => { 
        p.actions += 1; 
        if(Math.random() < 0.1) { p.discard.push('holy_grail'); logAction(`🎰 JACKPOT! ${p.name} pulled a Holy Grail!`, room, p.id); }
        else { p.discard.push('cursed_wasteland', 'cursed_wasteland', 'cursed_wasteland'); logAction(`📦 ${p.name} got scammed by a lootbox.`, room, p.id); }
    }},
    'philanthropist': { id: 'philanthropist', name: 'Philanthropist', type: 'nation', cost: 0, desc: 'Opponent gains 20 Money. You gain +5 Cards, +5 Acts, +5 Buys.', action: (p, room) => { 
        p.actions += 5; p.buys += 5; drawCards(p, 5, room); 
        const target = p.id === room.p1.id ? room.p2 : room.p1;
        target.money += 20;
    }},
    'cult_leader': { id: 'cult_leader', name: 'Cult Leader', type: 'nation', cost: 18, desc: '+1 Card, +1 Act. Gain +2 Money for EVERY card in your discard pile.', action: (p, room) => { p.actions += 1; drawCards(p, 1, room); p.money += (p.discard.length * 2); logAction(`🐑 The cult generates ${p.discard.length * 2} money!`, room, p.id); } },

    // ---- MONEY CARDS ----
    'bitcoin': { id: 'bitcoin', name: 'Bitcoin', type: 'money', cost: 0, desc: '+5 Money', action: (p, room) => { p.money += 5; } },
    'blank_check': { id: 'blank_check', name: 'Blank Check', type: 'money', cost: 10, desc: '+20 Money', action: (p, room) => { p.money += 20; } },
    'infinity_stone': { id: 'infinity_stone', name: 'Infinity Stone', type: 'money', cost: 30, desc: '+100 Money', action: (p, room) => { p.money += 100; } },
    'printer_go_brrr': { id: 'printer_go_brrr', name: 'Printer Go Brrr', type: 'money', cost: 50, desc: '+250 Money, +10 Buys.', action: (p, room) => { p.money += 250; p.buys += 10; } },
    
    // ---- PRESTIGE CARDS ----
    'jedi_knight': { id: 'jedi_knight', name: 'Jedi Knight', type: 'prestige', cost: 15, prestige: 20, desc: '20 Prestige Points', action: (p, room) => {} },
    'dragon_rider': { id: 'dragon_rider', name: 'Dragon Rider', type: 'prestige', cost: 30, prestige: 60, desc: '60 Prestige Points', action: (p, room) => {} },
    'deity': { id: 'deity', name: 'Deity', type: 'prestige', cost: 50, prestige: 150, desc: '150 Prestige Points', action: (p, room) => {} },
    'holy_grail': { id: 'holy_grail', name: 'Holy Grail', type: 'prestige', cost: 150, prestige: 1000, desc: '1000 Prestige Points. Instant Win Condition.', action: (p, room) => {} }
};

const initialSupply = { 
    bitcoin: 40, blank_check: 40, infinity_stone: 40, printer_go_brrr: 40,
    jedi_knight: 10, dragon_rider: 10, deity: 10, holy_grail: 10,
    god_barony: 10, quantum_county: 10, megalopolis: 10, galactic_armada: 10, raid: 10, universe_core: 10, supreme_commander: 10, guillotine: 10,
    time_machine: 10, tax_fraud: 10, clone_vat: 10, black_hole: 10, propaganda: 10, lootbox: 10, philanthropist: 10, cult_leader: 10
};
const rooms = {}; 

function createPlayer(id, name) {
    return {
        id, name,
        deck: shuffle(['jedi_knight', 'jedi_knight', 'jedi_knight', 'bitcoin', 'bitcoin', 'bitcoin', 'bitcoin', 'bitcoin', 'bitcoin', 'bitcoin']),
        hand: [], discard: [], played: [],
        actions: 1, money: 0, buys: 1
    };
}

function broadcastState(roomId) {
    const room = rooms[roomId];
    if(!room) return;
    
    const p1State = { ...room.p1, deckCount: room.p1.deck.length, discardCount: room.p1.discard.length, prestige: getPrestige(room.p1) };
    const p2State = room.p2 ? { ...room.p2, deckCount: room.p2.deck.length, discardCount: room.p2.discard.length, prestige: getPrestige(room.p2) } : null;

    if (room.p1.id) {
        io.to(room.p1.id).emit('game_state', {
            id: room.id, turn: room.turn, phase: room.phase, supply: room.supply, logs: room.logs, gameOver: room.gameOver, winner: room.winner, myKey: 'p1',
            me: p1State,
            opponent: p2State ? { name: p2State.name, deckCount: p2State.deckCount, discardCount: p2State.discardCount, handCount: p2State.hand.length, played: p2State.played, prestige: p2State.prestige } : null
        });
    }
    if (room.p2 && room.p2.id) {
        io.to(room.p2.id).emit('game_state', {
            id: room.id, turn: room.turn, phase: room.phase, supply: room.supply, logs: room.logs, gameOver: room.gameOver, winner: room.winner, myKey: 'p2',
            me: p2State,
            opponent: { name: p1State.name, deckCount: p1State.deckCount, discardCount: p1State.discardCount, handCount: p1State.hand.length, played: p1State.played, prestige: p1State.prestige }
        });
    }
}

io.on('connection', (socket) => {
    
    socket.on('create_room', () => {
        const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
        rooms[roomId] = { id: roomId, p1: createPlayer(socket.id, "Player 1"), p2: null, turn: 'p1', phase: 'action', supply: { ...initialSupply }, logs: [{ text: "Room created. Waiting for opponent...", actor: "sys" }], gameOver: false, winner: null };
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

        if (room.phase === 'action') {
            if (card.type !== 'nation') return; 
            if (actor.actions <= 0) return;
            actor.actions -= 1;
        } else if (room.phase === 'buy') {
            if (card.type !== 'money') return; 
        } else return;

        actor.hand.splice(cardIndex, 1);
        actor.played.push(cardId);
        logAction(`👉 ${actor.name} played [${card.name}]`, room, actorKey);
        card.action(actor, room);
        broadcastState(roomId);
    });
    
    socket.on('play_complex_card', (data) => {
        const { roomId, cardIndex, selectedIndices } = data;
        const room = rooms[roomId];
        if (!room || room.gameOver) return;

        const isP1 = room.p1.id === socket.id;
        const actorKey = isP1 ? 'p1' : 'p2';
        const actor = room[actorKey];

        if (room.turn !== actorKey || room.phase !== 'action') return;
        
        const cardId = actor.hand[cardIndex];
        if(cards[cardId].type !== 'nation' || actor.actions <= 0) return;

        actor.actions -= 1;
        actor.hand.splice(cardIndex, 1);
        actor.played.push(cardId);

        let adjusted = selectedIndices.map(i => i > cardIndex ? i - 1 : i).sort((a, b) => b - a);
        let removedCards = [];
        
        for(let i of adjusted) {
            if(i >= 0 && i < actor.hand.length) {
                removedCards.push(actor.hand.splice(i, 1)[0]);
            }
        }

        if(cardId === 'supreme_commander') {
            actor.actions += 5;
            actor.discard.push(...removedCards);
            drawCards(actor, removedCards.length * 2, room);
            logAction(`🎖️ ${actor.name} executed Supreme Cmdr, discarded ${removedCards.length} and drew ${removedCards.length * 2}!`, room, actorKey);
        } else if(cardId === 'guillotine') {
            actor.actions += (removedCards.length * 3);
            drawCards(actor, removedCards.length * 3, room);
            logAction(`🪓 ${actor.name} used the Guillotine on ${removedCards.length} cards. Gained insane stats!`, room, actorKey);
        }

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
            logAction(`💰 ${actor.name} cashed in all their money!`, room, actorKey);
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
        
        actor.money -= card.cost;
        actor.buys -= 1;
        room.supply[cardId] -= 1;
        
        if (cardId === 'god_barony' && Math.random() < 0.9) {
            actor.discard.push('cursed_wasteland');
            logAction(`🛒 ${actor.name} bought a Barony, but inherited a [Cursed Wasteland] instead!`, room, actorKey);
        } else {
            actor.discard.push(cardId);
            logAction(`🛒 ${actor.name} bought a [${card.name}]!`, room, actorKey);
        }
        
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
server.listen(PORT, () => { console.log(`Kingdom Builder server running on http://localhost:${PORT}`); });