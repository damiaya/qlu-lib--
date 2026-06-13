const state = {
  tokenReady: false,
  mode: "now",
  selectedSeat: null,
  selectedArea: null,
  time: null,
  seats: [],
  areas: [],
  storeys: []
};

const refs = {
  tokenPill: document.querySelector("#tokenPill"),
  tokenTitle: document.querySelector("#tokenTitle"),
  tokenMeta: document.querySelector("#tokenMeta"),
  tokenButton: document.querySelector("#tokenButton"),
  clearTokenButton: document.querySelector("#clearTokenButton"),
  loginButton: document.querySelector("#loginButton"),
  refreshButton: document.querySelector("#refreshButton"),
  freeCount: document.querySelector("#freeCount"),
  seatMap: document.querySelector("#seatMap"),
  seatSearch: document.querySelector("#seatSearch"),
  dateSelect: document.querySelector("#dateSelect"),
  floorSelect: document.querySelector("#floorSelect"),
  areaSelect: document.querySelector("#areaSelect"),
  typeSelect: document.querySelector("#typeSelect"),
  seatMapTitle: document.querySelector("#seatMapTitle"),
  segmentValue: document.querySelector("#segmentValue"),
  detailArea: document.querySelector("#detailArea"),
  detailDate: document.querySelector("#detailDate"),
  detailTime: document.querySelector("#detailTime"),
  selectedSeatTitle: document.querySelector("#selectedSeatTitle"),
  payloadPreview: document.querySelector("#payloadPreview"),
  modeButtons: document.querySelectorAll(".mode-switch button"),
  scheduleBox: document.querySelector("#scheduleBox"),
  runAtInput: document.querySelector("#runAtInput"),
  attemptInput: document.querySelector("#attemptInput"),
  intervalInput: document.querySelector("#intervalInput"),
  submitButton: document.querySelector("#submitButton"),
  copyButton: document.querySelector("#copyButton"),
  clearLogButton: document.querySelector("#clearLogButton"),
  logList: document.querySelector("#logList"),
  steps: document.querySelectorAll(".step"),
  clockOffset: document.querySelector("#clockOffset")
};

function localTime() {
  return new Date().toLocaleTimeString("zh-CN", { hour12: false });
}

function addLog(message) {
  const row = document.createElement("div");
  row.className = "log-entry";
  row.innerHTML = `<time>${localTime()}</time><strong>${message}</strong>`;
  refs.logList.prepend(row);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      "Content-Type": "application/json"
    },
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    throw new Error(data.message || `请求失败：${response.status}`);
  }
  return data;
}

function setBusy(button, busy, label) {
  button.disabled = busy;
  if (label) button.textContent = label;
}

function setSelectOptions(select, rows, getValue, getLabel, emptyLabel) {
  select.innerHTML = "";
  if (emptyLabel) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = emptyLabel;
    select.appendChild(option);
  }
  rows.forEach((row) => {
    const option = document.createElement("option");
    option.value = getValue(row);
    option.textContent = getLabel(row);
    select.appendChild(option);
  });
}

function formatDateTimeLocal(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T05:00`;
}

function formatSavedTime(value) {
  if (!value) return "未知";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return "";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}小时${minutes}分钟`;
  return `${Math.max(minutes, 0)}分钟`;
}

function updateDefaultRunAt() {
  if (refs.runAtInput.value) return;
  const date = new Date();
  date.setDate(date.getDate() + 1);
  refs.runAtInput.value = formatDateTimeLocal(date);
}

function resetReservationControls() {
  state.selectedSeat = null;
  state.selectedArea = null;
  state.time = null;
  state.seats = [];
  state.areas = [];
  state.storeys = [];
  setSelectOptions(refs.dateSelect, [], () => "", () => "", "登录后加载");
  setSelectOptions(refs.floorSelect, [], () => "", () => "", "登录后加载");
  setSelectOptions(refs.areaSelect, [], () => "", () => "", "登录后加载");
  refs.seatSearch.value = "";
  updateSeatHeader();
  renderSeats();
}

function updateControlAvailability() {
  [refs.dateSelect, refs.floorSelect, refs.areaSelect, refs.typeSelect, refs.seatSearch, refs.refreshButton].forEach(
    (control) => {
      control.disabled = !state.tokenReady;
    }
  );
}

