
import app from './app';
import { container } from './container';

const PORT = process.env.PORT || 3000;

async function startServer() {
    try {
        console.log('--- STARTING MEMORY AGENT OS API ---');

        // 1. Initialize Dependency Container (DBs, Stores, Agents)
        await container.init();

        // 2. Start Express Server
        app.listen(PORT, () => {
            console.log(`[Server] Memory API is running on http://localhost:${PORT}`);
            console.log(`[Routes] /api/v1/memory`);
            console.log(`[Routes] /api/v1/session`);
            console.log(`[Routes] /api/v1/admin`);
        });

    } catch (err) {
        console.error('Failed to start server:', err);
        process.exit(1);
    }
}

// Global Error Handlers
process.on('SIGTERM', async () => {
    console.log('SIGTERM received. Closing connections...');
    await container.close();
    process.exit(0);
});

process.on('SIGINT', async () => {
    await container.close();
    process.exit(0);
});

startServer();
