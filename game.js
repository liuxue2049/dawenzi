// 游戏状态
// 游戏循环定时器引用（用于暂停/恢复）
let mosquitoMoveInterval = null;
let mosquitoHealInterval = null;
let mosquitoAttackInterval = null;
let mosquitoCloneTimeout = null;

const gameState = {
    power: 50,
    maxPower: 50,
    energy: 100,
    maxEnergy: 100,
    isCharging: false,
    activeButton: null,
    mosquitoes: [],
    cannonAngle: -90,
    playerHealth: 100,
    maxPlayerHealth: 100,
    level: 1,
    score: 0,
    highScore: parseInt(localStorage.getItem('highScore')) || 0,
    powerTimer: null,
    healthTimer: null,
    energyTimer: null,
    gameOverReason: null,
    activeReward: null,     // 当前激活的奖励 { type, params }
    shieldActive: false,    // 防御罩是否激活
    shieldPower: 0,         // 防御罩减伤比例 (0-1)
    gamePaused: false,      // 游戏是否暂停（水晶球倒计时期间）
    winProcessed: false     // 防重复胜利处理（多个子弹同时击杀最后蚊子）
};

// 图片预加载函数
function preloadImages(imageUrls) {
    return new Promise((resolve, reject) => {
        if (!imageUrls || imageUrls.length === 0) {
            resolve();
            return;
        }
        
        let loadedCount = 0;
        const totalCount = imageUrls.length;
        
        imageUrls.forEach(url => {
            const img = new Image();
            img.onload = () => {
                loadedCount++;
                if (loadedCount === totalCount) {
                    resolve();
                }
            };
            img.onerror = () => {
                console.warn(`Failed to load image: ${url}`);
                loadedCount++;
                if (loadedCount === totalCount) {
                    resolve();
                }
            };
            img.src = url;
        });
    });
}

// 加载指定轮次的图片
function loadLevelImages(level) {
    const images = [];
    
    // 背景图片
    images.push(`background${level}.jpg`);
    
    // 蚊子图片
    for (let i = 1; i <= 5; i++) {
        images.push(`wenzi${i}.png`);
    }
    
    return preloadImages(images);
}

// 精灵表动画配置
const SPRITE_CONFIG = {
    1: { file: 'wenzi1_spritesheet.png', fw: 64, fh: 64, cols: 8, total: 60, fps: 12 },
    2: { file: 'wenzi2_spritesheet.png', fw: 64, fh: 64, cols: 8, total: 60, fps: 12 },
    3: { file: 'wenzi3_spritesheet.png', fw: 64, fh: 114, cols: 8, total: 60, fps: 12 },
    4: { file: 'wenzi4_spritesheet.png', fw: 64, fh: 114, cols: 8, total: 60, fps: 12 },
    5: { file: 'wenzi5_spritesheet.png', fw: 64, fh: 114, cols: 8, total: 60, fps: 12 },
};

// 预加载精灵表
const spriteImages = {};
function preloadSprites() {
    const promises = Object.values(SPRITE_CONFIG).map(cfg => {
        return new Promise(resolve => {
            const img = new Image();
            img.onload = () => { spriteImages[cfg.file] = img; resolve(); };
            img.onerror = () => resolve();
            img.src = cfg.file;
        });
    });
    return Promise.all(promises);
}

// 蚊子分数配置
const mosquitoScores = {
    1: 20,
    2: 50,
    3: 40,
    4: 10,
    5: 10
};

// 关卡奖励配置
const REWARD_CONFIG = {
    2:  { text: '追踪弹',         type: 'homing' },
    3:  { text: '散弹 3 颗',      type: 'spread', count: 3, rows: 1 },
    4:  { text: '散弹 5 颗',      type: 'spread', count: 5, rows: 1 },
    5:  { text: '散弹 7 颗',      type: 'spread', count: 7, rows: 1 },
    6:  { text: '自动防御罩',      type: 'shield', power: 0.3 },
    7:  { text: '散弹双层 上5下3', type: 'spread', count: 5, rows: 2, row2Count: 3 },
    8:  { text: '散弹双层 上7下5', type: 'spread', count: 7, rows: 2, row2Count: 5 },
    9:  { text: '散弹三层 上7中5下3', type: 'spread', count: 7, rows: 3, row2Count: 5, row3Count: 3 },
    10: { text: '防御罩 +50%',     type: 'shield', power: 0.5 },
};

function applyReward(level) {
    if (level <= 1) return null;
    if (level >= 11) {
        // 11关及以上只有分数奖励
        gameState.activeReward = null;
        gameState.shieldActive = false;
        gameState.shieldPower = 0;
        return { text: `分数奖励 +${100 + level * 10}`, score: 100 + level * 10 };
    }
    const cfg = REWARD_CONFIG[level];
    if (!cfg) return null;
    const reward = { text: cfg.text, score: 50 + level * 10 };
    if (cfg.type === 'spread') {
        gameState.activeReward = {
            type: 'spread',
            count: cfg.count,
            rows: cfg.rows || 1,
            row2Count: cfg.row2Count || 0,
            row3Count: cfg.row3Count || 0
        };
        gameState.shieldActive = false;
        gameState.shieldPower = 0;
    } else if (cfg.type === 'shield') {
        gameState.activeReward = null;
        gameState.shieldActive = true;
        gameState.shieldPower = cfg.power;
    } else if (cfg.type === 'homing') {
        gameState.activeReward = { type: 'homing' };
        gameState.shieldActive = false;
        gameState.shieldPower = 0;
    }
    return reward;
}

// DOM 元素
const powerFill = document.getElementById('powerFill');
const energyFill = document.getElementById('energyFill');
const playerHealthFill = document.getElementById('playerHealthFill');
const levelValue = document.getElementById('levelValue');
const scoreValue = document.getElementById('scoreValue');
const highScoreValue = document.getElementById('highScoreValue');
const radar = document.getElementById('radar');
const btnRed = document.getElementById('btnRed');
const btnGreen = document.getElementById('btnGreen');
const btnLeft = document.getElementById('btnLeft');
const btnRight = document.getElementById('btnRight');
const gameArea = document.getElementById('gameArea');
const cannonBarrel = document.getElementById('cannonBarrel');
const gameOverModal = document.getElementById('gameOverModal');
const restartBtn = document.getElementById('restartBtn');
const loadingModal = document.getElementById('loadingModal');
const zapperSound = document.getElementById('zapperSound');
const meizidanSound = document.getElementById('meizidanSound');
const bgmSound = document.getElementById('bgmSound');
const trailSvg = document.getElementById('trailSvg');

// 开始电力自动增长
function startPowerCharging() {
    if (gameState.powerTimer) {
        clearInterval(gameState.powerTimer);
    }
    
    gameState.powerTimer = setInterval(() => {
        if (gameState.gamePaused) return;
        if (gameState.power < gameState.maxPower) {
            const chargeAmount = gameState.maxPower * 0.05;
            gameState.power = Math.min(gameState.power + chargeAmount, gameState.maxPower);
            updatePowerBar();
        }
    }, 1000);
}

// 开始能量自动恢复
function startEnergyCharging() {
    if (gameState.energyTimer) {
        clearInterval(gameState.energyTimer);
    }
    
    gameState.energyTimer = setInterval(() => {
        if (gameState.gamePaused) return;
        if (gameState.energy < gameState.maxEnergy) {
            gameState.energy = Math.min(gameState.energy + 2, gameState.maxEnergy);
            updateEnergyBar();
        }
    }, 1000);
}

// 激活激光瞄准线
function activateLaser() {
    return; // 激光已禁用
    // 如果激光已经激活，不重复激活
    if (laserActive) {
        return;
    }
    
    laserActive = true;
    laserStartTime = Date.now();
    
    // 创建激光瞄准线元素
    if (!laserLine || !laserLine.parentNode) {
        // 如果激光线元素不存在或不在DOM中，重新创建
        laserLine = document.createElement('div');
        laserLine.className = 'laser-line';
        laserLine.style.position = 'absolute';
        laserLine.style.height = '2px';
        laserLine.style.backgroundColor = '#4CAF50';
        laserLine.style.zIndex = '999';
        laserLine.style.pointerEvents = 'none';
        laserLine.style.boxShadow = '0 0 10px #4CAF50, 0 0 20px #4CAF50';
        gameArea.appendChild(laserLine);
    } else {
        laserLine.style.display = 'block';
    }
    
    // 开始激光更新
    updateLaser();
    
    // 立即消灭路径上的所有蚊子
    const cannonRect = cannonBarrel.getBoundingClientRect();
    const gameAreaRect = gameArea.getBoundingClientRect();
    
    const cannonX = (cannonRect.left + cannonRect.right) / 2 - gameAreaRect.left;
    const cannonY = (cannonRect.top + cannonRect.bottom) / 2 - gameAreaRect.top;
    
    const angleRad = gameState.cannonAngle * Math.PI / 180;
    const endX = cannonX + Math.cos(angleRad) * 10000;
    const endY = cannonY + Math.sin(angleRad) * 10000;
    
    const mosquitoesToRemove = [];
    
    gameState.mosquitoes.forEach(mosquito => {
        if (mosquito.element && mosquito.element.style.opacity !== '0') {
            const mosquitoRect = mosquito.element.getBoundingClientRect();
            const mosquitoX = (mosquitoRect.left + mosquitoRect.right) / 2 - gameAreaRect.left;
            const mosquitoY = (mosquitoRect.top + mosquitoRect.bottom) / 2 - gameAreaRect.top;
            
            const distance = pointToLineDistance(mosquitoX, mosquitoY, cannonX, cannonY, endX, endY);
            
            if (distance < 20) {
                gameState.score += 10;
                updateScore();
                
                mosquito.element.style.animation = 'disappear 0.5s forwards';
                mosquitoesToRemove.push(mosquito.id);
            }
        }
    });
    
    mosquitoesToRemove.forEach(id => {
        const mosquito = gameState.mosquitoes.find(m => m.id === id);
        if (mosquito && mosquito.element) {
            setTimeout(() => {
                mosquito.element.remove();
                gameState.mosquitoes = gameState.mosquitoes.filter(m => m.id !== id);
                
                if (gameState.mosquitoes.length === 0) {
                    gameState.level++;
                    showReadyModal();
                }
            }, 500);
        }
    });
    
    // 0.2秒后关闭激光
    setTimeout(() => {
        deactivateLaser();
    }, 200);
}

// 关闭激光瞄准线
function deactivateLaser() {
    laserActive = false;
    if (laserLine) {
        laserLine.style.display = 'none';
    }
    
    // 恢复所有蚊子的颜色
    gameState.mosquitoes.forEach(mosquito => {
        if (mosquito.element) {
            mosquito.element.style.filter = '';
        }
    });
}