function updateToken(status) {
  state.tokenReady = Boolean(status.tokenReady);
  refs.tokenPill.classList.toggle("is-ready", state.tokenReady);

  if (state.tokenReady) {
    const refreshMinutes = Math.round((status.autoRefreshBeforeSeconds || 0) / 60);
    const sourceText = status.autoLoginSource === "project-file"
      ? "项目凭据文件"
      : "未知来源";
    const autoLoginText = status.autoLoginConfigured
      ? `无人值守登录已配置：${sourceText}`
      : "未配置账号密码，CAS 会话失效时仍需手动登录";
    refs.tokenPill.innerHTML = `<span class="dot"></span><span>token 可用</span>`;
    refs.tokenTitle.textContent = "已读取本地 token";
    refs.tokenMeta.textContent = `保存时间：${formatSavedTime(status.savedAt)}；有效期至：${formatSavedTime(status.expiresAt)}，剩余约 ${formatDuration(status.secondsLeft)}；服务会提前约 ${refreshMinutes} 分钟自动刷新；${autoLoginText}。`;
  } else if (status.hasSavedToken && status.expired) {
    refs.tokenPill.innerHTML = `<span class="dot"></span><span>token 已过期</span>`;
    refs.tokenTitle.textContent = "本地 token 已保存但已过期";
    refs.tokenMeta.textContent = `保存时间：${formatSavedTime(status.savedAt)}；到期时间：${formatSavedTime(status.expiresAt)}。学校 token 过期后必须重新登录获取新的 token。`;
  } else if (status.hasSavedToken) {
    refs.tokenPill.innerHTML = `<span class="dot"></span><span>token 不可用</span>`;
    refs.tokenTitle.textContent = "本地 token 暂不可用";
    refs.tokenMeta.textContent = `保存时间：${formatSavedTime(status.savedAt)}。请重新打开 CAS 登录刷新 token。`;
  } else {
    refs.tokenPill.innerHTML = `<span class="dot"></span><span>未保存 token</span>`;
    refs.tokenTitle.textContent = "等待 CAS 登录";
    refs.tokenMeta.textContent = "点击打开 CAS 登录，完成认证后会自动保存 token；下次启动会自动读取。";
  }

  refs.tokenButton.textContent = state.tokenReady ? "重新登录" : "打开 CAS 登录";
  updateControlAvailability();
  if (!state.tokenReady) resetReservationControls();
  updateSubmitState();
}

function seatMatches(seat) {
  const keyword = refs.seatSearch.value.trim().toLowerCase();
  if (!keyword) return true;
  return seat.no.toLowerCase().includes(keyword) || seat.id.includes(keyword);
}

function timeText() {
  if (!state.time) return "--";
  return `${state.time.start || "--"}-${state.time.end || "--"}`;
}

function previewPayload() {
  if (!state.selectedSeat || !state.time) {
    return {
      area_id: state.selectedArea?.id || "",
      seat_id: "",
      day: refs.dateSelect.value || "",
      segment: state.time?.segment || ""
    };
  }

  const payload = {
    area_id: state.selectedArea?.id || "",
    seat_id: state.selectedSeat.id,
    day: state.time.day
  };

  if (state.time.reserveType === "1") {
    payload.segment = state.time.segment || "";
  } else if (state.time.reserveType === "2") {
    payload.segment = "";
    payload.end_time = state.time.end;
  } else {
    payload.segment = "";
    payload.start_time = state.time.start;
    payload.end_time = state.time.end;
  }

  return payload;
}

function updateSubmitState() {
  const canSubmit = state.tokenReady && state.selectedSeat && state.selectedArea && state.time;
  refs.submitButton.disabled = !canSubmit;
  refs.submitButton.textContent = state.mode === "schedule" ? "创建定时任务" : "提交预约";
  refs.payloadPreview.textContent = JSON.stringify(previewPayload(), null, 2);
  refs.selectedSeatTitle.textContent = state.selectedSeat
    ? `${state.selectedSeat.no} / id=${state.selectedSeat.id}`
    : "尚未选择座位";
  refs.detailArea.textContent = state.selectedArea?.name || "--";
  refs.detailDate.textContent = refs.dateSelect.value || "--";
  refs.detailTime.textContent = state.time ? timeText() : "--";
}

