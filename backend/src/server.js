require('dotenv').config();
const http = require('http');
const mongoose = require('mongoose');
const { Server } = require('socket.io');
const connectDB = require('./config/database');
const app = require('./app');
const chatSocket = require('./sockets/chatSocket');
const realtime = require('./sockets/realtime');
const { assertJwtConfig } = require('./config/jwt');
const { allowedOrigins, isOriginAllowed, socketCorsOptions } = require('./config/cors');

const PORT = Number(process.env.PORT) || 5000;
const HOST = process.env.HOST || '0.0.0.0';

const server = http.createServer(app);

const io = new Server(server, {
  cors: socketCorsOptions,
  pingTimeout: 60000,
  pingInterval: 25000,
});

realtime.attach(io);

io.use((socket, next) => {
  const origin = socket.handshake.headers.origin;
  if (!isOriginAllowed(origin)) {
    console.warn(`Blocked socket connection from origin: ${origin}`);
    return next(new Error('Origin not allowed'));
  }
  next();
});

chatSocket(io);

const start = async () => {
  try {
    assertJwtConfig();
  } catch (error) {
    console.error('\n[FATAL] JWT configuration invalid.');
    console.error(`  ${error.message}`);
    console.error('  Set JWT_SECRET in backend/.env (copy backend/.env.example).\n');
    process.exit(1);
  }

  try {
    await connectDB();
  } catch (error) {
    console.error('\n[FATAL] MongoDB connection failed.');
    console.error(`  ${error.message}`);
    console.error('  Set MONGODB_URI in backend/.env (copy backend/.env.example).\n');
    process.exit(1);
  }

  server.listen(PORT, HOST, () => {
    console.log(`PokiChat server running on http://localhost:${PORT} (host ${HOST})`);
    console.log(`CORS allowed origins: ${allowedOrigins.join(', ')}`);
    console.log('Health check: GET /api/health');
  });

  server.on('error', (error) => {
    console.error(`[FATAL] Server failed to start: ${error.message}`);
    process.exit(1);
  });
};

const shutdown = async (signal) => {
  console.log(`\n${signal} received, shutting down...`);
  server.close(async () => {
    try {
      await mongoose.connection.close();
    } finally {
      process.exit(0);
    }
  });

  setTimeout(() => process.exit(0), 10000).unref();
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});

start();
