// 게임 시계 (초). 봇전·런에서 일시정지하면 멈춤. 온라인은 멈추지 않음
const st = { off: 0, pausedAt: null };
const real = () => performance.now() / 1000;
export const gameNow = () => (st.pausedAt ?? real()) - st.off;
export const isPaused = () => st.pausedAt !== null;
export function pauseClock(v) {
  if (v && st.pausedAt === null) st.pausedAt = real();
  else if (!v && st.pausedAt !== null) { st.off += real() - st.pausedAt; st.pausedAt = null; }
}
