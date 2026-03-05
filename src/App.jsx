import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  PieChart, Pie, Cell, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, Tooltip, ResponsiveContainer, Legend
} from "recharts";
import { auth, db } from "./firebase";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
  fetchSignInMethodsForEmail,
} from "firebase/auth";
import { doc, getDoc, setDoc, onSnapshot } from "firebase/firestore";

// ═══════════════════════════════════════════════════════════
//  FIRESTORE SYNC — Anti-boucle corrigé
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
    await setDoc(getDocRef(uid), { budget: data, _ts: Date.now() }, { merge: true });
    return true;
  } catch (e) { console.error("Save error", e); return false; }
};

// ═══════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════
const nowISO = () => new Date().toISOString();
const pad = n => String(n).padStart(2, "0");
const fmtDT = iso => {
  if (!iso) return "";
  const d = new Date(iso);
  return `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const fmtDate = iso => {
  if (!iso) return "";
  const d = new Date(iso);
  return `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()}`;
};
const mkid = () => `${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
const monthKey = (y,m) => `${y}-${pad(m+1)}`;
const curMonthKey = () => { const d=new Date(); return monthKey(d.getFullYear(),d.getMonth()); };
const monthLabel = k => {
  if (!k) return "";
  const [y,m] = k.split("-");
  return new Date(+y,+m-1,1).toLocaleDateString("fr-FR",{month:"long",year:"numeric"});
};
const monthLabelShort = k => {
  if (!k) return "";
  const [y,m] = k.split("-");
  return new Date(+y,+m-1,1).toLocaleDateString("fr-FR",{month:"short",year:"2-digit"});
};
const fmt = n => (n||0).toLocaleString("fr-FR",{minimumFractionDigits:0,maximumFractionDigits:2})+" €";
const fmtCompact = n => {
  if (Math.abs(n) >= 1000) return (n/1000).toLocaleString("fr-FR",{maximumFractionDigits:1})+"k €";
  return fmt(n);
};

// Export CSV
const exportCSV = (transactions, categories, profiles, monthKey) => {
  const catMap = Object.fromEntries(categories.map(c=>[c.id,c]));
  const profMap = Object.fromEntries(profiles.map(p=>[p.id,p]));
  const header = "Date;Libellé;Montant;Catégorie;Profil;Auto\n";
  const rows = [...transactions]
    .sort((a,b) => new Date(a.timestamp) - new Date(b.timestamp))
    .map(t => [
      fmtDT(t.timestamp),
      `"${t.label}"`,
      (t.amount||0).toFixed(2),
      catMap[t.categoryId]?.name || "",
      profMap[t.profileId]?.name || "",
      t.auto ? "Oui" : "Non"
    ].join(";"))
    .join("\n");
  const blob = new Blob(["\uFEFF"+header+rows], {type:"text/csv;charset=utf-8;"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `budget_${monthKey}.csv`; a.click();
  URL.revokeObjectURL(url);
};

const AVATARS = ["😊","😎","🥰","🤩","😄","🧑","👩","👨","🦊","🐱","🐶","🦁","🐼","🦋","🌟","💫","🔥","⭐","🌈","🎯","🦄","🐸","🎭","🧸","🚀"];
const CAT_ICONS = ["🏠","🛒","🚗","🎬","💊","👗","⚡","📱","🍽️","💰","✈️","🎮","📚","🐾","🎁","🧴","🍷","☕","🏋️","🌿","💡","🔧","🎨","🎵","💻","🛁","🎯","🌎","🎂","💐","🏖️","🎓","🐠","🍕","🎪"];
const BILL_ICONS = ["⚡","💧","🔥","📱","🌐","🏠","🚗","🎓","💊","📺","🎵","🌿","🏦","🛡️","📦","🎪"];
const PROFILE_COLORS = ["#a78bfa","#f472b6","#60a5fa","#4ade80","#fb923c","#f87171","#fbbf24","#34d399"];

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

const INIT = { profiles:[], categories:DEFAULT_CATS, monthsData:{}, bills:[], recurringIncomes:[], savingsGoal:0 };

function ensureMonth(d, key) {
  if (!d.monthsData[key]) d.monthsData[key] = { transactions:[], incomes:{p1:0,p2:0,common:0}, billsProcessed:{} };
  if (!d.monthsData[key].billsProcessed) d.monthsData[key].billsProcessed = {};
  if (!d.monthsData[key].incomes) d.monthsData[key].incomes = {p1:0,p2:0,common:0};
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
  --glass:rgba(255,255,255,0.055);--glass2:rgba(255,255,255,0.09);--glass3:rgba(255,255,255,0.12);
  --border:rgba(255,255,255,0.09);--border2:rgba(255,255,255,0.16);
  --text:#ede9f8;--text2:rgba(237,233,248,0.6);--text3:rgba(237,233,248,0.35);
  --purple:#a78bfa;--pink:#f472b6;--blue:#60a5fa;--green:#4ade80;--orange:#fb923c;--red:#f87171;--yellow:#fbbf24;--teal:#2dd4bf;
  --grad-main:linear-gradient(135deg,#a78bfa,#f472b6);
  --grad-green:linear-gradient(135deg,#4ade80,#22d3ee);
  --grad-red:linear-gradient(135deg,#f87171,#fb923c);
  --grad-blue:linear-gradient(135deg,#60a5fa,#a78bfa);
  --shadow-glow:0 0 40px rgba(167,139,250,0.15);
  --shadow-card:0 4px 24px rgba(0,0,0,0.4);
  --sw:244px;--r:16px;--r-sm:11px;--r-lg:22px;
}
html,body,#root{font-family:'Outfit',sans-serif;background:var(--bg);color:var(--text);width:100%;height:100%;margin:0;padding:0;overflow:hidden;}

/* ── AUTH ── */
.auth-shell{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;padding:20px;
  padding-top:calc(20px + env(safe-area-inset-top));
  padding-bottom:calc(20px + env(safe-area-inset-bottom));
  background:radial-gradient(ellipse 80% 60% at 50% -10%,rgba(167,139,250,0.2),transparent 70%),
             radial-gradient(ellipse 60% 40% at 80% 100%,rgba(244,114,182,0.1),transparent 60%),
             var(--bg);}
.auth-card{background:linear-gradient(145deg,#110f24,#1a1635);border:1px solid var(--border2);border-radius:28px;padding:40px;width:100%;max-width:420px;box-shadow:0 32px 80px rgba(0,0,0,0.6),0 0 0 1px rgba(167,139,250,0.08);}

/* ── AUTH INPUT FIELD ── */
.auth-field{position:relative;margin-bottom:14px;}
.auth-field label{font-size:11px;color:var(--text3);font-weight:700;letter-spacing:.6px;text-transform:uppercase;display:block;margin-bottom:6px;}
.auth-field input{background:rgba(255,255,255,0.055);border:1px solid rgba(255,255,255,0.1);border-radius:13px;color:var(--text);padding:13px 16px 13px 44px;font-size:14px;width:100%;outline:none;transition:all .2s;font-family:'Outfit',sans-serif;}
.auth-field input:focus{border-color:rgba(167,139,250,0.6);box-shadow:0 0 0 3px rgba(167,139,250,0.1),inset 0 1px 0 rgba(255,255,255,0.05);}
.auth-field .field-icon{position:absolute;left:14px;bottom:13px;font-size:16px;pointer-events:none;}
.auth-field .eye-btn{position:absolute;right:12px;bottom:10px;background:none;border:none;cursor:pointer;color:var(--text3);font-size:17px;padding:3px;transition:color .2s;line-height:1;}
.auth-field .eye-btn:hover{color:var(--text2);}

/* ── AUTH STRENGTH BAR ── */
.pwd-strength{display:flex;gap:4px;margin-top:8px;}
.pwd-strength-bar{flex:1;height:3px;border-radius:2px;transition:background .3s;}

/* ── AUTH DIVIDER ── */
.auth-divider{display:flex;align-items:center;gap:12px;margin:20px 0;color:var(--text3);font-size:11px;font-weight:600;letter-spacing:.5px;}
.auth-divider::before,.auth-divider::after{content:'';flex:1;height:1px;background:var(--border);}

/* ── FEATURE PILLS ── */
.auth-features{display:flex;justify-content:center;gap:8px;flex-wrap:wrap;margin-top:20px;}
.auth-feature-pill{display:flex;align-items:center;gap:5px;background:rgba(255,255,255,0.04);border:1px solid var(--border);border-radius:20px;padding:5px 10px;font-size:11px;color:var(--text3);font-weight:500;}

/* ── RESET VIEW ── */
.reset-back-btn{background:none;border:none;color:var(--text3);cursor:pointer;font-family:'Outfit',sans-serif;font-size:13px;font-weight:600;display:flex;align-items:center;gap:6px;padding:0;transition:color .2s;margin-bottom:24px;}
.reset-back-btn:hover{color:var(--text);}
@keyframes checkDraw{from{stroke-dashoffset:100}to{stroke-dashoffset:0}}
.check-anim{animation:checkDraw .5s ease .1s both;stroke-dasharray:100;stroke-dashoffset:0;}

/* ── SHELL ── */
.app-shell{position:fixed;inset:0;display:flex;overflow:hidden;
  background:radial-gradient(ellipse 60% 40% at 10% 0%,rgba(167,139,250,0.08) 0%,transparent 60%),
             radial-gradient(ellipse 50% 30% at 90% 100%,rgba(244,114,182,0.05) 0%,transparent 60%),
             var(--bg);}

/* ── SIDEBAR ── */
.sidebar{width:var(--sw);flex-shrink:0;background:linear-gradient(180deg,#0d0b1e 0%,#09070f 100%);
  border-right:1px solid var(--border);
  position:fixed;top:0;left:0;bottom:0;display:flex;flex-direction:column;z-index:300;
  padding-top:env(safe-area-inset-top);
  padding-bottom:env(safe-area-inset-bottom);
  transition:transform .3s cubic-bezier(.4,0,.2,1);}
.sidebar-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,0.65);backdrop-filter:blur(6px);z-index:299;}

/* ── MAIN ── */
.main-area{margin-left:var(--sw);flex:1;display:flex;flex-direction:column;min-height:0;min-width:0;width:0;
  transition:margin-left .3s cubic-bezier(.4,0,.2,1);}
.topbar{
  height:calc(62px + env(safe-area-inset-top));
  padding-top:calc(10px + env(safe-area-inset-top));
  padding-left:calc(26px + env(safe-area-inset-left));
  padding-right:calc(20px + env(safe-area-inset-right));
  padding-bottom:10px;
  background:rgba(7,6,15,0.92);backdrop-filter:blur(28px);
  border-bottom:1px solid var(--border);
  display:flex;align-items:center;justify-content:space-between;flex-shrink:0;gap:10px;z-index:200;}
.page-content{flex:1;padding:24px;overflow-y:auto;overflow-x:hidden;min-height:0;scroll-behavior:smooth;}

/* ── CONTENT GRIDS ── */
.content-grid{display:grid;grid-template-columns:1fr 360px;gap:20px;align-items:start;}
.content-grid.wide{grid-template-columns:1fr !important;}

/* ── NAV ── */
.nav-section-label{font-size:9.5px;font-weight:800;letter-spacing:1.8px;text-transform:uppercase;color:var(--text3);padding:0 18px;margin:16px 0 5px;}
.nav-item{display:flex;align-items:center;gap:11px;padding:10px 14px;margin:2px 8px;border-radius:13px;cursor:pointer;transition:all .18s;font-size:14px;font-weight:600;color:var(--text2);position:relative;user-select:none;}
.nav-item:hover{color:var(--text);background:rgba(255,255,255,0.06);}
.nav-item.active{color:var(--purple);background:rgba(167,139,250,0.12);}
.nav-item.active::before{content:'';position:absolute;left:-8px;top:50%;transform:translateY(-50%);width:3px;height:20px;background:var(--grad-main);border-radius:0 4px 4px 0;}
.nav-icon{font-size:17px;width:22px;text-align:center;flex-shrink:0;}
.nav-badge{margin-left:auto;background:rgba(248,113,113,0.2);color:var(--red);border-radius:10px;padding:1px 7px;font-size:11px;font-weight:800;}

/* ── CARDS ── */
.glass{background:var(--glass);backdrop-filter:blur(20px);border:1px solid var(--border);border-radius:var(--r);}
.glass-hover{transition:all .2s;}
.glass-hover:hover{background:var(--glass2);border-color:var(--border2);box-shadow:var(--shadow-glow);transform:translateY(-1px);}
.card{background:var(--glass);border:1px solid var(--border);border-radius:var(--r);padding:22px;box-shadow:var(--shadow-card);}
.card-sm{background:var(--glass);border:1px solid var(--border);border-radius:var(--r);padding:14px 18px;}
.card-highlight{border-color:rgba(167,139,250,0.25);background:rgba(167,139,250,0.04);}

/* ── BUTTONS ── */
.btn{border:none;border-radius:var(--r-sm);cursor:pointer;font-family:'Outfit',sans-serif;font-weight:600;transition:all .2s;font-size:14px;display:inline-flex;align-items:center;gap:7px;white-space:nowrap;}
.btn-primary{background:var(--grad-main);color:white;padding:10px 20px;box-shadow:0 4px 14px rgba(167,139,250,0.3);}
.btn-primary:hover{transform:translateY(-1px);box-shadow:0 6px 22px rgba(167,139,250,0.45);}
.btn-primary:active{transform:translateY(0);}
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
input:focus,select:focus,textarea:focus{border-color:rgba(167,139,250,0.55);box-shadow:0 0 0 3px rgba(167,139,250,0.1);}
input[type=color]{padding:3px;height:38px;cursor:pointer;}
select option{background:#15122a;}
label{font-size:12px;color:var(--text2);font-weight:600;display:block;margin-bottom:5px;letter-spacing:.3px;}
.search-input{background:rgba(255,255,255,0.06);border:1px solid var(--border);border-radius:var(--r-sm);color:var(--text);padding:9px 14px 9px 38px;font-size:13px;width:100%;outline:none;transition:border .2s;font-family:'Outfit',sans-serif;}
.search-input:focus{border-color:rgba(167,139,250,0.5);}
.search-wrap{position:relative;flex:1;}
.search-wrap::before{content:'🔍';position:absolute;left:12px;top:50%;transform:translateY(-50%);font-size:13px;pointer-events:none;}

/* ── PROGRESS ── */
.progress-track{background:rgba(255,255,255,0.07);border-radius:20px;overflow:hidden;}
.progress-fill{height:100%;border-radius:20px;transition:width .7s cubic-bezier(.4,0,.2,1);}

/* ── TRANSACTIONS ── */
.tx-row{border-radius:13px;padding:11px 13px;transition:all .15s;border:1px solid transparent;display:flex;align-items:center;gap:12px;}
.tx-row:hover{background:rgba(255,255,255,0.05);border-color:var(--border);}
.tx-row.selected{background:rgba(167,139,250,0.08);border-color:rgba(167,139,250,0.25);}

/* ── MISC ── */
.glow-text{background:var(--grad-main);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;}
.glow-text-green{background:var(--grad-green);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;}
.auto-badge{display:inline-flex;align-items:center;gap:3px;background:rgba(167,139,250,0.15);border:1px solid rgba(167,139,250,0.3);color:var(--purple);border-radius:20px;padding:3px 9px;font-size:11px;font-weight:700;}
.chip-icon{display:flex;align-items:center;justify-content:center;border-radius:12px;font-size:21px;flex-shrink:0;}
.stat-num{font-family:'Fraunces',serif;font-weight:700;}
.empty-state{padding:48px;text-align:center;color:var(--text3);}
.empty-state .empty-icon{font-size:44px;margin-bottom:14px;animation:float 3s ease-in-out infinite;}
.sync-dot{width:8px;height:8px;border-radius:50%;background:var(--green);box-shadow:0 0 8px var(--green);animation:pulse 2s infinite;flex-shrink:0;}
.sync-dot.saving{background:var(--yellow);box-shadow:0 0 8px var(--yellow);}
.sync-dot.error{background:var(--red);box-shadow:0 0 8px var(--red);}

/* ── ALERT BANNERS ── */
.alert-banner{display:flex;align-items:center;gap:10px;border-radius:12px;padding:11px 16px;font-size:13px;font-weight:600;margin-bottom:14px;}
.alert-warning{background:rgba(251,191,36,0.1);border:1px solid rgba(251,191,36,0.3);color:var(--yellow);}
.alert-danger{background:rgba(248,113,113,0.1);border:1px solid rgba(248,113,113,0.3);color:var(--red);}
.alert-success{background:rgba(74,222,128,0.1);border:1px solid rgba(74,222,128,0.3);color:var(--green);}

/* ── MODAL ── */
.modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.75);backdrop-filter:blur(14px);display:flex;align-items:center;justify-content:center;z-index:2000;padding:16px;}
.modal-box{background:linear-gradient(145deg,#110f24,#1a1635);border:1px solid var(--border2);border-radius:var(--r-lg);padding:28px;width:100%;max-width:480px;max-height:92vh;overflow-y:auto;box-shadow:0 32px 80px rgba(0,0,0,0.7);}

/* ── GRIDS ── */
.grid-2{display:grid;grid-template-columns:1fr 1fr;gap:10px;}
.grid-3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;}
.grid-4{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;}

/* ── TABS ── */
.tab-bar{display:flex;background:rgba(255,255,255,0.04);border-radius:14px;padding:4px;gap:2px;margin-bottom:20px;}
.tab-item{flex:1;padding:9px 10px;border-radius:11px;border:none;cursor:pointer;font-family:'Outfit',sans-serif;font-size:13px;font-weight:600;color:var(--text3);background:transparent;transition:all .2s;display:flex;align-items:center;justify-content:center;gap:5px;}
.tab-item.active{background:var(--glass3);color:var(--text);box-shadow:0 2px 8px rgba(0,0,0,0.3);}
.tab-item:hover:not(.active){color:var(--text2);background:rgba(255,255,255,0.03);}

/* ── FILTER BAR ── */
.filter-bar{display:flex;gap:6px;overflow-x:auto;padding-bottom:2px;scrollbar-width:none;flex-wrap:nowrap;}
.filter-bar::-webkit-scrollbar{display:none;}
.filter-chip{padding:5px 12px;border-radius:20px;border:1px solid var(--border);background:var(--glass);color:var(--text2);cursor:pointer;font-size:11px;font-weight:600;white-space:nowrap;flex-shrink:0;transition:all .15s;}
.filter-chip.active{border-color:rgba(167,139,250,0.5);background:rgba(167,139,250,0.12);color:var(--purple);}
.filter-chip:hover:not(.active){background:var(--glass2);}

/* ── BOTTOM NAV ── */
.bottom-nav{display:none;}

/* ── SCROLLBAR ── */
::-webkit-scrollbar{width:5px;height:5px;}
::-webkit-scrollbar-track{background:transparent;}
::-webkit-scrollbar-thumb{background:rgba(167,139,250,0.25);border-radius:3px;}
::-webkit-scrollbar-thumb:hover{background:rgba(167,139,250,0.45);}

/* ── ANIMATIONS ── */
@keyframes fadeUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
@keyframes fadeIn{from{opacity:0}to{opacity:1}}
@keyframes scaleIn{from{opacity:0;transform:scale(.95)}to{opacity:1;transform:scale(1)}}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
@keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
@keyframes spin{to{transform:rotate(360deg)}}
@keyframes shimmer{0%{background-position:-200% 0}100%{background-position:200% 0}}
@keyframes slideIn{from{opacity:0;transform:translateX(-8px)}to{opacity:1;transform:translateX(0)}}
.fade-up{animation:fadeUp .3s ease both;}
.fade-in{animation:fadeIn .2s ease both;}
.scale-in{animation:scaleIn .28s cubic-bezier(.34,1.56,.64,1) both;}
.slide-in{animation:slideIn .25s ease both;}
.stagger-1{animation-delay:.04s}.stagger-2{animation-delay:.08s}.stagger-3{animation-delay:.12s}.stagger-4{animation-delay:.16s}.stagger-5{animation-delay:.2s}
.float-icon{animation:float 3s ease-in-out infinite;}
.pulse-dot{animation:pulse 2s infinite;}
.spin{animation:spin .7s linear infinite;}

/* ── RECHARTS ── */
.rc-tooltip{background:#1a1635;border:1px solid rgba(255,255,255,0.15);border-radius:12px;padding:10px 14px;font-family:'Outfit',sans-serif;font-size:12px;color:var(--text);box-shadow:0 8px 24px rgba(0,0,0,0.4);}

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
    padding-bottom:calc(72px + env(safe-area-inset-bottom));
    padding-left:calc(14px + env(safe-area-inset-left));
    padding-right:calc(14px + env(safe-area-inset-right));
  }
  .bottom-nav{
    display:flex;position:fixed;bottom:0;left:0;right:0;
    background:rgba(7,6,15,0.97);backdrop-filter:blur(24px);
    border-top:1px solid var(--border);
    justify-content:space-around;
    padding-top:6px;
    padding-bottom:calc(10px + env(safe-area-inset-bottom));
    padding-left:env(safe-area-inset-left);
    padding-right:env(safe-area-inset-right);
    z-index:250;
  }
  .bnav-item{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;padding:4px 10px;border-radius:10px;cursor:pointer;transition:all .18s;font-size:9px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.3px;min-width:50px;position:relative;}
  .bnav-item.active{color:var(--purple);}
  .bnav-item.active .bnav-icon-wrap{background:rgba(167,139,250,0.15);border-radius:12px;}
  .bnav-icon{font-size:20px;}
  .bnav-icon-wrap{padding:4px 14px;border-radius:10px;transition:all .18s;}
  .topbar{
    padding-left:calc(16px + env(safe-area-inset-left));
    padding-right:calc(16px + env(safe-area-inset-right));
  }
}
@media(max-width:520px){
  .grid-2{grid-template-columns:1fr !important;}
  .grid-3{grid-template-columns:1fr 1fr !important;}
  .grid-4{grid-template-columns:1fr 1fr !important;}
  .modal-box{padding:20px;}
}
`;

// ═══════════════════════════════════════════════════════════
//  PASSWORD STRENGTH HELPER
// ═══════════════════════════════════════════════════════════
function getPasswordStrength(pwd) {
  if (!pwd) return { score: 0, label: "", color: "transparent" };
  let score = 0;
  if (pwd.length >= 6)  score++;
  if (pwd.length >= 10) score++;
  if (/[A-Z]/.test(pwd)) score++;
  if (/[0-9]/.test(pwd)) score++;
  if (/[^A-Za-z0-9]/.test(pwd)) score++;
  const levels = [
    { label: "",          color: "transparent" },
    { label: "Très faible", color: "#f87171" },
    { label: "Faible",    color: "#fb923c" },
    { label: "Moyen",     color: "#fbbf24" },
    { label: "Fort",      color: "#4ade80" },
    { label: "Très fort", color: "#2dd4bf" },
  ];
  return { score, ...levels[score] };
}

// ═══════════════════════════════════════════════════════════
//  AUTH SCREEN
// ═══════════════════════════════════════════════════════════
function AuthScreen() {
  // "login" | "register" | "reset"
  const [view, setView]         = useState("login");
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd]   = useState(false);
  const [error, setError]       = useState("");
  const [loading, setLoading]   = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const emailRef = useRef();

  // Reset state on view change
  const switchView = (v) => {
    setView(v); setError(""); setResetSent(false);
    setPassword(""); setShowPwd(false);
    setTimeout(() => emailRef.current?.focus(), 80);
  };

  useEffect(() => { emailRef.current?.focus(); }, []);

  const AUTH_ERRORS = {
    "auth/invalid-email":          "Adresse email invalide.",
    "auth/user-not-found":         "Aucun compte associé à cet email.",
    "auth/wrong-password":         "Mot de passe incorrect.",
    "auth/email-already-in-use":   "Cette adresse est déjà utilisée.",
    "auth/weak-password":          "Mot de passe trop court (6 caractères min).",
    "auth/invalid-credential":     "Email ou mot de passe incorrect.",
    "auth/too-many-requests":      "Trop de tentatives. Veuillez patienter.",
    "auth/network-request-failed": "Erreur réseau. Vérifiez votre connexion.",
  };

  const submit = async () => {
    setError(""); setLoading(true);
    try {
      if (view === "login") {
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        await createUserWithEmailAndPassword(auth, email, password);
      }
    } catch (e) {
      setError(AUTH_ERRORS[e.code] || "Une erreur est survenue.");
    }
    setLoading(false);
  };

  const sendReset = async () => {
    const trimmed = email.trim();
    if (!trimmed) { setError("Veuillez saisir votre adresse email."); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) { setError("Adresse email invalide."); return; }
    setError(""); setLoading(true);
    try {
      // Vérifie d'abord si un compte existe (fetchSignInMethodsForEmail retourne [] si aucun compte)
      let methods = [];
      try { methods = await fetchSignInMethodsForEmail(auth, trimmed); } catch {}
      if (!methods || methods.length === 0) {
        setError("Aucun compte n'est associé à cette adresse. Vérifiez l'email ou créez un compte.");
        setLoading(false);
        return;
      }
      await sendPasswordResetEmail(auth, trimmed);
      setResetSent(true);
    } catch (e) {
      setError(AUTH_ERRORS[e.code] || `Erreur inattendue (${e.code || e.message})`);
    }
    setLoading(false);
  };

  const pwdStrength = getPasswordStrength(password);

  // ── RESET VIEW ──
  if (view === "reset") {
    return (
      <div className="auth-shell">
        <style>{CSS}</style>
        <div className="auth-card scale-in" style={{ maxWidth: 400 }}>
          <button className="reset-back-btn" onClick={() => switchView("login")}>
            ← Retour à la connexion
          </button>

          {resetSent ? (
            /* ── SUCCESS STATE ── */
            <div style={{ textAlign: "center", padding: "10px 0 20px" }} className="fade-up">
              <div style={{ position: "relative", width: 80, height: 80, margin: "0 auto 24px" }}>
                <div style={{
                  width: 80, height: 80, borderRadius: "50%",
                  background: "radial-gradient(circle, rgba(74,222,128,0.2), rgba(74,222,128,0.05))",
                  border: "2px solid rgba(74,222,128,0.4)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  boxShadow: "0 0 30px rgba(74,222,128,0.2)",
                  animation: "scaleIn .4s cubic-bezier(.34,1.56,.64,1) both",
                }}>
                  <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
                    <path className="check-anim" d="M8 18l7 7 13-13" stroke="#4ade80" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
              </div>
              <div style={{ fontFamily: "'Fraunces',serif", fontSize: 24, fontWeight: 700, marginBottom: 10 }}>
                Email envoyé !
              </div>
              <p style={{ fontSize: 14, color: "var(--text2)", lineHeight: 1.6, marginBottom: 6 }}>
                Un lien de réinitialisation a été envoyé à
              </p>
              <div style={{
                display: "inline-block", background: "rgba(167,139,250,0.1)",
                border: "1px solid rgba(167,139,250,0.3)", borderRadius: 10,
                padding: "6px 14px", fontSize: 13, fontWeight: 700, color: "var(--purple)", marginBottom: 20,
              }}>{email}</div>

              {/* Checklist pour ne pas rater l'email */}
              <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--border)", borderRadius: 14, padding: "14px 16px", marginBottom: 20, textAlign: "left" }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: "var(--text3)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>Si vous ne recevez pas l'email :</div>
                {[
                  { icon: "📁", text: "Vérifiez votre dossier spam / courriers indésirables" },
                  { icon: "⏱️", text: "Attendez 1–2 minutes, le délai peut varier" },
                  { icon: "🔁", text: "Retournez en arrière et réessayez si nécessaire" },
                  { icon: "⚙️", text: "Si le problème persiste : Firebase Console → Authentication → Templates → vérifiez que l'email « Password reset » est activé" },
                ].map((item, i) => (
                  <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start", marginBottom: i < 3 ? 8 : 0 }}>
                    <span style={{ fontSize: 14, flexShrink: 0, marginTop: 1 }}>{item.icon}</span>
                    <span style={{ fontSize: 12, color: "var(--text2)", lineHeight: 1.5 }}>{item.text}</span>
                  </div>
                ))}
              </div>

              <button className="btn btn-primary" onClick={() => switchView("login")}
                style={{ width: "100%", justifyContent: "center", padding: "13px", fontSize: 14 }}>
                🔑 Retour à la connexion
              </button>
              <button onClick={() => { setResetSent(false); setError(""); }}
                style={{ marginTop: 10, width: "100%", background: "none", border: "none", color: "var(--text3)", cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: "'Outfit',sans-serif" }}>
                ↩ Renvoyer l'email
              </button>
            </div>
          ) : (
            /* ── RESET FORM ── */
            <>
              <div style={{ textAlign: "center", marginBottom: 28 }}>
                <div style={{
                  width: 64, height: 64, borderRadius: 20, margin: "0 auto 16px",
                  background: "linear-gradient(135deg,rgba(167,139,250,0.2),rgba(244,114,182,0.2))",
                  border: "1px solid rgba(167,139,250,0.3)",
                  display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28,
                }}>🔐</div>
                <div style={{ fontFamily: "'Fraunces',serif", fontSize: 24, fontWeight: 700, marginBottom: 8 }}>
                  Mot de passe oublié ?
                </div>
                <p style={{ fontSize: 13, color: "var(--text2)", lineHeight: 1.6 }}>
                  Entrez votre email et nous vous enverrons un lien pour créer un nouveau mot de passe.
                </p>
              </div>

              <div className="auth-field">
                <label>Adresse email</label>
                <span className="field-icon">✉️</span>
                <input ref={emailRef} type="email" value={email} onChange={e => setEmail(e.target.value)}
                  placeholder="vous@email.com" autoComplete="email"
                  onKeyDown={e => e.key === "Enter" && sendReset()}/>
              </div>

              {error && (
                <div className="alert-banner alert-danger" style={{ marginBottom: 16 }}>⚠️ {error}</div>
              )}

              <button className="btn btn-primary" onClick={sendReset}
                disabled={loading || !email.trim()}
                style={{ width: "100%", justifyContent: "center", padding: "14px", fontSize: 15, marginTop: 4 }}>
                {loading
                  ? <><span className="spin" style={{ display:"inline-block",fontSize:16 }}>⟳</span> Envoi en cours…</>
                  : "📨 Envoyer le lien de réinitialisation"}
              </button>

              <div style={{ marginTop: 20, padding: "14px 16px", background: "rgba(255,255,255,0.03)", border: "1px solid var(--border)", borderRadius: 12, display: "flex", gap: 10, alignItems: "flex-start" }}>
                <span style={{ fontSize: 16, flexShrink: 0, marginTop: 1 }}>💡</span>
                <p style={{ fontSize: 12, color: "var(--text3)", lineHeight: 1.6, margin: 0 }}>
                  Le lien est valable <strong style={{ color: "var(--text2)" }}>1 heure</strong>. Si votre compte existe, vous recevrez un email dans quelques secondes.
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  // ── LOGIN / REGISTER VIEW ──
  const isLogin = view === "login";

  return (
    <div className="auth-shell">
      <style>{CSS}</style>
      <div className="auth-card scale-in">

        {/* ── HEADER ── */}
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{
            width: 72, height: 72, borderRadius: 22, margin: "0 auto 16px",
            background: "var(--grad-main)", display: "flex", alignItems: "center",
            justifyContent: "center", fontSize: 32,
            boxShadow: "0 8px 32px rgba(167,139,250,0.4), 0 0 0 1px rgba(255,255,255,0.08)",
            animation: "float 3s ease-in-out infinite",
          }}>💑</div>
          <div className="glow-text" style={{ fontFamily: "'Fraunces',serif", fontSize: 32, fontWeight: 700, lineHeight: 1 }}>DuoBudget</div>
          <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 6, letterSpacing: .3 }}>
            {isLogin ? "Bon retour 👋 Connectez-vous à votre espace" : "Créez votre espace financier à deux"}
          </div>
        </div>

        {/* ── TAB SWITCHER ── */}
        <div style={{ display: "flex", gap: 3, marginBottom: 26, background: "rgba(255,255,255,0.04)", borderRadius: 14, padding: 4 }}>
          {[["login", "🔑", "Connexion"], ["register", "✨", "Créer un compte"]].map(([v, icon, label]) => (
            <button key={v} onClick={() => switchView(v)} style={{
              flex: 1, padding: "10px 8px", borderRadius: 11, border: "none", cursor: "pointer",
              background: view === v ? "var(--grad-main)" : "transparent",
              color: view === v ? "white" : "var(--text3)",
              fontFamily: "'Outfit',sans-serif", fontWeight: 700, fontSize: 13,
              transition: "all .25s", display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              boxShadow: view === v ? "0 4px 14px rgba(167,139,250,0.35)" : "none",
            }}><span>{icon}</span>{label}</button>
          ))}
        </div>

        {/* ── EMAIL FIELD ── */}
        <div className="auth-field">
          <label>Adresse email</label>
          <span className="field-icon">✉️</span>
          <input ref={emailRef} type="email" value={email} onChange={e => setEmail(e.target.value)}
            placeholder="vous@email.com" autoComplete="email"
            onKeyDown={e => e.key === "Enter" && submit()}/>
        </div>

        {/* ── PASSWORD FIELD ── */}
        <div className="auth-field" style={{ marginBottom: view === "register" ? 6 : 4 }}>
          <label>Mot de passe</label>
          <span className="field-icon">🔒</span>
          <input type={showPwd ? "text" : "password"} value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder={isLogin ? "••••••••" : "Minimum 6 caractères"}
            autoComplete={isLogin ? "current-password" : "new-password"}
            onKeyDown={e => e.key === "Enter" && submit()}
            style={{ paddingRight: 44 }}/>
          <button className="eye-btn" onClick={() => setShowPwd(v => !v)} type="button" tabIndex={-1}>
            {showPwd ? "🙈" : "👁️"}
          </button>
        </div>

        {/* ── PASSWORD STRENGTH (register only) ── */}
        {view === "register" && password.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div className="pwd-strength">
              {[1,2,3,4,5].map(i => (
                <div key={i} className="pwd-strength-bar" style={{
                  background: i <= pwdStrength.score ? pwdStrength.color : "rgba(255,255,255,0.07)",
                }}/>
              ))}
            </div>
            {pwdStrength.label && (
              <div style={{ fontSize: 11, color: pwdStrength.color, marginTop: 5, fontWeight: 600, textAlign: "right" }}>
                {pwdStrength.label}
              </div>
            )}
          </div>
        )}

        {/* ── FORGOT PASSWORD LINK (login only) ── */}
        {isLogin && (
          <div style={{ textAlign: "right", marginBottom: 20, marginTop: 4 }}>
            <button onClick={() => switchView("reset")} style={{
              background: "none", border: "none", color: "var(--purple)", cursor: "pointer",
              fontFamily: "'Outfit',sans-serif", fontSize: 12, fontWeight: 600, padding: 0,
              transition: "opacity .2s",
            }}
              onMouseEnter={e => e.target.style.opacity = ".7"}
              onMouseLeave={e => e.target.style.opacity = "1"}>
              Mot de passe oublié ?
            </button>
          </div>
        )}

        {/* ── ERROR ── */}
        {error && (
          <div className="alert-banner alert-danger" style={{ marginBottom: 16 }}>⚠️ {error}</div>
        )}

        {/* ── SUBMIT ── */}
        <button className="btn btn-primary" onClick={submit}
          disabled={loading || !email || !password || (view === "register" && pwdStrength.score < 1)}
          style={{ width: "100%", justifyContent: "center", padding: "14px", fontSize: 15, marginTop: view === "register" ? 4 : 0 }}>
          {loading
            ? <><span className="spin" style={{ display:"inline-block",fontSize:16 }}>⟳</span> En cours…</>
            : isLogin ? "🔑 Se connecter" : "🚀 Créer mon compte"}
        </button>

        {/* ── DIVIDER ── */}
        <div className="auth-divider">Sécurisé par Firebase</div>

        {/* ── FEATURE PILLS ── */}
        <div className="auth-features">
          {[["🔒","Chiffrement E2E"],["☁️","Sync temps réel"],["📱","PC & Mobile"]].map(([icon,label]) => (
            <div key={label} className="auth-feature-pill"><span>{icon}</span>{label}</div>
          ))}
        </div>

      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
//  ROOT
// ═══════════════════════════════════════════════════════════
export default function App() {
  const [user, setUser] = useState(undefined);
  const [data, setData] = useState(INIT);
  const [ready, setReady] = useState(false);
  const [syncStatus, setSyncStatus] = useState("synced");
  const [page, setPage] = useState("dashboard");
  const [selMonth, setSelMonth] = useState(curMonthKey());
  const [modal, setModal] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const saveTimer = useRef(null);
  const isSaving = useRef(false);
  const localVersion = useRef(0);

  // Auth
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, u => setUser(u || null));
    return unsub;
  }, []);

  // Load + realtime listener — corrigé anti-boucle
  useEffect(() => {
    if (!user) { setReady(false); return; }
    let unsub;
    let remoteTs = 0;

    firestoreLoad(user.uid).then(saved => {
      if (saved) {
        const { data: processed } = processDueBills(saved);
        setData(processed);
        remoteTs = saved._ts || 0;
      }
      setReady(true);

      unsub = onSnapshot(getDocRef(user.uid), snap => {
        if (!snap.exists()) return;
        const remote = snap.data().budget;
        const ts = snap.data()._ts || 0;
        // N'appliquer que si c'est un vrai changement distant (pas notre propre save)
        if (ts > remoteTs && !isSaving.current) {
          remoteTs = ts;
          const { data: processed } = processDueBills(remote);
          setData(processed);
        }
      });
    });
    return () => unsub && unsub();
  }, [user]);

  // Save debounced 600ms
  useEffect(() => {
    if (!ready || !user) return;
    const ver = ++localVersion.current;
    setSyncStatus("saving");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      if (ver !== localVersion.current) return; // version plus récente en attente
      isSaving.current = true;
      const ok = await firestoreSave(user.uid, data);
      isSaving.current = false;
      setSyncStatus(ok ? "synced" : "error");
    }, 600);
    return () => clearTimeout(saveTimer.current);
  }, [data, ready, user]);

  // Process bills auto every 60s
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
    return { ...md, incomes: md.incomes || { p1: 0, p2: 0, common: 0 } };
  }, [data.monthsData, selMonth]);

  // Loading
  if (user === undefined) return (
    <div style={{ position:"fixed",inset:0,display:"flex",alignItems:"center",justifyContent:"center",background:"var(--bg)" }}>
      <style>{CSS}</style>
      <div style={{ textAlign:"center" }}>
        <div style={{ fontSize:56,marginBottom:14,animation:"float 2s ease-in-out infinite" }}>💑</div>
        <div className="glow-text" style={{ fontFamily:"'Fraunces',serif",fontSize:28 }}>Chargement…</div>
      </div>
    </div>
  );

  if (!user) return <AuthScreen />;

  if (!ready) return (
    <div style={{ position:"fixed",inset:0,display:"flex",alignItems:"center",justifyContent:"center",background:"var(--bg)" }}>
      <style>{CSS}</style>
      <div style={{ textAlign:"center" }}>
        <div style={{ fontSize:52,marginBottom:12,animation:"float 2s ease-in-out infinite" }}>☁️</div>
        <div className="glow-text" style={{ fontFamily:"'Fraunces',serif",fontSize:22 }}>Synchronisation…</div>
        <div style={{ fontSize:13,color:"var(--text3)",marginTop:6 }}>{user.email}</div>
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
  const overdueBills = data.bills.filter(b => {
    if (b.paid?.[selMonth]) return false;
    return b.dueDate && new Date(b.dueDate) < new Date();
  }).length;

  const navItems = [
    { id:"dashboard", icon:"🏠", label:"Accueil" },
    { id:"incomes",   icon:"💵", label:"Revenus" },
    { id:"expenses",  icon:"💳", label:"Dépenses" },
    { id:"bills",     icon:"📋", label:"Factures", badge: unpaidBills },
    { id:"stats",     icon:"📊", label:"Stats" },
    { id:"settings",  icon:"⚙️", label:"Réglages" },
  ];

  const navigate = id => { setPage(id); setSidebarOpen(false); };
  const pageTitles = {
    dashboard:"Tableau de bord", incomes:"Revenus", expenses:"Dépenses",
    bills:"Factures", stats:"Statistiques", settings:"Réglages"
  };
  const syncLabel = { synced:"Synchronisé ✓", saving:"Sauvegarde…", error:"Erreur sync !" };
  const syncColor = { synced:"var(--green)", saving:"var(--yellow)", error:"var(--red)" };

  return (
    <>
      <style>{CSS}</style>
      <div className="app-shell">
        <div className={`sidebar-overlay ${sidebarOpen ? "open":""}`} onClick={() => setSidebarOpen(false)} />

        {/* ── SIDEBAR ── */}
        <aside className={`sidebar ${sidebarOpen ? "open":""}`}>
          {/* Logo */}
          <div style={{ padding:"22px 18px 16px", borderBottom:"1px solid var(--border)" }}>
            <div style={{ display:"flex", alignItems:"center", gap:12 }}>
              <div style={{ width:42, height:42, borderRadius:13, background:"var(--grad-main)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, boxShadow:"0 4px 18px rgba(167,139,250,0.5)", flexShrink:0 }}>💑</div>
              <div>
                <div className="glow-text" style={{ fontFamily:"'Fraunces',serif", fontSize:22, fontWeight:700, lineHeight:1 }}>DuoBudget</div>
                <div style={{ fontSize:9, color:"var(--text3)", letterSpacing:1.4, textTransform:"uppercase", marginTop:3 }}>Finance à deux</div>
              </div>
            </div>
          </div>

          {/* Month selector */}
          <div style={{ padding:"12px 14px", borderBottom:"1px solid var(--border)" }}>
            <div style={{ fontSize:10, color:"var(--text3)", textTransform:"uppercase", letterSpacing:1, fontWeight:700, marginBottom:6 }}>Période</div>
            <select value={selMonth} onChange={e => setSelMonth(e.target.value)} style={{ background:"rgba(167,139,250,0.08)", border:"1px solid rgba(167,139,250,0.22)", borderRadius:10, color:"var(--text)", padding:"8px 12px", fontSize:12, fontWeight:700, cursor:"pointer", width:"100%" }}>
              {allMonths.map(k => <option key={k} value={k}>{monthLabel(k)}</option>)}
            </select>
          </div>

          {/* Sync status */}
          <div style={{ padding:"8px 14px", borderBottom:"1px solid var(--border)", display:"flex", alignItems:"center", gap:7 }}>
            <div className={`sync-dot ${syncStatus}`}/>
            <span style={{ fontSize:11, color:syncColor[syncStatus], fontWeight:700 }}>{syncLabel[syncStatus]}</span>
          </div>

          {/* Nav */}
          <nav style={{ flex:1, paddingTop:8, overflowY:"auto" }}>
            <div className="nav-section-label">Navigation</div>
            {navItems.slice(0,5).map(n => (
              <div key={n.id} className={`nav-item ${page===n.id?"active":""}`} onClick={() => navigate(n.id)}>
                <div style={{ width:30, height:30, borderRadius:9, background: page===n.id ? "rgba(167,139,250,0.15)" : "rgba(255,255,255,0.04)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:15, flexShrink:0, transition:"all .2s" }}>
                  {n.icon}
                </div>
                <span style={{ flex:1 }}>{n.label}</span>
                {n.badge > 0 && (
                  <span className="nav-badge" style={{ background:overdueBills>0?"rgba(248,113,113,0.2)":undefined, color:overdueBills>0?"var(--red)":undefined }}>
                    {overdueBills > 0 ? "⚠️ " : ""}{n.badge}
                  </span>
                )}
              </div>
            ))}
            <div className="nav-section-label" style={{ marginTop:10 }}>Système</div>
            <div className={`nav-item ${page==="settings"?"active":""}`} onClick={() => navigate("settings")}>
              <div style={{ width:30, height:30, borderRadius:9, background: page==="settings" ? "rgba(167,139,250,0.15)" : "rgba(255,255,255,0.04)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:15, flexShrink:0 }}>⚙️</div>
              <span>Réglages</span>
            </div>
          </nav>

          {/* Profiles + logout */}
          <div style={{ padding:"12px 14px", borderTop:"1px solid var(--border)" }}>
            <div style={{ display:"flex", gap:7, marginBottom:10 }}>
              {data.profiles.filter(p => p.id !== "common").map(p => (
                <div key={p.id} style={{ flex:1, display:"flex", alignItems:"center", gap:7, padding:"9px 10px", borderRadius:11, background:`${p.color}0e`, border:`1px solid ${p.color}28` }}>
                  <span style={{ fontSize:18 }}>{p.avatar}</span>
                  <div style={{ minWidth:0 }}>
                    <div style={{ fontSize:11, fontWeight:800, color:p.color, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{p.name}</div>
                    <div style={{ fontSize:9.5, color:"var(--text3)" }}>
                      {fmt((mdata(selMonth).incomes[p.id]||0))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <button onClick={() => signOut(auth)} style={{ width:"100%", background:"rgba(248,113,113,0.07)", border:"1px solid rgba(248,113,113,0.18)", borderRadius:10, color:"var(--red)", cursor:"pointer", fontSize:12, fontWeight:700, padding:"9px", fontFamily:"'Outfit',sans-serif", transition:"all .2s", display:"flex", alignItems:"center", justifyContent:"center", gap:6 }}
              onMouseEnter={e => e.currentTarget.style.background="rgba(248,113,113,0.14)"}
              onMouseLeave={e => e.currentTarget.style.background="rgba(248,113,113,0.07)"}>
              🚪 Déconnexion
            </button>
          </div>
        </aside>
        </aside>

        {/* ── MAIN ── */}
        <div className="main-area">
          <div className="topbar">
            <button className="menu-btn" onClick={() => setSidebarOpen(o => !o)} aria-label="Menu">☰</button>
            <div style={{ fontFamily:"'Fraunces',serif",fontSize:20,fontWeight:700,color:"var(--text)",flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>
              {pageTitles[page]}
            </div>
            <div style={{ display:"flex",alignItems:"center",gap:8,flexShrink:0 }}>
              {page === "expenses" && (
                <>
                  <button className="btn btn-ghost btn-sm" onClick={() => exportCSV(mdata(selMonth).transactions, data.categories, data.profiles, selMonth)} title="Exporter CSV">📥</button>
                  <button className="btn btn-primary btn-sm" onClick={() => setModal({ type:"addTransaction",selMonth })}>+ Dépense</button>
                </>
              )}
              {page === "bills"   && <button className="btn btn-primary btn-sm" onClick={() => setModal({ type:"addBill" })}>+ Facture</button>}
              {page === "incomes" && <button className="btn btn-primary btn-sm" onClick={() => setModal({ type:"addRecurringIncome" })}>+ Récurrent</button>}
              <div className={`sync-dot ${syncStatus}`} title={syncLabel[syncStatus]} />
              <LiveClock />
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
            <div key={n.id} className={`bnav-item ${page===n.id?"active":""}`} onClick={() => navigate(n.id)}>
              <div className="bnav-icon-wrap">
                <span className="bnav-icon">{n.icon}</span>
              </div>
              <span>{n.label}</span>
              {n.badge > 0 && <span style={{ position:"absolute",top:2,right:4,background:overdueBills>0?"var(--red)":"rgba(251,191,36,0.85)",color:"white",borderRadius:10,padding:"0 5px",fontSize:9,fontWeight:800 }}>{n.badge}</span>}
            </div>
          ))}
        </nav>

        {modal && <ModalRouter modal={modal} setModal={setModal} data={data} update={update} selMonth={selMonth} />}
      </div>
    </>
  );
}

// ═══════════════════════════════════════════════════════════
//  SETUP
// ═══════════════════════════════════════════════════════════
function SetupScreen({ update }) {
  const [p1, setP1] = useState({ name:"", avatar:"😊" });
  const [p2, setP2] = useState({ name:"", avatar:"🥰" });
  const go = () => {
    if (!p1.name.trim() || !p2.name.trim()) return;
    update(d => {
      d.profiles = [
        { id:"p1", name:p1.name.trim(), avatar:p1.avatar, color:"#a78bfa" },
        { id:"p2", name:p2.name.trim(), avatar:p2.avatar, color:"#f472b6" },
        { id:"common", name:"Compte commun", avatar:"🏦", color:"#60a5fa" },
      ];
    });
  };
  return (
    <div style={{ position:"fixed",inset:0,display:"flex",alignItems:"center",justifyContent:"center",padding:24,
      background:`radial-gradient(ellipse 80% 60% at 50% 0%,rgba(167,139,250,0.2),transparent 70%),var(--bg)` }}>
      <div style={{ maxWidth:700,width:"100%",textAlign:"center" }} className="fade-up">
        <div style={{ fontSize:68,marginBottom:12,animation:"float 3s ease-in-out infinite" }}>💑</div>
        <h1 style={{ fontFamily:"'Fraunces',serif",fontSize:46,marginBottom:8 }} className="glow-text">DuoBudget</h1>
        <p style={{ color:"var(--text2)",marginBottom:36,fontSize:15 }}>Créez vos profils pour commencer l'aventure financière</p>
        <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:18,marginBottom:26 }}>
          <div className="glass" style={{ padding:26,borderRadius:22 }}><ProfileSetup label="Profil 1" emoji="💜" color="#a78bfa" value={p1} onChange={setP1}/></div>
          <div className="glass" style={{ padding:26,borderRadius:22 }}><ProfileSetup label="Profil 2" emoji="🩷" color="#f472b6" value={p2} onChange={setP2}/></div>
        </div>
        <button className="btn btn-primary" onClick={go} disabled={!p1.name.trim()||!p2.name.trim()}
          style={{ padding:"14px 52px",fontSize:16,opacity:(!p1.name.trim()||!p2.name.trim())?0.4:1 }}>
          🚀 Commencer l'aventure
        </button>
      </div>
    </div>
  );
}

function ProfileSetup({ label, emoji, color, value, onChange }) {
  return (
    <div>
      <div style={{ fontWeight:700,fontSize:14,marginBottom:14,color }}>{emoji} {label}</div>
      <div style={{ fontSize:56,marginBottom:14 }}>{value.avatar}</div>
      <input value={value.name} onChange={e => onChange(v => ({ ...v, name:e.target.value }))}
        placeholder="Ton prénom…" style={{ marginBottom:14,textAlign:"center",fontSize:15 }}/>
      <div style={{ display:"flex",flexWrap:"wrap",gap:5,justifyContent:"center" }}>
        {AVATARS.map(a => (
          <button key={a} onClick={() => onChange(v => ({ ...v, avatar:a }))} style={{
            fontSize:18, background:value.avatar===a?`${color}25`:"rgba(255,255,255,0.05)",
            border:`2px solid ${value.avatar===a?color:"transparent"}`,
            borderRadius:9,width:38,height:38,cursor:"pointer",transition:"all .15s",
          }}>{a}</button>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
//  SMART TIMESTAMP  (lisible : "Aujourd'hui à 22:55:13")
// ═══════════════════════════════════════════════════════════
function smartDate(iso) {
  if (!iso) return "—";
  const d   = new Date(iso);
  const now = new Date();
  const hms = pad(d.getHours())+":"+pad(d.getMinutes())+":"+pad(d.getSeconds());
  const diffDays = Math.floor((now - d) / 86400000);
  if (diffDays === 0)  return "Aujourd'hui à " + hms;
  if (diffDays === 1)  return "Hier à " + hms;
  if (diffDays === 2)  return "Avant-hier à " + hms;
  return d.toLocaleDateString("fr-FR",{ day:"2-digit", month:"short",
    year: d.getFullYear()!==now.getFullYear()?"numeric":undefined }) + " à " + hms;
}

// ═══════════════════════════════════════════════════════════
//  DASHBOARD RECENT TRANSACTIONS (with search)
// ═══════════════════════════════════════════════════════════
function DashboardRecentTx({ transactions, catMap, profMap }) {
  const [search, setSearch]   = useState("");
  const [expanded, setExpanded] = useState(false);

  const filtered = useMemo(() => {
    const sorted = [...transactions].sort((a,b) => new Date(b.timestamp)-new Date(a.timestamp));
    if (!search.trim()) return expanded ? sorted : sorted.slice(0,5);
    const q = search.toLowerCase();
    return sorted.filter(tx =>
      tx.label.toLowerCase().includes(q) ||
      (catMap[tx.categoryId]?.name||"").toLowerCase().includes(q) ||
      (profMap[tx.profileId]?.name||"").toLowerCase().includes(q)
    );
  }, [transactions, search, expanded, catMap, profMap]);

  return (
    <>
      {/* Header */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16 }}>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <div style={{ width:36, height:36, borderRadius:11, background:"rgba(167,139,250,0.12)", border:"1px solid rgba(167,139,250,0.2)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:17 }}>🕐</div>
          <div>
            <div style={{ fontWeight:800, fontSize:15 }}>Dernières transactions</div>
            <div style={{ fontSize:11, color:"var(--text3)", marginTop:1 }}>{transactions.length} ce mois</div>
          </div>
        </div>
        {transactions.length > 0 && (
          <div style={{ fontFamily:"'Fraunces',serif", fontSize:17, fontWeight:800, color:"var(--red)" }}>
            -{fmt(transactions.reduce((s,t)=>s+t.amount,0))}
          </div>
        )}
      </div>

      {/* Search */}
      {transactions.length > 0 && (
        <div style={{ position:"relative", marginBottom:14 }}>
          <span style={{ position:"absolute", left:13, top:"50%", transform:"translateY(-50%)", fontSize:13, pointerEvents:"none", opacity:.4 }}>🔍</span>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Filtrer les transactions…"
            style={{ paddingLeft:36, background:"rgba(255,255,255,0.04)", border:"1px solid var(--border)", borderRadius:11, fontSize:12.5, padding:"9px 13px 9px 36px" }}/>
          {search && <button onClick={() => setSearch("")} style={{ position:"absolute", right:10, top:"50%", transform:"translateY(-50%)", background:"none", border:"none", cursor:"pointer", color:"var(--text3)", fontSize:17, lineHeight:1 }}>×</button>}
        </div>
      )}

      {/* Rows */}
      {transactions.length === 0 ? (
        <div className="empty-state" style={{ padding:"32px 16px" }}>
          <div className="empty-icon">💸</div>
          <div style={{ fontSize:14, fontWeight:700 }}>Aucune transaction ce mois</div>
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ padding:"20px", textAlign:"center", color:"var(--text3)", fontSize:13 }}>Aucun résultat pour « {search} »</div>
      ) : (
        <div style={{ display:"flex", flexDirection:"column", gap:7 }}>
          {filtered.map(tx => {
            const cat  = catMap[tx.categoryId]  || { icon:"❓", color:"#888", name:"Autre" };
            const prof = profMap[tx.profileId]  || { avatar:"❓", name:"?", color:"#888" };
            return (
              <div key={tx.id} style={{
                display:"flex", alignItems:"center", gap:14, padding:"13px 14px",
                borderRadius:14, background:"rgba(255,255,255,0.025)",
                border:"1px solid rgba(255,255,255,0.06)", transition:"all .15s",
              }}
                onMouseEnter={e=>{ e.currentTarget.style.background="rgba(255,255,255,0.05)"; e.currentTarget.style.borderColor="rgba(255,255,255,0.1)"; }}
                onMouseLeave={e=>{ e.currentTarget.style.background="rgba(255,255,255,0.025)"; e.currentTarget.style.borderColor="rgba(255,255,255,0.06)"; }}>

                {/* Icon + profile badge */}
                <div style={{ width:48, height:48, borderRadius:14, flexShrink:0, background:`${cat.color}14`, border:`1.5px solid ${cat.color}28`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:23, position:"relative" }}>
                  {cat.icon}
                  <div style={{ position:"absolute", bottom:-3, right:-3, width:18, height:18, borderRadius:"50%", background:prof.color||"#444", border:"2px solid #0e0c1e", display:"flex", alignItems:"center", justifyContent:"center", fontSize:9 }}>{prof.avatar}</div>
                </div>

                {/* Info */}
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontWeight:700, fontSize:15, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", marginBottom:5 }}>{tx.label}</div>
                  <div style={{ display:"flex", alignItems:"center", gap:7, flexWrap:"wrap" }}>
                    <span style={{ display:"inline-flex", alignItems:"center", gap:3, background:`${cat.color}12`, border:`1px solid ${cat.color}22`, borderRadius:20, padding:"2px 9px", fontSize:11, fontWeight:700, color:cat.color }}>
                      {cat.icon} {cat.name}
                    </span>
                    <span style={{ display:"inline-flex", alignItems:"center", gap:4, background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.08)", borderRadius:20, padding:"2px 9px", fontSize:11, fontWeight:600, color:"var(--text3)" }}>
                      🕐 {smartDate(tx.timestamp)}
                    </span>
                  </div>
                </div>

                {/* Amount */}
                <div style={{ textAlign:"right", flexShrink:0 }}>
                  <div style={{ fontFamily:"'Fraunces',serif", fontWeight:800, fontSize:18, color:"var(--red)" }}>
                    -{fmt(tx.amount)}
                  </div>
                  {tx.auto && <div style={{ fontSize:9.5, color:"var(--purple)", fontWeight:800, marginTop:2, letterSpacing:.5 }}>AUTO</div>}
                </div>
              </div>
            );
          })}
          {!search && transactions.length > 5 && (
            <button onClick={() => setExpanded(e => !e)} style={{
              width:"100%", marginTop:4, background:"rgba(255,255,255,0.025)", border:"1px solid var(--border)",
              borderRadius:11, color:"var(--text3)", cursor:"pointer", fontSize:12, fontWeight:700,
              padding:"10px", fontFamily:"'Outfit',sans-serif", transition:"all .2s",
            }}>
              {expanded ? "▲ Réduire" : `▼ Voir les ${transactions.length-5} autres transactions`}
            </button>
          )}
        </div>
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════
//  DASHBOARD
// ═══════════════════════════════════════════════════════════
function Dashboard({ data, update, selMonth, mdata, setModal, allMonths }) {
  const md = mdata(selMonth);
  const { incomes, transactions } = md;
  const [balanceView, setBalanceView] = useState("global");

  const catMap  = useMemo(() => Object.fromEntries(data.categories.map(c=>[c.id,c])), [data.categories]);
  const profMap = useMemo(() => Object.fromEntries(data.profiles.map(p=>[p.id,p])), [data.profiles]);

  const totalIncome = useMemo(() => (incomes.p1||0)+(incomes.p2||0)+(incomes.common||0), [incomes]);
  const totalExp    = useMemo(() => transactions.reduce((s,t) => s+t.amount, 0), [transactions]);

  const viewData = useMemo(() => {
    if (balanceView === "global") return { inc:totalIncome, exp:totalExp, label:"Global — tous les comptes", color:null };
    const prof = data.profiles.find(p => p.id === balanceView);
    const inc  = incomes[balanceView] || 0;
    const exp  = transactions.filter(t => t.profileId===balanceView).reduce((s,t)=>s+t.amount,0);
    return { inc, exp, label:prof?`${prof.avatar} ${prof.name}`:balanceView, color:prof?.color||null };
  }, [balanceView, totalIncome, totalExp, incomes, transactions, data.profiles]);

  const balance = viewData.inc - viewData.exp;
  const pct     = viewData.inc > 0 ? Math.min(100,(viewData.exp/viewData.inc)*100) : 0;
  const isPos   = balance >= 0;

  const catTotals = useMemo(() => {
    const m = {};
    transactions.forEach(t => { m[t.categoryId]=(m[t.categoryId]||0)+t.amount; });
    return m;
  }, [transactions]);
  const topCats = useMemo(() => Object.entries(catTotals).sort((a,b)=>b[1]-a[1]).slice(0,6), [catTotals]);
  const pieData = useMemo(() => topCats.map(([cid,val]) => ({
    name:(catMap[cid]?.icon||"")+" "+(catMap[cid]?.name||cid), value:val, color:catMap[cid]?.color||"#888"
  })), [topCats,catMap]);

  const unpaid  = useMemo(() => data.bills.filter(b => !b.paid?.[selMonth]).sort((a,b)=>{ if(!a.dueDate)return 1; if(!b.dueDate)return -1; return new Date(a.dueDate)-new Date(b.dueDate); }), [data.bills,selMonth]);
  const paid    = useMemo(() => data.bills.filter(b =>  b.paid?.[selMonth]), [data.bills,selMonth]);
  const overdue = useMemo(() => unpaid.filter(b => b.dueDate && new Date(b.dueDate) < new Date()), [unpaid]);

  const today       = new Date();
  const daysInMonth = new Date(today.getFullYear(),today.getMonth()+1,0).getDate();
  const dayOfMonth  = today.getDate();
  const projectedExp = dayOfMonth > 0 ? (totalExp/dayOfMonth)*daysInMonth : 0;
  const isCurMonth  = selMonth === curMonthKey();

  const CT = ({ active, payload }) => {
    if (!active||!payload?.length) return null;
    const d = payload[0];
    return <div className="rc-tooltip"><div style={{ fontWeight:700 }}>{d.name}</div><div style={{ color:d.payload.color }}>{fmt(d.value)}</div></div>;
  };

  const fmtDue = iso => {
    if (!iso) return null;
    const d    = new Date(iso);
    const diff = Math.ceil((d - new Date()) / 86400000);
    const lbl  = d.toLocaleDateString("fr-FR",{ day:"numeric", month:"short" });
    if (diff < 0)  return { text:`${lbl} · En retard`,  color:"var(--red)" };
    if (diff === 0) return { text:"Échéance aujourd'hui", color:"var(--red)" };
    if (diff <= 3) return { text:`${lbl} · dans ${diff}j`, color:"var(--orange)" };
    if (diff <= 7) return { text:`${lbl} · dans ${diff}j`, color:"var(--yellow)" };
    return { text:lbl, color:"var(--text3)" };
  };

  return (
    <div className="fade-up">
      {/* Alerts */}
      {pct >= 80 && viewData.inc > 0 && (
        <div className={`alert-banner ${pct>=100?"alert-danger":"alert-warning"}`} style={{ marginBottom:14 }}>
          {pct>=100?"🔴":"⚠️"}
          <span>{pct>=100?"Budget dépassé !":`Budget utilisé à ${Math.round(pct)}% — restez vigilant`}</span>
        </div>
      )}
      {overdue.length > 0 && (
        <div className="alert-banner alert-danger" style={{ marginBottom:14 }}>
          ⏰ <span>{overdue.length} facture{overdue.length>1?"s":""} en retard de paiement !</span>
        </div>
      )}

      {/* ── PROFILE CARDS (cliquables → filtre balance) ── */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:12, marginBottom:20 }}>
        {data.profiles.map((p,i) => {
          const inc     = incomes[p.id] || 0;
          const spent   = transactions.filter(t=>t.profileId===p.id).reduce((s,t)=>s+t.amount,0);
          const sel     = balanceView === p.id;
          return (
            <div key={p.id} onClick={() => setBalanceView(sel?"global":p.id)}
              style={{
                padding:"15px 16px", borderRadius:15, cursor:"pointer",
                background: sel ? `${p.color}12` : "var(--glass)",
                border:`1.5px solid ${sel?p.color+"50":"var(--border)"}`,
                boxShadow: sel ? `0 0 20px ${p.color}18` : "none",
                transition:"all .2s", position:"relative",
              }}>
              <div style={{ position:"absolute", top:10, right:10, width:6, height:6, borderRadius:"50%", background:p.color, boxShadow:`0 0 7px ${p.color}` }}/>
              <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:8 }}>
                <div style={{ width:38, height:38, borderRadius:11, background:`${p.color}18`, border:`1px solid ${p.color}30`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:20 }}>{p.avatar}</div>
                <div>
                  <div style={{ fontWeight:800, fontSize:13 }}>{p.name}</div>
                  <div style={{ fontSize:9.5, color:"var(--text3)", textTransform:"uppercase", letterSpacing:.5 }}>{p.id==="common"?"Commun":"Revenu"}</div>
                </div>
              </div>
              <div style={{ fontFamily:"'Fraunces',serif", fontSize:20, fontWeight:800, color:inc>0?"var(--green)":"var(--text3)" }}>
                {inc>0?`+${fmt(inc)}`:"—"}
              </div>
              {p.id!=="common" && spent>0 && <div style={{ fontSize:11, color:"var(--text3)", marginTop:2 }}>dép. {fmt(spent)}</div>}
              {sel && <div style={{ position:"absolute", bottom:7, right:8, fontSize:9, color:p.color, fontWeight:800, letterSpacing:.6, textTransform:"uppercase" }}>Vue active ✓</div>}
              <button onClick={e=>{ e.stopPropagation(); setModal({ type:"editIncome",profileId:p.id,selMonth }); }}
                style={{ position:"absolute", bottom:8, right: sel ? 68 : 8, width:24, height:24, borderRadius:7, border:"1px solid var(--border)", background:"rgba(255,255,255,0.05)", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, transition:"all .15s" }}>✏️</button>
            </div>
          );
        })}
      </div>

      <div className="content-grid">
        <div style={{ display:"flex", flexDirection:"column", gap:16 }}>

          {/* ── BALANCE CARD ── */}
          <div className="card" style={{ position:"relative", overflow:"hidden", borderColor:isPos?"rgba(74,222,128,0.2)":"rgba(248,113,113,0.2)" }}>
            <div style={{ position:"absolute", inset:0, background:isPos?"radial-gradient(ellipse 80% 60% at 50% -20%,rgba(74,222,128,0.07),transparent)":"radial-gradient(ellipse 80% 60% at 50% -20%,rgba(248,113,113,0.07),transparent)", pointerEvents:"none" }}/>

            {/* Tab selector */}
            <div style={{ display:"flex", gap:3, marginBottom:18, background:"rgba(255,255,255,0.04)", borderRadius:10, padding:3 }}>
              {[{ id:"global", label:"🌐 Global", color:null }, ...data.profiles.map(p=>({ id:p.id, label:`${p.avatar} ${p.name}`, color:p.color }))].map(v => (
                <button key={v.id} onClick={() => setBalanceView(v.id)} style={{
                  flex:1, padding:"7px 4px", borderRadius:8, border: balanceView===v.id ? `1px solid ${v.color?v.color+"45":"rgba(255,255,255,0.15)"}` : "1px solid transparent",
                  cursor:"pointer", background: balanceView===v.id ? (v.color?`${v.color}18`:"rgba(255,255,255,0.1)") : "transparent",
                  color: balanceView===v.id ? (v.color||"var(--text)") : "var(--text3)",
                  fontFamily:"'Outfit',sans-serif", fontWeight:700, fontSize:11,
                  transition:"all .2s", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis",
                }}>{v.label}</button>
              ))}
            </div>

            <div style={{ fontSize:11, color:"var(--text3)", textTransform:"uppercase", letterSpacing:1.5, textAlign:"center", marginBottom:10 }}>
              Reste à vivre · {viewData.label}
            </div>
            <div className="stat-num" style={{ fontSize:58, textAlign:"center", color:isPos?"var(--green)":"var(--red)", textShadow:`0 0 40px ${isPos?"rgba(74,222,128,0.25)":"rgba(248,113,113,0.25)"}`, marginBottom:20, lineHeight:1 }}>
              {fmt(balance)}
            </div>
            <div style={{ display:"flex", justifyContent:"center", gap:28, marginBottom:16 }}>
              <div style={{ textAlign:"center" }}>
                <div style={{ fontSize:10, color:"var(--text3)", marginBottom:4, textTransform:"uppercase", letterSpacing:.5 }}>💵 Revenus</div>
                <div style={{ fontSize:18, fontWeight:800, color:"var(--green)" }}>+{fmt(viewData.inc)}</div>
              </div>
              <div style={{ width:1, background:"var(--border)" }}/>
              <div style={{ textAlign:"center" }}>
                <div style={{ fontSize:10, color:"var(--text3)", marginBottom:4, textTransform:"uppercase", letterSpacing:.5 }}>💸 Dépenses</div>
                <div style={{ fontSize:18, fontWeight:800, color:"var(--red)" }}>-{fmt(viewData.exp)}</div>
              </div>
            </div>
            {viewData.inc > 0 && (
              <>
                <div style={{ display:"flex", justifyContent:"space-between", fontSize:12, color:"var(--text3)", marginBottom:7 }}>
                  <span>Budget utilisé</span>
                  <span style={{ fontWeight:800, color:pct>80?"var(--red)":pct>60?"var(--orange)":"var(--green)" }}>{Math.round(pct)}%</span>
                </div>
                <div className="progress-track" style={{ height:8 }}>
                  <div className="progress-fill" style={{ width:`${pct}%`, background:pct>80?"var(--grad-red)":pct>60?"linear-gradient(90deg,var(--yellow),var(--orange))":"var(--grad-green)" }}/>
                </div>
              </>
            )}
            {isCurMonth && totalIncome > 0 && dayOfMonth < daysInMonth && (
              <div style={{ marginTop:14, padding:"10px 14px", background:"rgba(255,255,255,0.03)", borderRadius:10, border:"1px solid var(--border)", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                <span style={{ fontSize:12, color:"var(--text3)" }}>📅 Projection fin de mois</span>
                <span style={{ fontSize:13, fontWeight:700, color:projectedExp>totalIncome?"var(--red)":"var(--orange)" }}>-{fmt(projectedExp)}</span>
              </div>
            )}
          </div>

          {/* ── CATEGORY BREAKDOWN ── */}
          <div className="card">
            <div style={{ fontWeight:800, fontSize:14, marginBottom:16, display:"flex", alignItems:"center", gap:9 }}>
              <div style={{ width:32, height:32, borderRadius:10, background:"rgba(251,146,60,0.1)", border:"1px solid rgba(251,146,60,0.2)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:16 }}>📊</div>
              Répartition des dépenses
            </div>
            {topCats.length === 0
              ? <div className="empty-state"><div className="empty-icon">📊</div>Aucune dépense ce mois</div>
              : (
                <div style={{ display:"flex", flexDirection:"column", gap:11 }}>
                  {topCats.map(([cid,amt]) => {
                    const cat = catMap[cid] || { icon:"❓", name:cid, color:"#888" };
                    const p   = totalExp > 0 ? (amt/totalExp)*100 : 0;
                    return (
                      <div key={cid}>
                        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:5 }}>
                          <div style={{ display:"flex", alignItems:"center", gap:7 }}>
                            <div style={{ width:26, height:26, borderRadius:8, background:`${cat.color}15`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:14 }}>{cat.icon}</div>
                            <span style={{ fontSize:13, fontWeight:600 }}>{cat.name}</span>
                            <span style={{ fontSize:10, color:"var(--text3)", background:"rgba(255,255,255,0.05)", borderRadius:20, padding:"1px 7px" }}>{Math.round(p)}%</span>
                          </div>
                          <span style={{ fontWeight:800, fontSize:13 }}>{fmt(amt)}</span>
                        </div>
                        <div className="progress-track" style={{ height:5 }}>
                          <div className="progress-fill" style={{ width:`${p}%`, background:cat.color }}/>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )
            }
          </div>

          {/* ── RECENT TRANSACTIONS ── */}
          <div className="card">
            <DashboardRecentTx transactions={transactions} catMap={catMap} profMap={profMap} />
          </div>
        </div>

        {/* ── RIGHT COLUMN ── */}
        <div style={{ display:"flex", flexDirection:"column", gap:14 }}>

          {/* Pie chart */}
          {pieData.length > 0 && (
            <div className="card">
              <div style={{ fontWeight:800, fontSize:14, marginBottom:12, display:"flex", alignItems:"center", gap:9 }}>
                <div style={{ width:32, height:32, borderRadius:10, background:"rgba(251,146,60,0.1)", border:"1px solid rgba(251,146,60,0.2)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:16 }}>🥧</div>
                Vue circulaire
              </div>
              <ResponsiveContainer width="100%" height={185}>
                <PieChart>
                  <Pie data={pieData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={2} dataKey="value">
                    {pieData.map((e,i) => <Cell key={i} fill={e.color} stroke="transparent"/>)}
                  </Pie>
                  <Tooltip content={<CT/>}/>
                </PieChart>
              </ResponsiveContainer>
              <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginTop:4 }}>
                {pieData.slice(0,6).map((d,i) => (
                  <div key={i} style={{ display:"flex", alignItems:"center", gap:5, fontSize:11 }}>
                    <div style={{ width:8, height:8, borderRadius:2, background:d.color, flexShrink:0 }}/>
                    <span style={{ color:"var(--text3)" }}>{d.name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── BILLS WIDGET ── */}
          <div className="card">
            <div style={{ fontWeight:800, fontSize:14, marginBottom:14, display:"flex", alignItems:"center", justifyContent:"space-between" }}>
              <div style={{ display:"flex", alignItems:"center", gap:9 }}>
                <div style={{ width:32, height:32, borderRadius:10, background:"rgba(167,139,250,0.1)", border:"1px solid rgba(167,139,250,0.2)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:16 }}>📋</div>
                Factures
              </div>
              <span style={{ fontSize:11, color:"var(--text3)", fontWeight:600 }}>{monthLabel(selMonth)}</span>
            </div>

            {data.bills.length === 0 ? (
              <div className="empty-state" style={{ padding:"18px 0" }}><div className="empty-icon">📋</div>Aucune facture</div>
            ) : (
              <>
                {/* Summary */}
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:7, marginBottom:12 }}>
                  {[
                    { v:paid.length,    l:"Payées",     c:"var(--green)",  bg:"rgba(74,222,128,0.08)",  bd:"rgba(74,222,128,0.18)" },
                    { v:unpaid.length,  l:"En attente", c:"var(--yellow)", bg:"rgba(251,191,36,0.08)",  bd:"rgba(251,191,36,0.18)" },
                    { v:overdue.length, l:"En retard",  c:"var(--red)",    bg:"rgba(248,113,113,0.08)", bd:"rgba(248,113,113,0.22)" },
                  ].map(s => (
                    <div key={s.l} style={{ textAlign:"center", background:s.bg, border:`1px solid ${s.bd}`, borderRadius:11, padding:"9px 4px" }}>
                      <div className="stat-num" style={{ fontSize:22, color:s.c }}>{s.v}</div>
                      <div style={{ fontSize:10, color:"var(--text3)", fontWeight:600 }}>{s.l}</div>
                    </div>
                  ))}
                </div>

                {/* Progress */}
                <div className="progress-track" style={{ height:5, marginBottom:13 }}>
                  <div className="progress-fill" style={{ width:`${data.bills.length?(paid.length/data.bills.length)*100:0}%`, background:"var(--grad-green)" }}/>
                </div>

                {/* Bill rows WITH due dates */}
                <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                  {unpaid.slice(0,4).map(b => {
                    const due = fmtDue(b.dueDate);
                    const isOvr = b.dueDate && new Date(b.dueDate) < new Date();
                    return (
                      <div key={b.id} style={{
                        display:"flex", alignItems:"center", gap:10, padding:"11px 13px",
                        background: isOvr?"rgba(248,113,113,0.06)":"rgba(255,255,255,0.03)",
                        border:`1px solid ${isOvr?"rgba(248,113,113,0.2)":"rgba(255,255,255,0.07)"}`,
                        borderRadius:12,
                      }}>
                        <span style={{ fontSize:20, flexShrink:0 }}>{b.icon||"📋"}</span>
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ fontWeight:700, fontSize:13, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{b.name}</div>
                          {due && (
                            <div style={{ display:"flex", alignItems:"center", gap:4, marginTop:3 }}>
                              <span style={{ fontSize:10, color:due.color, fontWeight:700 }}>📅 {due.text}</span>
                            </div>
                          )}
                        </div>
                        <div style={{ fontWeight:800, fontSize:14, color:isOvr?"var(--red)":"var(--orange)", flexShrink:0 }}>
                          -{fmt(b.amount)}
                        </div>
                      </div>
                    );
                  })}
                  {unpaid.length > 4 && <div style={{ textAlign:"center", fontSize:11, color:"var(--text3)", padding:"5px 0" }}>+{unpaid.length-4} autre{unpaid.length-4>1?"s":""}</div>}
                  {unpaid.length === 0 && <div style={{ textAlign:"center", fontSize:13, color:"var(--green)", fontWeight:700, padding:"10px 0" }}>🎉 Toutes les factures sont payées !</div>}
                </div>
              </>
            )}
          </div>

          {/* ── QUICK STATS ── */}
          <div className="card">
            <div style={{ fontWeight:800, fontSize:14, marginBottom:13, display:"flex", alignItems:"center", gap:9 }}>
              <div style={{ width:32, height:32, borderRadius:10, background:"rgba(251,191,36,0.1)", border:"1px solid rgba(251,191,36,0.2)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:16 }}>⚡</div>
              Stats rapides
            </div>
            <div style={{ display:"flex", flexDirection:"column", gap:7 }}>
              {[
                { label:"Tx. moy./jour",    val:fmt(dayOfMonth>0?totalExp/dayOfMonth:0),  icon:"📅", color:"var(--blue)" },
                { label:"Plus grosse dép.", val:transactions.length?fmt(Math.max(...transactions.map(t=>t.amount))):"—", icon:"🔺", color:"var(--orange)" },
                { label:"Nb. transactions", val:transactions.length, icon:"🧾", color:"var(--purple)" },
                { label:"Taux d'épargne",   val:totalIncome>0?`${Math.round(((totalIncome-totalExp)/totalIncome)*100)}%`:"—", icon:"💹", color:"var(--green)" },
              ].map(s => (
                <div key={s.label} style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 12px", background:"rgba(255,255,255,0.025)", borderRadius:11, border:"1px solid rgba(255,255,255,0.05)" }}>
                  <span style={{ fontSize:17 }}>{s.icon}</span>
                  <span style={{ flex:1, fontSize:12.5, color:"var(--text2)", fontWeight:600 }}>{s.label}</span>
                  <span style={{ fontWeight:800, fontSize:14, color:s.color }}>{s.val}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}


// ═══════════════════════════════════════════════════════════
//  INCOMES
// ═══════════════════════════════════════════════════════════
function Incomes({ data, update, selMonth, mdata, setModal }) {
  const md = mdata(selMonth);
  const { incomes } = md;
  const totalInc = (incomes.p1||0)+(incomes.p2||0)+(incomes.common||0);
  const totalExp = md.transactions.reduce((s,t) => s+t.amount, 0);

  return (
    <div className="fade-up content-grid">
      <div style={{ display:"flex",flexDirection:"column",gap:14 }}>
        <div style={{ fontWeight:700,fontSize:12,color:"var(--text3)",textTransform:"uppercase",letterSpacing:1.5 }}>
          Revenus — {monthLabel(selMonth)}
        </div>
        {data.profiles.map((p,i) => {
          const inc = incomes[p.id] || 0;
          return (
            <div key={p.id} className={`card glass-hover fade-up stagger-${i+1}`} style={{ display:"flex",alignItems:"center",gap:16 }}>
              <div style={{ width:54,height:54,borderRadius:16,background:`${p.color}18`,border:`1px solid ${p.color}30`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:28,flexShrink:0 }}>
                {p.avatar}
              </div>
              <div style={{ flex:1 }}>
                <div style={{ fontWeight:700,fontSize:15 }}>{p.name}</div>
                <div style={{ fontSize:10,color:"var(--text3)",textTransform:"uppercase",letterSpacing:.5 }}>
                  {p.id==="common" ? "Compte commun" : "Revenu mensuel"}
                </div>
                {inc>0 && (
                  <div className="progress-track" style={{ height:4,marginTop:8,maxWidth:200 }}>
                    <div className="progress-fill" style={{ width:`${totalInc>0?(inc/totalInc)*100:0}%`,background:p.color }}/>
                  </div>
                )}
              </div>
              <div style={{ textAlign:"right" }}>
                <div className="stat-num" style={{ fontSize:22,color:inc>0?"var(--green)":"var(--text3)" }}>
                  {inc>0 ? `+${fmt(inc)}` : "—"}
                </div>
                {totalInc>0 && inc>0 && <div style={{ fontSize:11,color:"var(--text3)" }}>{Math.round((inc/totalInc)*100)}%</div>}
              </div>
              <button className="btn-icon" onClick={() => setModal({ type:"editIncome",profileId:p.id,selMonth })}>✏️</button>
            </div>
          );
        })}

        {data.recurringIncomes?.length > 0 && (
          <div className="card">
            <div style={{ fontWeight:700,fontSize:13,marginBottom:14,display:"flex",alignItems:"center",gap:6 }}>
              🔄 Revenus récurrents
              <span style={{ marginLeft:"auto",background:"rgba(74,222,128,0.12)",color:"var(--green)",borderRadius:20,padding:"2px 8px",fontSize:11 }}>
                {data.recurringIncomes.length} actif{data.recurringIncomes.length>1?"s":""}
              </span>
            </div>
            {data.recurringIncomes.map(ri => {
              const prof = data.profiles.find(p => p.id === ri.profileId);
              return (
                <div key={ri.id} style={{ display:"flex",alignItems:"center",gap:12,padding:"11px 0",borderBottom:"1px solid var(--border)" }}>
                  <div style={{ width:38,height:38,borderRadius:10,background:`${prof?.color||"#888"}18`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:22 }}>{prof?.avatar||"❓"}</div>
                  <div style={{ flex:1 }}>
                    <div style={{ fontWeight:600,fontSize:13 }}>{prof?.name}</div>
                    <div style={{ fontSize:11,color:"var(--text3)" }}>Depuis {fmtDate(ri.startDate)} · Mensuel</div>
                  </div>
                  <div style={{ fontWeight:800,color:"var(--green)",fontSize:15 }}>+{fmt(ri.amount)}</div>
                  <button className="btn-icon" style={{ color:"var(--red)",background:"rgba(248,113,113,0.08)" }}
                    onClick={() => update(d => { d.recurringIncomes = d.recurringIncomes.filter(r => r.id!==ri.id); })}>
                    🗑
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div style={{ display:"flex",flexDirection:"column",gap:14 }}>
        <div className="card">
          <div style={{ fontWeight:700,fontSize:13,marginBottom:14 }}>📊 Récapitulatif</div>
          {[
            { label:"Total revenus",   val:`+${fmt(totalInc)}`,                   color:"var(--green)",  icon:"💵" },
            { label:"Total dépenses",  val:`-${fmt(totalExp)}`,                   color:"var(--red)",    icon:"💸" },
            { label:"Reste à vivre",   val:fmt(totalInc-totalExp),                color:totalInc>=totalExp?"var(--green)":"var(--red)", icon:"⚖️" },
            { label:"Taux d'épargne",  val:totalInc>0?`${Math.round(((totalInc-totalExp)/totalInc)*100)}%`:"—", color:"var(--purple)", icon:"💹" },
          ].map(s => (
            <div key={s.label} style={{ display:"flex",alignItems:"center",gap:12,padding:"11px 0",borderBottom:"1px solid var(--border)" }}>
              <span style={{ fontSize:20 }}>{s.icon}</span>
              <span style={{ flex:1,fontSize:13,color:"var(--text2)" }}>{s.label}</span>
              <span style={{ fontWeight:800,fontSize:15,color:s.color }}>{s.val}</span>
            </div>
          ))}
        </div>
        <div className="card" style={{ textAlign:"center",padding:28 }}>
          <div style={{ fontSize:42,marginBottom:10 }}>🔄</div>
          <div style={{ fontWeight:700,marginBottom:6 }}>Revenus récurrents</div>
          <div style={{ fontSize:12,color:"var(--text2)",marginBottom:18 }}>Configurez un revenu mensuel automatique</div>
          <button className="btn btn-primary" style={{ width:"100%" }} onClick={() => setModal({ type:"addRecurringIncome" })}>
            + Ajouter un revenu récurrent
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
//  LIVE CLOCK
// ═══════════════════════════════════════════════════════════
function LiveClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const weekday = now.toLocaleDateString("fr-FR", { weekday:"long" });
  const date    = now.toLocaleDateString("fr-FR", { day:"numeric", month:"long", year:"numeric" });
  const hh = pad(now.getHours());
  const mm = pad(now.getMinutes());
  const ss = pad(now.getSeconds());

  return (
    <div style={{
      display:"flex", alignItems:"center", gap:10, flexShrink:0,
      background:"var(--glass)", border:"1px solid var(--border)",
      borderRadius:13, padding:"7px 14px",
      boxShadow:"inset 0 1px 0 rgba(255,255,255,0.05)",
    }}>
      {/* Calendar side */}
      <div style={{ textAlign:"right", lineHeight:1.2 }}>
        <div style={{ fontSize:9.5, color:"var(--text3)", textTransform:"uppercase", letterSpacing:1, fontWeight:700 }}>
          {weekday}
        </div>
        <div style={{ fontSize:12, color:"var(--text2)", fontWeight:600, marginTop:1 }}>
          {date}
        </div>
      </div>

      {/* Divider */}
      <div style={{ width:1, height:28, background:"var(--border)" }}/>

      {/* Clock side */}
      <div style={{ display:"flex", alignItems:"baseline", gap:1, fontFamily:"'Fraunces',serif" }}>
        <span style={{ fontSize:22, fontWeight:700, color:"var(--text)", letterSpacing:-1 }}>{hh}:{mm}</span>
        <span style={{
          fontSize:13, fontWeight:700, color:"var(--purple)",
          minWidth:22, textAlign:"left", letterSpacing:0,
          animation:"pulse 1s steps(1) infinite",
        }}>:{ss}</span>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
//  EXPENSES — redesign complet
// ═══════════════════════════════════════════════════════════
function Expenses({ data, update, selMonth, mdata, setModal }) {
  const md = mdata(selMonth);
  const { transactions } = md;
  const [filter, setFilter]   = useState("all");
  const [search, setSearch]   = useState("");
  const [sort, setSort]       = useState("date_desc");
  const [groupBy, setGroupBy] = useState("none"); // "none" | "day" | "category"

  const catMap  = useMemo(() => Object.fromEntries(data.categories.map(c=>[c.id,c])), [data.categories]);
  const profMap = useMemo(() => Object.fromEntries(data.profiles.map(p=>[p.id,p])), [data.profiles]);

  const filtered = useMemo(() => {
    let txs = filter === "all" ? transactions : transactions.filter(t => t.profileId===filter || t.categoryId===filter);
    if (search.trim()) {
      const q = search.toLowerCase();
      txs = txs.filter(t => t.label.toLowerCase().includes(q) || (catMap[t.categoryId]?.name||"").toLowerCase().includes(q));
    }
    return txs;
  }, [transactions, filter, search, catMap]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    switch(sort) {
      case "date_asc":    return arr.sort((a,b) => new Date(a.timestamp)-new Date(b.timestamp));
      case "amount_desc": return arr.sort((a,b) => b.amount-a.amount);
      case "amount_asc":  return arr.sort((a,b) => a.amount-b.amount);
      default:            return arr.sort((a,b) => new Date(b.timestamp)-new Date(a.timestamp));
    }
  }, [filtered, sort]);

  const total    = useMemo(() => sorted.reduce((s,t) => s+t.amount, 0), [sorted]);
  const totalAll = useMemo(() => transactions.reduce((s,t) => s+t.amount, 0), [transactions]);

  const del = id => update(d => {
    ensureMonth(d, selMonth);
    d.monthsData[selMonth].transactions = d.monthsData[selMonth].transactions.filter(t => t.id!==id);
  });
  const duplicate = tx => update(d => {
    ensureMonth(d, selMonth);
    d.monthsData[selMonth].transactions.push({ ...tx, id:mkid(), timestamp:nowISO(), auto:false });
  });

  // Grouping logic
  const grouped = useMemo(() => {
    if (groupBy === "none") return [{ key:"all", label:null, items:sorted }];
    if (groupBy === "day") {
      const map = new Map();
      sorted.forEach(tx => {
        const d  = new Date(tx.timestamp);
        const key = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
        const label = d.toLocaleDateString("fr-FR", { weekday:"long", day:"numeric", month:"long" });
        if (!map.has(key)) map.set(key, { key, label, items:[] });
        map.get(key).items.push(tx);
      });
      return Array.from(map.values());
    }
    if (groupBy === "category") {
      const map = new Map();
      sorted.forEach(tx => {
        const cat = catMap[tx.categoryId] || { id:"?", name:"Autre", icon:"❓", color:"#888" };
        if (!map.has(cat.id)) map.set(cat.id, { key:cat.id, label:cat.name, icon:cat.icon, color:cat.color, items:[] });
        map.get(cat.id).items.push(tx);
      });
      return Array.from(map.values()).sort((a,b) =>
        b.items.reduce((s,t)=>s+t.amount,0) - a.items.reduce((s,t)=>s+t.amount,0)
      );
    }
    return [{ key:"all", label:null, items:sorted }];
  }, [sorted, groupBy, catMap]);

  // Full datetime with seconds formatter
  const fmtFull = iso => {
    if (!iso) return "";
    const d = new Date(iso);
    return d.toLocaleDateString("fr-FR",{ day:"2-digit", month:"short", year:"numeric" })
      + " · " + pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
  };

  return (
    <div className="fade-up">

      {/* ── TOP STATS BAR ── */}
      <div style={{
        display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:10, marginBottom:18,
      }}>
        {[
          { label:"Total dépensé",    val:`-${fmt(totalAll)}`,   color:"var(--red)",    icon:"💸", bg:"rgba(248,113,113,0.08)",  border:"rgba(248,113,113,0.18)" },
          { label:"Transactions",     val:transactions.length,   color:"var(--text)",   icon:"🧾", bg:"rgba(255,255,255,0.03)",  border:"var(--border)" },
          { label:"Dépense moyenne",  val:fmt(transactions.length ? totalAll/transactions.length : 0), color:"var(--orange)", icon:"📊", bg:"rgba(251,146,60,0.08)", border:"rgba(251,146,60,0.18)" },
          { label:"Plus grosse dép.", val:transactions.length ? fmt(Math.max(...transactions.map(t=>t.amount))) : "—", color:"var(--purple)", icon:"🔺", bg:"rgba(167,139,250,0.08)", border:"rgba(167,139,250,0.2)" },
        ].map(s => (
          <div key={s.label} style={{
            background:s.bg, border:`1px solid ${s.border}`, borderRadius:14,
            padding:"14px 16px", display:"flex", alignItems:"center", gap:12,
          }}>
            <div style={{
              width:38, height:38, borderRadius:11, background:"rgba(255,255,255,0.05)",
              display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, flexShrink:0,
            }}>{s.icon}</div>
            <div style={{ minWidth:0 }}>
              <div style={{ fontSize:10, color:"var(--text3)", textTransform:"uppercase", letterSpacing:.8, fontWeight:700, marginBottom:3 }}>{s.label}</div>
              <div className="stat-num" style={{ fontSize:16, fontWeight:800, color:s.color, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{s.val}</div>
            </div>
          </div>
        ))}
      </div>

      {/* ── TOOLBAR : search + sort + group ── */}
      <div style={{
        display:"flex", gap:8, marginBottom:14, alignItems:"center",
        background:"var(--glass)", border:"1px solid var(--border)",
        borderRadius:14, padding:"10px 14px",
      }}>
        {/* Search */}
        <div style={{ position:"relative", flex:1 }}>
          <span style={{ position:"absolute", left:12, top:"50%", transform:"translateY(-50%)", fontSize:13, pointerEvents:"none", opacity:.5 }}>🔍</span>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Rechercher…"
            style={{ paddingLeft:34, background:"rgba(255,255,255,0.05)", border:"1px solid var(--border)", borderRadius:10, fontSize:13 }}/>
        </div>

        {/* Sort */}
        <div style={{ display:"flex", alignItems:"center", gap:6, flexShrink:0 }}>
          <span style={{ fontSize:11, color:"var(--text3)", fontWeight:700, whiteSpace:"nowrap" }}>Trier</span>
          <select value={sort} onChange={e => setSort(e.target.value)} style={{ width:"auto", padding:"9px 10px", fontSize:12, background:"rgba(255,255,255,0.06)", border:"1px solid var(--border)", borderRadius:10 }}>
            <option value="date_desc">⬇ Date</option>
            <option value="date_asc">⬆ Date</option>
            <option value="amount_desc">⬇ Montant</option>
            <option value="amount_asc">⬆ Montant</option>
          </select>
        </div>

        {/* Group by */}
        <div style={{ display:"flex", alignItems:"center", gap:6, flexShrink:0 }}>
          <span style={{ fontSize:11, color:"var(--text3)", fontWeight:700, whiteSpace:"nowrap" }}>Grouper</span>
          <select value={groupBy} onChange={e => setGroupBy(e.target.value)} style={{ width:"auto", padding:"9px 10px", fontSize:12, background:"rgba(255,255,255,0.06)", border:"1px solid var(--border)", borderRadius:10 }}>
            <option value="none">Aucun</option>
            <option value="day">Par jour</option>
            <option value="category">Par catégorie</option>
          </select>
        </div>
      </div>

      {/* ── FILTER CHIPS ── */}
      <div className="filter-bar" style={{ marginBottom:14 }}>
        {[
          { id:"all", label:"Tout", icon:"" },
          ...data.profiles.map(p => ({ id:p.id, label:p.name, icon:p.avatar })),
          ...data.categories.map(c => ({ id:c.id, label:c.name, icon:c.icon })),
        ].map(f => (
          <div key={f.id} className={`filter-chip ${filter===f.id?"active":""}`}
            onClick={() => setFilter(f.id)}
            style={{ display:"flex", alignItems:"center", gap:5 }}>
            {f.icon && <span>{f.icon}</span>}
            {f.label}
          </div>
        ))}
      </div>

      {/* ── RESULTS HEADER ── */}
      <div style={{
        display:"flex", justifyContent:"space-between", alignItems:"center",
        marginBottom:12, padding:"0 4px",
      }}>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <span style={{ fontSize:13, color:"var(--text2)", fontWeight:600 }}>
            {sorted.length} transaction{sorted.length !== 1 ? "s" : ""}
          </span>
          {search && (
            <span style={{ fontSize:11, background:"rgba(167,139,250,0.12)", border:"1px solid rgba(167,139,250,0.25)", color:"var(--purple)", borderRadius:20, padding:"2px 9px", fontWeight:600 }}>
              "{search}"
            </span>
          )}
        </div>
        <div style={{ fontFamily:"'Fraunces',serif", fontSize:20, fontWeight:800, color:"var(--red)" }}>
          -{fmt(total)}
        </div>
      </div>

      {/* ── TRANSACTION LIST ── */}
      {sorted.length === 0 ? (
        <div className="card empty-state">
          <div className="empty-icon">{search ? "🔍" : "💸"}</div>
          <div style={{ fontSize:16, fontWeight:700, marginBottom:6 }}>{search ? "Aucun résultat" : "Aucune dépense ce mois"}</div>
          <div style={{ fontSize:13 }}>{search ? `Aucune dépense ne correspond à "${search}"` : "Ajoutez votre première dépense !"}</div>
        </div>
      ) : (
        <div style={{ display:"flex", flexDirection:"column", gap:groupBy==="none"?0:14 }}>
          {grouped.map((group) => {
            const groupTotal = group.items.reduce((s,t) => s+t.amount, 0);
            return (
              <div key={group.key}>
                {/* Group header */}
                {group.label && (
                  <div style={{
                    display:"flex", alignItems:"center", justifyContent:"space-between",
                    padding:"8px 4px", marginBottom:6,
                  }}>
                    <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                      {group.icon && (
                        <div style={{ width:28, height:28, borderRadius:8, background:`${group.color}18`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:15 }}>
                          {group.icon}
                        </div>
                      )}
                      <span style={{
                        fontSize:13, fontWeight:800, color:"var(--text2)",
                        textTransform: groupBy==="day" ? "capitalize" : "none",
                      }}>{group.label}</span>
                      <span style={{ fontSize:11, color:"var(--text3)", background:"rgba(255,255,255,0.05)", borderRadius:20, padding:"2px 8px" }}>
                        {group.items.length} tx
                      </span>
                    </div>
                    <span style={{ fontWeight:800, fontSize:14, color:"var(--red)" }}>-{fmt(groupTotal)}</span>
                  </div>
                )}

                {/* Cards */}
                <div style={{
                  background:"var(--glass)", border:"1px solid var(--border)",
                  borderRadius:16, overflow:"hidden",
                  boxShadow:"0 2px 12px rgba(0,0,0,0.25)",
                }}>
                  {group.items.map((tx, idx) => {
                    const cat  = catMap[tx.categoryId]  || { icon:"❓", color:"#888", name:"Autre" };
                    const prof = profMap[tx.profileId]  || { avatar:"❓", name:"?", color:"#888" };
                    const isLast = idx === group.items.length - 1;

                    return (
                      <div key={tx.id} style={{
                        display:"flex", alignItems:"center", gap:14,
                        padding:"14px 16px",
                        borderBottom: isLast ? "none" : "1px solid rgba(255,255,255,0.05)",
                        transition:"background .15s",
                        cursor:"default",
                      }}
                        onMouseEnter={e => e.currentTarget.style.background="rgba(255,255,255,0.03)"}
                        onMouseLeave={e => e.currentTarget.style.background="transparent"}>

                        {/* Category icon */}
                        <div style={{
                          width:48, height:48, borderRadius:14, flexShrink:0,
                          background:`${cat.color}15`,
                          border:`1.5px solid ${cat.color}30`,
                          display:"flex", alignItems:"center", justifyContent:"center",
                          fontSize:22, position:"relative",
                        }}>
                          {cat.icon}
                          {/* Profile dot badge */}
                          <div style={{
                            position:"absolute", bottom:-3, right:-3,
                            width:18, height:18, borderRadius:"50%",
                            background:prof.color || "var(--bg3)",
                            border:"2px solid var(--bg)",
                            display:"flex", alignItems:"center", justifyContent:"center",
                            fontSize:9,
                          }}>{prof.avatar}</div>
                        </div>

                        {/* Main info */}
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ display:"flex", alignItems:"center", gap:7, marginBottom:4 }}>
                            <span style={{ fontWeight:700, fontSize:15, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                              {tx.label}
                            </span>
                            {tx.auto && (
                              <span style={{ flexShrink:0, fontSize:10, background:"rgba(167,139,250,0.15)", border:"1px solid rgba(167,139,250,0.3)", color:"var(--purple)", borderRadius:20, padding:"1px 7px", fontWeight:700 }}>
                                AUTO
                              </span>
                            )}
                          </div>

                          {/* Meta row */}
                          <div style={{ display:"flex", alignItems:"center", gap:6, flexWrap:"wrap" }}>
                            {/* Profile chip */}
                            <div style={{
                              display:"flex", alignItems:"center", gap:4,
                              background:"rgba(255,255,255,0.05)", borderRadius:20,
                              padding:"2px 8px", border:"1px solid rgba(255,255,255,0.08)",
                            }}>
                              <span style={{ fontSize:11 }}>{prof.avatar}</span>
                              <span style={{ fontSize:11, fontWeight:600, color:"var(--text2)" }}>{prof.name}</span>
                            </div>

                            {/* Category chip */}
                            <div style={{
                              display:"flex", alignItems:"center", gap:4,
                              background:`${cat.color}12`, borderRadius:20,
                              padding:"2px 8px", border:`1px solid ${cat.color}25`,
                            }}>
                              <span style={{ fontSize:11 }}>{cat.icon}</span>
                              <span style={{ fontSize:11, fontWeight:600, color:cat.color }}>{cat.name}</span>
                            </div>

                            {/* Timestamp with full hh:mm:ss */}
                            <div style={{
                              display:"flex", alignItems:"center", gap:4,
                              fontSize:11, color:"var(--text3)", fontWeight:500,
                            }}>
                              <span>🕐</span>
                              <span style={{ fontFamily:"monospace", letterSpacing:.3 }}>{fmtFull(tx.timestamp)}</span>
                            </div>
                          </div>
                        </div>

                        {/* Amount */}
                        <div style={{
                          textAlign:"right", flexShrink:0,
                          minWidth:90,
                        }}>
                          <div style={{
                            fontFamily:"'Fraunces',serif", fontWeight:800, fontSize:18,
                            color:"var(--red)",
                            textShadow:"0 0 20px rgba(248,113,113,0.25)",
                          }}>
                            -{fmt(tx.amount)}
                          </div>
                          {totalAll > 0 && (
                            <div style={{ fontSize:10, color:"var(--text3)", marginTop:2, fontWeight:600 }}>
                              {Math.round((tx.amount/totalAll)*100)}% du total
                            </div>
                          )}
                        </div>

                        {/* Actions */}
                        <div style={{ display:"flex", flexDirection:"column", gap:4, flexShrink:0 }}>
                          <button onClick={() => setModal({ type:"editTransaction",tx,selMonth })}
                            title="Modifier"
                            style={{ width:30, height:30, borderRadius:8, border:"1px solid var(--border)", background:"rgba(167,139,250,0.08)", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", fontSize:13, transition:"all .15s" }}
                            onMouseEnter={e => e.currentTarget.style.background="rgba(167,139,250,0.2)"}
                            onMouseLeave={e => e.currentTarget.style.background="rgba(167,139,250,0.08)"}>✏️</button>
                          <button onClick={() => duplicate(tx)}
                            title="Dupliquer"
                            style={{ width:30, height:30, borderRadius:8, border:"1px solid var(--border)", background:"rgba(96,165,250,0.08)", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", fontSize:13, transition:"all .15s" }}
                            onMouseEnter={e => e.currentTarget.style.background="rgba(96,165,250,0.2)"}
                            onMouseLeave={e => e.currentTarget.style.background="rgba(96,165,250,0.08)"}>📋</button>
                          <button onClick={() => del(tx.id)}
                            title="Supprimer"
                            style={{ width:30, height:30, borderRadius:8, border:"1px solid rgba(248,113,113,0.2)", background:"rgba(248,113,113,0.08)", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", fontSize:13, transition:"all .15s" }}
                            onMouseEnter={e => e.currentTarget.style.background="rgba(248,113,113,0.25)"}
                            onMouseLeave={e => e.currentTarget.style.background="rgba(248,113,113,0.08)"}>🗑</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
//  BILLS
// ═══════════════════════════════════════════════════════════
function Bills({ data, update, selMonth, mdata, setModal }) {
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all"); // "all" | "unpaid" | "paid" | "overdue"

  const toggle = billId => {
    update(d => {
      const bill = d.bills.find(b => b.id===billId);
      if (!bill) return;
      if (!bill.paid) bill.paid = {};
      const wasPaid = bill.paid[selMonth];
      bill.paid[selMonth] = !wasPaid;
      ensureMonth(d, selMonth);
      if (!wasPaid) {
        d.monthsData[selMonth].transactions.push({
          id:mkid(), label:bill.name, amount:bill.amount||0,
          categoryId:bill.categoryId||"c7", profileId:bill.profileId||"common",
          timestamp:nowISO(), fromBill:billId,
        });
      } else {
        d.monthsData[selMonth].transactions = d.monthsData[selMonth].transactions.filter(t => t.fromBill!==billId);
      }
    });
  };

  const del = id => update(d => { d.bills = d.bills.filter(b => b.id!==id); });

  const allBillsFiltered = useMemo(() => {
    let bills = [...data.bills];
    // text search
    if (search.trim()) {
      const q = search.toLowerCase();
      bills = bills.filter(b => b.name.toLowerCase().includes(q));
    }
    // status filter
    const now = new Date();
    bills = bills.filter(b => {
      const isPaid    = b.paid?.[selMonth];
      const isOverdue = b.dueDate && new Date(b.dueDate) < now && !isPaid;
      if (filterStatus === "paid")    return isPaid;
      if (filterStatus === "unpaid")  return !isPaid && !isOverdue;
      if (filterStatus === "overdue") return isOverdue;
      return true;
    });
    return bills;
  }, [data.bills, search, filterStatus, selMonth]);

  const unpaid = useMemo(() => allBillsFiltered.filter(b => !b.paid?.[selMonth]).sort((a,b) => {
    if (!a.dueDate) return 1; if (!b.dueDate) return -1;
    return new Date(a.dueDate) - new Date(b.dueDate);
  }), [allBillsFiltered, selMonth]);

  const paid        = useMemo(() => allBillsFiltered.filter(b =>  b.paid?.[selMonth]), [allBillsFiltered, selMonth]);
  const totalUnpaid = useMemo(() => data.bills.filter(b => !b.paid?.[selMonth]).reduce((s,b) => s+(b.amount||0), 0), [data.bills, selMonth]);
  const totalPaid   = useMemo(() => data.bills.filter(b =>  b.paid?.[selMonth]).reduce((s,b) => s+(b.amount||0), 0), [data.bills, selMonth]);
  const overdueCount = useMemo(() => data.bills.filter(b => b.dueDate && new Date(b.dueDate) < new Date() && !b.paid?.[selMonth]).length, [data.bills, selMonth]);

  return (
    <div className="fade-up content-grid">
      <div>
        {/* ── SEARCH + FILTER BAR ── */}
        <div style={{ marginBottom: 16, display: "flex", flexDirection: "column", gap: 10 }}>
          {/* Search input */}
          <div style={{ position: "relative" }}>
            <span style={{ position:"absolute", left:14, top:"50%", transform:"translateY(-50%)", fontSize:14, pointerEvents:"none", opacity:.5 }}>🔍</span>
            <input
              value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Rechercher une facture…"
              style={{ paddingLeft: 40, background:"rgba(255,255,255,0.06)", border:"1px solid var(--border)", borderRadius:13, fontSize:13, height:42 }}
            />
            {search && (
              <button onClick={() => setSearch("")} style={{ position:"absolute", right:12, top:"50%", transform:"translateY(-50%)", background:"none", border:"none", cursor:"pointer", color:"var(--text3)", fontSize:16, lineHeight:1 }}>×</button>
            )}
          </div>
          {/* Status chips */}
          <div style={{ display:"flex", gap:7 }}>
            {[
              { id:"all",     label:"Toutes",          count: data.bills.length },
              { id:"unpaid",  label:"En attente",       count: data.bills.filter(b => !b.paid?.[selMonth] && !(b.dueDate && new Date(b.dueDate) < new Date())).length },
              { id:"overdue", label:"⚠️ En retard",     count: overdueCount },
              { id:"paid",    label:"✅ Payées",         count: data.bills.filter(b => b.paid?.[selMonth]).length },
            ].map(f => (
              <button key={f.id} onClick={() => setFilterStatus(f.id)} style={{
                padding: "6px 13px", borderRadius: 20, border: "none", cursor: "pointer",
                fontFamily: "'Outfit',sans-serif", fontSize: 12, fontWeight: 700,
                background: filterStatus === f.id
                  ? f.id === "overdue" ? "rgba(248,113,113,0.2)" : f.id === "paid" ? "rgba(74,222,128,0.15)" : "rgba(167,139,250,0.15)"
                  : "rgba(255,255,255,0.05)",
                color: filterStatus === f.id
                  ? f.id === "overdue" ? "var(--red)" : f.id === "paid" ? "var(--green)" : "var(--purple)"
                  : "var(--text3)",
                border: `1px solid ${filterStatus === f.id
                  ? f.id === "overdue" ? "rgba(248,113,113,0.35)" : f.id === "paid" ? "rgba(74,222,128,0.3)" : "rgba(167,139,250,0.3)"
                  : "var(--border)"}`,
                transition: "all .15s",
                display: "flex", alignItems: "center", gap: 5,
              }}>
                {f.label}
                <span style={{ background:"rgba(255,255,255,0.08)", borderRadius:10, padding:"1px 6px", fontSize:10 }}>{f.count}</span>
              </button>
            ))}
          </div>
        </div>

        {/* ── BILL LIST ── */}
        {data.bills.length === 0 ? (
          <div className="card empty-state"><div className="empty-icon">📋</div>Aucune facture configurée</div>
        ) : allBillsFiltered.length === 0 ? (
          <div className="card empty-state">
            <div className="empty-icon">{search ? "🔍" : "📋"}</div>
            <div style={{ fontSize:15, fontWeight:700, marginBottom:6 }}>{search ? "Aucun résultat" : "Aucune facture dans cette catégorie"}</div>
            {search && <div style={{ fontSize:12 }}>Aucune facture ne correspond à « {search} »</div>}
          </div>
        ) : (
          <>
            {unpaid.length > 0 && (
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize:11, color:"var(--text3)", textTransform:"uppercase", letterSpacing:1.2, marginBottom:10 }}>⏳ En attente ({unpaid.length})</div>
                {unpaid.map((b,i) => <BillRow key={b.id} bill={b} selMonth={selMonth} onToggle={toggle} onDelete={del} profiles={data.profiles} idx={i}/>)}
              </div>
            )}
            {paid.length > 0 && (
              <div>
                <div style={{ fontSize:11, color:"var(--text3)", textTransform:"uppercase", letterSpacing:1.2, marginBottom:10 }}>✅ Réglées ({paid.length})</div>
                {paid.map((b,i) => <BillRow key={b.id} bill={b} selMonth={selMonth} onToggle={toggle} onDelete={del} profiles={data.profiles} idx={i}/>)}
              </div>
            )}
          </>
        )}
      </div>

      <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
        <div className="card">
          <div style={{ fontWeight:700, fontSize:13, marginBottom:14 }}>📊 Progression — {monthLabel(selMonth)}</div>
          <div style={{ display:"flex", gap:10, marginBottom:14 }}>
            {[
              { l:"Payées",     v:data.bills.filter(b =>  b.paid?.[selMonth]).length, c:"var(--green)",  bg:"rgba(74,222,128,0.08)" },
              { l:"En attente", v:data.bills.filter(b => !b.paid?.[selMonth]).length, c:"var(--yellow)", bg:"rgba(251,191,36,0.08)" },
            ].map(s => (
              <div key={s.l} style={{ flex:1, textAlign:"center", background:s.bg, borderRadius:12, padding:"12px 6px" }}>
                <div className="stat-num" style={{ fontSize:28, color:s.c }}>{s.v}</div>
                <div style={{ fontSize:11, color:"var(--text3)" }}>{s.l}</div>
              </div>
            ))}
          </div>
          <div className="progress-track" style={{ height:10, marginBottom:10 }}>
            <div className="progress-fill" style={{ width:data.bills.length?`${(data.bills.filter(b=>b.paid?.[selMonth]).length/data.bills.length)*100}%`:"0%", background:"var(--grad-green)" }}/>
          </div>
          <div style={{ display:"flex", justifyContent:"space-between", fontSize:12, color:"var(--text3)", marginBottom:12 }}>
            <span>{data.bills.length} factures</span>
            <span style={{ color:"var(--red)", fontWeight:700 }}>{totalUnpaid>0?`-${fmt(totalUnpaid)} restant`:"🎉 Tout payé !"}</span>
          </div>
          {totalPaid > 0 && (
            <div style={{ display:"flex", justifyContent:"space-between", fontSize:12, padding:"8px 12px", background:"rgba(74,222,128,0.06)", borderRadius:10 }}>
              <span style={{ color:"var(--text3)" }}>Déjà réglé</span>
              <span style={{ color:"var(--green)", fontWeight:700 }}>+{fmt(totalPaid)}</span>
            </div>
          )}
          {overdueCount > 0 && (
            <div style={{ display:"flex", justifyContent:"space-between", fontSize:12, padding:"8px 12px", background:"rgba(248,113,113,0.06)", borderRadius:10, marginTop:8 }}>
              <span style={{ color:"var(--red)" }}>⚠️ En retard</span>
              <span style={{ color:"var(--red)", fontWeight:700 }}>{overdueCount} facture{overdueCount>1?"s":""}</span>
            </div>
          )}
        </div>

        <div className="card" style={{ textAlign:"center", padding:28 }}>
          <div style={{ fontSize:42, marginBottom:10 }}>📋</div>
          <div style={{ fontWeight:700, marginBottom:6 }}>Nouvelle facture</div>
          <div style={{ fontSize:12, color:"var(--text2)", marginBottom:18 }}>Charges fixes récurrentes</div>
          <button className="btn btn-primary" style={{ width:"100%" }} onClick={() => setModal({ type:"addBill" })}>+ Créer une facture</button>
        </div>
      </div>
    </div>
  );
}

function BillRow({ bill, selMonth, onToggle, onDelete, profiles, idx }) {
  const isPaid = bill.paid?.[selMonth];
  const prof   = profiles.find(p => p.id === bill.profileId);
  const dueDate   = bill.dueDate ? new Date(bill.dueDate) : null;
  const isOverdue = dueDate && dueDate < new Date() && !isPaid;

  const fmtFull = iso => {
    if (!iso) return "—";
    const d = new Date(iso);
    return d.toLocaleDateString("fr-FR",{ day:"2-digit",month:"long",year:"numeric" }) +
      " à " + d.toLocaleTimeString("fr-FR",{ hour:"2-digit",minute:"2-digit" });
  };

  const statusColor  = isPaid ? "var(--green)" : isOverdue ? "var(--red)"  : "var(--yellow)";
  const statusBg     = isPaid ? "rgba(74,222,128,0.08)" : isOverdue ? "rgba(248,113,113,0.08)" : "rgba(251,191,36,0.06)";
  const statusBorder = isPaid ? "rgba(74,222,128,0.25)" : isOverdue ? "rgba(248,113,113,0.35)" : "rgba(251,191,36,0.2)";
  const statusLabel  = isPaid ? "✅ Payée" : isOverdue ? "⚠️ En retard" : "⏳ En attente";

  return (
    <div className={`fade-up stagger-${(idx%5)+1}`} style={{
      marginBottom:14, background:"var(--glass)", border:`1px solid ${statusBorder}`,
      borderRadius:18, overflow:"hidden", opacity:isPaid?0.72:1, transition:"all .2s",
      boxShadow:isOverdue?"0 0 20px rgba(248,113,113,0.1)":undefined,
    }}>
      <div style={{ height:3, background:`linear-gradient(90deg, ${statusColor}, transparent)` }}/>
      <div style={{ padding:"16px 18px" }}>
        <div style={{ display:"flex",alignItems:"center",gap:14,marginBottom:12 }}>
          <div style={{ width:52,height:52,borderRadius:14,flexShrink:0,background:statusBg,border:`1px solid ${statusBorder}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:26 }}>
            {bill.icon||"📋"}
          </div>
          <div style={{ flex:1,minWidth:0 }}>
            <div style={{ fontWeight:800,fontSize:17,textDecoration:isPaid?"line-through":"none",color:isPaid?"var(--text3)":"var(--text)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",marginBottom:5 }}>
              {bill.name}
            </div>
            <div style={{ display:"flex",gap:6,flexWrap:"wrap" }}>
              <span style={{ display:"inline-flex",alignItems:"center",gap:4,background:statusBg,border:`1px solid ${statusBorder}`,color:statusColor,borderRadius:20,padding:"3px 10px",fontSize:11,fontWeight:700 }}>{statusLabel}</span>
              {bill.recurring && <span style={{ display:"inline-flex",alignItems:"center",gap:4,background:"rgba(167,139,250,0.12)",border:"1px solid rgba(167,139,250,0.3)",color:"var(--purple)",borderRadius:20,padding:"3px 10px",fontSize:11,fontWeight:700 }}>🔄 Récurrent</span>}
            </div>
          </div>
          {bill.amount>0 && (
            <div style={{ fontFamily:"'Fraunces',serif",fontWeight:800,fontSize:20,color:isOverdue?"var(--red)":"var(--text)",flexShrink:0 }}>
              -{fmt(bill.amount)}
            </div>
          )}
        </div>

        <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,background:"rgba(255,255,255,0.03)",borderRadius:12,padding:"10px 14px",marginBottom:14,border:"1px solid var(--border)" }}>
          <div>
            <div style={{ fontSize:9,color:"var(--text3)",textTransform:"uppercase",letterSpacing:1,marginBottom:4 }}>Compte</div>
            <div style={{ display:"flex",alignItems:"center",gap:7 }}>
              <div style={{ width:28,height:28,borderRadius:8,background:prof?`${prof.color}20`:"rgba(255,255,255,0.06)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:15 }}>{prof?.avatar||"🏦"}</div>
              <div style={{ fontWeight:700,fontSize:13,color:prof?.color||"var(--text)" }}>{prof?.name||"—"}</div>
            </div>
          </div>
          <div>
            <div style={{ fontSize:9,color:"var(--text3)",textTransform:"uppercase",letterSpacing:1,marginBottom:4 }}>Échéance</div>
            <div style={{ fontWeight:700,fontSize:12,color:isOverdue?"var(--red)":isPaid?"var(--text3)":"var(--text)",lineHeight:1.4 }}>
              {fmtFull(bill.dueDate)}
              {isOverdue && <div style={{ fontSize:10,color:"var(--red)",fontWeight:800,marginTop:3 }}>⚠️ Dépassée</div>}
            </div>
          </div>
        </div>

        <div style={{ display:"flex",gap:10 }}>
          <button onClick={() => onToggle(bill.id)} style={{
            flex:1,padding:"11px",borderRadius:12,cursor:"pointer",fontFamily:"'Outfit',sans-serif",fontWeight:800,fontSize:14,
            background:isPaid?"rgba(74,222,128,0.12)":"rgba(167,139,250,0.12)",
            border:`1px solid ${isPaid?"rgba(74,222,128,0.35)":"rgba(167,139,250,0.35)"}`,
            color:isPaid?"var(--green)":"var(--purple)",transition:"all .2s",
          }}>
            {isPaid ? "↩️ Marquer impayée" : "✅ Marquer comme payée"}
          </button>
          <button onClick={() => onDelete(bill.id)} style={{
            width:46,height:46,borderRadius:12,cursor:"pointer",flexShrink:0,
            background:"rgba(248,113,113,0.08)",border:"1px solid rgba(248,113,113,0.25)",
            color:"var(--red)",fontSize:18,display:"flex",alignItems:"center",justifyContent:"center",transition:"all .2s",
          }}>🗑</button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
//  STATS
// ═══════════════════════════════════════════════════════════
function Stats({ data, selMonth, mdata, allMonths }) {
  const [period, setPeriod]   = useState("month");
  const [statTab, setStatTab] = useState("overview");

  const catMap = useMemo(() => Object.fromEntries(data.categories.map(c=>[c.id,c])), [data.categories]);

  const months = useMemo(() => {
    const all = [...allMonths].reverse();
    if (period === "month")   return [selMonth];
    if (period === "quarter") {
      const [y,m] = selMonth.split("-").map(Number);
      return all.filter(k => { const [ky,km]=k.split("-").map(Number); return ky===y && Math.abs(km-m)<3; });
    }
    if (period === "year") {
      const y = selMonth.slice(0,4);
      return all.filter(k => k.startsWith(y));
    }
    return [selMonth];
  }, [period, selMonth, allMonths]);

  const allTx   = useMemo(() => months.flatMap(k => (data.monthsData[k]?.transactions||[])), [months, data.monthsData]);
  const totalExp = useMemo(() => allTx.reduce((s,t) => s+t.amount, 0), [allTx]);
  const totalInc = useMemo(() => months.reduce((s,k) => {
    const inc = data.monthsData[k]?.incomes || {};
    return s+(inc.p1||0)+(inc.p2||0)+(inc.common||0);
  }, 0), [months, data.monthsData]);

  const pieData = useMemo(() => {
    const m = {};
    allTx.forEach(t => { m[t.categoryId] = (m[t.categoryId]||0) + t.amount; });
    return Object.entries(m)
      .map(([cid,val]) => ({ name:(catMap[cid]?.icon||"")+" "+(catMap[cid]?.name||cid), value:val, color:catMap[cid]?.color||"#888" }))
      .sort((a,b) => b.value-a.value);
  }, [allTx, catMap]);

  const timelineData = useMemo(() => [...allMonths].slice(0,12).reverse().map(k => {
    const m   = data.monthsData[k];
    const exp = m?.transactions.reduce((s,t) => s+t.amount, 0) || 0;
    const inc = m ? (m.incomes?.p1||0)+(m.incomes?.p2||0)+(m.incomes?.common||0) : 0;
    return { month:monthLabelShort(k), dépenses:exp, revenus:inc, solde:inc-exp };
  }), [allMonths, data.monthsData]);

  const profBreakdown = useMemo(() => data.profiles.filter(p => p.id!=="common").map(p => {
    const spent = allTx.filter(t => t.profileId===p.id).reduce((s,t) => s+t.amount, 0);
    const inc   = months.reduce((s,k) => s+(data.monthsData[k]?.incomes?.[p.id]||0), 0);
    return { ...p, spent, inc, balance:inc-spent };
  }), [data.profiles, allTx, months, data.monthsData]);

  // Trend: compare with previous period
  const prevMonths = useMemo(() => {
    const all = [...allMonths].reverse();
    if (period === "month") {
      const idx = all.indexOf(selMonth);
      return idx >= 0 && idx+1 < all.length ? [all[idx+1]] : [];
    }
    return [];
  }, [period, selMonth, allMonths]);

  const prevExp = useMemo(() => prevMonths.flatMap(k => (data.monthsData[k]?.transactions||[])).reduce((s,t)=>s+t.amount,0), [prevMonths, data.monthsData]);
  const trendPct = prevExp > 0 ? ((totalExp - prevExp) / prevExp) * 100 : null;

  const CT = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="rc-tooltip">
        <div style={{ fontWeight:700,marginBottom:4 }}>{label}</div>
        {payload.map((p,i) => <div key={i} style={{ color:p.color,fontSize:11 }}>{p.name}: {fmt(p.value)}</div>)}
      </div>
    );
  };
  const PT = ({ active, payload }) => {
    if (!active || !payload?.length) return null;
    const d = payload[0];
    return (
      <div className="rc-tooltip">
        <div style={{ fontWeight:700 }}>{d.name}</div>
        <div style={{ color:d.payload.color }}>{fmt(d.value)}</div>
        <div style={{ fontSize:10,color:"var(--text3)" }}>{totalExp>0?Math.round((d.value/totalExp)*100):0}%</div>
      </div>
    );
  };

  return (
    <div className="fade-up">
      {/* Period + tab selector */}
      <div style={{ display:"flex",gap:10,marginBottom:20,alignItems:"center",flexWrap:"wrap" }}>
        <div className="filter-bar" style={{ flex:1 }}>
          {[{id:"month",label:"Ce mois"},{id:"quarter",label:"Trimestre"},{id:"year",label:"Année"}].map(p => (
            <div key={p.id} className={`filter-chip ${period===p.id?"active":""}`} onClick={() => setPeriod(p.id)}>{p.label}</div>
          ))}
        </div>
        <div className="filter-bar">
          {[{id:"overview",label:"Vue d'ensemble"},{id:"categories",label:"Catégories"},{id:"timeline",label:"Historique"},{id:"profiles",label:"Profils"}].map(t => (
            <div key={t.id} className={`filter-chip ${statTab===t.id?"active":""}`} onClick={() => setStatTab(t.id)}
              style={{ borderColor:statTab===t.id?"rgba(96,165,250,0.5)":"var(--border)",background:statTab===t.id?"rgba(96,165,250,0.12)":"var(--glass)",color:statTab===t.id?"var(--blue)":"var(--text2)" }}>
              {t.label}
            </div>
          ))}
        </div>
      </div>

      {statTab === "overview" && (
        <div className="content-grid">
          <div style={{ display:"flex",flexDirection:"column",gap:14 }}>
            <div className="grid-4">
              {[
                { label:"Revenus",      val:`+${fmtCompact(totalInc)}`, color:"var(--green)",  icon:"💵" },
                { label:"Dépenses",     val:`-${fmtCompact(totalExp)}`, color:"var(--red)",    icon:"💸" },
                { label:"Solde net",    val:fmtCompact(totalInc-totalExp), color:totalInc>=totalExp?"var(--green)":"var(--red)", icon:"⚖️" },
                { label:"Transactions", val:allTx.length,               color:"var(--purple)", icon:"🧾" },
              ].map(s => (
                <div key={s.label} className="card" style={{ textAlign:"center",padding:16 }}>
                  <div style={{ fontSize:22,marginBottom:6 }}>{s.icon}</div>
                  <div style={{ fontSize:10,color:"var(--text3)",marginBottom:5,textTransform:"uppercase",letterSpacing:.8 }}>{s.label}</div>
                  <div className="stat-num" style={{ fontSize:15,color:s.color }}>{s.val}</div>
                </div>
              ))}
            </div>

            {trendPct !== null && (
              <div className={`alert-banner ${trendPct > 0 ? "alert-warning" : "alert-success"}`}>
                {trendPct > 0 ? "📈" : "📉"}
                <span>Dépenses {trendPct > 0 ? "en hausse" : "en baisse"} de <strong>{Math.abs(Math.round(trendPct))}%</strong> vs mois précédent</span>
              </div>
            )}

            <div className="card">
              <div style={{ fontWeight:700,fontSize:13,marginBottom:14 }}>Revenus vs Dépenses — 12 mois</div>
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={timelineData}>
                  <defs>
                    <linearGradient id="gR" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#4ade80" stopOpacity={0.25}/><stop offset="95%" stopColor="#4ade80" stopOpacity={0}/></linearGradient>
                    <linearGradient id="gE" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#f87171" stopOpacity={0.25}/><stop offset="95%" stopColor="#f87171" stopOpacity={0}/></linearGradient>
                  </defs>
                  <XAxis dataKey="month" tick={{fill:"rgba(237,233,248,0.35)",fontSize:10}} axisLine={false} tickLine={false}/>
                  <YAxis tick={{fill:"rgba(237,233,248,0.35)",fontSize:10}} axisLine={false} tickLine={false} width={72} tickFormatter={v=>v>0?fmtCompact(v):"."}/>
                  <Tooltip content={<CT/>}/>
                  <Area type="monotone" dataKey="revenus"  stroke="#4ade80" strokeWidth={2} fill="url(#gR)" name="Revenus"/>
                  <Area type="monotone" dataKey="dépenses" stroke="#f87171" strokeWidth={2} fill="url(#gE)" name="Dépenses"/>
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div style={{ display:"flex",flexDirection:"column",gap:14 }}>
            {pieData.length > 0 && (
              <div className="card">
                <div style={{ fontWeight:700,fontSize:13,marginBottom:10 }}>Répartition</div>
                <ResponsiveContainer width="100%" height={180}>
                  <PieChart>
                    <Pie data={pieData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={2} dataKey="value">
                      {pieData.map((e,i) => <Cell key={i} fill={e.color} stroke="transparent"/>)}
                    </Pie>
                    <Tooltip content={<PT/>}/>
                  </PieChart>
                </ResponsiveContainer>
                <div style={{ display:"flex",flexWrap:"wrap",gap:6,marginTop:4 }}>
                  {pieData.slice(0,6).map((d,i) => (
                    <div key={i} style={{ display:"flex",alignItems:"center",gap:4,fontSize:11 }}>
                      <div style={{ width:8,height:8,borderRadius:2,background:d.color }}/><span style={{ color:"var(--text3)" }}>{d.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="card">
              <div style={{ fontWeight:700,fontSize:13,marginBottom:12 }}>Solde mensuel</div>
              <ResponsiveContainer width="100%" height={150}>
                <BarChart data={timelineData}>
                  <XAxis dataKey="month" tick={{fill:"rgba(237,233,248,0.35)",fontSize:9}} axisLine={false} tickLine={false}/>
                  <YAxis tick={{fill:"rgba(237,233,248,0.35)",fontSize:9}} axisLine={false} tickLine={false} width={62} tickFormatter={v=>fmtCompact(v)}/>
                  <Tooltip content={<CT/>}/>
                  <Bar dataKey="solde" name="Solde" radius={[5,5,0,0]}>
                    {timelineData.map((e,i) => <Cell key={i} fill={e.solde>=0?"#4ade80":"#f87171"}/>)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {statTab === "categories" && (
        <div className="content-grid">
          <div className="card">
            <div style={{ fontWeight:700,fontSize:13,marginBottom:14 }}>Détail par catégorie</div>
            {pieData.length === 0
              ? <div className="empty-state"><div className="empty-icon">📊</div>Aucune donnée</div>
              : pieData.map((d,i) => (
                <div key={i} style={{ marginBottom:14 }}>
                  <div style={{ display:"flex",justifyContent:"space-between",marginBottom:5,fontSize:13 }}>
                    <span style={{ fontWeight:600 }}>{d.name}</span>
                    <div style={{ display:"flex",gap:12 }}>
                      <span style={{ color:"var(--text3)",fontSize:11 }}>{totalExp>0?Math.round((d.value/totalExp)*100):0}%</span>
                      <span style={{ fontWeight:800,color:d.color }}>{fmt(d.value)}</span>
                    </div>
                  </div>
                  <div className="progress-track" style={{ height:7 }}>
                    <div className="progress-fill" style={{ width:`${totalExp>0?(d.value/totalExp)*100:0}%`,background:d.color }}/>
                  </div>
                </div>
              ))
            }
          </div>
          {pieData.length > 0 && (
            <div className="card">
              <div style={{ fontWeight:700,fontSize:13,marginBottom:10 }}>Distribution</div>
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie data={pieData} cx="50%" cy="50%" outerRadius={110} paddingAngle={2} dataKey="value">
                    {pieData.map((e,i) => <Cell key={i} fill={e.color} stroke="transparent"/>)}
                  </Pie>
                  <Tooltip content={<PT/>}/>
                  <Legend formatter={v => <span style={{ fontSize:11,color:"var(--text2)" }}>{v}</span>}/>
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}

      {statTab === "timeline" && (
        <div style={{ display:"flex",flexDirection:"column",gap:16 }}>
          <div className="card">
            <div style={{ fontWeight:700,fontSize:13,marginBottom:14 }}>Évolution sur 12 mois</div>
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={timelineData}>
                <defs>
                  <linearGradient id="gR2" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#4ade80" stopOpacity={0.3}/><stop offset="95%" stopColor="#4ade80" stopOpacity={0}/></linearGradient>
                  <linearGradient id="gE2" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#f87171" stopOpacity={0.3}/><stop offset="95%" stopColor="#f87171" stopOpacity={0}/></linearGradient>
                </defs>
                <XAxis dataKey="month" tick={{fill:"rgba(237,233,248,0.35)",fontSize:11}} axisLine={false} tickLine={false}/>
                <YAxis tick={{fill:"rgba(237,233,248,0.35)",fontSize:11}} axisLine={false} tickLine={false} width={75} tickFormatter={v=>fmtCompact(v)}/>
                <Tooltip content={<CT/>}/>
                <Legend formatter={v => <span style={{ fontSize:12,color:"var(--text2)" }}>{v}</span>}/>
                <Area type="monotone" dataKey="revenus"  stroke="#4ade80" strokeWidth={2.5} fill="url(#gR2)" name="Revenus"/>
                <Area type="monotone" dataKey="dépenses" stroke="#f87171" strokeWidth={2.5} fill="url(#gE2)" name="Dépenses"/>
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="card">
            <div style={{ fontWeight:700,fontSize:13,marginBottom:14 }}>Solde mensuel</div>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={timelineData}>
                <XAxis dataKey="month" tick={{fill:"rgba(237,233,248,0.35)",fontSize:11}} axisLine={false} tickLine={false}/>
                <YAxis tick={{fill:"rgba(237,233,248,0.35)",fontSize:11}} axisLine={false} tickLine={false} width={75} tickFormatter={v=>fmtCompact(v)}/>
                <Tooltip content={<CT/>}/>
                <Bar dataKey="solde" name="Solde" radius={[6,6,0,0]}>
                  {timelineData.map((e,i) => <Cell key={i} fill={e.solde>=0?"#4ade80":"#f87171"}/>)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          {/* Meilleur / pire mois */}
          {timelineData.some(d => d.solde !== 0) && (() => {
            const withData = timelineData.filter(d => d.revenus > 0 || d.dépenses > 0);
            if (withData.length < 2) return null;
            const best  = withData.reduce((a,b) => a.solde > b.solde ? a : b);
            const worst = withData.reduce((a,b) => a.solde < b.solde ? a : b);
            return (
              <div className="grid-2">
                <div className="card" style={{ borderColor:"rgba(74,222,128,0.2)",textAlign:"center" }}>
                  <div style={{ fontSize:28,marginBottom:6 }}>🏆</div>
                  <div style={{ fontSize:11,color:"var(--text3)",marginBottom:4 }}>Meilleur mois</div>
                  <div style={{ fontWeight:700,fontSize:14 }}>{best.month}</div>
                  <div style={{ fontWeight:800,color:"var(--green)",fontSize:16 }}>{fmt(best.solde)}</div>
                </div>
                <div className="card" style={{ borderColor:"rgba(248,113,113,0.2)",textAlign:"center" }}>
                  <div style={{ fontSize:28,marginBottom:6 }}>📉</div>
                  <div style={{ fontSize:11,color:"var(--text3)",marginBottom:4 }}>Mois difficile</div>
                  <div style={{ fontWeight:700,fontSize:14 }}>{worst.month}</div>
                  <div style={{ fontWeight:800,color:"var(--red)",fontSize:16 }}>{fmt(worst.solde)}</div>
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {statTab === "profiles" && (
        <div className="content-grid">
          {profBreakdown.map(p => (
            <div key={p.id} className="card">
              <div style={{ display:"flex",alignItems:"center",gap:14,marginBottom:16 }}>
                <div style={{ fontSize:46 }}>{p.avatar}</div>
                <div>
                  <div style={{ fontWeight:800,fontSize:18 }}>{p.name}</div>
                  <div style={{ fontSize:12,color:p.color }}>Solde : <strong>{fmt(p.balance)}</strong></div>
                </div>
              </div>
              <div className="grid-2" style={{ marginBottom:14 }}>
                <div style={{ background:"rgba(74,222,128,0.08)",borderRadius:12,padding:"10px",textAlign:"center" }}>
                  <div style={{ fontSize:10,color:"var(--text3)",marginBottom:3 }}>Revenus</div>
                  <div style={{ fontWeight:800,color:"var(--green)",fontSize:16 }}>+{fmt(p.inc)}</div>
                </div>
                <div style={{ background:"rgba(248,113,113,0.08)",borderRadius:12,padding:"10px",textAlign:"center" }}>
                  <div style={{ fontSize:10,color:"var(--text3)",marginBottom:3 }}>Dépenses</div>
                  <div style={{ fontWeight:800,color:"var(--red)",fontSize:16 }}>-{fmt(p.spent)}</div>
                </div>
              </div>
              {p.inc>0 && (
                <>
                  <div style={{ display:"flex",justifyContent:"space-between",fontSize:12,color:"var(--text3)",marginBottom:5 }}>
                    <span>Budget utilisé</span>
                    <span style={{ fontWeight:700,color:p.spent>p.inc?"var(--red)":"var(--green)" }}>{Math.round((p.spent/p.inc)*100)}%</span>
                  </div>
                  <div className="progress-track" style={{ height:8 }}>
                    <div className="progress-fill" style={{ width:`${Math.min(100,(p.spent/p.inc)*100)}%`,background:p.color,boxShadow:`0 0 8px ${p.color}50` }}/>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
//  SETTINGS
// ═══════════════════════════════════════════════════════════
function SettingsPage({ data, update, setModal, user }) {
  const [newCat, setNewCat] = useState({ name:"", icon:"✨", color:"#a78bfa" });

  const addCat = () => {
    if (!newCat.name.trim()) return;
    update(d => { d.categories.push({ id:`c_${mkid()}`, name:newCat.name.trim(), icon:newCat.icon, color:newCat.color }); });
    setNewCat({ name:"", icon:"✨", color:"#a78bfa" });
  };

  const totalMonths    = Object.keys(data.monthsData).length;
  const totalTx        = Object.values(data.monthsData).reduce((s,m) => s+(m.transactions?.length||0), 0);

  return (
    <div className="fade-up content-grid">
      <div style={{ display:"flex",flexDirection:"column",gap:14 }}>
        {/* Profiles */}
        <div className="card">
          <div style={{ fontWeight:700,fontSize:14,marginBottom:14,display:"flex",alignItems:"center",gap:7 }}>👤 Profils</div>
          {data.profiles.map(p => (
            <div key={p.id} style={{ display:"flex",alignItems:"center",gap:12,padding:"12px 0",borderBottom:"1px solid var(--border)" }}>
              <div style={{ width:40,height:40,borderRadius:12,background:`${p.color}18`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:24 }}>{p.avatar}</div>
              <div style={{ flex:1 }}>
                <div style={{ fontWeight:700 }}>{p.name}</div>
                <div style={{ fontSize:11,color:p.color,textTransform:"uppercase",letterSpacing:.5 }}>{p.id==="common"?"Commun":"Personnel"}</div>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => setModal({ type:"editProfile",profileId:p.id })}>Modifier</button>
            </div>
          ))}
        </div>

        {/* Categories */}
        <div className="card">
          <div style={{ fontWeight:700,fontSize:14,marginBottom:14 }}>🏷️ Catégories ({data.categories.length})</div>
          <div style={{ display:"flex",gap:8,marginBottom:14 }}>
            <input value={newCat.name} onChange={e => setNewCat(v=>({...v,name:e.target.value}))} placeholder="Nouvelle catégorie…" style={{ flex:1 }} onKeyDown={e=>e.key==="Enter"&&addCat()}/>
            <select value={newCat.icon} onChange={e => setNewCat(v=>({...v,icon:e.target.value}))} style={{ width:64 }}>
              {CAT_ICONS.map(i => <option key={i} value={i}>{i}</option>)}
            </select>
            <input type="color" value={newCat.color} onChange={e => setNewCat(v=>({...v,color:e.target.value}))} style={{ width:44 }}/>
            <button className="btn btn-primary btn-sm" onClick={addCat}>＋</button>
          </div>
          <div style={{ display:"flex",flexWrap:"wrap",gap:7 }}>
            {data.categories.map(c => (
              <div key={c.id} style={{ display:"flex",alignItems:"center",gap:5,background:`${c.color}15`,border:`1px solid ${c.color}35`,borderRadius:20,padding:"5px 12px" }}>
                <span>{c.icon}</span>
                <span style={{ fontSize:12,fontWeight:600 }}>{c.name}</span>
                <button onClick={() => update(d => { d.categories = d.categories.filter(x => x.id!==c.id); })}
                  style={{ background:"none",border:"none",color:"var(--red)",cursor:"pointer",fontSize:15,lineHeight:1,padding:"0 2px",marginLeft:2 }}>×</button>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ display:"flex",flexDirection:"column",gap:14 }}>
        {/* Account */}
        <div className="card">
          <div style={{ fontWeight:700,fontSize:14,marginBottom:12 }}>☁️ Compte Firebase</div>
          <div style={{ fontSize:13,color:"var(--text2)",marginBottom:14,display:"flex",alignItems:"center",gap:8 }}>
            <div className="sync-dot" style={{ animation:"pulse 2s infinite" }}/>
            <span style={{ overflow:"hidden",textOverflow:"ellipsis" }}>{user?.email}</span>
          </div>
          <button className="btn btn-ghost" style={{ width:"100%" }} onClick={() => signOut(auth)}>🚪 Déconnexion</button>
        </div>

        {/* Stats */}
        <div className="card" style={{ borderColor:"rgba(96,165,250,0.2)" }}>
          <div style={{ fontWeight:700,fontSize:14,marginBottom:14 }}>📊 Données enregistrées</div>
          {[
            { label:"Mois avec données", val:totalMonths, icon:"📅" },
            { label:"Transactions totales", val:totalTx, icon:"🧾" },
            { label:"Factures configurées", val:data.bills.length, icon:"📋" },
            { label:"Revenus récurrents", val:data.recurringIncomes?.length||0, icon:"🔄" },
          ].map(s => (
            <div key={s.label} style={{ display:"flex",alignItems:"center",gap:10,padding:"9px 0",borderBottom:"1px solid var(--border)" }}>
              <span style={{ fontSize:18 }}>{s.icon}</span>
              <span style={{ flex:1,fontSize:13,color:"var(--text2)" }}>{s.label}</span>
              <span style={{ fontWeight:800,fontSize:14,color:"var(--blue)" }}>{s.val}</span>
            </div>
          ))}
        </div>

        {/* Danger zone */}
        <div className="card" style={{ borderColor:"rgba(248,113,113,0.2)" }}>
          <div style={{ fontWeight:700,fontSize:14,color:"var(--red)",marginBottom:10 }}>⚠️ Zone de danger</div>
          <div style={{ fontSize:12,color:"var(--text3)",marginBottom:14 }}>Cette action supprimera toutes tes données définitivement. Irréversible.</div>
          <button className="btn btn-danger" style={{ width:"100%" }}
            onClick={() => { if (window.confirm("Supprimer TOUTES les données ? Cette action est irréversible.")) update(d => { Object.assign(d, JSON.parse(JSON.stringify(INIT))); }); }}>
            🗑️ Réinitialiser toutes les données
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
//  MODAL ROUTER
// ═══════════════════════════════════════════════════════════
function ModalRouter({ modal, setModal, data, update, selMonth }) {
  const close = () => setModal(null);
  // Close on Escape
  useEffect(() => {
    const h = e => e.key === "Escape" && close();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  if (modal.type === "editIncome")          return <IncomeModal              close={close} data={data} update={update} profileId={modal.profileId} selMonth={modal.selMonth||selMonth}/>;
  if (modal.type === "addTransaction")      return <AddTxModal               close={close} data={data} update={update} selMonth={modal.selMonth||selMonth}/>;
  if (modal.type === "editTransaction")     return <EditTxModal              close={close} data={data} update={update} tx={modal.tx} selMonth={modal.selMonth||selMonth}/>;
  if (modal.type === "addBill")             return <AddBillModal             close={close} data={data} update={update}/>;
  if (modal.type === "editProfile")         return <EditProfileModal         close={close} data={data} update={update} profileId={modal.profileId}/>;
  if (modal.type === "addRecurringIncome")  return <AddRecurringIncomeModal  close={close} data={data} update={update}/>;
  return null;
}

function ModalWrap({ close, title, children }) {
  return (
    <div className="modal-overlay" onClick={e => e.target===e.currentTarget && close()}>
      <div className="modal-box scale-in">
        <div style={{ fontWeight:800,fontSize:18,marginBottom:20,display:"flex",alignItems:"center",justifyContent:"space-between" }}>
          <span>{title}</span>
          <button onClick={close} style={{ background:"none",border:"none",color:"var(--text3)",cursor:"pointer",fontSize:24,lineHeight:1,transition:"color .2s" }}
            onMouseEnter={e=>e.target.style.color="var(--text)"} onMouseLeave={e=>e.target.style.color="var(--text3)"}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function IncomeModal({ close, data, update, profileId, selMonth }) {
  const profile = data.profiles.find(p => p.id===profileId);
  const current = data.monthsData[selMonth]?.incomes?.[profileId] || 0;
  const [val, setVal] = useState(current || "");
  const inputRef = useRef();

  useEffect(() => { inputRef.current?.focus(); }, []);

  const save = () => {
    update(d => { ensureMonth(d, selMonth); d.monthsData[selMonth].incomes[profileId] = parseFloat(val)||0; });
    close();
  };

  return (
    <ModalWrap close={close} title={`💵 Revenu — ${profile?.name}`}>
      <div style={{ textAlign:"center",marginBottom:20 }}>
        <div style={{ fontSize:56,marginBottom:8 }}>{profile?.avatar}</div>
        <div style={{ fontSize:12,color:"var(--text2)" }}>{monthLabel(selMonth)}</div>
      </div>
      <label>Montant (€)</label>
      <input ref={inputRef} type="number" value={val} onChange={e => setVal(e.target.value)}
        placeholder="Ex: 2500" style={{ marginBottom:20,fontSize:18,textAlign:"center" }}
        onKeyDown={e => e.key==="Enter" && save()}/>
      <div style={{ display:"flex",gap:10 }}>
        <button className="btn btn-ghost" onClick={close} style={{ flex:1 }}>Annuler</button>
        <button className="btn btn-primary" onClick={save} style={{ flex:1 }}>Enregistrer</button>
      </div>
    </ModalWrap>
  );
}

function AddTxModal({ close, data, update, selMonth }) {
  const [label, setLabel]           = useState("");
  const [amount, setAmount]         = useState("");
  const [catId, setCatId]           = useState(data.categories[0]?.id || "");
  const [profId, setProfId]         = useState(data.profiles[0]?.id || "");
  const [customDate, setCustomDate] = useState("");
  const labelRef = useRef();

  useEffect(() => { labelRef.current?.focus(); }, []);

  const save = () => {
    if (!label.trim() || !amount) return;
    update(d => {
      ensureMonth(d, selMonth);
      d.monthsData[selMonth].transactions.push({
        id:mkid(), label:label.trim(), amount:parseFloat(amount),
        categoryId:catId, profileId:profId,
        timestamp: customDate ? new Date(customDate).toISOString() : nowISO(),
      });
    });
    close();
  };

  return (
    <ModalWrap close={close} title="💳 Nouvelle dépense">
      <div style={{ marginBottom:12 }}>
        <label>Libellé</label>
        <input ref={labelRef} value={label} onChange={e => setLabel(e.target.value)} placeholder="Ex: Courses Lidl"/>
      </div>
      <div style={{ marginBottom:12 }}>
        <label>Montant (€)</label>
        <input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00"/>
      </div>
      <div className="grid-2" style={{ marginBottom:12 }}>
        <div>
          <label>Catégorie</label>
          <select value={catId} onChange={e => setCatId(e.target.value)}>
            {data.categories.map(c => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
          </select>
        </div>
        <div>
          <label>Profil</label>
          <select value={profId} onChange={e => setProfId(e.target.value)}>
            {data.profiles.map(p => <option key={p.id} value={p.id}>{p.avatar} {p.name}</option>)}
          </select>
        </div>
      </div>
      <div style={{ marginBottom:18 }}>
        <label>Date (optionnel)</label>
        <input type="datetime-local" value={customDate} onChange={e => setCustomDate(e.target.value)}/>
      </div>
      <div style={{ display:"flex",gap:10 }}>
        <button className="btn btn-ghost" onClick={close} style={{ flex:1 }}>Annuler</button>
        <button className="btn btn-primary" onClick={save} style={{ flex:1 }} disabled={!label.trim()||!amount}>Ajouter</button>
      </div>
    </ModalWrap>
  );
}

// NEW: Edit Transaction Modal
function EditTxModal({ close, data, update, tx, selMonth }) {
  const [label, setLabel]       = useState(tx.label || "");
  const [amount, setAmount]     = useState(tx.amount || "");
  const [catId, setCatId]       = useState(tx.categoryId || data.categories[0]?.id || "");
  const [profId, setProfId]     = useState(tx.profileId || data.profiles[0]?.id || "");
  const [customDate, setDate]   = useState(tx.timestamp ? tx.timestamp.slice(0,16) : "");

  const save = () => {
    if (!label.trim() || !amount) return;
    update(d => {
      ensureMonth(d, selMonth);
      const idx = d.monthsData[selMonth].transactions.findIndex(t => t.id===tx.id);
      if (idx >= 0) {
        d.monthsData[selMonth].transactions[idx] = {
          ...d.monthsData[selMonth].transactions[idx],
          label:label.trim(), amount:parseFloat(amount),
          categoryId:catId, profileId:profId,
          timestamp:customDate ? new Date(customDate).toISOString() : tx.timestamp,
        };
      }
    });
    close();
  };

  return (
    <ModalWrap close={close} title="✏️ Modifier la dépense">
      <div style={{ marginBottom:12 }}>
        <label>Libellé</label>
        <input value={label} onChange={e => setLabel(e.target.value)} placeholder="Ex: Courses Lidl" autoFocus/>
      </div>
      <div style={{ marginBottom:12 }}>
        <label>Montant (€)</label>
        <input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00"/>
      </div>
      <div className="grid-2" style={{ marginBottom:12 }}>
        <div>
          <label>Catégorie</label>
          <select value={catId} onChange={e => setCatId(e.target.value)}>
            {data.categories.map(c => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
          </select>
        </div>
        <div>
          <label>Profil</label>
          <select value={profId} onChange={e => setProfId(e.target.value)}>
            {data.profiles.map(p => <option key={p.id} value={p.id}>{p.avatar} {p.name}</option>)}
          </select>
        </div>
      </div>
      <div style={{ marginBottom:18 }}>
        <label>Date</label>
        <input type="datetime-local" value={customDate} onChange={e => setDate(e.target.value)}/>
      </div>
      <div style={{ display:"flex",gap:10 }}>
        <button className="btn btn-ghost" onClick={close} style={{ flex:1 }}>Annuler</button>
        <button className="btn btn-primary" onClick={save} style={{ flex:1 }} disabled={!label.trim()||!amount}>Enregistrer</button>
      </div>
    </ModalWrap>
  );
}

function AddBillModal({ close, data, update }) {
  const [name, setName]         = useState("");
  const [amount, setAmount]     = useState("");
  const [icon, setIcon]         = useState("⚡");
  const [profId, setProfId]     = useState("common");
  const [catId, setCatId]       = useState(data.categories[0]?.id || "");
  const [dueDate, setDueDate]   = useState("");
  const [recurring, setRecurring] = useState(true);

  const save = () => {
    if (!name.trim()) return;
    update(d => {
      d.bills.push({
        id:mkid(), name:name.trim(), amount:parseFloat(amount)||0, icon,
        profileId:profId, categoryId:catId,
        dueDate:dueDate ? new Date(dueDate).toISOString() : null,
        recurring, paid:{}, createdAt:nowISO(),
      });
    });
    close();
  };

  return (
    <ModalWrap close={close} title="📋 Nouvelle facture">
      <div style={{ marginBottom:12 }}>
        <label>Nom</label>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Ex: Électricité EDF" autoFocus/>
      </div>
      <div style={{ marginBottom:12 }}>
        <label>Icône</label>
        <div style={{ display:"flex",flexWrap:"wrap",gap:5 }}>
          {BILL_ICONS.map(i => (
            <button key={i} onClick={() => setIcon(i)} style={{
              fontSize:18, background:icon===i?"rgba(167,139,250,0.2)":"rgba(255,255,255,0.05)",
              border:`2px solid ${icon===i?"var(--purple)":"transparent"}`,
              borderRadius:8, width:36, height:36, cursor:"pointer", transition:"all .15s",
            }}>{i}</button>
          ))}
        </div>
      </div>
      <div className="grid-2" style={{ marginBottom:12 }}>
        <div>
          <label>Montant (€)</label>
          <input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0 = variable"/>
        </div>
        <div>
          <label>Date d'échéance</label>
          <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)}/>
        </div>
      </div>
      <div className="grid-2" style={{ marginBottom:12 }}>
        <div>
          <label>Payé par</label>
          <select value={profId} onChange={e => setProfId(e.target.value)}>
            {data.profiles.map(p => <option key={p.id} value={p.id}>{p.avatar} {p.name}</option>)}
          </select>
        </div>
        <div>
          <label>Catégorie</label>
          <select value={catId} onChange={e => setCatId(e.target.value)}>
            {data.categories.map(c => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
          </select>
        </div>
      </div>
      <div style={{ display:"flex",alignItems:"center",gap:10,marginBottom:20,background:"rgba(167,139,250,0.08)",borderRadius:12,padding:13 }}>
        <input type="checkbox" id="rec" checked={recurring} onChange={e => setRecurring(e.target.checked)} style={{ width:"auto",cursor:"pointer" }}/>
        <label htmlFor="rec" style={{ margin:0,cursor:"pointer",fontSize:13,color:"var(--text)" }}>🔄 Facture récurrente mensuelle</label>
      </div>
      <div style={{ display:"flex",gap:10 }}>
        <button className="btn btn-ghost" onClick={close} style={{ flex:1 }}>Annuler</button>
        <button className="btn btn-primary" onClick={save} style={{ flex:1 }} disabled={!name.trim()}>Créer</button>
      </div>
    </ModalWrap>
  );
}

function EditProfileModal({ close, data, update, profileId }) {
  const profile = data.profiles.find(p => p.id===profileId);
  const [name, setName]     = useState(profile?.name || "");
  const [avatar, setAvatar] = useState(profile?.avatar || "😊");
  const [color, setColor]   = useState(profile?.color || "#a78bfa");

  const save = () => {
    update(d => {
      const p = d.profiles.find(p => p.id===profileId);
      if (p) { p.name = name.trim(); p.avatar = avatar; p.color = color; }
    });
    close();
  };

  return (
    <ModalWrap close={close} title="✏️ Modifier le profil">
      <div style={{ textAlign:"center",fontSize:64,marginBottom:10 }}>{avatar}</div>
      <div className="grid-2" style={{ marginBottom:12 }}>
        <div>
          <label>Prénom</label>
          <input value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key==="Enter" && save()} autoFocus/>
        </div>
        <div>
          <label>Couleur</label>
          <div style={{ display:"flex",gap:6,flexWrap:"wrap" }}>
            {PROFILE_COLORS.map(c => (
              <button key={c} onClick={() => setColor(c)} style={{ width:28,height:28,borderRadius:"50%",background:c,border:`3px solid ${color===c?"white":"transparent"}`,cursor:"pointer",transition:"all .15s" }}/>
            ))}
          </div>
        </div>
      </div>
      <label>Avatar</label>
      <div style={{ display:"flex",flexWrap:"wrap",gap:6,justifyContent:"center",marginBottom:20 }}>
        {AVATARS.map(a => (
          <button key={a} onClick={() => setAvatar(a)} style={{
            fontSize:20, background:avatar===a?"rgba(167,139,250,0.2)":"rgba(255,255,255,0.05)",
            border:`2px solid ${avatar===a?"var(--purple)":"transparent"}`,
            borderRadius:9, width:40, height:40, cursor:"pointer",
          }}>{a}</button>
        ))}
      </div>
      <div style={{ display:"flex",gap:10 }}>
        <button className="btn btn-ghost" onClick={close} style={{ flex:1 }}>Annuler</button>
        <button className="btn btn-primary" onClick={save} style={{ flex:1 }}>Enregistrer</button>
      </div>
    </ModalWrap>
  );
}

function AddRecurringIncomeModal({ close, data, update }) {
  const [profId, setProfId]     = useState(data.profiles[0]?.id || "");
  const [amount, setAmount]     = useState("");
  const [startDate, setStartDate] = useState(curMonthKey()+"-01");

  const save = () => {
    if (!amount) return;
    update(d => {
      if (!d.recurringIncomes) d.recurringIncomes = [];
      d.recurringIncomes.push({
        id:mkid(), profileId:profId, amount:parseFloat(amount),
        startDate:new Date(startDate).toISOString(),
      });
    });
    close();
  };

  return (
    <ModalWrap close={close} title="🔄 Revenu récurrent">
      <div style={{ background:"rgba(74,222,128,0.07)",borderRadius:12,padding:14,marginBottom:16,fontSize:13,color:"var(--text2)",lineHeight:1.5 }}>
        Ce revenu sera appliqué automatiquement chaque mois à partir de la date choisie.
      </div>
      <div style={{ marginBottom:12 }}>
        <label>Profil</label>
        <select value={profId} onChange={e => setProfId(e.target.value)}>
          {data.profiles.map(p => <option key={p.id} value={p.id}>{p.avatar} {p.name}</option>)}
        </select>
      </div>
      <div style={{ marginBottom:12 }}>
        <label>Montant mensuel (€)</label>
        <input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="Ex: 2500" autoFocus/>
      </div>
      <div style={{ marginBottom:20 }}>
        <label>Date de début</label>
        <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}/>
      </div>
      <div style={{ display:"flex",gap:10 }}>
        <button className="btn btn-ghost" onClick={close} style={{ flex:1 }}>Annuler</button>
        <button className="btn btn-primary" onClick={save} style={{ flex:1 }} disabled={!amount}>Créer</button>
      </div>
    </ModalWrap>
  );
}
