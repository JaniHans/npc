import { tick } from "../../../shared/constants.js";

const PROCESS_N_TICKS = 30;

export function startRoomLoop(session, onTick) {
  if (!session) {
    throw new Error(`Room does not exist`);
  }
  if (!(session.status == "running")) {
    throw new Error(`Room ${session.roomId} is not running`);
  }
  if (session.tickHandle) {
    throw new Error(`${session.roomId} is running the gameloop`);
  }

  function schedule(nextTickAt) {
    let now = performance.now();
    let processed = 0;
    while (now >= nextTickAt && processed < PROCESS_N_TICKS) {
      onTick(session);
      nextTickAt += tick;
      processed++;
    }
    const delay = Math.max(0, nextTickAt - performance.now());
    session.tickHandle = setTimeout(() => schedule(nextTickAt), delay);
  }

  const reschedule = performance.now() + tick;

  schedule(reschedule);
}
export function stopRoomLoop(session) {
  if (session.tickHandle) {
    clearTimeout(session.tickHandle);
    session.tickHandle = null;
  }
}
