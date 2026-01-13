"use strict";

const tauri = window.__TAURI__ || {};
const coreApi = tauri.core || tauri.tauri || tauri;
const invoke = coreApi && coreApi.invoke ? coreApi.invoke.bind(coreApi) : null;
const convertFileSrc =
  coreApi && coreApi.convertFileSrc ? coreApi.convertFileSrc.bind(coreApi) : null;
const dialogApi =
  tauri.dialog || (tauri.plugins && tauri.plugins.dialog) || null;
const openDialog = dialogApi && dialogApi.open ? dialogApi.open.bind(dialogApi) : null;
const saveDialog = dialogApi && dialogApi.save ? dialogApi.save.bind(dialogApi) : null;
const eventApi = tauri.event || null;
const listen = eventApi && eventApi.listen ? eventApi.listen.bind(eventApi) : null;
const debugPanel = document.getElementById("debugPanel");
const debugLog = document.getElementById("debugLog");
const toggleDebugBtn = document.getElementById("toggleDebug");
const debugLines = [];

function formatDebugArg(value) {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function debug(...args) {
  const line = `[${new Date().toLocaleTimeString()}] ${args
    .map(formatDebugArg)
    .join(" ")}`;
  console.log("[debug]", ...args);
  debugLines.push(line);
  if (debugLines.length > 200) debugLines.shift();
  if (debugLog) {
    debugLog.textContent = debugLines.join("\n");
    debugLog.scrollTop = debugLog.scrollHeight;
  }
}

function setDebugPanelVisible(visible) {
  if (!debugPanel) return;
  debugPanel.hidden = !visible;
  if (visible) {
    debugPanel.open = true;
  }
  if (toggleDebugBtn) {
    toggleDebugBtn.textContent = visible ? "隐藏调试日志" : "显示调试日志";
  }
}

function toggleDebugPanel() {
  if (!debugPanel) return;
  setDebugPanelVisible(debugPanel.hidden);
}

debug("tauri injected", {
  hasTauri: !!window.__TAURI__,
  invoke: !!invoke,
  dialogOpen: !!openDialog,
  dialogSave: !!saveDialog,
  listen: !!listen
});

const stage = document.getElementById("stage");
const video = document.getElementById("video");
const overlay = document.getElementById("overlay");
const cropRect = document.getElementById("cropRect");
const dropHint = document.getElementById("dropHint");
const filePill = document.getElementById("filePill");
const ratioGrid = document.getElementById("ratioGrid");
const formatRow = document.getElementById("formatRow");
const outWidthInput = document.getElementById("outWidth");
const outHeightInput = document.getElementById("outHeight");
const lockRatioBtn = document.getElementById("lockRatio");
const previewCanvas = document.getElementById("previewCanvas");
const previewMeta = document.getElementById("previewMeta");
const trimTrack = document.getElementById("trimTrack");
const trimRange = document.getElementById("trimRange");
const trimStartRange = document.getElementById("trimStartRange");
const trimEndRange = document.getElementById("trimEndRange");
const trimStartInput = document.getElementById("trimStartInput");
const trimEndInput = document.getElementById("trimEndInput");
const trimMeta = document.getElementById("trimMeta");
const resetTrimBtn = document.getElementById("resetTrim");
const statusEl = document.getElementById("status");
const busyEl = document.getElementById("busy");
const togglePlayBtn = document.getElementById("togglePlay");
const resetCropBtn = document.getElementById("resetCrop");
const openFileBtn = document.getElementById("openFile");
const openFileAltBtn = document.getElementById("openFileAlt");
const exportBtn = document.getElementById("exportBtn");
const progressRange = document.getElementById("progressRange");
const progressCurrent = document.getElementById("progressCurrent");
const progressDuration = document.getElementById("progressDuration");
const toggleSoundBtn = document.getElementById("toggleSound");

const previewCtx = previewCanvas.getContext("2d");
const fileInput = document.createElement("input");
fileInput.type = "file";
fileInput.accept = "video/*";
fileInput.style.display = "none";
document.body.appendChild(fileInput);

const state = {
  inputPath: null,
  videoWidth: 0,
  videoHeight: 0,
  duration: 0,
  trim: { start: 0, end: 0 },
  cropSrc: { x: 0, y: 0, w: 0, h: 0 },
  display: { scale: 1, w: 0, h: 0, offsetX: 0, offsetY: 0 },
  output: { w: 640, h: 360, format: "mp4" },
  ratioMode: "source",
  lockRatio: true,
  previewSize: { cssW: 240, cssH: 135, dpr: 1 },
  previewOnly: false,
  muted: true
};

const MIN_CROP_PX = 36;
const TRIM_STEP = 0.1;
let isSeekingPlayback = false;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function roundEven(value) {
  const safe = Math.max(2, Math.round(value));
  return safe - (safe % 2);
}

function padNumber(value, length) {
  return String(value).padStart(length, "0");
}

function formatTimecode(seconds) {
  if (!Number.isFinite(seconds)) return "--:--";
  const totalMs = Math.max(0, Math.round(seconds * 1000));
  const ms = totalMs % 1000;
  const totalSec = Math.floor(totalMs / 1000);
  const sec = totalSec % 60;
  const totalMin = Math.floor(totalSec / 60);
  const min = totalMin % 60;
  const hour = Math.floor(totalMin / 60);
  return `${padNumber(hour, 2)}:${padNumber(min, 2)}:${padNumber(sec, 2)}.${padNumber(ms, 3)}`;
}

function parseTimecode(value) {
  if (!value) return NaN;
  const text = String(value).trim();
  if (!text) return NaN;
  if (text.includes(":")) {
    const parts = text.split(":");
    if (parts.length > 3) return NaN;
    let h = 0;
    let m = 0;
    let s = 0;
    if (parts.length === 3) {
      h = parseFloat(parts[0]);
      m = parseFloat(parts[1]);
      s = parseFloat(parts[2]);
    } else {
      m = parseFloat(parts[0]);
      s = parseFloat(parts[1]);
    }
    if (!Number.isFinite(h) || !Number.isFinite(m) || !Number.isFinite(s)) {
      return NaN;
    }
    return h * 3600 + m * 60 + s;
  }
  const seconds = parseFloat(text);
  return Number.isFinite(seconds) ? seconds : NaN;
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.style.color = isError ? "#c2411c" : "";
}

function setBusy(isBusy) {
  busyEl.hidden = !isBusy;
}

function updateSoundButton() {
  if (!toggleSoundBtn) return;
  toggleSoundBtn.dataset.muted = state.muted ? "true" : "false";
  toggleSoundBtn.textContent = state.muted ? "开启声音" : "静音";
}

function applyMuteState() {
  if (!video) return;
  video.muted = state.muted;
  updateSoundButton();
}

function setTrimEnabled(enabled) {
  [trimStartRange, trimEndRange, trimStartInput, trimEndInput, resetTrimBtn].forEach(
    (el) => {
      if (!el) return;
      el.disabled = !enabled;
    }
  );
}

function updateTrimUI() {
  if (!trimStartRange || !trimEndRange) return;
  const duration = state.duration;
  if (!Number.isFinite(duration) || duration <= 0) {
    trimStartRange.min = "0";
    trimStartRange.max = "0";
    trimStartRange.value = "0";
    trimEndRange.min = "0";
    trimEndRange.max = "0";
    trimEndRange.value = "0";
    if (trimStartInput) trimStartInput.value = "00:00:00.000";
    if (trimEndInput) trimEndInput.value = "00:00:00.000";
    if (trimRange) {
      trimRange.style.left = "0%";
      trimRange.style.width = "0%";
    }
    if (trimMeta) trimMeta.textContent = "总时长 --:--";
    setTrimEnabled(false);
    return;
  }

  const minGap = Math.min(TRIM_STEP, duration);
  let start = clamp(state.trim.start, 0, duration);
  let end = clamp(state.trim.end, 0, duration);
  if (end - start < minGap) {
    if (start + minGap <= duration) {
      end = start + minGap;
    } else {
      start = Math.max(0, end - minGap);
    }
  }

  state.trim.start = start;
  state.trim.end = end;

  trimStartRange.min = "0";
  trimStartRange.max = String(duration);
  trimStartRange.step = String(TRIM_STEP);
  trimStartRange.value = start.toFixed(3);
  trimEndRange.min = "0";
  trimEndRange.max = String(duration);
  trimEndRange.step = String(TRIM_STEP);
  trimEndRange.value = end.toFixed(3);

  if (trimStartInput) trimStartInput.value = formatTimecode(start);
  if (trimEndInput) trimEndInput.value = formatTimecode(end);

  if (trimRange) {
    const startPct = (start / duration) * 100;
    const endPct = (end / duration) * 100;
    trimRange.style.left = `${startPct}%`;
    trimRange.style.width = `${Math.max(0, endPct - startPct)}%`;
  }
  if (trimMeta) {
    trimMeta.textContent = `总时长 ${formatTimecode(duration)} · 截取 ${formatTimecode(start)} - ${formatTimecode(end)}`;
  }
  setTrimEnabled(true);
}

function resetTrimToFull() {
  if (!Number.isFinite(state.duration) || state.duration <= 0) return;
  state.trim.start = 0;
  state.trim.end = state.duration;
  updateTrimUI();
}

function setTrimStart(value) {
  if (!Number.isFinite(state.duration) || state.duration <= 0) return;
  const minGap = Math.min(TRIM_STEP, state.duration);
  let start = clamp(value, 0, state.duration);
  let end = state.trim.end;
  if (end - start < minGap) {
    start = Math.max(0, end - minGap);
  }
  state.trim.start = start;
  updateTrimUI();
}

function setTrimEnd(value) {
  if (!Number.isFinite(state.duration) || state.duration <= 0) return;
  const minGap = Math.min(TRIM_STEP, state.duration);
  let end = clamp(value, 0, state.duration);
  let start = state.trim.start;
  if (end - start < minGap) {
    end = Math.min(state.duration, start + minGap);
  }
  state.trim.end = end;
  updateTrimUI();
}

function getTrimPayload() {
  if (!Number.isFinite(state.duration) || state.duration <= 0) return null;
  const start = state.trim.start;
  const end = state.trim.end;
  const epsilon = 0.001;
  if (Math.abs(start) <= epsilon && Math.abs(end - state.duration) <= epsilon) {
    return null;
  }
  return { start, end };
}

function updateFilePill(path) {
  if (!path) {
    filePill.textContent = "未选择文件";
    return;
  }
  const parts = path.split(/[\\/]/);
  filePill.textContent = parts[parts.length - 1];
}

function updateRatioButtons() {
  ratioGrid.querySelectorAll("button").forEach((btn) => {
    const key = btn.dataset.ratio;
    btn.classList.toggle("active", key === state.ratioMode);
  });
}

function updateFormatButtons() {
  formatRow.querySelectorAll("button").forEach((btn) => {
    const key = btn.dataset.format;
    btn.classList.toggle("active", key === state.output.format);
  });
}

function updateOutputInputs() {
  outWidthInput.value = state.output.w;
  outHeightInput.value = state.output.h;
  previewMeta.textContent = state.videoWidth
    ? `输出 ${state.output.w} x ${state.output.h}`
    : "暂无视频";
}

function updateLockButton() {
  lockRatioBtn.dataset.locked = state.lockRatio ? "true" : "false";
  lockRatioBtn.textContent = state.lockRatio ? "锁定比例" : "解除锁定";
}

function getActiveRatio() {
  if (!state.videoWidth || !state.videoHeight) {
    return 1;
  }
  if (state.ratioMode === "source") {
    return state.videoWidth / state.videoHeight;
  }
  if (state.ratioMode === "custom") {
    const ratio = state.output.w / state.output.h;
    return ratio > 0 ? ratio : state.videoWidth / state.videoHeight;
  }
  return parseRatio(state.ratioMode);
}

function fitSizeToRatio(maxW, maxH, ratio) {
  let w = maxW;
  let h = Math.round(w / ratio);
  if (h > maxH) {
    h = maxH;
    w = Math.round(h * ratio);
  }
  return { w: roundEven(w), h: roundEven(h) };
}

function setCropToRatio(ratio) {
  if (!state.videoWidth || !state.videoHeight) return;
  const centerX = state.cropSrc.x + state.cropSrc.w / 2;
  const centerY = state.cropSrc.y + state.cropSrc.h / 2;

  let w = state.cropSrc.w;
  let h = w / ratio;
  if (h > state.videoHeight) {
    h = state.videoHeight;
    w = h * ratio;
  }
  if (w > state.videoWidth) {
    w = state.videoWidth;
    h = w / ratio;
  }

  let x = centerX - w / 2;
  let y = centerY - h / 2;
  x = clamp(x, 0, state.videoWidth - w);
  y = clamp(y, 0, state.videoHeight - h);

  state.cropSrc = { x, y, w, h };
  renderCropOverlay();
}

function resetCropToFull() {
  if (!state.videoWidth || !state.videoHeight) return;
  state.cropSrc = {
    x: 0,
    y: 0,
    w: state.videoWidth,
    h: state.videoHeight
  };
  renderCropOverlay();
}

function updateDisplayMetrics() {
  if (!state.videoWidth || !state.videoHeight) return;
  const rect = stage.getBoundingClientRect();
  const scale = Math.min(
    rect.width / state.videoWidth,
    rect.height / state.videoHeight
  );
  const displayW = state.videoWidth * scale;
  const displayH = state.videoHeight * scale;
  const offsetX = (rect.width - displayW) / 2;
  const offsetY = (rect.height - displayH) / 2;
  state.display = { scale, w: displayW, h: displayH, offsetX, offsetY };
}

function cropSrcToDisplayRect() {
  const d = state.display;
  return {
    x: d.offsetX + state.cropSrc.x * d.scale,
    y: d.offsetY + state.cropSrc.y * d.scale,
    w: state.cropSrc.w * d.scale,
    h: state.cropSrc.h * d.scale
  };
}

function displayRectToCropSrc(rect) {
  const d = state.display;
  const x = (rect.x - d.offsetX) / d.scale;
  const y = (rect.y - d.offsetY) / d.scale;
  const w = rect.w / d.scale;
  const h = rect.h / d.scale;
  return {
    x: clamp(x, 0, state.videoWidth - w),
    y: clamp(y, 0, state.videoHeight - h),
    w,
    h
  };
}

function renderCropOverlay() {
  if (!state.videoWidth || !state.videoHeight) {
    overlay.style.display = "none";
    return;
  }
  updateDisplayMetrics();
  overlay.style.display = "block";
  const rect = cropSrcToDisplayRect();
  cropRect.style.left = `${rect.x}px`;
  cropRect.style.top = `${rect.y}px`;
  cropRect.style.width = `${rect.w}px`;
  cropRect.style.height = `${rect.h}px`;
}

function updatePreviewCanvasSize() {
  const ratio = state.output.w / state.output.h || 1;
  const maxW = 280;
  const maxH = 180;
  let cssW = maxW;
  let cssH = cssW / ratio;
  if (cssH > maxH) {
    cssH = maxH;
    cssW = cssH * ratio;
  }
  const dpr = window.devicePixelRatio || 1;
  previewCanvas.style.width = `${cssW}px`;
  previewCanvas.style.height = `${cssH}px`;
  previewCanvas.width = Math.max(2, Math.round(cssW * dpr));
  previewCanvas.height = Math.max(2, Math.round(cssH * dpr));
  previewCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  state.previewSize = { cssW, cssH, dpr };
}

function parseRatio(value) {
  const parts = value.split(":");
  if (parts.length !== 2) return 1;
  const w = parseFloat(parts[0]);
  const h = parseFloat(parts[1]);
  if (!Number.isFinite(w) || !Number.isFinite(h) || h === 0) return 1;
  return w / h;
}

function renderPreview() {
  if (!state.videoWidth || video.readyState < 2) return;
  const crop = state.cropSrc;
  const { cssW, cssH } = state.previewSize;
  previewCtx.clearRect(0, 0, cssW, cssH);
  previewCtx.drawImage(
    video,
    crop.x,
    crop.y,
    crop.w,
    crop.h,
    0,
    0,
    cssW,
    cssH
  );
}

function getPlaybackDuration() {
  if (Number.isFinite(state.duration) && state.duration > 0) {
    return state.duration;
  }
  if (Number.isFinite(video.duration) && video.duration > 0) {
    return video.duration;
  }
  return 0;
}

function updatePlaybackMeta(currentTime, duration) {
  if (progressCurrent) {
    const safeTime = Math.max(0, Number.isFinite(currentTime) ? currentTime : 0);
    progressCurrent.textContent = formatTimecode(safeTime);
  }
  if (progressDuration) {
    progressDuration.textContent =
      duration > 0 ? formatTimecode(duration) : "--:--";
  }
}

function updatePlaybackUI(currentTime = video.currentTime) {
  if (!progressRange) return;
  const duration = getPlaybackDuration();
  const hasDuration = duration > 0;

  if (!hasDuration) {
    progressRange.disabled = true;
    progressRange.max = "0";
    progressRange.value = "0";
    progressRange.style.setProperty("--progress", "0%");
    updatePlaybackMeta(0, 0);
    return;
  }

  progressRange.disabled = false;
  progressRange.max = String(duration);
  const safeTime = clamp(currentTime, 0, duration);
  let readoutTime = safeTime;

  if (isSeekingPlayback) {
    const draggingValue = clamp(
      Number.isFinite(parseFloat(progressRange.value))
        ? parseFloat(progressRange.value)
        : safeTime,
      0,
      duration
    );
    readoutTime = draggingValue;
  } else {
    progressRange.value = String(safeTime);
  }

  updatePlaybackMeta(readoutTime, duration);
  const percent = duration > 0 ? (readoutTime / duration) * 100 : 0;
  progressRange.style.setProperty("--progress", `${percent}%`);
}

function startPreviewLoop() {
  function tick() {
    renderPreview();
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

async function chooseFile() {
  setStatus("");
  debug("chooseFile start", { hasOpenDialog: !!openDialog, hasInvoke: !!invoke });
  const selected = await openDialogNative({
    multiple: false,
    filters: [{ name: "Video", extensions: ["mp4", "mov", "avi", "mkv", "webm"] }]
  });
  debug("chooseFile selected", selected);
  const path = normalizeDialogResult(selected);
  debug("chooseFile normalized path", path);
  if (path) {
    await loadVideoFromPath(path);
    return;
  }
  if (!openDialog && !invoke) {
    fileInput.click();
  }
}

function loadVideoFromFile(file) {
  if (!file) return;
  state.inputPath = file.path || null;
  state.previewOnly = !state.inputPath;
  state.duration = 0;
  state.trim = { start: 0, end: 0 };
  updateTrimUI();
  updatePlaybackUI(0);
  debug("loadVideoFromFile", {
    name: file.name,
    path: file.path || null,
    previewOnly: state.previewOnly
  });
  video.src = URL.createObjectURL(file);
  video.load();
  updateFilePill(file.name || "Local file");
  if (state.previewOnly) {
    setStatus("已加载预览，导出请用“选择文件”选择本地文件。", true);
  }
}

async function loadVideoFromPath(path) {
  state.inputPath = path;
  state.previewOnly = false;
  setStatus("");
  state.duration = 0;
  state.trim = { start: 0, end: 0 };
  updateTrimUI();
  updatePlaybackUI(0);
  debug("loadVideoFromPath", path);
  const src = convertFileSrc ? convertFileSrc(path) : path;
  video.src = src;
  video.load();
  updateFilePill(path);
}

function applySourceDefaults() {
  state.ratioMode = "source";
  updateRatioButtons();
  state.output.w = roundEven(state.videoWidth);
  state.output.h = roundEven(state.videoHeight);
  updateOutputInputs();
  resetCropToFull();
  updatePreviewCanvasSize();
}

function moveRect(rect, dx, dy, bounds) {
  const x = clamp(rect.x + dx, bounds.x, bounds.x + bounds.w - rect.w);
  const y = clamp(rect.y + dy, bounds.y, bounds.y + bounds.h - rect.h);
  return { x, y, w: rect.w, h: rect.h };
}

function resizeRect(rect, handle, dx, dy, bounds, ratio) {
  const hasW = handle.includes("w");
  const hasE = handle.includes("e");
  const hasN = handle.includes("n");
  const hasS = handle.includes("s");
  const resizeX = hasW || hasE;
  const resizeY = hasN || hasS;
  const useRatio = ratio && resizeX && resizeY;
  const widthDriven = useRatio && Math.abs(dx) > Math.abs(dy);

  const anchorX = hasW ? rect.x + rect.w : rect.x;
  const anchorY = hasN ? rect.y + rect.h : rect.y;

  let newW = rect.w;
  let newH = rect.h;

  if (resizeX) {
    newW = rect.w + (hasE ? dx : -dx);
  }
  if (resizeY) {
    newH = rect.h + (hasS ? dy : -dy);
  }

  if (useRatio) {
    if (widthDriven) {
      newH = newW / ratio;
    } else {
      newW = newH * ratio;
    }
  }

  newW = Math.max(newW, MIN_CROP_PX);
  newH = Math.max(newH, MIN_CROP_PX);

  let maxW = resizeX
    ? hasW
      ? anchorX - bounds.x
      : bounds.x + bounds.w - anchorX
    : rect.w;
  let maxH = resizeY
    ? hasN
      ? anchorY - bounds.y
      : bounds.y + bounds.h - anchorY
    : rect.h;

  if (useRatio) {
    if (maxW / maxH > ratio) {
      maxW = maxH * ratio;
    } else {
      maxH = maxW / ratio;
    }
  }

  if (resizeX) {
    newW = Math.min(newW, maxW);
  }
  if (resizeY) {
    newH = Math.min(newH, maxH);
  }

  if (useRatio) {
    if (widthDriven) {
      newH = newW / ratio;
    } else {
      newW = newH * ratio;
    }
  }

  const x = resizeX ? (hasW ? anchorX - newW : anchorX) : rect.x;
  const y = resizeY ? (hasN ? anchorY - newH : anchorY) : rect.y;
  return { x, y, w: newW, h: newH };
}

let dragState = null;

cropRect.addEventListener("pointerdown", (event) => {
  if (!state.videoWidth) return;
  const handle = event.target.dataset.handle || null;
  const rect = cropSrcToDisplayRect();
  dragState = {
    mode: handle ? "resize" : "move",
    handle,
    startX: event.clientX,
    startY: event.clientY,
    startRect: rect
  };
  cropRect.setPointerCapture(event.pointerId);
});

window.addEventListener("pointermove", (event) => {
  if (!dragState) return;
  const dx = event.clientX - dragState.startX;
  const dy = event.clientY - dragState.startY;
  const bounds = {
    x: state.display.offsetX,
    y: state.display.offsetY,
    w: state.display.w,
    h: state.display.h
  };
  const ratio = getActiveRatio();
  let rect;
  if (dragState.mode === "move") {
    rect = moveRect(dragState.startRect, dx, dy, bounds);
  } else {
    rect = resizeRect(dragState.startRect, dragState.handle, dx, dy, bounds, ratio);
  }
  state.cropSrc = displayRectToCropSrc(rect);
  renderCropOverlay();
});

window.addEventListener("pointerup", (event) => {
  if (!dragState) return;
  dragState = null;
  if (cropRect.hasPointerCapture(event.pointerId)) {
    cropRect.releasePointerCapture(event.pointerId);
  }
});

ratioGrid.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  const value = button.dataset.ratio;
  if (!value) return;

  state.ratioMode = value;

  updateRatioButtons();

  if (state.videoWidth) {
    if (state.ratioMode === "source") {
      state.output.w = roundEven(state.videoWidth);
      state.output.h = roundEven(state.videoHeight);
    } else if (state.ratioMode !== "custom") {
      const fitted = fitSizeToRatio(
        state.videoWidth,
        state.videoHeight,
        parseRatio(state.ratioMode)
      );
      state.output.w = fitted.w;
      state.output.h = fitted.h;
    }
    updateOutputInputs();
    setCropToRatio(getActiveRatio());
    updatePreviewCanvasSize();
  }
});

formatRow.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  const format = button.dataset.format;
  if (!format) return;
  state.output.format = format;
  updateFormatButtons();
});