// 更新激光瞄准线
function updateLaser() {
    if (!laserActive || !laserLine || !cannonBarrel) {
        return;
    }
    
    // 获取炮筒位置
    const cannonRect = cannonBarrel.getBoundingClientRect();
    const gameAreaRect = gameArea.getBoundingClientRect();
    
    // 计算炮筒中心点
    const cannonX = (cannonRect.left + cannonRect.right) / 2 - gameAreaRect.left;
    const cannonY = (cannonRect.top + cannonRect.bottom) / 2 - gameAreaRect.top;
    
    // 计算激光方向（根据炮筒角度）
    const angleRad = gameState.cannonAngle * Math.PI / 180;
    
    // 计算激光终点（直接延伸到很远的地方，不被蚊子截断）
    const endX = cannonX + Math.cos(angleRad) * 10000;
    const endY = cannonY + Math.sin(angleRad) * 10000;
    
    // 计算激光线的长度和角度
    const length = Math.sqrt(Math.pow(endX - cannonX, 2) + Math.pow(endY - cannonY, 2));
    const lineAngle = Math.atan2(endY - cannonY, endX - cannonX) * 180 / Math.PI;
    
    // 设置激光线样式
    laserLine.style.left = cannonX + 'px';
    laserLine.style.top = cannonY + 'px';
    laserLine.style.width = length + 'px';
    laserLine.style.transformOrigin = '0 0';
    laserLine.style.transform = `rotate(${lineAngle}deg)`;
    
    // 恢复所有蚊子的颜色
    gameState.mosquitoes.forEach(mosquito => {
        if (mosquito.element) {
            mosquito.element.style.filter = '';
        }
    });
    
    // 给所有在激光线上的蚊子发绿光
    gameState.mosquitoes.forEach(mosquito => {
        if (mosquito.element && mosquito.element.style.opacity !== '0') {
            const mosquitoRect = mosquito.element.getBoundingClientRect();
            const mosquitoX = (mosquitoRect.left + mosquitoRect.right) / 2 - gameAreaRect.left;
            const mosquitoY = (mosquitoRect.top + mosquitoRect.bottom) / 2 - gameAreaRect.top;
            
            const distance = pointToLineDistance(mosquitoX, mosquitoY, cannonX, cannonY, endX, endY);
            
            if (distance < 20) {
                mosquito.element.style.filter = 'brightness(1.5) drop-shadow(0 0 10px #4CAF50)';
            }
        }
    });
    
    // 继续更新激光
    if (laserActive) {
        requestAnimationFrame(updateLaser);
    }
}

// 计算点到线段的距离
function pointToLineDistance(px, py, x1, y1, x2, y2) {
    const A = px - x1;
    const B = py - y1;
    const C = x2 - x1;
    const D = y2 - y1;
    
    const dot = A * C + B * D;
    const lenSq = C * C + D * D;
    let param = -1;
    
    if (lenSq !== 0) {
        param = dot / lenSq;
    }
    
    let xx, yy;
    
    if (param < 0) {
        xx = x1;
        yy = y1;
    } else if (param > 1) {
        xx = x2;
        yy = y2;
    } else {
        xx = x1 + param * C;
        yy = y1 + param * D;
    }
    
    const dx = px - xx;
    const dy = py - yy;
    return Math.sqrt(dx * dx + dy * dy);
}

// 初始化
async function init() {
    console.log('Game init started');
    
    // 显示加载界面
    if (loadingModal) {
        loadingModal.style.display = 'flex';
    }
    
    try {
        // 预加载当前轮次的图片
        await loadLevelImages(gameState.level);
        // 预加载精灵表动画
        await preloadSprites();
        console.log('Images loaded successfully');
    } catch (error) {
        console.warn('Error loading images:', error);
    } finally {
        // 隐藏加载界面
        if (loadingModal) {
            loadingModal.style.display = 'none';
        }
    }
    
    initCanvas();
    updateBackground();
    updatePowerBar();
    updateEnergyBar();
    updatePlayerHealth();
    updateLevel();
    updateScore();
    // 移除这里的 spawnMosquitoes() 和 startMosquitoMovement() 调用
    // 这些应该在用户点击开始后才调用
    startEnergyCharging();
    bindEvents();
    initBGM();
    
    // 调用 restartGame 来确保游戏状态与重新开始后的状态一致
    await restartGame();
    
    console.log('Game init completed');
}

// 更新玩家血条
function updatePlayerHealth() {
    if (playerHealthFill) {
        playerHealthFill.style.width = (gameState.playerHealth / gameState.maxPlayerHealth * 100) + '%';
    }
}

// 更新等级显示
function updateLevel() {
    if (levelValue) {
        levelValue.textContent = gameState.level;
    }
}

// 更新背景图片
function updateBackground() {
    const gameArea = document.getElementById('gameArea');
    if (gameArea) {
        // 当轮如果没有背景图片，就默认用第一轮的
        let bgImage = `background${gameState.level}.jpg`;
        
        // 创建临时图片对象来检测文件是否存在
        const img = new Image();
        img.onload = function() {
            // 图片存在，使用当前轮次的背景
            gameArea.style.backgroundImage = `url('${bgImage}')`;
        };
        img.onerror = function() {
            // 图片不存在，使用第一轮的背景
            bgImage = 'background1.jpg';
            gameArea.style.backgroundImage = `url('${bgImage}')`;
        };
        img.src = bgImage;
    }
}

// 更新分数显示
function updateScore() {
    if (scoreValue) {
        scoreValue.textContent = gameState.score;
    }
    if (highScoreValue) {
        highScoreValue.textContent = gameState.highScore;
    }
}

// 添加分数
function addScore(mosquitoId) {
    const points = mosquitoScores[mosquitoId] || 10;
    gameState.score += points;
    updateScore();
}

// 保存最高分数
function saveHighScore() {
    if (gameState.score > gameState.highScore) {
        gameState.highScore = gameState.score;
        localStorage.setItem('highScore', gameState.highScore);
        updateScore();
    }
}

// 初始化背景音乐
function initBGM() {
    bgmSound.volume = 0.3; // 设置音量适中
    bgmSound.play().catch(e => {
        // 自动播放被阻止，等待用户交互后再播放
        console.log('BGM autoplay blocked, waiting for user interaction');
    });
}

// 初始化画布
function initCanvas() {
    // SVG不需要初始化尺寸，它自动适应父容器
    console.log('Canvas initialized');
}

// 更新电力条
function updatePowerBar() {
    if (powerFill) {
        powerFill.style.width = (gameState.power / gameState.maxPower * 100) + '%';
    }
    
    // 根据电力值显示不同数量的飞弹图标
    const missileIcon1 = document.getElementById('missileIcon1');
    const missileIcon2 = document.getElementById('missileIcon2');
    const missileIcon3 = document.getElementById('missileIcon3');
    
    const powerRatio = gameState.power / gameState.maxPower;
    
    if (missileIcon1) {
        if (powerRatio >= 1/3) {
            missileIcon1.classList.add('visible');
        } else {
            missileIcon1.classList.remove('visible');
        }
    }
    
    if (missileIcon2) {
        if (powerRatio >= 2/3) {
            missileIcon2.classList.add('visible');
        } else {
            missileIcon2.classList.remove('visible');
        }
    }
    
    if (missileIcon3) {
        if (powerRatio >= 1) {
            missileIcon3.classList.add('visible');
        } else {
            missileIcon3.classList.remove('visible');
        }
    }
}

// 更新能量条
function updateEnergyBar() {
    if (energyFill) {
        energyFill.style.width = (gameState.energy / gameState.maxEnergy * 100) + '%';
    }
}

// 轮次配置
const levelConfigs = {
    1: { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1 },      // 第1轮：各1只
    2: { 1: 2, 2: 1, 3: 1, 4: 1, 5: 1 },      // 第2轮：1号×2
    3: { 1: 2, 2: 2, 3: 1, 4: 1, 5: 1 },      // 第3轮：1号×2, 2号×2
    4: { 1: 2, 2: 2, 3: 2, 4: 1, 5: 1 },      // 第4轮：1号×2, 2号×2, 3号×2
    5: { 1: 3, 2: 2, 3: 2, 4: 2, 5: 1 },      // 第5轮：全能力
    6: { 1: 3, 2: 3, 3: 2, 4: 2, 5: 2 },      // 第6轮：更多
    7: { 1: 4, 2: 3, 3: 3, 4: 2, 5: 2 },      // 第7轮：极限
    8: { 1: 4, 2: 3, 3: 3, 4: 3, 5: 3 },      // 第8轮：地狱
};

// 创建单个蚊子
function createMosquito(mosquitoId) {
    const mosquito = document.createElement('div');
    mosquito.className = 'mosquito mosquito-image-only';
    mosquito.style.left = Math.random() * 80 + 10 + '%';
    mosquito.style.top = Math.random() * 60 + 10 + '%';
    
    const cfg = SPRITE_CONFIG[mosquitoId];
    const canvas = document.createElement('canvas');
    canvas.className = 'mosquito-image';
    canvas.width = cfg.fw;
    canvas.height = cfg.fh;
    // CSS 宽度由 .mosquito 控制(30px), 高度按帧比例自适应
    canvas.style.width = '100%';
    canvas.style.height = 'auto';
    canvas.style.aspectRatio = `${cfg.fw} / ${cfg.fh}`;
    mosquito.appendChild(canvas);
    
    gameArea.appendChild(mosquito);
    
    let mosquitoData = {
        element: mosquito,
        id: mosquitoId,
        x: parseFloat(mosquito.style.left),
        y: parseFloat(mosquito.style.top),
        vx: (Math.random() - 0.5) * 0.5,
        vy: (Math.random() - 0.5) * 0.5,
        properties: {
            speed: 1,
            clone: false,
            health: false,
            heal: false,
            maxHealth: 100,
            currentHealth: 100
        },
        // 精灵动画状态
        frame: 0,
        lastFrameTime: performance.now(),
        spriteCanvas: canvas
    };
    
    // 根据轮次计算初始攻击延迟
    // 第1轮：立即(0秒)，第2轮：2秒，第3轮：4秒，第4轮：6秒，第5轮：8秒，第6轮及以后：0秒
    let initialAttackDelay = 0;
    if (gameState.level === 2) initialAttackDelay = 2000;
    else if (gameState.level === 3) initialAttackDelay = 4000;
    else if (gameState.level === 4) initialAttackDelay = 6000;
    else if (gameState.level === 5) initialAttackDelay = 8000;
    
    switch (mosquitoId) {
        case 1:
            mosquitoData.properties.speed = 6;
            mosquitoData.properties.attack = true;
            mosquitoData.properties.attackInterval = 5000;
            mosquitoData.properties.attackDamage = 15;
            // 所有轮次都从现在开始计时，到时间后再攻击
            mosquitoData.properties.lastAttackTime = Date.now();
            mosquitoData.vx *= 6;
            mosquitoData.vy *= 6;
            break;
        case 2:
            mosquitoData.properties.clone = true;
            mosquitoData.properties.hasCloned = false;
            mosquitoData.properties.cloneInterval = 2000;
            mosquito.style.transform = 'scale(2)';
            break;
        case 3:
            mosquitoData.properties.health = true;
            mosquitoData.properties.maxHealth = 100;
            mosquitoData.properties.currentHealth = 100;
            mosquitoData.properties.attack = true;
            mosquitoData.properties.attackInterval = 2000;
            mosquitoData.properties.attackDamage = 10;
            // 所有轮次都从现在开始计时，到时间后再攻击
            mosquitoData.properties.lastAttackTime = Date.now();
            addHealthBar(mosquito, 100);
            break;
        case 4:
            mosquitoData.properties.heal = true;
            mosquitoData.properties.healInterval = 2000;
            mosquito.style.transform = 'scale(1.5)';
            break;
        case 5:
            mosquitoData.properties.stealth = true;
            mosquitoData.properties.attack = true;
            mosquitoData.properties.attackDamage = 5;
            mosquitoData.properties.attackInterval = 5000;
            // 所有轮次都从现在开始计时，到时间后再攻击
            mosquitoData.properties.lastAttackTime = Date.now();
            break;
    }
    
    return mosquitoData;
}

