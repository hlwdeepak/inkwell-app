const db = require('./db');

let isRunning = false;

function initScheduler(dispatchCampaignFn) {
  setInterval(async () => {
    if (isRunning) return;
    isRunning = true;
    try {
      const dueCampaigns = db.prepare(`
        SELECT id, subject, scheduled_for
        FROM campaigns
        WHERE status = 'scheduled'
          AND scheduled_for IS NOT NULL
          AND scheduled_for <= datetime('now')
      `).all();

      for (const camp of dueCampaigns) {
        console.log(`⏰ [SCHEDULER] Triggering scheduled campaign #${camp.id} (${camp.subject})`);
        try {
          await dispatchCampaignFn(camp.id);
        } catch (err) {
          console.error(`Scheduler failed to send campaign #${camp.id}:`, err.message);
        }
      }
    } catch (e) {
      console.error('Scheduler check error:', e.message);
    } finally {
      isRunning = false;
    }
  }, 20000); // Check every 20 seconds
}

module.exports = { initScheduler };
