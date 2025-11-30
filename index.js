require('dotenv').config();
const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
const { Telegraf, Markup } = require('telegraf');
const TonWeb = require('tonweb');
const { mnemonicToKeyPair } = require('tonweb-mnemonic');
 
// --- TON CONFIGURATION (UPDATED) ---
 
// ১. API Key চেক এবং ক্লিন করা
const rawApiKey = process.env.TONCENTER_API_KEY;
if (!rawApiKey) {
    console.error("❌ CRITICAL ERROR: TONCENTER_API_KEY পাওয়া যায়নি! Render Environment চেক করুন।");
}
  
// স্পেস রিমুভ করা
const apiKey = rawApiKey ? rawApiKey.trim() : "";
  
console.log("✅ Using TON API Key:", apiKey.substring(0, 5) + "..."); 
  
// ২. TonWeb ইনিশিলাইজ করা (Direct URL Method - এটিই সমাধান)
const tonweb = new TonWeb(new TonWeb.HttpProvider(`https://toncenter.com/api/v2/json?api_key=${apiKey}`));

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
    // ফ্রন্টএন্ড থেকে photoUrl পাঠাতে হবে, সেটা রিসিভ করছি
    const { newUserId, newUserName, referrerId, newUserPhoto } = req.body;

    console.log(`Notification: ${newUserName} joined under ${referrerId}`);

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
                const referrerRef = db.collection('users').doc(referrerId);

                // আমরা শুধু ID না রেখে পুরো অবজেক্ট রাখব
                const referralData = {
                    id: newUserId,
                    name: newUserName,
                    // ছবি না থাকলে ডিফল্ট ছবি
                    photo: newUserPhoto || "https://cdn-icons-png.flaticon.com/512/3135/3135715.png",
                    joinedAt: new Date().toISOString()
                };

                await referrerRef.update({
                    diamonds: admin.firestore.FieldValue.increment(1), // 🔴 আগে 2 ছিল, এখন 1 করা হলো (আসল রিওয়ার্ড)
                    // arrayUnion দিয়ে পুরো অবজেক্ট পুশ করছি
                    referrals: admin.firestore.FieldValue.arrayUnion(referralData)
                });

                // টেলিগ্রাম মেসেজ (আগের মতোই)
                await bot.telegram.sendPhoto(referrerId, IMAGES.REFERRAL, {
                    
                    caption: `🥳 **Congratulations!**\n\nYour friend **${newUserName}** joined using your link.\n💎 **You received +2 Diamonds!**`,
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: "💎 Claim Diamonds", web_app: { url: APP_URL } }]
                        ]
                    }
                });
            } catch (refErr) {
                console.log("Could not send referrer msg:", refErr.message);
            }
        }

        res.json({ success: true });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});


// ==========================================
// 💎 ADSGRAM REWARD API (S2S Postback)
// ==========================================

app.get('/api/adsgram-reward', async (req, res) => {
    try {
        // ১. URL থেকে প্যারামিটার ধরা
        // Adsgram {userid} এর জায়গায় আসল টেলিগ্রাম আইডি বসিয়ে পাঠাবে
        const userId = req.query.userid; 
        const secret = req.query.secret;

        console.log(`Adsgram Postback received for: ${userId}`);

        // ২. সিকিউরিটি চেক (যাতে হ্যাকাররা লিংক হিট করতে না পারে)
        // লিংকের পাসওয়ার্ড আর এখানের পাসওয়ার্ড মিলতে হবে
        if (secret !== "pocket123") {
            return res.status(403).send("Error: Wrong Secret Key");
        }

        if (!userId) {
            return res.status(400).send("Error: Missing User ID");
        }

        // ৩. ইউজারের ডাটাবেসে ডায়মন্ড যোগ করা
        const userRef = db.collection('users').doc(userId);
        const userSnap = await userRef.get();

        if (!userSnap.exists) {
            return res.status(404).send("User not found in database");
        }

        // 💎 ০.৫ ডায়মন্ড যোগ হচ্ছে
        await userRef.update({
            diamonds: admin.firestore.FieldValue.increment(0.5)
        });

        console.log(`✅ Added 0.5 Diamond to user ${userId}`);
        
        // Adsgram কে জানিয়ে দেওয়া যে কাজ হয়েছে
        res.status(200).send("OK");

    } catch (error) {
        console.error("Adsgram API Error:", error);
        res.status(500).send("Server Error");
    }
});

