const fs = require("fs");
const http = require("http");
const path = require("path");
const { URL } = require("url");

const lib = require("./cli");

const HOST = "127.0.0.1";
const DEFAULT_PORT = Number(process.env.PORT || 5500);
const FRONTEND_DIR = path.join(__dirname, "frontend");
const CREDENTIALS_FILE = path.join(__dirname, ".qlu-credentials.json");
const AUTO_REFRESH_BEFORE_SECONDS = Number(process.env.QLU_AUTO_REFRESH_BEFORE_SECONDS || 15 * 60);
const tasks = new Map();

let loginPromise = null;
let refreshTimer = null;

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(data));
}

function sendError(res, error) {
  sendJson(res, error.status || 500, {
    ok: false,
    message: error.message || "服务器错误"
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1024 * 1024) {
        req.destroy();
        reject(httpError(413, "请求体过大"));
      }
    });
    req.on("end", () => {
      if (!raw.trim()) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(httpError(400, "JSON 格式错误"));
      }
    });
    req.on("error", reject);
  });
}

function readSavedToken() {
  try {
    if (!fs.existsSync(lib.TOKEN_FILE)) return null;
    const data = JSON.parse(fs.readFileSync(lib.TOKEN_FILE, "utf8"));
    if (!data.token) return null;
    return data;
  } catch {
    return null;
  }
}

function loadTokenIfNeeded(saved) {
  if (!lib.session.token && saved?.token) {
    lib.session.token = String(saved.token).trim();
  }
}

function credentialStatus() {
  try {
    if (!fs.existsSync(CREDENTIALS_FILE)) {
      return {
        configured: false,
        source: null
      };
    }
    const data = JSON.parse(fs.readFileSync(CREDENTIALS_FILE, "utf8"));
    const username = String(data.username || data.account || data.student_id || "").trim();
    const password = String(data.password || "");
    return {
      configured: Boolean(username && password),
      source: "project-file"
    };
  } catch {
    return {
      configured: false,
      source: "project-file-error"
    };
  }
}

function tokenStatus() {
  const saved = readSavedToken();
  loadTokenIfNeeded(saved);
  const expiry = lib.tokenExpiry(lib.session.token);
  const expired = Boolean(expiry?.expired);
  const credentials = credentialStatus();
  return {
    tokenReady: Boolean(lib.session.token) && !expired,
    hasSavedToken: Boolean(saved?.token),
    autoLoginConfigured: credentials.configured,
    autoLoginSource: credentials.source,
    savedAt: saved?.savedAt || null,
    expired,
    expiresAt: expiry?.expMs ? new Date(expiry.expMs).toISOString() : null,
    secondsLeft: expiry?.expMs ? Math.max(0, Math.floor((expiry.expMs - Date.now()) / 1000)) : null,
    tokenFile: lib.TOKEN_FILE
  };
}

function scheduleTokenRefresh(status = tokenStatus()) {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = null;

  if (process.env.QLU_AUTO_REFRESH === "0") return;
  if (!status.tokenReady || !Number.isFinite(status.secondsLeft)) return;

  const delayMs = Math.max(1000, (status.secondsLeft - AUTO_REFRESH_BEFORE_SECONDS) * 1000);
  refreshTimer = setTimeout(async () => {
    try {
      const current = tokenStatus();
      if (current.tokenReady && current.secondsLeft <= AUTO_REFRESH_BEFORE_SECONDS) {
        console.log("token 即将过期，正在自动刷新...");
        await acquireAndSaveToken();
      } else {
        scheduleTokenRefresh(current);
      }
    } catch (error) {
      console.error(`token 自动刷新失败：${error.message}`);
      scheduleTokenRefresh(tokenStatus());
    }
  }, delayMs);
}

async function acquireAndSaveToken() {
  if (loginPromise) return loginPromise;
  loginPromise = (async () => {
    const token = await lib.acquireTokenWithBrowser();
    await lib.importToken(token);
    const status = tokenStatus();
    scheduleTokenRefresh(status);
    return status;
  })();
  try {
    return await loginPromise;
  } finally {
    loginPromise = null;
  }
}

function requireToken() {
  const status = tokenStatus();
  if (!status.tokenReady) {
    throw httpError(401, status.expired ? "本地 token 已过期，请重新登录" : "请先登录并导入 token");
  }
  return status;
}