// 生成蚊子
function spawnMosquitoes() {
    gameArea.innerHTML = '';
    gameState.mosquitoes = [];
    
    // 重置激光瞄准线变量（因为gameArea.innerHTML会清除激光线元素）
    laserActive = false;
    laserLine = null;
    if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
    }
    
    // 获取当前轮次的配置
    let config;
    if (gameState.level <= 8) {
        // 第1-8轮使用固定配置
        config = { ...levelConfigs[gameState.level] };
    } else {
        // 第9轮及以后，1号和3号蚊子数量动态增加
        const extraCount = gameState.level - 8;
        config = {
            1: 4 + extraCount,  // 1号：4 + (level - 8)
            2: 3,               // 2号：保持第8轮配置
            3: 3 + extraCount,  // 3号：3 + (level - 8)
            4: 3,               // 4号：保持第8轮配置
            5: 3                // 5号：保持第8轮配置
        };
    }
    
    // 根据配置生成蚊子
    for (let mosquitoId = 1; mosquitoId <= 5; mosquitoId++) {
        const count = config[mosquitoId] || 0;
        for (let i = 0; i < count; i++) {
            const mosquitoData = createMosquito(mosquitoId);
            gameState.mosquitoes.push(mosquitoData);
        }
    }
    
    updateRadarDots();
    startMosquitoAbilities();
}

// 添加血条UI
function addHealthBar(mosquito, health) {
    const healthBar = document.createElement('div');
    healthBar.className = 'health-bar';
    healthBar.innerHTML = `<div class="health-fill" style="width: ${health}%"></div>`;
    mosquito.appendChild(healthBar);
}

// 更新雷达红点
function updateRadarDots() {
    const existingDots = radar.querySelectorAll('.radar-dot');
    existingDots.forEach(dot => dot.remove());
    
    // 只显示活着的蚊子
    gameState.mosquitoes.forEach(m => {
        // 跳过已消失或已移除的蚊子
        if (m.element.style.opacity === '0' || !m.element.parentNode) return;
        
        const dot = document.createElement('div');
        dot.className = 'radar-dot';
        dot.style.left = (m.x / 100 * 80 + 10) + '%';
        dot.style.top = (m.y / 100 * 80 + 10) + '%';
        radar.appendChild(dot);
    });
}

// 蚊子移动
function startMosquitoMovement() {
    if (mosquitoMoveInterval) clearInterval(mosquitoMoveInterval);
    mosquitoMoveInterval = setInterval(() => {
        gameState.mosquitoes.forEach(m => {
            // 跳过已消失的蚊子
            if (m.element.style.opacity === '0') return;
            
            m.x += m.vx;
            m.y += m.vy;
            
            // 边界检测，确保蚊子在可见范围内
            if (m.x < 5) {
                m.x = 5;
                m.vx *= -1;
            }
            if (m.x > 90) {
                m.x = 90;
                m.vx *= -1;
            }
            if (m.y < 5) {
                m.y = 5;
                m.vy *= -1;
            }
            if (m.y > 70) {
                m.y = 70;
                m.vy *= -1;
            }
            
            m.element.style.left = m.x + '%';
            m.element.style.top = m.y + '%';
            
            // 精灵表动画
            const cfg = SPRITE_CONFIG[m.id];
            if (cfg && m.spriteCanvas) {
                const now = performance.now();
                if (now - m.lastFrameTime >= 1000 / cfg.fps) {
                    m.frame = (m.frame + 1) % cfg.total;
                    m.lastFrameTime = now;
                }
                const col = m.frame % cfg.cols;
                const row = Math.floor(m.frame / cfg.cols);
                const ctx = m.spriteCanvas.getContext('2d');
                ctx.clearRect(0, 0, cfg.fw, cfg.fh);
                const sheet = spriteImages[cfg.file];
                if (sheet) {
                    ctx.drawImage(sheet, col * cfg.fw, row * cfg.fh, cfg.fw, cfg.fh, 0, 0, cfg.fw, cfg.fh);
                }
            }
        });
        
        updateRadarDots();
    }, 50);
}

// 启动蚊子能力系统
function startMosquitoAbilities() {
    // 清除旧的定时器
    if (gameState.healthTimer) clearInterval(gameState.healthTimer);
    if (mosquitoCloneTimeout) { clearTimeout(mosquitoCloneTimeout); mosquitoCloneTimeout = null; }
    if (mosquitoHealInterval) { clearInterval(mosquitoHealInterval); mosquitoHealInterval = null; }
    if (mosquitoAttackInterval) { clearInterval(mosquitoAttackInterval); mosquitoAttackInterval = null; }
    
    // 2号蚊子：分身能力（出场5秒后分身一次）
    mosquitoCloneTimeout = setTimeout(() => {
        gameState.mosquitoes.forEach(m => {
            // 检查是否是原始2号蚊子（有分身属性）且还未分身
            if (m.properties.clone && !m.properties.hasCloned && m.element.style.opacity !== '0') {
                cloneMosquito(m);
                m.properties.hasCloned = true; // 标记已分身
            }
        });
    }, 5000);
    
    // 4号蚊子：加血能力（每10秒检测并补满3号蚊子血量）
    mosquitoHealInterval = setInterval(() => {
        gameState.mosquitoes.forEach(m => {
            if (m.properties.heal && m.id === 4 && m.element.style.opacity !== '0') {
                healMosquito(m);
            }
        });
    }, 10000);
    
    // 蚊子攻击能力（根据攻击间隔发射攻击子弹）
    mosquitoAttackInterval = setInterval(() => {
        const now = Date.now();
        gameState.mosquitoes.forEach(m => {
            if (m.properties.attack && m.element.style.opacity !== '0') {
                // 确保 lastAttackTime 已初始化
                if (!m.properties.lastAttackTime) {
                    m.properties.lastAttackTime = now;
                    return;
                }
                if (now - m.properties.lastAttackTime >= m.properties.attackInterval) {
                    mosquitoAttack(m);
                    m.properties.lastAttackTime = now;
                }
            }
        });
    }, 1000);
    
    // 玩家血量自动回复（每秒回复2点）
    gameState.healthTimer = setInterval(() => {
        if (gameState.gamePaused) return;
        if (gameState.playerHealth < gameState.maxPlayerHealth) {
            gameState.playerHealth = Math.min(gameState.playerHealth + 5, gameState.maxPlayerHealth);
            updatePlayerHealth();
        }
    }, 1000);
    
    // 5号蚊子：隐身能力（现身5秒，隐身2秒，隐身前呼吸1秒）
    gameState.mosquitoes.forEach(m => {
        if (m.properties.stealth && m.element.style.opacity !== '0') {
            startStealthAbility(m);
        }
    });
}

// 5号蚊子：隐身能力
function startStealthAbility(mosquito) {
    // 初始状态：现身
    let isStealth = false;
    
    function toggleStealth() {
        // 只检查蚊子是否存在于DOM中，不检查可见性
        if (!mosquito.element.parentNode) {
            return;
        }
        
        // 准备隐身：呼吸状态1秒
        mosquito.element.style.animation = 'breathing 1s ease-in-out infinite';
        
        setTimeout(() => {
            // 只检查蚊子是否存在于DOM中，不检查可见性
            if (!mosquito.element.parentNode) {
                return;
            }
            
            mosquito.element.style.animation = '';
            // 进入隐身状态（2秒）
            isStealth = true;
            mosquito.element.style.opacity = '0';
            
            setTimeout(() => {
                // 只检查蚊子是否存在于DOM中，不检查可见性
                if (!mosquito.element.parentNode) {
                    return;
                }
                // 结束隐身：现身（5秒）
                isStealth = false;
                mosquito.element.style.opacity = '1';
                
                setTimeout(toggleStealth, 5000);
            }, 2000);
        }, 1000);
    }
    
    // 开始隐身循环
    toggleStealth();
}