outWidthInput.addEventListener("input", () => {
  const value = parseInt(outWidthInput.value, 10);
  if (!Number.isFinite(value)) return;
  state.ratioMode = "custom";
  updateRatioButtons();
  const currentRatio = state.output.w / state.output.h || 1;
  const newW = roundEven(value);
  let newH = state.output.h;
  if (state.lockRatio) {
    newH = roundEven(newW / currentRatio);
  }
  state.output.w = newW;
  state.output.h = newH;
  updateOutputInputs();
  setCropToRatio(getActiveRatio());
  updatePreviewCanvasSize();
});

outHeightInput.addEventListener("input", () => {
  const value = parseInt(outHeightInput.value, 10);
  if (!Number.isFinite(value)) return;
  state.ratioMode = "custom";
  updateRatioButtons();
  const currentRatio = state.output.w / state.output.h || 1;
  const newH = roundEven(value);
  let newW = state.output.w;
  if (state.lockRatio) {
    newW = roundEven(newH * currentRatio);
  }
  state.output.w = newW;
  state.output.h = newH;
  updateOutputInputs();
  setCropToRatio(getActiveRatio());
  updatePreviewCanvasSize();
});

lockRatioBtn.addEventListener("click", () => {
  state.lockRatio = !state.lockRatio;
  updateLockButton();
});

