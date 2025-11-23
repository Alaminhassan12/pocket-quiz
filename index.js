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
const APP_URL = "https://quiz-pocket.netlify.app"; // আপনার ফ্রন্টএন্ড লিংক

// --- 3. MAIN BOT LOGIC (/start command) ---
bot.start(async (ctx) => {
    const user = ctx.from;
    const userId = user.id.toString();
    const firstName = user.first_name;
    const username = user.username || "No Username";
    
    // রেফারাল কোড হ্যান্ডলিং
    const referrerId = ctx.startPayload; 

    console.log(`User Started: ${firstName} (${userId}), Referrer: ${referrerId}`);

    const userRef = db.collection('users').doc(userId);
    const userSnap = await userRef.get();

    if (!userSnap.exists) {
        // === ১. নতুন ইউজার তৈরি (Database Save) ===
        await userRef.set({
            userId: userId,
            name: firstName,
            username: username,

            // ✅ UPDATE: নতুন স্ট্রাকচার অনুযায়ী ব্যালেন্স সেট করা হলো
            balanceBDT: 0,       // কুইজের টাকার জন্য
            balanceTON: 0,       // টাস্কের TON এর জন্য
            diamonds: 0,
            
            completedTasks: [],
            unlockedLevels: ['Basic'],
            joinedAt: admin.firestore.FieldValue.serverTimestamp(),
            referredBy: referrerId || null
        });

    } else {
        // === পুরাতন ইউজার আপডেট ===
        await userRef.update({
            name: firstName,
            username: username,
            lastActive: admin.firestore.FieldValue.serverTimestamp()
        });
    }

});

// --- 4. REFERRAL HANDLING FUNCTION ---
async function handleReferralReward(referrerId, newUserId, newUserName) {
    const referrerRef = db.collection('users').doc(referrerId);
    
    try {
        const referrerSnap = await referrerRef.get();

        if (referrerSnap.exists) {
            // রেফারারকে ২ ডায়মন্ড দেওয়া
            await referrerRef.update({
                diamonds: admin.firestore.FieldValue.increment(2),
                referrals: admin.firestore.FieldValue.arrayUnion(newUserId)
            });

            // রেফারারকে মেসেজ পাঠানো
            await bot.telegram.sendMessage(referrerId, `🎉 **New Referral!**\n\nYour friend **${newUserName}** just joined.\nYou earned **+2 Diamonds** 💎!`, { parse_mode: 'Markdown' });
        }
    } catch (err) {
        console.error(`Referral Error:`, err.message);
    }
}

// Bot Launch
bot.launch();

// --- 5. EXPRESS SERVER (Just to keep Render happy) ---
app.use(cors());
app.use(express.json());

// শুধু হেলথ চেক রাউট রাখা হলো
app.get('/', (req, res) => {
    res.send('Pocket Money Bot is Running... 🤖');
});

// index.js : নতুন মেসেজ পাঠানোর API
app.post('/api/notify-users', async (req, res) => {
    const { newUserId, newUserName, referrerId } = req.body;

    try {
        // ১. নতুন ইউজারকে ওয়েলকাম মেসেজ পাঠানো
        // (ইউজার যেহেতু 'Allow' চেকবক্সে টিক দিয়ে Start দিয়েছে, তাই মেসেজ যাবে)
        await bot.telegram.sendMessage(newUserId, `👋 **Welcome, ${newUserName}!**\n\nThanks for joining Pocket Money App.\nStart playing quizzes and earn cash now! 🚀`, { parse_mode: 'Markdown' });

        // ২. রেফারারকে (User A) সুখবর পাঠানো (যদি থাকে)
        if (referrerId && referrerId !== newUserId) {
            await bot.telegram.sendMessage(referrerId, `🎉 **Congratulations!**\n\nYour friend **${newUserName}** joined using your link.\n💎 **You received +2 Diamonds!**`, { parse_mode: 'Markdown' });
        }

        res.json({ success: true });

    } catch (error) {
        console.error("Message Sending Error:", error);
        // ইউজার যদি বট ব্লক করে রাখে বা চেকবক্স আনচেক করে, তবে এরর আসতে পারে
        res.json({ success: false, error: error.message });
    }
});
// ❌ OLD APIs REMOVED (claim-reward & withdraw) - Frontend handles them now.

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

// Graceful Stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));