// 克隆蚊子（2号蚊子分身，可以分任何蚊子）
function cloneMosquito(cloner) {
    // 获取场上所有活着的蚊子
    const aliveMosquitoes = gameState.mosquitoes.filter(m => 
        m.element.style.opacity !== '0' && m.element.parentNode
    );
    
    if (aliveMosquitoes.length === 0) return;
    
    // 随机选择一只蚊子进行克隆
    const targetMosquito = aliveMosquitoes[Math.floor(Math.random() * aliveMosquitoes.length)];
    
    const clone = document.createElement('div');
    clone.className = 'mosquito mosquito-image-only';
    clone.style.left = targetMosquito.x + '%';
    clone.style.top = targetMosquito.y + '%';
    clone.style.opacity = '0.7';
    
    // 根据目标蚊子设置大小
    if (targetMosquito.id === 2) {
        clone.style.transform = 'scale(2)';
    } else if (targetMosquito.id === 4) {
        clone.style.transform = 'scale(1.5)';
    }
    
    const cfg = SPRITE_CONFIG[targetMosquito.id];
    const canvas = document.createElement('canvas');
    canvas.className = 'mosquito-image';
    canvas.width = cfg.fw;
    canvas.height = cfg.fh;
    canvas.style.width = '100%';
    canvas.style.height = 'auto';
    canvas.style.aspectRatio = `${cfg.fw} / ${cfg.fh}`;
    clone.appendChild(canvas);
    
    // 如果是3号蚊子，添加血条
    if (targetMosquito.id === 3) {
        const healthBar = document.createElement('div');
        healthBar.className = 'health-bar';
        healthBar.innerHTML = `<div class="health-fill" style="width: 100%"></div>`;
        clone.appendChild(healthBar);
    }
    
    gameArea.appendChild(clone);
    
    // 根据轮次计算初始攻击延迟（克隆蚊子也遵循同样的规则）
    let cloneInitialAttackDelay = 0;
    if (gameState.level === 2) cloneInitialAttackDelay = 2000;
    else if (gameState.level === 3) cloneInitialAttackDelay = 4000;
    else if (gameState.level === 4) cloneInitialAttackDelay = 6000;
    else if (gameState.level === 5) cloneInitialAttackDelay = 8000;
    
    // 克隆蚊子数据 - 继承原始蚊子的所有属性
    const cloneData = {
        element: clone,
        id: targetMosquito.id,
        x: targetMosquito.x,
        y: targetMosquito.y,
        vx: (Math.random() - 0.5) * 0.5,
        vy: (Math.random() - 0.5) * 0.5,
        properties: {
            speed: targetMosquito.properties.speed,
            clone: false,
            health: targetMosquito.properties.health,
            heal: false,
            stealth: targetMosquito.properties.stealth || false,
            hasCloned: true,
            maxHealth: targetMosquito.properties.maxHealth,
            currentHealth: targetMosquito.properties.maxHealth || 100,
            // 继承攻击属性
            attack: targetMosquito.properties.attack || false,
            attackInterval: targetMosquito.properties.attackInterval || 10000,
            attackDamage: targetMosquito.properties.attackDamage || 10,
            // 第1轮立即攻击，其他轮次从0开始计时
            lastAttackTime: gameState.level === 1 ? 0 : Date.now()
        },
        // 精灵动画状态
        frame: 0,
        lastFrameTime: performance.now(),
        spriteCanvas: canvas
    };
    
    // 如果是1号蚊子，使用原始1号蚊子的速度（vx *= 6）
    if (targetMosquito.id === 1) {
        cloneData.vx *= 6;
        cloneData.vy *= 6;
    }
    
    gameState.mosquitoes.push(cloneData);
    
    // 如果是5号蚊子的分身，启动隐身能力
    if (cloneData.properties.stealth) {
        startStealthAbility(cloneData);
    }
}

// 加血功能（4号蚊子给3号加血，补满血量）
function healMosquito(healer) {
    // 查找场上所有活着的3号蚊子
    const targetMosquitoes = gameState.mosquitoes.filter(m => 
        m.id === 3 && 
        m.properties.health && 
        m.element.style.opacity !== '0' &&
        m.element.parentNode
    );
    
    if (targetMosquitoes.length === 0) return;
    
    // 4号蚊子发光效果
    healer.element.style.filter = 'brightness(2) drop-shadow(0 0 10px #4CAF50)';
    setTimeout(() => {
        healer.element.style.filter = '';
    }, 500);
    
    // 给所有3号蚊子补满血量
    targetMosquitoes.forEach(target => {
        // 只有血量未满才加血
        if (target.properties.currentHealth < target.properties.maxHealth) {
            target.properties.currentHealth = target.properties.maxHealth;
            updateHealthBar(target);
            
            // 3号蚊子发光效果
            target.element.style.filter = 'brightness(2) drop-shadow(0 0 10px #4CAF50)';
            setTimeout(() => {
                target.element.style.filter = '';
            }, 500);
        }
    });
}

// 更新血条显示
function updateHealthBar(mosquito) {
    const healthBar = mosquito.element.querySelector('.health-bar');
    if (healthBar) {
        const healthFill = healthBar.querySelector('.health-fill');
        const healthPercent = (mosquito.properties.currentHealth / mosquito.properties.maxHealth) * 100;
        healthFill.style.width = healthPercent + '%';
    }
}

// 蚊子攻击功能（3号蚊子攻击炮台）
function mosquitoAttack(attacker) {
    const attackerRect = attacker.element.getBoundingClientRect();
    const gameAreaRect = gameArea.getBoundingClientRect();
    
    // 计算起始位置（蚊子位置）
    const startX = attackerRect.left + attackerRect.width / 2;
    const startY = attackerRect.top + attackerRect.height / 2;
    
    // 计算目标位置（炮台位置）
    const cannonBase = document.querySelector('.cannon-base');
    const cannonRect = cannonBase.getBoundingClientRect();
    const targetX = cannonRect.left + cannonRect.width / 2;
    const targetY = cannonRect.top + cannonRect.height / 2;
    
    // 计算飞行角度
    const dx = targetX - startX;
    const dy = targetY - startY;
    const angle = Math.atan2(dy, dx);
    
    // 创建攻击子弹（明显区分：紫色圆形）
    const bullet = document.createElement('div');
    bullet.className = 'mosquito-bullet';
    bullet.style.position = 'absolute';
    bullet.style.left = startX + 'px';
    bullet.style.top = startY + 'px';
    bullet.style.width = '12px';
    bullet.style.height = '12px';
    bullet.style.background = 'radial-gradient(circle, #9C27B0, #7B1FA2)';
    bullet.style.borderRadius = '50%';
    bullet.style.border = '2px solid #E1BEE7';
    bullet.style.zIndex = '999';
    bullet.style.pointerEvents = 'none';
    bullet.style.boxShadow = '0 0 8px #9C27B0';
    
    document.body.appendChild(bullet);
    
    let currentX = startX;
    let currentY = startY;
    const speed = 8;
    
    const flyInterval = setInterval(() => {
        currentX += Math.cos(angle) * speed;
        currentY += Math.sin(angle) * speed;
        
        bullet.style.left = currentX + 'px';
        bullet.style.top = currentY + 'px';
        
        // 检测是否击中炮台
        const bulletRect = bullet.getBoundingClientRect();
        if (isColliding(bulletRect, cannonRect)) {
            clearInterval(flyInterval);
            bullet.remove();
            
            // 扣除玩家血量（防御罩减伤）
            const rawDamage = attacker.properties.attackDamage || 10;
            const damage = gameState.shieldActive ? Math.round(rawDamage * (1 - gameState.shieldPower)) : rawDamage;
            gameState.playerHealth = Math.max(0, gameState.playerHealth - damage);
            updatePlayerHealth();
            
            // 炮台受击效果
            cannonBase.style.filter = 'brightness(2) drop-shadow(0 0 10px #f44336)';
            setTimeout(() => {
                cannonBase.style.filter = '';
            }, 300);
            
            // 检查玩家是否死亡
            if (gameState.playerHealth <= 0) {
                showGameOver('lose');
            }
        }
        
        // 检测是否超出屏幕
        if (currentX < -20 || currentX > window.innerWidth + 20 ||
            currentY < -20 || currentY > window.innerHeight + 20) {
            clearInterval(flyInterval);
            bullet.remove();
        }
    }, 20);
}

// 点击时间记录
let lastClickTime = 0;

let lastFireTime = 0;
let lastTapTime = 0;
let lastCannonTapTime = 0;
let touchStartX = 0;
let touchStartY = 0;
let firstTouchPos = null; // 记录第一次手指落点位置
let activeTouches = new Map(); // 存储当前活跃的手指

// 激光瞄准线相关变量
let longPressTimer = null;
let laserLine = null;
let laserActive = false;
let laserStartTime = 0;
const LASER_DURATION = 3000; // 激光持续时间3秒
const LASER_COST = 10; // 每次使用激光消耗10点能量