togglePlayBtn.addEventListener("click", () => {
  if (!state.videoWidth) return;
  if (video.paused) {
    video.play();
    togglePlayBtn.textContent = "暂停";
  } else {
    video.pause();
    togglePlayBtn.textContent = "播放";
  }
});

resetCropBtn.addEventListener("click", () => {
  resetCropToFull();
});

if (trimStartRange) {
  trimStartRange.addEventListener("input", () => {
    const value = parseFloat(trimStartRange.value);
    if (Number.isFinite(value)) {
      setTrimStart(value);
    }
  });
}

if (trimEndRange) {
  trimEndRange.addEventListener("input", () => {
    const value = parseFloat(trimEndRange.value);
    if (Number.isFinite(value)) {
      setTrimEnd(value);
    }
  });
}

if (trimStartInput) {
  const commitStartInput = () => {
    const value = parseTimecode(trimStartInput.value);
    if (Number.isFinite(value)) {
      setTrimStart(value);
    } else {
      updateTrimUI();
    }
  };
  trimStartInput.addEventListener("change", commitStartInput);
  trimStartInput.addEventListener("blur", commitStartInput);
}

if (trimEndInput) {
  const commitEndInput = () => {
    const value = parseTimecode(trimEndInput.value);
    if (Number.isFinite(value)) {
      setTrimEnd(value);
    } else {
      updateTrimUI();
    }
  };
  trimEndInput.addEventListener("change", commitEndInput);
  trimEndInput.addEventListener("blur", commitEndInput);
}

