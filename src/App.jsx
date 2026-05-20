import { useState, useEffect, useCallback } from "react";

// ─── Constants ────────────────────────────────────────────────────────────────

const PARTICIPANTS = ["Sushma", "Sunita", "Karishma", "Meenakshi", "Neha Singh", "Shazia", "Isha"];

const PRESET_LOCATIONS = [
  "Noida Sector 62",
  "Noida Sector 104",
  "Connaught Place, Delhi",
  "Noida Sector 63",
  "Habitat Centre",
  "Shipra Mall",
];

// ─── Room ID helpers ──────────────────────────────────────────────────────────

function getRoomId() {
  const params = new URLSearchParams(window.location.search);
  let room = params.get("room");
  if (!room) {
    room = Math.random().toString(36).slice(2, 10);
    const url = new URL(window.location.href);
    url.searchParams.set("room", room);
    window.history.replaceState({}, "", url.toString());
  }
  return room;
}

const ROOM_ID = getRoomId();
const STORAGE_KEY = `meetup_v2_${ROOM_ID}`;

// ─── Default factories ────────────────────────────────────────────────────────

const defaultParticipant = (name) => ({
  name,
  interested: null,
  dates: [],
  location: "",
  otherLocation: "",
  comments: "",
  submitted: false,
});

const defaultDate = () => ({ id: crypto.randomUUID(), date: "", slots: [defaultSlot()] });
const defaultSlot = () => ({ id: crypto.randomUUID(), start: "", end: "" });

// ─── Time helpers ─────────────────────────────────────────────────────────────

const toMin = (t) => { if (!t) return null; const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const toTime = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const fmtTime = (t) => { if (!t) return ""; const [h, m] = t.split(":").map(Number); return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`; };
const fmtDate = (d) => { if (!d) return ""; return new Date(d + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" }); };

// ─── Matching Logic ───────────────────────────────────────────────────────────

function intersectRangeSets(a, b) {
  const r = [];
  for (const [a1, a2] of a) for (const [b1, b2] of b) { const s = Math.max(a1, b1), e = Math.min(a2, b2); if (e > s) r.push([s, e]); }
  return r;
}

function findOverlap(rangesList) {
  let cur = rangesList[0] || [];
  for (let i = 1; i < rangesList.length; i++) { cur = intersectRangeSets(cur, rangesList[i]); if (!cur.length) return null; }
  return cur.length ? cur.sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]))[0] : null;
}

function computeMatches(data) {
  const interested = data.filter((p) => p.interested === "yes" && p.submitted);
  if (!interested.length) return { best: [], partial: [] };

  const allDates = [...new Set(interested.flatMap((p) => p.dates.map((d) => d.date)))].filter(Boolean).sort();
  const results = [];

  for (const date of allDates) {
    const onDate = interested.filter((p) => p.dates.some((d) => d.date === date));
    const offDate = interested.filter((p) => !p.dates.some((d) => d.date === date));
    const intervals = onDate.map((p) => ({
      name: p.name,
      ranges: p.dates.find((d) => d.date === date).slots
        .filter((s) => s.start && s.end).map((s) => [toMin(s.start), toMin(s.end)]).filter(([a, b]) => a < b),
    }));
    if (!intervals.length) continue;

    const overlap = findOverlap(intervals.map((i) => i.ranges));
    if (overlap && overlap[1] > overlap[0]) {
      results.push({ date, start: toTime(overlap[0]), end: toTime(overlap[1]), count: onDate.length, total: interested.length, available: onDate.map((p) => p.name), unavailable: offDate.map((p) => p.name), full: !offDate.length });
    } else {
      let best = null;
      for (let skip = 0; skip < intervals.length; skip++) {
        const sub = intervals.filter((_, i) => i !== skip);
        const ov = findOverlap(sub.map((i) => i.ranges));
        if (ov && ov[1] > ov[0] && (!best || sub.length > best.count)) {
          best = { start: toTime(ov[0]), end: toTime(ov[1]), count: sub.length, available: sub.map((i) => i.name), unavailable: [...offDate.map((p) => p.name), intervals[skip].name] };
        }
      }
      if (!best) best = { start: null, end: null, count: onDate.length, available: onDate.map((p) => p.name), unavailable: offDate.map((p) => p.name) };
      results.push({ date, ...best, total: interested.length, full: false });
    }
  }

  results.sort((a, b) => (b.full ? 1 : 0) - (a.full ? 1 : 0) || b.count - a.count);
  return { best: results.filter((r) => r.full), partial: results.filter((r) => !r.full) };
}

function computeLocationRanking(data) {
  const interested = data.filter((p) => p.interested === "yes" && p.submitted && p.location);
  const counts = {};
  for (const p of interested) {
    const loc = p.location === "Others" ? null : p.location;
    if (loc) counts[loc] = (counts[loc] || 0) + 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}

function getOtherLocations(data) {
  return data.filter((p) => p.interested === "yes" && p.submitted && p.location === "Others" && p.otherLocation.trim())
    .map((p) => ({ name: p.name, location: p.otherLocation.trim() }));
}

// ─── Badge ────────────────────────────────────────────────────────────────────

function Badge({ type }) {
  const cfg = {
    submitted: ["bg-emerald-100 text-emerald-700 border-emerald-200", "✓ Submitted"],
    pending: ["bg-amber-100 text-amber-700 border-amber-200", "⏳ Pending"],
    "not interested": ["bg-slate-100 text-slate-500 border-slate-200", "✕ Not Interested"],
  };
  const [cls, label] = cfg[type] || cfg.pending;
  return <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${cls}`}>{label}</span>;
}