// 绑定事件
function bindEvents() {
    // 红色按钮 - 发射
    btnRed.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        // 防抖动：300ms内只能发射一次
        const now = Date.now();
        if (now - lastFireTime < 300) {
            return;
        }
        lastFireTime = now;
        
        startBGMOnFirstInteraction();
        setActiveButton('red');
        fire();
    });
    
    // 绿色按钮 - 充电/蓄力（根据点击速度调整充电速度）
    btnGreen.addEventListener('click', () => {
        startBGMOnFirstInteraction();
        setActiveButton('green');
        const currentTime = Date.now();
        const clickInterval = currentTime - lastClickTime;
        lastClickTime = currentTime;
        
        // 根据点击间隔调整充电量：点击越快，充电越多
        let chargeAmount = 5; // 默认充电量
        if (clickInterval < 300) chargeAmount = 15; // 快速点击
        else if (clickInterval < 600) chargeAmount = 10; // 中等速度点击
        
        gameState.power = Math.min(gameState.power + chargeAmount, gameState.maxPower);
        updatePowerBar();
    });
    
    // 左箭头 - 炮口向左旋转（逆时针）
    btnLeft.addEventListener('click', () => {
        startBGMOnFirstInteraction();
        rotateCannon(-5);
    });
    
    // 右箭头 - 炮口向右旋转（顺时针）
    btnRight.addEventListener('click', () => {
        startBGMOnFirstInteraction();
        rotateCannon(5);
    });
    
    // 触摸滑动控制炮筒方向（全屏有效）
    document.addEventListener('touchstart', (e) => {
        // 排除按钮区域
        if (e.target.closest('.controls') || e.target.closest('.control-btn') || e.target.closest('.arrow-btn')) {
            return;
        }
        
        // 检查是否在炮筒区域内
        const cannonSection = document.querySelector('.cannon-section');
        if (cannonSection) {
            const touch = e.touches[0];
            const cannonRect = cannonSection.getBoundingClientRect();
            
            // 检查是否在炮筒区域内（左右各扩展30像素，上下各扩展100像素）
            if (touch.clientX >= cannonRect.left - 30 && touch.clientX <= cannonRect.right + 30 && 
                touch.clientY >= cannonRect.top - 100 && touch.clientY <= cannonRect.bottom + 100) {
                touchStartX = touch.clientX;
                touchStartY = touch.clientY;
            }
        } else {
            // 如果找不到炮筒区域，仍然更新触摸起点（防止错误）
            const touch = e.touches[0];
            touchStartX = touch.clientX;
            touchStartY = touch.clientY;
        }
        
        // 记录所有手指
        for (let i = 0; i < e.touches.length; i++) {
            const t = e.touches[i];
            activeTouches.set(t.identifier, {
                x: t.clientX,
                y: t.clientY
            });
        }
        
        // 记录第一次手指落点
        if (!firstTouchPos && e.touches.length > 0) {
            firstTouchPos = {
                x: e.touches[0].clientX,
                y: e.touches[0].clientY
            };
        }
        
        // 长按检测：1秒后激活激光瞄准线
        longPressTimer = setTimeout(() => {
            if (gameState.energy >= LASER_COST) {
                // 消耗能量
                gameState.energy = Math.max(0, gameState.energy - LASER_COST);
                updateEnergyBar();
                
                // 激活激光瞄准线
                activateLaser();
            }
        }, 1000);
        
        // 更新调试显示
        const debugInfo = document.getElementById('debugInfo');
        if (debugInfo) {
            debugInfo.textContent = '';
        }
    }, { passive: false });
    
    document.addEventListener('touchmove', (e) => {
        // 排除按钮区域
        if (e.target.closest('.controls') || e.target.closest('.control-btn') || e.target.closest('.arrow-btn')) {
            return;
        }
        
        // 检查是否在炮筒区域内
        const cannonSection = document.querySelector('.cannon-section');
        if (!cannonSection) return;
        
        const touch = e.touches[0];
        const cannonRect = cannonSection.getBoundingClientRect();
        
        // 扩大检测区域，包括炮筒延伸方向（左右各扩展30像素，上下各扩展100像素）
        if (touch.clientX >= cannonRect.left - 30 && touch.clientX <= cannonRect.right + 30 && 
            touch.clientY >= cannonRect.top - 100 && touch.clientY <= cannonRect.bottom + 100) {
            // 如果是第一次进入炮筒区域，更新触摸起点
            if (!touchStartX || !touchStartY) {
                touchStartX = touch.clientX;
                touchStartY = touch.clientY;
            }
            
            const deltaX = touch.clientX - touchStartX;
            const deltaY = touch.clientY - touchStartY;
            
            // 只有当移动距离超过一定阈值时才阻止默认行为
            if (Math.abs(deltaX) > 5 || Math.abs(deltaY) > 5) {
                e.preventDefault();
                
                // 计算角度变化（提高灵敏度）
                const angleChange = deltaX * 0.8;
                rotateCannon(angleChange);
                
                touchStartX = touch.clientX;
                touchStartY = touch.clientY;
            }
        } else {
            // 当手指离开炮筒区域时，重置触摸起点
            touchStartX = null;
            touchStartY = null;
        }
    }, { passive: false });
    
    // 双击炮筒区域充电（绿色按钮功能）
    const cannonSection = document.querySelector('.cannon-section');
    if (cannonSection) {
        cannonSection.addEventListener('touchend', (e) => {
            e.stopPropagation(); // 阻止事件冒泡，确保充电优先级更高
            
            // 清除长按计时器
            if (longPressTimer) {
                clearTimeout(longPressTimer);
                longPressTimer = null;
            }
            
            const now = Date.now();
            
            // 双击检测：300ms内两次点击
            if (now - lastCannonTapTime < 300) {
                startBGMOnFirstInteraction();
                setActiveButton('green');
                
                // 根据点击间隔调整充电量：点击越快，充电越多
                const currentTime = Date.now();
                const clickInterval = currentTime - lastClickTime;
                lastClickTime = currentTime;
                
                let chargeAmount = 5; // 默认充电量
                if (clickInterval < 300) chargeAmount = 15; // 快速点击
                else if (clickInterval < 600) chargeAmount = 10; // 中等速度点击
                
                gameState.power = Math.min(gameState.power + chargeAmount, gameState.maxPower);
                updatePowerBar();
                
                // 充电时震动
                vibrate(50);
            }
            lastCannonTapTime = now;
        });
    }
    
    // 双击屏幕发射（全屏有效，排除按钮）
    document.addEventListener('touchend', (e) => {
        // 排除按钮区域和炮筒区域（炮筒区域有单独的双击事件）
        if (e.target.closest('.controls') || e.target.closest('.control-btn') || e.target.closest('.arrow-btn') || e.target.closest('.cannon-section')) {
            return;
        }
        
        // 清除长按计时器
        if (longPressTimer) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
        }
        
        const now = Date.now();
        
        // 获取离开的手指位置
        const leavingTouch = e.changedTouches[0];
        const leavingPos = {
            x: leavingTouch.clientX,
            y: leavingTouch.clientY
        };
        
        // 检查是否有多指触控（还有其他手指在屏幕上）
        let distance = 0;
        if (e.touches.length > 0 && firstTouchPos) {
            // 计算两指距离
            const dx = leavingPos.x - firstTouchPos.x;
            const dy = leavingPos.y - firstTouchPos.y;
            distance = Math.sqrt(dx * dx + dy * dy);
        }
        
        // 移除离开的手指
        for (let i = 0; i < e.changedTouches.length; i++) {
            activeTouches.delete(e.changedTouches[i].identifier);
        }
        
        // 如果没有手指在屏幕上，重置第一次落点
        if (e.touches.length === 0) {
            firstTouchPos = null;
        }
        
        // 更新调试显示
        const debugInfo = document.getElementById('debugInfo');
        if (debugInfo) {
            debugInfo.textContent = '';
        }
        
        // 检查离开的手指位置是否在蚊子活动区域内
        const gameAreaRect = document.querySelector('.game-area').getBoundingClientRect();
        const gameAreaWidth = gameAreaRect.width;
        const gameAreaHeight = gameAreaRect.height;
        
        // 蚊子活动区域边界（与 startMosquitoMovement 函数中保持一致）
        const mosquitoAreaLeft = gameAreaRect.left + gameAreaWidth * 0.05;
        const mosquitoAreaRight = gameAreaRect.left + gameAreaWidth * 0.9;
        const mosquitoAreaTop = gameAreaRect.top + gameAreaHeight * 0.05;
        const mosquitoAreaBottom = gameAreaRect.top + gameAreaHeight * 0.7;
        
        // 检查离开的手指是否在蚊子活动区域内
        const isInMosquitoArea = leavingPos.x >= mosquitoAreaLeft && 
                                leavingPos.x <= mosquitoAreaRight && 
                                leavingPos.y >= mosquitoAreaTop && 
                                leavingPos.y <= mosquitoAreaBottom;
        
        // 多指模式：距离>150px发射追踪飞弹
        if (distance > 150 || isInMosquitoArea) {
            console.log('距离超过150px或点击在蚊子活动区域，发射追踪飞弹，距离:', distance, '是否在活动区域:', isInMosquitoArea);
            
            // 防抖动：300ms内只能发射一次
            if (now - lastFireTime < 300) {
                return;
            }
            
            // 检查电力是否足够（需要1/3电力）
            if (gameState.power < gameState.maxPower / 3) {
                // 播放没子弹音效
                pauseBGM();
                meizidanSound.currentTime = 0;
                meizidanSound.play();
                meizidanSound.onended = resumeBGM;
                return;
            }
            
            let closestMosquito;
            if (isInMosquitoArea) {
                // 点击在蚊子活动区域内，找出离点击位置最近的蚊子
                closestMosquito = findClosestMosquitoToPoint(leavingPos);
            } else {
                // 多指滑动，找出离两只手指连线最近的蚊子
                closestMosquito = findClosestMosquitoToLine(firstTouchPos, leavingPos);
            }
            
            if (closestMosquito) {
                // 标记蚊子
                markMosquito(closestMosquito);
                
                // 更新最后发射时间
                lastFireTime = now;
                
                // 消耗1/3电力
                gameState.power = Math.max(0, gameState.power - gameState.maxPower / 3);
                updatePowerBar();
                
                // 发射追踪飞弹
                setTimeout(() => {
                    createHomingMissile(closestMosquito);
                }, 300);
            }
        }
        
        // 单指双击模式：普通发射（保持原逻辑不变）
        if (now - lastTapTime < 300) {
            // 防抖动：300ms内只能发射一次
            if (now - lastFireTime < 300) {
                return;
            }
            lastFireTime = now;
            
            startBGMOnFirstInteraction();
            fire();
        }
        lastTapTime = now;
    });
    
    // PC端键盘控制
    let keysPressed = {};
    
    document.addEventListener('keydown', (e) => {
        keysPressed[e.key] = true;
        
        // 空格键：电力蓄积
        if (e.code === 'Space') {
            e.preventDefault();
            startBGMOnFirstInteraction();
            setActiveButton('green');
            
            const currentTime = Date.now();
            const clickInterval = currentTime - lastClickTime;
            lastClickTime = currentTime;
            
            let chargeAmount = 5;
            if (clickInterval < 300) chargeAmount = 15;
            else if (clickInterval < 600) chargeAmount = 10;
            
            gameState.power = Math.min(gameState.power + chargeAmount, gameState.maxPower);
            updatePowerBar();
            
            vibrate(50);
        }
        
        // J键或1键：普通发射
        if ((e.key === 'j' || e.key === 'J' || e.key === '1') && !e.repeat) {
            e.preventDefault();
            const now = Date.now();
            
            if (now - lastFireTime < 300) {
                return;
            }
            lastFireTime = now;
            
            startBGMOnFirstInteraction();
            fire();
        }
        
        // K键或2键：追踪飞弹
        if ((e.key === 'k' || e.key === 'K' || e.key === '2') && !e.repeat) {
            e.preventDefault();
            const now = Date.now();
            
            if (now - lastFireTime < 300) {
                return;
            }
            
            // 检查电力是否足够（需要1/3电力）
            if (gameState.power < gameState.maxPower / 3) {
                pauseBGM();
                meizidanSound.currentTime = 0;
                meizidanSound.play();
                meizidanSound.onended = resumeBGM;
                return;
            }
            
            // 找出离炮筒指向最近的蚊子
            const cannonBase = document.querySelector('.cannon-base');
            const cannonRect = cannonBase.getBoundingClientRect();
            const cannonCenter = {
                x: cannonRect.left + cannonRect.width / 2,
                y: cannonRect.top + cannonRect.height / 2
            };
            
            const angleRad = gameState.cannonAngle * Math.PI / 180;
            const lineEnd = {
                x: cannonCenter.x + Math.cos(angleRad) * 1000,
                y: cannonCenter.y + Math.sin(angleRad) * 1000
            };
            
            const closestMosquito = findClosestMosquitoToLine(cannonCenter, lineEnd);
            
            if (closestMosquito) {
                markMosquito(closestMosquito);
                lastFireTime = now;
                
                // 消耗1/3电力
                gameState.power = Math.max(0, gameState.power - gameState.maxPower / 3);
                updatePowerBar();
                
                setTimeout(() => {
                    createHomingMissile(closestMosquito);
                }, 300);
            }
        }
        
        // A键或左方向键：向左旋转炮筒
        if ((e.key === 'a' || e.key === 'A' || e.key === 'ArrowLeft') && !e.repeat) {
            e.preventDefault();
            rotateCannon(-5);
        }
        
        // D键或右方向键：向右旋转炮筒
        if ((e.key === 'd' || e.key === 'D' || e.key === 'ArrowRight') && !e.repeat) {
            e.preventDefault();
            rotateCannon(5);
        }
    });
    
    document.addEventListener('keyup', (e) => {
        keysPressed[e.key] = false;
    });
    
    // PC端鼠标控制
    let mouseDownTime = 0;
    let longPressTimer = null;
    let lastLeftClickTime = 0;
    
    document.addEventListener('mousedown', (e) => {
        if (e.target.closest('.controls') || e.target.closest('.control-btn') || e.target.closest('.arrow-btn')) {
            return;
        }
        
        const now = Date.now();
        
        // 鼠标左键：单击发射普通炮弹
        if (e.button === 0) {
            // 防抖动：300ms内只能发射一次
            if (now - lastFireTime < 300) {
                return;
            }
            lastFireTime = now;
            
            startBGMOnFirstInteraction();
            fire();
        }
        
        // 鼠标右键：长按激活激光瞄准线，点击发射追踪飞弹
        if (e.button === 2) {
            e.preventDefault();
            
            // 长按检测：1秒后激活激光瞄准线
            mouseDownTime = now;
            longPressTimer = setTimeout(() => {
                if (gameState.energy >= LASER_COST) {
                    // 消耗能量
                    gameState.energy = Math.max(0, gameState.energy - LASER_COST);
                    updateEnergyBar();
                    
                    // 激活激光瞄准线
                    activateLaser();
                }
            }, 1000);
        }
    });
    
    document.addEventListener('mouseup', (e) => {
        if (longPressTimer) {
            clearTimeout(longPressTimer);
            
            // 如果是右键且没有长按超过1秒，则发射追踪飞弹
            if (e.button === 2) {
                const now = Date.now();
                if (now - mouseDownTime < 1000) {
                    // 防抖动：300ms内只能发射一次
                    if (now - lastFireTime < 300) {
                        return;
                    }
                    
                    // 检查电力是否足够（需要1/3电力）
                    if (gameState.power < gameState.maxPower / 3) {
                        pauseBGM();
                        meizidanSound.currentTime = 0;
                        meizidanSound.play();
                        meizidanSound.onended = resumeBGM;
                        return;
                    }
                    
                    // 获取鼠标点击位置
                    const clickPos = {
                        x: e.clientX,
                        y: e.clientY
                    };
                    
                    // 检查点击位置是否在蚊子活动区域内
                    const gameAreaRect = document.querySelector('.game-area').getBoundingClientRect();
                    const gameAreaWidth = gameAreaRect.width;
                    const gameAreaHeight = gameAreaRect.height;
                    
                    // 蚊子活动区域边界（与 startMosquitoMovement 函数中保持一致）
                    const mosquitoAreaLeft = gameAreaRect.left + gameAreaWidth * 0.05;
                    const mosquitoAreaRight = gameAreaRect.left + gameAreaWidth * 0.9;
                    const mosquitoAreaTop = gameAreaRect.top + gameAreaHeight * 0.05;
                    const mosquitoAreaBottom = gameAreaRect.top + gameAreaHeight * 0.7;
                    
                    // 检查点击位置是否在蚊子活动区域内
                    const isInMosquitoArea = clickPos.x >= mosquitoAreaLeft && 
                                            clickPos.x <= mosquitoAreaRight && 
                                            clickPos.y >= mosquitoAreaTop && 
                                            clickPos.y <= mosquitoAreaBottom;
                    
                    let closestMosquito;
                    if (isInMosquitoArea) {
                        // 点击在蚊子活动区域内，找出离点击位置最近的蚊子
                        closestMosquito = findClosestMosquitoToPoint(clickPos);
                    } else {
                        // 点击在蚊子活动区域外，使用炮筒指向的方向
                        const cannonBase = document.querySelector('.cannon-base');
                        const cannonRect = cannonBase.getBoundingClientRect();
                        const cannonCenter = {
                            x: cannonRect.left + cannonRect.width / 2,
                            y: cannonRect.top + cannonRect.height / 2
                        };
                        
                        // 计算炮筒指向的方向
                        const angleRad = gameState.cannonAngle * Math.PI / 180;
                        const lineEnd = {
                            x: cannonCenter.x + Math.cos(angleRad) * 1000,
                            y: cannonCenter.y + Math.sin(angleRad) * 1000
                        };
                        
                        // 找出离炮筒指向方向最近的蚊子
                        closestMosquito = findClosestMosquitoToLine(cannonCenter, lineEnd);
                    }
                    
                    if (closestMosquito) {
                        // 标记蚊子
                        markMosquito(closestMosquito);
                        
                        // 更新最后发射时间
                        lastFireTime = now;
                        
                        // 消耗1/3电力
                        gameState.power = Math.max(0, gameState.power - gameState.maxPower / 3);
                        updatePowerBar();
                        
                        // 发射追踪飞弹
                        setTimeout(() => {
                            createHomingMissile(closestMosquito);
                        }, 300);
                    }
                }
            }
            
            longPressTimer = null;
        }
    });
    
    // 鼠标移动时控制炮筒方向
    document.addEventListener('mousemove', (e) => {
        // 排除按钮区域和炮筒区域
        if (e.target.closest('.controls') || e.target.closest('.control-btn') || e.target.closest('.arrow-btn') || e.target.closest('.cannon-section')) {
            return;
        }
        
        // 检测是否为触摸设备
        const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
        
        // 在触摸设备上，只在炮筒区域内响应鼠标移动事件
        if (isTouchDevice) {
            const cannonSection = document.querySelector('.cannon-section');
            if (cannonSection) {
                const cannonRect = cannonSection.getBoundingClientRect();
                
                // 检查是否在炮筒区域内（左右各扩展30像素，上下各扩展100像素）
                if (!(e.clientX >= cannonRect.left - 30 && e.clientX <= cannonRect.right + 30 && 
                      e.clientY >= cannonRect.top - 100 && e.clientY <= cannonRect.bottom + 100)) {
                    return;
                }
            }
        }
        
        const gameAreaRect = document.querySelector('.game-area').getBoundingClientRect();
        const gameCenterX = gameAreaRect.left + gameAreaRect.width / 2;
        
        // 计算鼠标位置与游戏中心的水平距离
        const deltaX = e.clientX - gameCenterX;
        
        // 计算目标角度（限制在垂直方向(-90度)左右各60度）
        let targetAngle = -90 + (deltaX / gameAreaRect.width) * 120;
        targetAngle = Math.max(-150, Math.min(-30, targetAngle));
        
        // 平滑调整角度
        gameState.cannonAngle += (targetAngle - gameState.cannonAngle) * 0.1;
        
        // 更新炮筒位置
        cannonBarrel.style.transform = `rotate(${gameState.cannonAngle}deg)`;
    });
    
    // 禁用右键菜单
    document.addEventListener('contextmenu', (e) => {
        e.preventDefault();
    });
    
    // 说明书功能
    const manualBtn = document.getElementById('manualBtn');
    const manualModal = document.getElementById('manualModal');
    const closeManualBtn = document.getElementById('closeManualBtn');
    
    if (manualBtn && manualModal && closeManualBtn) {
        manualBtn.addEventListener('click', () => {
            manualModal.classList.add('show');
        });
        
        closeManualBtn.addEventListener('click', () => {
            manualModal.classList.remove('show');
        });
        
        // 点击弹窗外部关闭
        manualModal.addEventListener('click', (e) => {
            if (e.target === manualModal) {
                manualModal.classList.remove('show');
            }
        });
    }
}

