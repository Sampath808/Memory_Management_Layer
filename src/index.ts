import express from 'express';
import dotenv from 'dotenv';
import memoryRoutes from './routes/memory.routes';
import contextRoutes from './routes/context.routes';
import { MemoryService } from './services/memory.service';
import { ContextService } from './services/context.service';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.use('/api/memory', memoryRoutes);
app.use('/api/context', contextRoutes);

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

const server = app.listen(PORT, () => {
  console.log(`Memory Management Layer running on port ${PORT}`);
});

process.on('SIGTERM', async () => {
  console.log('SIGTERM received, closing connections...');
  await MemoryService.closeConnections();
  await ContextService.closeConnections();
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
