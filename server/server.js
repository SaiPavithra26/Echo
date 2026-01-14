require("dotenv").config();
const WebSocket = require("ws");
const mongoose = require("mongoose");
const User = require("./models/User");
const Message = require("./models/Message");
const bcrypt = require("bcrypt");

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
      let data;

      try {
        data = JSON.parse(message.toString());
      } catch {
        ws.send("ERROR: Invalid auth format");
        ws.close();
        return;
      }

      const { username, password } = data;

      if (!username || !password) {
        ws.send("ERROR: Username and password required");
        ws.close();
        return;
      }

      try {
        const existingUser = await User.findOne({ username });

        // 🆕 NEW USER
        if (!existingUser) {
          const passwordHash = await bcrypt.hash(password, 10);

          await User.create({
            username,
            passwordHash,
            connectedAt: new Date(),
            isOnline: true
          });

          console.log(`[${getTimestamp()}] New user registered: ${username}`);
        }
        // 🔐 EXISTING USER
        else {
          const isMatch = await bcrypt.compare(password, existingUser.passwordHash);

          if (!isMatch) {
            ws.send("ERROR: Wrong password");
            ws.close();
            console.log(`[${getTimestamp()}] Wrong password attempt for ${username}`);
            return;
          }

          await User.findOneAndUpdate(
            { username },
            { isOnline: true, connectedAt: new Date() }
          );

          console.log(`[${getTimestamp()}] ${username} authenticated`);
        }

        // ✅ AUTH SUCCESS
        ws.send("AUTH_SUCCESS");
        clients.set(ws, username);

        wss.clients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(`${username} has joined`);
          }
        });

            ws.on("message", async (message) => {
      const text = message.toString().trim();
      const time = getTimestamp();

      if (!text) return; // skip empty messages

      await logMessage(username, text);

      const finalMessage = `${time}: ${username} said: ${text}`;
      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(finalMessage);
        }
      });
    });


      } catch (err) {
        console.error("Authentication error:", err.message);
        ws.send("ERROR: Authentication failed");
        ws.close();
      }
    });

    ws.on("close", async () => {
      const username = clients.get(ws);
      if (username) {
        console.log(`[${getTimestamp()}] ${username} disconnected`);
        await markUserOffline(username);
        clients.delete(ws);

        wss.clients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(`${username} has left`);
          }
        });
      }
    });
  });

  console.log(`[${getTimestamp()}] WebSocket server running on port ${PORT}`);
}

startServer();
