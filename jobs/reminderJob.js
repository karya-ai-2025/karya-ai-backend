// jobs/reminderJob.js
// Runs every 60 seconds, finds calls starting in ~5 minutes, sends reminder email.

const ScheduledCall = require('../models/ScheduledCall');
const { sendEmail, templates } = require('../utils/sendEmail');

let intervalId = null;

const checkAndSendReminders = async () => {
  try {
    const now = new Date();
    const windowStart = new Date(now.getTime() + 2 * 60 * 1000); // 2 min from now
    const windowEnd   = new Date(now.getTime() + 8 * 60 * 1000); // 8 min from now

    const upcomingCalls = await ScheduledCall.find({
      dateTime:     { $gte: windowStart, $lte: windowEnd },
      status:       'scheduled',
      reminderSent: false,
      meetLink:     { $ne: null },
    }).lean();

    for (const call of upcomingCalls) {
      try {
        await sendEmail({
          to:      call.email,
          subject: '⏰ Your Karya-AI meeting starts in 5 minutes!',
          html:    templates.meetingReminder(call.name, call.dateTime, call.timezone, call.meetLink),
        });

        await ScheduledCall.findByIdAndUpdate(call._id, { reminderSent: true });
        console.log(`📧 Reminder sent to ${call.email} for meeting at ${call.dateTime}`);
      } catch (err) {
        console.error(`Reminder email failed for call ${call._id}:`, err.message);
      }
    }
  } catch (err) {
    console.error('Reminder job error:', err.message);
  }
};

const startReminderJob = () => {
  console.log('⏰ Meeting reminder job started (checking every 5 min)');
  checkAndSendReminders(); // run once immediately on startup
  intervalId = setInterval(checkAndSendReminders, 5 * 60 * 1000);
};

const stopReminderJob = () => {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
};

module.exports = { startReminderJob, stopReminderJob };
