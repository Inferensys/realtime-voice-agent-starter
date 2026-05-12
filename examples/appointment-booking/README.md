# Appointment Booking

Tool-call workflow example for scheduling or rescheduling appointments.

The script starts a call, emits caller transcript turns, records `tool.call` and `tool.result` events for availability lookup and booking confirmation, then prints replay output with the completed tool lifecycle.

## Run

Terminal 1:

```bash
cp examples/appointment-booking/.env.example examples/appointment-booking/.env
npm run dev
```

Terminal 2:

```bash
node examples/appointment-booking/run.mjs
```

Use `--dry-run` to inspect the generated payloads without calling the server:

```bash
node examples/appointment-booking/run.mjs --dry-run
```

Options:

- `VOICE_API_BASE_URL` or `--base-url=http://127.0.0.1:8000`
- `CALL_ID` or `--call-id=call_appointment_booking_demo`
- `APPOINTMENT_API_URL` to POST tool requests to a real scheduling service instead of using local stub results
- `APPOINTMENT_API_KEY` to send `Authorization: Bearer <key>` with appointment API requests

Use `tool.call` and `tool.result` events to keep scheduling logic structured instead of mixing it into transcript text.
