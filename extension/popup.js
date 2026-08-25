import { isRunLeaseActive } from "./run-state.js";

const status = document.querySelector("#status");
const error = document.querySelector("#error");
const button = document.querySelector("#capture");
const progressWrap = document.querySelector("#progress-wrap");
const progress = document.querySelector("#progress");
const progressLabel = document.querySelector("#progress-label");
const progressPercent = document.querySelector("#progress-percent");
const progressDetail = document.querySelector("#progress-detail");

function renderProgress(state) {
  const running = isRunLeaseActive(state);
  const value = Number.isFinite(state.progressPercent) ? Math.max(0, Math.min(100, state.progressPercent)) : 0;
  progressWrap.hidden = !running && value !== 100;
  progress.value = value;
  progress.textContent = `${value}%`;
  progressPercent.textContent = `${value}%`;
  progressLabel.textContent = state.progressSource || (value === 100 ? "Complete" : "Preparing…");
  progressDetail.textContent = state.progressDetail || "";
}

async function refresh() {
  let state;
  try {
    state = await chrome.runtime.sendMessage({ type: "get-status" });
  } catch {
    state = await chrome.storage.local.get(["running", "runningSince", "lastStatus", "lastError", "progressPercent", "progressSource", "progressDetail"]);
  }
  status.textContent = state.lastStatus || "No capture has run yet.";
  error.textContent = state.lastError || "";
  button.disabled = isRunLeaseActive(state);
  renderProgress(state);
}

button.addEventListener("click", async () => {
  button.disabled = true;
  status.textContent = "Capture started. This takes several minutes.";
  const result = await chrome.runtime.sendMessage({ type: "capture-now" });
  if (!result?.ok) error.textContent = result?.error || "Capture failed";
  await refresh();
});
refresh();
setInterval(refresh, 750);