if (resetTrimBtn) {
  resetTrimBtn.addEventListener("click", () => {
    resetTrimToFull();
  });
}

if (progressRange) {
  const stopSeekingPlayback = () => {
    isSeekingPlayback = false;
    updatePlaybackUI();
  };
  progressRange.addEventListener("pointerdown", () => {
    isSeekingPlayback = true;
  });
  progressRange.addEventListener("input", () => {
    const duration = getPlaybackDuration();
    if (duration <= 0) return;
    isSeekingPlayback = true;
    const value = clamp(parseFloat(progressRange.value), 0, duration);
    if (!Number.isFinite(value)) return;
    video.currentTime = value;
    updatePlaybackMeta(value, duration);
    progressRange.value = String(value);
    const percent = duration > 0 ? (value / duration) * 100 : 0;
    progressRange.style.setProperty("--progress", `${percent}%`);
  });
  ["pointerup", "pointercancel", "change", "blur"].forEach((eventName) =>
    progressRange.addEventListener(eventName, stopSeekingPlayback)
  );
}

if (toggleSoundBtn) {
  toggleSoundBtn.addEventListener("click", () => {
    state.muted = !state.muted;
    applyMuteState();
  });
}

openFileBtn.addEventListener("click", chooseFile);
openFileAltBtn.addEventListener("click", chooseFile);

