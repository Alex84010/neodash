const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// --- AUDIO & VOLUMES ---
const musicMenu = new Audio('menu.mp3');
const musicGame = new Audio('game.mp3');
musicMenu.loop = true; musicGame.loop = true;

let volMenu = parseFloat(localStorage.getItem('dash_vol_menu')) || 0.3;
let volGame = parseFloat(localStorage.getItem('dash_vol_game')) || 0.3;
musicMenu.volume = volMenu; musicGame.volume = volGame;

function playSFX(freq, type, duration, vol) {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type; osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
    gain.gain.setValueAtTime(vol * volGame, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + duration);
    osc.connect(gain); gain.connect(audioCtx.destination);
    osc.start(); osc.stop(audioCtx.currentTime + duration);
}

const sfx = {
    coin: () => playSFX(880, 'triangle', 0.3, 0.5),
    hit: () => playSFX(60, 'sawtooth', 0.8, 0.8),
    switch: () => playSFX(500, 'sine', 0.05, 0.2),
    win: () => playSFX(523, 'sine', 1, 0.6)
};

// --- DIFFICULTY CONFIG PER LEVEL ---
// Level 1 = easy (slow speed, rare obstacles, more coins)
// Level 10 = very hard (fast speed, dense obstacles, few coins)
const LEVEL_CONFIG = {
    1:  { speed: 4,    spawnDist: 280, coinChance: 0.4, obstaclePattern: 'sparse'  },
    2:  { speed: 4.5,  spawnDist: 260, coinChance: 0.35, obstaclePattern: 'sparse' },
    3:  { speed: 5,    spawnDist: 240, coinChance: 0.3,  obstaclePattern: 'normal' },
    4:  { speed: 5.5,  spawnDist: 220, coinChance: 0.28, obstaclePattern: 'normal' },
    5:  { speed: 6,    spawnDist: 200, coinChance: 0.25, obstaclePattern: 'normal' },
    6:  { speed: 6.8,  spawnDist: 185, coinChance: 0.2,  obstaclePattern: 'dense'  },
    7:  { speed: 7.5,  spawnDist: 170, coinChance: 0.18, obstaclePattern: 'dense'  },
    8:  { speed: 8.5,  spawnDist: 155, coinChance: 0.15, obstaclePattern: 'dense'  },
    9:  { speed: 9.5,  spawnDist: 140, coinChance: 0.12, obstaclePattern: 'brutal' },
    10: { speed: 11,   spawnDist: 120, coinChance: 0.08, obstaclePattern: 'brutal' },
};

// --- MAPS (10 NIVEAUX) ---
// Levels 1-3: shorter, more coins, gaps
// Levels 8-10: long, brutal, dense
const MAPS = {
    1:  "L...R...C...L.R...C...L...R...END",
    2:  "LL..RR..C..L.R.L.R..LL.RR..C..END",
    3:  "L.R.C.L.R.C.LL..RR..L.R.L.R.C.END",
    4:  "L..R..L..R..C..L..R..L..R..L..END",
    5:  "LL.RR.LL.RR.C.L.R.L.R.LL.RR.C.END",
    6:  "L.L.R.R.C.L.R.L.R.LL.RR.LL.RR.END",
    7:  "RRR.LLL.C.R.L.R.L.RR.LL.RR.LL.END",
    8:  "L..RR..L..RR..C..L..RR..L..RR.END",
    9:  "LLR.RRL.C.LLR.RRL.LL.RR.L.R.L.END",
    10: "LRL.RLR.C.LRL.RLR.LLRR.LLRR.C.END"
};

// Precompute total map length (non-END tokens) for progress bar
function getMapLength(level) {
    const map = MAPS[level];
    if (!map) return 1;
    const withoutEnd = map.replace(/END$/, '');
    return withoutEnd.length; // number of characters (tokens)
}

// --- DATA ---
let coins = parseInt(localStorage.getItem('dash_coins')) || 0;
let highScore = parseInt(localStorage.getItem('dash_high')) || 0;
let maxLevelReached = parseInt(localStorage.getItem('dash_maxlvl')) || 1;
let ownedSkins = JSON.parse(localStorage.getItem('dash_skins')) || ['#00f2ff'];
let activeSkin = localStorage.getItem('dash_current_skin') || '#00f2ff';
let startOnRight = localStorage.getItem('dash_start_side') === 'right';

