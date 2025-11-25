require('dotenv').config();
const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
const { Telegraf, Markup } = require('telegraf');

const app = express();

// --- 1. FIREBASE SETUP ---
let serviceAccount;
try {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
} catch (e) {
    console.error("Error parsing FIREBASE_SERVICE_ACCOUNT:", e);
    process.exit(1); 
}

if (admin.apps.length === 0) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}
const db = admin.firestore();

// --- 2. TELEGRAM BOT SETUP ---
const bot = new Telegraf(process.env.BOT_TOKEN);
const APP_URL = "https://quiz-pocket.netlify.app"; // আপনার মিনি অ্যাপ লিংক

// --- কনফিগারেশন (ছবি এবং লিংক) ---
const IMAGES = {
    WELCOME: 'https://i.postimg.cc/pVzSxXFC/start-message.jpg', // ওয়েলকাম ইমেজ
    REFERRAL: 'https://i.postimg.cc/y8QQnDMx/refer-message.png' // রেফার ইমেজ
};

const LINKS = {
    YOUTUBE: 'https://youtube.com/@pocket_money_app?si=IOFoVmM4fKcEol6z',
    COMMUNITY: 'https://t.me/Pocket_Money_Community'
};

// --- 3. MAIN BOT LOGIC (/start command) ---
// ✅ এই অংশটি কাজ করবে যখন কেউ ম্যানুয়ালি /start দিবে
bot.start(async (ctx) => {
    const user = ctx.from;
    const userId = user.id.toString();
    const firstName = user.first_name;
    const referrerId = ctx.startPayload; // রেফারাল প্যারামিটার

    console.log(`User Started: ${firstName} (${userId})`);

    // --- DATABASE LOGIC (আগের লজিক অপরিবর্তিত) ---
    const userRef = db.collection('users').doc(userId);
    const userSnap = await userRef.get();

    if (!userSnap.exists) { // নতুন ইউজার তৈরি
        await userRef.set({
            userId: userId,
            name: firstName,
            username: user.username || "No Username",
            balanceBDT: 0,
            balanceTON: 0,
            diamonds: 0,
            completedTasks: [],
            unlockedLevels: ['Basic'],
            joinedAt: admin.firestore.FieldValue.serverTimestamp(),
            referredBy: referrerId || null
        });
    }

    // --- MESSAGE LOGIC (আপনার নতুন রিকোয়ারমেন্ট অনুযায়ী) ---
    // ওয়েলকাম ইমেজ + ৩টি বাটন পাঠানো হবে
    try {
        await ctx.replyWithPhoto(IMAGES.WELCOME, {
            caption: `👋 **Welcome, ${firstName}!**\n\nStart playing quizzes, complete tasks, and refer friends to earn real rewards instantly. Fun, easy, and rewarding! 🚀`,
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
                [Markup.button.webApp("🚀 Open Pocket Money", APP_URL)], // মিনি অ্যাপ বাটন
                [Markup.button.url("📺 How to work", LINKS.YOUTUBE)],   // ইউটিউব বাটন
                [Markup.button.url("📢 Join Community", LINKS.COMMUNITY)] // টেলিগ্রাম বাটন
            ])
        });
    } catch (e) {
        console.error("Error sending start message:", e);
    }
});

// Bot Launch
bot.launch();

// --- 4. EXPRESS SERVER & API ---
app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
    res.send('Pocket Money Bot is Running... 🤖');
});

// ✅ API: NOTIFY USERS (Frontend থেকে কল হবে)
app.post('/api/notify-users', async (req, res) => {
    const { newUserId, newUserName, referrerId } = req.body;

    console.log(`Notification: New User ${newUserId}, Ref: ${referrerId}`);

    try {
        // ১. নতুন ইউজারকে ওয়েলকাম মেসেজ (যদি সে অ্যাপ থেকে সরাসরি আসে)
        try {
            await bot.telegram.sendPhoto(newUserId, IMAGES.WELCOME, {
                caption: `👋 **Welcome, ${newUserName}!**\n\nStart playing quizzes, complete tasks, and refer friends to earn real rewards instantly. Fun, easy, and rewarding! 🚀`,
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "🚀 Open Pocket Money", web_app: { url: APP_URL } }],
                        [{ text: "📺 How to work", url: LINKS.YOUTUBE }],
                        [{ text: "📢 Join Community", url: LINKS.COMMUNITY }]
                    ]
                }
            });
        } catch (msgErr) {
            console.log("Could not send welcome msg (User might block bot):", msgErr.message);
        }

        // ২. রেফারারকে সুখবর পাঠানো (আপনার নতুন রিকোয়ারমেন্ট)
        if (referrerId && referrerId !== newUserId) {
            try {
                await bot.telegram.sendPhoto(referrerId, IMAGES.REFERRAL, {
                    
                    caption: `🥳 **Congratulations!**\n\nYour friend **${newUserName}** joined using your link.\n💎 **You received +2 Diamonds!**`,
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: "💎 Claim Diamonds", web_app: { url: APP_URL } }] // ক্লেইম বাটন
                        ]
                    }
                });
            } catch (refErr) {
                console.log("Could not send referrer msg:", refErr.message);
            }
        }

        res.json({ success: true });

    } catch (error) {
        console.error("General Notification Error:", error);
        res.status(500).json({ error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

// Graceful Stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));