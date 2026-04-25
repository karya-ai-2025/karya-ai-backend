const crypto = require('crypto');
const CampaignEmail = require('../models/CampaignEmail');
const Campaign = require('../models/Campaign');

const verifyMailgunWebhook = (timestamp, token, signature) => {
  const signingKey = process.env.MAILGUN_WEBHOOK_SIGNING_KEY || process.env.MAILGUN_API_KEY; // mailGun is not proving sign in key for webhook auth 
  if (!signingKey) return true;

  const encodedToken = crypto
    .createHmac('sha256', signingKey)
    .update(timestamp.concat(token))
    .digest('hex');

  return encodedToken === signature;
};

const handleMailgunWebhook = async (req, res) => {
  try {
    const { signature, 'event-data': eventData } = req.body;

    if (signature) {
      const isValid = verifyMailgunWebhook(
        signature.timestamp,
        signature.token,
        signature.signature
      );
      if (!isValid) {
        console.warn('Invalid Mailgun webhook signature');
        return res.status(406).json({ message: 'Invalid signature' });
      }
    }

    if (!eventData) {
      return res.status(200).json({ message: 'No event data' });
    }

    const event = eventData.event;
    const messageId = eventData.message?.headers?.['message-id'];

    if (!messageId) {
      return res.status(200).json({ message: 'No message ID in event' });
    }

    const mailgunId = `<${messageId}>`;
    const campaignEmail = await CampaignEmail.findOne({
      $or: [
        { mailgunMessageId: messageId },
        { mailgunMessageId: mailgunId }
      ]
    });

    if (!campaignEmail) {
      return res.status(200).json({ message: 'Email not tracked by campaign system' });
    }

    await campaignEmail.addProviderEvent(event, eventData);

    const clientInfo = eventData['client-info'] || {};
    const geolocation = eventData.geolocation || {};

    switch (event) {
      case 'accepted': {
        if (campaignEmail.status === 'sent') {
          campaignEmail.queuedAt = new Date();
          await campaignEmail.save();
        }
        break;
      }

      case 'delivered': {
        campaignEmail.status = 'delivered';
        campaignEmail.deliveredAt = new Date();
        await campaignEmail.save();

        await Campaign.findByIdAndUpdate(campaignEmail.campaignId, {
          $inc: { 'stats.deliveredCount': 1 }
        });
        break;
      }

      case 'opened': {
        await campaignEmail.recordOpen(
          eventData.ip,
          clientInfo['user-agent']
        );

        campaignEmail.trackingData = {
          ...campaignEmail.trackingData,
          ipAddress: eventData.ip,
          userAgent: clientInfo['user-agent'],
          location: {
            country: geolocation.country,
            region: geolocation.region,
            city: geolocation.city
          },
          device: {
            type: clientInfo['device-type'],
            os: clientInfo['client-os'],
            browser: clientInfo['client-name']
          }
        };
        await campaignEmail.save();

        if (campaignEmail.opens.length === 1) {
          await Campaign.findByIdAndUpdate(campaignEmail.campaignId, {
            $inc: { 'stats.openedCount': 1 }
          });
        }
        break;
      }

      case 'clicked': {
        await campaignEmail.recordClick(
          eventData.url,
          eventData.ip,
          clientInfo['user-agent']
        );

        if (campaignEmail.clicks.length === 1) {
          await Campaign.findByIdAndUpdate(campaignEmail.campaignId, {
            $inc: { 'stats.clickedCount': 1 }
          });
        }
        break;
      }

      case 'failed':
      case 'bounced': {
        const severity = eventData.severity || 'permanent';
        const bounceType = severity === 'permanent' ? 'hard' : 'soft';

        await campaignEmail.recordBounce(
          bounceType,
          eventData.reason || eventData['delivery-status']?.description || 'Unknown',
          eventData['delivery-status']?.code?.toString() || ''
        );

        await Campaign.findByIdAndUpdate(campaignEmail.campaignId, {
          $inc: { 'stats.bouncedCount': 1 }
        });
        break;
      }

      case 'complained': {
        await campaignEmail.markAsSpam();

        await Campaign.findByIdAndUpdate(campaignEmail.campaignId, {
          $inc: { 'stats.spamCount': 1 }
        });
        break;
      }

      case 'unsubscribed': {
        campaignEmail.status = 'cancelled';
        campaignEmail.unsubscribedAt = new Date();
        await campaignEmail.save();
        break;
      }

      default:
        console.log(`Unhandled Mailgun event: ${event}`);
    }

    res.status(200).json({ message: 'Webhook processed' });
  } catch (error) {
    console.error('Error processing Mailgun webhook:', error);
    res.status(200).json({ message: 'Webhook received with errors' });
  }
};

module.exports = { handleMailgunWebhook };
