const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const readline = require('readline');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const question = (text) => new Promise((resolve) => rl.question(text, resolve));

async function startPairing() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        browser: ["Ubuntu", "Chrome", "20.0.04"]
    });

    sock.ev.on('creds.update', saveCreds);

    if (!sock.authState.creds.registered) {
        const phoneNumber = await question('📱 أدخل رقم هاتف البوت مع رمز الدولة (مثال: 9677xxxxxxxx):\n');
        const cleanNumber = phoneNumber.replace(/[^0-9]/g, '');
        
        setTimeout(async () => {
            try {
                let code = await sock.requestPairingCode(cleanNumber);
                code = code?.match(/.{1,4}/g)?.join("-") || code;
                console.log(`\n==================================`);
                console.log(`🔑 كود الربط الخاص بك هو:  ${code}`);
                console.log(`==================================\n`);
            } catch (err) {
                console.error('حدث خطأ أثناء طلب الكود:', err);
            }
        }, 3000);
    }

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const statusCode = (lastDisconnect?.error)?.output?.statusCode;
            if (statusCode !== DisconnectReason.loggedOut) {
                console.log('🔄 جاري إعادة الاتصال التلقائي لاستكمال الربط...');
                startPairing();
            } else {
                console.log('❌ تم إغلاق الجلسة، قم بإعادة التشغيل.');
            }
        } else if (connection === 'open') {
            console.log('\n==================================');
            console.log('✅ تم الاتصال بنجاح وظهر الجهاز في الواتساب!');
            console.log('==================================\n');
            process.exit(0);
        }
    });
}

startPairing();
