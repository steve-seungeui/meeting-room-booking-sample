import cluster from "node:cluster";
import { createApp, createServices } from "./app.js";
import { runReminderJob } from "./jobs/reminderJob.js";

const port = Number(process.env.PORT ?? 3000);
const databasePath = process.env.DB_PATH ?? "data/booking.db";
const workers = Number(process.env.WORKERS ?? 2);

if (cluster.isPrimary) {
  // 요청은 워커 프로세스들이 나누어 처리하고, 모든 프로세스가 같은 SQLite 파일을 쓴다.
  for (let i = 0; i < workers; i += 1) {
    cluster.fork();
  }
  cluster.on("exit", (worker) => {
    console.error(`[cluster] 워커 ${worker.process.pid} 종료, 다시 시작합니다.`);
    cluster.fork();
  });
  console.log(`meeting-room-booking listening on http://localhost:${port} (workers: ${workers})`);

  // 리마인더 작업은 주 프로세스에서 1분마다 한 번 실행한다.
  const services = createServices({ databasePath });
  setInterval(() => {
    runReminderJob(services.reservationRepository, services.roomService, services.clock).catch((error) => {
      console.error("[reminder] 실행 실패", error);
    });
  }, 60_000);
} else {
  const { app } = createApp({ databasePath });
  app.listen(port);
}
