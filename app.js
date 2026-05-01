// oloimina — calm task management
// State lives on-device. No network, no analytics, no third parties.

const STORE_KEY = "oloimina.v2";
const MIGRATE_FROM = "oloimina.v1";

const CAL_START = 6;
const CAL_END = 22;
const HOUR_PX = 56;

// ---------- date helpers ----------

const pad = (n) => String(n).padStart(2, "0");

const dayKey = (offset = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const dayLabel = (offset = 0, opts = { weekday: "long" }) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toLocaleDateString(undefined, opts);
};

const phaseFor = (h) => {
  if (h < 5) return "night";
  if (h < 11) return "morning";
  if (h < 14) return "midday";
  if (h < 18) return "afternoon";
  if (h < 22) return "evening";
  return "night";
};

// ---------- time/duration parsing ----------

const parseTime = (raw) => {
  if (!raw) return null;
  let s = raw.trim().toLowerCase();
  const pm = /p/.test(s);
  const am = /a/.test(s);
  s = s.replace(/[^\d:]/g, "");
  if (!s) return null;
  let h, m;
  if (s.includes(":")) {
    const parts = s.split(":");
    h = Number(parts[0]);
    m = Number(parts[1] || 0);
  } else if (s.length <= 2) {
    h = Number(s);
    m = 0;
  } else {
    h = Number(s.slice(0, -2));
    m = Number(s.slice(-2));
  }
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  if (pm && h < 12) h += 12;
  if (am && h === 12) h = 0;
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return `${pad(h)}:${pad(m)}`;
};

const fmtTime = (hhmm) => {
  if (!hhmm) return "";
  const [h, m] = hhmm.split(":").map(Number);
  const suffix = h >= 12 ? "pm" : "am";
  const h12 = h % 12 || 12;
  return `${h12}:${pad(m)} ${suffix}`;
};

