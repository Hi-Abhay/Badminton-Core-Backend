const express = require("express");
const cors = require("cors");
const swaggerUi = require("swagger-ui-express");
const swaggerSpec = require("./config/swagger");
const connectDB = require("./config/db"); // Add this import

const userRoutes = require("./routes/userRoutes");
const connectionRoutes = require("./routes/connectionRoutes");
const teamRoutes = require("./routes/teamRoutes");
const matchRoutes = require('./routes/matchRoutes');
const notificationRoutes = require("./routes/notificationRoutes");
const chatRoutes = require("./routes/chatRoutes");

const app = express();

// Initialize Database Connection for Vercel
connectDB(); 

app.use(cors());
app.use(express.json());
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));
// Mounted directly at /users without /api
app.use("/users", userRoutes);
app.use("/connections", connectionRoutes);
app.use("/teams", teamRoutes);
app.use('/matches', matchRoutes);
app.use("/notifications", notificationRoutes);
app.use("/chats", chatRoutes);
app.get("/", (req, res) => {
  res.status(200).json({ status: "OK" });
});

module.exports = app;
