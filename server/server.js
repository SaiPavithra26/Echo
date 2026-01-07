require("dotenv").config();
const WebSocket = require("ws");
const mongoose = require("mongoose");
const User = require("./models/User");
const Message = require("./models/Message");

const PORT = process.env.PORT || 8080;
const MONGODB_URI = process.env.MONGODB_URI;

const clients = new Map();

function getTimestamp() {
  return new Date().toLocaleString();
}

async function connectDB() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log(`[${getTimestamp()}] Connected to MongoDB`);
  } catch (error) {
    console.error(`[${getTimestamp()}] MongoDB connection error:`, error.message);
    process.exit(1);
  }
}

async function logUserConnection(username) {
  try {
    await User.findOneAndUpdate(
      { username },
      { username, connectedAt: new Date(), isOnline: true },
      { upsert: true, new: true }
    );
    console.log(`[${getTimestamp()}] User "${username}" logged to database`);
  } catch (error) {
    console.error(`[${getTimestamp()}] Error logging user:`, error.message);
  }
}

async function isUsernameTaken(username) {
  const user = await User.findOne({ username, isOnline: true });
  return !!user;
}

async function markUserOffline(username) {
  try {
    await User.findOneAndUpdate({ username }, { isOnline: false });
  } catch (error) {
    console.error(`[${getTimestamp()}] Error marking user offline:`, error.message);
  }
}

async function logMessage(sender, content) {
  try {
    await Message.create({ sender, content, timestamp: new Date() });
  } catch (error) {
    console.error(`[${getTimestamp()}] Error logging message:`, error.message);
  }
}

async function startServer() {
  await connectDB();

  const wss = new WebSocket.Server({ port: PORT });

  wss.on("connection", (ws) => {
    ws.once("message", async (message) => {
      const username = message.toString().trim();

      const taken = await isUsernameTaken(username);
      if (taken) {
        ws.send(`ERROR: Username "${username}" is already taken. Please reconnect with a different username.`);
        ws.close();
        console.log(`[${getTimestamp()}] Rejected connection: username "${username}" is taken`);
        return;
      }

      await logUserConnection(username);

      clients.set(ws, username);
      console.log(`[${getTimestamp()}] ${username} joined`);

      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(`${username} has joined`);
        }
      });

      ws.on("message", async (message) => {
        const text = message.toString().trim();
        const username = clients.get(ws);
        const time = getTimestamp();

        await logMessage(username, text);

        const finalMessage = `${time}: ${username} said: ${text}`;
        wss.clients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(finalMessage);
          }
        });
      });
    });

    ws.on("close", async () => {
      const username = clients.get(ws);
      if (username) {
        console.log(`[${getTimestamp()}] ${username} disconnected`);
        
        await markUserOffline(username);

        wss.clients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(`${username} has left`);
          }
        });
        clients.delete(ws);
      }
    });
  });

  console.log(`[${getTimestamp()}] WebSocket server running on port ${PORT}`);
}

startServer();
