require('dotenv').config();
const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
const { Telegraf, Markup } = require('telegraf');

// --- 1. FIREBASE SETUP ---
// Render এ এনভায়রনমেন্ট ভেরিয়েবল থেকে সার্ভিস একাউন্ট লোড করা
let serviceAccount;
try {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
} catch (e) {
    console.error("Error parsing FIREBASE_SERVICE_ACCOUNT:", e);
    // It's better to exit if the service account is critical and fails to parse
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
    
    // Payload থেকে রেফারার আইডি বের করা (যেমন: /start 12345)
    // 'startPayload' টেলেগ্রাফের একটি ফিচার যা প্যারামিটার ধরে
    const referrerId = ctx.startPayload; 

    console.log(`User Started: ${firstName} (${userId}), Referrer: ${referrerId}`);

    // --- A. USER TRACKING & DATABASE UPDATE ---
    const userRef = db.collection('users').doc(userId);
    const userSnap = await userRef.get();

    if (!userSnap.exists) {
        // === নতুন ইউজার ===
        
        // ১. নতুন ইউজার ডাটাবেসে তৈরি করা (Database Save)
        await userRef.set({
            userId: userId,
            name: firstName,
            username: username,

            balance: 0,        // ✅ TON ব্যালেন্স ০ থেকে শুরু হচ্ছে
            diamonds: 0,       // ডায়মন্ডও ০
            
            completedTasks: [],
            unlockedLevels: ['Basic'],
            joinedAt: admin.firestore.FieldValue.serverTimestamp(),
            referredBy: referrerId || null
        });

        // ২. রেফারাল বোনাস প্রসেসিং (যদি রেফারার থাকে)
        if (referrerId && referrerId !== userId) {
            await handleReferralReward(referrerId, userId, firstName);
        }

    } else {
        // === পুরাতন ইউজার ===
        // তথ্য আপডেট করা (যদি নাম চেঞ্জ করে থাকে)
        await userRef.update({
            name: firstName,
            username: username,
            lastActive: admin.firestore.FieldValue.serverTimestamp()
        });
    }

    // --- B. WELCOME MESSAGE WITH BUTTON ---
    const welcomeMsg = `
👋 **Hello, ${firstName}!**

Welcome to **Pocket Money Quiz**. 
Play quizzes, complete tasks, and earn real money (TON/BDT)! 💰

💎 **Invite & Earn:** Get 2 Diamonds per friend.
🚀 **Withdraw:** Instant payment to TON Wallet or Bkash/Nagad.

👇 **Click below to start playing:**
    `;

    // ইনলাইন বাটন (মিনি অ্যাপ ওপেন করার জন্য)
    ctx.reply(welcomeMsg, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
            [Markup.button.webApp("🚀 Play & Earn Now", APP_URL)],
            [Markup.button.url("📢 Join Community", "https://t.me/Pocket_Money_Community")]
        ])
    });
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

            // রেফারারকে টেলিগ্রামে নোটিফিকেশন পাঠানো
            await bot.telegram.sendMessage(referrerId, `🎉 **New Referral!**\n\nYour friend **${newUserName}** just joined.\nYou earned **+2 Diamonds** 💎!`, { parse_mode: 'Markdown' });
            
            console.log(`Referral Reward sent to ${referrerId}`);
        }
    } catch (err) {
        console.error(`Error handling referral for ${referrerId}:`, err.message);
    }
}

// Bot Launch
bot.launch();

// --- 5. EXPRESS SERVER ---
const app = express();
app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
    res.send('Pocket Money Backend is Running... 🚀');
});

// --- API ROUTES ---

// ১. কুইজ রিওয়ার্ড ক্লেইম করা (SECURE)
app.post('/api/claim-reward', async (req, res) => {
    const { userId, rewardAmount } = req.body;

    if (!userId || !rewardAmount) {
        return res.status(400).send({ error: "Invalid Data" });
    }

    try {
        const userRef = db.collection('users').doc(userId);
        
        // ট্রানজেকশন ব্যবহার করে ব্যালেন্স আপডেট (নিরাপদ)
        await db.runTransaction(async (t) => {
            const doc = await t.get(userRef);
            if (!doc.exists) {
                throw new Error("User does not exist!");
            }
            const newBalance = (doc.data().balance || 0) + Number(rewardAmount);
            t.update(userRef, { balance: newBalance });
        });

        res.send({ success: true, message: "Reward Added Securely!" });

    } catch (error) {
        console.error("Claim Reward Error:", error);
        res.status(500).send({ error: error.message || "An internal error occurred." });
    }
});

// ২. উইথড্র রিকোয়েস্ট (SECURE)
app.post('/api/withdraw', async (req, res) => {
    const { userId, amount, method, wallet } = req.body;

    if (!userId || !amount || !method || !wallet) {
        return res.status(400).send({ error: "Invalid Data: Missing required fields." });
    }

    try {
        const userRef = db.collection('users').doc(userId);
        
        await db.runTransaction(async (t) => {
            const doc = await t.get(userRef);
            if (!doc.exists) {
                throw new Error("User does not exist!");
            }
            const currentBalance = doc.data().balance || 0;

            if (currentBalance < amount) {
                throw new Error("Insufficient Balance!");
            }

            const newBalance = currentBalance - amount;
            
            // ব্যালেন্স কমানো
            t.update(userRef, { balance: newBalance });

            // উইথড্র রিকোয়েস্ট জমা দেওয়া
            const withdrawRef = db.collection('withdrawals').doc();
            t.set(withdrawRef, {
                userId,
                amount,
                method,
                wallet,
                status: 'pending',
                date: admin.firestore.FieldValue.serverTimestamp()
            });
        });

        res.send({ success: true, message: "Withdrawal Request Sent!" });

    } catch (error) {
        console.error("Withdraw Error:", error);
        res.status(400).send({ error: error.message || "An internal error occurred." });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

// Graceful Stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));