// --- GAME VARS ---
let gameState = 'MENU', gameMode = 'INFINITE', currentLevel = 1;
let score = 0, speed = 7, playerX = 0, targetX = 0, isPressing = false, obstacles = [];
let levelIndex = 0;
let distanceSinceLastSpawn = 0;
let lastSpawnDist = 0;
let mapTotalLength = 1; // total tokens in current level map

function resize() {
    canvas.width = window.innerWidth > 450 ? 450 : window.innerWidth;
    canvas.height = window.innerHeight;
    if (gameState !== 'PLAYING') {
        playerX = startOnRight ? canvas.width / 4 * 3 : canvas.width / 4;
    }
}
window.addEventListener('resize', resize);
resize();
playerX = startOnRight ? canvas.width / 4 * 3 : canvas.width / 4;

// --- NAVIGATION ---
function toggleScreen(id, show) {
    if (id === 'level-select-menu' && show) renderLevelGrid();
    document.getElementById(id).style.display = show ? 'flex' : 'none';
}

function renderLevelGrid() {
    const grid = document.getElementById('level-grid'); grid.innerHTML = '';
    for (let i = 1; i <= 10; i++) {
        const item = document.createElement('div');
        const isUnlocked = i <= maxLevelReached;
        item.className = `level-item ${isUnlocked ? 'unlocked' : 'locked'}`;
        item.innerHTML = isUnlocked ? i : '🔒';
        if (isUnlocked && MAPS[i]) {
            item.onclick = () => { currentLevel = i; toggleScreen('level-select-menu', false); setupGame('LEVELS'); };
        }
        grid.appendChild(item);
    }
}

function setupGame(mode) {
    gameMode = mode; gameState = 'PLAYING';
    score = 0; levelIndex = 0; obstacles = [];
    distanceSinceLastSpawn = 0; lastSpawnDist = 0;

    if (mode === 'LEVELS') {
        const cfg = LEVEL_CONFIG[currentLevel] || LEVEL_CONFIG[1];
        speed = cfg.speed;
        mapTotalLength = getMapLength(currentLevel);
    } else {
        speed = 5; // infinite starts easy
        mapTotalLength = 1;
    }

    document.getElementById('main-menu').style.display = 'none';
    document.getElementById('lvl-tag').style.display = 'block';
    document.getElementById('lvl-tag').innerText = mode === 'LEVELS' ? `LVL ${currentLevel}` : "INFINI";
    document.getElementById('retry-action-btn').onclick = () => { toggleScreen('over-menu', false); setupGame(mode); };

    // Show/hide progress bar
    const progressWrap = document.getElementById('level-progress-wrap');
    if (mode === 'LEVELS') {
        progressWrap.style.display = 'flex';
    } else {
        progressWrap.style.display = 'none';
    }

    playerX = startOnRight ? canvas.width / 4 * 3 : canvas.width / 4;
    switchMusic(true);
}

// --- GAME LOGIC ---
function update() {
    if (gameState !== 'PLAYING') return;

    const left = canvas.width / 4;
    const right = canvas.width / 4 * 3;
    targetX = startOnRight ? (isPressing ? left : right) : (isPressing ? right : left);
    playerX += (targetX - playerX) * 0.2;

    if (gameMode === 'INFINITE') {
        score += 0.05;
        // Difficulty ramps up continuously: faster speed and more frequent spawns
        const scoreFactor = score / 60;
        speed = 5 + scoreFactor * 1.5;           // 5 → ~20 over time
        const spawnChance = Math.min(0.03 + scoreFactor * 0.015, 0.12); // ramps up
        const minDist = Math.max(60, 200 - scoreFactor * 25);           // gap shrinks

        lastSpawnDist += speed;
        if (Math.random() < spawnChance && lastSpawnDist > minDist) {
            // More coins early, more obstacles late
            const coinProb = Math.max(0.05, 0.35 - scoreFactor * 0.05);
            obstacles.push({
                x: Math.random() > 0.5 ? left : right,
                y: -50,
                type: Math.random() < coinProb ? 'coin' : 'obs'
            });
            lastSpawnDist = 0;
        }
    } else {
        const cfg = LEVEL_CONFIG[currentLevel] || LEVEL_CONFIG[1];
        distanceSinceLastSpawn += speed;
        if (distanceSinceLastSpawn >= cfg.spawnDist) {
            distanceSinceLastSpawn = 0;
            spawnFromMap();
        }
        score += 0.05;

        // Update progress bar
        const progress = Math.min(levelIndex / mapTotalLength, 1);
        document.getElementById('level-progress-bar').style.width = (progress * 100) + '%';
        document.getElementById('level-progress-pct').innerText = Math.floor(progress * 100) + '%';
    }

    const playerY = canvas.height - 150;

    for (let i = obstacles.length - 1; i >= 0; i--) {
        const o = obstacles[i];
        o.y += speed;

        if (o.type === 'finish' && o.y >= playerY - 30 && o.y <= playerY + 30) {
            winLevel(); return;
        }

        const d = Math.hypot(playerX - o.x, playerY - o.y);
        if (o.type !== 'finish') {
            if (o.type === 'coin' && d < 25) {
                coins++; sfx.coin(); obstacles.splice(i, 1);
            } else if (o.type === 'obs' && d < 35) {
                gameOver(); return;
            }
        }

        if (o.y > canvas.height + 100) obstacles.splice(i, 1);
    }

    document.getElementById('score').innerText = gameMode === 'INFINITE' ? Math.floor(score) : `LVL ${currentLevel}`;
    document.getElementById('coin-count').innerText = `💰 ${coins}`;
}

