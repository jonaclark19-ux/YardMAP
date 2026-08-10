import { rest } from "./db.js";

export async function audit(user, action, entityType, entityId = null, details = {}) {
  try {
    await rest("audit_log", "", {
      method: "POST",
      body: {
        actor: user?.name || "system",
        actor_role: user?.role || "system",
        action,
        entity_type: entityType,
        entity_id: entityId == null ? null : String(entityId),
        details,
      },
      headers: { prefer: "return=minimal" },
    });
  } catch (error) {
    console.error("audit_failed", error);
  }
}
