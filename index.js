require("http").createServer((_, r) => r.end("Bot Active")).listen(process.env.PORT || 8080);
const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason
} = require('@whiskeysockets/baileys');
const pino = require('pino');

// ==========================================
// ⚙️ إعدادات الفعالية والقروب
// ==========================================
// الرقم المخصص لربط البوت عبر رمز الاقتران (بالمفتاح الدولي بدون +)
const BOT_PHONE_NUMBER = "967717098784";

// رابط القروب المسموح باللعب فيه فقط
const GAME_GROUP_INVITE_LINKS = [
    "https://chat.whatsapp.com/LK4XcUo0JOa1sveWGl5bJR"
];

const REGISTRATION_TIME = 45;   
const TRANSITION_TIME = 45;     
const MOVE_TIMEOUT = 45;        
const DIFFICULTY_TIMEOUT = 90;  

// تسجيل وقت تشغيل البوت مع خصم 60 ثانية لتفادي فرق التوقيت
const BOT_START_TIME = Math.floor(Date.now() / 1000) - 60;

// ==========================================
// 🧠 أدوات مساعدة عامة
// ==========================================
const INITIAL_BOARD = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣'];

function toWesternDigits(text) {
    if (!text) return "";
    const easternMap = { '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9' };
    return text.replace(/[٠-٩]/g, (d) => easternMap[d]);
}

