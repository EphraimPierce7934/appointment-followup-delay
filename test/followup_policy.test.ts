import assert from "node:assert/strict";
import test from "node:test";
import { cronFor, decideFollowupDueAt } from "../src/followup_policy.js";

test("an appointment follow-up moves by the requested whole hours across midnight", () => {
  const appointmentClosedAt = new Date("2026-10-01T22:45:00.000Z");
  const dueAt = decideFollowupDueAt(appointmentClosedAt, 6);

  assert.equal(dueAt.toISOString(), "2026-10-02T04:45:00.000Z");
  assert.equal(cronFor(dueAt), "45 4 2 10 *");
});
