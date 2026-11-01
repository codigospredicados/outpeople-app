let retryUntil = 0;

export function streetRetryDelay() { return Math.max(0, Math.ceil((retryUntil - Date.now()) / 1000)); }

export function streetRetryAfter(response) {
  const header = response.headers.get('retry-after');
  if (!header || ![429, 503].includes(response.status)) return 0;
  const seconds = /^\d+$/.test(header) ? Number(header) : Math.ceil((Date.parse(header) - Date.now()) / 1000);
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  const delay = Math.min(86400, seconds);
  retryUntil = Math.max(retryUntil, Date.now() + delay * 1000);
  return streetRetryDelay();
}

export function createStreetRetry(button) {
  const label = button.textContent;
  let timer;
  function update() {
    const seconds = streetRetryDelay();
    button.disabled = seconds > 0;
    button.textContent = seconds ? `${label} (${seconds} s)` : label;
    if (!seconds) { clearInterval(timer); timer = null; }
  }
  return {
    show() {
      clearInterval(timer); button.hidden = false; update();
      if (streetRetryDelay()) timer = setInterval(update, 1000);
    },
    hide() { clearInterval(timer); timer = null; button.hidden = true; button.disabled = false; button.textContent = label; }
  };
}