function normalizeStorey(item) {
  return {
    id: item.id,
    name: item.name || String(item.id)
  };
}

function normalizeArea(item) {
  return {
    id: item.id,
    name: item.nameMerge || item.name || String(item.id),
    freeNum: Number(item.free_num || 0),
    totalNum: Number(item.total_num || 0)
  };
}

function normalizeSeat(seat) {
  const available = String(seat.status) === "1" || String(seat.is_subscribe) === "1";
  const name = String(seat.name || seat.no || seat.seat_no || seat.id);
  const statusName = String(seat.status_name || (available ? "空闲" : "不可预约"));
  const locked = /不可|暂停|锁|维修/.test(statusName);
  return {
    id: String(seat.id),
    no: name,
    status: available ? "free" : locked ? "locked" : "occupied",
    statusName,
    available
  };
}

function publicTask(task) {
  return {
    id: task.id,
    status: task.status,
    runAt: task.runAt,
    createdAt: task.createdAt,
    logs: task.logs.slice(-20)
  };
}

function addTaskLog(task, message) {
  task.logs.push({
    time: new Date().toISOString(),
    message
  });
}

async function prepareBooking({ areaId, day, seatId }) {
  if (!areaId) throw httpError(400, "缺少区域 ID");
  if (!day) throw httpError(400, "缺少预约日期");
  if (!seatId) throw httpError(400, "缺少座位 ID");

  const spaceInfo = await lib.loadSpaceInfo(areaId);
  const time = lib.bookingTimeForDate(spaceInfo, day);
  const seatsData = await lib.loadSeats(areaId, time);
  const seat = (seatsData.list || []).find((item) => String(item.id) === String(seatId));
  if (!seat) throw httpError(404, "没有找到这个座位");

  const normalizedSeat = normalizeSeat(seat);
  if (!normalizedSeat.available) throw httpError(409, `座位当前不可预约：${normalizedSeat.statusName}`);

  return {
    payload: lib.buildPayload(seat, time),
    seat: normalizedSeat,
    time
  };
}

function scheduleBooking(payload, task, attempts, intervalMs) {
  task.status = "running";
  addTaskLog(task, "开始提交预约");

  (async () => {
    for (let index = 1; index <= attempts; index += 1) {
      const result = await lib.book(payload).catch((error) => ({
        code: -1,
        message: error.message
      }));
      addTaskLog(task, `第 ${index} 次：${result.message || result.msg || result.code}`);
      if (result.code === 0) {
        task.status = "success";
        return;
      }
      if (index < attempts) {
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }
    }
    task.status = "failed";
  })().catch((error) => {
    task.status = "failed";
    addTaskLog(task, error.message);
  });
}