function renderSeats() {
  refs.seatMap.innerHTML = "";
  const seats = state.seats.filter(seatMatches);
  refs.freeCount.textContent = String(state.seats.filter((seat) => seat.available).length);

  if (!seats.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = state.selectedArea ? "没有匹配的座位" : "请先登录并选择区域";
    refs.seatMap.appendChild(empty);
    updateSubmitState();
    return;
  }

  seats.forEach((seat) => {
    const button = document.createElement("button");
    button.className = `seat ${seat.status}`;
    button.textContent = seat.no;
    button.type = "button";
    button.dataset.seatId = seat.id;
    button.title = `${seat.no} / ${seat.statusName}`;
    button.setAttribute("aria-label", `${seat.no} 座位，编号 ${seat.id}`);
    button.disabled = !seat.available;
    if (state.selectedSeat?.id === seat.id) {
      button.classList.add("is-selected");
    }
    button.addEventListener("click", () => {
      state.selectedSeat = seat;
      addLog(`已选择座位 ${seat.no}，seat_id=${seat.id}`);
      renderSeats();
      updateSubmitState();
    });
    refs.seatMap.appendChild(button);
  });

  updateSubmitState();
}

function updateSeatHeader() {
  refs.seatMapTitle.textContent = state.selectedArea
    ? `${state.selectedArea.name} · ${timeText()}`
    : "请选择区域";
  refs.segmentValue.textContent = state.time?.segment || "无";
}

async function loadStatus() {
  const status = await api("/api/status");
  updateToken(status);
  return status;
}

async function loadClock() {
  try {
    const clock = await api("/api/clock");
    refs.clockOffset.textContent = `${Math.round(clock.offsetMs / 1000)}s`;
  } catch (error) {
    refs.clockOffset.textContent = "--";
  }
}

async function loadOptions() {
  if (!state.tokenReady) return;
  addLog("正在加载日期与楼层");
  const data = await api("/api/options");
  state.storeys = data.storeys || [];
  const dates = data.dates || [];
  setSelectOptions(refs.dateSelect, dates, (date) => date, (date) => date);
  if (dates.length) refs.dateSelect.value = dates[dates.length - 1];
  setSelectOptions(refs.floorSelect, state.storeys, (row) => row.id, (row) => row.name, "全部楼层");
  await loadAreas();
}

async function loadAreas() {
  if (!state.tokenReady || !refs.dateSelect.value) return;
  state.selectedArea = null;
  state.selectedSeat = null;
  state.time = null;
  state.seats = [];
  renderSeats();
  updateSeatHeader();

  const data = await api("/api/areas", {
    method: "POST",
    body: JSON.stringify({
      date: refs.dateSelect.value,
      storeyId: refs.floorSelect.value
    })
  });
  state.areas = data.areas || [];
  setSelectOptions(
    refs.areaSelect,
    state.areas,
    (area) => area.id,
    (area) => `${area.name}（空闲 ${area.freeNum}/${area.totalNum}）`
  );
  state.selectedArea = state.areas[0] || null;
  if (state.selectedArea) refs.areaSelect.value = state.selectedArea.id;
  addLog(`区域已加载：${state.areas.length} 个`);
  await loadSeats();
}

async function loadSeats() {
  if (!state.tokenReady || !state.selectedArea || !refs.dateSelect.value) return;
  addLog(`正在加载 ${state.selectedArea.name} 座位`);
  const data = await api("/api/seats", {
    method: "POST",
    body: JSON.stringify({
      areaId: state.selectedArea.id,
      day: refs.dateSelect.value
    })
  });
  state.time = data.time;
  state.seats = data.seats || [];
  state.selectedSeat = null;
  refs.freeCount.textContent = String(data.freeNum || 0);
  updateSeatHeader();
  renderSeats();
  addLog(`座位已加载：空闲 ${data.freeNum}/${data.totalNum}`);
}