const parseMins = (raw) => {
  if (!raw) return 0;
  const s = String(raw).trim().toLowerCase();
  if (!s) return 0;
  const hM = s.match(/(\d+)\s*h/);
  const mM = s.match(/(\d+)\s*m(?!\w)/);
  if (hM || mM) {
    return (hM ? Number(hM[1]) * 60 : 0) + (mM ? Number(mM[1]) : 0);
  }
  if (s.includes(":")) {
    const [h, m] = s.split(":").map(Number);
    return (h || 0) * 60 + (m || 0);
  }
  const n = parseInt(s.replace(/\D/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
};

const fmtMins = (mins) => {
  if (!mins) return "";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}:${pad(m)}`;
};

// ---------- state ----------

const defaultState = () => ({
  tasks: [], // { id, title, mins, day: "YYYY-MM-DD"|null, time: "HH:MM"|null, tag, done }
  view: "today",
});

const migrate = () => {
  try {
    const raw = localStorage.getItem(MIGRATE_FROM);
    if (!raw) return null;
    const old = JSON.parse(raw);
    const tasks = (old.tasks || []).map((t) => ({
      id: t.id || crypto.randomUUID(),
      title: t.title || "",
      mins: Number(t.mins) || 0,
      day: t.zone === "today" ? t.planned || dayKey() : null,
      time: null,
      tag: "",
      done: !!t.done,
    }));
    return { ...defaultState(), tasks };
  } catch {
    return null;
  }
};

const load = () => {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return { ...defaultState(), ...JSON.parse(raw) };
    const m = migrate();
    if (m) {
      localStorage.setItem(STORE_KEY, JSON.stringify(m));
      return m;
    }
    return defaultState();
  } catch {
    return defaultState();
  }
};

const save = () => localStorage.setItem(STORE_KEY, JSON.stringify(state));

let state = load();

// Quiet rollover: undone tasks scheduled before today move to today.
// Done tasks stay where they were — they're history, not active work.
{
  const today = dayKey();
  let changed = false;
  for (const t of state.tasks) {
    if (t.day && t.day < today && !t.done) {
      t.day = today;
      t.time = null;
      changed = true;
    }
  }
  if (changed) save();
}

// ---------- DOM refs ----------

const $ = (id) => document.getElementById(id);

const dateEl = $("date");
const phaseEl = $("phase");
const calGrid = $("cal-grid");
const calDay = $("cal-day");
const dayTpl = $("day-tpl");
const taskTpl = $("task-tpl");
const blockTpl = $("cal-block-tpl");

const viewToday = $("view-today");
const viewBacklog = $("view-backlog");
const backlogList = $("backlog-list");
const backlogEmpty = $("backlog-empty");
const backlogAdd = $("backlog-add");
const backlogAddInput = $("backlog-add-input");
const backlogAddMins = $("backlog-add-mins");

// ---------- selection / UI state ----------

let view = state.view || "today";

const setView = (next) => {
  view = next;
  state.view = next;
  save();
  document.querySelectorAll('[data-view]').forEach((el) => {
    el.toggleAttribute("aria-current", el.dataset.view === next);
    if (el.dataset.view === next) el.setAttribute("aria-current", "page");
    else el.removeAttribute("aria-current");
  });
  viewToday.hidden = next !== "today";
  viewBacklog.hidden = next !== "backlog";
  if (next === "backlog") backlogAddInput?.focus();
};

// ---------- render: header ----------

const renderHeader = () => {
  dateEl.textContent = dayLabel(0, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  phaseEl.textContent = phaseFor(new Date().getHours());
  calDay.textContent = dayLabel(0, { weekday: "short", month: "short", day: "numeric" });
};

// ---------- render: task card ----------

const buildTaskNode = (t) => {
  const node = taskTpl.content.firstElementChild.cloneNode(true);
  node.dataset.id = t.id;
  if (t.done) node.classList.add("done");
  node.querySelector(".task-title").textContent = t.title;
  node.querySelector(".task-time").textContent = fmtTime(t.time);
  node.querySelector(".task-mins").textContent = fmtMins(t.mins);
  node.querySelector(".task-tag").textContent = t.tag || "";
  return node;
};

// ---------- render: day columns ----------

const dayContainer = (offset) =>
  document.querySelector(`.day[data-offset="${offset}"]`);

const renderDay = (offset) => {
  const container = dayContainer(offset);
  const key = dayKey(offset);
  const isToday = offset === 0;

  // build skeleton if empty
  if (!container.querySelector(".day-head")) {
    container.appendChild(dayTpl.content.cloneNode(true));
    const list = container.querySelector(".day-list");
    list.dataset.zone = "day";
    list.dataset.day = key;
  }

  const list = container.querySelector(".day-list");
  list.dataset.day = key; // keep up to date as date changes
  container.querySelector(".day-name").textContent = isToday
    ? "today"
    : dayLabel(offset, { weekday: "long" }).toLowerCase();
  container.querySelector(".day-date").textContent = dayLabel(offset, {
    month: "long",
    day: "numeric",
  });

  // sort: timed first by time, then untimed in original order
  const items = state.tasks
    .filter((t) => t.day === key)
    .sort((a, b) => {
      if (a.time && b.time) return a.time.localeCompare(b.time);
      if (a.time) return -1;
      if (b.time) return 1;
      return 0;
    });

  const total = items.filter((t) => !t.done).reduce((s, t) => s + (t.mins || 0), 0);
  const totalEl = container.querySelector(".day-total");
  totalEl.textContent = total ? fmtMins(total) : "";

  list.innerHTML = "";
  for (const t of items) list.appendChild(buildTaskNode(t));
};

const wireDayAdd = (offset) => {
  const container = dayContainer(offset);
  const form = container.querySelector(".day-add");
  if (form.dataset.wired) return;
  form.dataset.wired = "1";
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const titleEl = form.querySelector(".day-add-input");
    const minsEl = form.querySelector(".day-add-mins");
    if (!titleEl.value.trim()) return;
    addTask({
      title: titleEl.value,
      mins: parseMins(minsEl.value),
      day: dayKey(offset),
    });
    titleEl.value = "";
    minsEl.value = "";
    titleEl.focus();
  });
};

const renderDays = () => {
  for (let i = 0; i < 3; i++) {
    renderDay(i);
    wireDayAdd(i);
  }
};

// ---------- render: backlog ----------

const renderBacklog = () => {
  const items = state.tasks.filter((t) => t.day === null);
  backlogList.innerHTML = "";
  for (const t of items) backlogList.appendChild(buildTaskNode(t));
  backlogEmpty.hidden = items.length !== 0;
};

// ---------- render: calendar timeline ----------

const buildCalendarSkeleton = () => {
  calGrid.innerHTML = "";
  for (let h = CAL_START; h < CAL_END; h++) {
    const row = document.createElement("div");
    row.className = "cal-hour";
    row.style.top = `${(h - CAL_START) * HOUR_PX}px`;
    const label = document.createElement("span");
    label.className = "cal-hour-label";
    const ampm = h >= 12 ? "pm" : "am";
    const h12 = h % 12 || 12;
    label.textContent = `${h12} ${ampm}`;
    row.appendChild(label);
    calGrid.appendChild(row);
  }
};

const renderCalendar = () => {
  // remove blocks + now line; keep hour rows
  calGrid.querySelectorAll(".cal-block, .cal-now").forEach((n) => n.remove());

  const today = dayKey();
  const items = state.tasks
    .filter((t) => t.day === today && t.time && t.mins)
    .sort((a, b) => a.time.localeCompare(b.time));

  for (const t of items) {
    const [h, m] = t.time.split(":").map(Number);
    if (h < CAL_START || h >= CAL_END) continue;
    const top = (h - CAL_START) * HOUR_PX + (m / 60) * HOUR_PX;
    const height = Math.max(22, (t.mins / 60) * HOUR_PX);

    const node = blockTpl.content.firstElementChild.cloneNode(true);
    node.dataset.id = t.id;
    node.style.top = `${top}px`;
    node.style.height = `${height}px`;
    if (t.done) node.classList.add("done");
    node.querySelector(".cal-block-time").textContent = fmtTime(t.time);
    node.querySelector(".cal-block-title").textContent = t.title;
    calGrid.appendChild(node);
  }

  // now line
  const now = new Date();
  const h = now.getHours() + now.getMinutes() / 60;
  if (h >= CAL_START && h < CAL_END) {
    const line = document.createElement("div");
    line.className = "cal-now";
    line.style.top = `${(h - CAL_START) * HOUR_PX}px`;
    calGrid.appendChild(line);
  }
};

// ---------- master render ----------

const render = () => {
  renderHeader();
  renderDays();
  renderBacklog();
  renderCalendar();
};

// ---------- mutations ----------

const addTask = ({ title, mins = 0, day = null, time = null, tag = "" }) => {
  const t = {
    id: crypto.randomUUID(),
    title: String(title).trim(),
    mins: Number(mins) || 0,
    day,
    time,
    tag,
    done: false,
  };
  if (!t.title) return;
  state.tasks.push(t);
  save();
  render();
};

const updateTask = (id, patch) => {
  const t = state.tasks.find((x) => x.id === id);
  if (!t) return;
  Object.assign(t, patch);
  save();
  render();
};

const removeTask = (id) => {
  state.tasks = state.tasks.filter((x) => x.id !== id);
  save();
  render();
};

const moveTask = (id, { day, beforeId } = {}) => {
  const t = state.tasks.find((x) => x.id === id);
  if (!t) return;
  if (day !== undefined) {
    t.day = day;
    if (day === null) t.time = null; // backlog has no time-of-day
  }
  state.tasks = state.tasks.filter((x) => x.id !== id);
  if (beforeId) {
    const idx = state.tasks.findIndex((x) => x.id === beforeId);
    if (idx >= 0) state.tasks.splice(idx, 0, t);
    else state.tasks.push(t);
  } else {
    state.tasks.push(t);
  }
  save();
  render();
};

// ---------- events ----------

document.addEventListener("click", (e) => {
  const navBtn = e.target.closest("[data-view]");
  if (navBtn) {
    setView(navBtn.dataset.view);
    return;
  }
  if (e.target.classList.contains("check")) {
    const card = e.target.closest(".task");
    if (card) {
      const t = state.tasks.find((x) => x.id === card.dataset.id);
      if (t) updateTask(t.id, { done: !t.done });
    }
  }
});

const handleEdit = (target) => {
  const card = target.closest(".task");
  if (!card) return;
  const id = card.dataset.id;
  const t = state.tasks.find((x) => x.id === id);
  if (!t) return;

  if (target.classList.contains("task-title")) {
    const text = target.textContent.trim();
    if (!text) {
      removeTask(id);
    } else if (text !== t.title) {
      updateTask(id, { title: text });
    }
  } else if (target.classList.contains("task-mins")) {
    const next = parseMins(target.textContent);
    if (next !== t.mins) updateTask(id, { mins: next });
    else target.textContent = fmtMins(t.mins); // restore canonical
  } else if (target.classList.contains("task-time")) {
    const next = parseTime(target.textContent);
    if (next !== t.time) updateTask(id, { time: next });
    else target.textContent = fmtTime(t.time);
  } else if (target.classList.contains("task-tag")) {
    let next = target.textContent.replace(/^#+\s*/, "").trim();
    if (next !== t.tag) updateTask(id, { tag: next });
    else target.textContent = t.tag;
  }
};

document.addEventListener(
  "blur",
  (e) => {
    if (e.target.matches?.("[contenteditable]")) handleEdit(e.target);
  },
  true
);

document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target.matches?.("[contenteditable]")) {
    e.preventDefault();
    e.target.blur();
  }
});

backlogAdd.addEventListener("submit", (e) => {
  e.preventDefault();
  if (!backlogAddInput.value.trim()) return;
  addTask({
    title: backlogAddInput.value,
    mins: parseMins(backlogAddMins.value),
    day: null,
  });
  backlogAddInput.value = "";
  backlogAddMins.value = "";
  backlogAddInput.focus();
});

// ---------- drag and drop ----------

let dragId = null;

document.addEventListener("dragstart", (e) => {
  const card = e.target.closest(".task, .cal-block");
  if (!card) return;
  dragId = card.dataset.id;
  card.classList.add("dragging");
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", dragId);
});

document.addEventListener("dragend", () => {
  document.querySelectorAll(".dragging").forEach((n) => n.classList.remove("dragging"));
  document.querySelectorAll(".drop-target").forEach((n) => n.classList.remove("drop-target"));
  document.querySelectorAll(".drag-over").forEach((n) => n.classList.remove("drag-over"));
  dragId = null;
});

const findZone = (target) => target.closest('[data-zone]');

document.addEventListener("dragover", (e) => {
  if (!dragId) return;
  const navTarget = e.target.closest('[data-view]');
  if (navTarget && (navTarget.dataset.view === "backlog" || navTarget.dataset.view === "today")) {
    e.preventDefault();
    document.querySelectorAll('.nav-item.drag-over').forEach((n) => n.classList.remove('drag-over'));
    navTarget.classList.add("drag-over");
    return;
  }
  const zone = findZone(e.target);
  if (!zone) return;
  e.preventDefault();
  document.querySelectorAll(".drop-target").forEach((n) => n.classList.remove("drop-target"));
  document.querySelectorAll(".drag-over").forEach((n) => n.classList.remove("drag-over"));
  if (zone.dataset.zone === "calendar") {
    zone.classList.add("drag-over");
    return;
  }
  const over = e.target.closest(".task");
  if (over && over.dataset.id !== dragId) over.classList.add("drop-target");
});

document.addEventListener("drop", (e) => {
  if (!dragId) return;

  // drop on sidebar nav
  const navTarget = e.target.closest('[data-view]');
  if (navTarget && (navTarget.dataset.view === "backlog" || navTarget.dataset.view === "today")) {
    e.preventDefault();
    moveTask(dragId, {
      day: navTarget.dataset.view === "backlog" ? null : dayKey(),
    });
    return;
  }

  const zone = findZone(e.target);
  if (!zone) return;
  e.preventDefault();

  if (zone.dataset.zone === "day") {
    const over = e.target.closest(".task");
    const beforeId = over && over.dataset.id !== dragId ? over.dataset.id : null;
    moveTask(dragId, { day: zone.dataset.day, beforeId });
  } else if (zone.dataset.zone === "backlog") {
    const over = e.target.closest(".task");
    const beforeId = over && over.dataset.id !== dragId ? over.dataset.id : null;
    moveTask(dragId, { day: null, beforeId });
  } else if (zone.dataset.zone === "calendar") {
    // schedule: compute time from drop y position
    const rect = calGrid.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const minutes = Math.max(0, Math.round((y / HOUR_PX) * 60 / 15) * 15);
    const totalMin = CAL_START * 60 + minutes;
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    if (h < CAL_END) {
      const t = state.tasks.find((x) => x.id === dragId);
      const patch = { day: dayKey(), time: `${pad(h)}:${pad(m)}` };
      if (t && !t.mins) patch.mins = 30;
      updateTask(dragId, patch);
    }
  }
});

// ---------- init ----------

buildCalendarSkeleton();
setView(view);
render();

// gentle minute tick: keep the now-line and phase honest, no other side effects
setInterval(() => {
  renderCalendar();
  renderHeader();
}, 60_000);