// ─── ParticipantCard ──────────────────────────────────────────────────────────

function ParticipantCard({ participant: p, onChange, onClear }) {
  const [errors, setErrors] = useState({});

  function validate() {
    const errs = {};
    if (p.interested === "yes") {
      if (!p.dates.length) errs.dates = "Add at least one date.";
      p.dates.forEach((d, di) => {
        if (!d.date) errs[`date_${di}`] = "Date required.";
        d.slots.forEach((s, si) => {
          if (!s.start) errs[`start_${di}_${si}`] = "Start time required.";
          if (!s.end) errs[`end_${di}_${si}`] = "End time required.";
          if (s.start && s.end && s.end <= s.start) errs[`time_${di}_${si}`] = "End must be after start.";
        });
      });
      if (p.location === "Others" && !p.otherLocation.trim()) errs.otherLocation = "Please specify your location.";
    }
    return errs;
  }

  function handleSave() {
    if (!p.interested) { setErrors({ interested: "Please select your interest." }); return; }
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setErrors({});
    onChange({ ...p, submitted: true });
  }

  const addDate = () => onChange({ ...p, submitted: false, dates: [...p.dates, defaultDate()] });
  const removeDate = (id) => onChange({ ...p, submitted: false, dates: p.dates.filter((d) => d.id !== id) });
  const updateDate = (id, val) => onChange({ ...p, submitted: false, dates: p.dates.map((d) => d.id === id ? { ...d, date: val } : d) });
  const addSlot = (did) => onChange({ ...p, submitted: false, dates: p.dates.map((d) => d.id === did ? { ...d, slots: [...d.slots, defaultSlot()] } : d) });
  const removeSlot = (did, sid) => onChange({ ...p, submitted: false, dates: p.dates.map((d) => d.id === did ? { ...d, slots: d.slots.filter((s) => s.id !== sid) } : d) });
  const updateSlot = (did, sid, f, v) => onChange({ ...p, submitted: false, dates: p.dates.map((d) => d.id === did ? { ...d, slots: d.slots.map((s) => s.id === sid ? { ...s, [f]: v } : s) } : d) });

  const statusType = p.submitted ? (p.interested === "no" ? "not interested" : "submitted") : "pending";

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-stone-200 overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 bg-gradient-to-r from-amber-50 to-orange-50 border-b border-stone-200">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-orange-400 to-rose-500 flex items-center justify-center text-white font-bold text-sm shadow-sm">{p.name[0]}</div>
          <span className="font-semibold text-stone-800">{p.name}</span>
        </div>
        <div className="flex items-center gap-2">
          <Badge type={statusType} />
          {p.submitted && <button onClick={onClear} className="text-xs text-rose-500 hover:text-rose-700 underline ml-1">Clear</button>}
        </div>
      </div>

      <div className="px-5 py-4 space-y-4">
        {/* Interest */}
        <div>
          <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-2">Attending?</p>
          <div className="flex gap-2">
            {["yes", "no"].map((v) => (
              <button key={v} onClick={() => onChange({ ...p, interested: v, submitted: false })}
                className={`flex-1 py-2 rounded-xl text-sm font-medium border transition-all ${p.interested === v ? (v === "yes" ? "bg-emerald-500 text-white border-emerald-500 shadow-sm" : "bg-rose-400 text-white border-rose-400 shadow-sm") : "bg-white text-stone-600 border-stone-200 hover:border-stone-400"}`}>
                {v === "yes" ? "✓ Yes, I'm in!" : "✕ Not this time"}
              </button>
            ))}
          </div>
          {errors.interested && <p className="text-xs text-rose-500 mt-1">{errors.interested}</p>}
        </div>

        {p.interested === "yes" && (<>
          {/* Dates */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide">Available Dates & Times</p>
              <button onClick={addDate} className="text-xs font-semibold text-orange-600 hover:text-orange-800 bg-orange-50 hover:bg-orange-100 px-2 py-1 rounded-lg transition-colors">+ Add Date</button>
            </div>
            {errors.dates && <p className="text-xs text-rose-500 mb-2">{errors.dates}</p>}
            <div className="space-y-3">
              {p.dates.map((d, di) => (
                <div key={d.id} className="bg-stone-50 rounded-xl p-3 border border-stone-100">
                  <div className="flex items-center gap-2 mb-2">
                    <input type="date" value={d.date} onChange={(e) => updateDate(d.id, e.target.value)}
                      className="flex-1 text-sm border border-stone-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-orange-300" />
                    <button onClick={() => removeDate(d.id)} className="text-rose-400 hover:text-rose-600 text-lg leading-none">×</button>
                  </div>
                  {errors[`date_${di}`] && <p className="text-xs text-rose-500 mb-1">{errors[`date_${di}`]}</p>}
                  <div className="space-y-2">
                    {d.slots.map((s, si) => (
                      <div key={s.id} className="flex items-center gap-1.5">
                        <input type="time" value={s.start} onChange={(e) => updateSlot(d.id, s.id, "start", e.target.value)}
                          className="flex-1 text-sm border border-stone-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-orange-300" />
                        <span className="text-stone-400 text-xs">to</span>
                        <input type="time" value={s.end} onChange={(e) => updateSlot(d.id, s.id, "end", e.target.value)}
                          className="flex-1 text-sm border border-stone-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-orange-300" />
                        {d.slots.length > 1 && <button onClick={() => removeSlot(d.id, s.id)} className="text-rose-400 hover:text-rose-600 text-lg leading-none">×</button>}
                      </div>
                    ))}
                    {d.slots.map((_, si) => (errors[`start_${di}_${si}`] || errors[`end_${di}_${si}`] || errors[`time_${di}_${si}`]) && (
                      <p key={si} className="text-xs text-rose-500">{errors[`start_${di}_${si}`] || errors[`end_${di}_${si}`] || errors[`time_${di}_${si}`]}</p>
                    ))}
                  </div>
                  <button onClick={() => addSlot(d.id)} className="mt-2 text-xs text-orange-600 hover:text-orange-800 font-medium">+ Add time slot</button>
                </div>
              ))}
            </div>
          </div>

          {/* Location */}
          <div>
            <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-2">Preferred Location</p>
            <select value={p.location} onChange={(e) => onChange({ ...p, location: e.target.value, otherLocation: "", submitted: false })}
              className="w-full text-sm border border-stone-200 rounded-xl px-3 py-2.5 bg-white focus:outline-none focus:ring-2 focus:ring-orange-300 text-stone-700">
              <option value="">Select a location…</option>
              {PRESET_LOCATIONS.map((l) => <option key={l} value={l}>{l}</option>)}
              <option value="Others">Others (specify below)</option>
            </select>
            {p.location === "Others" && (
              <div className="mt-2">
                <input type="text" value={p.otherLocation} placeholder="Enter your preferred location…"
                  onChange={(e) => onChange({ ...p, otherLocation: e.target.value, submitted: false })}
                  className="w-full text-sm border border-stone-200 rounded-xl px-3 py-2.5 bg-white focus:outline-none focus:ring-2 focus:ring-orange-300 text-stone-700" />
                {errors.otherLocation && <p className="text-xs text-rose-500 mt-1">{errors.otherLocation}</p>}
              </div>
            )}
          </div>

          {/* Comments */}
          <div>
            <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-2">Comments (optional)</p>
            <textarea value={p.comments} onChange={(e) => onChange({ ...p, comments: e.target.value, submitted: false })}
              rows={2} placeholder="Any notes or preferences…"
              className="w-full text-sm border border-stone-200 rounded-xl px-3 py-2.5 bg-white focus:outline-none focus:ring-2 focus:ring-orange-300 text-stone-700 resize-none" />
          </div>
        </>)}

        {p.interested !== null && (
          <button onClick={handleSave}
            className="w-full py-2.5 bg-gradient-to-r from-orange-500 to-rose-500 text-white text-sm font-semibold rounded-xl shadow hover:from-orange-600 hover:to-rose-600 transition-all active:scale-95">
            Save Response
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

function Dashboard({ data }) {
  const matches = computeMatches(data);
  const locationRanking = computeLocationRanking(data);
  const otherLocations = getOtherLocations(data);
  const totalInterested = data.filter((p) => p.interested === "yes").length;
  const submitted = data.filter((p) => p.submitted && p.interested === "yes").length;
  const notInterested = data.filter((p) => p.submitted && p.interested === "no").length;
  const pending = data.filter((p) => !p.submitted).length;
  const allDone = totalInterested > 0 && data.filter((p) => p.interested === "yes" && !p.submitted).length === 0;

  return (
    <div className="space-y-5">
      {/* Status */}
      <div className="bg-white rounded-2xl shadow-sm border border-stone-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-stone-100 bg-gradient-to-r from-amber-50 to-orange-50">
          <h2 className="font-bold text-stone-800">📋 Response Status</h2>
        </div>
        <div className="px-5 py-3 grid grid-cols-3 gap-3 border-b border-stone-100">
          {[["text-emerald-600", submitted, "Submitted"], ["text-amber-500", pending, "Pending"], ["text-slate-400", notInterested, "Not Interested"]].map(([cls, n, label]) => (
            <div key={label} className="text-center">
              <div className={`text-2xl font-bold ${cls}`}>{n}</div>
              <div className="text-xs text-stone-500">{label}</div>
            </div>
          ))}
        </div>
        <div className="px-5 py-3 space-y-2">
          {data.map((p) => {
            const t = p.submitted ? (p.interested === "no" ? "not interested" : "submitted") : "pending";
            return (
              <div key={p.name} className="flex items-center justify-between">
                <span className="text-sm text-stone-700 font-medium">{p.name}</span>
                <Badge type={t} />
              </div>
            );
          })}
        </div>
        {allDone && (
          <div className="mx-5 mb-4 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-700 font-medium text-center">
            🎉 All interested participants have submitted!
          </div>
        )}
      </div>

      {/* Best Slots */}
      <div className="bg-white rounded-2xl shadow-sm border border-stone-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-stone-100 bg-gradient-to-r from-amber-50 to-orange-50">
          <h2 className="font-bold text-stone-800">✨ Best Meeting Slots</h2>
        </div>
        <div className="px-5 py-4 space-y-3">
          {!matches.best.length && !matches.partial.length && (
            <div className="text-center py-6 text-stone-400">
              <div className="text-4xl mb-2">🗓️</div>
              <p className="text-sm">No matches yet. Waiting for everyone to submit.</p>
            </div>
          )}
          {matches.best.map((m, i) => (
            <div key={i} className="bg-gradient-to-br from-emerald-50 to-teal-50 border border-emerald-200 rounded-xl p-4">
              <span className="text-xs font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">PERFECT MATCH</span>
              <div className="font-bold text-stone-800 mt-2">{fmtDate(m.date)}</div>
              {m.start && <div className="text-emerald-700 font-semibold text-sm mt-0.5">{fmtTime(m.start)} – {fmtTime(m.end)}</div>}
              <div className="mt-2 text-xs text-stone-600"><span className="font-semibold text-emerald-700">Everyone's in: </span>{m.available.join(", ")}</div>
            </div>
          ))}
          {!matches.best.length && matches.partial.length > 0 && <p className="text-xs text-stone-500 italic">No perfect match found. Showing best partial options:</p>}
          {matches.partial.slice(0, 3).map((m, i) => (
            <div key={i} className="bg-amber-50 border border-amber-200 rounded-xl p-4">
              <span className="text-xs font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">{m.count} of {m.total} available</span>
              <div className="font-bold text-stone-800 mt-2">{fmtDate(m.date)}</div>
              {m.start ? <div className="text-amber-700 font-semibold text-sm mt-0.5">{fmtTime(m.start)} – {fmtTime(m.end)}</div>
                : <div className="text-amber-600 text-xs mt-1 italic">No overlapping time found</div>}
              <div className="mt-2 text-xs text-stone-600"><span className="font-semibold text-emerald-700">Available: </span>{m.available.join(", ")}</div>
              {m.unavailable.length > 0 && <div className="mt-1 text-xs text-stone-500"><span className="font-semibold text-rose-500">Unavailable: </span>{m.unavailable.join(", ")}</div>}
            </div>
          ))}
        </div>
      </div>

      {/* Location Preferences */}
      {(locationRanking.length > 0 || otherLocations.length > 0) && (
        <div className="bg-white rounded-2xl shadow-sm border border-stone-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-stone-100 bg-gradient-to-r from-amber-50 to-orange-50">
            <h2 className="font-bold text-stone-800">📍 Location Preferences</h2>
          </div>
          <div className="px-5 py-4 space-y-4">
            {locationRanking.length > 0 && (
              <div className="space-y-2">
                {locationRanking.map(([loc, count], i) => (
                  <div key={loc} className="flex items-center gap-3">
                    <span className="text-xs font-bold text-stone-400 w-4">{i + 1}</span>
                    <div className="flex-1">
                      <div className="flex justify-between text-sm mb-0.5">
                        <span className="font-medium text-stone-700">{loc}</span>
                        <span className="text-stone-500 text-xs">{count} vote{count > 1 ? "s" : ""}</span>
                      </div>
                      <div className="h-1.5 bg-stone-100 rounded-full overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-orange-400 to-rose-400 rounded-full"
                          style={{ width: `${(count / Math.max(...locationRanking.map(([, c]) => c))) * 100}%` }} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {otherLocations.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-2">Custom Suggestions</p>
                <div className="space-y-2">
                  {otherLocations.map(({ name, location }) => (
                    <div key={name} className="flex items-start gap-2 bg-violet-50 border border-violet-100 rounded-xl px-3 py-2">
                      <div className="w-6 h-6 rounded-full bg-gradient-to-br from-violet-400 to-purple-500 flex items-center justify-center text-white font-bold text-xs flex-shrink-0 mt-0.5">{name[0]}</div>
                      <div>
                        <span className="text-xs font-semibold text-violet-700">{name}</span>
                        <p className="text-sm text-stone-700">{location}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── ShareBanner ──────────────────────────────────────────────────────────────

function ShareBanner() {
  const [copied, setCopied] = useState(false);
  const link = window.location.href;

  function copy() {
    navigator.clipboard.writeText(link).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-stone-200 px-5 py-4 flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-0.5">Share this link with your friends</p>
        <p className="text-xs text-stone-600 truncate font-mono">{link}</p>
      </div>
      <button onClick={copy}
        className={`flex-shrink-0 text-xs font-semibold px-3 py-2 rounded-xl transition-all ${copied ? "bg-emerald-500 text-white" : "bg-orange-100 text-orange-700 hover:bg-orange-200"}`}>
        {copied ? "✓ Copied!" : "Copy Link"}
      </button>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  const [tab, setTab] = useState("dashboard");
  const [data, setData] = useState(PARTICIPANTS.map(defaultParticipant));
  const [loading, setLoading] = useState(true);
  const [lastSaved, setLastSaved] = useState(null);

  // Load from shared storage on mount + poll every 8s
  const loadData = useCallback(async () => {
    try {
      const result = await window.storage.get(STORAGE_KEY, true);
      if (result?.value) {
        const parsed = JSON.parse(result.value);
        setData(PARTICIPANTS.map((name) => parsed.find((p) => p.name === name) || defaultParticipant(name)));
      }
    } catch (_) {}
    setLoading(false);
  }, []);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 8000);
    return () => clearInterval(interval);
  }, [loadData]);

  async function saveParticipant(name, updated) {
    const newData = data.map((p) => (p.name === name ? updated : p));
    setData(newData);
    try {
      await window.storage.set(STORAGE_KEY, JSON.stringify(newData), true);
      setLastSaved(new Date());
    } catch (_) {}
  }

  async function clearParticipant(name) {
    const newData = data.map((p) => (p.name === name ? defaultParticipant(name) : p));
    setData(newData);
    try {
      await window.storage.set(STORAGE_KEY, JSON.stringify(newData), true);
      setLastSaved(new Date());
    } catch (_) {}
  }

  async function resetAll() {
    if (!window.confirm("Reset all responses? This cannot be undone.")) return;
    const fresh = PARTICIPANTS.map(defaultParticipant);
    setData(fresh);
    try {
      await window.storage.set(STORAGE_KEY, JSON.stringify(fresh), true);
      setLastSaved(new Date());
    } catch (_) {}
  }

  return (
    <div className="min-h-screen bg-stone-100" style={{ fontFamily: "'Georgia', serif" }}>
      <div className="bg-gradient-to-br from-orange-500 via-rose-500 to-pink-600 text-white px-5 pt-10 pb-6 shadow-lg">
        <div className="max-w-xl mx-auto">
          <div className="text-xs font-bold uppercase tracking-widest opacity-70 mb-1" style={{ fontFamily: "sans-serif" }}>Plan Together</div>
          <h1 className="text-3xl font-bold leading-tight">Meetup Matcher</h1>
          <div className="flex items-center justify-between mt-1">
            <p className="text-sm opacity-80" style={{ fontFamily: "sans-serif" }}>Find the perfect time for all 7 friends</p>
            {lastSaved && <p className="text-xs opacity-60" style={{ fontFamily: "sans-serif" }}>Saved {lastSaved.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</p>}
          </div>
        </div>
      </div>

      <div className="sticky top-0 z-10 bg-white border-b border-stone-200 shadow-sm">
        <div className="max-w-xl mx-auto flex">
          {[["dashboard", "📊 Dashboard"], ["availability", "📝 Enter Availability"]].map(([key, label]) => (
            <button key={key} onClick={() => setTab(key)}
              className={`flex-1 py-3.5 text-sm font-semibold transition-colors border-b-2 ${tab === key ? "border-orange-500 text-orange-600" : "border-transparent text-stone-500 hover:text-stone-700"}`}
              style={{ fontFamily: "sans-serif" }}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-xl mx-auto px-4 py-5 space-y-4">
        {loading ? (
          <div className="text-center py-16 text-stone-400">
            <div className="text-4xl mb-3 animate-pulse">🔄</div>
            <p className="text-sm" style={{ fontFamily: "sans-serif" }}>Loading shared data…</p>
          </div>
        ) : (<>
          <ShareBanner />
          {tab === "dashboard" && <Dashboard data={data} />}
          {tab === "availability" && data.map((p) => (
            <ParticipantCard key={p.name} participant={p}
              onChange={(updated) => saveParticipant(p.name, updated)}
              onClear={() => clearParticipant(p.name)} />
          ))}
          <div className="pt-2 pb-8 text-center">
            <button onClick={resetAll} className="text-xs text-stone-400 hover:text-rose-500 underline transition-colors" style={{ fontFamily: "sans-serif" }}>
              Reset all responses
            </button>
          </div>
        </>)}
      </div>
    </div>
  );
}