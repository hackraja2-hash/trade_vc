const { connect } = require('../db/connection');

async function logAudit(req, action, targetType = null, targetId = null, metadata = null) {
  try {
    const pool = await connect();
    await pool
      .request()
      .input('actor_user_id', req.user ? req.user.id : null)
      .input('actor_user_type', req.user ? req.user.user_type : null)
      .input('action', action)
      .input('target_type', targetType)
      .input('target_id', targetId)
      .input('metadata_json', metadata ? JSON.stringify(metadata) : null)
      .input('ip_address', req.ip || null)
      .query(`
        INSERT INTO dbo.audit_logs (
          actor_user_id,
          actor_user_type,
          action,
          target_type,
          target_id,
          metadata_json,
          ip_address
        )
        VALUES (
          @actor_user_id,
          @actor_user_type,
          @action,
          @target_type,
          @target_id,
          @metadata_json,
          @ip_address
        )
      `);
  } catch (error) {
    console.error('audit log error', error);
  }
}

module.exports = { logAudit };
