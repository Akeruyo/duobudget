import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  PieChart, Pie, Cell, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, Tooltip, ResponsiveContainer, Legend
} from "recharts";

// Firebase
import { auth, db } from "./firebase";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from "firebase/auth";
import {
  doc, getDoc, setDoc, onSnapshot,
} from "firebase/firestore";

// ═══════════════════════════════════════════════════════════
//  FIRESTORE SYNC
// ═══════════════════════════════════════════════════════════
const getDocRef = (uid) => doc(db, "budgets", uid);

const firestoreLoad = async (uid) => {
  try {
    const snap = await getDoc(getDocRef(uid));
    return snap.exists() ? snap.data().budget : null;
  } catch { return null; }
};

const firestoreSave = async (uid, data) => {
  try {
    await setDoc(getDocRef(uid), { budget: data }, { merge: true });
  } catch (e) { console.error("Save error", e); }
};

// ═══════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════
const nowISO = () => new Date().toISOString();
const pad = n => String(n).padStart(2, "0");
const fmtDT = iso => { if (!iso) return ""; const d = new Date(iso); return `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const fmtDate = iso => { if (!iso) return ""; const d = new Date(iso); return `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()}`; };
const mkid = () => `${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
const monthKey = (y,m) => `${y}-${pad(m+1)}`;
const curMonthKey = () => { const d=new Date(); return monthKey(d.getFullYear(),d.getMonth()); };
const monthLabel = k => { const [y,m]=k.split("-"); return new Date(+y,+m-1,1).toLocaleDateString("fr-FR",{month:"long",year:"numeric"}); };
const monthLabelShort = k => { const [y,m]=k.split("-"); return new Date(+y,+m-1,1).toLocaleDateString("fr-FR",{month:"short",year:"2-digit"}); };
const fmt = n => (n||0).toLocaleString("fr-FR",{minimumFractionDigits:0,maximumFractionDigits:2})+" €";

const AVATARS = ["😊","😎","🥰","🤩","😄","🧑","👩","👨","🦊","🐱","🐶","🦁","🐼","🦋","🌟","💫","🔥","⭐","🌈","🎯","🦄","🐸","🎭","🧸","🚀"];
const CAT_ICONS = ["🏠","🛒","🚗","🎬","💊","👗","⚡","📱","🍽️","💰","✈️","🎮","📚","🐾","🎁","🧴","🍷","☕","🏋️","🌿","💡","🔧","🎨","🎵","💻","🛁","🎯","🌎","🎂","💐","🏖️","🎓","🐠","🍕","🎪"];
const BILL_ICONS = ["⚡","💧","🔥","📱","🌐","🏠","🚗","🎓","💊","📺","🎵","🌿","🏦","🛡️","📦","🎪"];

const DEFAULT_CATS = [
  {id:"c1",name:"Loyer",icon:"🏠",color:"#FF6B6B"},
  {id:"c2",name:"Alimentation",icon:"🛒",color:"#4ECDC4"},
  {id:"c3",name:"Transport",icon:"🚗",color:"#45B7D1"},
  {id:"c4",name:"Loisirs",icon:"🎬",color:"#96CEB4"},
  {id:"c5",name:"Santé",icon:"💊",color:"#FFEAA7"},
  {id:"c6",name:"Vêtements",icon:"👗",color:"#DDA0DD"},
  {id:"c7",name:"Énergie",icon:"⚡",color:"#F0E68C"},
  {id:"c8",name:"Abonnements",icon:"📱",color:"#98FB98"},
  {id:"c9",name:"Restaurant",icon:"🍽️",color:"#FFB347"},
  {id:"c10",name:"Épargne",icon:"💰",color:"#87CEEB"},
];

const INIT = { profiles:[], categories:DEFAULT_CATS, monthsData:{}, bills:[], recurringIncomes:[] };

function ensureMonth(d, key) {
  if (!d.monthsData[key]) d.monthsData[key] = { transactions:[], incomes:{p1:0,p2:0,common:0}, billsProcessed:{} };
  if (!d.monthsData[key].billsProcessed) d.monthsData[key].billsProcessed = {};
  return d;
}

function processDueBills(data) {
  const now = new Date();
  let changed = false;
  const next = JSON.parse(JSON.stringify(data));
  (next.bills || []).forEach(bill => {
    if (!bill.dueDate) return;
    const due = new Date(bill.dueDate);
    if (due > now) return;
    const mk = monthKey(due.getFullYear(), due.getMonth());
    ensureMonth(next, mk);
    const md = next.monthsData[mk];
    if (md.billsProcessed[bill.id]) return;
    md.billsProcessed[bill.id] = nowISO();
    if (!bill.paid) bill.paid = {};
    bill.paid[mk] = true;
    if (bill.amount > 0) {
      md.transactions.push({
        id: mkid(), label: `${bill.name} (auto)`, amount: bill.amount,
        categoryId: bill.categoryId || "c7", profileId: bill.profileId || "common",
        timestamp: due.toISOString(), fromBill: bill.id, auto: true,
      });
    }
    if (bill.recurring) {
      const nextDue = new Date(due);
      nextDue.setMonth(nextDue.getMonth() + 1);
      bill.dueDate = nextDue.toISOString();
    }
    changed = true;
  });
  (next.recurringIncomes || []).forEach(ri => {
    const start = new Date(ri.startDate || nowISO());
    let cur = new Date(start.getFullYear(), start.getMonth(), 1);
    const endDate = new Date(now.getFullYear(), now.getMonth(), 1);
    while (cur <= endDate) {
      const mk = monthKey(cur.getFullYear(), cur.getMonth());
      ensureMonth(next, mk);
      if (!next.monthsData[mk].incomes[ri.profileId]) {
        next.monthsData[mk].incomes[ri.profileId] = ri.amount;
        changed = true;
      }
      cur.setMonth(cur.getMonth() + 1);
    }
  });
  return { data: next, changed };
}

// ═══════════════════════════════════════════════════════════
//  CSS
// ═══════════════════════════════════════════════════════════
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800;900&family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,700;1,9..144,400&display=swap');
*{box-sizing:border-box;margin:0;padding:0;}
:root{
  --bg:#07060f;--bg2:#0e0c1e;--bg3:#15122a;--bg4:#1a1635;
  --glass:rgba(255,255,255,0.055);--glass2:rgba(255,255,255,0.09);
  --border:rgba(255,255,255,0.09);--border2:rgba(255,255,255,0.16);
  --text:#ede9f8;--text2:rgba(237,233,248,0.6);--text3:rgba(237,233,248,0.35);
  --purple:#a78bfa;--pink:#f472b6;--blue:#60a5fa;--green:#4ade80;--orange:#fb923c;--red:#f87171;--yellow:#fbbf24;
  --grad-main:linear-gradient(135deg,#a78bfa,#f472b6);
  --grad-green:linear-gradient(135deg,#4ade80,#22d3ee);
  --grad-red:linear-gradient(135deg,#f87171,#fb923c);
  --shadow-glow:0 0 40px rgba(167,139,250,0.15);
  --sw:240px;--r:16px;--r-sm:11px;--r-lg:22px;
}
html,body,#root{font-family:'Outfit',sans-serif;background:var(--bg);color:var(--text);width:100%;height:100%;margin:0;padding:0;overflow:hidden;}

/* ── AUTH SCREEN ── */
.auth-shell{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;padding:20px;
  padding-top:calc(20px + env(safe-area-inset-top));
  padding-bottom:calc(20px + env(safe-area-inset-bottom));
  background:radial-gradient(ellipse 80% 60% at 50% -10%,rgba(167,139,250,0.18),transparent 70%),var(--bg);}
.auth-card{background:linear-gradient(145deg,#110f24,#1a1635);border:1px solid var(--border2);border-radius:24px;padding:36px;width:100%;max-width:420px;}

/* ── SHELL ── */
.app-shell{position:fixed;inset:0;display:flex;overflow:hidden;
  background:radial-gradient(ellipse 60% 40% at 10% 0%,rgba(167,139,250,0.1) 0%,transparent 60%),
             radial-gradient(ellipse 50% 30% at 90% 100%,rgba(244,114,182,0.07) 0%,transparent 60%),
             var(--bg);}

/* ── SIDEBAR ── */
.sidebar{width:var(--sw);flex-shrink:0;background:linear-gradient(180deg,#0e0c1e,#09070f);border-right:1px solid var(--border);
  position:fixed;top:0;left:0;bottom:0;display:flex;flex-direction:column;z-index:300;
  padding-top:env(safe-area-inset-top);
  padding-bottom:env(safe-area-inset-bottom);
  transition:transform .25s cubic-bezier(.4,0,.2,1);}
.sidebar-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,0.6);backdrop-filter:blur(4px);z-index:299;}

/* ── MAIN AREA ── */
.main-area{margin-left:var(--sw);flex:1;display:flex;flex-direction:column;min-height:0;min-width:0;width:0;
  transition:margin-left .25s cubic-bezier(.4,0,.2,1);}
.topbar{
  height:calc(60px + env(safe-area-inset-top));
  padding-top:calc(10px + env(safe-area-inset-top));
  padding-left:calc(24px + env(safe-area-inset-left));
  padding-right:calc(24px + env(safe-area-inset-right));
  padding-bottom:10px;
  background:rgba(7,6,15,0.9);backdrop-filter:blur(24px);border-bottom:1px solid var(--border);
  display:flex;align-items:center;justify-content:space-between;flex-shrink:0;gap:10px;z-index:200;}
.page-content{flex:1;padding:24px;overflow-y:auto;overflow-x:hidden;min-height:0;}

/* ── CONTENT GRIDS ── */
.content-grid{display:grid;grid-template-columns:1fr 360px;gap:20px;align-items:start;}
.content-grid.wide{grid-template-columns:1fr !important;}

/* ── SIDEBAR NAV ── */
.nav-section-label{font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:var(--text3);padding:0 18px;margin:16px 0 6px;}
.nav-item{display:flex;align-items:center;gap:11px;padding:10px 14px;margin:2px 8px;border-radius:12px;cursor:pointer;transition:all .18s;font-size:14px;font-weight:600;color:var(--text2);position:relative;}
.nav-item:hover{color:var(--text);background:rgba(255,255,255,0.06);}
.nav-item.active{color:var(--purple);background:rgba(167,139,250,0.12);}
.nav-item.active::before{content:'';position:absolute;left:-8px;top:50%;transform:translateY(-50%);width:3px;height:18px;background:var(--grad-main);border-radius:0 3px 3px 0;}
.nav-icon{font-size:17px;width:22px;text-align:center;flex-shrink:0;}
.nav-badge{margin-left:auto;background:rgba(248,113,113,0.2);color:var(--red);border-radius:10px;padding:1px 7px;font-size:11px;font-weight:800;}

/* ── CARDS ── */
.glass{background:var(--glass);backdrop-filter:blur(20px);border:1px solid var(--border);border-radius:var(--r);}
.glass-hover{transition:all .2s;}
.glass-hover:hover{background:var(--glass2);border-color:var(--border2);box-shadow:var(--shadow-glow);}
.card{background:var(--glass);border:1px solid var(--border);border-radius:var(--r);padding:22px;}
.card-sm{background:var(--glass);border:1px solid var(--border);border-radius:var(--r);padding:14px 18px;}

/* ── BUTTONS ── */
.btn{border:none;border-radius:var(--r-sm);cursor:pointer;font-family:'Outfit',sans-serif;font-weight:600;transition:all .2s;font-size:14px;display:inline-flex;align-items:center;gap:7px;white-space:nowrap;}
.btn-primary{background:var(--grad-main);color:white;padding:10px 20px;box-shadow:0 4px 14px rgba(167,139,250,0.3);}
.btn-primary:hover{transform:translateY(-1px);box-shadow:0 6px 20px rgba(167,139,250,0.45);}
.btn-primary:disabled{opacity:0.4;pointer-events:none;}
.btn-ghost{background:var(--glass);color:var(--text);border:1px solid var(--border);padding:10px 20px;}
.btn-ghost:hover{background:var(--glass2);border-color:var(--border2);}
.btn-sm{padding:7px 14px;font-size:13px;border-radius:9px;}
.btn-danger{background:rgba(248,113,113,0.1);color:var(--red);border:1px solid rgba(248,113,113,0.25);padding:10px 18px;}
.btn-danger:hover{background:rgba(248,113,113,0.2);}
.btn-icon{background:var(--glass);border:1px solid var(--border);border-radius:9px;width:34px;height:34px;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:all .2s;font-size:15px;flex-shrink:0;}
.btn-icon:hover{background:var(--glass2);border-color:var(--border2);}
.menu-btn{background:rgba(255,255,255,0.06);border:1px solid var(--border);border-radius:10px;color:var(--text2);cursor:pointer;font-size:19px;padding:6px 10px;display:none;align-items:center;transition:all .2s;flex-shrink:0;}
.menu-btn:hover{color:var(--text);background:var(--glass2);}
@media(max-width:880px){.menu-btn{display:flex;}}

/* ── INPUTS ── */
input,select,textarea{background:rgba(255,255,255,0.06);border:1px solid var(--border);border-radius:var(--r-sm);color:var(--text);padding:10px 14px;font-size:14px;width:100%;outline:none;transition:border .2s,box-shadow .2s;font-family:'Outfit',sans-serif;}
input:focus,select:focus{border-color:rgba(167,139,250,0.5);box-shadow:0 0 0 3px rgba(167,139,250,0.08);}
input[type=color]{padding:3px;height:38px;cursor:pointer;}
select option{background:#15122a;}
label{font-size:12px;color:var(--text2);font-weight:600;display:block;margin-bottom:5px;letter-spacing:.3px;}

/* ── PROGRESS ── */
.progress-track{background:rgba(255,255,255,0.07);border-radius:20px;overflow:hidden;}
.progress-fill{height:100%;border-radius:20px;transition:width .6s cubic-bezier(.4,0,.2,1);}

/* ── TRANSACTIONS ── */
.tx-row{border-radius:12px;padding:11px 13px;transition:all .15s;border:1px solid transparent;display:flex;align-items:center;gap:12px;}
.tx-row:hover{background:rgba(255,255,255,0.05);border-color:var(--border);}

/* ── MISC ── */
.glow-text{background:var(--grad-main);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;}
.auto-badge{display:inline-flex;align-items:center;gap:3px;background:rgba(167,139,250,0.15);border:1px solid rgba(167,139,250,0.3);color:var(--purple);border-radius:20px;padding:3px 9px;font-size:11px;font-weight:700;}
.chip-icon{display:flex;align-items:center;justify-content:center;border-radius:12px;font-size:21px;flex-shrink:0;}
.stat-num{font-family:'Fraunces',serif;font-weight:700;}
.empty-state{padding:44px;text-align:center;color:var(--text3);}
.empty-state .empty-icon{font-size:42px;margin-bottom:12px;}
.sync-dot{width:8px;height:8px;border-radius:50%;background:var(--green);box-shadow:0 0 8px var(--green);animation:pulse 2s infinite;}
.sync-dot.saving{background:var(--yellow);box-shadow:0 0 8px var(--yellow);}
.sync-dot.error{background:var(--red);box-shadow:0 0 8px var(--red);}

/* ── MODAL ── */
.modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.72);backdrop-filter:blur(12px);display:flex;align-items:center;justify-content:center;z-index:2000;padding:16px;}
.modal-box{background:linear-gradient(145deg,#110f24,#1a1635);border:1px solid var(--border2);border-radius:var(--r-lg);padding:24px;width:100%;max-width:460px;max-height:92vh;overflow-y:auto;}

/* ── GRIDS ── */
.grid-2{display:grid;grid-template-columns:1fr 1fr;gap:10px;}
.grid-3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;}
.grid-4{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;}

/* ── ANIMATIONS ── */
@keyframes fadeUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
@keyframes fadeIn{from{opacity:0}to{opacity:1}}
@keyframes scaleIn{from{opacity:0;transform:scale(.96)}to{opacity:1;transform:scale(1)}}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}
@keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-5px)}}
@keyframes spin{to{transform:rotate(360deg)}}
.fade-up{animation:fadeUp .28s ease both;}
.fade-in{animation:fadeIn .2s ease both;}
.scale-in{animation:scaleIn .25s cubic-bezier(.34,1.56,.64,1) both;}
.stagger-1{animation-delay:.04s}.stagger-2{animation-delay:.08s}.stagger-3{animation-delay:.12s}.stagger-4{animation-delay:.16s}.stagger-5{animation-delay:.2s}
.float-icon{animation:float 3s ease-in-out infinite;}
.pulse-dot{animation:pulse 2s infinite;}
.spin{animation:spin .8s linear infinite;}

/* ── RECHARTS ── */
.rc-tooltip{background:#1a1635;border:1px solid rgba(255,255,255,0.15);border-radius:10px;padding:9px 13px;font-family:'Outfit',sans-serif;font-size:12px;color:var(--text);}

/* ── FILTER BAR ── */
.filter-bar{display:flex;gap:6px;overflow-x:auto;padding-bottom:2px;scrollbar-width:none;flex-wrap:nowrap;}
.filter-bar::-webkit-scrollbar{display:none;}
.filter-chip{padding:5px 12px;border-radius:20px;border:1px solid var(--border);background:var(--glass);color:var(--text2);cursor:pointer;font-size:11px;font-weight:600;white-space:nowrap;flex-shrink:0;transition:all .15s;}
.filter-chip.active{border-color:rgba(167,139,250,0.5);background:rgba(167,139,250,0.12);color:var(--purple);}
.filter-chip:hover:not(.active){background:var(--glass2);}

/* ── BOTTOM NAV ── */
.bottom-nav{display:none;}

/* ── RESPONSIVE ── */
@media(max-width:880px){
  .sidebar{transform:translateX(calc(-1 * var(--sw)));}
  .sidebar.open{transform:translateX(0);}
  .sidebar-overlay.open{display:block;}
  .main-area{margin-left:0 !important;}
  .content-grid{grid-template-columns:1fr !important;}
  .grid-4{grid-template-columns:1fr 1fr !important;}
  .page-content{
    padding:14px;
    padding-bottom:calc(68px + env(safe-area-inset-bottom));
    padding-left:calc(14px + env(safe-area-inset-left));
    padding-right:calc(14px + env(safe-area-inset-right));
  }
  .bottom-nav{
    display:flex;position:fixed;bottom:0;left:0;right:0;
    background:rgba(7,6,15,0.96);backdrop-filter:blur(20px);
    border-top:1px solid var(--border);
    justify-content:space-around;
    padding-top:5px;
    padding-bottom:calc(8px + env(safe-area-inset-bottom));
    padding-left:env(safe-area-inset-left);
    padding-right:env(safe-area-inset-right);
    z-index:250;
  }
  .bnav-item{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;padding:4px 10px;border-radius:10px;cursor:pointer;transition:all .18s;font-size:9px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.3px;min-width:50px;position:relative;}
  .bnav-item.active{color:var(--purple);background:rgba(167,139,250,0.1);}
  .bnav-icon{font-size:18px;}
  .topbar{
    padding-left:calc(16px + env(safe-area-inset-left));
    padding-right:calc(16px + env(safe-area-inset-right));
  }
}
@media(max-width:520px){
  .grid-2{grid-template-columns:1fr !important;}
  .grid-3{grid-template-columns:1fr 1fr !important;}
  .grid-4{grid-template-columns:1fr 1fr !important;}
}
`;

// ═══════════════════════════════════════════════════════════
//  AUTH SCREEN
// ═══════════════════════════════════════════════════════════
function AuthScreen({ onAuth }) {
  const [mode, setMode] = useState("login"); // login | register
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setError(""); setLoading(true);
    try {
      if (mode === "login") {
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        await createUserWithEmailAndPassword(auth, email, password);
      }
    } catch (e) {
      const msgs = {
        "auth/invalid-email": "Email invalide",
        "auth/user-not-found": "Compte introuvable",
        "auth/wrong-password": "Mot de passe incorrect",
        "auth/email-already-in-use": "Email déjà utilisé",
        "auth/weak-password": "Mot de passe trop court (6 car. min)",
        "auth/invalid-credential": "Email ou mot de passe incorrect",
      };
      setError(msgs[e.code] || e.message);
    }
    setLoading(false);
  };

  return (
    <div className="auth-shell">
      <style>{CSS}</style>
      <div className="auth-card scale-in">
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{ fontSize: 56, marginBottom: 10, animation: "float 3s ease-in-out infinite" }}>💑</div>
          <div className="glow-text" style={{ fontFamily: "'Fraunces',serif", fontSize: 32, fontWeight: 700 }}>DuoBudget</div>
          <div style={{ fontSize: 13, color: "var(--text3)", marginTop: 4 }}>Finance à deux · Synchronisé en temps réel</div>
        </div>

        <div style={{ display: "flex", gap: 6, marginBottom: 22, background: "rgba(255,255,255,0.04)", borderRadius: 12, padding: 4 }}>
          {[["login", "Se connecter"], ["register", "Créer un compte"]].map(([m, l]) => (
            <button key={m} onClick={() => { setMode(m); setError(""); }} style={{
              flex: 1, padding: "9px", borderRadius: 9, border: "none", cursor: "pointer",
              background: mode === m ? "var(--grad-main)" : "transparent",
              color: mode === m ? "white" : "var(--text3)",
              fontFamily: "'Outfit',sans-serif", fontWeight: 700, fontSize: 13, transition: "all .2s",
            }}>{l}</button>
          ))}
        </div>

        <div style={{ marginBottom: 12 }}>
          <label>Email</label>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)}
            placeholder="vous@email.com" onKeyDown={e => e.key === "Enter" && submit()} />
        </div>
        <div style={{ marginBottom: 20 }}>
          <label>Mot de passe</label>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)}
            placeholder="••••••••" onKeyDown={e => e.key === "Enter" && submit()} />
        </div>

        {error && (
          <div style={{ background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.3)", borderRadius: 10, padding: "10px 14px", marginBottom: 16, fontSize: 13, color: "var(--red)" }}>
            ⚠️ {error}
          </div>
        )}

        <button className="btn btn-primary" onClick={submit} disabled={loading || !email || !password}
          style={{ width: "100%", justifyContent: "center", padding: "13px", fontSize: 15 }}>
          {loading ? <span className="spin" style={{ display: "inline-block" }}>⟳</span> : mode === "login" ? "🔑 Se connecter" : "🚀 Créer mon compte"}
        </button>

        <div style={{ marginTop: 16, fontSize: 12, color: "var(--text3)", textAlign: "center" }}>
          🔒 Tes données sont chiffrées et privées
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
//  ROOT
// ═══════════════════════════════════════════════════════════
export default function App() {
  const [user, setUser] = useState(undefined); // undefined = loading
  const [data, setData] = useState(INIT);
  const [ready, setReady] = useState(false);
  const [syncStatus, setSyncStatus] = useState("synced"); // synced | saving | error
  const [page, setPage] = useState("dashboard");
  const [selMonth, setSelMonth] = useState(curMonthKey());
  const [modal, setModal] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const saveTimer = useRef(null);

  // Auth listener
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, u => setUser(u || null));
    return unsub;
  }, []);

  // Load data when user logs in + real-time listener
  useEffect(() => {
    if (!user) { setReady(false); return; }
    let unsub;
    firestoreLoad(user.uid).then(saved => {
      if (saved) {
        const { data: processed } = processDueBills(saved);
        setData(processed);
      }
      setReady(true);
      // Real-time sync: listen for changes from other devices
      unsub = onSnapshot(getDocRef(user.uid), snap => {
        if (snap.exists()) {
          const remote = snap.data().budget;
          setData(prev => {
            // Only update if remote is newer (avoid overwriting own saves)
            if (JSON.stringify(remote) !== JSON.stringify(prev)) {
              const { data: processed } = processDueBills(remote);
              return processed;
            }
            return prev;
          });
        }
      });
    });
    return () => unsub && unsub();
  }, [user]);

  // Debounced save to Firestore (500ms after last change)
  useEffect(() => {
    if (!ready || !user) return;
    setSyncStatus("saving");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await firestoreSave(user.uid, data);
        setSyncStatus("synced");
      } catch { setSyncStatus("error"); }
    }, 500);
    return () => clearTimeout(saveTimer.current);
  }, [data, ready, user]);

  // Process bills every 60s
  useEffect(() => {
    if (!ready) return;
    const t = setInterval(() => {
      setData(prev => {
        const { data: next, changed } = processDueBills(prev);
        return changed ? next : prev;
      });
    }, 60_000);
    return () => clearInterval(t);
  }, [ready]);

  const update = useCallback(fn => {
    setData(prev => {
      const next = JSON.parse(JSON.stringify(prev));
      fn(next);
      return next;
    });
  }, []);

  const allMonths = useMemo(() => {
    const keys = new Set([curMonthKey()]);
    Object.keys(data.monthsData).forEach(k => keys.add(k));
    for (let i = 0; i < 12; i++) {
      const d = new Date(); d.setMonth(d.getMonth() - i);
      keys.add(monthKey(d.getFullYear(), d.getMonth()));
    }
    return Array.from(keys).sort().reverse();
  }, [data.monthsData]);

  const mdata = useCallback((key = selMonth) => {
    const md = data.monthsData[key];
    if (!md) return { transactions: [], incomes: { p1: 0, p2: 0, common: 0 }, billsProcessed: {} };
    return md;
  }, [data.monthsData, selMonth]);

  // Loading auth state
  if (user === undefined) return (
    <div style={{ position: "fixed", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg)" }}>
      <style>{CSS}</style>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 52, marginBottom: 12, animation: "float 2s ease-in-out infinite" }}>💑</div>
        <div className="glow-text" style={{ fontFamily: "'Fraunces',serif", fontSize: 26 }}>Chargement…</div>
      </div>
    </div>
  );

  // Not logged in
  if (!user) return <AuthScreen />;

  // Loading data
  if (!ready) return (
    <div style={{ position: "fixed", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg)" }}>
      <style>{CSS}</style>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 52, marginBottom: 12, animation: "float 2s ease-in-out infinite" }}>☁️</div>
        <div className="glow-text" style={{ fontFamily: "'Fraunces',serif", fontSize: 22 }}>Synchronisation…</div>
        <div style={{ fontSize: 13, color: "var(--text3)", marginTop: 6 }}>{user.email}</div>
      </div>
    </div>
  );

  const isSetup = data.profiles.length >= 2;
  if (!isSetup) return (
    <>
      <style>{CSS}</style>
      <SetupScreen update={update} />
    </>
  );

  const unpaidBills = data.bills.filter(b => !b.paid?.[selMonth]).length;
  const navItems = [
    { id: "dashboard", icon: "🏠", label: "Accueil" },
    { id: "incomes",   icon: "💵", label: "Revenus" },
    { id: "expenses",  icon: "💳", label: "Dépenses" },
    { id: "bills",     icon: "📋", label: "Factures", badge: unpaidBills },
    { id: "stats",     icon: "📊", label: "Stats" },
    { id: "settings",  icon: "⚙️", label: "Réglages" },
  ];
  const navigate = id => { setPage(id); setSidebarOpen(false); };
  const pageTitles = { dashboard: "Tableau de bord", incomes: "Revenus", expenses: "Dépenses", bills: "Factures", stats: "Statistiques", settings: "Réglages" };

  const syncLabel = { synced: "Synchronisé ✓", saving: "Sauvegarde…", error: "Erreur sync !" };
  const syncColor = { synced: "var(--green)", saving: "var(--yellow)", error: "var(--red)" };

  return (
    <>
      <style>{CSS}</style>
      <div className="app-shell">
        <div className={`sidebar-overlay ${sidebarOpen ? "open" : ""}`} onClick={() => setSidebarOpen(false)} />

        {/* ── SIDEBAR ── */}
        <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
          <div style={{ padding: "18px 16px 14px", borderBottom: "1px solid var(--border)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 38, height: 38, borderRadius: 12, background: "var(--grad-main)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, boxShadow: "0 4px 14px rgba(167,139,250,0.4)", flexShrink: 0 }}>💑</div>
              <div>
                <div className="glow-text" style={{ fontFamily: "'Fraunces',serif", fontSize: 20, fontWeight: 700, lineHeight: 1 }}>DuoBudget</div>
                <div style={{ fontSize: 9, color: "var(--text3)", letterSpacing: 1, textTransform: "uppercase" }}>Finance à deux</div>
              </div>
            </div>
          </div>

          {/* Sync status */}
          <div style={{ padding: "8px 14px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 8 }}>
            <div className={`sync-dot ${syncStatus}`} />
            <span style={{ fontSize: 11, color: syncColor[syncStatus], fontWeight: 600 }}>{syncLabel[syncStatus]}</span>
          </div>

          <div style={{ padding: "10px 10px 6px" }}>
            <select value={selMonth} onChange={e => setSelMonth(e.target.value)} style={{ background: "rgba(167,139,250,0.1)", border: "1px solid rgba(167,139,250,0.25)", borderRadius: 9, color: "var(--text)", padding: "7px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer", width: "100%" }}>
              {allMonths.map(k => <option key={k} value={k}>{monthLabel(k)}</option>)}
            </select>
          </div>

          <nav style={{ flex: 1, paddingTop: 4, overflowY: "auto" }}>
            <div className="nav-section-label">Navigation</div>
            {navItems.slice(0, 5).map(n => (
              <div key={n.id} className={`nav-item ${page === n.id ? "active" : ""}`} onClick={() => navigate(n.id)}>
                <span className="nav-icon">{n.icon}</span>
                <span>{n.label}</span>
                {n.badge > 0 && <span className="nav-badge">{n.badge}</span>}
              </div>
            ))}
            <div className="nav-section-label" style={{ marginTop: 10 }}>Système</div>
            <div className={`nav-item ${page === "settings" ? "active" : ""}`} onClick={() => navigate("settings")}>
              <span className="nav-icon">⚙️</span><span>Réglages</span>
            </div>
          </nav>

          {/* Profile footer + logout */}
          <div style={{ padding: "10px", borderTop: "1px solid var(--border)" }}>
            <div style={{ display: "flex", gap: 5, marginBottom: 8 }}>
              {data.profiles.filter(p => p.id !== "common").map(p => (
                <div key={p.id} style={{ flex: 1, textAlign: "center", padding: "7px 4px", borderRadius: 9, background: `${p.color}12`, border: `1px solid ${p.color}25` }}>
                  <div style={{ fontSize: 20, marginBottom: 2 }}>{p.avatar}</div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: p.color, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
                </div>
              ))}
            </div>
            <button onClick={() => signOut(auth)} style={{ width: "100%", background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.2)", borderRadius: 9, color: "var(--red)", cursor: "pointer", fontSize: 12, fontWeight: 600, padding: "7px", fontFamily: "'Outfit',sans-serif" }}>
              🚪 Déconnexion
            </button>
          </div>
        </aside>

        {/* ── MAIN ── */}
        <div className="main-area">
          <div className="topbar">
            <button className="menu-btn" onClick={() => setSidebarOpen(o => !o)}>☰</button>
            <div style={{ fontFamily: "'Fraunces',serif", fontSize: 20, fontWeight: 700, color: "var(--text2)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {pageTitles[page]}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
              {page === "expenses" && <button className="btn btn-primary btn-sm" onClick={() => setModal({ type: "addTransaction", selMonth })}>+ Dépense</button>}
              {page === "bills"    && <button className="btn btn-primary btn-sm" onClick={() => setModal({ type: "addBill" })}>+ Facture</button>}
              {page === "incomes"  && <button className="btn btn-primary btn-sm" onClick={() => setModal({ type: "addRecurringIncome" })}>+ Récurrent</button>}
              {/* Sync dot in topbar (mobile) */}
              <div className={`sync-dot ${syncStatus}`} title={syncLabel[syncStatus]} />
              <div style={{ fontSize: 11, color: "var(--text3)", background: "var(--glass)", border: "1px solid var(--border)", borderRadius: 8, padding: "5px 10px", whiteSpace: "nowrap" }}>
                {new Date().toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" })}
              </div>
            </div>
          </div>

          <div className="page-content">
            {page === "dashboard" && <Dashboard data={data} update={update} selMonth={selMonth} mdata={mdata} setModal={setModal} allMonths={allMonths} />}
            {page === "incomes"   && <Incomes   data={data} update={update} selMonth={selMonth} mdata={mdata} setModal={setModal} />}
            {page === "expenses"  && <Expenses  data={data} update={update} selMonth={selMonth} mdata={mdata} setModal={setModal} />}
            {page === "bills"     && <Bills     data={data} update={update} selMonth={selMonth} mdata={mdata} setModal={setModal} />}
            {page === "stats"     && <Stats     data={data} selMonth={selMonth} mdata={mdata} allMonths={allMonths} />}
            {page === "settings"  && <SettingsPage data={data} update={update} setModal={setModal} user={user} />}
          </div>
        </div>

        {/* ── BOTTOM NAV ── */}
        <nav className="bottom-nav">
          {navItems.map(n => (
            <div key={n.id} className={`bnav-item ${page === n.id ? "active" : ""}`} onClick={() => navigate(n.id)}>
              <span className="bnav-icon">{n.icon}</span>
              <span>{n.label}</span>
              {n.badge > 0 && <span style={{ position: "absolute", top: 2, right: 4, background: "var(--red)", color: "white", borderRadius: 10, padding: "0 4px", fontSize: 9, fontWeight: 800 }}>{n.badge}</span>}
            </div>
          ))}
        </nav>

        {modal && <ModalRouter modal={modal} setModal={setModal} data={data} update={update} selMonth={selMonth} />}
      </div>
    </>
  );
}

// ─── Paste all your existing components below unchanged ───
// SetupScreen, Dashboard, Incomes, Expenses, Bills, Stats,
// SettingsPage, BillRow, ModalRouter, ModalWrap,
// IncomeModal, AddTxModal, AddBillModal, EditProfileModal,
// AddRecurringIncomeModal
// ─────────────────────────────────────────────────────────

function SetupScreen({update}){
  const [p1,setP1]=useState({name:"",avatar:"😊"});
  const [p2,setP2]=useState({name:"",avatar:"🥰"});
  const go=()=>{
    if(!p1.name.trim()||!p2.name.trim())return;
    update(d=>{
      d.profiles=[
        {id:"p1",name:p1.name.trim(),avatar:p1.avatar,color:"#a78bfa"},
        {id:"p2",name:p2.name.trim(),avatar:p2.avatar,color:"#f472b6"},
        {id:"common",name:"Compte commun",avatar:"🏦",color:"#60a5fa"},
      ];
    });
  };
  return(
    <div style={{position:"fixed",inset:0,display:"flex",alignItems:"center",justifyContent:"center",padding:24,background:`radial-gradient(ellipse 80% 60% at 50% 0%,rgba(167,139,250,0.2),transparent 70%),var(--bg)`}}>
      <div style={{maxWidth:700,width:"100%",textAlign:"center"}} className="fade-up">
        <div style={{fontSize:64,marginBottom:10,animation:"float 3s ease-in-out infinite"}}>💑</div>
        <h1 style={{fontFamily:"'Fraunces',serif",fontSize:44,marginBottom:8}} className="glow-text">DuoBudget</h1>
        <p style={{color:"var(--text2)",marginBottom:36,fontSize:15}}>Créez vos profils pour commencer</p>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:24}}>
          <div className="glass" style={{padding:24,borderRadius:20}}><ProfileSetup label="Profil 1" emoji="💜" color="#a78bfa" value={p1} onChange={setP1}/></div>
          <div className="glass" style={{padding:24,borderRadius:20}}><ProfileSetup label="Profil 2" emoji="🩷" color="#f472b6" value={p2} onChange={setP2}/></div>
        </div>
        <button className="btn btn-primary" onClick={go} disabled={!p1.name.trim()||!p2.name.trim()} style={{padding:"13px 48px",fontSize:15,opacity:(!p1.name.trim()||!p2.name.trim())?0.4:1}}>
          🚀 Commencer l'aventure
        </button>
      </div>
    </div>
  );
}
function ProfileSetup({label,emoji,color,value,onChange}){
  return(
    <div>
      <div style={{fontWeight:700,fontSize:14,marginBottom:12,color}}>{emoji} {label}</div>
      <div style={{fontSize:52,marginBottom:12}}>{value.avatar}</div>
      <input value={value.name} onChange={e=>onChange(v=>({...v,name:e.target.value}))} placeholder="Ton prénom…" style={{marginBottom:12,textAlign:"center",fontSize:15}}/>
      <div style={{display:"flex",flexWrap:"wrap",gap:5,justifyContent:"center"}}>
        {AVATARS.map(a=>(
          <button key={a} onClick={()=>onChange(v=>({...v,avatar:a}))} style={{fontSize:18,background:value.avatar===a?`${color}25`:"rgba(255,255,255,0.05)",border:`2px solid ${value.avatar===a?color:"transparent"}`,borderRadius:9,width:38,height:38,cursor:"pointer",transition:"all .15s"}}>{a}</button>
        ))}
      </div>
    </div>
  );
}

function Dashboard({data,update,selMonth,mdata,setModal,allMonths}){
  const md=mdata(selMonth);
  const {incomes,transactions}=md;
  const totalIncome=useMemo(()=>(incomes.p1||0)+(incomes.p2||0)+(incomes.common||0),[incomes]);
  const totalExp=useMemo(()=>transactions.reduce((s,t)=>s+t.amount,0),[transactions]);
  const balance=totalIncome-totalExp;
  const pct=totalIncome>0?Math.min(100,(totalExp/totalIncome)*100):0;
  const catMap=useMemo(()=>Object.fromEntries(data.categories.map(c=>[c.id,c])),[data.categories]);
  const profMap=useMemo(()=>Object.fromEntries(data.profiles.map(p=>[p.id,p])),[data.profiles]);
  const catTotals=useMemo(()=>{const m={};transactions.forEach(t=>{m[t.categoryId]=(m[t.categoryId]||0)+t.amount;});return m;},[transactions]);
  const topCats=useMemo(()=>Object.entries(catTotals).sort((a,b)=>b[1]-a[1]).slice(0,6),[catTotals]);
  const isPos=balance>=0;
  const unpaid=data.bills.filter(b=>!b.paid?.[selMonth]);
  const paid=data.bills.filter(b=>b.paid?.[selMonth]);
  const pieData=useMemo(()=>topCats.map(([cid,val])=>({name:(catMap[cid]?.icon||"")+" "+(catMap[cid]?.name||cid),value:val,color:catMap[cid]?.color||"#888"})),[topCats,catMap]);
  const PT=({active,payload})=>{if(!active||!payload?.length)return null;const d=payload[0];return <div className="rc-tooltip"><div style={{fontWeight:700}}>{d.name}</div><div style={{color:d.payload.color}}>{fmt(d.value)}</div></div>;};
  return(
    <div className="fade-up">
      <div style={{display:"flex",gap:14,marginBottom:22}}>
        {data.profiles.map((p,i)=>{
          const inc=incomes[p.id]||0;
          const spent=transactions.filter(t=>t.profileId===p.id).reduce((s,t)=>s+t.amount,0);
          return(
            <div key={p.id} className={`card glass-hover stagger-${i+1} fade-up`} style={{flex:1,display:"flex",alignItems:"center",gap:16,position:"relative",cursor:"default"}}>
              <div style={{position:"absolute",top:12,right:12,width:8,height:8,borderRadius:"50%",background:p.color,boxShadow:`0 0 8px ${p.color}`}} className="pulse-dot"/>
              <div style={{width:56,height:56,borderRadius:16,background:`${p.color}18`,border:`1px solid ${p.color}30`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:28,flexShrink:0}} className="float-icon">{p.avatar}</div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontWeight:700,fontSize:16}}>{p.name}</div>
                <div style={{fontSize:11,color:"var(--text3)",textTransform:"uppercase",letterSpacing:.5}}>{p.id==="common"?"Commun":"Revenu"}</div>
                <div style={{fontSize:20,fontWeight:800,color:inc>0?"var(--green)":"var(--text3)",marginTop:3}}>{inc>0?`+${fmt(inc)}`:"—"}</div>
                {p.id!=="common"&&inc>0&&<div style={{fontSize:12,color:"var(--text3)"}}>dép. {fmt(spent)}</div>}
              </div>
              <button onClick={()=>setModal({type:"editIncome",profileId:p.id,selMonth})} className="btn-icon" style={{position:"absolute",bottom:10,right:10}}>✏️</button>
            </div>
          );
        })}
      </div>
      <div className="content-grid">
        <div style={{display:"flex",flexDirection:"column",gap:16}}>
          <div className="card" style={{position:"relative",overflow:"hidden",borderColor:isPos?"rgba(74,222,128,0.2)":"rgba(248,113,113,0.2)"}}>
            <div style={{position:"absolute",inset:0,background:isPos?"radial-gradient(ellipse 80% 60% at 50% -20%,rgba(74,222,128,0.09),transparent)":"radial-gradient(ellipse 80% 60% at 50% -20%,rgba(248,113,113,0.09),transparent)",pointerEvents:"none"}}/>
            <div style={{fontSize:12,color:"var(--text3)",textTransform:"uppercase",letterSpacing:1.5,textAlign:"center",marginBottom:12}}>Reste à vivre — {monthLabel(selMonth)}</div>
            <div className="stat-num" style={{fontSize:68,textAlign:"center",color:isPos?"var(--green)":"var(--red)",textShadow:`0 0 40px ${isPos?"rgba(74,222,128,0.35)":"rgba(248,113,113,0.35)"}`,marginBottom:20,lineHeight:1}}>{fmt(balance)}</div>
            <div style={{display:"flex",justifyContent:"center",gap:32,marginBottom:16}}>
              <div style={{textAlign:"center"}}>
                <div style={{fontSize:12,color:"var(--text3)",marginBottom:4}}>💵 Revenus</div>
                <div style={{fontSize:22,fontWeight:800,color:"var(--green)"}}>+{fmt(totalIncome)}</div>
              </div>
              <div style={{width:1,background:"var(--border)"}}/>
              <div style={{textAlign:"center"}}>
                <div style={{fontSize:12,color:"var(--text3)",marginBottom:4}}>💸 Dépenses</div>
                <div style={{fontSize:22,fontWeight:800,color:"var(--red)"}}>-{fmt(totalExp)}</div>
              </div>
            </div>
            {totalIncome>0&&(<><div style={{display:"flex",justifyContent:"space-between",fontSize:13,color:"var(--text3)",marginBottom:6}}><span>Budget utilisé</span><span style={{fontWeight:700,color:pct>80?"var(--red)":pct>60?"var(--orange)":"var(--green)"}}>{Math.round(pct)}%</span></div><div className="progress-track" style={{height:10}}><div className="progress-fill" style={{width:`${pct}%`,background:pct>80?"var(--grad-red)":pct>60?"linear-gradient(90deg,var(--yellow),var(--orange))":"var(--grad-green)"}}/></div></>)}
          </div>
          <div className="card">
            <div style={{fontWeight:700,fontSize:15,marginBottom:16,display:"flex",alignItems:"center",gap:7}}><span>📊</span> Répartition des dépenses</div>
            {topCats.length===0?<div className="empty-state"><div className="empty-icon">📊</div>Aucune dépense ce mois</div>:(
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"12px 24px"}}>
                {topCats.map(([cid,amt])=>{const cat=catMap[cid]||{icon:"❓",name:cid,color:"#888"};const p=totalExp>0?(amt/totalExp)*100:0;return(<div key={cid}><div style={{display:"flex",justifyContent:"space-between",marginBottom:5,fontSize:13}}><span style={{display:"flex",alignItems:"center",gap:6,overflow:"hidden"}}><span>{cat.icon}</span><span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{cat.name}</span></span><span style={{fontWeight:700,flexShrink:0,marginLeft:8}}>{fmt(amt)}</span></div><div className="progress-track" style={{height:6}}><div className="progress-fill" style={{width:`${p}%`,background:cat.color}}/></div></div>);})}
              </div>
            )}
          </div>
          <div className="card">
            <div style={{fontWeight:700,fontSize:15,marginBottom:14,display:"flex",alignItems:"center",justifyContent:"space-between"}}><span style={{display:"flex",alignItems:"center",gap:6}}><span>🕐</span> Dernières transactions</span>{transactions.length>0&&<span style={{fontSize:12,color:"var(--text3)"}}>{transactions.length} au total</span>}</div>
            {transactions.length===0?<div className="empty-state"><div className="empty-icon">💸</div>Aucune transaction</div>:
            [...transactions].sort((a,b)=>new Date(b.timestamp)-new Date(a.timestamp)).slice(0,6).map(tx=>{
              const cat=catMap[tx.categoryId]||{icon:"❓",color:"#888"};const prof=profMap[tx.profileId]||{avatar:"❓"};
              return(<div key={tx.id} className="tx-row"><div className="chip-icon" style={{width:44,height:44,background:`${cat.color}18`,border:`1px solid ${cat.color}22`,fontSize:21}}>{cat.icon}</div><div style={{flex:1,minWidth:0}}><div style={{fontSize:15,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{tx.label}</div><div style={{fontSize:12,color:"var(--text3)"}}>{prof.avatar} · {fmtDT(tx.timestamp)}</div></div>{tx.auto&&<span className="auto-badge">🤖</span>}<div style={{fontWeight:800,fontSize:15,color:"var(--red)",flexShrink:0}}>-{fmt(tx.amount)}</div></div>);
            })}
          </div>
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:16}}>
          {pieData.length>0&&(
            <div className="card">
              <div style={{fontWeight:700,fontSize:15,marginBottom:12}}>🥧 Vue circulaire</div>
              <ResponsiveContainer width="100%" height={200}><PieChart><Pie data={pieData} cx="50%" cy="50%" innerRadius={55} outerRadius={88} paddingAngle={2} dataKey="value">{pieData.map((e,i)=><Cell key={i} fill={e.color} stroke="transparent"/>)}</Pie><Tooltip content={<PT/>}/></PieChart></ResponsiveContainer>
              <div style={{display:"flex",flexWrap:"wrap",gap:7,marginTop:6}}>{pieData.slice(0,6).map((d,i)=><div key={i} style={{display:"flex",alignItems:"center",gap:5,fontSize:12}}><div style={{width:9,height:9,borderRadius:2,background:d.color}}/><span style={{color:"var(--text3)"}}>{d.name}</span></div>)}</div>
            </div>
          )}
          <div className="card">
            <div style={{fontWeight:700,fontSize:15,marginBottom:14,display:"flex",alignItems:"center",gap:7}}><span>📋</span> Factures — {monthLabel(selMonth)}</div>
            {data.bills.length===0?<div className="empty-state"><div className="empty-icon">📋</div>Aucune facture</div>:(
              <>
                <div style={{display:"flex",gap:10,marginBottom:14}}>
                  {[{v:paid.length,l:"Payées",bg:"rgba(74,222,128,0.08)",c:"var(--green)"},{v:unpaid.length,l:"En attente",bg:"rgba(251,191,36,0.08)",c:"var(--yellow)"},{v:fmt(unpaid.reduce((s,b)=>s+(b.amount||0),0)),l:"Restant",bg:"rgba(248,113,113,0.08)",c:"var(--red)"}].map(s=>(
                    <div key={s.l} style={{flex:1,textAlign:"center",background:s.bg,borderRadius:12,padding:"12px 6px"}}><div className="stat-num" style={{fontSize:typeof s.v==="number"?28:18,color:s.c,marginBottom:3}}>{s.v}</div><div style={{fontSize:12,color:"var(--text3)"}}>{s.l}</div></div>
                  ))}
                </div>
                <div className="progress-track" style={{height:8,marginBottom:12}}><div className="progress-fill" style={{width:`${data.bills.length?(paid.length/data.bills.length)*100:0}%`,background:"var(--grad-green)"}}/></div>
                {unpaid.slice(0,3).map(b=><div key={b.id} className="tx-row" style={{padding:"8px 10px",marginBottom:4}}><span style={{fontSize:20}}>{b.icon||"📋"}</span><span style={{flex:1,fontSize:13,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{b.name}</span>{b.amount>0&&<span style={{color:"var(--orange)",fontWeight:700,fontSize:13}}>-{fmt(b.amount)}</span>}</div>)}
              </>
            )}
          </div>
          <div className="card">
            <div style={{fontWeight:700,fontSize:15,marginBottom:14}}>⚡ Stats rapides</div>
            <div style={{display:"flex",flexDirection:"column",gap:9}}>
              {[{label:"Tx. moy./jour",val:fmt(totalExp/new Date().getDate()),icon:"📅"},{label:"Plus grosse dép.",val:transactions.length?fmt(Math.max(...transactions.map(t=>t.amount))):"—",icon:"🔺"},{label:"Nb. transactions",val:transactions.length,icon:"🧾"}].map(s=>(
                <div key={s.label} style={{display:"flex",alignItems:"center",gap:12,padding:"11px 14px",background:"rgba(255,255,255,0.03)",borderRadius:12}}>
                  <span style={{fontSize:22}}>{s.icon}</span><span style={{flex:1,fontSize:14,color:"var(--text2)"}}>{s.label}</span><span style={{fontWeight:800,fontSize:15}}>{s.val}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Incomes({data,update,selMonth,mdata,setModal}){
  const md=mdata(selMonth);const {incomes}=md;
  const totalInc=(incomes.p1||0)+(incomes.p2||0)+(incomes.common||0);
  const totalExp=md.transactions.reduce((s,t)=>s+t.amount,0);
  return(
    <div className="fade-up content-grid">
      <div style={{display:"flex",flexDirection:"column",gap:14}}>
        <div style={{fontWeight:700,fontSize:13,color:"var(--text3)",textTransform:"uppercase",letterSpacing:1}}>Revenus — {monthLabel(selMonth)}</div>
        {data.profiles.map((p,i)=>{
          const inc=incomes[p.id]||0;
          return(<div key={p.id} className={`card glass-hover fade-up stagger-${i+1}`} style={{display:"flex",alignItems:"center",gap:16}}>
            <div style={{width:54,height:54,borderRadius:16,background:`${p.color}18`,border:`1px solid ${p.color}30`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:28,flexShrink:0}}>{p.avatar}</div>
            <div style={{flex:1}}>
              <div style={{fontWeight:700,fontSize:15}}>{p.name}</div>
              <div style={{fontSize:11,color:"var(--text3)",textTransform:"uppercase",letterSpacing:.5}}>{p.id==="common"?"Compte commun":"Revenu mensuel"}</div>
              {inc>0&&<div className="progress-track" style={{height:4,marginTop:8,maxWidth:200}}><div className="progress-fill" style={{width:`${totalInc>0?(inc/totalInc)*100:0}%`,background:p.color}}/></div>}
            </div>
            <div style={{textAlign:"right"}}>
              <div className="stat-num" style={{fontSize:22,color:inc>0?"var(--green)":"var(--text3)"}}>{inc>0?`+${fmt(inc)}`:"—"}</div>
              {totalInc>0&&inc>0&&<div style={{fontSize:11,color:"var(--text3)"}}>{Math.round((inc/totalInc)*100)}%</div>}
            </div>
            <button className="btn-icon" onClick={()=>setModal({type:"editIncome",profileId:p.id,selMonth})}>✏️</button>
          </div>);
        })}
        {data.recurringIncomes?.length>0&&(
          <div className="card">
            <div style={{fontWeight:700,fontSize:13,marginBottom:12}}>🔄 Revenus récurrents</div>
            {data.recurringIncomes.map(ri=>{const prof=data.profiles.find(p=>p.id===ri.profileId);return(<div key={ri.id} style={{display:"flex",alignItems:"center",gap:12,padding:"10px 0",borderBottom:"1px solid var(--border)"}}><span style={{fontSize:26}}>{prof?.avatar||"❓"}</span><div style={{flex:1}}><div style={{fontWeight:600,fontSize:13}}>{prof?.name}</div><div style={{fontSize:11,color:"var(--text3)"}}>Depuis {fmtDate(ri.startDate)} · Mensuel</div></div><div style={{fontWeight:800,color:"var(--green)",fontSize:15}}>+{fmt(ri.amount)}</div><button className="btn-icon" style={{color:"var(--red)",background:"rgba(248,113,113,0.08)"}} onClick={()=>update(d=>{d.recurringIncomes=d.recurringIncomes.filter(r=>r.id!==ri.id)})}>🗑</button></div>);})}
          </div>
        )}
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:14}}>
        <div className="card">
          <div style={{fontWeight:700,fontSize:13,marginBottom:14}}>📊 Récapitulatif</div>
          {[{label:"Total revenus",val:`+${fmt(totalInc)}`,color:"var(--green)",icon:"💵"},{label:"Total dépenses",val:`-${fmt(totalExp)}`,color:"var(--red)",icon:"💸"},{label:"Reste à vivre",val:fmt(totalInc-totalExp),color:totalInc>=totalExp?"var(--green)":"var(--red)",icon:"⚖️"},{label:"Taux d'épargne",val:totalInc>0?`${Math.round(((totalInc-totalExp)/totalInc)*100)}%`:"—",color:"var(--purple)",icon:"💹"}].map(s=>(
            <div key={s.label} style={{display:"flex",alignItems:"center",gap:12,padding:"11px 0",borderBottom:"1px solid var(--border)"}}><span style={{fontSize:20}}>{s.icon}</span><span style={{flex:1,fontSize:13,color:"var(--text2)"}}>{s.label}</span><span style={{fontWeight:800,fontSize:15,color:s.color}}>{s.val}</span></div>
          ))}
        </div>
        <div className="card" style={{textAlign:"center",padding:28}}>
          <div style={{fontSize:42,marginBottom:10}}>🔄</div>
          <div style={{fontWeight:700,marginBottom:6}}>Revenus récurrents</div>
          <div style={{fontSize:12,color:"var(--text2)",marginBottom:16}}>Configurez un revenu mensuel automatique</div>
          <button className="btn btn-primary" style={{width:"100%"}} onClick={()=>setModal({type:"addRecurringIncome"})}>+ Ajouter un revenu récurrent</button>
        </div>
      </div>
    </div>
  );
}

function Expenses({data,update,selMonth,mdata,setModal}){
  const md=mdata(selMonth);const {transactions}=md;
  const [filter,setFilter]=useState("all");
  const catMap=useMemo(()=>Object.fromEntries(data.categories.map(c=>[c.id,c])),[data.categories]);
  const profMap=useMemo(()=>Object.fromEntries(data.profiles.map(p=>[p.id,p])),[data.profiles]);
  const filtered=useMemo(()=>filter==="all"?transactions:transactions.filter(t=>t.profileId===filter||t.categoryId===filter),[transactions,filter]);
  const sorted=useMemo(()=>[...filtered].sort((a,b)=>new Date(b.timestamp)-new Date(a.timestamp)),[filtered]);
  const total=useMemo(()=>sorted.reduce((s,t)=>s+t.amount,0),[sorted]);
  const del=id=>update(d=>{ensureMonth(d,selMonth);d.monthsData[selMonth].transactions=d.monthsData[selMonth].transactions.filter(t=>t.id!==id);});
  return(
    <div className="fade-up">
      <div className="filter-bar" style={{marginBottom:14}}>
        {[{id:"all",label:"Tout"},...data.profiles.map(p=>({id:p.id,label:`${p.avatar} ${p.name}`})),...data.categories.map(c=>({id:c.id,label:`${c.icon} ${c.name}`}))].map(f=>(
          <div key={f.id} className={`filter-chip ${filter===f.id?"active":""}`} onClick={()=>setFilter(f.id)}>{f.label}</div>
        ))}
      </div>
      <div className="card-sm" style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
        <span style={{fontSize:13,color:"var(--text2)"}}>{sorted.length} transaction{sorted.length!==1?"s":""}</span>
        <span style={{fontWeight:800,fontSize:18,color:"var(--red)"}}>-{fmt(total)}</span>
      </div>
      {sorted.length===0?<div className="card empty-state"><div className="empty-icon">💸</div>Aucune dépense</div>:(
        <div className="card" style={{padding:8}}>
          {sorted.map(tx=>{const cat=catMap[tx.categoryId]||{icon:"❓",color:"#888",name:"Autre"};const prof=profMap[tx.profileId]||{avatar:"❓",name:"?"};
            return(<div key={tx.id} className="tx-row"><div className="chip-icon" style={{width:44,height:44,background:`${cat.color}18`,border:`1px solid ${cat.color}25`,fontSize:21}}>{cat.icon}</div><div style={{flex:1,minWidth:0}}><div style={{fontWeight:600,fontSize:14,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{tx.label}</div><div style={{fontSize:12,color:"var(--text3)",display:"flex",gap:8,marginTop:2}}><span>{prof.avatar} {prof.name}</span><span style={{color:cat.color}}>· {cat.icon} {cat.name}</span><span>· {fmtDT(tx.timestamp)}</span></div></div>{tx.auto&&<span className="auto-badge">🤖</span>}<div style={{fontWeight:800,fontSize:14,color:"var(--red)",flexShrink:0,marginRight:8}}>-{fmt(tx.amount)}</div><button className="btn-icon" onClick={()=>del(tx.id)} style={{color:"var(--red)",background:"rgba(248,113,113,0.08)",borderColor:"rgba(248,113,113,0.2)"}}>🗑</button></div>);
          })}
        </div>
      )}
    </div>
  );
}

function Bills({data,update,selMonth,mdata,setModal}){
  const toggle=billId=>{update(d=>{const bill=d.bills.find(b=>b.id===billId);if(!bill)return;if(!bill.paid)bill.paid={};const wasPaid=bill.paid[selMonth];bill.paid[selMonth]=!wasPaid;ensureMonth(d,selMonth);if(!wasPaid){d.monthsData[selMonth].transactions.push({id:mkid(),label:bill.name,amount:bill.amount||0,categoryId:bill.categoryId||"c7",profileId:bill.profileId||"common",timestamp:nowISO(),fromBill:billId});}else{d.monthsData[selMonth].transactions=d.monthsData[selMonth].transactions.filter(t=>t.fromBill!==billId);}});};
  const del=id=>update(d=>{d.bills=d.bills.filter(b=>b.id!==id);});
  const unpaid=useMemo(()=>data.bills.filter(b=>!b.paid?.[selMonth]),[data.bills,selMonth]);
  const paid=useMemo(()=>data.bills.filter(b=>b.paid?.[selMonth]),[data.bills,selMonth]);
  const totalUnpaid=useMemo(()=>unpaid.reduce((s,b)=>s+(b.amount||0),0),[unpaid]);
  return(
    <div className="fade-up content-grid">
      <div>
        {data.bills.length===0?<div className="card empty-state"><div className="empty-icon">📋</div>Aucune facture configurée</div>:(
          <>
            {unpaid.length>0&&<div style={{marginBottom:18}}><div style={{fontSize:11,color:"var(--text3)",textTransform:"uppercase",letterSpacing:1,marginBottom:8}}>⏳ En attente ({unpaid.length})</div>{unpaid.map((b,i)=><BillRow key={b.id} bill={b} selMonth={selMonth} onToggle={toggle} onDelete={del} profiles={data.profiles} idx={i}/>)}</div>}
            {paid.length>0&&<div><div style={{fontSize:11,color:"var(--text3)",textTransform:"uppercase",letterSpacing:1,marginBottom:8}}>✅ Réglées ({paid.length})</div>{paid.map((b,i)=><BillRow key={b.id} bill={b} selMonth={selMonth} onToggle={toggle} onDelete={del} profiles={data.profiles} idx={i}/>)}</div>}
          </>
        )}
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:14}}>
        <div className="card">
          <div style={{fontWeight:700,fontSize:13,marginBottom:14}}>📊 Progression — {monthLabel(selMonth)}</div>
          <div style={{display:"flex",gap:10,marginBottom:14}}>
            {[{l:"Payées",v:paid.length,c:"var(--green)",bg:"rgba(74,222,128,0.08)"},{l:"En attente",v:unpaid.length,c:"var(--yellow)",bg:"rgba(251,191,36,0.08)"}].map(s=>(
              <div key={s.l} style={{flex:1,textAlign:"center",background:s.bg,borderRadius:12,padding:"12px 6px"}}><div className="stat-num" style={{fontSize:28,color:s.c}}>{s.v}</div><div style={{fontSize:11,color:"var(--text3)"}}>{s.l}</div></div>
            ))}
          </div>
          <div className="progress-track" style={{height:10,marginBottom:10}}><div className="progress-fill" style={{width:data.bills.length?`${(paid.length/data.bills.length)*100}%`:"0%",background:"var(--grad-green)"}}/></div>
          <div style={{display:"flex",justifyContent:"space-between",fontSize:12,color:"var(--text3)"}}><span>{data.bills.length} factures</span><span style={{color:"var(--red)",fontWeight:700}}>{totalUnpaid>0?`-${fmt(totalUnpaid)} restant`:"🎉 Tout payé !"}</span></div>
        </div>
        <div className="card" style={{textAlign:"center",padding:28}}>
          <div style={{fontSize:42,marginBottom:10}}>📋</div>
          <div style={{fontWeight:700,marginBottom:6}}>Nouvelle facture</div>
          <div style={{fontSize:12,color:"var(--text2)",marginBottom:16}}>Ajoutez vos charges fixes récurrentes</div>
          <button className="btn btn-primary" style={{width:"100%"}} onClick={()=>setModal({type:"addBill"})}>+ Créer une facture</button>
        </div>
      </div>
    </div>
  );
}

function BillRow({bill,selMonth,onToggle,onDelete,profiles,idx}){
  const isPaid = bill.paid?.[selMonth];
  const prof = profiles.find(p => p.id === bill.profileId);
  const dueDate = bill.dueDate ? new Date(bill.dueDate) : null;
  const isOverdue = dueDate && dueDate < new Date() && !isPaid;

  // Horodatage complet avec secondes
  const fmtFull = iso => {
    if (!iso) return "—";
    const d = new Date(iso);
    return d.toLocaleDateString("fr-FR", { day:"2-digit", month:"long", year:"numeric" })
      + " à " + d.toLocaleTimeString("fr-FR", { hour:"2-digit", minute:"2-digit", second:"2-digit" });
  };

  // Couleurs selon statut
  const statusColor = isPaid ? "var(--green)" : isOverdue ? "var(--red)" : "var(--yellow)";
  const statusBg    = isPaid ? "rgba(74,222,128,0.08)" : isOverdue ? "rgba(248,113,113,0.08)" : "rgba(251,191,36,0.06)";
  const statusBorder= isPaid ? "rgba(74,222,128,0.25)" : isOverdue ? "rgba(248,113,113,0.35)" : "rgba(251,191,36,0.2)";
  const statusLabel = isPaid ? "✅ Payée" : isOverdue ? "⚠️ En retard" : "⏳ En attente";

  return (
    <div className={`fade-up stagger-${(idx%5)+1}`} style={{
      marginBottom: 14,
      background: "var(--glass)",
      border: `1px solid ${statusBorder}`,
      borderRadius: 18,
      overflow: "hidden",
      opacity: isPaid ? 0.75 : 1,
      transition: "all .2s",
    }}>
      {/* ── Bande de statut colorée en haut ── */}
      <div style={{
        height: 4,
        background: `linear-gradient(90deg, ${statusColor}, transparent)`,
      }}/>

      <div style={{ padding: "16px 18px" }}>
        {/* ── Ligne 1 : icône + nom + badge statut ── */}
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 12 }}>
          {/* Icône */}
          <div style={{
            width: 52, height: 52, borderRadius: 14, flexShrink: 0,
            background: statusBg, border: `1px solid ${statusBorder}`,
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26,
          }}>{bill.icon || "📋"}</div>

          {/* Nom + badge */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontWeight: 800, fontSize: 18,
              textDecoration: isPaid ? "line-through" : "none",
              color: isPaid ? "var(--text3)" : "var(--text)",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              marginBottom: 4,
            }}>{bill.name}</div>

            {/* Badge statut */}
            <span style={{
              display: "inline-flex", alignItems: "center", gap: 5,
              background: statusBg, border: `1px solid ${statusBorder}`,
              color: statusColor, borderRadius: 20, padding: "3px 10px",
              fontSize: 12, fontWeight: 700,
            }}>{statusLabel}</span>
            {bill.recurring && (
              <span style={{
                marginLeft: 6, display: "inline-flex", alignItems: "center", gap: 4,
                background: "rgba(167,139,250,0.12)", border: "1px solid rgba(167,139,250,0.3)",
                color: "var(--purple)", borderRadius: 20, padding: "3px 10px",
                fontSize: 12, fontWeight: 700,
              }}>🔄 Récurrent</span>
            )}
          </div>

          {/* Montant */}
          {bill.amount > 0 && (
            <div style={{
              fontFamily: "'Fraunces',serif", fontWeight: 800,
              fontSize: 22, color: isOverdue ? "var(--red)" : "var(--text)",
              flexShrink: 0,
            }}>-{fmt(bill.amount)}</div>
          )}
        </div>

        {/* ── Ligne 2 : Compte + date horodatée ── */}
        <div style={{
          display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10,
          background: "rgba(255,255,255,0.03)", borderRadius: 12, padding: "10px 14px",
          marginBottom: 14, border: "1px solid var(--border)",
        }}>
          {/* Compte */}
          <div>
            <div style={{ fontSize: 10, color: "var(--text3)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>
              Compte
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{
                width: 30, height: 30, borderRadius: 8, flexShrink: 0,
                background: prof ? `${prof.color}20` : "rgba(255,255,255,0.06)",
                border: `1px solid ${prof ? prof.color+"40" : "var(--border)"}`,
                display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16,
              }}>{prof?.avatar || "🏦"}</div>
              <div>
                <div style={{ fontWeight: 800, fontSize: 14, color: prof?.color || "var(--text)" }}>
                  {prof?.name || "—"}
                </div>
                <div style={{ fontSize: 10, color: "var(--text3)" }}>
                  {prof?.id === "common" ? "Compte commun" : "Personnel"}
                </div>
              </div>
            </div>
          </div>

          {/* Date d'échéance horodatée */}
          <div>
            <div style={{ fontSize: 10, color: "var(--text3)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>
              Échéance
            </div>
            <div style={{
              fontWeight: 700, fontSize: 13,
              color: isOverdue ? "var(--red)" : isPaid ? "var(--text3)" : "var(--text)",
              lineHeight: 1.4,
            }}>
              {fmtFull(bill.dueDate)}
              {isOverdue && <div style={{ fontSize: 11, color: "var(--red)", fontWeight: 800, marginTop: 2 }}>⚠️ Échéance dépassée</div>}
            </div>
          </div>
        </div>

        {/* ── Ligne 3 : boutons actions ── */}
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={() => onToggle(bill.id)} style={{
            flex: 1, padding: "11px", borderRadius: 12, cursor: "pointer",
            background: isPaid ? "rgba(74,222,128,0.12)" : "rgba(167,139,250,0.12)",
            border: `1px solid ${isPaid ? "rgba(74,222,128,0.35)" : "rgba(167,139,250,0.35)"}`,
            color: isPaid ? "var(--green)" : "var(--purple)",
            fontFamily: "'Outfit',sans-serif", fontWeight: 800, fontSize: 14,
            transition: "all .2s", letterSpacing: .3,
          }}>
            {isPaid ? "↩️ Marquer impayée" : "✅ Marquer comme payée"}
          </button>
          <button onClick={() => onDelete(bill.id)} style={{
            width: 46, height: 46, borderRadius: 12, cursor: "pointer", flexShrink: 0,
            background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.25)",
            color: "var(--red)", fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center",
            transition: "all .2s",
          }}>🗑</button>
        </div>
      </div>
    </div>
  );
}

function Stats({data,selMonth,mdata,allMonths}){
  const [period,setPeriod]=useState("month");const [statTab,setStatTab]=useState("overview");
  const catMap=useMemo(()=>Object.fromEntries(data.categories.map(c=>[c.id,c])),[data.categories]);
  const months=useMemo(()=>{const all=[...allMonths].reverse();if(period==="month")return[selMonth];if(period==="quarter"){const[y,m]=selMonth.split("-").map(Number);return all.filter(k=>{const[ky,km]=k.split("-").map(Number);return ky===y&&Math.abs(km-m)<3;});}if(period==="year"){const y=selMonth.slice(0,4);return all.filter(k=>k.startsWith(y));}return[selMonth];},[period,selMonth,allMonths]);
  const allTx=useMemo(()=>months.flatMap(k=>(data.monthsData[k]?.transactions||[])),[months,data.monthsData]);
  const totalExp=useMemo(()=>allTx.reduce((s,t)=>s+t.amount,0),[allTx]);
  const totalInc=useMemo(()=>months.reduce((s,k)=>{const inc=data.monthsData[k]?.incomes||{};return s+(inc.p1||0)+(inc.p2||0)+(inc.common||0);},0),[months,data.monthsData]);
  const pieData=useMemo(()=>{const m={};allTx.forEach(t=>{m[t.categoryId]=(m[t.categoryId]||0)+t.amount;});return Object.entries(m).map(([cid,val])=>({name:(catMap[cid]?.icon||"")+" "+(catMap[cid]?.name||cid),value:val,color:catMap[cid]?.color||"#888"})).sort((a,b)=>b.value-a.value);},[allTx,catMap]);
  const timelineData=useMemo(()=>[...allMonths].slice(0,12).reverse().map(k=>{const m=data.monthsData[k];const exp=m?.transactions.reduce((s,t)=>s+t.amount,0)||0;const inc=m?(m.incomes.p1||0)+(m.incomes.p2||0)+(m.incomes.common||0):0;return{month:monthLabelShort(k),dépenses:exp,revenus:inc,solde:inc-exp};}),[allMonths,data.monthsData]);
  const profBreakdown=useMemo(()=>data.profiles.filter(p=>p.id!=="common").map(p=>{const spent=allTx.filter(t=>t.profileId===p.id).reduce((s,t)=>s+t.amount,0);const inc=months.reduce((s,k)=>s+(data.monthsData[k]?.incomes[p.id]||0),0);return{...p,spent,inc,balance:inc-spent};}),[data.profiles,allTx,months,data.monthsData]);
  const CT=({active,payload,label})=>{if(!active||!payload?.length)return null;return(<div className="rc-tooltip"><div style={{fontWeight:700,marginBottom:4}}>{label}</div>{payload.map((p,i)=><div key={i} style={{color:p.color,fontSize:11}}>{p.name}: {fmt(p.value)}</div>)}</div>);};
  const PT=({active,payload})=>{if(!active||!payload?.length)return null;const d=payload[0];return <div className="rc-tooltip"><div style={{fontWeight:700}}>{d.name}</div><div style={{color:d.payload.color}}>{fmt(d.value)}</div><div style={{fontSize:10,color:"var(--text3)"}}>{totalExp>0?Math.round((d.value/totalExp)*100):0}%</div></div>;};
  return(
    <div className="fade-up">
      <div style={{display:"flex",gap:10,marginBottom:18,alignItems:"center",flexWrap:"wrap"}}>
        <div className="filter-bar" style={{flex:1}}>
          {[{id:"month",label:"Ce mois"},{id:"quarter",label:"Trimestre"},{id:"year",label:"Année"}].map(p=><div key={p.id} className={`filter-chip ${period===p.id?"active":""}`} onClick={()=>setPeriod(p.id)}>{p.label}</div>)}
        </div>
        <div className="filter-bar">
          {[{id:"overview",label:"Vue d'ensemble"},{id:"categories",label:"Catégories"},{id:"timeline",label:"Historique"},{id:"profiles",label:"Profils"}].map(t=><div key={t.id} className={`filter-chip ${statTab===t.id?"active":""}`} onClick={()=>setStatTab(t.id)} style={{borderColor:statTab===t.id?"rgba(96,165,250,0.5)":"var(--border)",background:statTab===t.id?"rgba(96,165,250,0.12)":"var(--glass)",color:statTab===t.id?"var(--blue)":"var(--text2)"}}>{t.label}</div>)}
        </div>
      </div>
      {statTab==="overview"&&(
        <div className="content-grid">
          <div style={{display:"flex",flexDirection:"column",gap:14}}>
            <div className="grid-4">{[{label:"Revenus",val:`+${fmt(totalInc)}`,color:"var(--green)",icon:"💵"},{label:"Dépenses",val:`-${fmt(totalExp)}`,color:"var(--red)",icon:"💸"},{label:"Solde net",val:fmt(totalInc-totalExp),color:totalInc>=totalExp?"var(--green)":"var(--red)",icon:"⚖️"},{label:"Transactions",val:allTx.length,color:"var(--purple)",icon:"🧾"}].map(s=>(
              <div key={s.label} className="card" style={{textAlign:"center",padding:16}}><div style={{fontSize:22,marginBottom:6}}>{s.icon}</div><div style={{fontSize:10,color:"var(--text3)",marginBottom:5,textTransform:"uppercase",letterSpacing:.8}}>{s.label}</div><div className="stat-num" style={{fontSize:16,color:s.color}}>{s.val}</div></div>
            ))}</div>
            <div className="card"><div style={{fontWeight:700,fontSize:13,marginBottom:14}}>Revenus vs Dépenses</div>
              <ResponsiveContainer width="100%" height={200}><AreaChart data={timelineData}><defs><linearGradient id="gR" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#4ade80" stopOpacity={0.25}/><stop offset="95%" stopColor="#4ade80" stopOpacity={0}/></linearGradient><linearGradient id="gE" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#f87171" stopOpacity={0.25}/><stop offset="95%" stopColor="#f87171" stopOpacity={0}/></linearGradient></defs><XAxis dataKey="month" tick={{fill:"rgba(237,233,248,0.35)",fontSize:10}} axisLine={false} tickLine={false}/><YAxis tick={{fill:"rgba(237,233,248,0.35)",fontSize:10}} axisLine={false} tickLine={false} width={70} tickFormatter={v=>v>0?fmt(v):"."}/><Tooltip content={<CT/>}/><Area type="monotone" dataKey="revenus" stroke="#4ade80" strokeWidth={2} fill="url(#gR)" name="Revenus"/><Area type="monotone" dataKey="dépenses" stroke="#f87171" strokeWidth={2} fill="url(#gE)" name="Dépenses"/></AreaChart></ResponsiveContainer>
            </div>
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:14}}>
            {pieData.length>0&&<div className="card"><div style={{fontWeight:700,fontSize:13,marginBottom:10}}>Répartition</div><ResponsiveContainer width="100%" height={180}><PieChart><Pie data={pieData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={2} dataKey="value">{pieData.map((e,i)=><Cell key={i} fill={e.color} stroke="transparent"/>)}</Pie><Tooltip content={<PT/>}/></PieChart></ResponsiveContainer><div style={{display:"flex",flexWrap:"wrap",gap:6,marginTop:4}}>{pieData.slice(0,6).map((d,i)=><div key={i} style={{display:"flex",alignItems:"center",gap:4,fontSize:11}}><div style={{width:8,height:8,borderRadius:2,background:d.color}}/><span style={{color:"var(--text3)"}}>{d.name}</span></div>)}</div></div>}
            <div className="card"><div style={{fontWeight:700,fontSize:13,marginBottom:12}}>Solde mensuel</div><ResponsiveContainer width="100%" height={150}><BarChart data={timelineData}><XAxis dataKey="month" tick={{fill:"rgba(237,233,248,0.35)",fontSize:9}} axisLine={false} tickLine={false}/><YAxis tick={{fill:"rgba(237,233,248,0.35)",fontSize:9}} axisLine={false} tickLine={false} width={60} tickFormatter={v=>v>0?fmt(v):"."}/><Tooltip content={<CT/>}/><Bar dataKey="solde" name="Solde" radius={[5,5,0,0]}>{timelineData.map((e,i)=><Cell key={i} fill={e.solde>=0?"#4ade80":"#f87171"}/>)}</Bar></BarChart></ResponsiveContainer></div>
          </div>
        </div>
      )}
      {statTab==="categories"&&(
        <div className="content-grid">
          <div className="card"><div style={{fontWeight:700,fontSize:13,marginBottom:14}}>Détail par catégorie</div>{pieData.length===0?<div className="empty-state"><div className="empty-icon">📊</div>Aucune donnée</div>:pieData.map((d,i)=><div key={i} style={{marginBottom:14}}><div style={{display:"flex",justifyContent:"space-between",marginBottom:5,fontSize:13}}><span style={{fontWeight:600}}>{d.name}</span><div style={{display:"flex",gap:12}}><span style={{color:"var(--text3)",fontSize:11}}>{totalExp>0?Math.round((d.value/totalExp)*100):0}%</span><span style={{fontWeight:800,color:d.color}}>{fmt(d.value)}</span></div></div><div className="progress-track" style={{height:7}}><div className="progress-fill" style={{width:`${totalExp>0?(d.value/totalExp)*100:0}%`,background:d.color}}/></div></div>)}</div>
          {pieData.length>0&&<div className="card"><div style={{fontWeight:700,fontSize:13,marginBottom:10}}>Distribution</div><ResponsiveContainer width="100%" height={280}><PieChart><Pie data={pieData} cx="50%" cy="50%" outerRadius={110} paddingAngle={2} dataKey="value">{pieData.map((e,i)=><Cell key={i} fill={e.color} stroke="transparent"/>)}</Pie><Tooltip content={<PT/>}/><Legend formatter={v=><span style={{fontSize:11,color:"var(--text2)"}}>{v}</span>}/></PieChart></ResponsiveContainer></div>}
        </div>
      )}
      {statTab==="timeline"&&(
        <div style={{display:"flex",flexDirection:"column",gap:16}}>
          <div className="card"><div style={{fontWeight:700,fontSize:13,marginBottom:14}}>Évolution sur 12 mois</div><ResponsiveContainer width="100%" height={220}><AreaChart data={timelineData}><defs><linearGradient id="gR2" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#4ade80" stopOpacity={0.3}/><stop offset="95%" stopColor="#4ade80" stopOpacity={0}/></linearGradient><linearGradient id="gE2" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#f87171" stopOpacity={0.3}/><stop offset="95%" stopColor="#f87171" stopOpacity={0}/></linearGradient></defs><XAxis dataKey="month" tick={{fill:"rgba(237,233,248,0.35)",fontSize:11}} axisLine={false} tickLine={false}/><YAxis tick={{fill:"rgba(237,233,248,0.35)",fontSize:11}} axisLine={false} tickLine={false} width={75} tickFormatter={v=>fmt(v)}/><Tooltip content={<CT/>}/><Legend formatter={v=><span style={{fontSize:12,color:"var(--text2)"}}>{v}</span>}/><Area type="monotone" dataKey="revenus" stroke="#4ade80" strokeWidth={2.5} fill="url(#gR2)" name="Revenus"/><Area type="monotone" dataKey="dépenses" stroke="#f87171" strokeWidth={2.5} fill="url(#gE2)" name="Dépenses"/></AreaChart></ResponsiveContainer></div>
          <div className="card"><div style={{fontWeight:700,fontSize:13,marginBottom:14}}>Solde mensuel</div><ResponsiveContainer width="100%" height={180}><BarChart data={timelineData}><XAxis dataKey="month" tick={{fill:"rgba(237,233,248,0.35)",fontSize:11}} axisLine={false} tickLine={false}/><YAxis tick={{fill:"rgba(237,233,248,0.35)",fontSize:11}} axisLine={false} tickLine={false} width={75} tickFormatter={v=>fmt(v)}/><Tooltip content={<CT/>}/><Bar dataKey="solde" name="Solde" radius={[6,6,0,0]}>{timelineData.map((e,i)=><Cell key={i} fill={e.solde>=0?"#4ade80":"#f87171"}/>)}</Bar></BarChart></ResponsiveContainer></div>
        </div>
      )}
      {statTab==="profiles"&&(
        <div className="content-grid">{profBreakdown.map(p=>(
          <div key={p.id} className="card"><div style={{display:"flex",alignItems:"center",gap:14,marginBottom:16}}><div style={{fontSize:44}}>{p.avatar}</div><div><div style={{fontWeight:800,fontSize:18}}>{p.name}</div><div style={{fontSize:12,color:p.color}}>Solde: <strong>{fmt(p.balance)}</strong></div></div></div>
          <div className="grid-2" style={{marginBottom:14}}><div style={{background:"rgba(74,222,128,0.08)",borderRadius:12,padding:"10px",textAlign:"center"}}><div style={{fontSize:10,color:"var(--text3)",marginBottom:3}}>Revenus</div><div style={{fontWeight:800,color:"var(--green)",fontSize:16}}>+{fmt(p.inc)}</div></div><div style={{background:"rgba(248,113,113,0.08)",borderRadius:12,padding:"10px",textAlign:"center"}}><div style={{fontSize:10,color:"var(--text3)",marginBottom:3}}>Dépenses</div><div style={{fontWeight:800,color:"var(--red)",fontSize:16}}>-{fmt(p.spent)}</div></div></div>
          {p.inc>0&&<><div style={{display:"flex",justifyContent:"space-between",fontSize:12,color:"var(--text3)",marginBottom:5}}><span>Budget utilisé</span><span style={{fontWeight:700,color:p.spent>p.inc?"var(--red)":"var(--green)"}}>{Math.round((p.spent/p.inc)*100)}%</span></div><div className="progress-track" style={{height:8}}><div className="progress-fill" style={{width:`${Math.min(100,(p.spent/p.inc)*100)}%`,background:p.color,boxShadow:`0 0 8px ${p.color}50`}}/></div></>}
          </div>
        ))}</div>
      )}
    </div>
  );
}

function SettingsPage({data,update,setModal,user}){
  const [newCat,setNewCat]=useState({name:"",icon:"✨",color:"#a78bfa"});
  const addCat=()=>{if(!newCat.name.trim())return;update(d=>{d.categories.push({id:`c_${mkid()}`,name:newCat.name.trim(),icon:newCat.icon,color:newCat.color});});setNewCat({name:"",icon:"✨",color:"#a78bfa"});};
  return(
    <div className="fade-up content-grid">
      <div style={{display:"flex",flexDirection:"column",gap:14}}>
        <div className="card">
          <div style={{fontWeight:700,fontSize:14,marginBottom:14}}>👤 Profils</div>
          {data.profiles.map(p=>(
            <div key={p.id} style={{display:"flex",alignItems:"center",gap:12,padding:"10px 0",borderBottom:"1px solid var(--border)"}}>
              <div style={{fontSize:30}}>{p.avatar}</div><div style={{flex:1}}><div style={{fontWeight:700}}>{p.name}</div><div style={{fontSize:11,color:p.color,textTransform:"uppercase",letterSpacing:.5}}>{p.id==="common"?"Commun":"Personnel"}</div></div>
              <button className="btn btn-ghost btn-sm" onClick={()=>setModal({type:"editProfile",profileId:p.id})}>Modifier</button>
            </div>
          ))}
        </div>
        <div className="card">
          <div style={{fontWeight:700,fontSize:14,marginBottom:14}}>🏷️ Catégories</div>
          <div style={{display:"flex",gap:8,marginBottom:14}}>
            <input value={newCat.name} onChange={e=>setNewCat(v=>({...v,name:e.target.value}))} placeholder="Nouvelle catégorie…" style={{flex:1}}/>
            <select value={newCat.icon} onChange={e=>setNewCat(v=>({...v,icon:e.target.value}))} style={{width:70}}>{CAT_ICONS.map(i=><option key={i} value={i}>{i}</option>)}</select>
            <input type="color" value={newCat.color} onChange={e=>setNewCat(v=>({...v,color:e.target.value}))} style={{width:44}}/>
            <button className="btn btn-primary btn-sm" onClick={addCat}>＋</button>
          </div>
          <div style={{display:"flex",flexWrap:"wrap",gap:7}}>
            {data.categories.map(c=>(
              <div key={c.id} style={{display:"flex",alignItems:"center",gap:5,background:`${c.color}15`,border:`1px solid ${c.color}35`,borderRadius:20,padding:"5px 12px"}}>
                <span>{c.icon}</span><span style={{fontSize:12,fontWeight:600}}>{c.name}</span>
                <button onClick={()=>update(d=>{d.categories=d.categories.filter(x=>x.id!==c.id);})} style={{background:"none",border:"none",color:"var(--red)",cursor:"pointer",fontSize:15,lineHeight:1,padding:"0 2px"}}>×</button>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:14}}>
        <div className="card">
          <div style={{fontWeight:700,fontSize:14,marginBottom:10}}>☁️ Compte Firebase</div>
          <div style={{fontSize:13,color:"var(--text2)",marginBottom:12,display:"flex",alignItems:"center",gap:8}}><div className="sync-dot synced"/>{user?.email}</div>
          <button className="btn btn-ghost" style={{width:"100%"}} onClick={()=>signOut(auth)}>🚪 Déconnexion</button>
        </div>
        <div className="card" style={{borderColor:"rgba(248,113,113,0.2)"}}>
          <div style={{fontWeight:700,fontSize:14,color:"var(--red)",marginBottom:12}}>⚠️ Zone de danger</div>
          <div style={{fontSize:12,color:"var(--text3)",marginBottom:14}}>Cette action supprimera toutes tes données définitivement.</div>
          <button className="btn btn-danger" style={{width:"100%"}} onClick={()=>{if(window.confirm("Supprimer TOUTES les données ? Irréversible."))update(d=>{Object.assign(d,JSON.parse(JSON.stringify(INIT)));});}}>🗑️ Réinitialiser toutes les données</button>
        </div>
      </div>
    </div>
  );
}

function ModalRouter({modal,setModal,data,update,selMonth}){
  const close=()=>setModal(null);
  if(modal.type==="editIncome") return <IncomeModal close={close} data={data} update={update} profileId={modal.profileId} selMonth={modal.selMonth||selMonth}/>;
  if(modal.type==="addTransaction") return <AddTxModal close={close} data={data} update={update} selMonth={modal.selMonth||selMonth}/>;
  if(modal.type==="addBill") return <AddBillModal close={close} data={data} update={update}/>;
  if(modal.type==="editProfile") return <EditProfileModal close={close} data={data} update={update} profileId={modal.profileId}/>;
  if(modal.type==="addRecurringIncome") return <AddRecurringIncomeModal close={close} data={data} update={update}/>;
  return null;
}
function ModalWrap({close,title,children}){
  return(<div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&close()}><div className="modal-box scale-in"><div style={{fontWeight:800,fontSize:18,marginBottom:18,display:"flex",alignItems:"center",justifyContent:"space-between"}}><span>{title}</span><button onClick={close} style={{background:"none",border:"none",color:"var(--text3)",cursor:"pointer",fontSize:22,lineHeight:1}}>×</button></div>{children}</div></div>);
}
function IncomeModal({close,data,update,profileId,selMonth}){
  const profile=data.profiles.find(p=>p.id===profileId);const current=data.monthsData[selMonth]?.incomes?.[profileId]||0;const [val,setVal]=useState(current||"");
  const save=()=>{update(d=>{ensureMonth(d,selMonth);d.monthsData[selMonth].incomes[profileId]=parseFloat(val)||0;});close();};
  return(<ModalWrap close={close} title={`💵 Revenu — ${profile?.name}`}><div style={{textAlign:"center",marginBottom:18}}><div style={{fontSize:52,marginBottom:8}}>{profile?.avatar}</div><div style={{fontSize:12,color:"var(--text2)"}}>{monthLabel(selMonth)}</div></div><label>Montant (€)</label><input type="number" value={val} onChange={e=>setVal(e.target.value)} placeholder="Ex: 2500" style={{marginBottom:18,fontSize:18,textAlign:"center"}} autoFocus onKeyDown={e=>e.key==="Enter"&&save()}/><div style={{display:"flex",gap:10}}><button className="btn btn-ghost" onClick={close} style={{flex:1}}>Annuler</button><button className="btn btn-primary" onClick={save} style={{flex:1}}>Enregistrer</button></div></ModalWrap>);
}
function AddTxModal({close,data,update,selMonth}){
  const [label,setLabel]=useState("");const [amount,setAmount]=useState("");const [catId,setCatId]=useState(data.categories[0]?.id||"");const [profId,setProfId]=useState(data.profiles[0]?.id||"");const [customDate,setCustomDate]=useState("");
  const save=()=>{if(!label.trim()||!amount)return;update(d=>{ensureMonth(d,selMonth);d.monthsData[selMonth].transactions.push({id:mkid(),label:label.trim(),amount:parseFloat(amount),categoryId:catId,profileId:profId,timestamp:customDate?new Date(customDate).toISOString():nowISO()});});close();};
  return(<ModalWrap close={close} title="💳 Nouvelle dépense"><div style={{marginBottom:12}}><label>Libellé</label><input value={label} onChange={e=>setLabel(e.target.value)} placeholder="Ex: Courses Lidl" autoFocus/></div><div style={{marginBottom:12}}><label>Montant (€)</label><input type="number" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="0.00"/></div><div className="grid-2" style={{marginBottom:12}}><div><label>Catégorie</label><select value={catId} onChange={e=>setCatId(e.target.value)}>{data.categories.map(c=><option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}</select></div><div><label>Profil</label><select value={profId} onChange={e=>setProfId(e.target.value)}>{data.profiles.map(p=><option key={p.id} value={p.id}>{p.avatar} {p.name}</option>)}</select></div></div><div style={{marginBottom:16}}><label>Date (optionnel)</label><input type="datetime-local" value={customDate} onChange={e=>setCustomDate(e.target.value)}/></div><div style={{display:"flex",gap:10}}><button className="btn btn-ghost" onClick={close} style={{flex:1}}>Annuler</button><button className="btn btn-primary" onClick={save} style={{flex:1}} disabled={!label.trim()||!amount}>Ajouter</button></div></ModalWrap>);
}
function AddBillModal({close,data,update}){
  const [name,setName]=useState("");const [amount,setAmount]=useState("");const [icon,setIcon]=useState("⚡");const [profId,setProfId]=useState("common");const [catId,setCatId]=useState(data.categories[0]?.id||"");const [dueDate,setDueDate]=useState("");const [recurring,setRecurring]=useState(true);
  const save=()=>{if(!name.trim())return;update(d=>{d.bills.push({id:mkid(),name:name.trim(),amount:parseFloat(amount)||0,icon,profileId:profId,categoryId:catId,dueDate:dueDate?new Date(dueDate).toISOString():null,recurring,paid:{},createdAt:nowISO()});});close();};
  return(<ModalWrap close={close} title="📋 Nouvelle facture"><div style={{marginBottom:12}}><label>Nom</label><input value={name} onChange={e=>setName(e.target.value)} placeholder="Ex: Électricité EDF" autoFocus/></div><div style={{marginBottom:12}}><label>Icône</label><div style={{display:"flex",flexWrap:"wrap",gap:5}}>{BILL_ICONS.map(i=><button key={i} onClick={()=>setIcon(i)} style={{fontSize:18,background:icon===i?"rgba(167,139,250,0.2)":"rgba(255,255,255,0.05)",border:`2px solid ${icon===i?"var(--purple)":"transparent"}`,borderRadius:8,width:36,height:36,cursor:"pointer",transition:"all .15s"}}>{i}</button>)}</div></div><div className="grid-2" style={{marginBottom:12}}><div><label>Montant (€)</label><input type="number" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="0 = variable"/></div><div><label>Date d'échéance</label><input type="date" value={dueDate} onChange={e=>setDueDate(e.target.value)}/></div></div><div className="grid-2" style={{marginBottom:12}}><div><label>Payé par</label><select value={profId} onChange={e=>setProfId(e.target.value)}>{data.profiles.map(p=><option key={p.id} value={p.id}>{p.avatar} {p.name}</option>)}</select></div><div><label>Catégorie</label><select value={catId} onChange={e=>setCatId(e.target.value)}>{data.categories.map(c=><option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}</select></div></div><div style={{display:"flex",alignItems:"center",gap:10,marginBottom:18,background:"rgba(167,139,250,0.08)",borderRadius:10,padding:12}}><input type="checkbox" id="rec" checked={recurring} onChange={e=>setRecurring(e.target.checked)} style={{width:"auto",cursor:"pointer"}}/><label htmlFor="rec" style={{margin:0,cursor:"pointer",fontSize:12,color:"var(--text)"}}>🔄 Facture récurrente mensuelle</label></div><div style={{display:"flex",gap:10}}><button className="btn btn-ghost" onClick={close} style={{flex:1}}>Annuler</button><button className="btn btn-primary" onClick={save} style={{flex:1}} disabled={!name.trim()}>Créer</button></div></ModalWrap>);
}
function EditProfileModal({close,data,update,profileId}){
  const profile=data.profiles.find(p=>p.id===profileId);const [name,setName]=useState(profile?.name||"");const [avatar,setAvatar]=useState(profile?.avatar||"😊");
  const save=()=>{update(d=>{const p=d.profiles.find(p=>p.id===profileId);if(p){p.name=name.trim();p.avatar=avatar;}});close();};
  return(<ModalWrap close={close} title="✏️ Modifier le profil"><div style={{textAlign:"center",fontSize:60,marginBottom:10}}>{avatar}</div><label>Prénom</label><input value={name} onChange={e=>setName(e.target.value)} style={{marginBottom:12,textAlign:"center"}} onKeyDown={e=>e.key==="Enter"&&save()}/><label>Avatar</label><div style={{display:"flex",flexWrap:"wrap",gap:6,justifyContent:"center",marginBottom:18}}>{AVATARS.map(a=><button key={a} onClick={()=>setAvatar(a)} style={{fontSize:20,background:avatar===a?"rgba(167,139,250,0.2)":"rgba(255,255,255,0.05)",border:`2px solid ${avatar===a?"var(--purple)":"transparent"}`,borderRadius:9,width:40,height:40,cursor:"pointer"}}>{a}</button>)}</div><div style={{display:"flex",gap:10}}><button className="btn btn-ghost" onClick={close} style={{flex:1}}>Annuler</button><button className="btn btn-primary" onClick={save} style={{flex:1}}>Enregistrer</button></div></ModalWrap>);
}
function AddRecurringIncomeModal({close,data,update}){
  const [profId,setProfId]=useState(data.profiles[0]?.id||"");const [amount,setAmount]=useState("");const [startDate,setStartDate]=useState(curMonthKey()+"-01");
  const save=()=>{if(!amount)return;update(d=>{if(!d.recurringIncomes)d.recurringIncomes=[];d.recurringIncomes.push({id:mkid(),profileId:profId,amount:parseFloat(amount),startDate:new Date(startDate).toISOString()});});close();};
  return(<ModalWrap close={close} title="🔄 Revenu récurrent"><div style={{background:"rgba(74,222,128,0.07)",borderRadius:10,padding:12,marginBottom:14,fontSize:12,color:"var(--text2)"}}>Ce revenu sera appliqué automatiquement chaque mois à partir de la date choisie.</div><div style={{marginBottom:12}}><label>Profil</label><select value={profId} onChange={e=>setProfId(e.target.value)}>{data.profiles.map(p=><option key={p.id} value={p.id}>{p.avatar} {p.name}</option>)}</select></div><div style={{marginBottom:12}}><label>Montant mensuel (€)</label><input type="number" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="Ex: 2500" autoFocus/></div><div style={{marginBottom:18}}><label>Date de début</label><input type="date" value={startDate} onChange={e=>setStartDate(e.target.value)}/></div><div style={{display:"flex",gap:10}}><button className="btn btn-ghost" onClick={close} style={{flex:1}}>Annuler</button><button className="btn btn-primary" onClick={save} style={{flex:1}} disabled={!amount}>Créer</button></div></ModalWrap>);
}