exportBtn.addEventListener("click", async () => {
  debug("export click", { inputPath: state.inputPath, previewOnly: state.previewOnly });
  if (!state.inputPath) {
    if (openDialog || invoke) {
      setStatus("??????????????????????", true);
      await chooseFile();
    }
    if (!state.inputPath) {
      setStatus("请先选择视频文件。", true);
      return;
    }
  }
  if (!invoke && !saveDialog) {
    setStatus("导出需要 Tauri API 支持。", true);
    return;
  }

  const defaultName = "cropped." + state.output.format;
  const outputPath = normalizeDialogResult(
    await saveDialogNative({
      defaultPath: defaultName,
      filters: [{ name: "Video", extensions: [state.output.format] }]
    })
  );

  if (!outputPath) return;

  setBusy(true);
  setStatus("正在导出...");
  const trim = getTrimPayload();
  debug("export start", { outputPath, crop: state.cropSrc, output: state.output, trim });

  const crop = {
    x: Math.round(state.cropSrc.x),
    y: Math.round(state.cropSrc.y),
    width: Math.round(state.cropSrc.w),
    height: Math.round(state.cropSrc.h)
  };

  const output = {
    width: Math.round(state.output.w),
    height: Math.round(state.output.h),
    format: state.output.format
  };

  try {
    await invoke("crop_video", {
      req: {
        input_path: state.inputPath,
        output_path: outputPath,
        crop,
        output,
        trim
      }
    });
    setStatus("导出完成。");
    debug("export completed");
  } catch (error) {
    setStatus(String(error), true);
    debug("export failed", error);
  } finally {
    setBusy(false);
  }
});

