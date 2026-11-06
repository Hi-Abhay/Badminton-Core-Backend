require("dotenv").config();
const http = require("http");
const app = require("./app");
const connectDB = require("./config/db");
const { initSocket } = require("./config/socket");

const PORT = process.env.PORT || 5001;

// 1. Create HTTP server wrapping Express
const server = http.createServer(app);

// 2. Attach Unified WebSocket server (handles live matches + 1v1 chat)
initSocket(server);

// 3. Connect to Database, then listen on 'server'
connectDB()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`🚀 Server & WebSocket listening on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Database connection failed:", err.message);
    process.exit(1);
  });