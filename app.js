// oloimina — calm task management
// State lives in localStorage. No network, no analytics, no third parties.

const STORE_KEY = "oloimina.v1";

const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
};

const load = () => {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    return { ...defaultState(), ...parsed };
  } catch {
    return defaultState();
  }
};

const defaultState = () => ({
  tasks: [], // { id, title, mins, zone: "today"|"backlog", done, planned: dateKey|null }
  lastPlannedOn: null,
  lastShutdownOn: null,
  ritualDismissedFor: null,
});

const save = (state) => {
  localStorage.setItem(STORE_KEY, JSON.stringify(state));
};

let state = load();

// Roll over: anything left in "today" from a prior day moves back to backlog,
// quietly. The product does not scold; time passed.
const rollover = () => {
  const today = todayKey();
  let changed = false;
  for (const t of state.tasks) {
    if (t.zone === "today" && t.planned && t.planned !== today) {
      t.zone = "backlog";
      t.planned = null;
      t.done = false;
      changed = true;
    }
  }
  if (changed) save(state);
};

rollover();

// --- DOM ---

const $ = (id) => document.getElementById(id);
const tpl = $("task-tpl");

const dateEl = $("date");
const phaseEl = $("phase");
const todayList = $("today-list");
const backlogList = $("backlog-list");
const todayEmpty = $("today-empty");
const backlogEmpty = $("backlog-empty");
const commitEl = $("commit");
const addForm = $("add-form");
const addInput = $("add-input");
const addMins = $("add-mins");
const ritual = $("ritual");
const ritualTitle = $("ritual-title");
const ritualBody = $("ritual-body");
const ritualDone = $("ritual-done");
const ritualSkip = $("ritual-skip");
const shutdownBtn = $("shutdown");

// --- Render ---

const fmtDate = () => {
  const d = new Date();
  return d.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
};

const fmtMins = (m) => {
  if (!m) return "";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
};

const phaseFor = (hour) => {
  if (hour < 5) return "night";
  if (hour < 11) return "morning";
  if (hour < 14) return "midday";
  if (hour < 18) return "afternoon";
  if (hour < 22) return "evening";
  return "night";
};

const renderHeader = () => {
  dateEl.textContent = fmtDate();
  phaseEl.textContent = phaseFor(new Date().getHours());
};

const renderCommit = () => {
  const today = state.tasks.filter((t) => t.zone === "today");
  const open = today.filter((t) => !t.done);
  const total = open.reduce((s, t) => s + (t.mins || 0), 0);
  if (today.length === 0) {
    commitEl.textContent = "";
    return;
  }
  if (open.length === 0) {
    commitEl.textContent = "the day is done";
    return;
  }
  commitEl.textContent = total ? `${fmtMins(total)} planned` : `${open.length} open`;
};

const renderList = (zone, listEl, emptyEl) => {
  const items = state.tasks.filter((t) => t.zone === zone);
  listEl.innerHTML = "";
  for (const t of items) {
    const node = tpl.content.firstElementChild.cloneNode(true);
    node.dataset.id = t.id;
    if (t.done) node.classList.add("done");
    node.querySelector(".title").textContent = t.title;
    node.querySelector(".title").contentEditable = "true";
    node.querySelector(".title").spellcheck = false;
    node.querySelector(".mins").textContent = fmtMins(t.mins);
    listEl.appendChild(node);
  }
  emptyEl.hidden = items.length !== 0;
};

const render = () => {
  renderHeader();
  renderList("today", todayList, todayEmpty);
  renderList("backlog", backlogList, backlogEmpty);
  renderCommit();
};

// --- Mutations ---

const addTask = (title, mins) => {
  const t = {
    id: crypto.randomUUID(),
    title: title.trim(),
    mins: mins ? Number(mins) : 0,
    zone: "backlog",
    done: false,
    planned: null,
  };
  if (!t.title) return;
  state.tasks.push(t);
  save(state);
  render();
};

const moveTask = (id, zone, beforeId) => {
  const t = state.tasks.find((x) => x.id === id);
  if (!t) return;
  t.zone = zone;
  t.planned = zone === "today" ? todayKey() : null;
  if (zone === "backlog") t.done = false;

  // reorder: move to position before beforeId (or to end)
  state.tasks = state.tasks.filter((x) => x.id !== id);
  if (beforeId) {
    const idx = state.tasks.findIndex((x) => x.id === beforeId);
    if (idx >= 0) state.tasks.splice(idx, 0, t);
    else state.tasks.push(t);
  } else {
    state.tasks.push(t);
  }
  save(state);
  render();
};

const toggleDone = (id) => {
  const t = state.tasks.find((x) => x.id === id);
  if (!t) return;
  t.done = !t.done;
  save(state);
  render();
};

