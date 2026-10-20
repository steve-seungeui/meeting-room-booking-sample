"use strict";

const TZ = "Asia/Seoul";
const EMAIL_KEY = "mrb.email";

const $ = (id) => document.getElementById(id);
const els = {
  me: $("me"),
  rooms: $("rooms"),
  date: $("date"),
  scheduleRoom: $("schedule-room"),
  schedule: $("schedule"),
  form: $("book"),
  submit: $("book-submit"),
  toast: $("toast"),
};

const state = { rooms: [], roomId: null };

const EQUIPMENT_LABELS = { display: "디스플레이", video_conference: "화상회의", whiteboard: "화이트보드" };

const dateFmt = new Intl.DateTimeFormat("sv-SE", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const timeFmt = new Intl.DateTimeFormat("ko-KR", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const dateTimeFmt = new Intl.DateTimeFormat("ko-KR", {
  timeZone: TZ, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

const kstDate = (d) => dateFmt.format(d); // YYYY-MM-DD

function readStoredEmail() {
  try { return localStorage.getItem(EMAIL_KEY) || ""; } catch { return ""; }
}
function storeEmail(value) {
  try { localStorage.setItem(EMAIL_KEY, value); } catch { /* 저장소를 못 쓰면 이번 방문에만 유지한다 */ }
}

let toastTimer;
function toast(message, isError = false) {
  els.toast.textContent = message;
  els.toast.classList.toggle("error", isError);
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { els.toast.hidden = true; }, 5000);
}

async function api(path, options) {
  let res;
  try {
    res = await fetch(path, options);
  } catch {
    throw new Error("서버에 연결할 수 없습니다.");
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.message || "요청에 실패했습니다 (" + res.status + ").");
  return body;
}

// 사용자 입력이 섞인 값은 textContent로만 넣는다.
function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  node.append(...children);
  return node;
}

function renderRooms() {
  els.rooms.replaceChildren(...state.rooms.map((room) => {
    const equipment = room.equipment.map((e) => EQUIPMENT_LABELS[e] || e).join(", ") || "설비 없음";
    const button = el("button", { type: "button", className: "room" },
      room.name,
      el("small", {}, room.floor + "층 · " + room.capacity + "명 · " + equipment));
    button.setAttribute("aria-pressed", String(room.id === state.roomId));
    button.addEventListener("click", () => selectRoom(room.id));
    return el("li", {}, button);
  }));
}

function selectRoom(roomId) {
  state.roomId = roomId;
  renderRooms();
  loadSchedule();
}

function timeRange(r) {
  const start = new Date(r.start);
  const end = new Date(r.end);
  // 하루를 넘나드는 예약은 날짜까지 보여 준다.
  if (kstDate(start) === kstDate(end)) return timeFmt.format(start) + " – " + timeFmt.format(end);
  return dateTimeFmt.format(start) + " – " + dateTimeFmt.format(end);
}

function renderSchedule(items) {
  const room = state.rooms.find((r) => r.id === state.roomId);
  els.scheduleRoom.textContent = room.name + " · " + els.date.value + " (한국 시간)";
  if (items.length === 0) {
    els.schedule.replaceChildren(el("li", { className: "muted" }, "이 날은 예약이 없습니다."));
    return;
  }
  const me = els.me.value.trim();
  els.schedule.replaceChildren(...items.map((r) => {
    const li = el("li", {},
      el("div", { className: "time" }, timeRange(r)),
      el("div", { className: "title" }, r.title),
      el("div", { className: "meta" }, "주최 " + r.organizer),
    );
    if (r.attendees.length) li.append(el("div", { className: "meta" }, "참석 " + r.attendees.join(", ")));
    if (me && r.organizer === me) {
      const cancel = el("button", { type: "button", className: "danger" }, "예약 취소");
      cancel.addEventListener("click", () => cancelReservation(r, cancel));
      li.append(cancel);
    }
    return li;
  }));
}

let scheduleSeq = 0;
async function loadSchedule() {
  if (!state.roomId || !els.date.value) return;
  const seq = ++scheduleSeq;
  try {
    const items = await api("/rooms/" + encodeURIComponent(state.roomId) + "/schedule?date=" + els.date.value);
    if (seq === scheduleSeq) renderSchedule(items); // 늦게 도착한 이전 응답은 버린다.
  } catch (e) {
    if (seq === scheduleSeq) toast(e.message, true);
  }
}

async function cancelReservation(reservation, button) {
  if (!confirm("'" + reservation.title + "' 예약을 취소할까요?")) return;
  button.disabled = true;
  try {
    await api("/reservations/" + encodeURIComponent(reservation.id) + "/cancel", {
      method: "POST",
      headers: { "X-User-Email": els.me.value.trim() },
    });
    toast("예약을 취소했습니다.");
  } catch (e) {
    toast(e.message, true);
  }
  loadSchedule();
}

function parseEmails(text) {
  return [...new Set(text.split(/[\s,;]+/).filter(Boolean))];
}

async function submitBooking(event) {
  event.preventDefault();
  if (!state.roomId) return toast("먼저 회의실을 선택해 주세요.", true);
  if (!els.form.reportValidity()) return;
  const f = new FormData(els.form);
  // 입력값은 한국 시간이므로 +09:00 오프셋을 붙여 보낸다.
  const at = (field) => f.get("date") + "T" + f.get(field) + ":00+09:00";
  els.submit.disabled = true;
  try {
    await api("/reservations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        roomId: state.roomId,
        title: f.get("title"),
        organizer: f.get("organizer").trim(),
        attendees: parseEmails(f.get("attendees")),
        start: at("start"),
        end: at("end"),
      }),
    });
    toast("예약했습니다.");
    els.form.elements.title.value = "";
    els.form.elements.attendees.value = "";
    els.date.value = f.get("date");
    loadSchedule();
  } catch (e) {
    toast(e.message, true);
  } finally {
    els.submit.disabled = false;
  }
}

async function init() {
  const today = kstDate(new Date());
  els.date.value = today;
  els.form.elements.date.value = today;
  els.me.value = readStoredEmail();
  els.form.elements.organizer.value = els.me.value;

  els.me.addEventListener("change", () => {
    const value = els.me.value.trim();
    storeEmail(value);
    if (value) els.form.elements.organizer.value = value;
    loadSchedule();
  });
  els.date.addEventListener("change", () => {
    els.form.elements.date.value = els.date.value;
    loadSchedule();
  });
  els.form.addEventListener("submit", submitBooking);

  try {
    state.rooms = await api("/rooms");
    renderRooms();
    if (state.rooms.length) selectRoom(state.rooms[0].id);
  } catch (e) {
    toast(e.message, true);
  }
}

init();
