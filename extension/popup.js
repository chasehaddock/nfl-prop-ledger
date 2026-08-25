import { isRunLeaseActive } from "./run-state.js";

const status = document.querySelector("#status");
const error = document.querySelector("#error");
const button = document.querySelector("#capture");

async function refresh() {
  let state;
  try {
    state = await chrome.runtime.sendMessage({ type: "get-status" });
  } catch {
    state = await chrome.storage.local.get(["running", "runningSince", "lastStatus", "lastError"]);
  }
  status.textContent = state.lastStatus || "No capture has run yet.";
  error.textContent = state.lastError || "";
  button.disabled = isRunLeaseActive(state);
}

button.addEventListener("click", async () => {
  button.disabled = true;
  status.textContent = "Capture started. This takes several minutes.";
  const result = await chrome.runtime.sendMessage({ type: "capture-now" });
  if (!result?.ok) error.textContent = result?.error || "Capture failed";
  await refresh();
});
refresh();
