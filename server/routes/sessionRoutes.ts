
import { Router, Request, Response } from 'express';
import { container } from '../container';
import { UserChannelSession } from '../../chatbot/session/UserChannelSession';

const router = Router();

// POST /api/session/start
router.post('/start', async (req: Request, res: Response) => {
    try {
        const { tenantId, userId, chatbotId } = req.body;

        if (!chatbotId || !userId) {
            return res.status(400).json({ error: 'Missing chatbotId or userId' });
        }

        const session = UserChannelSession.createUserChannelSession(tenantId, userId, chatbotId);

        // Log to Chat History for audit
        await container.chatStore.appendMessage(session.userChannelSessionId, chatbotId, 'system', 'Session Started');

        res.json({
            success: true,
            session: {
                id: session.userChannelSessionId,
                status: session.status,
                chatbotId: session.chatbotChannelId
            }
        });

    } catch (err: any) {
        console.error('Session Start Error:', err);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/session/:id/status
router.get('/:id/status', async (req: Request, res: Response) => {
    try {
        const sessionId = req.params.id as string;
        const stm = await container.stmStore.loadSTM(sessionId);

        if (!stm) {
            return res.status(404).json({ error: 'Session not found or expired' });
        }

        res.json({
            status: stm.active_intent ? 'active' : 'idle',
            intent: stm.active_intent,
            summary: stm.summarized_state
        });
    } catch (err: any) {
        console.error('Session Status Error:', err);
        res.status(500).json({ error: err.message });
    }
});

export default router;