// 首次交互时启动背景音乐
function startBGMOnFirstInteraction() {
    if (!bgmStarted) {
        bgmStarted = true;
        bgmSound.play().catch(e => {
            console.log('BGM start failed:', e);
        });
    }
}

// 设置活动按钮
function setActiveButton(color) {
    [btnRed, btnGreen].forEach(btn => btn.classList.remove('active'));
    
    if (color === 'red') btnRed.classList.add('active');
    if (color === 'green') btnGreen.classList.add('active');
    
    gameState.activeButton = color;
}

// 旋转炮口
function rotateCannon(degrees) {
    if (gameState.gamePaused) return;
    gameState.cannonAngle += degrees;
    
    // 限制角度范围：垂直方向(-90度)左右各60度
    // 向左最大：-90 - 60 = -150度
    // 向右最大：-90 + 60 = -30度
    if (gameState.cannonAngle < -150) gameState.cannonAngle = -150;
    if (gameState.cannonAngle > -30) gameState.cannonAngle = -30;
    
    cannonBarrel.style.transform = `rotate(${gameState.cannonAngle}deg)`;
}



// 震动效果
function vibrate(duration = 100) {
    if ('vibrate' in navigator) {
        navigator.vibrate(duration);
    } else if ('webkitVibrate' in navigator) {
        navigator.webkitVibrate(duration);
    }
}

// 发射
function fire() {
    if (gameState.gamePaused) return;
    // 发射时震动
    vibrate(150);
    
    // 炮筒动画
    cannonBarrel.style.transform = `rotate(${gameState.cannonAngle}deg) scale(1.2)`;
    setTimeout(() => {
        cannonBarrel.style.transform = `rotate(${gameState.cannonAngle}deg) scale(1)`;
    }, 200);
    
    // 创建炮弹
    createBullet();
}

// 暂停背景音乐
function pauseBGM() {
    if (!bgmSound.paused) {
        bgmSound.pause();
    }
}

// 恢复背景音乐
function resumeBGM() {
    // 检查是否还有蚊子存活
    const aliveMosquitoes = gameState.mosquitoes.filter(m => 
        m.element.style.opacity !== '0' && m.element.parentNode
    );
    
    // 如果所有蚊子都被消灭，不播放背景音乐
    if (aliveMosquitoes.length === 0) {
        return;
    }
    
    bgmSound.play().catch(e => {
        console.log('BGM resume failed:', e);
    });
}

// 创建炮弹
function createBullet() {
    const reward = gameState.activeReward;
    if (reward && reward.type === 'spread') {
        const rows = [];
        rows.push({ count: reward.count, angleOff: 0 });
        if (reward.rows >= 2) {
            rows[0].angleOff = 4;
            rows.push({ count: reward.row2Count, angleOff: -4 });
        }
        if (reward.rows >= 3) {
            rows[0].angleOff = 6;
            rows.push({ count: reward.row3Count, angleOff: -6 });
            rows[1].angleOff = 0;
        }
        rows.forEach(row => {
            const step = row.count > 1 ? 8 / (row.count - 1) : 0;
            for (let i = 0; i < row.count; i++) {
                const spreadAngle = (i - (row.count - 1) / 2) * step;
                launchSingleBullet(gameState.cannonAngle + row.angleOff + spreadAngle);
            }
        });
    } else {
        launchSingleBullet(gameState.cannonAngle);
    }
}