const editTitle = (id, title) => {
  const t = state.tasks.find((x) => x.id === id);
  if (!t) return;
  const trimmed = title.trim();
  if (!trimmed) {
    state.tasks = state.tasks.filter((x) => x.id !== id);
  } else {
    t.title = trimmed;
  }
  save(state);
  render();
};

const editMins = (id, raw) => {
  const t = state.tasks.find((x) => x.id === id);
  if (!t) return;
  const n = parseInt(String(raw).replace(/\D/g, ""), 10);
  t.mins = Number.isFinite(n) ? n : 0;
  save(state);
  render();
};

// --- Events ---

addForm.addEventListener("submit", (e) => {
  e.preventDefault();
  if (!addInput.value.trim()) return;
  addTask(addInput.value, addMins.value);
  addInput.value = "";
  addMins.value = "";
  addInput.focus();
});

const taskFromEvent = (e) => e.target.closest(".task");

document.addEventListener("click", (e) => {
  if (e.target.classList.contains("check")) {
    const node = taskFromEvent(e);
    if (node) toggleDone(node.dataset.id);
  }
});

document.addEventListener(
  "blur",
  (e) => {
    const node = taskFromEvent(e);
    if (!node) return;
    if (e.target.classList.contains("title")) {
      editTitle(node.dataset.id, e.target.textContent);
    } else if (e.target.classList.contains("mins")) {
      editMins(node.dataset.id, e.target.textContent);
    }
  },
  true
);

document.addEventListener("keydown", (e) => {
  if (
    e.key === "Enter" &&
    (e.target.classList?.contains("title") || e.target.classList?.contains("mins"))
  ) {
    e.preventDefault();
    e.target.blur();
  }
});

// --- Drag and drop ---

let dragId = null;

document.addEventListener("dragstart", (e) => {
  const node = taskFromEvent(e);
  if (!node) return;
  dragId = node.dataset.id;
  node.classList.add("dragging");
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", dragId);
});

document.addEventListener("dragend", (e) => {
  const node = taskFromEvent(e);
  if (node) node.classList.remove("dragging");
  document
    .querySelectorAll(".drop-target")
    .forEach((n) => n.classList.remove("drop-target"));
  dragId = null;
});

const findDropList = (target) => target.closest('[data-zone]');

document.addEventListener("dragover", (e) => {
  const list = findDropList(e.target);
  if (!list) return;
  e.preventDefault();
  const over = e.target.closest(".task");
  document
    .querySelectorAll(".drop-target")
    .forEach((n) => n.classList.remove("drop-target"));
  if (over && over.dataset.id !== dragId) over.classList.add("drop-target");
});

document.addEventListener("drop", (e) => {
  const list = findDropList(e.target);
  if (!list || !dragId) return;
  e.preventDefault();
  const over = e.target.closest(".task");
  const beforeId = over && over.dataset.id !== dragId ? over.dataset.id : null;
  moveTask(dragId, list.dataset.zone, beforeId);
});

// --- Rituals ---
// Two gentle, optional moments per day. Both can be dismissed permanently
// for the day with "later". The product does not nag.

const showRitual = (title, body, onDone) => {
  ritualTitle.textContent = title;
  ritualBody.textContent = body;
  ritual.hidden = false;
  const close = () => {
    ritual.hidden = true;
    ritualDone.removeEventListener("click", doneHandler);
    ritualSkip.removeEventListener("click", skipHandler);
  };
  const doneHandler = () => {
    close();
    onDone?.();
  };
  const skipHandler = () => {
    close();
    state.ritualDismissedFor = todayKey();
    save(state);
  };
  ritualDone.addEventListener("click", doneHandler);
  ritualSkip.addEventListener("click", skipHandler);
};

const maybeMorningRitual = () => {
  const today = todayKey();
  if (state.lastPlannedOn === today) return;
  if (state.ritualDismissedFor === today) return;
  const hasToday = state.tasks.some((t) => t.zone === "today");
  if (hasToday) return; // user already started planning
  const hour = new Date().getHours();
  if (hour < 5 || hour >= 14) return; // morning/early-midday only
  showRitual(
    "plan today",
    "drag a few things from the backlog into today. small days are fine. an empty today is fine.",
    () => {
      state.lastPlannedOn = today;
      save(state);
    }
  );
};

const runShutdown = () => {
  const today = todayKey();
  const items = state.tasks.filter((t) => t.zone === "today");
  const done = items.filter((t) => t.done).length;
  const open = items.length - done;
  const body =
    items.length === 0
      ? "nothing was planned. that's a kind of day too. sleep well."
      : `${done} done${open ? `, ${open} carries over` : ""}. close the laptop.`;
  showRitual("shut down", body, () => {
    // Carry incomplete forward by leaving them; rollover() handles next day.
    state.lastShutdownOn = today;
    save(state);
  });
};

shutdownBtn.addEventListener("click", runShutdown);

render();
maybeMorningRitual();
