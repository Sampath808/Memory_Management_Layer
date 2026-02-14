
import { Router, Request, Response } from 'express';
import { container } from '../container';
import { ChatbotChannel } from '../../chatbot/ChatbotChannel';

const router = Router();

// GET /api/admin/chatbots
router.get('/chatbots', async (req: Request, res: Response) => {
    try {
        const { tenantId } = req.query;
        if (!tenantId) return res.status(400).json({ error: 'Missing tenantId' });

        const chatbots = await container.registry.listChatbots(tenantId as string);
        res.json({ deployed_chatbots: chatbots });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/admin/chatbots
router.post('/chatbots', async (req: Request, res: Response) => {
    try {
        const { name, platform, description, tenantId } = req.body;

        if (!tenantId) return res.status(400).json({ error: 'Missing tenantId' });

        const bot = ChatbotChannel.createChatbotChannel({
            name,
            platform,
            description
        });

        // Save bot to DB using Registry
        await container.registry.registerChatbot({
            chatbot_channel_id: bot.chatbotChannelId,
            tenant_id: tenantId,
            name: bot.name,
            platform: bot.platform,
            description: bot.description,
            status: 'active'
        });

        res.json({
            success: true,
            chatbotId: bot.chatbotChannelId,
            details: bot.getIdentity()
        });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