stage.addEventListener("dragover", (event) => {
  event.preventDefault();
});

stage.addEventListener("drop", (event) => {
  event.preventDefault();
  if (!event.dataTransfer || !event.dataTransfer.files.length) return;
  const file = event.dataTransfer.files[0];
  debug("html drop", { name: file.name, path: file.path || null });
  loadVideoFromFile(file);
});

fileInput.addEventListener("change", (event) => {
  const file = event.target.files[0];
  debug("file input change", { name: file && file.name, path: file && file.path });
  loadVideoFromFile(file);
});

  video.addEventListener("loadedmetadata", () => {
    state.videoWidth = video.videoWidth;
    state.videoHeight = video.videoHeight;
    state.duration = Number.isFinite(video.duration) ? video.duration : 0;
    state.trim.start = 0;
    state.trim.end = state.duration;
    dropHint.style.display = "none";
    overlay.style.display = "block";
    togglePlayBtn.textContent = "暂停";
    applySourceDefaults();
    updateTrimUI();
    renderCropOverlay();
    updatePreviewCanvasSize();
    updatePlaybackUI();
    video.play();
  debug("video loadedmetadata", {
    width: state.videoWidth,
    height: state.videoHeight,
    src: video.currentSrc
  });
});

video.addEventListener("pause", () => {
  togglePlayBtn.textContent = "播放";
});

