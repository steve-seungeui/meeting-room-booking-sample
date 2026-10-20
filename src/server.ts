import { createApp } from "./app.js";
import { runReminderJob } from "./jobs/reminderJob.js";

const port = Number(process.env.PORT ?? 3000);
const { app, services } = createApp();

app.listen(port, () => {
  console.log(`meeting-room-booking listening on http://localhost:${port}`);
});

setInterval(() => {
  runReminderJob(services.reservationRepository, services.roomService, services.clock).catch((error) => {
    console.error("[reminder] 실행 실패", error);
  });
}, 60_000);
