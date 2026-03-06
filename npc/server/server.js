import express from "express";
import { createServer } from "node:http";

import { Server } from "socket.io";
import broker from "./service/broker.js";
const app = express();
const server = createServer(app);
const io = new Server(server);

// Serve static files from 'public' directory
app.use(express.static("public"));

// Serve shared files (map data, etc.) accessible to both client and server
app.use("/shared", express.static("shared"));

// Initialize broker
broker(io);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port http://localhost:${PORT}`);
});
