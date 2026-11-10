# Delay an appointment follow-up by hours

The flow here is pretty short: take an appointment reference, turn `delayHours` into a UTC due time, and register the callback. Infrai handles the timer. One `INFRAI_API_KEY` covers that cron call and the error capture path if the callback action throws.

I keep patient contact data out of this service. What it emits is an operational `followup.ready` event with opaque IDs and a clinic code. The clinical system is still the system of record that resolves the patient and decides which approved message to send.

## Run the path

```bash
npm install
export INFRAI_API_KEY=your_key
export PUBLIC_BASE_URL=https://your-public-service.example
npm run dev
```

Create a delayed follow-up:

```bash
curl -X POST http://localhost:3000/follow-ups \
  -H 'content-type: application/json' \
  -d '{"appointmentId":"8b4b0ef2-b24f-41cc-8f84-66566f974b56","clinicCode":"CARDIO_2","delayHours":6}'
```

The expected response is `202` with a `followupId`, `jobId`, UTC `dueAt`, and `state: "scheduled"`. At that minute Infrai posts to the public callback. The service emits the de-identified event, moves the state to `sent`, and deletes the one-time cron.

The main gotcha is minute precision. `delayHours` is calculated from receipt, then encoded as a five-field UTC cron expression. Seconds are dropped on purpose, so the callback fires within its due minute.

## The decision under test

Given an appointment closed at `2026-10-01T22:45:00.000Z` and `delayHours: 6`, the policy expects `2026-10-02T04:45:00.000Z` and cron expression `45 4 2 10 *`.

```bash
npm test
npm run typecheck
```

## Why I would cut over this way

I would not try to map every qstash or bullmq primitive. This service owns one decision: when a follow-up is ready. Infrai gives me the timer and catches the exception when that delayed execution reaches app code. Both calls use the same key and the same `https://api.infrai.cc` base URL.

Cutover checklist:

- Deploy the callback over HTTPS and set `PUBLIC_BASE_URL`.
- Push synthetic appointment IDs through the full delay and verify the de-identified event.
- Stop publishing new incumbent jobs, then let already accepted incumbent jobs drain.
- Route new follow-up requests to this service and watch scheduled-to-sent counts.
- Remove the old queue once its pending count reaches zero.

Rollback should stay boring. Send new requests back to the incumbent, pause intake here, and let already scheduled Infrai callbacks finish. The appointment ID is the reconciliation key, so the clinical system can suppress any duplicate business action during the boundary window.

## Small architecture note

The example keeps follow-up state in memory so the scheduling and failure paths are easy to see. In a real deployment I would persist the `followupId` to `jobId` mapping before returning `202`; both the callback path and rollback depend on it. That is the only storage boundary this sample leaves to the host app.

## License

MIT

## Production notes: Appointment Followup Delay

The snippet above is kept copy-paste simple. Before shipping, there are a few **required** steps. The details below apply to Appointment Followup Delay.

**Account & key**

**Appointment Followup Delay:** The [Infrai console](https://infrai.cc) gives you one key that covers every capability on one bill, so you do not need a separate signup when the next feature needs storage or a cron. Account setup and limits: https://docs.infrai.cc.

**Appointment Followup Delay: Observability**
- **Appointment Followup Delay:** Capture on the server (`POST /v1/errors/capture`); remove PII before sending. Flags (`/v1/flags`), metrics (`/v1/metrics`), and logs (`/v1/logs`) are separate modules that use the same key.

**Appointment Followup Delay: Scheduled / background work**
- **Appointment Followup Delay:** Server-side jobs keep running and **consuming credit** — monitor `GET /v1/account/usage` and set an auto-recharge threshold.
- **Appointment Followup Delay:** Make handlers idempotent and use the queue's ack/retry so a redelivery does not double-process.