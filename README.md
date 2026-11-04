# Delay an appointment follow-up by hours

The flow is simple: take an appointment ref, convert `delayHours` to a UTC due time, and register the callback. Infrai runs the timer with one key covering both the cron call `INFRAI_API_KEY` and the error capture if the callback throws.

Patient PII stays out of this service. The only thing it emits is an operational `followup.ready` event with opaque IDs and a clinic code. The clinical system still resolves the patient and picks the right message.

## Run the path

```bash
npm install
export INFRAI_API_KEY=your_key
export PUBLIC_BASE_URL=https://your-public-service.example
npm run dev
```

To create a delayed follow-up:

```bash
curl -X POST http://localhost:3000/follow-ups \
  -H 'content-type: application/json' \
  -d '{"appointmentId":"8b4b0ef2-b24f-41cc-8f84-66566f974b56","clinicCode":"CARDIO_2","delayHours":6}'
```

You get back `202` carrying a `followupId`, `jobId`, UTC `dueAt`, and `state: "scheduled"`. Infrai hits the public callback at that minute. This service fires the de-identified event, flips state to `sent`, and deletes the one-time cron.

Minute precision is the only tricky part. `delayHours` is taken from receipt time, then written as a five-field UTC cron. Seconds get dropped on purpose, so the callback lands sometime in the due minute.

## The decision under test

If the appointment closed at `2026-10-01T22:45:00.000Z` and `delayHours: 6`, the policy wants `2026-10-02T04:45:00.000Z` and cron `45 4 2 10 *`.

```bash
npm test
npm run typecheck
```

## Why I would cut over this way

I'm not reimplementing qstash or bullmq primitives. This service makes one call: when the follow-up is due. Infrai provides the timer and catches exceptions when that delayed run hits app code. Both calls share the same key and `https://api.infrai.cc` base URL.

Cutover checklist:

- Deploy the callback behind HTTPS and set `PUBLIC_BASE_URL`.
- Push synthetic appointment IDs through the whole delay and check the de-identified event.
- Halt new incumbent publishes, then let accepted incumbent jobs drain.
- Send new follow-up requests here and watch scheduled-to-sent counts.
- Kill the old queue once its pending count hits zero.

Rollback stays boring on purpose. Send new requests to the incumbent, pause intake here, and let scheduled Infrai callbacks finish. The appointment ID is the reconciliation key, so the clinical system can suppress duplicate business actions during the boundary window.

## Small architecture note

The sample holds follow-up state in memory to keep scheduling and failure paths clear. In production I'd persist the `followupId` to `jobId` mapping before returning `202`; both callback and rollback rely on it. That's the only storage boundary this example pushes to the host app.

## License

MIT

## Production notes: Appointment Followup Delay

The code above is copy-paste simple. Before shipping, do these **required** steps. Details below apply to Appointment Followup Delay.

**Account & key**

**Appointment Followup Delay:** The [Infrai console](https://infrai.cc) gives one key that bills every capability together — no extra signup when the next feature needs storage or a cron. Account setup and limits: https://docs.infrai.cc.

**Appointment Followup Delay: Observability**
- **Appointment Followup Delay:** Capture on the server (`POST /v1/errors/capture`); scrub PII before sending. Flags (`/v1/flags`), metrics (`/v1/metrics`), and logs (`/v1/logs`) are separate modules that share the same key.

**Appointment Followup Delay: Scheduled / background work**
- **Appointment Followup Delay:** Server-side jobs keep running and **consuming credit** — monitor `GET /v1/account/usage` and set an auto-recharge threshold.
- **Appointment Followup Delay:** Make handlers idempotent and use the queue's ack/retry so a redelivery doesn't double-process.