function normalizeText(text) {
    if (!text) return "";
    return toWesternDigits(text)
        .trim()
        .toLowerCase()
        .replace(/[أإآٱ]/g, 'ا')
        .replace(/ة/g, 'ه')
        .replace(/ى/g, 'ي')
        .replace(/[\u064B-\u0652]/g, '')
        .replace(/[.,!؟?]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function containsAny(text, keywords) {
    return keywords.some((word) => text.includes(word));
}

function isOccupied(cell) {
    return cell === '❌' || cell === '⭕';
}

// ==========================================
// 📚 قوائم المفردات
// ==========================================
const XO_WORDS = ['اكس او', 'اكسو', 'إكس او', 'إكسو', 'xo', 'x o', 'اكس أو'];
const EVENT_WORDS = ['فعاليه', 'فعالية', 'بطوله', 'بطولة', 'مسابقه', 'مسابقة', 'دوري', 'لعبه', 'لعبة'];
const START_VERBS = ['ابدا', 'ابدأ', 'شغل', 'تشغيل', 'يلا نبدأ', 'يلا نبدا'];
const PVP_HINT_WORDS = ['لاعب', 'لاعبين', 'ثنائي', 'ضد بعض', 'اثنين', 'مع بعض'];

const JOIN_OR_CONTINUE_WORDS = [
    'مشاركه', 'مشاركة', 'اشارك', 'أشارك', 'انضمام', 'انضم', 'ادخلني', 'سجلني',
    'مواصله', 'مواصلة', 'واصل', 'استمرار', 'استمر', 'كمل', 'تكمله', 'تكملة'
];

const QUICK_START_WORDS = [
    'هيا ابدا', 'يلا ابدا', 'يلا سريع', 'ابدا سريع', 'قفل التسجيل', 'خلص سجل',
    'ابدا الان', 'ابدا حالا', 'كفايه انتظار', 'كفاية انتظار'
];

const DIFFICULTY_WORDS = {
    EASY: ['سهل', 'سهله', 'السهل', 'سهلة', 'ايزي', 'ساهل'],
    MEDIUM: ['متوسط', 'متوسطه', 'المتوسط', 'متوسطة', 'عادي', 'عاديه'],
    HARD: ['صعب', 'صعبه', 'الصعب', 'صعبة', 'قوي', 'هارد', 'تحدي']
};

const END_WORDS = ['انهاء الفعالية', 'انهاء الفعاليه', 'إنهاء الفعالية', 'إلغاء الفعالية', 'انهاء', 'إلغاء'];

function parseStartCommand(cleanText) {
    const hasXO = containsAny(cleanText, XO_WORDS);
    if (!hasXO) return null;
    const hasEvent = containsAny(cleanText, EVENT_WORDS) || containsAny(cleanText, START_VERBS);
    if (!hasEvent) return null;
    const isPvp = containsAny(cleanText, PVP_HINT_WORDS);
    return { mode: isPvp ? 'PVP' : 'BOT' };
}

function detectDifficulty(cleanText) {
    if (containsAny(cleanText, DIFFICULTY_WORDS.EASY)) return 'EASY';
    if (containsAny(cleanText, DIFFICULTY_WORDS.MEDIUM)) return 'MEDIUM';
    if (containsAny(cleanText, DIFFICULTY_WORDS.HARD)) return 'HARD';
    return null;
}

// ==========================================
// 🔗 حل رابط القروب
// ==========================================
const groupLinkCache = new Map();

function extractInviteCode(link) {
    const match = link.match(/chat\.whatsapp\.com\/([A-Za-z0-9]+)/);
    return match ? match[1] : null;
}

async function resolveGroupFromLink(sock, link) {
    if (groupLinkCache.has(link)) return groupLinkCache.get(link);
    const code = extractInviteCode(link);
    if (!code) return null;

    let jid = null;
    try {
        jid = await sock.groupAcceptInvite(code);
    } catch (err) {
        try {
            const info = await sock.groupGetInviteInfo(code);
            jid = info.id;
        } catch (err2) {
            console.error('⚠️ تعذر تحديد القروب من الرابط:', link, err2?.message || err2);
        }
    }

    if (jid) groupLinkCache.set(link, jid);
    return jid;
}

let GAME_GROUP_IDS = new Set();

async function resolveConfiguredGroups(sock) {
    GAME_GROUP_IDS = new Set();
    for (const link of GAME_GROUP_INVITE_LINKS) {
        const id = await resolveGroupFromLink(sock, link);
        if (id) {
            GAME_GROUP_IDS.add(id);
            console.log('✅ تم ربط القروب المسموح به بنجاح:', id);
        }
    }
}

// ==========================================
// 🎮 مدير الفعالية
// ==========================================
class XOGameManager {
    constructor() {
        this.resetAll();
    }

    clearAllActiveTimers() {
        if (this.activeGames) {
            this.activeGames.forEach((g) => {
                if (g.diffReminderTimer) clearInterval(g.diffReminderTimer);
                if (g.autoDifficultyTimer) clearTimeout(g.autoDifficultyTimer);
                if (g.moveTimer) clearTimeout(g.moveTimer);
            });
        }
        if (this.pvpMatches) {
            this.pvpMatches.forEach((m) => {
                if (m.moveTimer) clearTimeout(m.moveTimer);
            });
        }
        if (this.registrationTimer) clearTimeout(this.registrationTimer);
        if (this.transitionTimer) clearTimeout(this.transitionTimer);
    }

    resetAll() {
        this.clearAllActiveTimers();
        this.state = 'IDLE'; 
        this.mode = null;    
        this.players = new Map();
        this.activeGames = new Map();
        this.pvpMatches = [];
        this.pvpBySender = new Map();
        this.registrationTimer = null;
        this.transitionTimer = null;
    }

    startRegistration(sock, chatId, mode) {
        if (this.state !== 'IDLE') {
            return sock.sendMessage(chatId, { text: '⚠️ الفعالية جارية بالفعل حالياً!' });
        }

        this.resetAll();
        this.state = 'REGISTRATION';
        this.mode = mode;

        const modeText = mode === 'PVP' ? 'لاعب ضد لاعب ⚔️' : 'ضد البوت 🤖';
        const msg = `🎮 *بدأت فعالية إكس أوه (XO)!*\n\n` +
            `🕹️ *وضع اللعب:* ${modeText}\n` +
            `⏱️ باب التسجيل مفتوح الآن لمدة *${REGISTRATION_TIME} ثانية*.\n` +
            `أرسل كلمة *( مشاركة )* للإنضمام، أو *( هيا ابدأ )* لإغلاق التسجيل فوراً.`;

        sock.sendMessage(chatId, { text: msg });

        this.registrationTimer = setTimeout(() => {
            this.finishRegistration(sock, chatId);
        }, REGISTRATION_TIME * 1000);
    }

    finishRegistration(sock, chatId) {
        if (this.registrationTimer) {
            clearTimeout(this.registrationTimer);
            this.registrationTimer = null;
        }

        if (this.players.size === 0) {
            this.resetAll();
            return sock.sendMessage(chatId, { text: '❌ تم إلغاء الفعالية لعدم انضمام أي لاعبين.' });
        }

        if (this.mode === 'PVP' && this.players.size < 2) {
            this.mode = 'BOT';
            sock.sendMessage(chatId, { text: '⚠️ عدد اللاعبين غير كافٍ لوضع (لاعب ضد لاعب)، سيتم اللعب ضد البوت بدلاً من ذلك.' });
        }

        this.state = 'IN_GAME';

        let playerList = '';
        const mentions = [];
        this.players.forEach((player) => {
            playerList += `▫️ @${player.phone} (${player.name})\n`;
            mentions.push(player.id);
        });

        const modeText = this.mode === 'PVP' ? 'لاعب ضد لاعب ⚔️' : 'ضد البوت 🤖';
        const startMsg = `🚨 *انتهت فترة التسجيل!*\n\n` +
            `🕹️ *وضع اللعب:* ${modeText}\n` +
            `عدد المشاركين: *${this.players.size} لاعب*\n` +
            `قائمة اللاعبين:\n${playerList}`;

        sock.sendMessage(chatId, { text: startMsg, mentions });

        const allIds = Array.from(this.players.keys());
        if (this.mode === 'PVP') {
            this.startPvpRound(sock, chatId, allIds);
        } else {
            sock.sendMessage(chatId, {
                text: `🎯 *المطلوب من كل لاعب الآن:* أرسل مستوى الصعوبة بكلمة واحدة:\n▪️ *( سهل )*\n▪️ *( متوسط )*\n▪️ *( صعب )*`
            });
            allIds.forEach((id) => this.initPlayerGame(sock, chatId, id));
        }
    }

    startNextRound(sock, chatId) {
        if (this.transitionTimer) {
            clearTimeout(this.transitionTimer);
            this.transitionTimer = null;
        }

        const continuingIds = Array.from(this.players.entries())
            .filter(([, p]) => p.hasContinued)
            .map(([id]) => id);

        if (continuingIds.length === 0) {
            sock.sendMessage(chatId, { text: '⏹️ لم يواصل أي لاعب، سيتم إنهاء الفعالية تلقائياً.' });
            return this.endEvent(sock, chatId);
        }

        this.state = 'IN_GAME';
        this.activeGames = new Map();
        this.pvpMatches = [];
        this.pvpBySender = new Map();

        let listText = '';
        continuingIds.forEach((id) => {
            const p = this.players.get(id);
            listText += `▫️ @${p.phone} (${p.name})\n`;
        });

        sock.sendMessage(chatId, {
            text: `🔄 *بدأت الجولة الجديدة!*\n\nعدد المستمرين: *${continuingIds.length}*\n${listText}`,
            mentions: continuingIds
        });

        if (this.mode === 'PVP') {
            this.startPvpRound(sock, chatId, continuingIds);
        } else {
            sock.sendMessage(chatId, {
                text: `🎯 أرسل مستوى الصعوبة من جديد: *سهل* / *متوسط* / *صعب*`
            });
            continuingIds.forEach((id) => this.initPlayerGame(sock, chatId, id));
        }
    }

    quickStart(sock, chatId, senderId) {
        const phone = senderId.split('@')[0];

        if (this.state === 'REGISTRATION') {
            sock.sendMessage(chatId, { text: `⚡ تم إغلاق باب التسجيل مبكراً بطلب من @${phone}!`, mentions: [senderId] });
            return this.finishRegistration(sock, chatId);
        }

        if (this.state === 'TRANSITION') {
            sock.sendMessage(chatId, { text: `⚡ سيتم بدء الجولة القادمة الآن مباشرة بطلب من @${phone}!`, mentions: [senderId] });
            return this.startNextRound(sock, chatId);
        }
    }

    handleJoinOrContinue(sock, chatId, senderId, pushName) {
        const cleanName = pushName || 'لاعب';
        const phone = senderId.split('@')[0];

        if (this.state === 'REGISTRATION') {
            if (this.players.has(senderId)) return;

            this.players.set(senderId, {
                id: senderId, name: cleanName, phone,
                wins: 0, draws: 0, losses: 0, gamesPlayed: 0, hasContinued: true
            });

            return sock.sendMessage(chatId, { text: `✅ تم تسجيلك بنجاح @${phone} (${cleanName})!`, mentions: [senderId] });
        }

        if (this.state === 'TRANSITION') {
            const player = this.players.get(senderId);

            if (player) {
                player.hasContinued = true;
                return sock.sendMessage(chatId, {
                    text: `✅ تم تسجيل مواصلتك بالجولة الجديدة يا @${phone}!`,
                    mentions: [senderId]
                });
            }

            this.players.set(senderId, {
                id: senderId, name: cleanName, phone,
                wins: 0, draws: 0, losses: 0, gamesPlayed: 0, hasContinued: true
            });

            return sock.sendMessage(chatId, { text: `✅ تم انضمامك كلاعب جديد @${phone} للجولة القادمة!`, mentions: [senderId] });
        }
    }

    recordResult(playerId, result) {
        const p = this.players.get(playerId);
        if (!p) return;
        p.gamesPlayed++;
        if (result === 'WIN') p.wins++;
        else if (result === 'LOSS') p.losses++;
        else p.draws++;
    }

    initPlayerGame(sock, chatId, senderId) {
        const player = this.players.get(senderId);
        if (!player) return;

        const gameObject = {
            board: [...INITIAL_BOARD],
            difficulty: null,
            isFinished: false,
            moveTimer: null,
            diffReminderTimer: null,
            autoDifficultyTimer: null
        };

        this.activeGames.set(senderId, gameObject);

        gameObject.autoDifficultyTimer = setTimeout(() => {
            if (!gameObject.difficulty && !gameObject.isFinished) {
                sock.sendMessage(chatId, {
                    text: `⌛ تم تعيين المستوى (متوسط) تلقائياً للاعب @${senderId.split('@')[0]}.`,
                    mentions: [senderId]
                });
                this.setDifficulty(sock, chatId, senderId, 'MEDIUM');
            }
        }, DIFFICULTY_TIMEOUT * 1000);
    }

    setDifficulty(sock, chatId, senderId, difficulty) {
        if (this.pvpBySender.has(senderId)) return;

        const game = this.activeGames.get(senderId);
        const player = this.players.get(senderId);
        if (!game || game.isFinished || game.difficulty) return;

        game.difficulty = difficulty;
        if (game.diffReminderTimer) clearInterval(game.diffReminderTimer);
        if (game.autoDifficultyTimer) clearTimeout(game.autoDifficultyTimer);

        const diffArabic = difficulty === 'EASY' ? 'سهل 🟢' : difficulty === 'MEDIUM' ? 'متوسط 🟡' : 'صعب 🔴';

        const msg = `🎯 *تم اختيار المستوى:* ${diffArabic}\n` +
            `👤 *اللاعب:* @${player.phone}\n` +
            `دورك الآن! أرسل رقم المربع (1-9):\n\n` +
            this.formatBoard(game.board);

        sock.sendMessage(chatId, { text: msg, mentions: [senderId] });
        this.startMoveTimer(sock, chatId, senderId);
    }

    makePlayerMove(sock, chatId, senderId, position) {
        const game = this.activeGames.get(senderId);
        const player = this.players.get(senderId);

        if (!game || game.isFinished || !game.difficulty) return;

        const idx = position - 1;
        if (isOccupied(game.board[idx])) {
            return sock.sendMessage(chatId, {
                text: `⚠️ المربع [${position}] مشغول يا @${player.phone}! اختر غيره.`,
                mentions: [senderId]
            });
        }

        if (game.moveTimer) clearTimeout(game.moveTimer);

        game.board[idx] = '❌';

        if (this.checkWin(game.board, '❌')) {
            this.recordResult(senderId, 'WIN');
            game.isFinished = true;
            this.sendGameResult(sock, chatId, senderId, 'WIN');
            this.checkAllGamesFinished(sock, chatId);
            return;
        }

        if (this.isBoardFull(game.board)) {
            this.recordResult(senderId, 'DRAW');
            game.isFinished = true;
            this.sendGameResult(sock, chatId, senderId, 'DRAW');
            this.checkAllGamesFinished(sock, chatId);
            return;
        }

        const botMove = this.getBotMove(game.board, game.difficulty);
        if (botMove !== -1) {
            game.board[botMove] = '⭕';
        }

        if (this.checkWin(game.board, '⭕')) {
            this.recordResult(senderId, 'LOSS');
            game.isFinished = true;
            this.sendGameResult(sock, chatId, senderId, 'LOSS');
            this.checkAllGamesFinished(sock, chatId);
            return;
        }

        if (this.isBoardFull(game.board)) {
            this.recordResult(senderId, 'DRAW');
            game.isFinished = true;
            this.sendGameResult(sock, chatId, senderId, 'DRAW');
            this.checkAllGamesFinished(sock, chatId);
            return;
        }

        const msg = `🎮 *دورك يا @${player.phone}:*\n\n` + this.formatBoard(game.board);
        sock.sendMessage(chatId, { text: msg, mentions: [senderId] });
        this.startMoveTimer(sock, chatId, senderId);
    }

    startMoveTimer(sock, chatId, senderId) {
        const game = this.activeGames.get(senderId);
        const player = this.players.get(senderId);
        if (!game) return;

        if (game.moveTimer) clearTimeout(game.moveTimer);
        game.moveTimer = setTimeout(() => {
            if (!game.isFinished) {
                game.isFinished = true;
                this.recordResult(senderId, 'LOSS');

                sock.sendMessage(chatId, {
                    text: `⏰ انتهى وقت اللاعب @${player.phone}! احتسبت خسارة الجولة.`,
                    mentions: [senderId]
                });

                this.checkAllGamesFinished(sock, chatId);
            }
        }, MOVE_TIMEOUT * 1000);
    }

    sendGameResult(sock, chatId, senderId, result) {
        const game = this.activeGames.get(senderId);
        const player = this.players.get(senderId);

        let resText = '';
        if (result === 'WIN') resText = `🎉 *فزت على البوت يا @${player.phone}!* 🏆`;
        if (result === 'LOSS') resText = `🤖 *فاز البوت عليك يا @${player.phone}.* 💔`;
        if (result === 'DRAW') resText = `🤝 *تعادل مع البوت يا @${player.phone}!*`;

        const msg = `${resText}\n\n*اللوحة النهائية:*\n` + this.formatBoard(game.board);
        sock.sendMessage(chatId, { text: msg, mentions: [senderId] });
    }

    startPvpRound(sock, chatId, ids) {
        const shuffled = [...ids].sort(() => Math.random() - 0.5);

        let pairText = '';
        const allMentioned = [...shuffled];

        for (let i = 0; i < shuffled.length; i += 2) {
            if (i + 1 < shuffled.length) {
                const a = shuffled[i];
                const b = shuffled[i + 1];
                const match = {
                    players: [a, b],
                    board: [...INITIAL_BOARD],
                    symbols: { [a]: '❌', [b]: '⭕' },
                    turn: a,
                    isFinished: false,
                    moveTimer: null
                };
                this.pvpMatches.push(match);
                this.pvpBySender.set(a, match);
                this.pvpBySender.set(b, match);

                const pa = this.players.get(a);
                const pb = this.players.get(b);
                pairText += `⚔️ @${pa.phone} (❌) ضد @${pb.phone} (⭕)\n`;
            } else {
                const a = shuffled[i];
                this.initPlayerGame(sock, chatId, a);
                const pa = this.players.get(a);
                pairText += `🤖 @${pa.phone} سيلعب ضد البوت.\n`;
            }
        }

        sock.sendMessage(chatId, {
            text: `⚔️ *تم تشكيل المباريات:*\n\n${pairText}`,
            mentions: allMentioned
        });

        this.pvpMatches.forEach((match) => {
            const first = this.players.get(match.turn);
            const msg = `🎮 دور @${first.phone} للبدء (❌):\n\n` + this.formatBoard(match.board);
            sock.sendMessage(chatId, { text: msg, mentions: [match.turn] });
            this.startPvpMoveTimer(sock, chatId, match);
        });
    }

    handlePvpMove(sock, chatId, senderId, position) {
        const match = this.pvpBySender.get(senderId);
        if (!match || match.isFinished) return;

        const player = this.players.get(senderId);

        if (match.turn !== senderId) return;

        const idx = position - 1;
        if (isOccupied(match.board[idx])) {
            return sock.sendMessage(chatId, {
                text: `⚠️ المربع [${position}] مشغول يا @${player.phone}!`,
                mentions: [senderId]
            });
        }

        if (match.moveTimer) clearTimeout(match.moveTimer);

        const mySymbol = match.symbols[senderId];
        match.board[idx] = mySymbol;
        const opponentId = match.players.find((p) => p !== senderId);
        const opponent = this.players.get(opponentId);

        if (this.checkWin(match.board, mySymbol)) {
            match.isFinished = true;
            this.recordResult(senderId, 'WIN');
            this.recordResult(opponentId, 'LOSS');
            sock.sendMessage(chatId, {
                text: `🎉 *مبروك @${player.phone}! فزت على @${opponent.phone}* 🏆\n\n*اللوحة النهائية:*\n${this.formatBoard(match.board)}`,
                mentions: [senderId, opponentId]
            });
            return this.checkAllGamesFinished(sock, chatId);
        }

        if (this.isBoardFull(match.board)) {
            match.isFinished = true;
            this.recordResult(senderId, 'DRAW');
            this.recordResult(opponentId, 'DRAW');
            sock.sendMessage(chatId, {
                text: `🤝 *تعادل بين @${player.phone} و @${opponent.phone}!*\n\n*اللوحة النهائية:*\n${this.formatBoard(match.board)}`,
                mentions: [senderId, opponentId]
            });
            return this.checkAllGamesFinished(sock, chatId);
        }

        match.turn = opponentId;
        sock.sendMessage(chatId, {
            text: `🎮 دور @${opponent.phone} الآن:\n\n${this.formatBoard(match.board)}`,
            mentions: [opponentId]
        });
        this.startPvpMoveTimer(sock, chatId, match);
    }

    startPvpMoveTimer(sock, chatId, match) {
        if (match.moveTimer) clearTimeout(match.moveTimer);
        match.moveTimer = setTimeout(() => {
            if (match.isFinished) return;
            match.isFinished = true;
            const loserId = match.turn;
            const winnerId = match.players.find((p) => p !== loserId);
            this.recordResult(loserId, 'LOSS');
            this.recordResult(winnerId, 'WIN');
            const lp = this.players.get(loserId);
            const wp = this.players.get(winnerId);
            sock.sendMessage(chatId, {
                text: `⏰ انتهى وقت @${lp.phone}! فوز تلقائي للاعب @${wp.phone}.`,
                mentions: [loserId, winnerId]
            });
            this.checkAllGamesFinished(sock, chatId);
        }, MOVE_TIMEOUT * 1000);
    }

    checkAllGamesFinished(sock, chatId) {
        let allDone = true;
        this.activeGames.forEach((g) => { if (!g.isFinished) allDone = false; });
        this.pvpMatches.forEach((m) => { if (!m.isFinished) allDone = false; });

        if (allDone) {
            this.state = 'TRANSITION';
            this.players.forEach((p) => { p.hasContinued = false; });

            const msg = `🏁 *انتهت جميع مباريات الجولة!*\n\n` +
                `📊 *النتائج الحالية:*\n${this.generateLeaderboardText()}\n\n` +
                `🔄 أرسل *( مواصلة )* للجولة القادمة، أو *( إنهاء الفعالية )* للإغلاق.`;

            sock.sendMessage(chatId, { text: msg, mentions: Array.from(this.players.keys()) });

            if (this.transitionTimer) clearTimeout(this.transitionTimer);
            this.transitionTimer = setTimeout(() => {
                this.startNextRound(sock, chatId);
            }, TRANSITION_TIME * 1000);
        }
    }

    generateLeaderboardText() {
        const sorted = Array.from(this.players.values()).sort((a, b) => {
            if (b.wins !== a.wins) return b.wins - a.wins;
            if (b.draws !== a.draws) return b.draws - a.draws;
            return a.losses - b.losses;
        });

        let text = '';
        const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

        sorted.forEach((p, idx) => {
            const medal = medals[idx] || '▫️';
            text += `${medal} @${p.phone} — 🏆 ${p.wins} | 🤝 ${p.draws} | ❌ ${p.losses}\n`;
        });

        return text;
    }

    async endEvent(sock, chatId) {
        if (this.state === 'IDLE') return;

        const finalMsg = `🎉 *تم إنهاء الفعالية!*\n\n` +
            `🏆 *الترتيب النهائي:*\n${this.generateLeaderboardText()}\n` +
            `شكراً لمشاركتكم! 👏`;

        await sock.sendMessage(chatId, { text: finalMsg, mentions: Array.from(this.players.keys()) });
        this.resetAll();
    }

    getBotMove(board, difficulty) {
        const emptyIndices = [];
        board.forEach((val, i) => { if (!isOccupied(val)) emptyIndices.push(i); });
        if (emptyIndices.length === 0) return -1;

        const canWinNext = (mark) => {
            for (let idx of emptyIndices) {
                const temp = [...board];
                temp[idx] = mark;
                if (this.checkWin(temp, mark)) return idx;
            }
            return null;
        };

        if (difficulty === 'EASY') {
            return emptyIndices[Math.floor(Math.random() * emptyIndices.length)];
        }

        const winMove = canWinNext('⭕');
        if (winMove !== null) return winMove;

        const blockMove = canWinNext('❌');
        if (blockMove !== null) return blockMove;

        if (difficulty === 'MEDIUM') {
            return emptyIndices[Math.floor(Math.random() * emptyIndices.length)];
        }

        if (emptyIndices.includes(4)) return 4; 

        const corners = [0, 2, 6, 8];
        const emptyCorners = corners.filter(c => emptyIndices.includes(c));
        if (emptyCorners.length > 0) {
            return emptyCorners[Math.floor(Math.random() * emptyCorners.length)];
        }

        return emptyIndices[Math.floor(Math.random() * emptyIndices.length)];
    }

    checkWin(board, mark) {
        const winLines = [
            [0, 1, 2], [3, 4, 5], [6, 7, 8],
            [0, 3, 6], [1, 4, 7], [2, 5, 8],
            [0, 4, 8], [2, 4, 6]
        ];
        return winLines.some((line) => line.every((idx) => board[idx] === mark));
    }

    isBoardFull(board) {
        return board.every((val) => isOccupied(val));
    }

    formatBoard(board) {
        return ` ${board[0]} | ${board[1]} | ${board[2]} \n` +
            `------------------- \n` +
            ` ${board[3]} | ${board[4]} | ${board[5]} \n` +
            `------------------- \n` +
            ` ${board[6]} | ${board[7]} | ${board[8]} `;
    }
}

// ==========================================
// 🗂️ مدير مستقل للقروب
// ==========================================
const managersByChat = new Map();

function getManager(chatId) {
    if (!managersByChat.has(chatId)) {
        managersByChat.set(chatId, new XOGameManager());
    }
    return managersByChat.get(chatId);
}

// ==========================================
// 🚀 تشغيل البوت والربط عبر رمز الاقتران
// ==========================================
async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('./auth_info_baileys');

    const sock = makeWASocket({
        logger: pino({ level: 'silent' }),
        auth: state,
        printQRInTerminal: false
    });

    sock.ev.on('creds.update', saveCreds);

    // إذا لم يكن الحساب مسجلاً مسبقاً، اطلب رمز الاقتران تلقائياً
    if (!sock.authState.creds.registered) {
        setTimeout(async () => {
            try {
                let code = await sock.requestPairingCode(BOT_PHONE_NUMBER);
                code = code?.match(/.{1,4}/g)?.join("-") || code;
                console.log(`\n===================================`);
                console.log(`🔑 رمز الاقتران الخاص بك هو: ${code}`);
                console.log(`===================================\n`);
            } catch (err) {
                console.error('❌ خطأ في الحصول على رمز الاقتران:', err?.message || err);
            }
        }, 3000);
    }

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) startBot();
        } else if (connection === 'open') {
            console.log('✅ تم الاتصال بنجاح! البوت جاهز للعمل.');
            resolveConfiguredGroups(sock);
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        try {
            if (m.type !== 'notify') return;

            const msg = m.messages[0];
            if (!msg || !msg.message || msg.key.fromMe) return;

            const msgTimestamp = msg.messageTimestamp ? Number(msg.messageTimestamp) : 0;
            if (msgTimestamp < BOT_START_TIME) return;

            const chatId = msg.key.remoteJid;

            // السماح فقط بالعمل داخل القروب المحدد
            if (GAME_GROUP_IDS.size > 0 && !GAME_GROUP_IDS.has(chatId)) return;

            const senderId = msg.key.participant || msg.key.remoteJid;
            const pushName = msg.pushName || 'لاعب';

            const rawBody = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
            const cleanText = normalizeText(rawBody);
            if (!cleanText) return;

            const xoManager = getManager(chatId);

            const startCmd = parseStartCommand(cleanText);
            if (startCmd) {
                return xoManager.startRegistration(sock, chatId, startCmd.mode);
            }

            if (xoManager.state === 'IDLE') return;

            if (containsAny(cleanText, END_WORDS)) {
                return xoManager.endEvent(sock, chatId);
            }

            if (xoManager.state === 'REGISTRATION' || xoManager.state === 'TRANSITION') {
                if (containsAny(cleanText, JOIN_OR_CONTINUE_WORDS)) {
                    return xoManager.handleJoinOrContinue(sock, chatId, senderId, pushName);
                }
                if (containsAny(cleanText, QUICK_START_WORDS)) {
                    return xoManager.quickStart(sock, chatId, senderId);
                }
                return;
            }

            if (xoManager.state === 'IN_GAME') {
                const difficulty = detectDifficulty(cleanText);
                if (difficulty && xoManager.mode === 'BOT') {
                    return xoManager.setDifficulty(sock, chatId, senderId, difficulty);
                }

                if (/^[1-9]$/.test(cleanText)) {
                    const move = parseInt(cleanText, 10);
                    if (xoManager.mode === 'PVP' && xoManager.pvpBySender.has(senderId)) {
                        return xoManager.handlePvpMove(sock, chatId, senderId, move);
                    } else if (xoManager.activeGames.has(senderId)) {
                        return xoManager.makePlayerMove(sock, chatId, senderId, move);
                    }
                }
            }

        } catch (err) {
            console.error('خطأ في معالجة الرسالة:', err);
        }
    });
}

startBot();