function spawnFromMap() {
    const map = MAPS[currentLevel];
    if (!map || levelIndex >= map.length) return;

    if (map.slice(levelIndex, levelIndex + 3) === 'END') {
        obstacles.push({ x: canvas.width / 2, y: -120, type: 'finish' });
        levelIndex += 3;
        return;
    }

    const char = map[levelIndex];
    const left = canvas.width / 4;
    const right = canvas.width / 4 * 3;
    const cfg = LEVEL_CONFIG[currentLevel] || LEVEL_CONFIG[1];

    if (char === 'L') obstacles.push({ x: left, y: -50, type: 'obs' });
    else if (char === 'R') obstacles.push({ x: right, y: -50, type: 'obs' });
    else if (char === 'C') {
        // Higher levels: coin might be replaced by an obstacle
        const isCoin = Math.random() < cfg.coinChance + 0.5; // still mostly coin on C
        obstacles.push({ x: Math.random() > 0.5 ? left : right, y: -50, type: isCoin ? 'coin' : 'obs' });
    }
    // '.' = gap

    levelIndex++;
}

function drawRoundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}

function gameLoop() {
    update();
    draw();
    requestAnimationFrame(gameLoop);
}

function draw() {
    ctx.fillStyle = 'rgba(5,5,5,0.4)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = 'rgba(0,242,255,0.1)'; ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(canvas.width / 4, 0); ctx.lineTo(canvas.width / 4, canvas.height);
    ctx.moveTo(canvas.width / 4 * 3, 0); ctx.lineTo(canvas.width / 4 * 3, canvas.height);
    ctx.stroke();

    obstacles.forEach(o => {
        if (o.type === 'finish') {
            for (let i = 0; i < 10; i++) {
                ctx.fillStyle = (i % 2 === 0) ? "#fff" : "#000";
                ctx.fillRect((canvas.width / 10) * i, o.y, canvas.width / 10, 30);
            }
        } else {
            ctx.shadowBlur = 15;
            ctx.fillStyle = o.type === 'coin' ? '#ffd700' : '#ff007b';
            ctx.shadowColor = ctx.fillStyle;
            ctx.beginPath();
            if (o.type === 'coin') {
                ctx.arc(o.x, o.y, 10, 0, Math.PI * 2);
            } else {
                drawRoundRect(o.x - 30, o.y - 12, 60, 24, 8);
            }
            ctx.fill();
        }
    });

    ctx.shadowBlur = 20; ctx.shadowColor = activeSkin; ctx.fillStyle = activeSkin;
    ctx.beginPath(); ctx.arc(playerX, canvas.height - 150, 16, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
}

// --- END OF GAME ---
function winLevel() {
    gameState = 'OVER'; sfx.win(); musicGame.pause();
    if (currentLevel === maxLevelReached && maxLevelReached < 10) maxLevelReached++;
    save();
    // Set progress to 100% on win
    document.getElementById('level-progress-bar').style.width = '100%';
    document.getElementById('level-progress-pct').innerText = '100%';
    document.getElementById('over-msg').innerText = "NIVEAU RÉUSSI !";
    document.getElementById('final-score').innerText = `LVL ${currentLevel} ✓`;
    toggleScreen('over-menu', true);
}

function gameOver() {
    gameState = 'OVER'; sfx.hit(); musicGame.pause();
    document.getElementById('level-progress-wrap').style.display = 'none';
    if (gameMode === 'INFINITE' && score > highScore) highScore = Math.floor(score);
    save();
    document.getElementById('over-msg').innerText = "DÉTRUIT";
    document.getElementById('final-score').innerText = gameMode === 'INFINITE' ? Math.floor(score) : "ÉCHEC";
    toggleScreen('over-menu', true);
}

function save() {
    localStorage.setItem('dash_coins', coins);
    localStorage.setItem('dash_maxlvl', maxLevelReached);
    localStorage.setItem('dash_high', highScore);
    localStorage.setItem('dash_skins', JSON.stringify(ownedSkins));
    localStorage.setItem('dash_current_skin', activeSkin);
}

function switchMusic(toGame) {
    musicMenu.pause(); musicGame.pause();
    if (toGame) { musicGame.currentTime = 0; musicGame.play().catch(() => {}); }
    else musicMenu.play().catch(() => {});
}

function goToHome() {
    toggleScreen('over-menu', false);
    toggleScreen('main-menu', true);
    document.getElementById('level-progress-wrap').style.display = 'none';
    gameState = 'MENU';
    switchMusic(false);
}

// --- SHOP & RECORDS ---
const skins = [
    { n: "CYAN", c: "#00f2ff", p: 0 },
    { n: "ROSE", c: "#ff007b", p: 20 },
    { n: "GOLD", c: "#ffd700", p: 50 },
    { n: "WHITE", c: "#ffffff", p: 100 },
    { n: "VERT", c: "#39ff14", p: 150 }
];

function renderShop() {
    const list = document.getElementById('skin-list'); list.innerHTML = '';
    skins.forEach(s => {
        const div = document.createElement('div'); div.className = 'skin-item';
        div.style.borderColor = activeSkin === s.c ? 'white' : '#333';
        div.innerHTML = `${s.n}<br>${ownedSkins.includes(s.c) ? 'EQUIP' : s.p + '💰'}`;
        div.onclick = () => {
            if (ownedSkins.includes(s.c)) activeSkin = s.c;
            else if (coins >= s.p) { coins -= s.p; ownedSkins.push(s.c); activeSkin = s.c; sfx.coin(); }
            save(); renderShop();
        };
        list.appendChild(div);
    });
}

function showRecords() {
    document.getElementById('high-score').innerText = highScore;
    document.getElementById('total-coins-rec').innerText = coins;
    document.getElementById('max-level').innerText = maxLevelReached;
    toggleScreen('records-menu', true);
}

// --- AUDIO SLIDERS ---
document.getElementById('vol-menu-slider').oninput = (e) => {
    volMenu = e.target.value / 100; musicMenu.volume = volMenu;
    localStorage.setItem('dash_vol_menu', volMenu);
};
document.getElementById('vol-game-slider').oninput = (e) => {
    volGame = e.target.value / 100; musicGame.volume = volGame;
    localStorage.setItem('dash_vol_game', volGame);
};
document.getElementById('vol-menu-slider').value = volMenu * 100;
document.getElementById('vol-game-slider').value = volGame * 100;

const startSideSelect = document.getElementById('start-side');
startSideSelect.value = startOnRight ? 'right' : 'left';
startSideSelect.onchange = (e) => {
    startOnRight = e.target.value === 'right';
    localStorage.setItem('dash_start_side', e.target.value);
};

// --- INPUTS ---
window.addEventListener('touchstart', (e) => {
    if (gameState === 'MENU' && musicMenu.paused) musicMenu.play().catch(() => {});
    if (gameState === 'PLAYING') { e.preventDefault(); isPressing = true; sfx.switch(); }
}, { passive: false });
window.addEventListener('touchend', () => isPressing = false);
window.addEventListener('mousedown', () => { if (gameState === 'PLAYING') { isPressing = true; sfx.switch(); } });
window.addEventListener('mouseup', () => isPressing = false);

requestAnimationFrame(gameLoop);
    