function launchSingleBullet(angleDeg) {
    const bullet = document.createElement('div');
    bullet.className = 'bullet';
    
    const gameAreaRect = gameArea.getBoundingClientRect();
    const angleRad = angleDeg * Math.PI / 180;
    const cannonLength = cannonBarrel.offsetWidth;
    
    const pivotX = gameAreaRect.width / 2 - 5;
    const cannonRect = cannonBarrel.getBoundingClientRect();
    const pivotY = cannonRect.top + cannonRect.height / 2 - gameAreaRect.top;
    
    const startX = pivotX + Math.cos(angleRad) * cannonLength;
    const startY = pivotY + Math.sin(angleRad) * cannonLength;
    
    bullet.style.left = (startX - 7.5) + 'px';
    bullet.style.top = (startY - 7.5) + 'px';
    
    gameArea.appendChild(bullet);
    
    const speed = 15;
    const vx = Math.cos(angleRad) * speed;
    const vy = Math.sin(angleRad) * speed;
    
    let bulletX = startX - 7.5;
    let bulletY = startY - 7.5;
    
    const trailLine = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    trailLine.setAttribute('stroke', '#FF0000');
    trailLine.setAttribute('stroke-width', '5');
    trailLine.setAttribute('fill', 'none');
    trailLine.setAttribute('stroke-linecap', 'round');
    trailLine.setAttribute('stroke-linejoin', 'round');
    const points = [`${startX},${startY}`];
    trailLine.setAttribute('points', points.join(' '));
    trailSvg.appendChild(trailLine);
    
    const flyInterval = setInterval(() => {
        bulletX += vx;
        bulletY += vy;
        
        bullet.style.left = bulletX + 'px';
        bullet.style.top = bulletY + 'px';
        
        points.push(`${bulletX + 7.5},${bulletY + 7.5}`);
        trailLine.setAttribute('points', points.join(' '));
        
        const bulletRect = bullet.getBoundingClientRect();
        let hit = false;
        let hitMosquito = null;
        const hitMosquitoes = [];
        
        gameState.mosquitoes.forEach(m => {
            const mosquitoRect = m.element.getBoundingClientRect();
            if (bulletRect.left < mosquitoRect.right &&
                bulletRect.right > mosquitoRect.left &&
                bulletRect.top < mosquitoRect.bottom &&
                bulletRect.bottom > mosquitoRect.top) {
                hitMosquitoes.push(m);
            }
        });
        
        if (hitMosquitoes.length > 0) {
            hit = true;
            hitMosquito = hitMosquitoes[Math.floor(Math.random() * hitMosquitoes.length)];
            const m = hitMosquito;
            
            if (m.properties.health) {
                m.properties.currentHealth -= 50;
                updateHealthBar(m);
                pauseBGM();
                zapperSound.currentTime = 0;
                zapperSound.play();
                zapperSound.onended = resumeBGM;
                
                if (m.properties.currentHealth <= 0) {
                    m.element.style.transform = 'scale(1.5)';
                    m.element.style.opacity = '0';
                    addScore(m.id);
                } else {
                    m.element.style.filter = 'brightness(2)';
                    setTimeout(() => { m.element.style.filter = 'brightness(1)'; }, 200);
                }
            } else {
                m.element.style.transform = 'scale(1.5)';
                m.element.style.opacity = '0';
                addScore(m.id);
                pauseBGM();
                zapperSound.currentTime = 0;
                zapperSound.play();
                zapperSound.onended = resumeBGM;
            }
        }
        
        if (hitMosquito) {
            setTimeout(() => {
                if (!hitMosquito.properties.health || hitMosquito.properties.currentHealth <= 0) {
                    hitMosquito.element.remove();
                    const index = gameState.mosquitoes.indexOf(hitMosquito);
                    if (index > -1) gameState.mosquitoes.splice(index, 1);
                    updateRadarDots();
                    const aliveMosquitoes = gameState.mosquitoes.filter(m => 
                        m.element.style.opacity !== '0' && m.element.parentNode
                    );
                    if (aliveMosquitoes.length === 0) showGameOver();
                }
            }, 500);
            updateRadarDots();
        }
        
        if (bulletX < -20 || bulletX > gameAreaRect.width + 20 ||
            bulletY < -20 || bulletY > gameAreaRect.height + 20 || hit) {
            clearInterval(flyInterval);
            bullet.remove();
            setTimeout(() => { trailLine.remove(); }, 300);
        }
    }, 20);
}

// 显示关卡结束界面
function showGameOver(reason = 'win') {
    if (gameOverModal.style.display === 'flex') return;
    // 胜利路径防重复：多个子弹/导弹在500ms窗口内同时击杀最后蚊子会导致多次触发
    if (reason !== 'lose' && gameState.winProcessed) return;
    gameState.gameOverReason = reason;
    if (reason !== 'lose') gameState.winProcessed = true;
    
    // 停止背景音乐
    pauseBGM();
    bgmStarted = false;
    zapperSound.onended = null;
    meizidanSound.onended = null;
    saveHighScore();
    
    if (reason === 'lose') {
        // 失败：显示原弹窗
        gameOverModal.style.display = 'flex';
        const gameOverText = document.querySelector('#gameOverModal .modal-content h2');
        const gameOverMessage = document.querySelector('#gameOverModal .modal-content p');
        const restartButton = document.querySelector('#gameOverModal .modal-content button');
        if (gameOverText) gameOverText.textContent = '游戏结束';
        if (gameOverMessage) gameOverMessage.textContent = '是否重新再来？';
        if (restartButton) restartButton.textContent = '重新开始';
        gameState.level = 1;
        gameState.score = 0;
        gameState.playerHealth = gameState.maxPlayerHealth;
        gameState.activeReward = null;
        gameState.shieldActive = false;
        gameState.shieldPower = 0;
    } else {
        // 胜利：显示水晶球
        showCrystalBall();
        gameState.level += 1;
    }
    
    gameState.power = 50;
    gameState.cannonAngle = -90;
    updateScore();
    updatePlayerHealth();
    updatePowerBar();
    if (cannonBarrel) cannonBarrel.style.transform = `rotate(${gameState.cannonAngle}deg)`;
    
    if (reason !== 'lose') {
        loadLevelImages(gameState.level).then(() => {
            console.log('Preloaded images for level', gameState.level);
        }).catch(err => console.warn('Preload error:', err));
    }
}

// 停止所有游戏循环（水晶球倒计时期间暂停游戏）
function stopAllGameLoops() {
    gameState.gamePaused = true;
    
    if (mosquitoMoveInterval) { clearInterval(mosquitoMoveInterval); mosquitoMoveInterval = null; }
    if (mosquitoHealInterval) { clearInterval(mosquitoHealInterval); mosquitoHealInterval = null; }
    if (mosquitoAttackInterval) { clearInterval(mosquitoAttackInterval); mosquitoAttackInterval = null; }
    if (mosquitoCloneTimeout) { clearTimeout(mosquitoCloneTimeout); mosquitoCloneTimeout = null; }
    if (gameState.powerTimer) { clearInterval(gameState.powerTimer); gameState.powerTimer = null; }
    if (gameState.healthTimer) { clearInterval(gameState.healthTimer); gameState.healthTimer = null; }
    if (gameState.energyTimer) { clearInterval(gameState.energyTimer); gameState.energyTimer = null; }
    
    pauseBGM();
    bgmStarted = false;
    
    // 清除场上所有蚊子
    gameState.mosquitoes.forEach(m => {
        if (m.element && m.element.parentNode) m.element.remove();
    });
    gameState.mosquitoes = [];
    updateRadarDots();
}

// 水晶球奖励界面
function showCrystalBall() {
    const level = gameState.level;
    const reward = applyReward(level);
    
    // 创建遮罩
    const overlay = document.createElement('div');
    overlay.className = 'crystal-overlay';
    overlay.id = 'crystalOverlay';
    
    // 水晶球容器（从上方飘入）
    const ball = document.createElement('div');
    ball.className = 'crystal-ball';
    ball.innerHTML = `
        <div class="crystal-glow"></div>
        <div class="crystal-inner">
            <span class="crystal-text">点击领取</span>
            <span class="crystal-level">第 ${level} 关奖励</span>
        </div>
    `;
    overlay.appendChild(ball);
    document.body.appendChild(overlay);
    
    // 点击任意位置领取奖励并开始3秒倒计时
    const claimReward = () => {
        overlay.removeEventListener('click', claimReward);
        overlay.removeEventListener('touchstart', claimReward);
        
        // 立即暂停游戏：停止所有循环、清除蚊子、停止BGM
        stopAllGameLoops();
        
        ball.classList.add('crystal-open');
        const rewardText = reward ? reward.text : `分数奖励 +${100 + level * 10}`;
        const rewardScore = reward ? reward.score : (100 + level * 10);
        ball.innerHTML = `
            <div class="crystal-glow"></div>
            <div class="crystal-inner reward-shown">
                <span class="crystal-reward-title">获得奖励</span>
                <span class="crystal-reward-text">${rewardText}</span>
                <span class="crystal-reward-score">+${rewardScore} 分</span>
                <span class="crystal-countdown" id="crystalCountdown">3</span>
            </div>
        `;
        gameState.score += rewardScore;
        updateScore();
        
        // 3秒倒计时，结束后自动进入下一关
        let count = 3;
        const countdownEl = document.getElementById('crystalCountdown');
        const countdownInterval = setInterval(() => {
            count--;
            if (count <= 0) {
                clearInterval(countdownInterval);
                overlay.remove();
                proceedToNextLevel();
            } else {
                countdownEl.textContent = count;
            }
        }, 1000);
    };
    
    overlay.addEventListener('click', claimReward);
    overlay.addEventListener('touchstart', claimReward);
}

// 进入下一关
function proceedToNextLevel() {
    gameState.gamePaused = false;
    gameState.cannonAngle = -90;
    gameState.power = 50;
    gameState.energy = 100;
    cannonBarrel.style.transform = `rotate(${gameState.cannonAngle}deg)`;
    updatePowerBar();
    updateEnergyBar();
    updateLevel();
    updateScore();
    updatePlayerHealth();
    
    laserActive = false;
    if (laserLine) laserLine = null;
    if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
    lastTapTime = Date.now();
    lastFireTime = Date.now();
    
    if (loadingModal) loadingModal.style.display = 'flex';
    loadLevelImages(gameState.level).then(() => {
        console.log('Images loaded for level', gameState.level);
    }).catch(err => console.warn('Load error:', err)).finally(() => {
        if (loadingModal) loadingModal.style.display = 'none';
    });
    
    updateBackground();
    while (trailSvg.firstChild) trailSvg.removeChild(trailSvg.firstChild);
    spawnMosquitoes();
    startMosquitoMovement();
    startPowerCharging();
    bgmStarted = true;
    resumeBGM();
}
async function restartGame() {
    gameOverModal.style.display = 'none';
    gameState.winProcessed = false;
    // 重置游戏状态（保持level不变，因为showGameOver已经设置了正确的level）
    gameState.cannonAngle = -90;
    // 只有血条空了才补满血量，正常过关时保持当前血量
    if (gameState.gameOverReason === 'lose') {
        gameState.playerHealth = gameState.maxPlayerHealth; // 恢复血量
    }
    gameState.power = 50; // 重置电力
    gameState.energy = 100; // 重置能量
    cannonBarrel.style.transform = `rotate(${gameState.cannonAngle}deg)`;
    updatePowerBar();
    updateEnergyBar();
    updateLevel();
    updateScore();
    updatePlayerHealth();
    
    // 重置激光瞄准线变量
    laserActive = false;
    if (laserLine) {
        laserLine = null;
    }
    if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
    }
    
    // 重置双击检测的时间戳
    lastTapTime = Date.now();
    lastFireTime = Date.now();
    
    // 显示加载界面
    if (loadingModal) {
        loadingModal.style.display = 'flex';
    }
    
    try {
        // 预加载当前轮次的图片
        await loadLevelImages(gameState.level);
        console.log('Images loaded successfully for level', gameState.level);
    } catch (error) {
        console.warn('Error loading images:', error);
    } finally {
        // 隐藏加载界面
        if (loadingModal) {
            loadingModal.style.display = 'none';
        }
    }
    
    updateBackground();
    
    // 清除所有轨迹线
    while (trailSvg.firstChild) {
        trailSvg.removeChild(trailSvg.firstChild);
    }
    
    // 如果是过关（非失败），显示准备界面等待点击
    if (gameState.gameOverReason !== 'lose') {
        gameState.gamePaused = false;
        spawnMosquitoes();
        startMosquitoMovement();
        startPowerCharging();
        bgmStarted = true;
        resumeBGM();
    } else {
        // 失败重开直接生成蚊子
        spawnMosquitoes();
        startMosquitoMovement(); // 添加这行，确保蚊子开始移动
        // 重新开始电力自动增长
        startPowerCharging();
        // 重新开始背景音乐
        bgmStarted = true;
        resumeBGM();
    }
}

