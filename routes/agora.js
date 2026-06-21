// routes/agora.js — Agora RTC Token Generator
import { Router } from 'express';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { RtcTokenBuilder, RtcRole } = require('agora-token');

const router = Router();

const APP_ID          = process.env.AGORA_APP_ID;
const APP_CERTIFICATE = process.env.AGORA_APP_CERTIFICATE;

// POST /api/agora/token
router.post('/token', (req, res) => {
  try {
    const { channelName, userId, role } = req.body;
    if (!channelName) return res.status(400).json({ error: 'channelName is required' });

    // If no certificate — WARN clearly, don't silently return null
    // In production, null token will cause Agora to reject with CAN_NOT_GET_GATEWAY_SERVER
    if (!APP_CERTIFICATE || APP_CERTIFICATE === 'YOUR_CERTIFICATE') {
      console.warn('[agora] ⚠️  AGORA_APP_CERTIFICATE not set — returning null token. Set it in Render/Railway env vars!');
      // Return null only in development, error in production
      if (process.env.NODE_ENV === 'production') {
        return res.status(500).json({
          error: 'Agora certificate not configured on server. Set AGORA_APP_CERTIFICATE env variable.',
        });
      }
      return res.json({ token: null, channelName });
    }

    const uid            = parseInt(userId) || 0;
    const expireTime      = 3600;
    const currentTime     = Math.floor(Date.now() / 1000);
    const privilegeExpire = currentTime + expireTime;

    // Listeners get subscriber role, speakers/debaters get publisher
    const agoraRole = (role === 'listener') ? RtcRole.SUBSCRIBER : RtcRole.PUBLISHER;

    const token = RtcTokenBuilder.buildTokenWithUid(
      APP_ID,
      APP_CERTIFICATE,
      channelName,
      uid,
      agoraRole,
      privilegeExpire,
      privilegeExpire
    );

    res.json({ token, channelName });
  } catch (err) {
    console.error('[agora] Token error:', err);
    res.status(500).json({ error: 'Failed to generate token', detail: err.message });
  }
});

export default router;
