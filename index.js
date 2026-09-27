const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const http = require('http');
const animeCharacters = require('./characters');

// 1. خادم HTTP لإبقاء Render شغالاً
const PORT = process.env.PORT || 8080;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot Server Running Live!\n');
}).listen(PORT, () => console.log(`Server listening on port ${PORT}`));

// متغيرات اللعبة العامة
if (!global.guessGame) global.guessGame = {};
if (!global.userPoints) global.userPoints = {};

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Connection closed, reconnecting...', shouldReconnect);
            if (shouldReconnect) startBot();
        } else if (connection === 'open') {
            console.log('✅ Connected to WhatsApp successfully!');
        }
    });

    // استقبال واستجابة الرسائل
    sock.ev.on('messages.upsert', async (m) => {
        try {
            const msg = m.messages[0];
            if (!msg || !msg.message || msg.key.fromMe) return;

            const from = msg.key.remoteJid;
            const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').trim();

            if (!text) return;

            // --- لعبة تخمين الأنمي ---
            if (text === '.تخمين' || text === '.انمي') {
                if (global.guessGame[from]) {
                    return await sock.sendMessage(from, { text: '⚠️ هناك مسابقة شغالة بالفعل في هذه المجموعة!' });
                }

                const item = animeCharacters[Math.floor(Math.random() * animeCharacters.length)];
                global.guessGame[from] = {
                    item: item,
                    timer: setTimeout(async () => {
                        if (global.guessGame[from]) {
                            await sock.sendMessage(from, { text: `⏰ انتهى الوقت! الإجابة الصحيحة هي: *${item.name[0]}*` });
                            delete global.guessGame[from];
                        }
                    }, 30000)
                };

                await sock.sendMessage(from, {
                    image: { url: item.image },
                    caption: '🧩 *من هذه الشخصية؟*\n\n⏱️ لديك *30 ثانية* للإجابة!\n💰 الجائزة: *10 نقاط*'
                });
            }

            // --- عرض النقاط ---
            if (text === '.نقاطي' || text === '.النقاط') {
                const sender = msg.key.participant || msg.key.remoteJid;
                const pts = global.userPoints[sender] || 0;
                await sock.sendMessage(from, { text: `⭐ رصيدك الحالي هو: *${pts} نقطة*` });
            }

            // --- التحقق من الإجابات ---
            if (global.guessGame[from]) {
                const game = global.guessGame[from];
                const userAns = text.toLowerCase();
                const isCorrect = game.item.name.some(ans => userAns.includes(ans.toLowerCase()));

                if (isCorrect) {
                    clearTimeout(game.timer);
                    delete global.guessGame[from];
                    
                    const sender = msg.key.participant || msg.key.remoteJid;
                    global.userPoints[sender] = (global.userPoints[sender] || 0) + 10;

                    await sock.sendMessage(from, {
                        text: `🎉 *إجابة صحيحة!*\n👤 الفائز: @${sender.split('@')[0]}\n⭐ كسبت *10 نقاط*! مجموع نقاطك الآن: *${global.userPoints[sender]}*`,
                        mentions: [sender]
                    });
                }
            }

        } catch (err) {
            console.error('Error in message handler:', err);
        }
    });
}

startBot();