// 显示准备界面
function showReadyModal() {
    // 创建准备界面
    const readyModal = document.createElement('div');
    readyModal.id = 'readyModal';
    readyModal.className = 'game-over-modal';
    readyModal.style.display = 'flex';
    readyModal.innerHTML = `
        <div class="modal-content">
            <h2>第 ${gameState.level} 关</h2>
            <p>点击开始游戏</p>
            <button class="restart-btn" id="startLevelBtn">开始</button>
        </div>
    `;
    document.body.appendChild(readyModal);
    
    // 绑定开始按钮事件
    document.getElementById('startLevelBtn').addEventListener('click', () => {
        readyModal.remove();
        spawnMosquitoes();
        startMosquitoMovement(); // 添加这行，确保蚊子开始移动
        // 重新开始电力自动增长
        startPowerCharging();
        // 重新开始背景音乐
        bgmStarted = true;
        resumeBGM();
    });
}

// 矩形碰撞检测
function isColliding(rect1, rect2) {
    return rect1.left < rect2.right &&
           rect1.right > rect2.left &&
           rect1.top < rect2.bottom &&
           rect1.bottom > rect2.top;
}

// 计算点到线段的距离
function distanceToLineSegment(point, lineStart, lineEnd) {
    const A = point.x - lineStart.x;
    const B = point.y - lineStart.y;
    const C = lineEnd.x - lineStart.x;
    const D = lineEnd.y - lineStart.y;
    
    const dot = A * C + B * D;
    const lenSq = C * C + D * D;
    let param = -1;
    
    if (lenSq !== 0) param = dot / lenSq;
    
    let xx, yy;
    if (param < 0) {
        xx = lineStart.x; yy = lineStart.y;
    } else if (param > 1) {
        xx = lineEnd.x; yy = lineEnd.y;
    } else {
        xx = lineStart.x + param * C;
        yy = lineStart.y + param * D;
    }
    
    const dx = point.x - xx;
    const dy = point.y - yy;
    return Math.sqrt(dx * dx + dy * dy);
}

// 找出离线段最近的蚊子
function findClosestMosquitoToLine(lineStart, lineEnd) {
    let closestMosquito = null;
    let minDistance = Infinity;
    
    gameState.mosquitoes.forEach(mosquito => {
        if (mosquito.element.style.opacity === '0') return;
        
        const rect = mosquito.element.getBoundingClientRect();
        const mosquitoPos = {
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2
        };
        
        const distance = distanceToLineSegment(mosquitoPos, lineStart, lineEnd);
        
        if (distance < minDistance) {
            minDistance = distance;
            closestMosquito = mosquito;
        }
    });
    
    return closestMosquito;
}

// 找出离点击位置最近的蚊子
function findClosestMosquitoToPoint(point) {
    let closestMosquito = null;
    let minDistance = Infinity;
    
    gameState.mosquitoes.forEach(mosquito => {
        if (mosquito.element.style.opacity === '0') return;
        
        const rect = mosquito.element.getBoundingClientRect();
        const mosquitoPos = {
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2
        };
        
        const dx = mosquitoPos.x - point.x;
        const dy = mosquitoPos.y - point.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        if (distance < minDistance) {
            minDistance = distance;
            closestMosquito = mosquito;
        }
    });
    
    return closestMosquito;
}

// 标记蚊子
function markMosquito(mosquito) {
    const existingMark = document.querySelector('.mosquito-mark');
    if (existingMark) {
        existingMark.remove();
    }
    
    const rect = mosquito.element.getBoundingClientRect();
    
    const mark = document.createElement('div');
    mark.className = 'mosquito-mark';
    mark.style.position = 'absolute';
    mark.style.left = rect.left + 'px';
    mark.style.top = rect.top + 'px';
    mark.style.width = '30px';
    mark.style.height = '30px';
    mark.style.backgroundImage = 'url(mz.png)';
    mark.style.backgroundSize = 'contain';
    mark.style.backgroundRepeat = 'no-repeat';
    mark.style.zIndex = '999';
    mark.style.pointerEvents = 'none';
    
    document.body.appendChild(mark);
    
    // 持续更新标记位置
    const updateInterval = setInterval(() => {
        if (!mosquito || mosquito.element.style.opacity === '0' || !document.body.contains(mosquito.element)) {
            clearInterval(updateInterval);
            if (mark.parentNode) {
                mark.remove();
            }
            return;
        }
        
        const newRect = mosquito.element.getBoundingClientRect();
        mark.style.left = newRect.left + 'px';
        mark.style.top = newRect.top + 'px';
    }, 16);
}

// 创建追踪飞弹
function createHomingMissile(target) {
    if (!target) return;
    if (!gameState.activeReward || gameState.activeReward.type !== 'homing') return; // 需获得追踪弹奖励
    
    const cannonBase = document.querySelector('.cannon-base');
    const cannonRect = cannonBase.getBoundingClientRect();
    
    const startX = cannonRect.left - 30;
    const startY = cannonRect.top + cannonRect.height / 2;
    
    const missile = document.createElement('div');
    missile.className = 'homing-missile';
    missile.style.position = 'absolute';
    missile.style.left = startX + 'px';
    missile.style.top = startY + 'px';
    missile.style.width = '15px';
    missile.style.height = '6px';
    missile.style.background = 'linear-gradient(90deg, #ff6b6b, #ff8e53)';
    missile.style.borderRadius = '2px';
    missile.style.zIndex = '999';
    missile.style.pointerEvents = 'none';
    
    document.body.appendChild(missile);
    
    let currentX = startX;
    let currentY = startY;
    let angle = 0;
    let speed = 6;
    let turningRate = 0.1;
    
    const flyInterval = setInterval(() => {
        if (!target) {
            clearInterval(flyInterval);
            missile.remove();
            return;
        }
        
        // 获取目标蚊子位置
        const targetRect = target.element.getBoundingClientRect();
        const targetX = targetRect.left + targetRect.width / 2;
        const targetY = targetRect.top + targetRect.height / 2;
        
        // 计算目标方向
        let dx = targetX - currentX;
        let dy = targetY - currentY;
        let targetAngle = Math.atan2(dy, dx);
        
        // 避开非目标蚊子
        let avoidanceAngle = 0;
        let avoidanceStrength = 0.2;
        
        gameState.mosquitoes.forEach(mosquito => {
            if (mosquito === target) return;
            
            const mosquitoRect = mosquito.element.getBoundingClientRect();
            const mosquitoX = mosquitoRect.left + mosquitoRect.width / 2;
            const mosquitoY = mosquitoRect.top + mosquitoRect.height / 2;
            
            // 计算与非目标蚊子的距离
            const distX = mosquitoX - currentX;
            const distY = mosquitoY - currentY;
            const distance = Math.sqrt(distX * distX + distY * distY);
            
            // 如果距离小于阈值，计算避开角度
            if (distance < 50) {
                const avoidanceDist = 50 - distance;
                const avoidAngle = Math.atan2(distY, distX) + Math.PI; // 相反方向
                avoidanceAngle += Math.sin(avoidAngle) * (avoidanceDist / 50) * avoidanceStrength;
            }
        });
        
        // 应用避开角度
        targetAngle += avoidanceAngle;
        
        // 平滑调整角度
        angle += (targetAngle - angle) * turningRate;
        
        // 更新位置
        currentX += Math.cos(angle) * speed;
        currentY += Math.sin(angle) * speed;
        
        // 更新追踪弹位置和角度
        missile.style.left = currentX + 'px';
        missile.style.top = currentY + 'px';
        missile.style.transform = `rotate(${angle * 180 / Math.PI}deg)`;
        
        // 检查与目标蚊子的碰撞
        const missileRect = missile.getBoundingClientRect();
        
        if (isColliding(missileRect, targetRect)) {
            clearInterval(flyInterval);
            missile.remove();
            
            // 移除标记
            const mark = document.querySelector('.mosquito-mark');
            if (mark) {
                mark.remove();
            }
            
            // 检查是否是3号蚊子（有血条）
            if (target.properties.health) {
                target.properties.currentHealth = 0;
                updateHealthBar(target);
                
                pauseBGM();
                zapperSound.currentTime = 0;
                zapperSound.play();
                zapperSound.onended = resumeBGM;
                
                target.element.style.transform = 'scale(1.5)';
                target.element.style.opacity = '0';
                addScore(target.id);
            } else {
                target.element.style.transform = 'scale(1.5)';
                target.element.style.opacity = '0';
                addScore(target.id);
                
                pauseBGM();
                zapperSound.currentTime = 0;
                zapperSound.play();
                zapperSound.onended = resumeBGM;
            }
            
            // 延迟移除蚊子
            setTimeout(() => {
                if (!target.properties.health || target.properties.currentHealth <= 0) {
                    target.element.remove();
                    const index = gameState.mosquitoes.indexOf(target);
                    if (index > -1) {
                        gameState.mosquitoes.splice(index, 1);
                    }
                    updateRadarDots();
                    
                    const aliveMosquitoes = gameState.mosquitoes.filter(m => 
                        m.element.style.opacity !== '0' && m.element.parentNode
                    );
                    if (aliveMosquitoes.length === 0) {
                        showGameOver();
                    }
                }
            }, 500);
        }
        
        if (currentX < -50 || currentX > window.innerWidth + 50 ||
            currentY < -50 || currentY > window.innerHeight + 50) {
            clearInterval(flyInterval);
            missile.remove();
        }
    }, 10);
}

// 绑定重新开始按钮事件
restartBtn.addEventListener('click', restartGame);

// 窗口大小改变时重新初始化画布
window.addEventListener('resize', () => {
    initCanvas();
});

// 启动游戏
window.addEventListener('load', () => {
    setTimeout(() => {
        init();
    }, 100);
});
