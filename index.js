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
const userStates = {}; // Tracks the step-by-step conversation

// 3. Main Menu
maximus.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id.toString();
    if (chatId !== ADMIN_ID) return maximus.sendMessage(chatId, "⛔ Unauthorized.");

    const options = {
        reply_markup: {
            inline_keyboard: [
                [{ text: "➕ Add New Bot", callback_data: "start_add_bot" }],
                [{ text: "📊 View Active Bots", callback_data: "view_status" }]
            ]
        }
    };
    maximus.sendMessage(chatId, `🤖 **Welcome to Maximus!**\n\nI control up to 50 worker bots to react to channel posts automatically.\n\nChoose an option below:`, { parse_mode: 'Markdown', ...options });
});

// 4. Handle Button Clicks
maximus.on('callback_query', (query) => {
    const chatId = query.message.chat.id.toString();
    if (chatId !== ADMIN_ID) return;

    if (query.data === 'start_add_bot') {
        if (activeWorkers.size >= 50) {
            return maximus.sendMessage(chatId, "⚠️ Limit reached: You have 50 active worker bots running.");
        }
        
        userStates[chatId] = { step: 'WAITING_FOR_TOKEN' };
        maximus.sendMessage(chatId, "Let's add a new bot.\n\nPlease send me the **Bot Token** you got from BotFather.\n\n*(Send /cancel at any time to stop)*", { parse_mode: 'Markdown' });
        maximus.answerCallbackQuery(query.id);
    }

    if (query.data === 'view_status') {
        if (activeWorkers.size === 0) {
            maximus.sendMessage(chatId, "No worker bots are currently active.");
        } else {
            let statusText = `📊 **Active Worker Bots (${activeWorkers.size}/50):**\n\n`;
            let i = 1;
            for (const [token, data] of activeWorkers.entries()) {
                statusText += `${i}. @${data.username} - Reacts with: ${data.emoji}\n`;
                i++;
            }
            maximus.sendMessage(chatId, statusText, { parse_mode: 'Markdown' });
        }
        maximus.answerCallbackQuery(query.id);
    }
});

// 5. Cancel Command
maximus.onText(/\/cancel/, (msg) => {
    const chatId = msg.chat.id.toString();
    if (userStates[chatId]) {
        delete userStates[chatId];
        maximus.sendMessage(chatId, "❌ Bot addition cancelled. Use /start to see the menu.");
    }
});

// 6. Handle Step-by-Step Conversation Messages
maximus.on('message', async (msg) => {
    const chatId = msg.chat.id.toString();
    const text = msg.text;

    // Ignore commands, non-text, or unauthorized users
    if (chatId !== ADMIN_ID || !text || text.startsWith('/')) return;

    const state = userStates[chatId];
    if (!state) return; // If the user isn't in a conversation, ignore normal text

    // Step 1: Receiving the Token
    if (state.step === 'WAITING_FOR_TOKEN') {
        if (activeWorkers.has(text.trim())) {
            delete userStates[chatId];
            return maximus.sendMessage(chatId, "⚠️ This specific bot token is already running. Action cancelled.");
        }

        userStates[chatId].token = text.trim();
        userStates[chatId].step = 'WAITING_FOR_EMOJI';
        
        return maximus.sendMessage(chatId, "✅ Token saved!\n\nNow, send me the **emoji** you want this bot to react with (e.g., 🔥, 👍, 🎉):", { parse_mode: 'Markdown' });
    }

    // Step 2: Receiving the Emoji and Activating
    if (state.step === 'WAITING_FOR_EMOJI') {
        const token = userStates[chatId].token;
        const emoji = text.trim();
        delete userStates[chatId]; // Clear the state so the conversation ends

        maximus.sendMessage(chatId, "⏳ Activating worker bot, please wait...");

        try {
            // Spawn the new worker bot
            const worker = new TelegramBot(token, { polling: true });

            // Listen for new posts in any channel the worker is admin in
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
                    console.error(`Reaction failed for bot with emoji ${emoji}:`, err.message);
                }
            });

            // Verify the bot token works and get its username
            const me = await worker.getMe();
            activeWorkers.set(token, { username: me.username, emoji: emoji, instance: worker });

            maximus.sendMessage(chatId, `✅ **Worker Bot Successfully Activated!**\n\nBot: @${me.username}\nReaction: ${emoji}\n\n*Make sure to add @${me.username} to your channel as an Admin with post/edit permissions!*`, { parse_mode: 'Markdown' });

        } catch (error) {
            maximus.sendMessage(chatId, `❌ Failed to start worker bot. Ensure the token is valid and try again.\nError: ${error.message}`);
        }
    }
});
