require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');

// 1. Web Server for Render
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('Maximus Reaction System is Online');
});

app.listen(PORT, () => {
    console.log(`Web server listening on port ${PORT}`);
});

// 2. Master Bot Setup
const MAXIMUS_TOKEN = process.env.MAXIMUS_TOKEN;
const ADMIN_ID = process.env.ADMIN_ID;

if (!MAXIMUS_TOKEN || !ADMIN_ID) {
    console.error("FATAL: MAXIMUS_TOKEN and ADMIN_ID must be provided.");
    process.exit(1);
}

const maximus = new TelegramBot(MAXIMUS_TOKEN, { polling: true });
const activeWorkers = new Map();
const userStates = {};

// 3. The New Custom Keyboard Layout
const mainMenuKeyboard = {
    reply_markup: {
        keyboard: [
            [{ text: "Wallet" }, { text: "📺 My Channels" }],
            [{ text: "➕ Add Channel" }, { text: "➕ Add Group" }],
            [{ text: "⚡ Instant Reaction" }, { text: "😎 Set Emojis" }],
            [{ text: "↗️ Refer & Earn" }, { text: "💎 Premium" }]
        ],
        resize_keyboard: true, // Shrinks the buttons to fit nicely on mobile
        is_persistent: true    // Keeps the keyboard visible
    }
};

// 4. Main Menu Command
maximus.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id.toString();
    if (chatId !== ADMIN_ID) return maximus.sendMessage(chatId, "⛔ Unauthorized.");

    maximus.sendMessage(chatId, `🤖 **Welcome to Maximus!**\n\nUse the menu below to manage your reaction bots.`, { parse_mode: 'Markdown', ...mainMenuKeyboard });
});

// 5. Cancel Command
maximus.onText(/\/cancel/, (msg) => {
    const chatId = msg.chat.id.toString();
    if (userStates[chatId]) {
        delete userStates[chatId];
        maximus.sendMessage(chatId, "❌ Action cancelled. Returning to main menu.", mainMenuKeyboard);
    }
});

// 6. Handle All Text Messages (Menu Buttons and Setup Steps)
maximus.on('message', async (msg) => {
    const chatId = msg.chat.id.toString();
    const text = msg.text;

    // Ignore commands or unauthorized users
    if (chatId !== ADMIN_ID || !text || text.startsWith('/')) return;

    // --- HANDLE MENU BUTTON CLICKS ---
    if (text === "➕ Add Channel") {
        if (activeWorkers.size >= 50) {
            return maximus.sendMessage(chatId, "⚠️ Limit reached: You have 50 active worker bots running.");
        }
        userStates[chatId] = { step: 'WAITING_FOR_TOKEN' };
        return maximus.sendMessage(chatId, "Let's link a new channel bot.\n\nPlease send me the **Bot Token** you got from BotFather.\n\n*(Send /cancel at any time to stop)*", { parse_mode: 'Markdown', reply_markup: { remove_keyboard: true } });
    }

    if (text === "📺 My Channels") {
        if (activeWorkers.size === 0) {
            return maximus.sendMessage(chatId, "No worker bots are currently active.");
        }
        let statusText = `📊 **Active Worker Bots (${activeWorkers.size}/50):**\n\n`;
        let i = 1;
        for (const [token, data] of activeWorkers.entries()) {
            statusText += `${i}. @${data.username} - Reacts with: ${data.emoji}\n`;
            i++;
        }
        return maximus.sendMessage(chatId, statusText, { parse_mode: 'Markdown' });
    }

    // (You can add more if-statements here later for "Wallet", "Premium", etc.)

    // --- HANDLE STEP-BY-STEP SETUP ---
    const state = userStates[chatId];
    if (!state) return; // If not clicking a menu button and not in a setup state, ignore.

    if (state.step === 'WAITING_FOR_TOKEN') {
        if (activeWorkers.has(text.trim())) {
            delete userStates[chatId];
            return maximus.sendMessage(chatId, "⚠️ This specific bot token is already running. Action cancelled.", mainMenuKeyboard);
        }

        userStates[chatId].token = text.trim();
        userStates[chatId].step = 'WAITING_FOR_EMOJI';
        
        return maximus.sendMessage(chatId, "✅ Token saved!\n\nNow, send me the **emoji** you want this bot to react with (e.g., 🔥, 👍, 🎉):", { parse_mode: 'Markdown' });
    }

    if (state.step === 'WAITING_FOR_EMOJI') {
        const token = userStates[chatId].token;
        const emoji = text.trim();
        delete userStates[chatId]; 

        maximus.sendMessage(chatId, "⏳ Activating worker bot, please wait...");

        try {
            const worker = new TelegramBot(token, { polling: true });

            worker.on('channel_post', async (channelMsg) => {
                const channelId = channelMsg.chat.id;
                const messageId = channelMsg.message_id;

                try {
                    await fetch(`https://api.telegram.org/bot${token}/setMessageReaction`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            chat_id: channelId,
                            message_id: messageId,
                            reaction: [{ type: "emoji", emoji: emoji }]
                        })
                    });
                } catch (err) {
                    console.error(`Reaction failed:`, err.message);
                }
            });

            const me = await worker.getMe();
            activeWorkers.set(token, { username: me.username, emoji: emoji, instance: worker });

            maximus.sendMessage(chatId, `✅ **Worker Bot Successfully Activated!**\n\nBot: @${me.username}\nReaction: ${emoji}\n\n*Make sure to add @${me.username} to your channel as an Admin!*`, { parse_mode: 'Markdown', ...mainMenuKeyboard });

        } catch (error) {
            maximus.sendMessage(chatId, `❌ Failed to start worker bot. Ensure the token is valid and try again.\nError: ${error.message}`, mainMenuKeyboard);
        }
    }
});