video.addEventListener("play", () => {
  togglePlayBtn.textContent = "暂停";
});

video.addEventListener("loadeddata", () => {
  debug("video loadeddata", { readyState: video.readyState, src: video.currentSrc });
});

video.addEventListener("error", () => {
  const code = video.error ? video.error.code : null;
  debug("video error", { code, src: video.currentSrc });
  setStatus("视频加载失败，请换一种导入方式或文件格式。", true);
});

video.addEventListener("timeupdate", () => {
  updatePlaybackUI();
});

video.addEventListener("seeked", () => {
  updatePlaybackUI();
});

video.addEventListener("durationchange", () => {
  updatePlaybackUI();
});

window.addEventListener("resize", () => {
  renderCropOverlay();
});

if (toggleDebugBtn) {
  toggleDebugBtn.addEventListener("click", () => {
    toggleDebugPanel();
  });
}

if (listen) {
  const extractDropPath = (payload) => {
    if (Array.isArray(payload) && payload.length) return payload[0];
    if (payload && Array.isArray(payload.paths) && payload.paths.length) {
      return payload.paths[0];
    }
    if (payload && typeof payload.path === "string") return payload.path;
    return null;
  };

  const handleTauriDrop = (eventName) =>
    listen(eventName, (event) => {
      debug(`${eventName} event`, event.payload);
      const path = extractDropPath(event.payload);
      debug(`${eventName} normalized path`, path);
      if (path) {
        loadVideoFromPath(path);
      }
    });

  handleTauriDrop("tauri://drag-drop");
  handleTauriDrop("tauri://file-drop");
}

async function openDialogNative(options) {
  if (openDialog) {
    return await openDialog(options);
  }
  if (!invoke) return null;
  try {
    const result = await invoke("plugin:dialog|open", { options });
    debug("invoke dialog open result", result);
    return result;
  } catch (error) {
    console.error("open dialog failed", error);
    return null;
  }
}

async function saveDialogNative(options) {
  if (saveDialog) {
    return await saveDialog(options);
  }
  if (!invoke) return null;
  try {
    const result = await invoke("plugin:dialog|save", { options });
    debug("invoke dialog save result", result);
    return result;
  } catch (error) {
    console.error("save dialog failed", error);
    return null;
  }
}

function normalizeDialogResult(result) {
  debug("normalizeDialogResult input", result);
  if (!result) return null;
  if (typeof result === "string") return result;
  if (Array.isArray(result)) return result[0] || null;
  if (typeof result === "object") {
    if (typeof result.path === "string") return result.path;
    if (typeof result.url === "string") return result.url;
  }
  return null;
}

updateRatioButtons();
updateFormatButtons();
updateLockButton();
updateOutputInputs();
updateTrimUI();
updatePreviewCanvasSize();
renderCropOverlay();
applyMuteState();
updatePlaybackUI();
startPreviewLoop();