async function handleApi(req, res, pathname) {
  if (req.method === "GET" && pathname === "/api/status") {
    const status = tokenStatus();
    scheduleTokenRefresh(status);
    return sendJson(res, 200, { ok: true, autoRefreshBeforeSeconds: AUTO_REFRESH_BEFORE_SECONDS, ...status });
  }

  if (req.method === "GET" && pathname === "/api/clock") {
    const clock = await lib.getRemoteClock();
    return sendJson(res, 200, { ok: true, ...clock });
  }

  if (req.method === "POST" && pathname === "/api/login/start") {
    if (loginPromise) throw httpError(409, "登录窗口已经打开，请先完成当前登录");
    const status = await acquireAndSaveToken();
    return sendJson(res, 200, { ok: true, autoRefreshBeforeSeconds: AUTO_REFRESH_BEFORE_SECONDS, ...status });
  }

  if (req.method === "POST" && pathname === "/api/token/refresh") {
    const status = await acquireAndSaveToken();
    return sendJson(res, 200, { ok: true, autoRefreshBeforeSeconds: AUTO_REFRESH_BEFORE_SECONDS, ...status });
  }

  if (req.method === "POST" && pathname === "/api/import-token") {
    const body = await readBody(req);
    if (!body.token) throw httpError(400, "缺少 token");
    await lib.importToken(String(body.token));
    const status = tokenStatus();
    scheduleTokenRefresh(status);
    return sendJson(res, 200, { ok: true, autoRefreshBeforeSeconds: AUTO_REFRESH_BEFORE_SECONDS, ...status });
  }

  if (req.method === "POST" && pathname === "/api/token/clear") {
    lib.clearSavedToken();
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = null;
    return sendJson(res, 200, { ok: true, autoRefreshBeforeSeconds: AUTO_REFRESH_BEFORE_SECONDS, ...tokenStatus() });
  }

  if (req.method === "GET" && pathname === "/api/options") {
    requireToken();
    const data = await lib.loadOptions();
    const storeys = lib.flattenStoreys(data.storey || []).map(normalizeStorey);
    return sendJson(res, 200, {
      ok: true,
      dates: data.date || [],
      storeys
    });
  }

  if (req.method === "POST" && pathname === "/api/areas") {
    requireToken();
    const body = await readBody(req);
    const date = body.date;
    const storeyIds = body.storeyId ? [body.storeyId] : [];
    const data = await lib.loadAreas(date, [1], storeyIds, [1]);
    return sendJson(res, 200, {
      ok: true,
      areas: (data.area || []).map(normalizeArea)
    });
  }

  if (req.method === "POST" && pathname === "/api/seats") {
    requireToken();
    const body = await readBody(req);
    const spaceInfo = await lib.loadSpaceInfo(body.areaId);
    const time = lib.bookingTimeForDate(spaceInfo, body.day);
    const data = await lib.loadSeats(body.areaId, time);
    const seats = (data.list || []).map(normalizeSeat);
    return sendJson(res, 200, {
      ok: true,
      time,
      seats,
      totalNum: Number(data.total_num || seats.length),
      freeNum: Number(data.free_num || seats.filter((seat) => seat.available).length)
    });
  }

  if (req.method === "POST" && pathname === "/api/book") {
    requireToken();
    const body = await readBody(req);
    const prepared = await prepareBooking(body);
    const result = await lib.book(prepared.payload);
    return sendJson(res, 200, {
      ok: true,
      result,
      message: result.message || result.msg || String(result.code),
      ...prepared
    });
  }

  if (req.method === "POST" && pathname === "/api/schedule") {
    requireToken();
    const body = await readBody(req);
    const prepared = await prepareBooking(body);
    const runAt = new Date(body.runAt);
    if (Number.isNaN(runAt.getTime())) throw httpError(400, "定时时间格式错误");
    const attempts = Math.min(Math.max(Number(body.attempts) || 5, 1), 10);
    const intervalMs = Math.max(Number(body.intervalSeconds) || 3, 2) * 1000;
    const clock = await lib.getRemoteClock().catch(() => null);
    const now = clock ? clock.remoteMs : Date.now();
    const delay = Math.max(0, runAt.getTime() - now);
    const task = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      status: "waiting",
      runAt: runAt.toISOString(),
      createdAt: new Date().toISOString(),
      logs: []
    };
    addTaskLog(task, `任务已创建，${Math.round(delay / 1000)} 秒后执行`);
    task.timer = setTimeout(() => scheduleBooking(prepared.payload, task, attempts, intervalMs), delay);
    tasks.set(task.id, task);
    return sendJson(res, 200, {
      ok: true,
      task: publicTask(task),
      ...prepared
    });
  }

  if (req.method === "GET" && pathname === "/api/tasks") {
    return sendJson(res, 200, {
      ok: true,
      tasks: Array.from(tasks.values()).map(publicTask)
    });
  }

  throw httpError(404, "接口不存在");
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".svg": "image/svg+xml"
  }[ext] || "application/octet-stream";
}

function serveStatic(req, res, pathname) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.resolve(FRONTEND_DIR, `.${decodeURIComponent(requested)}`);
  if (!filePath.startsWith(FRONTEND_DIR)) throw httpError(403, "路径不可访问");
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) throw httpError(404, "文件不存在");
  res.writeHead(200, {
    "Content-Type": contentType(filePath),
    "Cache-Control": "no-store"
  });
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || `${HOST}:${DEFAULT_PORT}`}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url.pathname);
    } else {
      serveStatic(req, res, url.pathname);
    }
  } catch (error) {
    sendError(res, error);
  }
});

function listen(port) {
  server.once("error", (error) => {
    if (error.code === "EADDRINUSE" && port < DEFAULT_PORT + 20) {
      listen(port + 1);
      return;
    }
    throw error;
  });
  server.listen(port, HOST, () => {
    console.log(`QLU-LIB 网页控制台已启动：http://${HOST}:${port}`);
    scheduleTokenRefresh(tokenStatus());
  });
}

listen(DEFAULT_PORT);