// ✅ API: CHECK BALANCE (HubCoin থেকে কল হবে)
app.post('/api/check-balance', async (req, res) => {
    const { userId } = req.body;

    console.log(`Checking balance for user: ${userId}`); // লগে দেখার জন্য

    try {
        // ১. ডাটাবেস থেকে ইউজার চেক করা
        const userRef = db.collection('users').doc(String(userId));
        const userSnap = await userRef.get();

        if (!userSnap.exists) {
            return res.status(404).json({ success: false, message: "User not found" });
        }

        const data = userSnap.data();
        // ২. ইউজারের BDT ব্যালেন্স নেওয়া
        const balance = data.balanceBDT || 0;

        // ৩. HubCoin কে ব্যালেন্স ফেরত পাঠানো
        res.json({ success: true, balance: balance });

    } catch (error) {
        console.error("Balance Check Error:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// --- AUTO & MANUAL TON WITHDRAWAL API ---
app.post('/api/withdraw-ton', async (req, res) => {
    const { userId, amount, walletAddress, diamondCost } = req.body; // Changed gemFee to diamondCost
    const AUTO_LIMIT = 0.5; // ০.৫ টোন বা তার কম হলে অটোমেটিক যাবে
    const ADMIN_ID = process.env.ADMIN_TELEGRAM_ID;

    if (!userId || !amount || !walletAddress) {
        return res.status(400).json({ success: false, message: "তথ্য অসম্পূর্ণ।" });
    }

    const userRef = db.collection('users').doc(String(userId));

    try {
        await db.runTransaction(async (t) => {
            const userDoc = await t.get(userRef);
            if (!userDoc.exists) throw new Error("User not found");

            const userData = userDoc.data();
            
            // ১. ব্যালেন্স এবং ডায়মন্ড চেক (ব্যালেন্সের নাম ঠিক করা হয়েছে)
            if (userData.balanceTON < amount) throw new Error("পর্যাপ্ত TON ব্যালেন্স নেই।");
            if (userData.diamonds < diamondCost) throw new Error(`ফি হিসেবে ${diamondCost} ডায়মন্ড প্রয়োজন।`);

            // ২. অটোমেটিক পেমেন্ট লজিক (ছোট অ্যামাউন্ট)
            if (amount <= AUTO_LIMIT) {
                console.log(`Auto processing: ${amount} TON for ${userId}`);

                const mnemonic = process.env.ADMIN_WALLET_MNEMONIC.split(' ');
                const keyPair = await mnemonicToKeyPair(mnemonic);
                const WalletClass = tonweb.wallet.all['v4R2'];
                const wallet = new WalletClass(tonweb.provider, { publicKey: keyPair.publicKey });
                let seqno = await wallet.methods.seqno().call();
                if (seqno === null || seqno === undefined) {
                    seqno = 0;
                }

                const transfer = wallet.methods.transfer({
                    secretKey: keyPair.secretKey,
                    toAddress: walletAddress,
                    amount: TonWeb.utils.toNano(String(amount)),
                    seqno: seqno,
                    payload: 'Pocket Quiz Payout', // Changed from HubCoin
                    sendMode: 3,
                });

                await transfer.send(); // টাকা পাঠানো হলো

                // ব্যালেন্স কাটা এবং হিস্ট্রি সেভ (Completed)
                t.update(userRef, {
                    balanceTON: admin.firestore.FieldValue.increment(-amount),
                    diamonds: admin.firestore.FieldValue.increment(-diamondCost),
                    // totalWithdrawn: admin.firestore.FieldValue.increment(amount) // This field doesn't exist yet
                });

                // Note: 'transactions' collection is new. Assuming it's correct.
                const transactionRef = db.collection('withdrawals').doc(); // Using 'withdrawals' to match frontend
                t.set(transactionRef, {
                    userId: String(userId),
                    amount: amount,
                    type: 'TON',
                    wallet: walletAddress,
                    status: 'paid', // Using 'paid' to match history logic
                    date: admin.firestore.FieldValue.serverTimestamp()
                });
            } 
            
            // ৩. ম্যানুয়াল পেমেন্ট লজিক (বড় অ্যামাউন্ট)
            else {
                console.log(`Manual request: ${amount} TON for ${userId}`);

                // ব্যালেন্স এবং ডায়মন্ড কেটে রাখা হবে (পেন্ডিং অবস্থায়)
                // This is already done by the frontend logic, but we keep it for server-side validation.
                // The frontend already created a 'pending' withdrawal record. We just notify the admin.

                // টেলিগ্রামে অ্যাডমিনকে মেসেজ পাঠানো
                const message = `
🚨 <b>Big Withdrawal Request!</b>

👤 User: <code>${userId}</code>
💰 Amount: <b>${amount} TON</b>
💎 Fee Paid: ${diamondCost} Diamonds
💼 Wallet: <code>${walletAddress}</code>

⚠️ Please check and pay manually. This request is already in the 'withdrawals' collection as 'pending'.`;

                bot.telegram.sendMessage(ADMIN_ID, message, { parse_mode: 'HTML' })
                   .catch(err => console.error("Bot notify error:", err));
            }
        });

        res.json({ success: true, message: amount <= AUTO_LIMIT ? "উইথড্র সফল! ওয়ালেট চেক করুন।" : "রিকোয়েস্ট জমা হয়েছে! অ্যাডমিন চেক করে পাঠাবেন।" });

    } catch (error) {
        console.error("Withdraw Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// --- ADMIN ACTION HANDLERS (Bot Buttons) ---

// Approve Logic
bot.action(/approve_ton_(.+)/, async (ctx) => {
    const txId = ctx.match[1];
    const txRef = db.collection('withdrawals').doc(txId); // Changed to 'withdrawals'

    try {
        await db.runTransaction(async (t) => {
            const doc = await t.get(txRef);
            if (!doc.exists) throw new Error("Tx not found");
            if (doc.data().status !== 'pending') throw new Error("Already processed");

            t.update(txRef, { status: 'paid' }); // Changed to 'paid'
            
            ctx.telegram.sendMessage(doc.data().userId, `✅ আপনার ${doc.data().amount} TON উইথড্রয়াল অ্যাপ্রুভ করা হয়েছে।`)
                .catch(() => {});
        });

        await ctx.editMessageText(`✅ <b>Approved & Paid!</b>\nTxID: ${txId}`, { parse_mode: 'HTML' });
    } catch (e) {
        ctx.answerCbQuery(e.message, { show_alert: true });
    }
});

// Reject Logic
bot.action(/reject_ton_(.+)/, async (ctx) => {
    const txId = ctx.match[1];
    const txRef = db.collection('withdrawals').doc(txId); // Changed to 'withdrawals'

    try {
        await db.runTransaction(async (t) => {
            const doc = await t.get(txRef);
            if (!doc.exists) throw new Error("Tx not found");
            const data = doc.data();
            if (data.status !== 'pending') throw new Error("Already processed");

            // রিফান্ড
            const userRef = db.collection('users').doc(data.userId);
            t.update(userRef, {
                balanceTON: admin.firestore.FieldValue.increment(data.amount),
                diamonds: admin.firestore.FieldValue.increment(data.diamondFee) // Changed from gemFee
            });

            t.update(txRef, { status: 'rejected' }); // Changed to 'rejected'

            ctx.telegram.sendMessage(data.userId, `❌ আপনার ${data.amount} TON রিকোয়েস্ট বাতিল করা হয়েছে। ব্যালেন্স ও ডায়মন্ড ফেরত দেওয়া হয়েছে।`)
                .catch(() => {});
        });

        await ctx.editMessageText(`❌ <b>Rejected & Refunded!</b>\nTxID: ${txId}`, { parse_mode: 'HTML' });
    } catch (e) {
        ctx.answerCbQuery(e.message, { show_alert: true });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

// Graceful Stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));