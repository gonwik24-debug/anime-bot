const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const http = require('http');
const animeCharacters = require('./characters');

// 1. خادم HTTP لإبقاء Render شغالاً 24 ساعة
const PORT = process.env.PORT || 8080;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot Multi-Games Live!\n');
}).listen(PORT, () => console.log(`Server running on port ${PORT}`));

// متغيرات الألعاب العامة
if (!global.guessGame) global.guessGame = {};
if (!global.userPoints) global.userPoints = {};
if (!global.xoGame) global.xoGame = {};
if (!global.letterGame) global.letterGame = {};

const letters = ['أ', 'ب', 'ت', 'ث', 'ج', 'ح', 'خ', 'د', 'ذ', 'ر', 'ز', 'س', 'ش', 'ص', 'ض', 'ط', 'ظ', 'ع', 'غ', 'ف', 'ق', 'ك', 'ل', 'م', 'ن', 'هـ', 'و', 'ي'];
const categories = ['اسم (إنسان)', 'حيوان', 'نبات', 'جماد', 'بلاد'];

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    const sock = makeWASocket({ auth: state, printQRInTerminal: true });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) startBot();
        } else if (connection === 'open') {
            console.log('✅ Connected successfully!');
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        try {
            const msg = m.messages[0];
            if (!msg || !msg.message || msg.key.fromMe) return;

            const from = msg.key.remoteJid;
            const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').trim();
            const sender = msg.key.participant || msg.key.remoteJid;

            if (!text) return;

            // ==================== 1. لعبة تخمين الأنمي ====================
            if (text === '.تخمين' || text === '.انمي') {
                if (global.guessGame[from]) {
                    return await sock.sendMessage(from, { text: '⚠️ هناك مسابقة تخمين شغالة بالفعل!' });
                }

                const item = animeCharacters[Math.floor(Math.random() * animeCharacters.length)];
                global.guessGame[from] = {
                    item: item,
                    timer: setTimeout(async () => {
                        if (global.guessGame[from]) {
                            await sock.sendMessage(from, { text: `⏰ انتهى الوقت! الإجابة الصحيحة: *${item.name[0]}*` });
                            delete global.guessGame[from];
                        }
                    }, 30000)
                };

                return await sock.sendMessage(from, {
                    image: { url: item.image },
                    caption: '🧩 *من هذه الشخصية؟*\n⏱️ المهلة: *30 ثانية*'
                });
            }

            if (global.guessGame[from]) {
                const game = global.guessGame[from];
                const userAns = text.toLowerCase();
                const isCorrect = game.item.name.some(ans => userAns.includes(ans.toLowerCase()));

                if (isCorrect) {
                    clearTimeout(game.timer);
                    delete global.guessGame[from];
                    global.userPoints[sender] = (global.userPoints[sender] || 0) + 10;

                    return await sock.sendMessage(from, {
                        text: `🎉 *إجابة صحيحة!*\n👤 الفائز: @${sender.split('@')[0]}\n⭐ رصيدك: *${global.userPoints[sender]} نقطة*`,
                        mentions: [sender]
                    });
                }
            }

            // ==================== 2. لعبة الحروف (اسم/حيوان/نبات...) ====================
            if (text === '.حروف' || text === '.جماد') {
                if (global.letterGame[from]) {
                    return await sock.sendMessage(from, { text: '⚠️ هناك لعبة حروف شغالة بالفعل!' });
                }

                const randomLetter = letters[Math.floor(Math.random() * letters.length)];
                global.letterGame[from] = {
                    letter: randomLetter,
                    catIndex: 0,
                    players: {}, // يحفظ قلوب اللاعبين { sender: 2 }
                    timer: null
                };

                const startNextCategory = async () => {
                    const game = global.letterGame[from];
                    if (!game) return;

                    if (game.catIndex >= categories.length) {
                        await sock.sendMessage(from, { text: `🎉 *انتهت الجولة بنجاح لكل التصنيفات!*` });
                        delete global.letterGame[from];
                        return;
                    }

                    const currentCat = categories[game.catIndex];
                    await sock.sendMessage(from, {
                        text: `🔤 *حرف الجولة:* [ *${game.letter}* ]\n🎯 المطلوب الآن: *${currentCat}*\n⏱️ المهلة: *20 ثانية*`
                    });

                    game.timer = setTimeout(async () => {
                        if (global.letterGame[from]) {
                            await sock.sendMessage(from, { text: `⏰ *انتهى الوقت دون إجابة!* ننتقل للتصنيف التالي...` });
                            game.catIndex++;
                            startNextCategory();
                        }
                    }, 20000);
                };

                return startNextCategory();
            }

            if (global.letterGame[from]) {
                const game = global.letterGame[from];
                if (!game.players[sender]) game.players[sender] = 2; // إعطاء قلبين للداخل الجديد

                const firstChar = text.trim().charAt(0);
                const targetLetter = game.letter;

                // التحقق هل تبدأ الإجابة بالحرف المطلوبة (مع مراعاة الألف)
                const isValidLetter = (firstChar === targetLetter) || 
                                     (targetLetter === 'أ' && ['أ', 'ا', 'إ', 'آ'].includes(firstChar));

                if (isValidLetter) {
                    clearTimeout(game.timer);
                    await sock.sendMessage(from, {
                        text: `✅ *إجابة صحيحة من* @${sender.split('@')[0]}!\n[ ❤️ القلوب المتبقية: ${game.players[sender]} ]`,
                        mentions: [sender]
                    });

                    game.catIndex++;
                    
                    // للانتقال للتصنيف التالي
                    setTimeout(async () => {
                        if (!global.letterGame[from]) return;
                        if (game.catIndex >= categories.length) {
                            await sock.sendMessage(from, { text: `🏆 *اكتملت جميع التصنيفات للحرف [ ${targetLetter} ]!*` });
                            delete global.letterGame[from];
                        } else {
                            const nextCat = categories[game.catIndex];
                            await sock.sendMessage(from, {
                                text: `🔤 *نفس الحرف:* [ *${targetLetter}* ]\n🎯 المطلوب التالي: *${nextCat}*\n⏱️ المهلة: *20 ثانية*`
                            });

                            game.timer = setTimeout(async () => {
                                if (global.letterGame[from]) {
                                    await sock.sendMessage(from, { text: `⏰ *انتهى الوقت!*` });
                                    delete global.letterGame[from];
                                }
                            }, 20000);
                        }
                    }, 1500);

                    return;
                } else if (text.length > 1 && !text.startsWith('.')) {
                    // إجابة خاطئة لا تبدأ بالحرف -> خصم قلب
                    game.players[sender]--;
                    if (game.players[sender] <= 0) {
                        return await sock.sendMessage(from, {
                            text: `❌ إجابة خاطئة! استنفذت قلبين وتوفيت 💀 @${sender.split('@')[0]}`,
                            mentions: [sender]
                        });
                    } else {
                        return await sock.sendMessage(from, {
                            text: `⚠️ إجابة لا تبدأ بحرف [ *${targetLetter}* ]! خسرت قلباً 💔 المتبقي: *${game.players[sender]} قلب*`,
                            mentions: [sender]
                        });
                    }
                }
            }

            // ==================== 3. عرض النقاط ====================
            if (text === '.نقاطي' || text === '.النقاط') {
                const pts = global.userPoints[sender] || 0;
                return await sock.sendMessage(from, { text: `⭐ رصيدك الحالي: *${pts} نقطة*` });
            }

        } catch (err) {
            console.error('Error in message handler:', err);
        }
    });
}

startBot();