async function startLogin() {
  setBusy(refs.tokenButton, true, "等待登录完成");
  setBusy(refs.loginButton, true);
  addLog("正在打开 CAS 登录窗口");
  try {
    const status = await api("/api/login/start", { method: "POST" });
    updateToken(status);
    addLog("token 导入成功");
    await loadOptions();
  } catch (error) {
    addLog(error.message);
  } finally {
    setBusy(refs.tokenButton, false);
    setBusy(refs.loginButton, false);
    refs.tokenButton.textContent = state.tokenReady ? "重新登录" : "打开 CAS 登录";
  }
}

async function clearToken() {
  const status = await api("/api/token/clear", { method: "POST" });
  state.selectedSeat = null;
  state.selectedArea = null;
  state.time = null;
  state.seats = [];
  state.areas = [];
  updateToken(status);
  renderSeats();
  updateSeatHeader();
  addLog("本地 token 已清除");
}

async function submitBooking() {
  if (!state.selectedSeat || !state.selectedArea || !state.time) return;

  const body = {
    areaId: state.selectedArea.id,
    day: state.time.day,
    seatId: state.selectedSeat.id
  };

  setBusy(refs.submitButton, true, state.mode === "schedule" ? "创建中" : "提交中");
  try {
    if (state.mode === "schedule") {
      const data = await api("/api/schedule", {
        method: "POST",
        body: JSON.stringify({
          ...body,
          runAt: refs.runAtInput.value,
          attempts: refs.attemptInput.value,
          intervalSeconds: refs.intervalInput.value
        })
      });
      addLog(`定时任务已创建：${data.task.id}`);
    } else {
      const ok = window.confirm(`确认提交预约 ${state.selectedSeat.no}？`);
      if (!ok) return;
      const data = await api("/api/book", {
        method: "POST",
        body: JSON.stringify(body)
      });
      addLog(`预约返回：${data.message}`);
      await loadSeats();
    }
  } catch (error) {
    addLog(error.message);
  } finally {
    setBusy(refs.submitButton, false);
    updateSubmitState();
  }
}

function bindEvents() {
  refs.tokenButton.addEventListener("click", startLogin);
  refs.loginButton.addEventListener("click", startLogin);
  refs.clearTokenButton.addEventListener("click", () => {
    clearToken().catch((error) => addLog(error.message));
  });

  refs.refreshButton.addEventListener("click", () => {
    loadSeats().catch((error) => addLog(error.message));
  });

  refs.dateSelect.addEventListener("change", () => {
    loadAreas().catch((error) => addLog(error.message));
  });

  refs.floorSelect.addEventListener("change", () => {
    loadAreas().catch((error) => addLog(error.message));
  });

  refs.areaSelect.addEventListener("change", () => {
    state.selectedArea = state.areas.find((area) => String(area.id) === refs.areaSelect.value) || null;
    loadSeats().catch((error) => addLog(error.message));
  });

  refs.seatSearch.addEventListener("input", renderSeats);

  refs.modeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      refs.modeButtons.forEach((item) => item.classList.remove("is-selected"));
      button.classList.add("is-selected");
      state.mode = button.dataset.mode;
      refs.scheduleBox.hidden = state.mode !== "schedule";
      addLog(state.mode === "schedule" ? "已切换为定时预约" : "已切换为立即预约");
      updateSubmitState();
    });
  });

  refs.submitButton.addEventListener("click", submitBooking);

  refs.copyButton.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(refs.payloadPreview.textContent);
      addLog("提交参数已复制");
    } catch {
      addLog("复制失败，请手动选择参数");
    }
  });

  refs.clearLogButton.addEventListener("click", () => {
    refs.logList.innerHTML = "";
  });

  refs.steps.forEach((step) => {
    step.addEventListener("click", () => {
      refs.steps.forEach((item) => item.classList.remove("is-active"));
      step.classList.add("is-active");
      document.getElementById(step.dataset.panel)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}

async function init() {
  bindEvents();
  updateDefaultRunAt();
  updateSeatHeader();
  renderSeats();
  addLog("网页控制台已就绪");
  await loadClock();
  const status = await loadStatus();
  if (status.tokenReady) {
    await loadOptions();
  }
  setInterval(() => {
    loadStatus().catch((error) => addLog(error.message));
  }, 60 * 1000);
}

init().catch((error) => addLog(error.message));
