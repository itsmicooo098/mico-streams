require("dotenv").config();
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } = require("discord.js");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

// ==========================================
// 🛠️ CONFIGURATION & CUSTOMIZATION
// ==========================================
const TEST_MODE = false; // Set to false to use real Twitch data

// 💬 Customize your regular Live Message here:
function getLiveMessage(username) {
    return `🔥 **Yo! ${username} is streaming right now!**\n` +
           `Don't miss out, hop in the chat and say hello! 👇\n` +
           `https://twitch.tv/${username}`;
}

// 🧪 Customize your Test Mode Message here:
function getTestMessage(username) {
    return `🤖 **[Bot Test Configuration]**\n` +
           `Hey! This is a test to make sure your personal notifications are working perfectly.\n` +
           `When you actually go live, it will look like this:\n\n` +
           `🔴 **${username} is now LIVE!**\nhttps://twitch.tv/${username}`;
}
// ==========================================

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages]
});

const DB_FILE = path.join(__dirname, "subscribers.json");
let wasLive = false;
let twitchAccessToken = "";

function getSubscribers() {
    if (!fs.existsSync(DB_FILE)) {
        fs.writeFileSync(DB_FILE, JSON.stringify([]));
    }
    return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
}

function saveSubscriber(userId) {
    const subs = getSubscribers();
    if (!subs.includes(userId)) {
        subs.push(userId);
        fs.writeFileSync(DB_FILE, JSON.stringify(subs, null, 2));
        return true;
    }
    return false;
}

async function getTwitchToken() {
    try {
        const res = await axios.post(
            `https://id.twitch.tv/oauth2/token?client_id=${process.env.TWITCH_CLIENT_ID}&client_secret=${process.env.TWITCH_CLIENT_SECRET}&grant_type=client_credentials`
        );
        twitchAccessToken = res.data.access_token;
    } catch (err) {
        console.error("Twitch Token Error:", err.response?.data || err.message);
    }
}

async function sendUserDMs(messageText) {
    const subscribers = getSubscribers();
    console.log(`Sending alerts to ${subscribers.length} personal subscribers...`);

    for (const userId of subscribers) {
        try {
            const user = await client.users.fetch(userId);
            await user.send(messageText);
            console.log(`✅ Custom DM sent to user: ${user.tag}`);
        } catch (err) {
            console.error(`❌ Failed to DM user ID ${userId}:`, err.message);
        }
    }
}

async function checkLive() {
    try {
        let live = TEST_MODE ? true : false;
        const username = process.env.TWITCH_USERNAME;

        if (!TEST_MODE) {
            const res = await axios.get(
                `https://api.twitch.tv/helix/streams?user_login=${username}`,
                {
                    headers: {
                        "Client-ID": process.env.TWITCH_CLIENT_ID,
                        "Authorization": `Bearer ${twitchAccessToken}`
                    }
                }
            );
            live = res.data.data.length > 0;
        }

        if (live && !wasLive) {
            // Selects the customized message depending on TEST_MODE setting
            const alertMessage = TEST_MODE ? getTestMessage(username) : getLiveMessage(username);
            
            await sendUserDMs(alertMessage);
        }

        wasLive = live;
    } catch (err) {
        console.error("Live check error:", err.message);
    }
}

client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === "subscribe") {
        const userId = interaction.user.id;
        const isNew = saveSubscriber(userId);

        if (isNew) {
            await interaction.reply({ 
                content: "🔔 **Subscribed!** I will now DM you personally whenever the stream goes live.", 
                ephemeral: true 
            });
        } else {
            await interaction.reply({ 
                content: "You are already subscribed to live notifications!", 
                ephemeral: true 
            });
        }
    }
});

client.once("ready", async () => {
    console.log(`🤖 Logged in as ${client.user.tag}`);

    const commands = [
        new SlashCommandBuilder()
            .setName("subscribe")
            .setDescription("Subscribe to get live notifications sent directly to your DMs!")
    ].map(cmd => cmd.toJSON());

    const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

    try {
        console.log("Registering global slash commands...");
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log("Slash commands registered successfully.");
    } catch (error) {
        console.error("Error registering commands:", error);
    }

    if (!TEST_MODE) await getTwitchToken();
    await checkLive();
    setInterval(checkLive, 60000); 
});

client.login(process.env.DISCORD_TOKEN);