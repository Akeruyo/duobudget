import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  PieChart, Pie, Cell, AreaChart, Area, BarChart, Bar,
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, CartesianGrid
} from "recharts";
import { auth, db } from "./firebase";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
  updatePassword,
  reauthenticateWithCredential,
  EmailAuthProvider,
  deleteUser,
} from "firebase/auth";
import { doc, getDoc, setDoc, onSnapshot, collection, query, where, getDocs } from "firebase/firestore";

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
//  PARTNER LINKING
// ═══════════════════════════════════════════════════════════
const getUserMetaRef = (uid) => doc(db, "userMeta", uid);
const getInviteRef   = (code) => doc(db, "inviteCodes", code.toUpperCase());

const generateInviteCode = () => {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
};

const saveInviteCode = async (uid, code) => {
  try { await setDoc(getInviteRef(code), { ownerUID: uid, createdAt: Date.now() }); return true; }
  catch { return false; }
};

const getLinkedUID = async (uid) => {
  try {
    const snap = await getDoc(getUserMetaRef(uid));
    return snap.exists() ? (snap.data().linkedUID || null) : null;
  } catch { return null; }
};

const setLinkedUID = async (uid, linkedUID) => {
  try { await setDoc(getUserMetaRef(uid), { linkedUID }, { merge: true }); return true; }
  catch { return false; }
};

const resolveInviteCode = async (code) => {
  try {
    const snap = await getDoc(getInviteRef(code.trim().toUpperCase()));
    return snap.exists() ? snap.data().ownerUID : null;
  } catch { return null; }
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
  height:calc(64px + env(safe-area-inset-top));
  padding-top:calc(10px + env(safe-area-inset-top));
  padding-left:calc(22px + env(safe-area-inset-left));
  padding-right:calc(16px + env(safe-area-inset-right));
  padding-bottom:10px;
  background:rgba(7,6,15,0.94);backdrop-filter:blur(32px);
  border-bottom:1px solid var(--border);
  display:flex;align-items:center;justify-content:space-between;flex-shrink:0;gap:10px;z-index:200;}
.page-content{flex:1;padding:24px;overflow-y:auto;overflow-x:visible;min-height:0;scroll-behavior:smooth;}

/* ── TOPBAR RIGHT WIDGET ── */
.topbar-clock{display:flex;align-items:center;gap:0;background:linear-gradient(135deg,rgba(167,139,250,0.14),rgba(244,114,182,0.09));border:1px solid rgba(167,139,250,0.25);border-radius:16px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.3),inset 0 1px 0 rgba(255,255,255,0.1);flex-shrink:0;}
.topbar-clock-date{padding:10px 18px;text-align:right;line-height:1.3;border-right:1px solid rgba(255,255,255,0.08);min-width:148px;}
.topbar-clock-time{padding:10px 18px;display:flex;align-items:baseline;gap:2px;font-family:'Fraunces',serif;}
.topbar-action-btn{display:inline-flex;align-items:center;gap:6px;padding:8px 16px;border-radius:11px;font-family:'Outfit',sans-serif;font-size:13px;font-weight:700;cursor:pointer;transition:all .2s;border:none;white-space:nowrap;}

/* ── PROFILE PHOTO ── */
.profile-photo{border-radius:50%;object-fit:cover;background:rgba(255,255,255,0.05);}
.photo-upload-btn{position:relative;cursor:pointer;display:inline-block;}
.photo-upload-btn input[type=file]{position:absolute;inset:0;opacity:0;cursor:pointer;font-size:0;}
.photo-upload-overlay{position:absolute;inset:0;border-radius:50%;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity .2s;font-size:16px;}
.photo-upload-btn:hover .photo-upload-overlay{opacity:1;}

/* ── CONTENT GRIDS ── */
.content-grid{display:grid;grid-template-columns:1fr 360px;gap:20px;align-items:start;}
.content-grid.wide{grid-template-columns:1fr !important;}

/* Tooltip classique pour filter chips */
.filter-bar{position:relative;overflow:visible !important;}
.filter-chip{position:relative;}

/* ── STATS CARDS ── */
.stat-kpi-card{border-radius:20px;padding:22px;position:relative;overflow:hidden;transition:all .25s cubic-bezier(.4,0,.2,1);}
.stat-kpi-card::before{content:'';position:absolute;inset:0;opacity:.08;background:radial-gradient(circle at 20% 20%,white,transparent 70%);}
.stat-kpi-card:hover{transform:translateY(-3px);box-shadow:0 12px 40px rgba(0,0,0,0.4)!important;}

/* ── BILL SECTION HEADERS ── */
.bill-section-hdr{display:flex;align-items:center;gap:10px;margin:18px 0 10px;font-size:10px;font-weight:900;letter-spacing:2px;text-transform:uppercase;}
.bill-section-hdr::after{content:'';flex:1;height:1px;background:currentColor;opacity:.18;}

/* ── TOOLTIP SYSTEM — fixed position, never clipped ── */
/* Disable old CSS tooltips — replaced by GlobalTooltip JS component */
.tip{position:relative;}
/* old ::after / ::before kept hidden */
.tip::after,.tip::before{display:none !important;}
/* Global tooltip overlay — rendered via JS fixed position */
.gtip{position:fixed;pointer-events:none;z-index:999999;
  background:linear-gradient(135deg,#1e1b3a,#2a2450);
  color:var(--text);font-family:'Outfit',sans-serif;font-size:11.5px;font-weight:600;
  white-space:nowrap;padding:7px 13px;border-radius:10px;
  border:1px solid rgba(167,139,250,0.3);
  box-shadow:0 8px 32px rgba(0,0,0,0.7);
  transition:opacity .15s;
  max-width:260px;white-space:normal;text-align:center;}
.gtip::after{content:'';position:absolute;top:100%;left:50%;transform:translateX(-50%);
  border:5px solid transparent;border-top-color:#2a2450;}
.gtip.tip-above::after{top:100%;border-top-color:#2a2450;border-bottom:none;}
.gtip.tip-below{transform:translateX(-50%);}.gtip.tip-below::after{top:auto;bottom:100%;border-top-color:transparent;border-bottom-color:#2a2450;}

/* ── NAV ── */
.nav-section-label{font-size:9px;font-weight:900;letter-spacing:2.2px;text-transform:uppercase;color:var(--text3);padding:0 18px;margin:20px 0 7px;display:flex;align-items:center;gap:8px;}
.nav-section-label::after{content:'';flex:1;height:1px;background:linear-gradient(90deg,var(--border),transparent);margin-left:4px;}
.nav-item{display:flex;align-items:center;gap:12px;padding:10px 12px;margin:2px 10px;border-radius:14px;cursor:pointer;transition:all .2s cubic-bezier(.4,0,.2,1);font-size:13.5px;font-weight:600;color:var(--text2);position:relative;user-select:none;border:1px solid transparent;}
.nav-item:hover{color:var(--text);background:rgba(255,255,255,0.07);border-color:rgba(255,255,255,0.08);}
.nav-item:hover .nav-icon-wrap{background:rgba(255,255,255,0.13);transform:scale(1.08);}
.nav-item.active{color:#fff;background:linear-gradient(135deg,rgba(167,139,250,0.2),rgba(244,114,182,0.1));border-color:rgba(167,139,250,0.3);box-shadow:0 2px 20px rgba(167,139,250,0.14),inset 0 1px 0 rgba(255,255,255,0.07);}
.nav-item.active .nav-icon-wrap{background:var(--grad-main);box-shadow:0 4px 14px rgba(167,139,250,0.45);transform:scale(1);}
.nav-icon-wrap{width:34px;height:34px;border-radius:11px;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,0.06);transition:all .2s cubic-bezier(.4,0,.2,1);flex-shrink:0;border:1px solid rgba(255,255,255,0.06);}
.nav-item.active .nav-icon-wrap{border-color:transparent;}
.nav-icon{font-size:17px;line-height:1;display:flex;align-items:center;justify-content:center;}
.nav-badge{margin-left:auto;background:rgba(248,113,113,0.18);color:var(--red);border-radius:20px;padding:2px 8px;font-size:10px;font-weight:900;border:1px solid rgba(248,113,113,0.3);}

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
.tx-row{border-radius:13px;padding:11px 13px;transition:all .2s;border:1px solid transparent;display:flex;align-items:center;gap:12px;}
.tx-row:hover{background:rgba(255,255,255,0.05);border-color:var(--border);}
.tx-row.selected{background:rgba(167,139,250,0.08);border-color:rgba(167,139,250,0.25);}

/* ── EXPENSE ROW PREMIUM HOVER ── */
.expense-row{transition:all .22s cubic-bezier(.4,0,.2,1);cursor:default;}
.expense-row:hover{background:linear-gradient(135deg,rgba(167,139,250,0.07),rgba(244,114,182,0.04)) !important;border-color:rgba(167,139,250,0.28) !important;box-shadow:0 4px 24px rgba(167,139,250,0.1),inset 0 1px 0 rgba(255,255,255,0.05) !important;transform:translateX(2px);}
.expense-row .row-actions{opacity:0;transform:translateX(8px);transition:all .2s;}
.expense-row:hover .row-actions{opacity:1;transform:translateX(0);}

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
.filter-bar{display:flex;gap:7px;overflow-x:auto;padding-bottom:4px;scrollbar-width:none;flex-wrap:wrap;overflow:visible !important;}
.filter-bar::-webkit-scrollbar{display:none;}
.filter-chip{display:inline-flex;align-items:center;gap:6px;padding:7px 14px;border-radius:22px;border:1px solid var(--border);background:rgba(255,255,255,0.04);color:var(--text2);cursor:pointer;font-size:12.5px;font-weight:600;white-space:nowrap;flex-shrink:0;transition:all .2s;user-select:none;position:relative;}
.filter-chip .chip-emoji{font-size:15px;line-height:1;}
.filter-chip.active{border-color:rgba(167,139,250,0.55);background:rgba(167,139,250,0.14);color:var(--purple);box-shadow:0 2px 12px rgba(167,139,250,0.15),inset 0 1px 0 rgba(167,139,250,0.12);}
.filter-chip:hover:not(.active){background:rgba(255,255,255,0.09);border-color:rgba(255,255,255,0.15);transform:translateY(-1px);}

/* ── ACTION BUTTONS WITH LABELS ── */
.action-btn{display:inline-flex;align-items:center;gap:6px;padding:8px 14px;border-radius:11px;border:1px solid;cursor:pointer;font-family:'Outfit',sans-serif;font-size:12px;font-weight:700;transition:all .2s;white-space:nowrap;flex-shrink:0;letter-spacing:.2px;}
.action-btn-edit{background:rgba(167,139,250,0.07);border-color:rgba(167,139,250,0.2);color:var(--purple);}
.action-btn-edit:hover{background:rgba(167,139,250,0.22);border-color:rgba(167,139,250,0.5);transform:translateY(-1px);box-shadow:0 4px 16px rgba(167,139,250,0.25);}
.action-btn-dup{background:rgba(96,165,250,0.07);border-color:rgba(96,165,250,0.2);color:var(--blue);}
.action-btn-dup:hover{background:rgba(96,165,250,0.22);border-color:rgba(96,165,250,0.5);transform:translateY(-1px);box-shadow:0 4px 16px rgba(96,165,250,0.25);}
.action-btn-del{background:rgba(248,113,113,0.07);border-color:rgba(248,113,113,0.2);color:var(--red);}
.action-btn-del:hover{background:rgba(248,113,113,0.22);border-color:rgba(248,113,113,0.5);transform:translateY(-1px);box-shadow:0 4px 16px rgba(248,113,113,0.25);}

/* ── DASHBOARD BILL ITEMS — effet de bord hover ── */
.dash-bill-item{transition:all .28s cubic-bezier(.4,0,.2,1);}
.dash-bill-item:hover{transform:translateX(5px) !important;box-shadow:0 0 0 1.5px rgba(167,139,250,0.45),0 6px 28px rgba(167,139,250,0.18) !important;}
.dash-bill-item.overdue:hover{transform:translateX(5px) !important;box-shadow:0 0 0 1.5px rgba(248,113,113,0.55),0 6px 28px rgba(248,113,113,0.22) !important;}

/* ── CARD HOVER GLOW ── */
.card-glow{transition:all .28s cubic-bezier(.4,0,.2,1);}
.card-glow:hover{box-shadow:0 0 0 1.5px rgba(167,139,250,0.35),0 8px 36px rgba(167,139,250,0.14),var(--shadow-card) !important;transform:translateY(-2px);}

/* ── INCOME CARD ── */
.income-card{border-radius:var(--r);position:relative;overflow:hidden;transition:all .28s cubic-bezier(.4,0,.2,1);}
.income-card:hover{transform:translateY(-3px);box-shadow:0 0 0 1.5px rgba(167,139,250,0.4),0 12px 40px rgba(0,0,0,0.35),0 0 60px rgba(167,139,250,0.08) !important;}
.income-card::before{content:'';position:absolute;inset:0;opacity:0;transition:opacity .3s;background:radial-gradient(ellipse 80% 60% at 50% -20%,rgba(167,139,250,0.07),transparent);pointer-events:none;}
.income-card:hover::before{opacity:1;}

/* ── BILL CARD ROW HOVER ACTIONS (like transactions) ── */
.bill-card-row{transition:all .28s cubic-bezier(.4,0,.2,1);}
.bill-card-row:hover{transform:translateY(-2px);box-shadow:0 0 0 1.5px rgba(167,139,250,0.3),0 8px 32px rgba(0,0,0,0.3) !important;}
.bill-hover-actions{opacity:0;transform:translateX(10px);transition:all .22s cubic-bezier(.4,0,.2,1);}
.bill-card-row:hover .bill-hover-actions{opacity:1;transform:translateX(0);}

/* ── PROFILE CARD HOVER ── */
.profile-card{border-radius:var(--r);position:relative;cursor:pointer;transition:all .25s cubic-bezier(.4,0,.2,1);}
.profile-card:hover{transform:translateY(-2px);box-shadow:0 8px 36px rgba(0,0,0,0.3),0 0 0 1.5px rgba(167,139,250,0.25) !important;}

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
    padding-bottom:calc(84px + env(safe-area-inset-bottom));
    padding-left:calc(14px + env(safe-area-inset-left));
    padding-right:calc(14px + env(safe-area-inset-right));
  }
  .bottom-nav{
    display:flex;position:fixed;bottom:0;left:0;right:0;
    background:rgba(7,6,15,0.97);backdrop-filter:blur(24px);
    border-top:1px solid var(--border);
    justify-content:space-around;
    padding-top:8px;
    padding-bottom:calc(12px + env(safe-area-inset-bottom));
    padding-left:env(safe-area-inset-left);
    padding-right:env(safe-area-inset-right);
    z-index:250;
  }
  .bnav-item{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;padding:4px 8px;border-radius:12px;cursor:pointer;transition:all .18s;font-size:9px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.3px;min-width:48px;position:relative;}
  .bnav-item.active{color:var(--purple);}
  .bnav-item.active .bnav-icon-wrap{background:rgba(167,139,250,0.18);border-radius:12px;}
  .bnav-icon{font-size:22px;}
  .bnav-icon-wrap{padding:4px 12px;border-radius:10px;transition:all .18s;}
  .topbar{
    height:calc(56px + env(safe-area-inset-top)) !important;
    padding-left:calc(14px + env(safe-area-inset-left));
    padding-right:calc(14px + env(safe-area-inset-right));
  }
  /* Compact clock on mobile */
  .topbar-clock-date{display:none;}
  .topbar-clock{border-radius:12px;}
  .topbar-clock-time{padding:8px 14px;}
  /* Transaction rows on mobile */
  .expense-row{padding:16px 14px !important;}
  .expense-row:hover{padding-left:18px !important;}
  .row-actions{opacity:1 !important;transform:translateX(0) !important;flex-direction:row !important;}
  /* Income cards mobile */
  .income-card .stat-num{font-size:22px !important;}
  /* Bill actions always visible on mobile */
  .bill-hover-actions{opacity:1 !important;transform:translateX(0) !important;}
  /* Profile cards mobile — 1 col */
  .profile-cards-grid{grid-template-columns:1fr !important;}
  /* Stats KPI */
  .stat-kpi-card{padding:16px !important;}
  /* Bigger text for mobile readability */
  .stat-num{font-size:clamp(18px,4vw,28px);}
}
@media(max-width:520px){
  .grid-2{grid-template-columns:1fr !important;}
  .grid-3{grid-template-columns:1fr 1fr !important;}
  .grid-4{grid-template-columns:1fr 1fr !important;}
  .modal-box{padding:20px;border-radius:20px;}
  .profile-card{margin-bottom:2px;}
  .expense-row .tx-icon{width:48px !important;height:48px !important;font-size:22px !important;}
  /* Bigger touch targets */
  .btn{min-height:44px;}
  .nav-item{min-height:46px;}
  .filter-chip{padding:9px 16px !important;font-size:13px !important;}
}
/* iPhone notch / safe area */
@supports(padding-top: env(safe-area-inset-top)){
  .app-shell{padding-top:0;}
  .auth-shell{padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom);}
}
`;

// ═══════════════════════════════════════════════════════════
//  GLOBAL TOOLTIP — fixed-position, never clipped
// ═══════════════════════════════════════════════════════════
function GlobalTooltip() {
  const [tip, setTip] = useState(null);
  useEffect(() => {
    let timer;
    const show = (e) => {
      const el = e.target.closest('[data-tip]');
      if (!el) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        const rect = el.getBoundingClientRect();
        const TIP_H = 38, TIP_W = 240, GAP = 10;
        // Would showing above go off-screen?
        const canAbove = rect.top - TIP_H - GAP > 0;
        const canBelow = rect.bottom + TIP_H + GAP < window.innerHeight;
        const below = !canAbove || (!canAbove && canBelow);
        // X: centre on element, clamp to viewport
        let x = rect.left + rect.width / 2;
        x = Math.max(TIP_W / 2 + 6, Math.min(window.innerWidth - TIP_W / 2 - 6, x));
        setTip({
          text: el.dataset.tip,
          x,
          y: below ? rect.bottom + GAP : rect.top - GAP,
          below,
        });
      }, 100);
    };
    const hide = () => { clearTimeout(timer); setTip(null); };
    document.addEventListener('mouseover', show, true);
    document.addEventListener('mouseout',  hide,  true);
    document.addEventListener('scroll',    hide,  true);
    document.addEventListener('click',     hide,  true);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mouseover', show, true);
      document.removeEventListener('mouseout',  hide, true);
      document.removeEventListener('scroll',    hide, true);
      document.removeEventListener('click',     hide, true);
    };
  }, []);
  if (!tip) return null;
  return (
    <div className={`gtip ${tip.below ? 'tip-below' : 'tip-above'}`}
      style={{
        position: 'fixed',
        left: tip.x,
        transform: 'translateX(-50%)',
        zIndex: 999999,
        pointerEvents: 'none',
        ...(tip.below ? { top: tip.y } : { bottom: `calc(100vh - ${tip.y}px)` }),
      }}>
      {tip.text}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
//  FAVICON — SVG emoji injected dynamically
// ═══════════════════════════════════════════════════════════
function useFavicon() {
  useEffect(() => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="%23a78bfa"/><stop offset="100%" stop-color="%23f472b6"/></linearGradient></defs><rect width="100" height="100" rx="22" fill="url(%23g)"/><text y=".9em" font-size="72" x="12">💑</text></svg>`;
    const link = document.querySelector("link[rel~='icon']") || Object.assign(document.createElement('link'), { rel: 'icon' });
    link.href = `data:image/svg+xml,${svg}`;
    link.type = 'image/svg+xml';
    document.head.appendChild(link);
    document.title = "DuoBudget 💑";
  }, []);
}

function getPasswordStrength(pwd) {
  if (!pwd) return { score: 0, label: "", color: "transparent" };
  let score = 0;
  if (pwd.length >= 6)  score++;
  if (pwd.length >= 10) score++;
  if (/[A-Z]/.test(pwd)) score++;
  if (/[0-9]/.test(pwd)) score++;
  if (/[^A-Za-z0-9]/.test(pwd)) score++;
  const levels = [
    { label:"", color:"transparent" },
    { label:"Très faible", color:"#f87171" },
    { label:"Faible", color:"#fb923c" },
    { label:"Moyen", color:"#fbbf24" },
    { label:"Fort", color:"#4ade80" },
    { label:"Très fort", color:"#2dd4bf" },
  ];
  return { score, ...levels[score] };
}

function AuthScreen({ onLinked }) {
  const [view, setView] = useState("login"); // login | register | join | reset
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [loading, setLoading] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const emailRef = useRef();

  const switchView = (v) => { setView(v); setError(""); setInfo(""); setResetSent(false); setPassword(""); setInviteCode(""); setShowPwd(false); setTimeout(() => emailRef.current?.focus(), 80); };
  useEffect(() => { emailRef.current?.focus(); }, []);

  const AUTH_ERRORS = {
    "auth/invalid-email":"Adresse email invalide.","auth/user-not-found":"Aucun compte associé à cet email.",
    "auth/wrong-password":"Mot de passe incorrect.","auth/email-already-in-use":"Cette adresse est déjà utilisée.",
    "auth/weak-password":"Mot de passe trop court (6 caractères min).","auth/invalid-credential":"Email ou mot de passe incorrect.",
    "auth/too-many-requests":"Trop de tentatives. Veuillez patienter.","auth/network-request-failed":"Erreur réseau. Vérifiez votre connexion.",
  };

  const submit = async () => {
    setError(""); setLoading(true);
    try {
      if (view === "login") {
        await signInWithEmailAndPassword(auth, email, password);
      } else if (view === "register") {
        await createUserWithEmailAndPassword(auth, email, password);
      } else if (view === "join") {
        if (!inviteCode.trim()) { setError("Veuillez saisir le code de votre partenaire."); setLoading(false); return; }
        const ownerUID = await resolveInviteCode(inviteCode);
        if (!ownerUID) { setError("Code invalide ou expiré. Vérifiez avec votre partenaire."); setLoading(false); return; }
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        await setLinkedUID(cred.user.uid, ownerUID);
        if (onLinked) onLinked(ownerUID);
      }
    } catch (e) {
      if (e.code === "auth/email-already-in-use") {
        setError("already-in-use");
      } else {
        setError(AUTH_ERRORS[e.code] || "Une erreur est survenue.");
      }
    }
    setLoading(false);
  };

  const sendReset = async () => {
    const trimmed = email.trim();
    if (!trimmed) { setError("Veuillez saisir votre adresse email."); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) { setError("Adresse email invalide."); return; }
    setError(""); setLoading(true);
    try {
      // fetchSignInMethodsForEmail est obsolète en Firebase v10+ et retourne toujours []
      // On envoie directement — Firebase gère si l'email n'existe pas
      await sendPasswordResetEmail(auth, trimmed);
      setResetSent(true);
    } catch (e) {
      if (e.code === "auth/user-not-found") {
        setError("Aucun compte associé à cette adresse.");
      } else {
        setError(AUTH_ERRORS[e.code] || `Erreur inattendue (${e.code || e.message})`);
      }
    }
    setLoading(false);
  };

  const pwdStrength = getPasswordStrength(password);

  if (view === "reset") return (
    <div className="auth-shell"><style>{CSS}</style>
      <div className="auth-card scale-in" style={{ maxWidth:400 }}>
        <button className="reset-back-btn" onClick={() => switchView("login")}>← Retour à la connexion</button>
        {resetSent ? (
          <div style={{ textAlign:"center",padding:"10px 0 20px" }} className="fade-up">
            <div style={{ width:80,height:80,borderRadius:"50%",background:"radial-gradient(circle,rgba(74,222,128,0.2),rgba(74,222,128,0.05))",border:"2px solid rgba(74,222,128,0.4)",display:"flex",alignItems:"center",justifyContent:"center",boxShadow:"0 0 30px rgba(74,222,128,0.2)",margin:"0 auto 24px",animation:"scaleIn .4s cubic-bezier(.34,1.56,.64,1) both" }}>
              <svg width="36" height="36" viewBox="0 0 36 36" fill="none"><path className="check-anim" d="M8 18l7 7 13-13" stroke="#4ade80" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </div>
            <div style={{ fontFamily:"'Fraunces',serif",fontSize:24,fontWeight:700,marginBottom:10 }}>Email envoyé !</div>
            <p style={{ fontSize:14,color:"var(--text2)",lineHeight:1.6,marginBottom:6 }}>Un lien de réinitialisation a été envoyé à</p>
            <div style={{ display:"inline-block",background:"rgba(167,139,250,0.1)",border:"1px solid rgba(167,139,250,0.3)",borderRadius:10,padding:"6px 14px",fontSize:13,fontWeight:700,color:"var(--purple)",marginBottom:20 }}>{email}</div>
            <p style={{ fontSize:12,color:"var(--text3)",lineHeight:1.6,marginBottom:20 }}>Vérifiez vos spams si vous ne le voyez pas sous 5 minutes.</p>
            <button className="btn btn-primary" onClick={() => switchView("login")} style={{ width:"100%",justifyContent:"center",padding:"13px",fontSize:14 }}>🔑 Retour à la connexion</button>
          </div>
        ) : (
          <>
            <div style={{ textAlign:"center",marginBottom:28 }}>
              <div style={{ width:64,height:64,borderRadius:20,margin:"0 auto 16px",background:"linear-gradient(135deg,rgba(167,139,250,0.2),rgba(244,114,182,0.2))",border:"1px solid rgba(167,139,250,0.3)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:28 }}>🔐</div>
              <div style={{ fontFamily:"'Fraunces',serif",fontSize:24,fontWeight:700,marginBottom:8 }}>Réinitialiser</div>
              <p style={{ fontSize:13,color:"var(--text2)",lineHeight:1.6 }}>Entrez votre email pour recevoir un lien de réinitialisation DuoBudget.</p>
            </div>
            <div className="auth-field">
              <label>Adresse email</label><span className="field-icon">✉️</span>
              <input ref={emailRef} type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="vous@email.com" onKeyDown={e => e.key==="Enter" && sendReset()}/>
            </div>
            {error && <div className="alert-banner alert-danger" style={{ marginBottom:16 }}>⚠️ {error}</div>}
            <button className="btn btn-primary" onClick={sendReset} disabled={loading||!email.trim()} style={{ width:"100%",justifyContent:"center",padding:"14px",fontSize:15,marginTop:4 }}>
              {loading ? <><span className="spin" style={{ display:"inline-block",fontSize:16 }}>⟳</span> Envoi…</> : "📨 Envoyer le lien"}
            </button>
          </>
        )}
      </div>
    </div>
  );

  const tabs = [
    { id:"login",    icon:"🔑", label:"Connexion" },
    { id:"register", icon:"✨", label:"Créer un compte" },
    { id:"join",     icon:"💑", label:"Rejoindre" },
  ];

  return (
    <div className="auth-shell"><style>{CSS}</style>
      <div className="auth-card scale-in">
        {/* Header */}
        <div style={{ textAlign:"center",marginBottom:26 }}>
          <div style={{ width:72,height:72,borderRadius:22,margin:"0 auto 16px",background:"var(--grad-main)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:32,boxShadow:"0 8px 32px rgba(167,139,250,0.4),0 0 0 1px rgba(255,255,255,0.08)",animation:"float 3s ease-in-out infinite" }}>💑</div>
          <div className="glow-text" style={{ fontFamily:"'Fraunces',serif",fontSize:32,fontWeight:700,lineHeight:1 }}>DuoBudget</div>
          <div style={{ fontSize:11,color:"var(--text3)",marginTop:5,letterSpacing:1.2,textTransform:"uppercase",fontWeight:600 }}>Finance à deux</div>
        </div>

        {/* Tab bar */}
        <div style={{ display:"flex",gap:3,marginBottom:24,background:"rgba(255,255,255,0.04)",borderRadius:14,padding:4 }}>
          {tabs.map(({ id,icon,label }) => (
            <button key={id} onClick={() => switchView(id)} style={{ flex:1,padding:"9px 6px",borderRadius:11,border:"none",cursor:"pointer",background:view===id?"var(--grad-main)":"transparent",color:view===id?"white":"var(--text3)",fontFamily:"'Outfit',sans-serif",fontWeight:700,fontSize:11,transition:"all .25s",display:"flex",alignItems:"center",justifyContent:"center",gap:4,boxShadow:view===id?"0 4px 14px rgba(167,139,250,0.35)":"none" }}>
              <span style={{ fontSize:14 }}>{icon}</span>
              <span style={{ whiteSpace:"nowrap" }}>{label}</span>
            </button>
          ))}
        </div>

        {/* Join explanation */}
        {view === "join" && (
          <div style={{ background:"rgba(167,139,250,0.07)",border:"1px solid rgba(167,139,250,0.2)",borderRadius:14,padding:"12px 16px",marginBottom:18,fontSize:12,color:"var(--text2)",lineHeight:1.6 }}>
            💑 <strong style={{ color:"var(--purple)" }}>Rejoindre un espace partagé</strong><br/>
            Votre partenaire doit partager son <strong>code d'invitation</strong> depuis Réglages → Compte. Entrez-le ci-dessous pour accéder aux mêmes données.
          </div>
        )}

        {/* Email field */}
        <div className="auth-field">
          <label>{view==="join"?"Votre adresse email":"Adresse email"}</label>
          <span className="field-icon">✉️</span>
          <input ref={emailRef} type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="vous@email.com" autoComplete="email" onKeyDown={e => e.key==="Enter" && submit()}/>
        </div>

        {/* Password field */}
        <div className="auth-field" style={{ marginBottom:view!=="login"?6:4 }}>
          <label>Mot de passe</label><span className="field-icon">🔒</span>
          <input type={showPwd?"text":"password"} value={password} onChange={e => setPassword(e.target.value)} placeholder={view==="login"?"••••••••":"Minimum 6 caractères"} autoComplete={view==="login"?"current-password":"new-password"} onKeyDown={e => e.key==="Enter" && submit()} style={{ paddingRight:44 }}/>
          <button className="eye-btn" onClick={() => setShowPwd(v => !v)} type="button" tabIndex={-1}>{showPwd?"🙈":"👁️"}</button>
        </div>

        {/* Password strength */}
        {view !== "login" && password.length>0 && (
          <div style={{ marginBottom:14 }}>
            <div className="pwd-strength">{[1,2,3,4,5].map(i => <div key={i} className="pwd-strength-bar" style={{ background:i<=pwdStrength.score?pwdStrength.color:"rgba(255,255,255,0.07)" }}/>)}</div>
            {pwdStrength.label && <div style={{ fontSize:11,color:pwdStrength.color,marginTop:4,fontWeight:600,textAlign:"right" }}>{pwdStrength.label}</div>}
          </div>
        )}

        {/* Invite code for join */}
        {view === "join" && (
          <div className="auth-field">
            <label>Code d'invitation partenaire</label>
            <span className="field-icon">🔗</span>
            <input value={inviteCode} onChange={e => setInviteCode(e.target.value.toUpperCase())} placeholder="Ex: AB3XK7" maxLength={6} style={{ letterSpacing:4,fontWeight:800,fontSize:18,textAlign:"center",textTransform:"uppercase" }} onKeyDown={e => e.key==="Enter" && submit()}/>
          </div>
        )}

        {/* Forgot password */}
        {view==="login" && <div style={{ textAlign:"right",marginBottom:18,marginTop:4 }}><button onClick={() => switchView("reset")} style={{ background:"none",border:"none",color:"var(--purple)",cursor:"pointer",fontFamily:"'Outfit',sans-serif",fontSize:12,fontWeight:600,padding:0 }}>Mot de passe oublié ?</button></div>}

        {/* Errors/Info */}
        {error === "already-in-use" ? (
          <div style={{ marginBottom:14,background:"rgba(251,191,36,0.08)",border:"1px solid rgba(251,191,36,0.3)",borderRadius:13,padding:"14px 16px" }}>
            <div style={{ fontWeight:800,color:"var(--yellow)",fontSize:13,marginBottom:8 }}>⚠️ Cette adresse est déjà associée à un compte</div>
            <div style={{ fontSize:12,color:"var(--text2)",lineHeight:1.6,marginBottom:12 }}>
              Un compte existe déjà avec <strong>{email}</strong>. Connectez-vous directement, ou réinitialisez votre mot de passe si vous l'avez oublié.
            </div>
            <div style={{ display:"flex",gap:8 }}>
              <button onClick={() => switchView("login")} style={{ flex:1,padding:"9px 10px",borderRadius:10,border:"1px solid rgba(167,139,250,0.4)",background:"rgba(167,139,250,0.12)",color:"var(--purple)",cursor:"pointer",fontFamily:"'Outfit',sans-serif",fontWeight:700,fontSize:12 }}>
                🔑 Se connecter
              </button>
              <button onClick={() => switchView("reset")} style={{ flex:1,padding:"9px 10px",borderRadius:10,border:"1px solid rgba(251,191,36,0.3)",background:"rgba(251,191,36,0.08)",color:"var(--yellow)",cursor:"pointer",fontFamily:"'Outfit',sans-serif",fontWeight:700,fontSize:12 }}>
                🔐 Mot de passe oublié
              </button>
            </div>
          </div>
        ) : error ? (
          <div className="alert-banner alert-danger" style={{ marginBottom:14 }}>⚠️ {error}</div>
        ) : null}
        {info  && <div className="alert-banner alert-success" style={{ marginBottom:14 }}>✅ {info}</div>}

        {/* Submit */}
        <button className="btn btn-primary" onClick={submit} disabled={loading||!email||!password||(view!=="login"&&pwdStrength.score<1)} style={{ width:"100%",justifyContent:"center",padding:"14px",fontSize:15 }}>
          {loading ? <><span className="spin" style={{ display:"inline-block",fontSize:16 }}>⟳</span> En cours…</> :
            view==="login"  ? "🔑 Se connecter" :
            view==="join"   ? "🤝 Rejoindre l'espace" :
            "🚀 Créer mon compte"}
        </button>

        <div className="auth-divider">Sécurisé par Firebase</div>
        <div className="auth-features">
          {[["🔒","Chiffrement E2E"],["☁️","Sync temps réel"],["📱","PC & Mobile"],["💑","Espace partagé"]].map(([icon,label]) => (
            <div key={label} className="auth-feature-pill"><span>{icon}</span>{label}</div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function App() {
  useFavicon();

  const [user, setUser] = useState(undefined);
  const [data, setData] = useState(INIT);
  const [ready, setReady] = useState(false);
  const [syncStatus, setSyncStatus] = useState("synced");
  const [page, setPage] = useState("dashboard");
  const [selMonth, setSelMonth] = useState(curMonthKey());
  const [modal, setModal] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeUID, setActiveUID] = useState(null);
  const [isLinked, setIsLinked] = useState(false); // true if this user joined a partner's space

  const saveTimer = useRef(null);
  const isSaving = useRef(false);
  const localVersion = useRef(0);

  useEffect(() => { const unsub = onAuthStateChanged(auth, u => setUser(u||null)); return unsub; }, []);

  useEffect(() => {
    if (!user) { setReady(false); setActiveUID(null); setIsLinked(false); setData(INIT); return; }
    let unsub; let remoteTs = 0;
    setData(INIT); // reset before loading new user's data
    getLinkedUID(user.uid).then(async (linkedUID) => {
      const uid = linkedUID || user.uid;
      setActiveUID(uid);
      setIsLinked(!!linkedUID);
      firestoreLoad(uid).then(saved => {
        if (saved) { const { data:processed } = processDueBills(saved); setData(processed); remoteTs = saved._ts||0; }
        setReady(true);
        unsub = onSnapshot(getDocRef(uid), snap => {
          if (!snap.exists()) return;
          const remote = snap.data().budget; const ts = snap.data()._ts||0;
          if (ts > remoteTs && !isSaving.current) { remoteTs = ts; const { data:processed } = processDueBills(remote); setData(processed); }
        });
      });
    });
    return () => unsub && unsub();
  }, [user]);

  useEffect(() => {
    if (!ready || !user || !activeUID) return;
    const ver = ++localVersion.current; setSyncStatus("saving");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      if (ver !== localVersion.current) return;
      isSaving.current = true;
      const ok = await firestoreSave(activeUID, data);
      isSaving.current = false; setSyncStatus(ok?"synced":"error");
    }, 600);
    return () => clearTimeout(saveTimer.current);
  }, [data, ready, user, activeUID]);

  useEffect(() => {
    if (!ready) return;
    const t = setInterval(() => { setData(prev => { const { data:next,changed } = processDueBills(prev); return changed?next:prev; }); }, 60_000);
    return () => clearInterval(t);
  }, [ready]);

  const update = useCallback(fn => { setData(prev => { const next = JSON.parse(JSON.stringify(prev)); fn(next); return next; }); }, []);

  const allMonths = useMemo(() => {
    const keys = new Set([curMonthKey()]);
    Object.keys(data.monthsData).forEach(k => keys.add(k));
    for (let i=0; i<12; i++) { const d=new Date(); d.setMonth(d.getMonth()-i); keys.add(monthKey(d.getFullYear(),d.getMonth())); }
    return Array.from(keys).sort().reverse();
  }, [data.monthsData]);

  const mdata = useCallback((key=selMonth) => {
    const md = data.monthsData[key];
    if (!md) return { transactions:[], incomes:{p1:0,p2:0,common:0}, billsProcessed:{} };
    return { ...md, incomes:md.incomes||{p1:0,p2:0,common:0} };
  }, [data.monthsData, selMonth]);

  if (user === undefined) return (
    <div style={{ position:"fixed",inset:0,display:"flex",alignItems:"center",justifyContent:"center",background:"var(--bg)" }}>
      <style>{CSS}</style>
      <div style={{ textAlign:"center" }}><div style={{ fontSize:56,marginBottom:14,animation:"float 2s ease-in-out infinite" }}>💑</div><div className="glow-text" style={{ fontFamily:"'Fraunces',serif",fontSize:28 }}>Chargement…</div></div>
    </div>
  );
  if (!user) return <AuthScreen />;
  if (!ready) return (
    <div style={{ position:"fixed",inset:0,display:"flex",alignItems:"center",justifyContent:"center",background:"var(--bg)" }}>
      <style>{CSS}</style>
      <div style={{ textAlign:"center" }}><div style={{ fontSize:52,marginBottom:12,animation:"float 2s ease-in-out infinite" }}>☁️</div><div className="glow-text" style={{ fontFamily:"'Fraunces',serif",fontSize:22 }}>Synchronisation…</div><div style={{ fontSize:13,color:"var(--text3)",marginTop:6 }}>{user.email}</div></div>
    </div>
  );

  const hasProfiles = data.profiles.length >= 2;
  // New account with no profiles → show onboarding
  if (!hasProfiles) return (<><style>{CSS}</style><OnboardingScreen update={update} isLinked={isLinked} user={user}/></>);

  const unpaidBills = data.bills.filter(b => !b.paid?.[selMonth]).length;
  const overdueBills = data.bills.filter(b => { if (b.paid?.[selMonth]) return false; return b.dueDate && new Date(b.dueDate) < new Date(); }).length;

  const navItems = [
    { id:"dashboard", icon:"🏠", label:"Tableau de bord", desc:"Vue d'ensemble de vos finances" },
    { id:"incomes",   icon:"💵", label:"Revenus",         desc:"Gérer les revenus mensuels" },
    { id:"expenses",  icon:"💳", label:"Dépenses",        desc:"Toutes vos transactions du mois" },
    { id:"bills",     icon:"📋", label:"Factures",        desc:"Charges récurrentes à payer", badge:unpaidBills },
    { id:"stats",     icon:"📊", label:"Statistiques",    desc:"Analyses et tendances sur plusieurs mois" },
    { id:"essence",   icon:"⛽", label:"Essence",          desc:"Prix carburants — Saint-Dizier Leclerc" },
    { id:"settings",  icon:"⚙️", label:"Réglages",        desc:"Gérer profils, catégories, thème" },
  ];

  const navigate = id => { setPage(id); setSidebarOpen(false); };
  const pageTitles = { dashboard:"Tableau de bord",incomes:"Revenus",expenses:"Dépenses",bills:"Factures",stats:"Statistiques",settings:"Réglages",essence:"⛽ Essence — Saint-Dizier" };
  const syncLabel = { synced:"Synchronisé ✓",saving:"Sauvegarde…",error:"Erreur sync !" };
  const syncColor = { synced:"var(--green)",saving:"var(--yellow)",error:"var(--red)" };

  return (
    <>
      <style>{CSS}</style>
      <GlobalTooltip/>
      <div className="app-shell">
        <div className={`sidebar-overlay ${sidebarOpen?"open":""}`} onClick={() => setSidebarOpen(false)}/>

        <aside className={`sidebar ${sidebarOpen?"open":""}`}>
          <div style={{ padding:"20px 16px 18px",borderBottom:"1px solid var(--border)",background:"linear-gradient(180deg,rgba(167,139,250,0.06),transparent)" }}>
            <div style={{ display:"flex",alignItems:"center",gap:13 }}>
              <div style={{ width:46,height:46,borderRadius:15,background:"var(--grad-main)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,boxShadow:"0 6px 22px rgba(167,139,250,0.55),inset 0 1px 0 rgba(255,255,255,0.25)",flexShrink:0 }}>💑</div>
              <div>
                <div className="glow-text" style={{ fontFamily:"'Fraunces',serif",fontSize:22,fontWeight:700,lineHeight:1 }}>DuoBudget</div>
                <div style={{ fontSize:9,color:"var(--text3)",letterSpacing:1.6,textTransform:"uppercase",marginTop:3,fontWeight:700 }}>Finance à deux</div>
              </div>
            </div>
            <div style={{ display:"flex",gap:6,marginTop:14 }}>
              {data.profiles.filter(p => p.id!=="common").map(p => {
                const inc = mdata(selMonth).incomes[p.id]||0;
                const spent = mdata(selMonth).transactions.filter(t=>t.profileId===p.id).reduce((s,t)=>s+t.amount,0);
                return (
                  <div key={p.id} className="tip" data-tip={`${p.name} · Revenu: ${fmt(inc)} · Dép: ${fmt(spent)}`}
                    style={{ flex:1,display:"flex",alignItems:"center",gap:8,padding:"9px 11px",borderRadius:12,background:`${p.color}0c`,border:`1px solid ${p.color}25`,cursor:"default",transition:"all .2s" }}
                    onMouseEnter={e=>e.currentTarget.style.background=p.color+"1e"}
                    onMouseLeave={e=>e.currentTarget.style.background=p.color+"0c"}>
                    <div style={{ width:32,height:32,borderRadius:10,background:p.color+"22",border:`1px solid ${p.color}35`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:17,overflow:"hidden",flexShrink:0 }}>
                      {p.photo ? <img src={p.photo} alt={p.name} style={{ width:"100%",height:"100%",objectFit:"cover" }}/> : p.avatar}
                    </div>
                    <div style={{ minWidth:0 }}>
                      <div style={{ fontSize:11.5,fontWeight:800,color:p.color,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{p.name}</div>
                      <div style={{ fontSize:10,color:"var(--text3)",fontWeight:600,marginTop:1 }}>{inc>0?fmt(inc):"—"}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{ padding:"12px 14px",borderBottom:"1px solid var(--border)" }}>
            <div style={{ fontSize:9,color:"var(--text3)",textTransform:"uppercase",letterSpacing:1.6,fontWeight:800,marginBottom:7,display:"flex",alignItems:"center",gap:6 }}>
              <span>📅</span> Période
            </div>
            <select value={selMonth} onChange={e => setSelMonth(e.target.value)} className="tip" data-tip="Changer le mois affiché"
              style={{ background:"rgba(167,139,250,0.08)",border:"1px solid rgba(167,139,250,0.22)",borderRadius:10,color:"var(--text)",padding:"8px 12px",fontSize:12,fontWeight:700,cursor:"pointer",width:"100%" }}>
              {allMonths.map(k => <option key={k} value={k}>{monthLabel(k)}</option>)}
            </select>
          </div>

          <nav style={{ flex:1,paddingTop:4,overflowY:"auto" }}>
            <div className="nav-section-label">Navigation</div>
            {navItems.slice(0,5).map(n => (
              <div key={n.id} className={`nav-item tip ${page===n.id?"active":""}`} data-tip={n.desc||n.label} onClick={() => navigate(n.id)}>
                <div className="nav-icon-wrap"><span className="nav-icon">{n.icon}</span></div>
                <span style={{ flex:1 }}>{n.label}</span>
                {n.badge>0 && <span className="nav-badge">{overdueBills>0?"⚠️ ":""}{n.badge}</span>}
              </div>
            ))}
            <div className="nav-section-label">Plus</div>
            <div className={`nav-item tip ${page==="essence"?"active":""}`} data-tip="Prix carburants en temps réel" onClick={() => navigate("essence")}>
              <div className="nav-icon-wrap"><span className="nav-icon">⛽</span></div>
              <span>Essence</span>
              <span style={{ fontSize:9,background:"rgba(251,191,36,0.15)",color:"var(--yellow)",borderRadius:20,padding:"2px 7px",fontWeight:800,border:"1px solid rgba(251,191,36,0.3)" }}>LIVE</span>
            </div>
            <div className="nav-section-label">Système</div>
            <div className={`nav-item tip ${page==="settings"?"active":""}`} data-tip="Gérer profils, catégories" onClick={() => navigate("settings")}>
              <div className="nav-icon-wrap"><span className="nav-icon">⚙️</span></div>
              <span>Réglages</span>
            </div>
          </nav>

          <div style={{ padding:"12px 14px",borderTop:"1px solid var(--border)" }}>
            <div className="tip tip-left" data-tip="État de la synchronisation Firebase" style={{ display:"flex",alignItems:"center",gap:8,padding:"8px 10px",borderRadius:10,background:"rgba(255,255,255,0.03)",marginBottom:10,border:"1px solid var(--border)" }}>
              <div className={`sync-dot ${syncStatus}`}/><span style={{ fontSize:11,color:syncColor[syncStatus],fontWeight:700 }}>{syncLabel[syncStatus]}</span>
            </div>
            <button onClick={() => signOut(auth)} className="tip tip-left" data-tip="Se déconnecter"
              style={{ width:"100%",background:"rgba(248,113,113,0.06)",border:"1px solid rgba(248,113,113,0.16)",borderRadius:11,color:"var(--red)",cursor:"pointer",fontSize:12,fontWeight:700,padding:"10px",fontFamily:"'Outfit',sans-serif",transition:"all .22s",display:"flex",alignItems:"center",justifyContent:"center",gap:8 }}
              onMouseEnter={e=>{e.currentTarget.style.background="rgba(248,113,113,0.16)";e.currentTarget.style.borderColor="rgba(248,113,113,0.35)";}}
              onMouseLeave={e=>{e.currentTarget.style.background="rgba(248,113,113,0.06)";e.currentTarget.style.borderColor="rgba(248,113,113,0.16)";}}>
              <span style={{ fontSize:16 }}>🚪</span> Déconnexion
            </button>
          </div>
        </aside>

        <div className="main-area">
          <div className="topbar">
            <button className="menu-btn" onClick={() => setSidebarOpen(o => !o)} aria-label="Menu">☰</button>
            <div style={{ fontFamily:"'Fraunces',serif",fontSize:19,fontWeight:700,color:"var(--text)",flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{pageTitles[page]}</div>
            <div style={{ display:"flex",alignItems:"center",gap:8,flexShrink:0 }}>
              {page==="expenses" && (
                <>
                  <button className="topbar-action-btn tip" data-tip="Exporter en CSV"
                    style={{ background:"rgba(255,255,255,0.07)",border:"1px solid var(--border)",color:"var(--text2)" }}
                    onClick={() => exportCSV(mdata(selMonth).transactions,data.categories,data.profiles,selMonth)}>
                    📥 <span style={{ fontSize:12 }}>CSV</span>
                  </button>
                  <button className="topbar-action-btn tip" data-tip="Ajouter une dépense"
                    style={{ background:"var(--grad-main)",color:"white",boxShadow:"0 4px 14px rgba(167,139,250,0.35)" }}
                    onClick={() => setModal({ type:"addTransaction",selMonth })}>
                    + Dépense
                  </button>
                </>
              )}
              {page==="bills" && (
                <button className="topbar-action-btn tip" data-tip="Créer une facture récurrente"
                  style={{ background:"var(--grad-main)",color:"white",boxShadow:"0 4px 14px rgba(167,139,250,0.35)" }}
                  onClick={() => setModal({ type:"addBill" })}>
                  + Facture
                </button>
              )}
              {page==="incomes" && (
                <button className="topbar-action-btn tip" data-tip="Ajouter un revenu récurrent"
                  style={{ background:"var(--grad-main)",color:"white",boxShadow:"0 4px 14px rgba(167,139,250,0.35)" }}
                  onClick={() => setModal({ type:"addRecurringIncome" })}>
                  + Récurrent
                </button>
              )}
              {/* Sync dot */}
              <div className={`sync-dot tip ${syncStatus}`} data-tip={syncLabel[syncStatus]}/>
              {/* Clock */}
              <LiveClock/>
            </div>
          </div>

          <div className="page-content">
            {page==="dashboard" && <Dashboard data={data} update={update} selMonth={selMonth} mdata={mdata} setModal={setModal} allMonths={allMonths}/>}
            {page==="incomes"   && <Incomes   data={data} update={update} selMonth={selMonth} mdata={mdata} setModal={setModal}/>}
            {page==="expenses"  && <Expenses  data={data} update={update} selMonth={selMonth} mdata={mdata} setModal={setModal}/>}
            {page==="bills"     && <Bills     data={data} update={update} selMonth={selMonth} mdata={mdata} setModal={setModal}/>}
            {page==="stats"     && <Stats     data={data} selMonth={selMonth} mdata={mdata} allMonths={allMonths}/>}
            {page==="essence"   && <EssencePage/>}
            {page==="settings"  && <SettingsPage data={data} update={update} setModal={setModal} user={user} activeUID={activeUID}/>}
          </div>
        </div>

        <nav className="bottom-nav">
          {navItems.map(n => (
            <div key={n.id} className={`bnav-item ${page===n.id?"active":""}`} onClick={() => navigate(n.id)}>
              <div className="bnav-icon-wrap"><span className="bnav-icon">{n.icon}</span></div>
              <span>{n.label}</span>
              {n.badge>0 && <span style={{ position:"absolute",top:2,right:4,background:overdueBills>0?"var(--red)":"rgba(251,191,36,0.85)",color:"white",borderRadius:10,padding:"0 5px",fontSize:9,fontWeight:800 }}>{n.badge}</span>}
            </div>
          ))}
        </nav>

        {modal && <ModalRouter modal={modal} setModal={setModal} data={data} update={update} selMonth={selMonth}/>}
      </div>
    </>
  );
}


function OnboardingScreen({ update, isLinked, user }) {
  const [step, setStep] = useState(0); // 0=welcome, 1=profiles
  const [p1, setP1] = useState({ name:"", avatar:"😊", color:"#a78bfa" });
  const [p2, setP2] = useState({ name:"", avatar:"🥰", color:"#f472b6" });
  const [myProfile, setMyProfile] = useState({ name:"", avatar:"😊", color:"#a78bfa" });

  const colors = ["#a78bfa","#f472b6","#60a5fa","#4ade80","#fb923c","#f87171","#fbbf24","#34d399"];

  if (isLinked) {
    // Joined a shared space → add personal profile only
    return (
      <div style={{ position:"fixed",inset:0,display:"flex",alignItems:"center",justifyContent:"center",padding:24,background:`radial-gradient(ellipse 80% 60% at 50% 0%,rgba(167,139,250,0.18),transparent 65%),var(--bg)` }}>
        <div style={{ maxWidth:480,width:"100%",textAlign:"center" }} className="fade-up">
          <div style={{ fontSize:64,marginBottom:12,animation:"float 3s ease-in-out infinite" }}>👋</div>
          <h1 style={{ fontFamily:"'Fraunces',serif",fontSize:36,marginBottom:8 }} className="glow-text">Bienvenue !</h1>
          <p style={{ color:"var(--text2)",marginBottom:8,fontSize:14,lineHeight:1.6 }}>
            Vous rejoignez un espace partagé. Créez votre profil personnel pour interagir avec cet espace.
          </p>
          <div style={{ display:"inline-flex",alignItems:"center",gap:8,background:"rgba(167,139,250,0.1)",border:"1px solid rgba(167,139,250,0.25)",borderRadius:20,padding:"6px 14px",fontSize:12,color:"var(--purple)",fontWeight:700,marginBottom:32 }}>
            💑 Espace partagé · {user?.email}
          </div>
          <div className="glass" style={{ padding:28,borderRadius:24,marginBottom:24,textAlign:"left" }}>
            <div style={{ fontWeight:800,fontSize:15,marginBottom:18,color:"var(--purple)" }}>🧑 Votre profil</div>
            <div style={{ textAlign:"center",fontSize:56,marginBottom:14 }}>{myProfile.avatar}</div>
            <input value={myProfile.name} onChange={e=>setMyProfile(v=>({...v,name:e.target.value}))}
              placeholder="Votre prénom…" style={{ marginBottom:14,textAlign:"center",fontSize:15,fontWeight:700 }}/>
            <div style={{ display:"flex",flexWrap:"wrap",gap:5,justifyContent:"center",marginBottom:14 }}>
              {AVATARS.map(a => (
                <button key={a} onClick={() => setMyProfile(v=>({...v,avatar:a}))}
                  style={{ fontSize:18,background:myProfile.avatar===a?"rgba(167,139,250,0.2)":"rgba(255,255,255,0.05)",border:`2px solid ${myProfile.avatar===a?"#a78bfa":"transparent"}`,borderRadius:9,width:38,height:38,cursor:"pointer",transition:"all .15s" }}>{a}</button>
              ))}
            </div>
            <div style={{ display:"flex",flexWrap:"wrap",gap:6,justifyContent:"center" }}>
              {colors.map(c => (
                <button key={c} onClick={() => setMyProfile(v=>({...v,color:c}))}
                  style={{ width:26,height:26,borderRadius:"50%",background:c,border:myProfile.color===c?"3px solid white":"2px solid transparent",cursor:"pointer",transition:"all .15s",boxShadow:myProfile.color===c?`0 0 10px ${c}`:"none" }}/>
              ))}
            </div>
          </div>
          <button className="btn btn-primary" onClick={() => {
            if (!myProfile.name.trim()) return;
            const pid = "p_" + Date.now();
            update(d => {
              d.profiles = [...(d.profiles||[]), { id:pid,name:myProfile.name.trim(),avatar:myProfile.avatar,color:myProfile.color }];
            });
          }} disabled={!myProfile.name.trim()} style={{ padding:"14px 52px",fontSize:16,opacity:!myProfile.name.trim()?0.4:1 }}>
            🚀 Rejoindre l'espace
          </button>
        </div>
      </div>
    );
  }

  // New account → full onboarding with two profiles
  if (step === 0) return (
    <div style={{ position:"fixed",inset:0,display:"flex",alignItems:"center",justifyContent:"center",padding:24,background:`radial-gradient(ellipse 80% 60% at 50% 0%,rgba(167,139,250,0.2),transparent 65%),var(--bg)` }}>
      <div style={{ maxWidth:540,width:"100%",textAlign:"center" }} className="fade-up">
        <div style={{ fontSize:72,marginBottom:14,animation:"float 3s ease-in-out infinite" }}>💑</div>
        <h1 style={{ fontFamily:"'Fraunces',serif",fontSize:48,marginBottom:10 }} className="glow-text">DuoBudget</h1>
        <p style={{ color:"var(--text2)",marginBottom:10,fontSize:15,lineHeight:1.7 }}>
          Votre espace financier à deux. Gérez vos revenus, dépenses et objectifs ensemble.
        </p>
        <div style={{ display:"flex",justifyContent:"center",gap:10,flexWrap:"wrap",marginBottom:36 }}>
          {[["💑","Couple","Finance à deux"],["📊","Stats","Courbes & graphiques"],["⛽","Essence","Prix en temps réel"],["🔒","Sécurisé","Firebase chiffré"]].map(([i,t,s]) => (
            <div key={t} style={{ background:"rgba(255,255,255,0.04)",border:"1px solid var(--border)",borderRadius:14,padding:"12px 18px",textAlign:"center",minWidth:100 }}>
              <div style={{ fontSize:22,marginBottom:4 }}>{i}</div>
              <div style={{ fontWeight:800,fontSize:12 }}>{t}</div>
              <div style={{ fontSize:10,color:"var(--text3)",marginTop:2 }}>{s}</div>
            </div>
          ))}
        </div>
        <button className="btn btn-primary" onClick={() => setStep(1)} style={{ padding:"14px 56px",fontSize:16 }}>
          ✨ Créer nos profils →
        </button>
      </div>
    </div>
  );

  return (
    <div style={{ position:"fixed",inset:0,display:"flex",alignItems:"center",justifyContent:"center",padding:24,background:`radial-gradient(ellipse 80% 60% at 50% 0%,rgba(167,139,250,0.18),transparent 65%),var(--bg)`,overflowY:"auto" }}>
      <div style={{ maxWidth:680,width:"100%",textAlign:"center" }} className="fade-up">
        <div style={{ fontSize:52,marginBottom:8 }}>🧑‍🤝‍🧑</div>
        <h2 style={{ fontFamily:"'Fraunces',serif",fontSize:34,marginBottom:6 }} className="glow-text">Créez vos profils</h2>
        <p style={{ color:"var(--text2)",marginBottom:28,fontSize:13 }}>Chaque partenaire a son propre profil. Un compte commun sera créé automatiquement.</p>
        <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:24 }}>
          {[
            { label:"Profil 1",emoji:"💜",state:p1,set:setP1,color:"#a78bfa",defColor:"#a78bfa" },
            { label:"Profil 2",emoji:"🩷",state:p2,set:setP2,color:"#f472b6",defColor:"#f472b6" },
          ].map(({ label,emoji,state,set,color,defColor }) => (
            <div key={label} className="glass" style={{ padding:24,borderRadius:22 }}>
              <div style={{ fontWeight:800,fontSize:13,marginBottom:14,color }}>{emoji} {label}</div>
              <div style={{ fontSize:52,marginBottom:10 }}>{state.avatar}</div>
              <input value={state.name} onChange={e=>set(v=>({...v,name:e.target.value}))}
                placeholder="Ton prénom…" style={{ marginBottom:10,textAlign:"center",fontSize:14,fontWeight:700 }}/>
              <div style={{ display:"flex",flexWrap:"wrap",gap:4,justifyContent:"center",marginBottom:10 }}>
                {AVATARS.slice(0,20).map(a => (
                  <button key={a} onClick={() => set(v=>({...v,avatar:a}))}
                    style={{ fontSize:16,background:state.avatar===a?`${color}25`:"rgba(255,255,255,0.05)",border:`2px solid ${state.avatar===a?color:"transparent"}`,borderRadius:8,width:34,height:34,cursor:"pointer",transition:"all .12s" }}>{a}</button>
                ))}
              </div>
              <div style={{ display:"flex",flexWrap:"wrap",gap:5,justifyContent:"center" }}>
                {colors.map(c => (
                  <button key={c} onClick={() => set(v=>({...v,color:c}))}
                    style={{ width:22,height:22,borderRadius:"50%",background:c,border:state.color===c?"3px solid white":"2px solid transparent",cursor:"pointer",boxShadow:state.color===c?`0 0 8px ${c}`:"none" }}/>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div style={{ display:"flex",gap:12,justifyContent:"center" }}>
          <button className="btn btn-ghost" onClick={() => setStep(0)} style={{ padding:"12px 28px" }}>← Retour</button>
          <button className="btn btn-primary" onClick={() => {
            if (!p1.name.trim()||!p2.name.trim()) return;
            update(d => { d.profiles = [
              { id:"p1",name:p1.name.trim(),avatar:p1.avatar,color:p1.color },
              { id:"p2",name:p2.name.trim(),avatar:p2.avatar,color:p2.color },
              { id:"common",name:"Compte commun",avatar:"🏦",color:"#60a5fa" },
            ]; });
          }} disabled={!p1.name.trim()||!p2.name.trim()} style={{ padding:"14px 44px",fontSize:15,opacity:(!p1.name.trim()||!p2.name.trim())?0.4:1 }}>
            🚀 Commencer l'aventure !
          </button>
        </div>
      </div>
    </div>
  );
}

function SetupScreen({ update }) { return <OnboardingScreen update={update} isLinked={false}/>; }

function ProfileSetup({ label, emoji, color, value, onChange }) {
  return (
    <div>
      <div style={{ fontWeight:700,fontSize:14,marginBottom:14,color }}>{emoji} {label}</div>
      <div style={{ fontSize:56,marginBottom:14 }}>{value.avatar}</div>
      <input value={value.name} onChange={e => onChange(v=>({...v,name:e.target.value}))} placeholder="Ton prénom…" style={{ marginBottom:14,textAlign:"center",fontSize:15 }}/>
      <div style={{ display:"flex",flexWrap:"wrap",gap:5,justifyContent:"center" }}>
        {AVATARS.map(a => (
          <button key={a} onClick={() => onChange(v=>({...v,avatar:a}))} style={{ fontSize:18,background:value.avatar===a?`${color}25`:"rgba(255,255,255,0.05)",border:`2px solid ${value.avatar===a?color:"transparent"}`,borderRadius:9,width:38,height:38,cursor:"pointer",transition:"all .15s" }}>{a}</button>
        ))}
      </div>
    </div>
  );
}

function smartDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso); const now = new Date();
  const hms = pad(d.getHours())+":"+pad(d.getMinutes())+":"+pad(d.getSeconds());
  const diffDays = Math.floor((now - d) / 86400000);
  if (diffDays === 0) return "Aujourd'hui à "+hms;
  if (diffDays === 1) return "Hier à "+hms;
  if (diffDays === 2) return "Avant-hier à "+hms;
  return d.toLocaleDateString("fr-FR",{ day:"2-digit",month:"short",year:d.getFullYear()!==now.getFullYear()?"numeric":undefined })+" à "+hms;
}

function DashboardRecentTx({ transactions, catMap, profMap }) {
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState(false);
  const filtered = useMemo(() => {
    const sorted = [...transactions].sort((a,b) => new Date(b.timestamp)-new Date(a.timestamp));
    if (!search.trim()) return expanded?sorted:sorted.slice(0,5);
    const q = search.toLowerCase();
    return sorted.filter(tx => tx.label.toLowerCase().includes(q)||(catMap[tx.categoryId]?.name||"").toLowerCase().includes(q)||(profMap[tx.profileId]?.name||"").toLowerCase().includes(q));
  }, [transactions, search, expanded, catMap, profMap]);

  return (
    <>
      <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16 }}>
        <div style={{ display:"flex",alignItems:"center",gap:10 }}>
          <div style={{ width:36,height:36,borderRadius:11,background:"rgba(167,139,250,0.12)",border:"1px solid rgba(167,139,250,0.2)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:17 }}>🕐</div>
          <div>
            <div style={{ fontWeight:800,fontSize:15 }}>Dernières transactions</div>
            <div style={{ fontSize:11,color:"var(--text3)",marginTop:1 }}>{transactions.length} ce mois</div>
          </div>
        </div>
        {transactions.length>0 && <div style={{ fontFamily:"'Fraunces',serif",fontSize:17,fontWeight:800,color:"var(--red)" }}>-{fmt(transactions.reduce((s,t)=>s+t.amount,0))}</div>}
      </div>
      {transactions.length>0 && (
        <div style={{ position:"relative",marginBottom:14 }}>
          <span style={{ position:"absolute",left:13,top:"50%",transform:"translateY(-50%)",fontSize:13,pointerEvents:"none",opacity:.4 }}>🔍</span>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Filtrer les transactions…" style={{ paddingLeft:36,background:"rgba(255,255,255,0.04)",border:"1px solid var(--border)",borderRadius:11,fontSize:12.5,padding:"9px 13px 9px 36px" }}/>
          {search && <button onClick={() => setSearch("")} style={{ position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",color:"var(--text3)",fontSize:17,lineHeight:1 }}>×</button>}
        </div>
      )}
      {transactions.length===0 ? (
        <div className="empty-state" style={{ padding:"32px 16px" }}><div className="empty-icon">💸</div><div style={{ fontSize:14,fontWeight:700 }}>Aucune transaction ce mois</div></div>
      ) : filtered.length===0 ? (
        <div style={{ padding:"20px",textAlign:"center",color:"var(--text3)",fontSize:13 }}>Aucun résultat pour « {search} »</div>
      ) : (
        <div style={{ display:"flex",flexDirection:"column",gap:7 }}>
          {filtered.map(tx => {
            const cat = catMap[tx.categoryId]||{ icon:"❓",color:"#888",name:"Autre" };
            const prof = profMap[tx.profileId]||{ avatar:"❓",name:"?",color:"#888" };
            return (
              <div key={tx.id} style={{ display:"flex",alignItems:"center",gap:14,padding:"13px 14px",borderRadius:14,background:"rgba(255,255,255,0.025)",border:"1px solid rgba(255,255,255,0.06)",transition:"all .15s" }}
                onMouseEnter={e=>{e.currentTarget.style.background="rgba(255,255,255,0.05)";e.currentTarget.style.borderColor="rgba(255,255,255,0.1)";}}
                onMouseLeave={e=>{e.currentTarget.style.background="rgba(255,255,255,0.025)";e.currentTarget.style.borderColor="rgba(255,255,255,0.06)";}}>
                <div style={{ width:48,height:48,borderRadius:14,flexShrink:0,background:`${cat.color}14`,border:`1.5px solid ${cat.color}28`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:23,position:"relative" }}>
                  {cat.icon}
                  <div style={{ position:"absolute",bottom:-3,right:-3,width:18,height:18,borderRadius:"50%",background:prof.color||"#444",border:"2px solid #0e0c1e",display:"flex",alignItems:"center",justifyContent:"center",fontSize:9 }}>{prof.avatar}</div>
                </div>
                <div style={{ flex:1,minWidth:0 }}>
                  <div style={{ fontWeight:700,fontSize:15,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",marginBottom:5 }}>{tx.label}</div>
                  <div style={{ display:"flex",alignItems:"center",gap:7,flexWrap:"wrap" }}>
                    <span style={{ display:"inline-flex",alignItems:"center",gap:3,background:`${cat.color}12`,border:`1px solid ${cat.color}22`,borderRadius:20,padding:"2px 9px",fontSize:11,fontWeight:700,color:cat.color }}>{cat.icon} {cat.name}</span>
                    <span style={{ display:"inline-flex",alignItems:"center",gap:4,background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:20,padding:"2px 9px",fontSize:11,fontWeight:600,color:"var(--text3)" }}>🕐 {smartDate(tx.timestamp)}</span>
                  </div>
                </div>
                <div style={{ textAlign:"right",flexShrink:0 }}>
                  <div style={{ fontFamily:"'Fraunces',serif",fontWeight:800,fontSize:18,color:"var(--red)" }}>-{fmt(tx.amount)}</div>
                  {tx.auto && <div style={{ fontSize:9.5,color:"var(--purple)",fontWeight:800,marginTop:2,letterSpacing:.5 }}>AUTO</div>}
                </div>
              </div>
            );
          })}
          {!search && transactions.length>5 && (
            <button onClick={() => setExpanded(e=>!e)} style={{ width:"100%",marginTop:4,background:"rgba(255,255,255,0.025)",border:"1px solid var(--border)",borderRadius:11,color:"var(--text3)",cursor:"pointer",fontSize:12,fontWeight:700,padding:"10px",fontFamily:"'Outfit',sans-serif",transition:"all .2s" }}>
              {expanded ? "▲ Réduire" : `▼ Voir les ${transactions.length-5} autres transactions`}
            </button>
          )}
        </div>
      )}
    </>
  );
}

// ═══════════════════════════════════════
// DASHBOARD — avec profil cards améliorées
// ═══════════════════════════════════════
function Dashboard({ data, update, selMonth, mdata, setModal, allMonths }) {
  const md = mdata(selMonth);
  const { incomes, transactions } = md;
  const [balanceView, setBalanceView] = useState("global");

  const catMap  = useMemo(() => Object.fromEntries(data.categories.map(c=>[c.id,c])), [data.categories]);
  const profMap = useMemo(() => Object.fromEntries(data.profiles.map(p=>[p.id,p])), [data.profiles]);

  const totalIncome = useMemo(() => (incomes.p1||0)+(incomes.p2||0)+(incomes.common||0), [incomes]);
  const totalExp    = useMemo(() => transactions.reduce((s,t) => s+t.amount, 0), [transactions]);

  const viewData = useMemo(() => {
    if (balanceView === "global") return { inc:totalIncome,exp:totalExp,label:"Global — tous les comptes",color:null };
    const prof = data.profiles.find(p => p.id===balanceView);
    const inc  = incomes[balanceView]||0;
    const exp  = transactions.filter(t=>t.profileId===balanceView).reduce((s,t)=>s+t.amount,0);
    return { inc,exp,label:prof?`${prof.avatar} ${prof.name}`:balanceView,color:prof?.color||null };
  }, [balanceView,totalIncome,totalExp,incomes,transactions,data.profiles]);

  const balance = viewData.inc - viewData.exp;
  const pct     = viewData.inc>0 ? Math.min(100,(viewData.exp/viewData.inc)*100) : 0;
  const isPos   = balance >= 0;

  const catTotals = useMemo(() => { const m={}; transactions.forEach(t => { m[t.categoryId]=(m[t.categoryId]||0)+t.amount; }); return m; }, [transactions]);
  const topCats = useMemo(() => Object.entries(catTotals).sort((a,b)=>b[1]-a[1]).slice(0,6), [catTotals]);
  const pieData = useMemo(() => topCats.map(([cid,val]) => ({ name:(catMap[cid]?.icon||"")+" "+(catMap[cid]?.name||cid),value:val,color:catMap[cid]?.color||"#888" })), [topCats,catMap]);

  const unpaid  = useMemo(() => data.bills.filter(b=>!b.paid?.[selMonth]).sort((a,b)=>{ if(!a.dueDate)return 1; if(!b.dueDate)return -1; return new Date(a.dueDate)-new Date(b.dueDate); }), [data.bills,selMonth]);
  const paid    = useMemo(() => data.bills.filter(b=>b.paid?.[selMonth]), [data.bills,selMonth]);
  const overdue = useMemo(() => unpaid.filter(b=>b.dueDate&&new Date(b.dueDate)<new Date()), [unpaid]);

  const today       = new Date();
  const daysInMonth = new Date(today.getFullYear(),today.getMonth()+1,0).getDate();
  const dayOfMonth  = today.getDate();
  const projectedExp = dayOfMonth>0 ? (totalExp/dayOfMonth)*daysInMonth : 0;
  const isCurMonth  = selMonth===curMonthKey();

  const CT = ({ active, payload }) => {
    if (!active||!payload?.length) return null;
    const d = payload[0];
    return <div className="rc-tooltip"><div style={{ fontWeight:700 }}>{d.name}</div><div style={{ color:d.payload.color }}>{fmt(d.value)}</div></div>;
  };

  const fmtDue = iso => {
    if (!iso) return null;
    const d = new Date(iso); const diff = Math.ceil((d-new Date())/86400000);
    const lbl = d.toLocaleDateString("fr-FR",{ day:"numeric",month:"short" });
    if (diff<0)  return { text:`${lbl} · En retard`,color:"var(--red)" };
    if (diff===0) return { text:"Échéance aujourd'hui",color:"var(--red)" };
    if (diff<=3) return { text:`${lbl} · dans ${diff}j`,color:"var(--orange)" };
    if (diff<=7) return { text:`${lbl} · dans ${diff}j`,color:"var(--yellow)" };
    return { text:lbl,color:"var(--text3)" };
  };

  return (
    <div className="fade-up">
      {pct>=80 && viewData.inc>0 && (
        <div className={`alert-banner ${pct>=100?"alert-danger":"alert-warning"}`} style={{ marginBottom:14 }}>
          {pct>=100?"🔴":"⚠️"}<span>{pct>=100?"Budget dépassé !":`Budget utilisé à ${Math.round(pct)}% — restez vigilant`}</span>
        </div>
      )}
      {overdue.length>0 && (
        <div className="alert-banner alert-danger" style={{ marginBottom:14 }}>⏰ <span>{overdue.length} facture{overdue.length>1?"s":""} en retard de paiement !</span></div>
      )}

      {/* ══ PROFILE CARDS AMÉLIORÉES — toujours remplies ══ */}
      <div className="profile-cards-grid" style={{ display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12,marginBottom:20,overflow:"visible" }}>
        {data.profiles.map((p,i) => {
          const inc   = incomes[p.id]||0;
          const spent = transactions.filter(t=>t.profileId===p.id).reduce((s,t)=>s+t.amount,0);
          const sel   = balanceView===p.id;
          const spentPct = inc>0 ? Math.min(100,(spent/inc)*100) : 0;
          const savingsRate = inc>0 ? Math.round(((inc-spent)/inc)*100) : null;
          const profileTx = transactions.filter(t=>t.profileId===p.id);
          const profCats = {};
          profileTx.forEach(t => { profCats[t.categoryId]=(profCats[t.categoryId]||0)+t.amount; });
          const topProfCat = Object.entries(profCats).sort((a,b)=>b[1]-a[1]).slice(0,2);

          return (
            <div key={p.id}
              className="profile-card tip tip-below"
              data-tip={`Cliquer pour filtrer · ${p.name} · Revenu: ${fmt(inc)} · Dépenses: ${fmt(spent)}`}
              onClick={() => setBalanceView(sel?"global":p.id)}
              style={{
                padding:"18px 18px 16px",
                background:sel?`${p.color}12`:"var(--glass)",
                border:`1.5px solid ${sel?p.color+"55":"var(--border)"}`,
                boxShadow:sel?`0 0 28px ${p.color}22`:"none",
              }}>

              {/* Dot indicateur actif */}
              <div style={{ position:"absolute",top:12,right:12,width:7,height:7,borderRadius:"50%",background:p.color,boxShadow:`0 0 8px ${p.color}` }}/>

              {/* Header avatar + nom */}
              <div style={{ display:"flex",alignItems:"center",gap:11,marginBottom:14 }}>
                <div style={{ width:50,height:50,borderRadius:15,background:`${p.color}18`,border:`2px solid ${p.color}35`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:26,flexShrink:0,boxShadow:`0 4px 14px ${p.color}20` }}>
                  {p.avatar}
                </div>
                <div style={{ flex:1,minWidth:0 }}>
                  <div style={{ fontWeight:900,fontSize:16,color:p.color,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{p.name}</div>
                  <span style={{ fontSize:10,fontWeight:700,padding:"2px 8px",borderRadius:20,background:`${p.color}14`,border:`1px solid ${p.color}28`,color:p.color,textTransform:"uppercase",letterSpacing:.5 }}>
                    {p.id==="common"?"🏦 Commun":"💼 Personnel"}
                  </span>
                </div>
                {sel && <span style={{ fontSize:9,color:p.color,fontWeight:900,letterSpacing:.6,textTransform:"uppercase",flexShrink:0 }}>✓ Actif</span>}
              </div>

              {/* STATS GRID — toujours affichées (même avec 0) */}
              <div style={{ display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:7,marginBottom:12 }}>
                <div className="tip" data-tip="Revenu mensuel de ce profil"
                  style={{ textAlign:"center",padding:"9px 4px",background:"rgba(74,222,128,0.06)",borderRadius:11,border:"1px solid rgba(74,222,128,0.15)" }}>
                  <div style={{ fontSize:16,marginBottom:3 }}>💵</div>
                  <div style={{ fontSize:9,color:"var(--text3)",textTransform:"uppercase",letterSpacing:.4,fontWeight:700,marginBottom:2 }}>Revenu</div>
                  <div style={{ fontSize:12,fontWeight:900,color:inc>0?"var(--green)":"var(--text3)" }}>{inc>0?fmt(inc):"—"}</div>
                </div>
                <div className="tip" data-tip={`${profileTx.length} transaction(s) ce mois`}
                  style={{ textAlign:"center",padding:"9px 4px",background:"rgba(248,113,113,0.06)",borderRadius:11,border:"1px solid rgba(248,113,113,0.14)" }}>
                  <div style={{ fontSize:16,marginBottom:3 }}>💸</div>
                  <div style={{ fontSize:9,color:"var(--text3)",textTransform:"uppercase",letterSpacing:.4,fontWeight:700,marginBottom:2 }}>Dépensé</div>
                  <div style={{ fontSize:12,fontWeight:900,color:spent>0?"var(--red)":"var(--text3)" }}>{spent>0?fmt(spent):"0 €"}</div>
                </div>
                <div className="tip" data-tip="Taux d'épargne = (Revenu − Dépenses) / Revenu"
                  style={{ textAlign:"center",padding:"9px 4px",background:"rgba(45,212,191,0.06)",borderRadius:11,border:"1px solid rgba(45,212,191,0.15)" }}>
                  <div style={{ fontSize:16,marginBottom:3 }}>💹</div>
                  <div style={{ fontSize:9,color:"var(--text3)",textTransform:"uppercase",letterSpacing:.4,fontWeight:700,marginBottom:2 }}>Épargne</div>
                  <div style={{ fontSize:12,fontWeight:900,color:savingsRate===null?"var(--text3)":savingsRate<0?"var(--red)":"var(--teal)" }}>
                    {savingsRate!==null?`${savingsRate}%`:"—"}
                  </div>
                </div>
              </div>

              {/* Barre de progression (toujours visible) */}
              <div style={{ marginBottom:12 }}>
                <div style={{ display:"flex",justifyContent:"space-between",fontSize:10,color:"var(--text3)",marginBottom:5 }}>
                  <span>Budget utilisé</span>
                  <span style={{ fontWeight:800,color:spentPct>80?"var(--red)":spentPct>60?"var(--orange)":inc>0?p.color:"var(--text3)" }}>
                    {inc>0?`${Math.round(spentPct)}%`:"Revenu non défini"}
                  </span>
                </div>
                <div className="progress-track" style={{ height:5 }}>
                  <div className="progress-fill" style={{ width:`${spentPct}%`,background:spentPct>80?"var(--grad-red)":p.color,boxShadow:`0 0 8px ${p.color}50` }}/>
                </div>
              </div>

              {/* Top catégories si disponibles */}
              {topProfCat.length>0 && (
                <div style={{ display:"flex",gap:4,flexWrap:"wrap",marginBottom:12 }}>
                  {topProfCat.map(([cid,amt]) => {
                    const cat = catMap[cid]||{ icon:"❓",name:"?",color:"#888" };
                    return (
                      <span key={cid} className="tip" data-tip={`${cat.name} : ${fmt(amt)}`}
                        style={{ display:"inline-flex",alignItems:"center",gap:3,background:`${cat.color}14`,border:`1px solid ${cat.color}25`,borderRadius:20,padding:"2px 8px",fontSize:10,fontWeight:700,color:cat.color }}>
                        {cat.icon} {fmt(amt)}
                      </span>
                    );
                  })}
                </div>
              )}

              {/* Nb transactions badge */}
              <div style={{ marginBottom:14,display:"flex",alignItems:"center",gap:7,flexWrap:"wrap" }}>
                <span style={{ fontSize:11,color:"var(--text3)",background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:20,padding:"3px 10px",fontWeight:600 }}>
                  🧾 {profileTx.length} transaction{profileTx.length>1?"s":""}
                </span>
                {spent>0&&inc>0&&<span style={{ fontSize:11,color:p.color,background:`${p.color}12`,border:`1px solid ${p.color}28`,borderRadius:20,padding:"3px 10px",fontWeight:700 }}>
                  💰 Reste : {fmt(inc-spent)}
                </span>}
              </div>

              {/* BOUTON MODIFIER — grand, gradient couleur profil */}
              <button
                className="tip"
                data-tip={`Modifier le revenu de ${p.name} pour ${monthLabel(selMonth)}`}
                style={{
                  width:"100%",display:"flex",alignItems:"center",gap:10,
                  padding:"14px 16px",borderRadius:14,border:"none",cursor:"pointer",
                  fontFamily:"'Outfit',sans-serif",fontWeight:800,fontSize:14,
                  background:`linear-gradient(135deg, ${p.color} 0%, ${p.color}99 100%)`,
                  color:"white",
                  boxShadow:`0 6px 22px ${p.color}45, inset 0 1px 0 rgba(255,255,255,0.18)`,
                  transition:"all .22s cubic-bezier(.4,0,.2,1)",
                }}
                onMouseEnter={e=>{ e.currentTarget.style.transform="translateY(-2px)"; e.currentTarget.style.boxShadow=`0 10px 30px ${p.color}65, inset 0 1px 0 rgba(255,255,255,0.18)`; }}
                onMouseLeave={e=>{ e.currentTarget.style.transform=""; e.currentTarget.style.boxShadow=`0 6px 22px ${p.color}45, inset 0 1px 0 rgba(255,255,255,0.18)`; }}
                onClick={e=>{ e.stopPropagation(); setModal({ type:"editIncome",profileId:p.id,selMonth }); }}>
                <div style={{ width:30,height:30,borderRadius:9,background:"rgba(255,255,255,0.2)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:15,flexShrink:0 }}>✏️</div>
                <span style={{ flex:1,textAlign:"left" }}>Modifier le revenu de <strong>{p.name}</strong></span>
                <div style={{ background:"rgba(0,0,0,0.18)",borderRadius:9,padding:"4px 10px",fontSize:12,fontWeight:900,flexShrink:0 }}>
                  {inc>0?`+${fmt(inc)}`:"Non défini"}
                </div>
              </button>
            </div>
          );
        })}
      </div>


      <div className="content-grid">
        <div style={{ display:"flex",flexDirection:"column",gap:16 }}>

          {/* BALANCE CARD */}
          <div className="card" style={{ position:"relative",overflow:"hidden",borderColor:isPos?"rgba(74,222,128,0.2)":"rgba(248,113,113,0.2)" }}>
            <div style={{ position:"absolute",inset:0,background:isPos?"radial-gradient(ellipse 80% 60% at 50% -20%,rgba(74,222,128,0.07),transparent)":"radial-gradient(ellipse 80% 60% at 50% -20%,rgba(248,113,113,0.07),transparent)",pointerEvents:"none" }}/>
            <div style={{ display:"flex",gap:3,marginBottom:18,background:"rgba(255,255,255,0.04)",borderRadius:10,padding:3 }}>
              {[{ id:"global",label:"🌐 Global",color:null },...data.profiles.map(p=>({ id:p.id,label:`${p.avatar} ${p.name}`,color:p.color }))].map(v => (
                <button key={v.id} onClick={() => setBalanceView(v.id)} style={{ flex:1,padding:"7px 4px",borderRadius:8,border:balanceView===v.id?`1px solid ${v.color?v.color+"45":"rgba(255,255,255,0.15)"}`:"1px solid transparent",cursor:"pointer",background:balanceView===v.id?(v.color?`${v.color}18`:"rgba(255,255,255,0.1)"):"transparent",color:balanceView===v.id?(v.color||"var(--text)"):"var(--text3)",fontFamily:"'Outfit',sans-serif",fontWeight:700,fontSize:11,transition:"all .2s",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis" }}>
                  {v.label}
                </button>
              ))}
            </div>
            <div style={{ fontSize:11,color:"var(--text3)",textTransform:"uppercase",letterSpacing:1.5,textAlign:"center",marginBottom:10 }}>Reste à vivre · {viewData.label}</div>
            <div className="stat-num" style={{ fontSize:58,textAlign:"center",color:isPos?"var(--green)":"var(--red)",textShadow:`0 0 40px ${isPos?"rgba(74,222,128,0.25)":"rgba(248,113,113,0.25)"}`,marginBottom:20,lineHeight:1 }}>{fmt(balance)}</div>
            <div style={{ display:"flex",justifyContent:"center",gap:28,marginBottom:16 }}>
              <div style={{ textAlign:"center" }}>
                <div style={{ fontSize:10,color:"var(--text3)",marginBottom:4,textTransform:"uppercase",letterSpacing:.5 }}>💵 Revenus</div>
                <div style={{ fontSize:18,fontWeight:800,color:"var(--green)" }}>+{fmt(viewData.inc)}</div>
              </div>
              <div style={{ width:1,background:"var(--border)" }}/>
              <div style={{ textAlign:"center" }}>
                <div style={{ fontSize:10,color:"var(--text3)",marginBottom:4,textTransform:"uppercase",letterSpacing:.5 }}>💸 Dépenses</div>
                <div style={{ fontSize:18,fontWeight:800,color:"var(--red)" }}>-{fmt(viewData.exp)}</div>
              </div>
            </div>
            {viewData.inc>0 && (
              <>
                <div style={{ display:"flex",justifyContent:"space-between",fontSize:12,color:"var(--text3)",marginBottom:7 }}>
                  <span>Budget utilisé</span>
                  <span style={{ fontWeight:800,color:pct>80?"var(--red)":pct>60?"var(--orange)":"var(--green)" }}>{Math.round(pct)}%</span>
                </div>
                <div className="progress-track" style={{ height:8 }}>
                  <div className="progress-fill" style={{ width:`${pct}%`,background:pct>80?"var(--grad-red)":pct>60?"linear-gradient(90deg,var(--yellow),var(--orange))":"var(--grad-green)" }}/>
                </div>
              </>
            )}
            {isCurMonth && totalIncome > 0 && (
              <div style={{ marginTop:14,borderRadius:16,border:"1px solid rgba(167,139,250,0.2)",overflow:"hidden",background:"rgba(167,139,250,0.03)" }}>
                <div style={{ padding:"11px 16px",background:"rgba(167,139,250,0.07)",borderBottom:"1px solid rgba(167,139,250,0.12)",display:"flex",alignItems:"center",justifyContent:"space-between" }}>
                  <div style={{ display:"flex",alignItems:"center",gap:8 }}>
                    <span style={{ fontSize:16 }}>📋</span>
                    <div>
                      <div style={{ fontSize:12,fontWeight:800,color:"var(--purple)" }}>Bilan fin de mois</div>
                      <div style={{ fontSize:10,color:"var(--text3)",marginTop:1 }}>Dépenses réelles + factures à régler</div>
                    </div>
                  </div>
                  <div style={{ background:"rgba(167,139,250,0.12)",border:"1px solid rgba(167,139,250,0.22)",borderRadius:20,padding:"3px 10px",fontSize:10,color:"var(--purple)",fontWeight:700,flexShrink:0 }}>
                    {daysInMonth - dayOfMonth} j restants
                  </div>
                </div>
                <div style={{ padding:"12px 16px 14px" }}>
                  {(() => {
                    const unpaidTotal = data.bills.filter(b => !b.paid?.[selMonth] && b.amount>0).reduce((s,b)=>s+b.amount,0);
                    const projTotal   = totalExp + unpaidTotal;
                    const projBalance = totalIncome - projTotal;
                    const isOver      = projTotal > totalIncome;
                    return (<>
                      <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:10 }}>
                        {[
                          { icon:"💸",label:"Dépensé",        val:`-${fmt(totalExp)}`,           color:"var(--red)",   bg:"rgba(248,113,113,0.06)",  bd:"rgba(248,113,113,0.14)" },
                          { icon:"📋",label:"Factures restantes", val:unpaidTotal>0?`-${fmt(unpaidTotal)}`:"Tout réglé ✓", color:unpaidTotal>0?"var(--orange)":"var(--green)", bg:unpaidTotal>0?"rgba(251,146,60,0.06)":"rgba(74,222,128,0.06)", bd:unpaidTotal>0?"rgba(251,146,60,0.15)":"rgba(74,222,128,0.15)" },
                          { icon:"⚖️",label:"Solde estimé",   val:fmt(projBalance),              color:projBalance>=0?"var(--green)":"var(--red)", bg:projBalance>=0?"rgba(74,222,128,0.06)":"rgba(248,113,113,0.06)", bd:projBalance>=0?"rgba(74,222,128,0.14)":"rgba(248,113,113,0.14)" },
                        ].map(s=>(
                          <div key={s.label} style={{ textAlign:"center",padding:"11px 6px",background:s.bg,borderRadius:12,border:`1px solid ${s.bd}` }}>
                            <div style={{ fontSize:18,marginBottom:4 }}>{s.icon}</div>
                            <div style={{ fontSize:9,color:"var(--text3)",textTransform:"uppercase",letterSpacing:.6,fontWeight:800,marginBottom:5 }}>{s.label}</div>
                            <div style={{ fontFamily:"'Fraunces',serif",fontSize:15,fontWeight:900,color:s.color }}>{s.val}</div>
                          </div>
                        ))}
                      </div>
                      <div style={{ padding:"7px 12px",borderRadius:10,fontSize:11,fontWeight:700,background:isOver?"rgba(248,113,113,0.08)":"rgba(74,222,128,0.06)",border:`1px solid ${isOver?"rgba(248,113,113,0.2)":"rgba(74,222,128,0.18)"}`,color:isOver?"var(--red)":"var(--green)" }}>
                        {isOver ? `⚠️ Budget dépassé de ${fmt(projTotal-totalIncome)} si toutes les factures sont réglées.` : `✅ Il vous restera ${fmt(projBalance)} après paiement de toutes les factures.`}
                      </div>
                    </>);
                  })()}
                </div>
              </div>
            )}
          </div>

          {/* CATEGORY BREAKDOWN */}
          <div className="card">
            <div style={{ fontWeight:800,fontSize:14,marginBottom:16,display:"flex",alignItems:"center",gap:9 }}>
              <div style={{ width:32,height:32,borderRadius:10,background:"rgba(251,146,60,0.1)",border:"1px solid rgba(251,146,60,0.2)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16 }}>📊</div>
              Répartition des dépenses
            </div>
            {topCats.length===0 ? <div className="empty-state"><div className="empty-icon">📊</div>Aucune dépense ce mois</div> : (
              <div style={{ display:"flex",flexDirection:"column",gap:11 }}>
                {topCats.map(([cid,amt]) => {
                  const cat = catMap[cid]||{ icon:"❓",name:cid,color:"#888" };
                  const p   = totalExp>0 ? (amt/totalExp)*100 : 0;
                  return (
                    <div key={cid}>
                      <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:5 }}>
                        <div style={{ display:"flex",alignItems:"center",gap:7 }}>
                          <div style={{ width:26,height:26,borderRadius:8,background:`${cat.color}15`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14 }}>{cat.icon}</div>
                          <span style={{ fontSize:13,fontWeight:600 }}>{cat.name}</span>
                          <span style={{ fontSize:10,color:"var(--text3)",background:"rgba(255,255,255,0.05)",borderRadius:20,padding:"1px 7px" }}>{Math.round(p)}%</span>
                        </div>
                        <span style={{ fontWeight:800,fontSize:13 }}>{fmt(amt)}</span>
                      </div>
                      <div className="progress-track" style={{ height:5 }}><div className="progress-fill" style={{ width:`${p}%`,background:cat.color }}/></div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* RECENT TX */}
          <div className="card"><DashboardRecentTx transactions={transactions} catMap={catMap} profMap={profMap}/></div>
        </div>

        {/* ── RIGHT COLUMN ── */}
        <div style={{ display:"flex",flexDirection:"column",gap:14 }}>
          {pieData.length>0 && (
            <div className="card">
              <div style={{ fontWeight:800,fontSize:14,marginBottom:12,display:"flex",alignItems:"center",gap:9 }}>
                <div style={{ width:32,height:32,borderRadius:10,background:"rgba(251,146,60,0.1)",border:"1px solid rgba(251,146,60,0.2)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16 }}>🥧</div>
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
              <div style={{ display:"flex",flexWrap:"wrap",gap:6,marginTop:4 }}>
                {pieData.slice(0,6).map((d,i) => <div key={i} style={{ display:"flex",alignItems:"center",gap:5,fontSize:11 }}><div style={{ width:8,height:8,borderRadius:2,background:d.color,flexShrink:0 }}/><span style={{ color:"var(--text3)" }}>{d.name}</span></div>)}
              </div>
            </div>
          )}

          {/* BILLS WIDGET — avec HOVER GLOW sur chaque item */}
          <div className="card">
            <div style={{ fontWeight:800,fontSize:14,marginBottom:14,display:"flex",alignItems:"center",justifyContent:"space-between" }}>
              <div style={{ display:"flex",alignItems:"center",gap:9 }}>
                <div style={{ width:32,height:32,borderRadius:10,background:"rgba(167,139,250,0.1)",border:"1px solid rgba(167,139,250,0.2)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16 }}>📋</div>
                Factures
              </div>
              <span style={{ fontSize:11,color:"var(--text3)",fontWeight:600 }}>{monthLabel(selMonth)}</span>
            </div>
            {data.bills.length===0 ? (
              <div className="empty-state" style={{ padding:"18px 0" }}><div className="empty-icon">📋</div>Aucune facture</div>
            ) : (
              <>
                <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:7,marginBottom:12 }}>
                  {[
                    { v:paid.length,l:"Payées",c:"var(--green)",bg:"rgba(74,222,128,0.08)",bd:"rgba(74,222,128,0.18)" },
                    { v:unpaid.length,l:"En attente",c:"var(--yellow)",bg:"rgba(251,191,36,0.08)",bd:"rgba(251,191,36,0.18)" },
                    { v:overdue.length,l:"En retard",c:"var(--red)",bg:"rgba(248,113,113,0.08)",bd:"rgba(248,113,113,0.22)" },
                  ].map(s => (
                    <div key={s.l} style={{ textAlign:"center",background:s.bg,border:`1px solid ${s.bd}`,borderRadius:11,padding:"9px 4px" }}>
                      <div className="stat-num" style={{ fontSize:22,color:s.c }}>{s.v}</div>
                      <div style={{ fontSize:10,color:"var(--text3)",fontWeight:600 }}>{s.l}</div>
                    </div>
                  ))}
                </div>
                <div className="progress-track" style={{ height:5,marginBottom:13 }}>
                  <div className="progress-fill" style={{ width:`${data.bills.length?(paid.length/data.bills.length)*100:0}%`,background:"var(--grad-green)" }}/>
                </div>
                <div style={{ display:"flex",flexDirection:"column",gap:7 }}>
                  {unpaid.slice(0,4).map(b => {
                    const due = fmtDue(b.dueDate);
                    const isOvr = b.dueDate&&new Date(b.dueDate)<new Date();
                    return (
                      <div key={b.id}
                        className={`dash-bill-item tip ${isOvr?"overdue":""}`}
                        data-tip={`${b.name} · ${fmt(b.amount)} · ${isOvr?"⚠️ En retard !":`Échéance: ${b.dueDate?new Date(b.dueDate).toLocaleDateString("fr-FR"):"—"}`}`}
                        style={{
                          display:"flex",alignItems:"center",gap:10,padding:"12px 14px",
                          background:isOvr?"rgba(248,113,113,0.06)":"rgba(255,255,255,0.03)",
                          border:`1px solid ${isOvr?"rgba(248,113,113,0.22)":"rgba(255,255,255,0.07)"}`,
                          borderRadius:13,
                        }}>
                        <span style={{ fontSize:22,flexShrink:0 }}>{b.icon||"📋"}</span>
                        <div style={{ flex:1,minWidth:0 }}>
                          <div style={{ fontWeight:700,fontSize:13,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{b.name}</div>
                          {due && <div style={{ display:"flex",alignItems:"center",gap:4,marginTop:3 }}>
                            <span style={{ fontSize:11,color:due.color,fontWeight:700 }}>📅 {due.text}</span>
                          </div>}
                        </div>
                        <div style={{ fontWeight:800,fontSize:14,color:isOvr?"var(--red)":"var(--orange)",flexShrink:0 }}>-{fmt(b.amount)}</div>
                      </div>
                    );
                  })}
                  {unpaid.length>4 && <div style={{ textAlign:"center",fontSize:11,color:"var(--text3)",padding:"5px 0" }}>+{unpaid.length-4} autre{unpaid.length-4>1?"s":""}</div>}
                  {unpaid.length===0 && <div style={{ textAlign:"center",fontSize:13,color:"var(--green)",fontWeight:700,padding:"10px 0" }}>🎉 Toutes les factures sont payées !</div>}
                </div>
              </>
            )}
          </div>

          {/* QUICK STATS */}
          <div className="card">
            <div style={{ fontWeight:800,fontSize:14,marginBottom:13,display:"flex",alignItems:"center",gap:9 }}>
              <div style={{ width:32,height:32,borderRadius:10,background:"rgba(251,191,36,0.1)",border:"1px solid rgba(251,191,36,0.2)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16 }}>⚡</div>
              Stats rapides
            </div>
            <div style={{ display:"flex",flexDirection:"column",gap:7 }}>
              {[
                { label:"Tx. moy./jour",    val:fmt(dayOfMonth>0?totalExp/dayOfMonth:0),  icon:"📅",color:"var(--blue)",  tip:"Dépense moyenne par jour ce mois" },
                { label:"Plus grosse dép.", val:transactions.length?fmt(Math.max(...transactions.map(t=>t.amount))):"—",icon:"🔺",color:"var(--orange)",tip:"Transaction la plus élevée" },
                { label:"Nb. transactions", val:transactions.length,icon:"🧾",color:"var(--purple)",tip:"Nombre d'opérations enregistrées" },
                { label:"Taux d'épargne",   val:totalIncome>0?`${Math.round(((totalIncome-totalExp)/totalIncome)*100)}%`:"—",icon:"💹",color:"var(--green)",tip:"Pourcentage du revenu non dépensé" },
              ].map(s => (
                <div key={s.label} className="tip" data-tip={s.tip}
                  style={{ display:"flex",alignItems:"center",gap:10,padding:"10px 12px",background:"rgba(255,255,255,0.025)",borderRadius:11,border:"1px solid rgba(255,255,255,0.05)",transition:"all .2s",cursor:"default" }}
                  onMouseEnter={e=>{e.currentTarget.style.background="rgba(255,255,255,0.05)";e.currentTarget.style.borderColor="rgba(255,255,255,0.1)";}}
                  onMouseLeave={e=>{e.currentTarget.style.background="rgba(255,255,255,0.025)";e.currentTarget.style.borderColor="rgba(255,255,255,0.05)";}}>
                  <span style={{ fontSize:17 }}>{s.icon}</span>
                  <span style={{ flex:1,fontSize:12.5,color:"var(--text2)",fontWeight:600 }}>{s.label}</span>
                  <span style={{ fontWeight:800,fontSize:14,color:s.color }}>{s.val}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}


function LiveClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  const weekday = now.toLocaleDateString("fr-FR", { weekday:"long" });
  const day     = now.toLocaleDateString("fr-FR", { day:"numeric" });
  const month   = now.toLocaleDateString("fr-FR", { month:"long" });
  const year    = now.getFullYear();
  const hh = pad(now.getHours()), mm = pad(now.getMinutes()), ss = pad(now.getSeconds());
  return (
    <div className="topbar-clock">
      <div className="topbar-clock-date">
        <div style={{ fontSize:10,color:"rgba(237,233,248,0.42)",textTransform:"uppercase",letterSpacing:2,fontWeight:900,marginBottom:3 }}>
          {weekday}
        </div>
        <div style={{ fontSize:14,color:"rgba(237,233,248,0.88)",fontWeight:800,lineHeight:1,letterSpacing:-.2 }}>
          {day} {month} <span style={{ color:"rgba(237,233,248,0.38)",fontWeight:600,fontSize:12 }}>{year}</span>
        </div>
      </div>
      <div className="topbar-clock-time">
        <span style={{ fontSize:28,fontWeight:900,color:"var(--text)",letterSpacing:-2,lineHeight:1 }}>{hh}:{mm}</span>
        <span style={{ fontSize:15,fontWeight:800,color:"var(--purple)",minWidth:26,lineHeight:1,animation:"pulse 1s steps(1) infinite",alignSelf:"flex-end",paddingBottom:1 }}>:{ss}</span>
      </div>
    </div>
  );
}

function Incomes({ data, update, selMonth, mdata, setModal }) {
  const md = mdata(selMonth);
  const { incomes } = md;
  const totalInc = (incomes.p1||0)+(incomes.p2||0)+(incomes.common||0);
  const totalExp = md.transactions.reduce((s,t) => s+t.amount, 0);

  return (
    <div className="fade-up content-grid">
      <div style={{ display:"flex",flexDirection:"column",gap:16 }}>
        <div style={{ fontWeight:700,fontSize:12,color:"var(--text3)",textTransform:"uppercase",letterSpacing:1.5 }}>Revenus — {monthLabel(selMonth)}</div>

        {data.profiles.map((p,i) => {
          const inc = incomes[p.id]||0;
          const pctOfTotal = totalInc>0 ? (inc/totalInc)*100 : 0;
          const profileTx = md.transactions.filter(t=>t.profileId===p.id);
          const profileSpent = profileTx.reduce((s,t)=>s+t.amount,0);
          const savingsRate = inc>0 ? Math.round(((inc-profileSpent)/inc)*100) : null;
          const remaining = inc - profileSpent;
          const isCommon = p.id==="common";
          const typeLabel = isCommon ? "🏦 Compte commun" : "💼 Compte personnel";
          const typeDesc  = isCommon ? "Fonds partagés du couple" : "Revenu individuel mensuel";
          return (
            <div key={p.id} className={`income-card fade-up stagger-${i+1}`}
              style={{ padding:0,background:"var(--glass)",border:`1px solid var(--border)`,boxShadow:"var(--shadow-card)" }}>

              {/* BANDE COULEUR TOP */}
              <div style={{ height:4,background:`linear-gradient(90deg,${p.color},${p.color}44)`,borderRadius:"var(--r) var(--r) 0 0" }}/>

              <div style={{ padding:"22px 24px" }}>
                {/* ── HEADER ── */}
                <div style={{ display:"flex",alignItems:"flex-start",gap:16,marginBottom:20 }}>
                  <div className="tip" data-tip={`${p.name} · ${typeDesc}`} style={{ position:"relative",flexShrink:0 }}>
                    <div style={{ width:64,height:64,borderRadius:18,background:`${p.color}18`,border:`2px solid ${p.color}40`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:32,boxShadow:`0 8px 24px ${p.color}25` }}>
                      {p.avatar}
                    </div>
                    <div style={{ position:"absolute",bottom:-5,right:-5,width:22,height:22,borderRadius:"50%",background:"var(--grad-main)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,border:"2.5px solid var(--bg2)",fontWeight:900,color:"#fff" }}>
                      {isCommon?"🏦":p.id==="p1"?"1":"2"}
                    </div>
                  </div>
                  <div style={{ flex:1,minWidth:0 }}>
                    <div style={{ fontWeight:900,fontSize:20,color:p.color,marginBottom:4,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{p.name}</div>
                    <span className="tip" data-tip={typeDesc}
                      style={{ display:"inline-flex",alignItems:"center",gap:5,fontSize:11,fontWeight:700,padding:"3px 11px",borderRadius:20,background:`${p.color}15`,border:`1px solid ${p.color}30`,color:p.color,textTransform:"uppercase",letterSpacing:.5 }}>
                      {typeLabel}
                    </span>
                    <div style={{ fontSize:12,color:"var(--text3)",marginTop:6 }}>
                      {isCommon ? "Revenus partagés du couple" : `${profileTx.length} transaction${profileTx.length>1?"s":""} ce mois`}
                    </div>
                  </div>
                  <div style={{ textAlign:"right",flexShrink:0 }}>
                    <div style={{ fontSize:9,color:"var(--text3)",textTransform:"uppercase",letterSpacing:1,fontWeight:700,marginBottom:4 }}>Revenu mensuel</div>
                    <div className="stat-num" style={{ fontSize:30,color:inc>0?"var(--green)":"var(--text3)",lineHeight:1,textShadow:inc>0?"0 0 30px rgba(74,222,128,0.25)":"none" }}>
                      {inc>0?`+${fmt(inc)}`:"—"}
                    </div>
                    {totalInc>0&&inc>0&&<div style={{ fontSize:11,color:"var(--text3)",marginTop:3,fontWeight:600 }}>{Math.round(pctOfTotal)}% du total</div>}
                  </div>
                </div>

                {/* ── STATS GRID 3 colonnes ── */}
                <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:16 }}>
                  {[
                    { icon:"💵",label:"Revenu",fullLabel:"Revenu mensuel",val:inc>0?`+${fmt(inc)}`:"Non défini",color:"var(--green)",tip:"Revenu mensuel de ce profil",bg:"rgba(74,222,128,0.06)",bd:"rgba(74,222,128,0.15)" },
                    { icon:"💸",label:"Dépensé",fullLabel:"Total dépensé",val:profileSpent>0?`-${fmt(profileSpent)}`:"0 €",color:"var(--red)",tip:`Somme des ${profileTx.length} transactions de ce profil`,bg:"rgba(248,113,113,0.06)",bd:"rgba(248,113,113,0.14)" },
                    { icon:"💹",label:"Épargne",fullLabel:"Taux d'épargne",val:savingsRate!==null?`${savingsRate}%`:"—",color:savingsRate!==null&&savingsRate<0?"var(--red)":"var(--teal)",tip:"Taux d'épargne = (Revenu - Dépenses) / Revenu",bg:"rgba(45,212,191,0.06)",bd:"rgba(45,212,191,0.15)" },
                  ].map(s => (
                    <div key={s.label} className="tip" data-tip={s.tip}
                      style={{ textAlign:"center",padding:"12px 8px",background:s.bg,borderRadius:13,border:`1px solid ${s.bd}`,transition:"all .2s",cursor:"default" }}
                      onMouseEnter={e=>{e.currentTarget.style.transform="translateY(-2px)";e.currentTarget.style.boxShadow="0 6px 20px rgba(0,0,0,0.2)";}}
                      onMouseLeave={e=>{e.currentTarget.style.transform="";e.currentTarget.style.boxShadow="";}}>
                      <div style={{ fontSize:20,marginBottom:5 }}>{s.icon}</div>
                      <div style={{ fontSize:9,color:"var(--text3)",textTransform:"uppercase",letterSpacing:.5,fontWeight:800,marginBottom:4 }}>{s.fullLabel}</div>
                      <div className="stat-num" style={{ fontSize:14,fontWeight:900,color:s.color }}>{s.val}</div>
                    </div>
                  ))}
                </div>

                {/* ── BARRE DE PROGRESSION ── */}
                {inc>0 && (
                  <div style={{ marginBottom:16 }}>
                    <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",fontSize:11,color:"var(--text3)",marginBottom:7 }}>
                      <span style={{ fontWeight:600 }}>Part du revenu total utilisée</span>
                      <span style={{ fontWeight:800,color:profileSpent/inc>0.8?"var(--red)":profileSpent/inc>0.6?"var(--orange)":p.color }}>
                        {Math.round(profileSpent/inc*100)}%
                      </span>
                    </div>
                    <div className="progress-track" style={{ height:7 }}>
                      <div className="progress-fill" style={{ width:`${Math.min(100,(profileSpent/inc)*100)}%`,background:profileSpent/inc>0.8?"var(--grad-red)":p.color,boxShadow:`0 0 12px ${p.color}40` }}/>
                    </div>
                    <div style={{ display:"flex",justifyContent:"space-between",fontSize:10,color:"var(--text3)",marginTop:5 }}>
                      <span>💸 Dépensé : {fmt(profileSpent)}</span>
                      <span style={{ color:remaining>=0?"var(--green)":"var(--red)",fontWeight:700 }}>
                        {remaining>=0?"💰":"⚠️"} Reste : {fmt(Math.abs(remaining))}
                      </span>
                    </div>
                  </div>
                )}

                {/* ── PART DU TOTAL ── */}
                {totalInc>0&&inc>0&&(
                  <div style={{ marginBottom:16 }}>
                    <div style={{ display:"flex",justifyContent:"space-between",fontSize:11,color:"var(--text3)",marginBottom:7 }}>
                      <span style={{ fontWeight:600 }}>Part du revenu total du foyer</span>
                      <span style={{ fontWeight:800,color:p.color }}>{Math.round(pctOfTotal)}%</span>
                    </div>
                    <div className="progress-track" style={{ height:5 }}>
                      <div className="progress-fill" style={{ width:`${pctOfTotal}%`,background:p.color,boxShadow:`0 0 10px ${p.color}50` }}/>
                    </div>
                  </div>
                )}

                {/* ── BOUTON MODIFIER PLEINE LARGEUR — couleur du profil ── */}
                <button className="tip"
                  data-tip={`Modifier le revenu de ${p.name} pour ${monthLabel(selMonth)}`}
                  style={{
                    width:"100%",justifyContent:"center",padding:"14px",fontSize:14,
                    letterSpacing:.3,borderRadius:14,cursor:"pointer",
                    fontFamily:"'Outfit',sans-serif",fontWeight:800,
                    border:"none",transition:"all .25s cubic-bezier(.4,0,.2,1)",
                    display:"flex",alignItems:"center",gap:8,
                    background: p.id==="common"
                      ? `linear-gradient(135deg,#60a5fa,#a78bfa)`
                      : i===0
                        ? `linear-gradient(135deg,${p.color},${p.color}bb)`
                        : `linear-gradient(135deg,${p.color}bb,${p.color})`,
                    color:"white",
                    boxShadow:`0 4px 18px ${p.color}45`,
                  }}
                  onMouseEnter={e=>{e.currentTarget.style.transform="translateY(-2px)";e.currentTarget.style.boxShadow=`0 8px 28px ${p.color}60`;}}
                  onMouseLeave={e=>{e.currentTarget.style.transform="";e.currentTarget.style.boxShadow=`0 4px 18px ${p.color}45`;}}
                  onClick={() => setModal({ type:"editIncome",profileId:p.id,selMonth })}>
                  <div style={{ width:26,height:26,borderRadius:8,background:"rgba(255,255,255,0.2)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14 }}>✏️</div>
                  Modifier le revenu de <strong>{p.name}</strong>
                </button>
              </div>
            </div>
          );
        })}

        {data.recurringIncomes?.length>0 && (
          <div className="card">
            <div style={{ fontWeight:700,fontSize:13,marginBottom:14,display:"flex",alignItems:"center",gap:6 }}>
              🔄 Revenus récurrents
              <span style={{ marginLeft:"auto",background:"rgba(74,222,128,0.12)",color:"var(--green)",borderRadius:20,padding:"2px 8px",fontSize:11 }}>{data.recurringIncomes.length} actif{data.recurringIncomes.length>1?"s":""}</span>
            </div>
            {data.recurringIncomes.map(ri => {
              const prof = data.profiles.find(p => p.id===ri.profileId);
              return (
                <div key={ri.id} style={{ display:"flex",alignItems:"center",gap:12,padding:"11px 0",borderBottom:"1px solid var(--border)" }}>
                  <div style={{ width:38,height:38,borderRadius:10,background:`${prof?.color||"#888"}18`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:22 }}>{prof?.avatar||"❓"}</div>
                  <div style={{ flex:1 }}>
                    <div style={{ fontWeight:600,fontSize:13 }}>{prof?.name}</div>
                    <div style={{ fontSize:11,color:"var(--text3)" }}>Depuis {fmtDate(ri.startDate)} · Mensuel</div>
                  </div>
                  <div style={{ fontWeight:800,color:"var(--green)",fontSize:15 }}>+{fmt(ri.amount)}</div>
                  <button className="btn-icon tip" data-tip="Supprimer ce revenu récurrent" style={{ color:"var(--red)",background:"rgba(248,113,113,0.08)" }}
                    onClick={() => update(d => { d.recurringIncomes = d.recurringIncomes.filter(r => r.id!==ri.id); })}>🗑</button>
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
            { label:"Total revenus",  val:`+${fmt(totalInc)}`,                  color:"var(--green)",  icon:"💵",tip:"Somme de tous les revenus du mois" },
            { label:"Total dépenses", val:`-${fmt(totalExp)}`,                  color:"var(--red)",    icon:"💸",tip:"Somme de toutes les dépenses" },
            { label:"Reste à vivre",  val:fmt(totalInc-totalExp),               color:totalInc>=totalExp?"var(--green)":"var(--red)",icon:"⚖️",tip:"Revenu - Dépenses = budget disponible" },
            { label:"Taux d'épargne", val:totalInc>0?`${Math.round(((totalInc-totalExp)/totalInc)*100)}%`:"—",color:"var(--purple)",icon:"💹",tip:"Pourcentage du revenu non dépensé" },
          ].map(s => (
            <div key={s.label} className="tip" data-tip={s.tip} style={{ display:"flex",alignItems:"center",gap:12,padding:"11px 0",borderBottom:"1px solid var(--border)" }}>
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
          <button className="btn btn-primary" style={{ width:"100%" }} onClick={() => setModal({ type:"addRecurringIncome" })}>+ Ajouter un revenu récurrent</button>
        </div>
      </div>
    </div>
  );
}


function Expenses({ data, update, selMonth, mdata, setModal }) {
  const md = mdata(selMonth);
  const { transactions } = md;
  const [filter, setFilter]   = useState("all");
  const [search, setSearch]   = useState("");
  const [sort, setSort]       = useState("date_desc");
  const [groupBy, setGroupBy] = useState("none");
  const [confirmClear, setConfirmClear] = useState(false);

  const catMap  = useMemo(() => Object.fromEntries(data.categories.map(c=>[c.id,c])), [data.categories]);
  const profMap = useMemo(() => Object.fromEntries(data.profiles.map(p=>[p.id,p])), [data.profiles]);

  const filtered = useMemo(() => {
    let txs = filter==="all" ? transactions : transactions.filter(t => t.profileId===filter||t.categoryId===filter);
    if (search.trim()) { const q=search.toLowerCase(); txs = txs.filter(t => t.label.toLowerCase().includes(q)||(catMap[t.categoryId]?.name||"").toLowerCase().includes(q)); }
    return txs;
  }, [transactions,filter,search,catMap]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    switch(sort) {
      case "date_asc":    return arr.sort((a,b) => new Date(a.timestamp)-new Date(b.timestamp));
      case "amount_desc": return arr.sort((a,b) => b.amount-a.amount);
      case "amount_asc":  return arr.sort((a,b) => a.amount-b.amount);
      default:            return arr.sort((a,b) => new Date(b.timestamp)-new Date(a.timestamp));
    }
  }, [filtered,sort]);

  const total    = useMemo(() => sorted.reduce((s,t)=>s+t.amount,0), [sorted]);
  const totalAll = useMemo(() => transactions.reduce((s,t)=>s+t.amount,0), [transactions]);

  const del = id => update(d => { ensureMonth(d,selMonth); d.monthsData[selMonth].transactions = d.monthsData[selMonth].transactions.filter(t=>t.id!==id); });
  const duplicate = tx => update(d => { ensureMonth(d,selMonth); d.monthsData[selMonth].transactions.push({ ...tx,id:mkid(),timestamp:nowISO(),auto:false }); });
  const clearAll = () => { update(d => { ensureMonth(d,selMonth); d.monthsData[selMonth].transactions = []; }); setConfirmClear(false); };

  const grouped = useMemo(() => {
    if (groupBy==="none") return [{ key:"all",label:null,items:sorted }];
    if (groupBy==="day") {
      const map = new Map();
      sorted.forEach(tx => {
        const d = new Date(tx.timestamp);
        const key = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
        const label = d.toLocaleDateString("fr-FR",{ weekday:"long",day:"numeric",month:"long" });
        if (!map.has(key)) map.set(key,{ key,label,items:[] });
        map.get(key).items.push(tx);
      });
      return Array.from(map.values());
    }
    if (groupBy==="category") {
      const map = new Map();
      sorted.forEach(tx => {
        const cat = catMap[tx.categoryId]||{ id:"?",name:"Autre",icon:"❓",color:"#888" };
        if (!map.has(cat.id)) map.set(cat.id,{ key:cat.id,label:cat.name,icon:cat.icon,color:cat.color,items:[] });
        map.get(cat.id).items.push(tx);
      });
      return Array.from(map.values()).sort((a,b) => b.items.reduce((s,t)=>s+t.amount,0)-a.items.reduce((s,t)=>s+t.amount,0));
    }
    return [{ key:"all",label:null,items:sorted }];
  }, [sorted,groupBy,catMap]);

  return (
    <div className="fade-up">
      {/* KPI BAR */}
      <div style={{ display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:18 }}>
        {[
          { label:"Total dépensé",    val:`-${fmt(totalAll)}`,  color:"var(--red)",    icon:"💸",bg:"rgba(248,113,113,0.08)",border:"rgba(248,113,113,0.18)",tip:"Somme totale des dépenses" },
          { label:"Transactions",     val:transactions.length,  color:"var(--text)",   icon:"🧾",bg:"rgba(255,255,255,0.03)",border:"var(--border)",tip:"Nombre d'opérations enregistrées" },
          { label:"Dépense moyenne",  val:fmt(transactions.length?totalAll/transactions.length:0),color:"var(--orange)",icon:"📊",bg:"rgba(251,146,60,0.08)",border:"rgba(251,146,60,0.18)",tip:"Montant moyen par transaction" },
          { label:"Plus grosse dép.", val:transactions.length?fmt(Math.max(...transactions.map(t=>t.amount))):"—",color:"var(--purple)",icon:"🔺",bg:"rgba(167,139,250,0.08)",border:"rgba(167,139,250,0.2)",tip:"Transaction la plus élevée du mois" },
        ].map(s => (
          <div key={s.label} className="tip" data-tip={s.tip}
            style={{ background:s.bg,border:`1px solid ${s.border}`,borderRadius:14,padding:"16px 18px",display:"flex",alignItems:"center",gap:13,cursor:"default",transition:"all .2s" }}
            onMouseEnter={e=>{e.currentTarget.style.transform="translateY(-2px)";e.currentTarget.style.boxShadow="0 8px 28px rgba(0,0,0,0.3)";}}
            onMouseLeave={e=>{e.currentTarget.style.transform="";e.currentTarget.style.boxShadow="";}}>
            <div style={{ width:42,height:42,borderRadius:12,background:"rgba(255,255,255,0.06)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,flexShrink:0 }}>{s.icon}</div>
            <div style={{ minWidth:0 }}>
              <div style={{ fontSize:10.5,color:"var(--text3)",textTransform:"uppercase",letterSpacing:.9,fontWeight:800,marginBottom:4 }}>{s.label}</div>
              <div className="stat-num" style={{ fontSize:17,fontWeight:900,color:s.color }}>{s.val}</div>
            </div>
          </div>
        ))}
      </div>

      {/* TOOLBAR */}
      <div style={{ display:"flex",gap:8,marginBottom:14,alignItems:"center",background:"var(--glass)",border:"1px solid var(--border)",borderRadius:15,padding:"10px 14px",flexWrap:"wrap" }}>
        <div style={{ position:"relative",flex:1,minWidth:180 }}>
          <span style={{ position:"absolute",left:12,top:"50%",transform:"translateY(-50%)",fontSize:13,pointerEvents:"none",opacity:.4 }}>🔍</span>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher une dépense…" style={{ paddingLeft:34,background:"rgba(255,255,255,0.05)",border:"1px solid var(--border)",borderRadius:10,fontSize:13 }}/>
          {search && <button onClick={() => setSearch("")} style={{ position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",color:"var(--text3)",fontSize:18,lineHeight:1 }}>×</button>}
        </div>
        <div className="tip" data-tip="Trier les transactions" style={{ display:"flex",alignItems:"center",gap:6,flexShrink:0 }}>
          <span style={{ fontSize:11,color:"var(--text3)",fontWeight:800,whiteSpace:"nowrap" }}>↕</span>
          <select value={sort} onChange={e => setSort(e.target.value)} style={{ width:"auto",padding:"8px 10px",fontSize:12,background:"rgba(255,255,255,0.06)",border:"1px solid var(--border)",borderRadius:10 }}>
            <option value="date_desc">Date ↓</option><option value="date_asc">Date ↑</option>
            <option value="amount_desc">Montant ↓</option><option value="amount_asc">Montant ↑</option>
          </select>
        </div>
        <div className="tip" data-tip="Grouper les transactions" style={{ display:"flex",alignItems:"center",gap:6,flexShrink:0 }}>
          <span style={{ fontSize:11,color:"var(--text3)",fontWeight:800,whiteSpace:"nowrap" }}>⊞</span>
          <select value={groupBy} onChange={e => setGroupBy(e.target.value)} style={{ width:"auto",padding:"8px 10px",fontSize:12,background:"rgba(255,255,255,0.06)",border:"1px solid var(--border)",borderRadius:10 }}>
            <option value="none">Aucun</option><option value="day">Par jour</option><option value="category">Par catégorie</option>
          </select>
        </div>
        {transactions.length>0 && !confirmClear && (
          <button onClick={() => setConfirmClear(true)} className="tip" data-tip="Supprimer toutes les dépenses du mois"
            style={{ display:"flex",alignItems:"center",gap:6,padding:"8px 14px",borderRadius:10,border:"1px solid rgba(248,113,113,0.22)",background:"rgba(248,113,113,0.07)",color:"var(--red)",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"'Outfit',sans-serif",transition:"all .2s",flexShrink:0 }}
            onMouseEnter={e=>{e.currentTarget.style.background="rgba(248,113,113,0.18)";e.currentTarget.style.borderColor="rgba(248,113,113,0.45)";}}
            onMouseLeave={e=>{e.currentTarget.style.background="rgba(248,113,113,0.07)";e.currentTarget.style.borderColor="rgba(248,113,113,0.22)";}}>
            🗑 Tout effacer
          </button>
        )}
        {confirmClear && (
          <div style={{ display:"flex",alignItems:"center",gap:6,flexShrink:0 }}>
            <span style={{ fontSize:12,color:"var(--red)",fontWeight:700 }}>Confirmer ?</span>
            <button onClick={clearAll} style={{ padding:"7px 12px",borderRadius:9,border:"1px solid rgba(248,113,113,0.5)",background:"rgba(248,113,113,0.2)",color:"var(--red)",cursor:"pointer",fontSize:12,fontWeight:800,fontFamily:"'Outfit',sans-serif" }}>Oui</button>
            <button onClick={() => setConfirmClear(false)} style={{ padding:"7px 12px",borderRadius:9,border:"1px solid var(--border)",background:"var(--glass)",color:"var(--text2)",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"'Outfit',sans-serif" }}>Annuler</button>
          </div>
        )}
      </div>

      {/* FILTER CHIPS */}
      <div style={{ marginBottom:20,paddingTop:8,overflow:"visible" }}>
        <div className="filter-bar" style={{ paddingTop:6,paddingBottom:8,overflow:"visible" }}>
          {[
            { id:"all",label:"Tout",icon:"",tip:"Afficher toutes les dépenses" },
            ...data.profiles.map(p => ({ id:p.id,label:p.name,icon:p.avatar,tip:`Dépenses de ${p.name}`,color:p.color })),
            ...data.categories.map(c => ({ id:c.id,label:c.name,icon:c.icon,tip:`Catégorie : ${c.name}`,color:c.color })),
          ].map(f => (
            <div key={f.id}
              className={`filter-chip tip ${filter===f.id?"active":""}`}
              data-tip={f.tip}
              onClick={() => setFilter(filter===f.id&&f.id!=="all"?"all":f.id)}
              style={filter===f.id&&f.color?{ borderColor:f.color+"66",background:f.color+"18",color:f.color,boxShadow:`0 2px 12px ${f.color}22` }:{}}>
              {f.icon && <span className="chip-emoji">{f.icon}</span>}
              <span>{f.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* RESULTS HEADER */}
      <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14,padding:"0 2px" }}>
        <div style={{ display:"flex",alignItems:"center",gap:9 }}>
          <span style={{ fontSize:13,color:"var(--text2)",fontWeight:700 }}>{sorted.length} transaction{sorted.length!==1?"s":""}</span>
          {search && <span style={{ fontSize:11,background:"rgba(167,139,250,0.12)",border:"1px solid rgba(167,139,250,0.25)",color:"var(--purple)",borderRadius:20,padding:"3px 10px",fontWeight:700 }}>🔍 "{search}"</span>}
          {filter!=="all" && <button onClick={() => setFilter("all")} style={{ fontSize:11,background:"rgba(251,146,60,0.1)",border:"1px solid rgba(251,146,60,0.25)",color:"var(--orange)",borderRadius:20,padding:"3px 10px",fontWeight:700,cursor:"pointer",fontFamily:"'Outfit',sans-serif" }}>✕ Filtre actif</button>}
        </div>
        <div style={{ fontFamily:"'Fraunces',serif",fontSize:22,fontWeight:900,color:"var(--red)",textShadow:"0 0 20px rgba(248,113,113,0.3)" }}>-{fmt(total)}</div>
      </div>

      {/* TRANSACTION LIST */}
      {sorted.length===0 ? (
        <div className="card empty-state">
          <div className="empty-icon">{search?"🔍":"💸"}</div>
          <div style={{ fontSize:16,fontWeight:700,marginBottom:6 }}>{search?"Aucun résultat":"Aucune dépense ce mois"}</div>
          <div style={{ fontSize:13 }}>{search?`Aucune dépense pour "${search}"`:"Ajoutez votre première dépense !"}</div>
        </div>
      ) : (
        <div style={{ display:"flex",flexDirection:"column",gap:groupBy==="none"?0:16 }}>
          {grouped.map((group) => {
            const groupTotal = group.items.reduce((s,t)=>s+t.amount,0);
            return (
              <div key={group.key}>
                {group.label && (
                  <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 6px",marginBottom:8 }}>
                    <div style={{ display:"flex",alignItems:"center",gap:10 }}>
                      {group.icon && <div style={{ width:32,height:32,borderRadius:10,background:`${group.color}18`,border:`1px solid ${group.color}28`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:17 }}>{group.icon}</div>}
                      {!group.icon && <div style={{ width:6,height:24,borderRadius:3,background:"var(--grad-main)" }}/>}
                      <span style={{ fontSize:14,fontWeight:900,color:"var(--text)",textTransform:groupBy==="day"?"capitalize":"none" }}>{group.label}</span>
                      <span style={{ fontSize:11,color:"var(--text3)",background:"rgba(255,255,255,0.06)",borderRadius:20,padding:"2px 9px",fontWeight:700 }}>{group.items.length} tx</span>
                    </div>
                    <span style={{ fontFamily:"'Fraunces',serif",fontWeight:800,fontSize:16,color:"var(--red)" }}>-{fmt(groupTotal)}</span>
                  </div>
                )}

                <div style={{ background:"var(--glass)",border:"1px solid var(--border)",borderRadius:18,overflow:"hidden",boxShadow:"0 2px 20px rgba(0,0,0,0.2)" }}>
                  {group.items.map((tx, idx) => {
                    const cat  = catMap[tx.categoryId]||{ icon:"❓",color:"#888",name:"Autre" };
                    const prof = profMap[tx.profileId]||{ avatar:"❓",name:"?",color:"#888" };
                    const isLast = idx===group.items.length-1;
                    const pct = totalAll>0 ? Math.round((tx.amount/totalAll)*100) : 0;
                    const amountBar = totalAll>0 ? (tx.amount/totalAll)*100 : 0;

                    return (
                      <div key={tx.id} className="expense-row"
                        style={{ display:"flex",alignItems:"center",gap:16,padding:"20px 22px",borderBottom:isLast?"none":"1px solid rgba(255,255,255,0.05)",background:"transparent",borderLeft:"3px solid transparent",transition:"all .22s" }}
                        onMouseEnter={e => { e.currentTarget.style.background=`linear-gradient(135deg,${cat.color}08,rgba(167,139,250,0.05))`; e.currentTarget.style.borderLeftColor=cat.color; e.currentTarget.style.paddingLeft="28px"; }}
                        onMouseLeave={e => { e.currentTarget.style.background="transparent"; e.currentTarget.style.borderLeftColor="transparent"; e.currentTarget.style.paddingLeft="22px"; }}>

                        <div style={{ display:"flex",alignItems:"center",gap:14,flex:1,minWidth:0 }}>
                          <div style={{ position:"relative",flexShrink:0 }}>
                            <div style={{ width:62,height:62,borderRadius:20,background:`linear-gradient(135deg,${cat.color}22,${cat.color}08)`,border:`2px solid ${cat.color}35`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:28,boxShadow:`0 8px 22px ${cat.color}20,inset 0 1px 0 rgba(255,255,255,0.07)` }}>
                              {cat.icon}
                            </div>
                            <div className="tip tip-right" data-tip={`Profil : ${prof.name}`}
                              style={{ position:"absolute",bottom:-6,right:-6,width:24,height:24,borderRadius:"50%",background:prof.color||"var(--bg3)",border:"2.5px solid var(--bg)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,boxShadow:`0 2px 8px rgba(0,0,0,0.5)` }}>
                              {prof.avatar}
                            </div>
                          </div>

                          <div style={{ display:"flex",flexDirection:"column",gap:8,flex:1,minWidth:0 }}>
                            {/* Ligne 1 : titre + badge AUTO */}
                            <div style={{ display:"flex",alignItems:"center",gap:8,flexWrap:"wrap" }}>
                              <span style={{ fontWeight:900,fontSize:16,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:260 }}>{tx.label}</span>
                              {tx.auto && (
                                <span className="tip" data-tip="Transaction automatique depuis une facture récurrente"
                                  style={{ flexShrink:0,fontSize:9.5,background:"rgba(167,139,250,0.15)",border:"1px solid rgba(167,139,250,0.3)",color:"var(--purple)",borderRadius:20,padding:"2px 8px",fontWeight:800,letterSpacing:.3 }}>
                                  🤖 AUTO
                                </span>
                              )}
                            </div>
                            {/* Ligne 2 : badges profil + catégorie + date */}
                            <div style={{ display:"flex",alignItems:"center",gap:6,flexWrap:"wrap" }}>
                              <span className="tip" data-tip={`Profil payeur : ${prof.name}`}
                                style={{ display:"inline-flex",alignItems:"center",gap:5,background:`${prof.color||"#888"}12`,borderRadius:20,padding:"4px 11px",border:`1px solid ${prof.color||"#888"}25`,fontSize:12,fontWeight:700,color:prof.color||"var(--text2)" }}>
                                <span style={{ fontSize:14 }}>{prof.avatar}</span>
                                <span>{prof.name}</span>
                              </span>
                              <span className="tip tip-down" data-tip={`Catégorie : ${cat.name}`}
                                style={{ display:"inline-flex",alignItems:"center",gap:5,background:`${cat.color}12`,borderRadius:20,padding:"4px 11px",border:`1px solid ${cat.color}28`,fontSize:12,fontWeight:700,color:cat.color }}>
                                <span>{cat.icon}</span>
                                <span>{cat.name}</span>
                              </span>
                              <span className="tip tip-down" data-tip="Date et heure de la transaction"
                                style={{ display:"inline-flex",alignItems:"center",gap:4,background:"rgba(255,255,255,0.04)",borderRadius:20,padding:"4px 11px",border:"1px solid rgba(255,255,255,0.07)",fontSize:11.5,color:"var(--text3)",fontWeight:600 }}>
                                🕐 {smartDate(tx.timestamp)}
                              </span>
                            </div>
                            {/* Ligne 3 : barre de proportion */}
                            <div style={{ display:"flex",alignItems:"center",gap:8 }}>
                              <div style={{ flex:1,maxWidth:160,height:3,background:"rgba(255,255,255,0.07)",borderRadius:3,overflow:"hidden" }}>
                                <div style={{ width:`${amountBar}%`,height:"100%",background:`linear-gradient(90deg,${cat.color},${cat.color}80)`,borderRadius:3,transition:"width .6s" }}/>
                              </div>
                              <span style={{ fontSize:10,color:"var(--text3)",fontWeight:700 }}>{pct}% du total</span>
                            </div>
                          </div>
                        </div>

                        <div className="tip tip-right" data-tip={`${pct}% du total mensuel (${fmt(totalAll)})`}
                          style={{ marginLeft:"auto",textAlign:"right",flexShrink:0,minWidth:100 }}>
                          <div style={{ fontFamily:"'Fraunces',serif",fontWeight:900,fontSize:22,color:"var(--red)",textShadow:"0 0 18px rgba(248,113,113,0.3)",letterSpacing:-.5 }}>
                            -{fmt(tx.amount)}
                          </div>
                        </div>

                        <div className="row-actions" style={{ display:"flex",flexDirection:"column",gap:5,flexShrink:0 }}>
                          <button onClick={() => setModal({ type:"editTransaction",tx,selMonth })}
                            className="action-btn action-btn-edit tip tip-right" data-tip="Modifier cette dépense">✏️ Modifier</button>
                          <button onClick={() => duplicate(tx)}
                            className="action-btn action-btn-dup tip tip-right" data-tip="Dupliquer à l'instant présent">📋 Dupliquer</button>
                          <button onClick={() => del(tx.id)}
                            className="action-btn action-btn-del tip tip-right" data-tip="Supprimer définitivement">🗑 Supprimer</button>
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


function Bills({ data, update, selMonth, mdata, setModal }) {
  const [search, setSearch]         = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [confirmClear, setConfirmClear] = useState(false);

  const toggle = billId => {
    update(d => {
      const bill = d.bills.find(b => b.id===billId);
      if (!bill) return;
      if (!bill.paid) bill.paid = {};
      const wasPaid = bill.paid[selMonth];
      bill.paid[selMonth] = !wasPaid;
      ensureMonth(d, selMonth);
      if (!wasPaid) {
        d.monthsData[selMonth].transactions.push({ id:mkid(),label:bill.name,amount:bill.amount||0,categoryId:bill.categoryId||"c7",profileId:bill.profileId||"common",timestamp:nowISO(),fromBill:billId });
      } else {
        d.monthsData[selMonth].transactions = d.monthsData[selMonth].transactions.filter(t => t.fromBill!==billId);
      }
    });
  };

  const del = id => update(d => { d.bills = d.bills.filter(b => b.id!==id); });

  const clearAllBills = () => {
    update(d => {
      if (d.monthsData[selMonth]) {
        d.monthsData[selMonth].transactions = (d.monthsData[selMonth].transactions||[]).filter(t => !t.fromBill);
      }
      d.bills.forEach(b => { if (b.paid) delete b.paid[selMonth]; });
    });
    setConfirmClear(false);
  };

  const allBillsFiltered = useMemo(() => {
    let bills = [...data.bills];
    if (search.trim()) { const q=search.toLowerCase(); bills = bills.filter(b => b.name.toLowerCase().includes(q)); }
    const now = new Date();
    bills = bills.filter(b => {
      const isPaid = b.paid?.[selMonth];
      const isOverdue = b.dueDate&&new Date(b.dueDate)<now&&!isPaid;
      if (filterStatus==="paid")    return isPaid;
      if (filterStatus==="unpaid")  return !isPaid&&!isOverdue;
      if (filterStatus==="overdue") return isOverdue;
      return true;
    });
    return bills;
  }, [data.bills,search,filterStatus,selMonth]);

  const overdueList  = useMemo(() => allBillsFiltered.filter(b=>!b.paid?.[selMonth]&&b.dueDate&&new Date(b.dueDate)<new Date()).sort((a,b)=>new Date(a.dueDate)-new Date(b.dueDate)), [allBillsFiltered,selMonth]);
  const pendingList  = useMemo(() => allBillsFiltered.filter(b=>!b.paid?.[selMonth]&&!(b.dueDate&&new Date(b.dueDate)<new Date())).sort((a,b)=>{ if(!a.dueDate)return 1; if(!b.dueDate)return -1; return new Date(a.dueDate)-new Date(b.dueDate); }), [allBillsFiltered,selMonth]);
  const unpaid = useMemo(() => allBillsFiltered.filter(b=>!b.paid?.[selMonth]).sort((a,b)=>{ if(!a.dueDate)return 1; if(!b.dueDate)return -1; return new Date(a.dueDate)-new Date(b.dueDate); }), [allBillsFiltered,selMonth]);
  const paid        = useMemo(() => allBillsFiltered.filter(b=>b.paid?.[selMonth]), [allBillsFiltered,selMonth]);
  const totalUnpaid = useMemo(() => data.bills.filter(b=>!b.paid?.[selMonth]).reduce((s,b)=>s+(b.amount||0),0), [data.bills,selMonth]);
  const totalPaid   = useMemo(() => data.bills.filter(b=>b.paid?.[selMonth]).reduce((s,b)=>s+(b.amount||0),0), [data.bills,selMonth]);
  const overdueCount = useMemo(() => data.bills.filter(b=>b.dueDate&&new Date(b.dueDate)<new Date()&&!b.paid?.[selMonth]).length, [data.bills,selMonth]);

  return (
    <div className="fade-up content-grid">
      <div>
        <div style={{ marginBottom:16,display:"flex",flexDirection:"column",gap:10 }}>
          <div style={{ display:"flex",gap:8,alignItems:"center" }}>
            <div style={{ position:"relative",flex:1 }}>
              <span style={{ position:"absolute",left:14,top:"50%",transform:"translateY(-50%)",fontSize:14,pointerEvents:"none",opacity:.5 }}>🔍</span>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher une facture…"
                style={{ paddingLeft:40,background:"rgba(255,255,255,0.06)",border:"1px solid var(--border)",borderRadius:13,fontSize:13,height:42 }}/>
              {search && <button onClick={() => setSearch("")} style={{ position:"absolute",right:12,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",color:"var(--text3)",fontSize:16,lineHeight:1 }}>×</button>}
            </div>
            {data.bills.length>0 && !confirmClear && (
              <button className="tip" data-tip={`Réinitialiser toutes les factures de ${monthLabel(selMonth)}`}
                onClick={() => setConfirmClear(true)}
                style={{ display:"flex",alignItems:"center",gap:6,padding:"10px 14px",borderRadius:11,border:"1px solid rgba(248,113,113,0.25)",background:"rgba(248,113,113,0.07)",color:"var(--red)",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"'Outfit',sans-serif",transition:"all .2s",flexShrink:0,whiteSpace:"nowrap" }}
                onMouseEnter={e=>{e.currentTarget.style.background="rgba(248,113,113,0.2)";}}
                onMouseLeave={e=>{e.currentTarget.style.background="rgba(248,113,113,0.07)";}}>
                🗑 Effacer le mois
              </button>
            )}
            {confirmClear && (
              <div style={{ display:"flex",alignItems:"center",gap:6,flexShrink:0,background:"rgba(248,113,113,0.08)",border:"1px solid rgba(248,113,113,0.25)",borderRadius:12,padding:"8px 12px" }}>
                <span style={{ fontSize:12,color:"var(--red)",fontWeight:700 }}>Réinitialiser ?</span>
                <button onClick={clearAllBills} style={{ padding:"5px 10px",borderRadius:8,border:"1px solid rgba(248,113,113,0.5)",background:"rgba(248,113,113,0.25)",color:"var(--red)",cursor:"pointer",fontSize:11,fontWeight:800,fontFamily:"'Outfit',sans-serif" }}>Oui</button>
                <button onClick={() => setConfirmClear(false)} style={{ padding:"5px 10px",borderRadius:8,border:"1px solid var(--border)",background:"var(--glass)",color:"var(--text2)",cursor:"pointer",fontSize:11,fontWeight:700,fontFamily:"'Outfit',sans-serif" }}>Non</button>
              </div>
            )}
          </div>
          <div style={{ display:"flex",gap:7,flexWrap:"wrap" }}>
            {[
              { id:"all",     label:"Toutes",       count:data.bills.length },
              { id:"unpaid",  label:"En attente",   count:data.bills.filter(b=>!b.paid?.[selMonth]&&!(b.dueDate&&new Date(b.dueDate)<new Date())).length },
              { id:"overdue", label:"⚠️ En retard", count:overdueCount },
              { id:"paid",    label:"✅ Payées",     count:data.bills.filter(b=>b.paid?.[selMonth]).length },
            ].map(f => (
              <button key={f.id} onClick={() => setFilterStatus(f.id)} style={{
                padding:"6px 13px",borderRadius:20,border:"none",cursor:"pointer",fontFamily:"'Outfit',sans-serif",fontSize:12,fontWeight:700,
                background:filterStatus===f.id?(f.id==="overdue"?"rgba(248,113,113,0.2)":f.id==="paid"?"rgba(74,222,128,0.15)":"rgba(167,139,250,0.15)"):"rgba(255,255,255,0.05)",
                color:filterStatus===f.id?(f.id==="overdue"?"var(--red)":f.id==="paid"?"var(--green)":"var(--purple)"):"var(--text3)",
                border:`1px solid ${filterStatus===f.id?(f.id==="overdue"?"rgba(248,113,113,0.35)":f.id==="paid"?"rgba(74,222,128,0.3)":"rgba(167,139,250,0.3)"):"var(--border)"}`,
                transition:"all .15s",display:"flex",alignItems:"center",gap:5,
              }}>
                {f.label}<span style={{ background:"rgba(255,255,255,0.08)",borderRadius:10,padding:"1px 6px",fontSize:10 }}>{f.count}</span>
              </button>
            ))}
          </div>
        </div>

        {data.bills.length===0 ? (
          <div className="card empty-state"><div className="empty-icon">📋</div>Aucune facture configurée</div>
        ) : allBillsFiltered.length===0 ? (
          <div className="card empty-state">
            <div className="empty-icon">{search?"🔍":"📋"}</div>
            <div style={{ fontSize:15,fontWeight:700,marginBottom:6 }}>{search?"Aucun résultat":"Aucune facture"}</div>
          </div>
        ) : (
          <>
            {overdueList.length>0 && (
              <div style={{ marginBottom:16 }}>
                <div className="bill-section-hdr" style={{ color:"var(--red)" }}>
                  <span>⚠️</span><span>En retard de paiement ({overdueList.length})</span>
                </div>
                <div style={{ background:"rgba(248,113,113,0.04)",borderRadius:14,border:"1px solid rgba(248,113,113,0.12)",padding:"2px 0",marginBottom:4 }}>
                  <div style={{ padding:"8px 14px 4px",fontSize:11,color:"var(--red)",fontWeight:600,opacity:.8 }}>
                    💳 Ces prélèvements automatiques ont dépassé leur date d'échéance. Marquez-les comme payés une fois débités.
                  </div>
                </div>
                {overdueList.map((b,i) => <BillRow key={b.id} bill={b} selMonth={selMonth} onToggle={toggle} onDelete={del} profiles={data.profiles} idx={i} setModal={setModal}/>)}
              </div>
            )}
            {pendingList.length>0 && (
              <div style={{ marginBottom:16 }}>
                <div className="bill-section-hdr" style={{ color:"var(--yellow)" }}>
                  <span>⏳</span><span>En attente ({pendingList.length})</span>
                </div>
                {pendingList.map((b,i) => <BillRow key={b.id} bill={b} selMonth={selMonth} onToggle={toggle} onDelete={del} profiles={data.profiles} idx={i} setModal={setModal}/>)}
              </div>
            )}
            {paid.length>0 && (
              <div>
                <div className="bill-section-hdr" style={{ color:"var(--green)" }}>
                  <span>✅</span><span>Réglées ({paid.length})</span>
                </div>
                {paid.map((b,i) => <BillRow key={b.id} bill={b} selMonth={selMonth} onToggle={toggle} onDelete={del} profiles={data.profiles} idx={i} setModal={setModal}/>)}
              </div>
            )}
          </>
        )}
      </div>

      <div style={{ display:"flex",flexDirection:"column",gap:14 }}>
        <div className="card">
          <div style={{ fontWeight:700,fontSize:13,marginBottom:14 }}>📊 Progression — {monthLabel(selMonth)}</div>
          <div style={{ display:"flex",gap:10,marginBottom:14 }}>
            {[
              { l:"Payées",    v:data.bills.filter(b=>b.paid?.[selMonth]).length,  c:"var(--green)",bg:"rgba(74,222,128,0.08)" },
              { l:"En attente",v:data.bills.filter(b=>!b.paid?.[selMonth]).length, c:"var(--yellow)",bg:"rgba(251,191,36,0.08)" },
            ].map(s => (
              <div key={s.l} style={{ flex:1,textAlign:"center",background:s.bg,borderRadius:12,padding:"12px 6px" }}>
                <div className="stat-num" style={{ fontSize:28,color:s.c }}>{s.v}</div>
                <div style={{ fontSize:11,color:"var(--text3)" }}>{s.l}</div>
              </div>
            ))}
          </div>
          <div className="progress-track" style={{ height:10,marginBottom:10 }}>
            <div className="progress-fill" style={{ width:data.bills.length?`${(data.bills.filter(b=>b.paid?.[selMonth]).length/data.bills.length)*100}%`:"0%",background:"var(--grad-green)" }}/>
          </div>
          <div style={{ display:"flex",justifyContent:"space-between",fontSize:12,color:"var(--text3)",marginBottom:12 }}>
            <span>{data.bills.length} factures</span>
            <span style={{ color:"var(--red)",fontWeight:700 }}>{totalUnpaid>0?`-${fmt(totalUnpaid)} restant`:"🎉 Tout payé !"}</span>
          </div>
          {totalPaid>0 && (
            <div style={{ display:"flex",justifyContent:"space-between",fontSize:12,padding:"8px 12px",background:"rgba(74,222,128,0.06)",borderRadius:10 }}>
              <span style={{ color:"var(--text3)" }}>Déjà réglé</span>
              <span style={{ color:"var(--green)",fontWeight:700 }}>+{fmt(totalPaid)}</span>
            </div>
          )}
          {overdueCount>0 && (
            <div style={{ display:"flex",justifyContent:"space-between",fontSize:12,padding:"8px 12px",background:"rgba(248,113,113,0.06)",borderRadius:10,marginTop:8 }}>
              <span style={{ color:"var(--red)" }}>⚠️ En retard</span>
              <span style={{ color:"var(--red)",fontWeight:700 }}>{overdueCount} facture{overdueCount>1?"s":""}</span>
            </div>
          )}
        </div>
        <div className="card" style={{ textAlign:"center",padding:28 }}>
          <div style={{ fontSize:42,marginBottom:10 }}>📋</div>
          <div style={{ fontWeight:700,marginBottom:6 }}>Nouvelle facture</div>
          <div style={{ fontSize:12,color:"var(--text2)",marginBottom:18 }}>Charges fixes récurrentes</div>
          <button className="btn btn-primary" style={{ width:"100%" }} onClick={() => setModal({ type:"addBill" })}>+ Créer une facture</button>
        </div>
      </div>
    </div>
  );
}

function BillRow({ bill, selMonth, onToggle, onDelete, profiles, idx, setModal }) {
  const isPaid    = bill.paid?.[selMonth];
  const prof      = profiles.find(p => p.id===bill.profileId);
  const dueDate   = bill.dueDate ? new Date(bill.dueDate) : null;
  const isOverdue = dueDate&&dueDate<new Date()&&!isPaid;

  // Compute due date details
  const getDueInfo = () => {
    if (!dueDate) return null;
    const now = new Date();
    const diffMs = dueDate - now;
    const diffDays = Math.ceil(diffMs / 86400000);
    const dayNum = dueDate.getDate();
    const monthName = dueDate.toLocaleDateString("fr-FR", { month:"long" });
    const yearStr = dueDate.getFullYear() !== now.getFullYear() ? ` ${dueDate.getFullYear()}` : "";
    const timeStr = dueDate.toLocaleTimeString("fr-FR",{ hour:"2-digit",minute:"2-digit" });
    if (isOverdue && !isPaid) {
      const daysLate = Math.abs(diffDays);
      return { label:`${dayNum} ${monthName}${yearStr}`, time:timeStr, badge:`${daysLate} j de retard`, badgeColor:"var(--red)", badgeBg:"rgba(248,113,113,0.12)", badgeBorder:"rgba(248,113,113,0.3)", icon:"⚠️", countdown:null };
    }
    if (diffDays<=0) return { label:`${dayNum} ${monthName}${yearStr}`, time:timeStr, badge:"Aujourd'hui !", badgeColor:"var(--red)", badgeBg:"rgba(248,113,113,0.12)", badgeBorder:"rgba(248,113,113,0.3)", icon:"🔔", countdown:0 };
    if (diffDays<=3) return { label:`${dayNum} ${monthName}${yearStr}`, time:timeStr, badge:`dans ${diffDays} j`, badgeColor:"var(--orange)", badgeBg:"rgba(251,146,60,0.12)", badgeBorder:"rgba(251,146,60,0.3)", icon:"⏱️", countdown:diffDays };
    if (diffDays<=7) return { label:`${dayNum} ${monthName}${yearStr}`, time:timeStr, badge:`dans ${diffDays} j`, badgeColor:"var(--yellow)", badgeBg:"rgba(251,191,36,0.1)", badgeBorder:"rgba(251,191,36,0.28)", icon:"📅", countdown:diffDays };
    return { label:`${dayNum} ${monthName}${yearStr}`, time:timeStr, badge:`dans ${diffDays} j`, badgeColor:"var(--text3)", badgeBg:"rgba(255,255,255,0.04)", badgeBorder:"var(--border)", icon:"📅", countdown:diffDays };
  };
  const dueInfo = getDueInfo();

  const statusColor  = isPaid?"var(--green)":isOverdue?"var(--red)":"var(--yellow)";
  const statusBg     = isPaid?"rgba(74,222,128,0.08)":isOverdue?"rgba(248,113,113,0.08)":"rgba(251,191,36,0.06)";
  const statusBorder = isPaid?"rgba(74,222,128,0.25)":isOverdue?"rgba(248,113,113,0.35)":"rgba(251,191,36,0.2)";
  const statusLabel  = isPaid?"✅ Payée":isOverdue?"⚠️ En retard":"⏳ En attente";

  return (
    <div className={`bill-card-row fade-up stagger-${(idx%5)+1}`}
      style={{ marginBottom:14,background:"var(--glass)",border:`1px solid ${statusBorder}`,borderRadius:18,overflow:"hidden",opacity:isPaid?0.72:1,transition:"all .28s cubic-bezier(.4,0,.2,1)",boxShadow:isOverdue?"0 0 20px rgba(248,113,113,0.1)":undefined,position:"relative" }}>
      <div style={{ height:3,background:`linear-gradient(90deg,${statusColor},transparent)` }}/>
      <div style={{ padding:"16px 18px" }}>
        {/* Header */}
        <div style={{ display:"flex",alignItems:"center",gap:14,marginBottom:14 }}>
          <div style={{ width:52,height:52,borderRadius:14,flexShrink:0,background:statusBg,border:`1px solid ${statusBorder}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:26 }}>
            {bill.icon||"📋"}
          </div>
          <div style={{ flex:1,minWidth:0 }}>
            <div style={{ fontWeight:800,fontSize:17,textDecoration:isPaid?"line-through":"none",color:isPaid?"var(--text3)":"var(--text)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",marginBottom:5 }}>{bill.name}</div>
            <div style={{ display:"flex",gap:6,flexWrap:"wrap" }}>
              <span style={{ display:"inline-flex",alignItems:"center",gap:4,background:statusBg,border:`1px solid ${statusBorder}`,color:statusColor,borderRadius:20,padding:"3px 10px",fontSize:11,fontWeight:700 }}>{statusLabel}</span>
              {bill.recurring && <span style={{ display:"inline-flex",alignItems:"center",gap:4,background:"rgba(167,139,250,0.12)",border:"1px solid rgba(167,139,250,0.3)",color:"var(--purple)",borderRadius:20,padding:"3px 10px",fontSize:11,fontWeight:700 }}>🔄 Récurrent</span>}
            </div>
          </div>
          {bill.amount>0 && (
            <div style={{ fontFamily:"'Fraunces',serif",fontWeight:800,fontSize:20,color:isOverdue?"var(--red)":"var(--text)",flexShrink:0 }}>-{fmt(bill.amount)}</div>
          )}
        </div>

          {/* Info grid — compte + échéance redesignée */}
          <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14 }}>
            {/* Compte */}
            <div style={{ background:"rgba(255,255,255,0.03)",borderRadius:14,padding:"12px 14px",border:"1px solid var(--border)" }}>
              <div style={{ fontSize:9,color:"var(--text3)",textTransform:"uppercase",letterSpacing:1.2,marginBottom:8,fontWeight:800 }}>Compte</div>
              <div style={{ display:"flex",alignItems:"center",gap:8 }}>
                <div style={{ width:32,height:32,borderRadius:9,background:prof?`${prof.color}22`:"rgba(255,255,255,0.06)",border:`1.5px solid ${prof?.color||"var(--border)"}40`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16 }}>{prof?.avatar||"🏦"}</div>
                <div style={{ fontWeight:800,fontSize:14,color:prof?.color||"var(--text)" }}>{prof?.name||"—"}</div>
              </div>
            </div>

            {/* Échéance redesignée — plus grande et visuelle */}
            <div style={{ background:dueInfo?`${dueInfo.badgeBg}`:"rgba(255,255,255,0.03)",borderRadius:14,padding:"12px 14px",border:`1.5px solid ${dueInfo&&!isPaid?dueInfo.badgeBorder:"var(--border)"}` }}>
              <div style={{ fontSize:9,color:"var(--text3)",textTransform:"uppercase",letterSpacing:1.2,marginBottom:8,fontWeight:800 }}>Échéance</div>
              {dueInfo ? (
                <div>
                  <div style={{ display:"flex",alignItems:"center",gap:6,marginBottom:6 }}>
                    <span style={{ fontSize:20,lineHeight:1 }}>{dueInfo.icon}</span>
                    <div style={{ fontFamily:"'Fraunces',serif",fontWeight:900,fontSize:17,color:isPaid?"var(--text3)":dueInfo.badgeColor,lineHeight:1.1 }}>{dueInfo.label}</div>
                  </div>
                  {!isPaid && (
                    <div style={{ display:"inline-flex",alignItems:"center",gap:4,background:dueInfo.badgeBg,border:`1px solid ${dueInfo.badgeBorder}`,color:dueInfo.badgeColor,borderRadius:20,padding:"4px 11px",fontSize:12,fontWeight:900,letterSpacing:.2 }}>
                      {dueInfo.badge}
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ fontWeight:600,fontSize:13,color:"var(--text3)",marginTop:4 }}>— Pas d'échéance</div>
              )}
            </div>
          </div>

        {/* Actions */}
        <div style={{ display:"flex",gap:8,alignItems:"center" }}>
          <button onClick={() => onToggle(bill.id)} style={{
            flex:1,padding:"11px",borderRadius:12,cursor:"pointer",fontFamily:"'Outfit',sans-serif",fontWeight:800,fontSize:14,
            background:isPaid?"rgba(74,222,128,0.12)":"rgba(167,139,250,0.12)",
            border:`1px solid ${isPaid?"rgba(74,222,128,0.35)":"rgba(167,139,250,0.35)"}`,
            color:isPaid?"var(--green)":"var(--purple)",transition:"all .2s",
          }}>
            {isPaid?"↩️ Marquer impayée":"✅ Marquer comme payée"}
          </button>
          <div className="bill-hover-actions" style={{ display:"flex",gap:6 }}>
            <button onClick={() => setModal({ type:"editBill",bill })}
              className="tip action-btn action-btn-edit" data-tip="Modifier cette facture"
              style={{ display:"flex",alignItems:"center",gap:5,padding:"9px 14px",borderRadius:11,border:"1px solid rgba(167,139,250,0.3)",background:"rgba(167,139,250,0.1)",color:"var(--purple)",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"'Outfit',sans-serif",transition:"all .2s",whiteSpace:"nowrap" }}>
              ✏️ Modifier
            </button>
            <button onClick={() => onDelete(bill.id)}
              className="tip action-btn action-btn-del" data-tip="Supprimer cette facture définitivement"
              style={{ display:"flex",alignItems:"center",gap:5,padding:"9px 14px",borderRadius:11,border:"1px solid rgba(248,113,113,0.3)",background:"rgba(248,113,113,0.08)",color:"var(--red)",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"'Outfit',sans-serif",transition:"all .2s",whiteSpace:"nowrap" }}>
              🗑 Supprimer
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}


function Stats({ data, selMonth, mdata, allMonths }) {
  const [period, setPeriod]   = useState("month");
  const [statTab, setStatTab] = useState("overview");
  const catMap = useMemo(() => Object.fromEntries(data.categories.map(c=>[c.id,c])), [data.categories]);

  const months = useMemo(() => {
    const all = [...allMonths].reverse();
    if (period==="month")   return [selMonth];
    if (period==="quarter") { const [y,m]=selMonth.split("-").map(Number); return all.filter(k=>{ const [ky,km]=k.split("-").map(Number); return ky===y&&Math.abs(km-m)<3; }); }
    if (period==="year")    { const y=selMonth.slice(0,4); return all.filter(k=>k.startsWith(y)); }
    return [selMonth];
  }, [period,selMonth,allMonths]);

  const allTx   = useMemo(() => months.flatMap(k=>(data.monthsData[k]?.transactions||[])), [months,data.monthsData]);
  const totalExp = useMemo(() => allTx.reduce((s,t)=>s+t.amount,0), [allTx]);
  const totalInc = useMemo(() => months.reduce((s,k) => { const inc=data.monthsData[k]?.incomes||{}; return s+(inc.p1||0)+(inc.p2||0)+(inc.common||0); },0), [months,data.monthsData]);

  const pieData = useMemo(() => {
    const m={};
    allTx.forEach(t=>{ m[t.categoryId]=(m[t.categoryId]||0)+t.amount; });
    return Object.entries(m).map(([cid,val])=>({ name:(catMap[cid]?.icon||"")+" "+(catMap[cid]?.name||cid),value:val,color:catMap[cid]?.color||"#888" })).sort((a,b)=>b.value-a.value);
  }, [allTx,catMap]);

  const timelineData = useMemo(() => [...allMonths].slice(0,12).reverse().map(k => {
    const m   = data.monthsData[k];
    const exp = m?.transactions.reduce((s,t)=>s+t.amount,0)||0;
    const inc = m?(m.incomes?.p1||0)+(m.incomes?.p2||0)+(m.incomes?.common||0):0;
    return { month:monthLabelShort(k),dépenses:exp,revenus:inc,solde:inc-exp };
  }), [allMonths,data.monthsData]);

  const profBreakdown = useMemo(() => data.profiles.filter(p=>p.id!=="common").map(p => {
    const spent = allTx.filter(t=>t.profileId===p.id).reduce((s,t)=>s+t.amount,0);
    const inc   = months.reduce((s,k)=>s+(data.monthsData[k]?.incomes?.[p.id]||0),0);
    return { ...p,spent,inc,balance:inc-spent };
  }), [data.profiles,allTx,months,data.monthsData]);

  const prevMonths = useMemo(() => {
    const all=[...allMonths].reverse();
    if (period==="month") { const idx=all.indexOf(selMonth); return idx>=0&&idx+1<all.length?[all[idx+1]]:[]; }
    return [];
  }, [period,selMonth,allMonths]);

  const prevExp = useMemo(() => prevMonths.flatMap(k=>(data.monthsData[k]?.transactions||[])).reduce((s,t)=>s+t.amount,0), [prevMonths,data.monthsData]);
  const trendPct = prevExp>0 ? ((totalExp-prevExp)/prevExp)*100 : null;
  const savingsRate = totalInc>0 ? Math.round(((totalInc-totalExp)/totalInc)*100) : null;
  const avgPerDay = (() => { const today = new Date(); const days = period==="month"?today.getDate():months.length*30; return days>0?totalExp/days:0; })();

  const CT = ({ active,payload,label }) => {
    if (!active||!payload?.length) return null;
    return <div className="rc-tooltip"><div style={{ fontWeight:700,marginBottom:4,fontSize:12 }}>{label}</div>{payload.map((p,i)=><div key={i} style={{ color:p.color,fontSize:11 }}>{p.name}: {fmt(p.value)}</div>)}</div>;
  };
  const PT = ({ active,payload }) => {
    if (!active||!payload?.length) return null;
    const d=payload[0];
    return <div className="rc-tooltip"><div style={{ fontWeight:700 }}>{d.name}</div><div style={{ color:d.payload.color }}>{fmt(d.value)}</div><div style={{ fontSize:10,color:"var(--text3)" }}>{totalExp>0?Math.round((d.value/totalExp)*100):0}%</div></div>;
  };

  const KpiCard = ({ icon, label, value, color, gradient, sub }) => (
    <div className="stat-kpi-card" style={{ background:`linear-gradient(145deg,${gradient[0]},${gradient[1]})`,border:`1px solid ${color}28`,boxShadow:`0 8px 28px ${color}20,0 2px 8px rgba(0,0,0,0.4)` }}>
      <div style={{ display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:14 }}>
        <div style={{ width:44,height:44,borderRadius:13,background:`${color}20`,border:`1px solid ${color}30`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:22 }}>{icon}</div>
        {sub && <div style={{ fontSize:11,color:`${color}99`,fontWeight:700,background:`${color}12`,borderRadius:20,padding:"3px 9px",maxWidth:"55%",textAlign:"right",lineHeight:1.3 }}>{sub}</div>}
      </div>
      <div style={{ fontSize:10,color:"rgba(255,255,255,0.45)",textTransform:"uppercase",letterSpacing:1.5,marginBottom:6,fontWeight:800 }}>{label}</div>
      <div className="stat-num" style={{ fontSize:28,color:"white",letterSpacing:-.5,lineHeight:1 }}>{value}</div>
    </div>
  );

  return (
    <div className="fade-up">
      {/* Period + Tab controls */}
      <div style={{ display:"flex",gap:10,marginBottom:22,alignItems:"center",flexWrap:"wrap" }}>
        <div className="filter-bar" style={{ flex:1 }}>
          {[{ id:"month",label:"Ce mois" },{ id:"quarter",label:"Trimestre" },{ id:"year",label:"Année" }].map(p => (
            <div key={p.id} className={`filter-chip ${period===p.id?"active":""}`} onClick={() => setPeriod(p.id)}>{p.label}</div>
          ))}
        </div>
        <div className="filter-bar">
          {[{ id:"overview",icon:"🌐",label:"Vue d'ensemble" },{ id:"categories",icon:"🥧",label:"Catégories" },{ id:"timeline",icon:"📈",label:"Historique" },{ id:"profiles",icon:"👥",label:"Profils" }].map(t => (
            <div key={t.id} className={`filter-chip ${statTab===t.id?"active":""}`} onClick={() => setStatTab(t.id)}
              style={{ borderColor:statTab===t.id?"rgba(96,165,250,0.5)":"var(--border)",background:statTab===t.id?"rgba(96,165,250,0.12)":"var(--glass)",color:statTab===t.id?"var(--blue)":"var(--text2)" }}>
              <span style={{ fontSize:14 }}>{t.icon}</span>{t.label}
            </div>
          ))}
        </div>
      </div>

      {statTab==="overview" && (
        <div>
          {/* KPI Cards row */}
          <div className="grid-4" style={{ marginBottom:20 }}>
            <KpiCard icon="💵" label="Revenus" value={`+${fmtCompact(totalInc)}`} color="#4ade80" gradient={["#052e16","#065f46"]} sub={period==="month"?monthLabel(selMonth):undefined}/>
            <KpiCard icon="💸" label="Dépenses" value={`-${fmtCompact(totalExp)}`} color="#f87171" gradient={["#2d0000","#450a0a"]} sub={allTx.length+" transactions"}/>
            <KpiCard icon="⚖️" label="Solde net" value={fmtCompact(totalInc-totalExp)} color={totalInc>=totalExp?"#4ade80":"#f87171"} gradient={totalInc>=totalExp?["#052e16","#065f46"]:["#2d0000","#450a0a"]} sub={savingsRate!==null?`Épargne: ${savingsRate}%`:undefined}/>
            <KpiCard icon="📅" label="Moy. / jour" value={fmtCompact(avgPerDay)} color="#a78bfa" gradient={["#1e0a3c","#2d1b69"]} sub={trendPct!==null?`${trendPct>0?"↑":"↓"} ${Math.abs(Math.round(trendPct))}% vs mois préc.`:undefined}/>
          </div>
          {trendPct!==null && (
            <div className={`alert-banner ${trendPct>0?"alert-warning":"alert-success"}`} style={{ marginBottom:18 }}>
              {trendPct>0?"📈":"📉"}<span>Dépenses {trendPct>0?"en hausse de":"en baisse de"} <strong>{Math.abs(Math.round(trendPct))}%</strong> par rapport au mois précédent ({fmt(prevExp)})</span>
            </div>
          )}
          <div className="content-grid">
            <div style={{ display:"flex",flexDirection:"column",gap:14 }}>
              <div className="card">
                <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16 }}>
                  <div style={{ fontWeight:800,fontSize:14 }}>📊 Revenus vs Dépenses — 12 mois</div>
                </div>
                <ResponsiveContainer width="100%" height={220}>
                  <AreaChart data={timelineData.filter(d=>d.revenus>0||d.dépenses>0)} margin={{ top:4,right:4,left:0,bottom:0 }}>
                    <defs>
                      <linearGradient id="gR" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#4ade80" stopOpacity={0.3}/><stop offset="95%" stopColor="#4ade80" stopOpacity={0}/></linearGradient>
                      <linearGradient id="gE" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#f87171" stopOpacity={0.3}/><stop offset="95%" stopColor="#f87171" stopOpacity={0}/></linearGradient>
                    </defs>
                    <XAxis dataKey="month" tick={{ fill:"rgba(237,233,248,0.35)",fontSize:10 }} axisLine={false} tickLine={false}/>
                    <YAxis tick={{ fill:"rgba(237,233,248,0.35)",fontSize:10 }} axisLine={false} tickLine={false} width={72} tickFormatter={v=>v>0?fmtCompact(v):"."}/>
                    <Tooltip content={<CT/>}/>
                    <Area type="monotone" dataKey="revenus"  stroke="#4ade80" strokeWidth={2.5} fill="url(#gR)" name="Revenus" dot={false}/>
                    <Area type="monotone" dataKey="dépenses" stroke="#f87171" strokeWidth={2.5} fill="url(#gE)" name="Dépenses" dot={false}/>
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              {/* Top 5 catégories */}
              {pieData.length>0 && (
                <div className="card">
                  <div style={{ fontWeight:800,fontSize:14,marginBottom:14 }}>🏆 Top catégories</div>
                  {pieData.slice(0,5).map((d,i) => (
                    <div key={i} style={{ display:"flex",alignItems:"center",gap:10,marginBottom:12 }}>
                      <div style={{ width:9,height:9,borderRadius:3,background:d.color,flexShrink:0 }}/>
                      <span style={{ flex:1,fontSize:13,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{d.name}</span>
                      <span style={{ fontSize:11,color:"var(--text3)",background:"rgba(255,255,255,0.05)",borderRadius:20,padding:"2px 8px",fontWeight:700,flexShrink:0 }}>{totalExp>0?Math.round((d.value/totalExp)*100):0}%</span>
                      <span style={{ fontWeight:800,fontSize:13,color:d.color,flexShrink:0 }}>{fmt(d.value)}</span>
                      <div className="progress-track" style={{ width:60,height:5,flexShrink:0 }}><div className="progress-fill" style={{ width:`${totalExp>0?(d.value/totalExp)*100:0}%`,background:d.color }}/></div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div style={{ display:"flex",flexDirection:"column",gap:14 }}>
              {pieData.length>0 && (
                <div className="card">
                  <div style={{ fontWeight:800,fontSize:14,marginBottom:10 }}>🥧 Répartition</div>
                  <ResponsiveContainer width="100%" height={190}>
                    <PieChart>
                      <Pie data={pieData} cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={3} dataKey="value">
                        {pieData.map((e,i) => <Cell key={i} fill={e.color} stroke="transparent"/>)}
                      </Pie>
                      <Tooltip content={<PT/>}/>
                    </PieChart>
                  </ResponsiveContainer>
                  <div style={{ display:"flex",flexWrap:"wrap",gap:5,marginTop:4 }}>
                    {pieData.slice(0,6).map((d,i) => <div key={i} style={{ display:"flex",alignItems:"center",gap:4,fontSize:11 }}><div style={{ width:8,height:8,borderRadius:2,background:d.color }}/><span style={{ color:"var(--text3)" }}>{d.name}</span></div>)}
                  </div>
                </div>
              )}
              <div className="card">
                <div style={{ fontWeight:800,fontSize:14,marginBottom:12 }}>📊 Solde mensuel</div>
                <ResponsiveContainer width="100%" height={150}>
                  <BarChart data={timelineData.filter(d=>d.revenus>0||d.dépenses>0)} margin={{ top:4,right:4,left:0,bottom:0 }}>
                    <XAxis dataKey="month" tick={{ fill:"rgba(237,233,248,0.35)",fontSize:9 }} axisLine={false} tickLine={false}/>
                    <YAxis tick={{ fill:"rgba(237,233,248,0.35)",fontSize:9 }} axisLine={false} tickLine={false} width={62} tickFormatter={v=>fmtCompact(v)}/>
                    <Tooltip content={<CT/>}/>
                    <Bar dataKey="solde" name="Solde" radius={[5,5,0,0]} maxBarSize={40}>
                      {timelineData.filter(d=>d.revenus>0||d.dépenses>0).map((e,i) => <Cell key={i} fill={e.solde>0?"#4ade80":e.solde<0?"#f87171":"rgba(255,255,255,0.1)"}/>)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </div>
      )}

      {statTab==="categories" && (
        <div className="content-grid">
          <div className="card">
            <div style={{ fontWeight:800,fontSize:14,marginBottom:20 }}>🔍 Analyse par catégorie</div>
            {pieData.length===0 ? <div className="empty-state"><div className="empty-icon">📊</div>Aucune dépense</div>
              : pieData.map((d,i) => (
                <div key={i} style={{ marginBottom:18 }}>
                  <div style={{ display:"flex",justifyContent:"space-between",marginBottom:7,fontSize:13 }}>
                    <div style={{ display:"flex",alignItems:"center",gap:8 }}>
                      <div style={{ width:32,height:32,borderRadius:9,background:`${d.color}18`,border:`1px solid ${d.color}30`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16 }}>{d.name.split(" ")[0]}</div>
                      <span style={{ fontWeight:700 }}>{d.name.split(" ").slice(1).join(" ")}</span>
                    </div>
                    <div style={{ display:"flex",gap:10,alignItems:"center" }}>
                      <span style={{ color:"var(--text3)",fontSize:11,background:"rgba(255,255,255,0.06)",borderRadius:20,padding:"2px 8px",fontWeight:700 }}>{totalExp>0?Math.round((d.value/totalExp)*100):0}%</span>
                      <span style={{ fontWeight:800,color:d.color,fontSize:15 }}>{fmt(d.value)}</span>
                    </div>
                  </div>
                  <div className="progress-track" style={{ height:8,borderRadius:20 }}>
                    <div className="progress-fill" style={{ width:`${totalExp>0?(d.value/totalExp)*100:0}%`,background:`linear-gradient(90deg,${d.color},${d.color}88)`,borderRadius:20 }}/>
                  </div>
                </div>
              ))
            }
          </div>
          {pieData.length>0 && (
            <div className="card">
              <div style={{ fontWeight:800,fontSize:14,marginBottom:10 }}>🥧 Distribution</div>
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie data={pieData} cx="50%" cy="50%" outerRadius={120} paddingAngle={3} dataKey="value">
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

      {statTab==="timeline" && (
        <div style={{ display:"flex",flexDirection:"column",gap:16 }}>
          <div className="card">
            <div style={{ fontWeight:800,fontSize:14,marginBottom:16 }}>📈 Évolution sur 12 mois</div>
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={timelineData} margin={{ top:4,right:4,left:0,bottom:0 }}>
                <defs>
                  <linearGradient id="gR2" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#4ade80" stopOpacity={0.35}/><stop offset="95%" stopColor="#4ade80" stopOpacity={0}/></linearGradient>
                  <linearGradient id="gE2" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#f87171" stopOpacity={0.35}/><stop offset="95%" stopColor="#f87171" stopOpacity={0}/></linearGradient>
                </defs>
                <XAxis dataKey="month" tick={{ fill:"rgba(237,233,248,0.35)",fontSize:11 }} axisLine={false} tickLine={false}/>
                <YAxis tick={{ fill:"rgba(237,233,248,0.35)",fontSize:11 }} axisLine={false} tickLine={false} width={75} tickFormatter={v=>fmtCompact(v)}/>
                <Tooltip content={<CT/>}/><Legend formatter={v => <span style={{ fontSize:12,color:"var(--text2)" }}>{v}</span>}/>
                <Area type="monotone" dataKey="revenus"  stroke="#4ade80" strokeWidth={2.5} fill="url(#gR2)" name="Revenus" dot={false}/>
                <Area type="monotone" dataKey="dépenses" stroke="#f87171" strokeWidth={2.5} fill="url(#gE2)" name="Dépenses" dot={false}/>
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="card">
            <div style={{ fontWeight:800,fontSize:14,marginBottom:14 }}>💹 Solde net mensuel</div>
            <ResponsiveContainer width="100%" height={190}>
              <BarChart data={timelineData} margin={{ top:4,right:4,left:0,bottom:0 }}>
                <XAxis dataKey="month" tick={{ fill:"rgba(237,233,248,0.35)",fontSize:11 }} axisLine={false} tickLine={false}/>
                <YAxis tick={{ fill:"rgba(237,233,248,0.35)",fontSize:11 }} axisLine={false} tickLine={false} width={75} tickFormatter={v=>fmtCompact(v)}/>
                <Tooltip content={<CT/>}/>
                <Bar dataKey="solde" name="Solde net" radius={[6,6,0,0]}>{timelineData.map((e,i) => <Cell key={i} fill={e.solde>=0?"#4ade80":"#f87171"}/>)}</Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          {timelineData.some(d=>d.solde!==0) && (() => {
            const withData = timelineData.filter(d=>d.revenus>0||d.dépenses>0);
            if (withData.length<2) return null;
            const best  = withData.reduce((a,b)=>a.solde>b.solde?a:b);
            const worst = withData.reduce((a,b)=>a.solde<b.solde?a:b);
            return (
              <div className="grid-2">
                <div className="card" style={{ borderColor:"rgba(74,222,128,0.25)",background:"rgba(74,222,128,0.04)",textAlign:"center" }}>
                  <div style={{ fontSize:32,marginBottom:8 }}>🏆</div>
                  <div style={{ fontSize:11,color:"var(--text3)",marginBottom:4 }}>Meilleur mois</div>
                  <div style={{ fontWeight:800,fontSize:15 }}>{best.month}</div>
                  <div style={{ fontWeight:900,color:"var(--green)",fontSize:18,marginTop:4 }}>{fmt(best.solde)}</div>
                </div>
                <div className="card" style={{ borderColor:"rgba(248,113,113,0.25)",background:"rgba(248,113,113,0.04)",textAlign:"center" }}>
                  <div style={{ fontSize:32,marginBottom:8 }}>📉</div>
                  <div style={{ fontSize:11,color:"var(--text3)",marginBottom:4 }}>Mois difficile</div>
                  <div style={{ fontWeight:800,fontSize:15 }}>{worst.month}</div>
                  <div style={{ fontWeight:900,color:"var(--red)",fontSize:18,marginTop:4 }}>{fmt(worst.solde)}</div>
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {statTab==="profiles" && (
        <div className="content-grid">
          {profBreakdown.map(p => (
            <div key={p.id} className="card" style={{ borderColor:`${p.color}25`,background:`${p.color}04` }}>
              <div style={{ display:"flex",alignItems:"center",gap:14,marginBottom:18 }}>
                <div style={{ width:56,height:56,borderRadius:16,background:`${p.color}18`,border:`2px solid ${p.color}35`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:28 }}>{p.avatar}</div>
                <div>
                  <div style={{ fontWeight:900,fontSize:18,color:p.color }}>{p.name}</div>
                  <div style={{ fontSize:12,color:"var(--text3)" }}>Solde : <strong style={{ color:p.balance>=0?"var(--green)":"var(--red)" }}>{fmt(p.balance)}</strong></div>
                </div>
              </div>
              <div className="grid-2" style={{ marginBottom:16 }}>
                <div style={{ background:"rgba(74,222,128,0.08)",borderRadius:12,padding:"12px",textAlign:"center",border:"1px solid rgba(74,222,128,0.15)" }}>
                  <div style={{ fontSize:10,color:"var(--text3)",marginBottom:4,textTransform:"uppercase",letterSpacing:.5 }}>Revenus</div>
                  <div style={{ fontWeight:900,color:"var(--green)",fontSize:18 }}>+{fmt(p.inc)}</div>
                </div>
                <div style={{ background:"rgba(248,113,113,0.08)",borderRadius:12,padding:"12px",textAlign:"center",border:"1px solid rgba(248,113,113,0.15)" }}>
                  <div style={{ fontSize:10,color:"var(--text3)",marginBottom:4,textTransform:"uppercase",letterSpacing:.5 }}>Dépenses</div>
                  <div style={{ fontWeight:900,color:"var(--red)",fontSize:18 }}>-{fmt(p.spent)}</div>
                </div>
              </div>
              {p.inc>0 && (<>
                <div style={{ display:"flex",justifyContent:"space-between",fontSize:12,color:"var(--text3)",marginBottom:6 }}>
                  <span>Budget utilisé</span>
                  <span style={{ fontWeight:800,color:p.spent>p.inc?"var(--red)":"var(--green)" }}>{Math.round((p.spent/p.inc)*100)}%</span>
                </div>
                <div className="progress-track" style={{ height:8 }}><div className="progress-fill" style={{ width:`${Math.min(100,(p.spent/p.inc)*100)}%`,background:p.color,boxShadow:`0 0 8px ${p.color}50` }}/></div>
              </>)}
            </div>
          ))}
        </div>
      )}
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
  if (modal.type === "editBill")            return <EditBillModal            close={close} data={data} update={update} bill={modal.bill}/>;
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

function EditBillModal({ close, data, update, bill }) {
  const [name, setName]         = useState(bill.name || "");
  const [amount, setAmount]     = useState(bill.amount || "");
  const [icon, setIcon]         = useState(bill.icon || "⚡");
  const [profId, setProfId]     = useState(bill.profileId || "common");
  const [catId, setCatId]       = useState(bill.categoryId || (data.categories[0]?.id || ""));
  const [dueDate, setDueDate]   = useState(bill.dueDate ? new Date(bill.dueDate).toISOString().slice(0,10) : "");
  const [recurring, setRecurring] = useState(bill.recurring ?? true);
  const save = () => {
    if (!name.trim()) return;
    update(d => {
      const idx = d.bills.findIndex(b => b.id===bill.id);
      if (idx>=0) {
        d.bills[idx] = { ...d.bills[idx], name:name.trim(), amount:parseFloat(amount)||0, icon, profileId:profId, categoryId:catId,
          dueDate:dueDate ? new Date(dueDate).toISOString() : null, recurring };
      }
    });
    close();
  };
  return (
    <ModalWrap close={close} title="✏️ Modifier la facture">
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
        <input type="checkbox" id="rec-edit" checked={recurring} onChange={e => setRecurring(e.target.checked)} style={{ width:"auto",cursor:"pointer" }}/>
        <label htmlFor="rec-edit" style={{ margin:0,cursor:"pointer",fontSize:13,color:"var(--text)" }}>🔄 Facture récurrente mensuelle</label>
      </div>
      <div style={{ display:"flex",gap:10 }}>
        <button className="btn btn-ghost" onClick={close} style={{ flex:1 }}>Annuler</button>
        <button className="btn btn-primary" onClick={save} style={{ flex:1 }} disabled={!name.trim()}>Enregistrer</button>
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

// ═══════════════════════════════════════════════════════════
//  SETTINGS PAGE
// ═══════════════════════════════════════════════════════════
function SettingsPage({ data, update, setModal, user, activeUID }) {
  const [tab, setTab] = useState("profiles");
  const [inviteCode, setInviteCode] = useState(data.inviteCode || "");
  const [codeLoading, setCodeLoading] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);
  const [pwdOld, setPwdOld] = useState(""); const [pwdNew, setPwdNew] = useState(""); const [pwdErr, setPwdErr] = useState(""); const [pwdOk, setPwdOk] = useState(false); const [pwdLoading, setPwdLoading] = useState(false);
  // Suppression de compte — 3 étapes : 0=bouton, 1=saisie mdp, 2=confirmation finale
  const [delStep, setDelStep] = useState(0);
  const [delPwd, setDelPwd] = useState("");
  const [delErr, setDelErr] = useState("");
  const [delLoading, setDelLoading] = useState(false);

  const genCode = async () => {
    setCodeLoading(true);
    const code = generateInviteCode();
    const ok = await saveInviteCode(activeUID || user.uid, code);
    if (ok) {
      update(d => { d.inviteCode = code; });
      setInviteCode(code);
    }
    setCodeLoading(false);
  };

  const copyCode = () => {
    if (!inviteCode) return;
    navigator.clipboard?.writeText(inviteCode).then(() => { setCodeCopied(true); setTimeout(() => setCodeCopied(false), 2000); });
  };

  const changePassword = async () => {
    if (!pwdOld || !pwdNew) { setPwdErr("Remplissez les deux champs."); return; }
    if (pwdNew.length < 6) { setPwdErr("Nouveau mot de passe trop court (6 caractères min)."); return; }
    setPwdLoading(true); setPwdErr(""); setPwdOk(false);
    try {
      const cred = EmailAuthProvider.credential(user.email, pwdOld);
      await reauthenticateWithCredential(user, cred);
      await updatePassword(user, pwdNew);
      setPwdOk(true); setPwdOld(""); setPwdNew("");
    } catch (e) {
      setPwdErr(e.code==="auth/wrong-password"||e.code==="auth/invalid-credential"?"Mot de passe actuel incorrect.":"Erreur : "+e.message);
    }
    setPwdLoading(false);
  };

  // Étape 1 — vérifier le mot de passe avant de montrer l'étape finale
  const verifyBeforeDelete = async () => {
    if (!delPwd) { setDelErr("Veuillez saisir votre mot de passe."); return; }
    setDelLoading(true); setDelErr("");
    try {
      const cred = EmailAuthProvider.credential(user.email, delPwd);
      await reauthenticateWithCredential(user, cred);
      setDelStep(2); // mot de passe OK → confirmation finale
    } catch (e) {
      setDelErr(e.code==="auth/wrong-password"||e.code==="auth/invalid-credential"?"Mot de passe incorrect.":"Erreur : "+e.message);
    }
    setDelLoading(false);
  };

  // Étape 2 — suppression effective
  const doDelete = async () => {
    setDelLoading(true);
    try {
      // Marquer les données comme supprimées (le compte étant supprimé on ne peut plus écrire après)
      try { await setDoc(getDocRef(user.uid), { _deleted: true, _ts: Date.now() }, { merge: true }); } catch {}
      await deleteUser(user);
      // onAuthStateChanged redirige automatiquement vers l'écran de connexion
    } catch (e) {
      setDelErr("Erreur lors de la suppression : " + (e.message || e.code));
      setDelLoading(false);
    }
  };

  const resetDel = () => { setDelStep(0); setDelPwd(""); setDelErr(""); };

  const pwdStr = getPasswordStrength(pwdNew);

  return (
    <div className="fade-up">
      <div className="tab-bar" style={{ marginBottom:20 }}>
        {[["profiles","👥","Profils"],["categories","🏷️","Catégories"],["account","🔐","Compte"]].map(([id,icon,label]) => (
          <button key={id} className={`tab-item ${tab===id?"active":""}`} onClick={() => setTab(id)}>
            <span style={{ fontSize:16 }}>{icon}</span>{label}
          </button>
        ))}
      </div>

      {tab==="profiles" && (
        <div className="content-grid">
          <div style={{ display:"flex",flexDirection:"column",gap:12 }}>
            {data.profiles.map(p => (
              <div key={p.id} className="card" style={{ display:"flex",alignItems:"center",gap:16,borderColor:`${p.color}25` }}>
                {/* Avatar / photo */}
                <div style={{ position:"relative",flexShrink:0 }}>
                  {p.photo ? (
                    <img src={p.photo} alt={p.name} style={{ width:56,height:56,borderRadius:16,objectFit:"cover",border:`2px solid ${p.color}50` }}/>
                  ) : (
                    <div style={{ width:56,height:56,borderRadius:16,background:`${p.color}18`,border:`2px solid ${p.color}35`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:28 }}>{p.avatar}</div>
                  )}
                  {/* Photo upload overlay */}
                  <label style={{ position:"absolute",inset:0,borderRadius:16,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(0,0,0,0)",transition:"background .2s",margin:0 }}
                    onMouseEnter={e=>e.currentTarget.style.background="rgba(0,0,0,0.55)"}
                    onMouseLeave={e=>e.currentTarget.style.background="rgba(0,0,0,0)"}>
                    <span style={{ fontSize:18,opacity:0,transition:"opacity .2s" }} ref={r=>{if(r)r.closest('label').addEventListener('mouseenter',()=>r.style.opacity=1);if(r)r.closest('label')?.addEventListener('mouseleave',()=>r.style.opacity=0);}}>📷</span>
                    <input type="file" accept="image/*" style={{ display:"none" }} onChange={e=>{
                      const f=e.target.files?.[0]; if(!f) return;
                      const reader=new FileReader();
                      reader.onload=ev=>update(d=>{ const prof=d.profiles.find(x=>x.id===p.id); if(prof) prof.photo=ev.target.result; });
                      reader.readAsDataURL(f);
                    }}/>
                  </label>
                </div>
                <div style={{ flex:1 }}>
                  <div style={{ fontWeight:800,fontSize:16,color:p.color }}>{p.name}</div>
                  <div style={{ fontSize:12,color:"var(--text3)",marginTop:2 }}>{p.id==="common"?"Compte commun":"Compte personnel"}</div>
                  {p.photo && (
                    <button onClick={() => update(d=>{ const prof=d.profiles.find(x=>x.id===p.id); if(prof) prof.photo=null; })}
                      style={{ marginTop:5,background:"none",border:"none",cursor:"pointer",fontSize:10,color:"var(--text3)",fontFamily:"'Outfit',sans-serif",padding:0,fontWeight:600 }}>
                      🗑️ Supprimer la photo
                    </button>
                  )}
                </div>
                <button className="btn btn-ghost btn-sm" onClick={() => setModal({ type:"editProfile",profileId:p.id })}>✏️ Modifier</button>
              </div>
            ))}
          </div>
          <div className="card">
            <div style={{ fontWeight:700,fontSize:13,marginBottom:12 }}>📸 Photo de profil</div>
            <div style={{ fontSize:12,color:"var(--text2)",lineHeight:1.7 }}>
              Cliquez sur l'avatar pour ajouter une photo personnalisée. Les photos sont stockées localement dans votre espace.
            </div>
            <div style={{ marginTop:12,padding:"10px 14px",background:"rgba(167,139,250,0.06)",border:"1px solid rgba(167,139,250,0.15)",borderRadius:11,fontSize:11,color:"var(--text3)",lineHeight:1.6 }}>
              💡 Formats acceptés : JPG, PNG, GIF, WEBP
            </div>
          </div>
        </div>
      )}

      {tab==="categories" && (
        <div className="grid-2">
          {data.categories.map(c => (
            <div key={c.id} className="card card-sm" style={{ display:"flex",alignItems:"center",gap:12,borderColor:`${c.color}22` }}>
              <div style={{ width:40,height:40,borderRadius:11,background:`${c.color}18`,border:`1px solid ${c.color}30`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:20 }}>{c.icon}</div>
              <div style={{ flex:1 }}>
                <div style={{ fontWeight:700,color:c.color }}>{c.name}</div>
                <div style={{ fontSize:10,color:"var(--text3)",marginTop:2 }}>ID: {c.id}</div>
              </div>
              <div style={{ width:14,height:14,borderRadius:"50%",background:c.color,flexShrink:0 }}/>
            </div>
          ))}
        </div>
      )}

      {tab==="account" && (
        <div className="content-grid">
          {/* Partner invite code */}
          <div style={{ display:"flex",flexDirection:"column",gap:16 }}>
            <div className="card" style={{ borderColor:"rgba(167,139,250,0.2)" }}>
              <div style={{ display:"flex",alignItems:"center",gap:10,marginBottom:14 }}>
                <div style={{ width:38,height:38,borderRadius:11,background:"rgba(167,139,250,0.12)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:20 }}>💑</div>
                <div>
                  <div style={{ fontWeight:800,fontSize:14 }}>Code d'invitation partenaire</div>
                  <div style={{ fontSize:11,color:"var(--text3)" }}>Partagez ce code avec votre partenaire pour accéder au même espace</div>
                </div>
              </div>
              {inviteCode ? (
                <div>
                  <div style={{ display:"flex",gap:8,marginBottom:10 }}>
                    <div style={{ flex:1,background:"rgba(167,139,250,0.08)",border:"1px solid rgba(167,139,250,0.3)",borderRadius:12,padding:"14px",textAlign:"center",fontFamily:"'Fraunces',serif",fontSize:28,fontWeight:900,letterSpacing:8,color:"var(--purple)" }}>{inviteCode}</div>
                  </div>
                  <div style={{ display:"flex",gap:8 }}>
                    <button className="btn btn-primary" style={{ flex:1 }} onClick={copyCode}>{codeCopied?"✅ Copié !":"📋 Copier le code"}</button>
                    <button className="btn btn-ghost btn-sm" onClick={genCode} disabled={codeLoading}>🔄</button>
                  </div>
                  <div style={{ fontSize:11,color:"var(--text3)",marginTop:10,lineHeight:1.6 }}>
                    ℹ️ Votre partenaire doit créer un compte via "Rejoindre" et entrer ce code.
                  </div>
                </div>
              ) : (
                <button className="btn btn-primary" style={{ width:"100%" }} onClick={genCode} disabled={codeLoading}>
                  {codeLoading ? "Génération…" : "✨ Générer un code d'invitation"}
                </button>
              )}
            </div>

            {/* Change password */}
            <div className="card">
              <div style={{ display:"flex",alignItems:"center",gap:10,marginBottom:16 }}>
                <div style={{ width:38,height:38,borderRadius:11,background:"rgba(96,165,250,0.12)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:20 }}>🔐</div>
                <div>
                  <div style={{ fontWeight:800,fontSize:14 }}>Changer le mot de passe</div>
                  <div style={{ fontSize:11,color:"var(--text3)" }}>Compte : {user?.email}</div>
                </div>
              </div>
              <div style={{ marginBottom:12 }}>
                <label>Mot de passe actuel</label>
                <input type="password" value={pwdOld} onChange={e=>setPwdOld(e.target.value)} placeholder="••••••••" autoComplete="current-password"/>
              </div>
              <div style={{ marginBottom:8 }}>
                <label>Nouveau mot de passe</label>
                <input type="password" value={pwdNew} onChange={e=>setPwdNew(e.target.value)} placeholder="Minimum 6 caractères" autoComplete="new-password"/>
              </div>
              {pwdNew.length>0 && (
                <div style={{ marginBottom:12 }}>
                  <div className="pwd-strength">{[1,2,3,4,5].map(i => <div key={i} className="pwd-strength-bar" style={{ background:i<=pwdStr.score?pwdStr.color:"rgba(255,255,255,0.07)" }}/>)}</div>
                  {pwdStr.label && <div style={{ fontSize:11,color:pwdStr.color,marginTop:4,textAlign:"right",fontWeight:600 }}>{pwdStr.label}</div>}
                </div>
              )}
              {pwdErr && <div className="alert-banner alert-danger" style={{ marginBottom:12 }}>⚠️ {pwdErr}</div>}
              {pwdOk  && <div className="alert-banner alert-success" style={{ marginBottom:12 }}>✅ Mot de passe modifié avec succès !</div>}
              <button className="btn btn-primary" style={{ width:"100%" }} onClick={changePassword} disabled={pwdLoading||!pwdOld||!pwdNew}>
                {pwdLoading ? "Modification…" : "🔑 Mettre à jour le mot de passe"}
              </button>
            </div>
          </div>

          {/* Account info + Danger zone */}
          <div className="card">
            <div style={{ fontWeight:700,fontSize:13,marginBottom:14 }}>👤 Mon compte</div>
            <div style={{ display:"flex",flexDirection:"column",gap:10,marginBottom:20 }}>
              {[
                { label:"Email",    val:user?.email,       icon:"✉️" },
                { label:"UID",      val:user?.uid?.slice(0,12)+"…", icon:"🔑" },
                { label:"Données",  val:activeUID===user?.uid?"Votre espace":"Espace partagé", icon:"💾" },
              ].map(({ label,val,icon }) => (
                <div key={label} style={{ display:"flex",alignItems:"center",gap:10,padding:"10px 14px",background:"rgba(255,255,255,0.03)",borderRadius:11,border:"1px solid var(--border)" }}>
                  <span style={{ fontSize:16 }}>{icon}</span>
                  <span style={{ fontSize:12,color:"var(--text3)",fontWeight:600,flex:1 }}>{label}</span>
                  <span style={{ fontSize:12,fontWeight:700,color:"var(--text2)",overflow:"hidden",textOverflow:"ellipsis",maxWidth:140 }}>{val}</span>
                </div>
              ))}
            </div>

            {/* ── Zone de danger ── */}
            <div style={{ borderTop:"1px solid rgba(248,113,113,0.18)",paddingTop:18 }}>
              <div style={{ display:"flex",alignItems:"center",gap:7,marginBottom:14 }}>
                <div style={{ width:6,height:6,borderRadius:"50%",background:"var(--red)",boxShadow:"0 0 8px var(--red)",animation:"pulse 2s infinite" }}/>
                <span style={{ fontSize:10,color:"var(--red)",textTransform:"uppercase",letterSpacing:2,fontWeight:900 }}>Zone de danger</span>
              </div>

              {/* Étape 0 — bouton initial */}
              {delStep === 0 && (
                <button onClick={() => setDelStep(1)}
                  style={{ width:"100%",padding:"11px 16px",borderRadius:12,border:"1px solid rgba(248,113,113,0.3)",background:"rgba(248,113,113,0.06)",color:"var(--red)",cursor:"pointer",fontFamily:"'Outfit',sans-serif",fontWeight:700,fontSize:13,display:"flex",alignItems:"center",justifyContent:"center",gap:8,transition:"all .2s" }}
                  onMouseEnter={e=>{e.currentTarget.style.background="rgba(248,113,113,0.14)";e.currentTarget.style.borderColor="rgba(248,113,113,0.5)";}}
                  onMouseLeave={e=>{e.currentTarget.style.background="rgba(248,113,113,0.06)";e.currentTarget.style.borderColor="rgba(248,113,113,0.3)";}}>
                  🗑️ Supprimer mon compte
                </button>
              )}

              {/* Étape 1 — saisie du mot de passe */}
              {delStep === 1 && (
                <div style={{ background:"rgba(248,113,113,0.05)",border:"1px solid rgba(248,113,113,0.2)",borderRadius:14,padding:"16px" }} className="fade-up">
                  <div style={{ fontWeight:800,fontSize:13,color:"var(--red)",marginBottom:6 }}>🔐 Confirmer votre identité</div>
                  <div style={{ fontSize:12,color:"var(--text2)",lineHeight:1.65,marginBottom:14 }}>
                    Saisissez votre mot de passe actuel pour confirmer. La suppression est <strong>irréversible</strong>.
                  </div>
                  <input type="password" value={delPwd} onChange={e=>setDelPwd(e.target.value)}
                    placeholder="Votre mot de passe" autoFocus
                    onKeyDown={e=>e.key==="Enter"&&verifyBeforeDelete()}
                    style={{ marginBottom:10,background:"rgba(248,113,113,0.06)",border:"1px solid rgba(248,113,113,0.25)",borderRadius:11 }}/>
                  {delErr && <div style={{ fontSize:12,color:"var(--red)",fontWeight:700,marginBottom:10 }}>⚠️ {delErr}</div>}
                  <div style={{ display:"flex",gap:8 }}>
                    <button onClick={resetDel} style={{ flex:1,padding:"9px",borderRadius:10,border:"1px solid var(--border)",background:"var(--glass)",color:"var(--text2)",cursor:"pointer",fontFamily:"'Outfit',sans-serif",fontWeight:700,fontSize:13 }}>
                      Annuler
                    </button>
                    <button onClick={verifyBeforeDelete} disabled={delLoading||!delPwd}
                      style={{ flex:1,padding:"9px",borderRadius:10,border:"1px solid rgba(248,113,113,0.4)",background:"rgba(248,113,113,0.15)",color:"var(--red)",cursor:delLoading||!delPwd?"not-allowed":"pointer",fontFamily:"'Outfit',sans-serif",fontWeight:800,fontSize:13,opacity:!delPwd?.5:1 }}>
                      {delLoading?"Vérification…":"Continuer →"}
                    </button>
                  </div>
                </div>
              )}

              {/* Étape 2 — confirmation finale */}
              {delStep === 2 && (
                <div style={{ background:"rgba(248,113,113,0.08)",border:"2px solid rgba(248,113,113,0.4)",borderRadius:14,padding:"18px" }} className="fade-up">
                  <div style={{ fontSize:24,textAlign:"center",marginBottom:10 }}>⚠️</div>
                  <div style={{ fontWeight:900,fontSize:14,color:"var(--red)",textAlign:"center",marginBottom:8 }}>Suppression définitive</div>
                  <div style={{ fontSize:12,color:"var(--text2)",lineHeight:1.7,marginBottom:16,textAlign:"center" }}>
                    Le compte <strong style={{ color:"var(--text)" }}>{user?.email}</strong> et toutes ses données seront <strong>définitivement supprimés</strong>. Cette action est irréversible.
                  </div>
                  {delErr && <div style={{ fontSize:12,color:"var(--red)",fontWeight:700,marginBottom:10,textAlign:"center" }}>⚠️ {delErr}</div>}
                  <div style={{ display:"flex",gap:8 }}>
                    <button onClick={resetDel} style={{ flex:1,padding:"11px",borderRadius:10,border:"1px solid var(--border)",background:"var(--glass)",color:"var(--text2)",cursor:"pointer",fontFamily:"'Outfit',sans-serif",fontWeight:700,fontSize:13 }}>
                      ✋ Annuler
                    </button>
                    <button onClick={doDelete} disabled={delLoading}
                      style={{ flex:1.4,padding:"11px",borderRadius:10,border:"none",background:"linear-gradient(135deg,#f87171,#dc2626)",color:"white",cursor:delLoading?"not-allowed":"pointer",fontFamily:"'Outfit',sans-serif",fontWeight:900,fontSize:13,boxShadow:"0 4px 18px rgba(248,113,113,0.45)",opacity:delLoading?.6:1 }}>
                      {delLoading?"Suppression…":"🗑️ Supprimer définitivement"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


// ═══════════════════════════════════════════════════════════
//  ESSENCE — API Gouvernement prix carburants (data.economie.gouv.fr)
// ═══════════════════════════════════════════════════════════
function EssencePage() {
  const FUEL_META = {
    gazole: { label:"Gazole", icon:"🚛", color:"#fbbf24" },
    sp95:   { label:"SP95",   icon:"⛽", color:"#60a5fa" },
    e10:    { label:"E10",    icon:"🌿", color:"#4ade80" },
    sp98:   { label:"SP98",   icon:"🔵", color:"#a78bfa" },
    e85:    { label:"E85",    icon:"🌽", color:"#34d399" },
    gplc:   { label:"GPL",    icon:"💨", color:"#f87171" },
  };

  const LS_KEY = "duobudget_fuel_v5";

  const [stations, setStations]       = useState([]);
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState("");
  const [lastUpdate, setLastUpdate]   = useState(null);
  const [history, setHistory]         = useState([]);
  const [activeTab, setActiveTab]     = useState("prices");
  const [chartFuel, setChartFuel]     = useState("sp95");
  const [citySearch, setCitySearch]   = useState("Saint-Dizier");
  const [cityInput, setCityInput]     = useState("Saint-Dizier");
  const [countdown, setCountdown]     = useState(600); // 10min in seconds
  const intervalRef = useRef(null);

  // Charger cache
  useEffect(() => {
    try {
      const saved = localStorage.getItem(LS_KEY);
      if (saved) {
        const { stations:s, history:h, city, ts } = JSON.parse(saved);
        if (s) { setStations(s); setLastUpdate(new Date(ts)); }
        if (h) setHistory(h);
        if (city) { setCitySearch(city); setCityInput(city); }
      }
    } catch {}
  }, []);

  // Compte à rebours 10 min
  useEffect(() => {
    const t = setInterval(() => setCountdown(c => c <= 1 ? 600 : c - 1), 1000);
    return () => clearInterval(t);
  }, []);

  const doFetch = useCallback(async (city = citySearch) => {
    setLoading(true); setError(""); setCountdown(600);
    try {
      const BASE = "https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/prix-des-carburants-en-france-flux-instantane-v2/records";
      const isCP = /^\d{5}$/.test(city.trim());

      // ODS v2 ODSQL: string literals MUST use double-quotes, not single-quotes
      // CP search: where=cp="52100"  →  encodeURIComponent gives cp%3D%2252100%22
      // City name: q= parameter (full-text, no ODSQL parsing, no quoting needed)
      let url;
      if (isCP) {
        const w = encodeURIComponent(`cp="${city.trim()}"`);
        url = `${BASE}?where=${w}&limit=30&timezone=Europe%2FParis`;
      } else {
        // q= does full-text search — safe, no wildcards, no quote issues
        url = `${BASE}?q=${encodeURIComponent(city.trim())}&limit=30&timezone=Europe%2FParis`;
      }

      const res = await fetch(url);
      if (!res.ok) throw new Error(`Erreur API ${res.status} — Essayez avec le code postal (ex: 52100)`);
      const json = await res.json();

      // Résultats
      let results = json.results || [];
      if (!results.length) throw new Error(`Aucune station trouvée pour "${city}". Essayez un code postal (ex: 52100) ou un autre nom de ville.`);

      const parsed = results.map(r => {
        const fuels = {};
        Object.keys(FUEL_META).forEach(k => {
          const v = parseFloat(r[k + "_prix"]);
          fuels[k] = isNaN(v) ? null : v;
        });
        return {
          id: r.id || r.adresse,
          nom: r.enseignes?.[0] || r.nom || "Station",
          adresse: [r.adresse, r.ville].filter(Boolean).join(", "),
          cp: r.cp || "",
          ville: r.ville || city,
          ...fuels,
        };
      }).filter(s => Object.keys(FUEL_META).some(k => s[k] != null));

      if (!parsed.length) throw new Error(`Aucun prix disponible pour "${city}".`);

      const ts = new Date().toISOString();
      const tsFmt = new Date().toLocaleDateString("fr-FR",{day:"2-digit",month:"short"}) + " " +
                    new Date().toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"});

      setStations(parsed);
      setLastUpdate(new Date());

      const newEntries = parsed.map(s => ({
        ts, tsFmt, stationId:s.id, stationNom:(s.nom||"Station").slice(0,20),
        ...Object.fromEntries(Object.keys(FUEL_META).map(k=>[k,s[k]])),
      }));
      setHistory(prev => {
        const cutoff = new Date(Date.now() - 86400000*30).toISOString();
        const last10 = new Date(Date.now() - 600000).toISOString();
        const cleaned = prev.filter(e => e.ts >= cutoff && e.ts < last10);
        const next = [...cleaned, ...newEntries].slice(-800);
        try { localStorage.setItem(LS_KEY, JSON.stringify({stations:parsed,history:next,city,ts:Date.now()})); } catch {}
        return next;
      });
    } catch(e) { setError(e.message || "Erreur inconnue"); }
    setLoading(false);
  }, [citySearch]);

  // Auto-refresh toutes les 10 min
  useEffect(() => {
    doFetch(citySearch);
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => doFetch(citySearch), 10 * 60 * 1000);
    return () => clearInterval(intervalRef.current);
  }, [citySearch]);

  const handleSearch = () => {
    const c = cityInput.trim();
    if (!c) return;
    setCitySearch(c);
  };

  // Graphique
  const chartData = useMemo(() => {
    if (!history.length) return [];
    const byTs = {};
    history.forEach(e => {
      if (!byTs[e.ts]) byTs[e.ts] = { ts:e.ts, tsFmt:e.tsFmt };
      if (e[chartFuel] != null) byTs[e.ts][e.stationNom] = e[chartFuel];
    });
    return Object.values(byTs).sort((a,b)=>a.ts.localeCompare(b.ts)).slice(-60);
  }, [history, chartFuel]);

  const chartLines = useMemo(() => {
    const names = new Set();
    chartData.forEach(d => Object.keys(d).filter(k=>k!=="ts"&&k!=="tsFmt").forEach(k=>names.add(k)));
    const COLORS = ["#60a5fa","#f472b6","#4ade80","#fbbf24","#a78bfa","#f87171","#34d399"];
    return [...names].map((n,i) => ({ key:n, color:COLORS[i%COLORS.length] }));
  }, [chartData]);

  const avgPrices = useMemo(() => {
    const res = {};
    Object.keys(FUEL_META).forEach(k => {
      const vals = stations.map(s=>s[k]).filter(v=>v!=null);
      res[k] = vals.length ? vals.reduce((a,b)=>a+b,0)/vals.length : null;
    });
    return res;
  }, [stations]);

  const bestStation = useMemo(() => {
    const res = {};
    Object.keys(FUEL_META).forEach(k => {
      const sorted = stations.filter(s=>s[k]!=null).sort((a,b)=>a[k]-b[k]);
      res[k] = sorted[0] || null;
    });
    return res;
  }, [stations]);

  const fmtUpd = d => d ? d.toLocaleDateString("fr-FR",{day:"2-digit",month:"short"}) + " à " + d.toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"}) : null;
  const mm = String(Math.floor(countdown/60)).padStart(2,"0");
  const ss2 = String(countdown%60).padStart(2,"0");

  const FuelTooltip = ({ active,payload,label }) => {
    if (!active||!payload?.length) return null;
    return <div style={{ background:"var(--card,#1a1635)",border:"1px solid var(--border)",borderRadius:10,padding:"10px 14px",fontSize:12 }}>
      <div style={{ fontWeight:800,marginBottom:6,color:"var(--text2)" }}>{label}</div>
      {payload.map(p=><div key={p.dataKey} style={{ color:p.color,fontWeight:700,marginBottom:3 }}>{p.name}: {p.value?.toFixed(3)} €/L</div>)}
    </div>;
  };

  return (
    <div className="fade-up" style={{ maxWidth:1100,margin:"0 auto" }}>

      {/* ── Header card ── */}
      <div className="card" style={{ marginBottom:16,background:"linear-gradient(135deg,rgba(251,191,36,0.06),rgba(167,139,250,0.04))",borderColor:"rgba(251,191,36,0.15)" }}>
        <div style={{ display:"flex",alignItems:"center",gap:14,flexWrap:"wrap" }}>
          <div style={{ width:54,height:54,borderRadius:17,background:"linear-gradient(135deg,#f59e0b,#fbbf24)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:26,boxShadow:"0 6px 22px rgba(251,191,36,0.4)",flexShrink:0 }}>⛽</div>
          <div style={{ flex:1,minWidth:0 }}>
            <div style={{ fontWeight:900,fontSize:18,marginBottom:2 }}>Prix Carburants</div>
            <div style={{ fontSize:12,color:"var(--text3)",display:"flex",alignItems:"center",gap:8,flexWrap:"wrap" }}>
              {loading ? <><span style={{ color:"var(--yellow)" }}>⟳</span> Actualisation…</>
                : error ? <span style={{ color:"var(--red)" }}>⚠️ Erreur</span>
                : stations.length > 0 ? <><span style={{ color:"var(--green)" }}>✅</span> {stations.length} station{stations.length>1?"s":""} · {fmtUpd(lastUpdate)}</>
                : "En attente…"}
              {!loading && <span style={{ color:"var(--text3)",fontSize:11 }}>· Actualisation dans {mm}:{ss2}</span>}
            </div>
          </div>
          {/* City search */}
          <div style={{ display:"flex",gap:8,alignItems:"center",flex:1,minWidth:220,maxWidth:380 }}>
            <div style={{ flex:1,position:"relative" }}>
              <span style={{ position:"absolute",left:11,top:"50%",transform:"translateY(-50%)",fontSize:14,pointerEvents:"none" }}>🔍</span>
              <input value={cityInput} onChange={e=>setCityInput(e.target.value)}
                onKeyDown={e=>e.key==="Enter"&&handleSearch()}
                placeholder="Code postal (52100) ou ville…"
                style={{ paddingLeft:34,fontSize:13,borderRadius:11,background:"rgba(255,255,255,0.06)",border:"1px solid var(--border)" }}/>
            </div>
            <button className="btn btn-primary" onClick={handleSearch} disabled={loading||!cityInput.trim()} style={{ padding:"10px 16px",fontSize:13,whiteSpace:"nowrap",flexShrink:0 }}>
              Chercher
            </button>
          </div>
          {/* Tabs + refresh */}
          <div style={{ display:"flex",gap:6,alignItems:"center",flexShrink:0 }}>
            {[["prices","💰","Prix"],["chart","📈","Courbes"]].map(([id,ic,lb])=>(
              <button key={id} onClick={()=>setActiveTab(id)}
                style={{ padding:"8px 13px",borderRadius:10,border:activeTab===id?"1px solid rgba(167,139,250,0.5)":"1px solid var(--border)",background:activeTab===id?"rgba(167,139,250,0.15)":"var(--glass)",color:activeTab===id?"var(--purple)":"var(--text2)",cursor:"pointer",fontFamily:"'Outfit',sans-serif",fontWeight:700,fontSize:12 }}>
                {ic} {lb}
              </button>
            ))}
            <button className="btn btn-ghost btn-sm tip" data-tip="Forcer l'actualisation maintenant"
              onClick={()=>doFetch(citySearch)} disabled={loading}
              style={{ padding:"9px 12px" }}>
              {loading?"⟳":"🔄"}
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div style={{ background:"rgba(248,113,113,0.07)",border:"1px solid rgba(248,113,113,0.22)",borderRadius:14,padding:"14px 18px",marginBottom:16 }}>
          <div style={{ fontWeight:800,color:"var(--red)",marginBottom:5 }}>⚠️ {error}</div>
          <div style={{ fontSize:11,color:"var(--text3)" }}>Essayez un autre nom de ville, un code postal, ou vérifiez votre connexion.</div>
        </div>
      )}

      {/* ══ TAB PRIX ══ */}
      {activeTab==="prices" && stations.length>0 && (
        <div>
          {/* Cartes synthèse par carburant */}
          <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(155px,1fr))",gap:12,marginBottom:16 }}>
            {Object.entries(FUEL_META).map(([k,meta])=>{
              const avg = avgPrices[k];
              if (!avg) return null;
              const best = bestStation[k];
              return (
                <div key={k} style={{ background:`linear-gradient(145deg,${meta.color}0a,${meta.color}04)`,border:`1.5px solid ${meta.color}20`,borderRadius:18,padding:"16px 14px",position:"relative",overflow:"hidden" }}>
                  <div style={{ position:"absolute",top:-12,right:-12,fontSize:54,opacity:.06 }}>{meta.icon}</div>
                  <div style={{ display:"flex",alignItems:"center",gap:7,marginBottom:12 }}>
                    <div style={{ width:34,height:34,borderRadius:10,background:`${meta.color}18`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:17 }}>{meta.icon}</div>
                    <span style={{ fontWeight:900,fontSize:14,color:meta.color }}>{meta.label}</span>
                  </div>
                  <div style={{ fontFamily:"'Fraunces',serif",fontSize:28,fontWeight:900,letterSpacing:-.5,marginBottom:3 }}>
                    {avg.toFixed(3)}<span style={{ fontSize:13,fontWeight:400,color:"var(--text3)" }}>€/L</span>
                  </div>
                  <div style={{ fontSize:10,color:"var(--text3)",fontWeight:600 }}>Moy. {stations.length} stations</div>
                  {best && (
                    <div style={{ marginTop:8,paddingTop:8,borderTop:`1px solid ${meta.color}15`,fontSize:10,color:meta.color,fontWeight:700,lineHeight:1.4 }}>
                      📍 {best.nom.slice(0,18)}<br/>
                      <span style={{ fontFamily:"'Fraunces',serif",fontSize:13 }}>{best[k]?.toFixed(3)} €/L</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Tableau stations — coloré, sans colonne Plein 50L */}
          <div style={{ borderRadius:18,overflow:"hidden",border:"1px solid var(--border)",marginBottom:14 }}>
            {/* Header */}
            <div style={{ padding:"14px 20px",background:"rgba(255,255,255,0.03)",borderBottom:"1px solid var(--border)",display:"flex",alignItems:"center",gap:10 }}>
              <div style={{ width:32,height:32,borderRadius:10,background:"rgba(251,191,36,0.14)",border:"1px solid rgba(251,191,36,0.25)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:17 }}>📍</div>
              <div>
                <div style={{ fontWeight:900,fontSize:15 }}>Stations à <span style={{ color:"var(--yellow)" }}>{stations[0]?.ville || citySearch}</span></div>
                <div style={{ fontSize:10,color:"var(--text3)",marginTop:1 }}>Prix en €/L · Données gouvernementales temps réel</div>
              </div>
              <div style={{ marginLeft:"auto",background:"rgba(251,191,36,0.12)",border:"1px solid rgba(251,191,36,0.25)",borderRadius:20,padding:"4px 12px",fontSize:11,color:"var(--yellow)",fontWeight:800,flexShrink:0 }}>
                {stations.length} station{stations.length>1?"s":""}
              </div>
            </div>

            <div style={{ overflowX:"auto" }}>
              <table style={{ width:"100%",borderCollapse:"collapse" }}>
                <thead>
                  <tr style={{ background:"rgba(0,0,0,0.25)" }}>
                    <th style={{ padding:"12px 18px",textAlign:"left",color:"var(--text3)",fontSize:10,textTransform:"uppercase",letterSpacing:1.4,fontWeight:900,whiteSpace:"nowrap" }}>
                      Station / Adresse
                    </th>
                    {Object.entries(FUEL_META).map(([k,m])=>(
                      <th key={k} style={{ padding:"10px 8px",textAlign:"center",minWidth:80 }}>
                        <div style={{ display:"flex",flexDirection:"column",alignItems:"center",gap:3 }}>
                          <div style={{ width:30,height:30,borderRadius:9,background:`${m.color}1a`,border:`1.5px solid ${m.color}35`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16 }}>{m.icon}</div>
                          <span style={{ fontSize:10,color:m.color,fontWeight:900,letterSpacing:.4 }}>{m.label}</span>
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {stations.map((s,i)=>{
                    const isEven = i%2===0;
                    const rowBg = isEven ? "rgba(255,255,255,0.015)" : "transparent";
                    return (
                      <tr key={s.id||i}
                        style={{ borderTop:"1px solid rgba(255,255,255,0.04)",background:rowBg,transition:"all .15s",cursor:"default" }}
                        onMouseEnter={e=>e.currentTarget.style.background="rgba(167,139,250,0.07)"}
                        onMouseLeave={e=>e.currentTarget.style.background=rowBg}>
                        <td style={{ padding:"14px 18px",minWidth:200 }}>
                          <div style={{ display:"flex",alignItems:"center",gap:10 }}>
                            <div style={{ width:38,height:38,borderRadius:11,background:"rgba(251,191,36,0.08)",border:"1px solid rgba(251,191,36,0.18)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,flexShrink:0 }}>⛽</div>
                            <div>
                              <div style={{ fontWeight:800,fontSize:13,marginBottom:2 }}>{s.nom}</div>
                              <div style={{ fontSize:11,color:"var(--text3)" }}>{s.adresse}</div>
                              {s.cp&&<span style={{ display:"inline-block",marginTop:3,fontSize:9,color:"var(--text3)",background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:6,padding:"1px 6px",fontWeight:700 }}>📮 {s.cp}</span>}
                            </div>
                          </div>
                        </td>
                        {Object.entries(FUEL_META).map(([k,m])=>{
                          const isBest = s[k]!=null && s[k]===bestStation[k]?.[k] && stations.filter(x=>x[k]!=null).length>1;
                          return (
                            <td key={k} style={{ padding:"14px 8px",textAlign:"center",verticalAlign:"middle" }}>
                              {s[k]!=null ? (
                                <div style={{ display:"flex",flexDirection:"column",alignItems:"center",gap:3 }}>
                                  <div style={{
                                    fontFamily:"'Fraunces',serif",fontWeight:900,fontSize:16,
                                    color: isBest ? m.color : "var(--text)",
                                    textShadow: isBest ? `0 0 18px ${m.color}70` : "none",
                                  }}>
                                    {s[k].toFixed(3)}
                                  </div>
                                  {isBest && (
                                    <span style={{ fontSize:9,fontWeight:900,color:m.color,background:`${m.color}18`,border:`1px solid ${m.color}35`,borderRadius:6,padding:"1px 6px",whiteSpace:"nowrap" }}>
                                      ✓ Moins cher
                                    </span>
                                  )}
                                </div>
                              ) : (
                                <span style={{ color:"rgba(255,255,255,0.1)",fontSize:20,fontWeight:100 }}>—</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <FuelSimulator stations={stations} avgPrices={avgPrices} FUEL_META={FUEL_META} citySearch={citySearch}/>
        </div>
      )}

      {activeTab==="prices" && !loading && stations.length===0 && !error && (
        <div style={{ textAlign:"center",padding:"60px 20px",color:"var(--text3)" }}>
          <div style={{ fontSize:52,marginBottom:12 }}>⛽</div>
          <div style={{ fontWeight:700,fontSize:15,marginBottom:12 }}>Recherchez une ville pour afficher les prix</div>
        </div>
      )}

      {/* ══ TAB COURBES ══ */}
      {activeTab==="chart" && (
        <div>
          <div style={{ display:"flex",gap:8,marginBottom:16,flexWrap:"wrap" }}>
            <span style={{ fontWeight:700,fontSize:12,color:"var(--text3)",alignSelf:"center" }}>Carburant :</span>
            {Object.entries(FUEL_META).map(([k,m])=>(
              <button key={k} onClick={()=>setChartFuel(k)}
                style={{ padding:"6px 12px",borderRadius:9,border:chartFuel===k?`1px solid ${m.color}`:"1px solid var(--border)",background:chartFuel===k?`${m.color}18`:"var(--glass)",color:chartFuel===k?m.color:"var(--text3)",cursor:"pointer",fontFamily:"'Outfit',sans-serif",fontWeight:700,fontSize:12 }}>
                {m.icon} {m.label}
              </button>
            ))}
          </div>

          <div className="card" style={{ marginBottom:14 }}>
            <div style={{ fontWeight:800,fontSize:14,marginBottom:4 }}>📈 Évolution — {FUEL_META[chartFuel]?.icon} {FUEL_META[chartFuel]?.label} · {citySearch}</div>
            <div style={{ fontSize:11,color:"var(--text3)",marginBottom:16 }}>Actualisation toutes les 10 min · {chartData.length} points enregistrés</div>
            {chartData.length>=2 ? (
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={chartData} margin={{ top:5,right:20,left:0,bottom:5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)"/>
                  <XAxis dataKey="tsFmt" tick={{ fill:"var(--text3)",fontSize:10 }} tickLine={false} axisLine={{ stroke:"var(--border)" }}/>
                  <YAxis domain={["auto","auto"]} tick={{ fill:"var(--text3)",fontSize:10 }} tickLine={false} axisLine={false} tickFormatter={v=>v?.toFixed(3)+"€"}/>
                  <Tooltip content={<FuelTooltip/>}/>
                  <Legend wrapperStyle={{ fontSize:11,paddingTop:10 }}/>
                  {chartLines.map(l=>(
                    <Line key={l.key} type="monotone" dataKey={l.key} stroke={l.color} strokeWidth={2.5}
                      dot={{ r:3,fill:l.color,strokeWidth:0 }} activeDot={{ r:5,strokeWidth:0 }} name={l.key}/>
                  ))}
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div style={{ textAlign:"center",padding:"40px 20px",color:"var(--text3)" }}>
                <div style={{ fontSize:44,marginBottom:10 }}>📊</div>
                <div style={{ fontWeight:700,marginBottom:6 }}>Historique en cours de constitution</div>
                <div style={{ fontSize:12,marginBottom:16,lineHeight:1.6 }}>L'app enregistre les prix toutes les 10 min.<br/>Revenez dans quelques heures pour voir l'évolution !</div>
                <button className="btn btn-primary" onClick={()=>doFetch(citySearch)} disabled={loading}>🔄 Actualiser</button>
              </div>
            )}
          </div>

          {stations.length>0 && avgPrices[chartFuel]!=null && (
            <div className="card">
              <div style={{ fontWeight:800,fontSize:14,marginBottom:14 }}>📊 Comparatif stations — {FUEL_META[chartFuel]?.icon} {FUEL_META[chartFuel]?.label}</div>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={stations.filter(s=>s[chartFuel]!=null).map(s=>({ nom:(s.nom||"Station").slice(0,16),prix:s[chartFuel] }))} margin={{ top:0,right:16,left:0,bottom:0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false}/>
                  <XAxis dataKey="nom" tick={{ fill:"var(--text3)",fontSize:10 }} tickLine={false} axisLine={{ stroke:"var(--border)" }}/>
                  <YAxis domain={["auto","auto"]} tick={{ fill:"var(--text3)",fontSize:10 }} tickLine={false} axisLine={false} tickFormatter={v=>v.toFixed(3)}/>
                  <Tooltip formatter={v=>[v?.toFixed(3)+" €/L","Prix"]} contentStyle={{ background:"var(--card,#1a1635)",border:"1px solid var(--border)",borderRadius:10,fontSize:12 }}/>
                  <Bar dataKey="prix" radius={[8,8,0,0]} fill={FUEL_META[chartFuel]?.color||"#a78bfa"} maxBarSize={80}/>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}

      <div style={{ marginTop:16,padding:"10px 14px",fontSize:11,color:"var(--text3)",textAlign:"center" }}>
        Source : <strong style={{ color:"var(--text2)" }}>data.economie.gouv.fr</strong> — API officielle du gouvernement · Actualisation automatique toutes les 10 min
      </div>
    </div>
  );
}
function FuelSimulator({ stations, avgPrices, FUEL_META, citySearch }) {
  const availableFuels = Object.keys(FUEL_META).filter(k => avgPrices[k] != null || stations.some(s => s[k] != null));
  const [fuel, setFuel]     = useState(availableFuels[0] || "gazole");
  const [liters, setLiters] = useState(50);
  const [stationId, setStationId] = useState("__avg__");

  // Stations that have the selected fuel
  const eligibleStations = stations.filter(s => s[fuel] != null);
  const selectedStation  = stationId === "__avg__" ? null : eligibleStations.find(s => s.id === stationId);
  const price = selectedStation ? selectedStation[fuel] : avgPrices[fuel];

  // Best station for selected fuel
  const bestS = eligibleStations.length > 0
    ? eligibleStations.reduce((a,b) => a[fuel] < b[fuel] ? a : b)
    : null;

  const total   = price != null ? (price * liters)       : null;
  const per100  = price != null ? (price * 6.5)          : null; // 6.5L/100 moyen
  const saving  = (bestS && selectedStation && bestS.id !== selectedStation.id)
    ? ((selectedStation[fuel] - bestS[fuel]) * liters) : null;

  const m = FUEL_META[fuel] || {};

  return (
    <div style={{ borderRadius:18,overflow:"hidden",border:`1px solid ${m.color||"var(--border)"}28`,marginBottom:14,background:"rgba(255,255,255,0.02)" }}>
      {/* Header */}
      <div style={{ padding:"14px 20px",background:`linear-gradient(135deg,${m.color||"#a78bfa"}12,transparent)`,borderBottom:`1px solid ${m.color||"var(--border)"}20`,display:"flex",alignItems:"center",gap:10 }}>
        <div style={{ width:36,height:36,borderRadius:11,background:`${m.color||"#a78bfa"}1a`,border:`1.5px solid ${m.color||"#a78bfa"}35`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:20 }}>🧮</div>
        <div>
          <div style={{ fontWeight:900,fontSize:15 }}>Simulateur de plein</div>
          <div style={{ fontSize:10,color:"var(--text3)",marginTop:1 }}>Estimez le coût de votre plein à {citySearch}</div>
        </div>
      </div>

      <div style={{ padding:"18px 20px",display:"grid",gridTemplateColumns:"1fr 1fr",gap:16 }}>
        {/* LEFT — Controls */}
        <div style={{ display:"flex",flexDirection:"column",gap:14 }}>
          {/* Fuel selector */}
          <div>
            <div style={{ fontSize:10,color:"var(--text3)",textTransform:"uppercase",letterSpacing:1,fontWeight:800,marginBottom:8 }}>Carburant</div>
            <div style={{ display:"flex",gap:6,flexWrap:"wrap" }}>
              {availableFuels.map(k => {
                const fm = FUEL_META[k];
                const sel = fuel === k;
                return (
                  <button key={k} onClick={()=>{ setFuel(k); setStationId("__avg__"); }}
                    style={{ padding:"6px 12px",borderRadius:10,border:sel?`1.5px solid ${fm.color}`:"1px solid var(--border)",
                      background:sel?`${fm.color}1a`:"var(--glass)",color:sel?fm.color:"var(--text3)",
                      cursor:"pointer",fontFamily:"'Outfit',sans-serif",fontWeight:sel?800:600,fontSize:12,
                      transition:"all .15s",boxShadow:sel?`0 0 14px ${fm.color}30`:"none" }}>
                    {fm.icon} {fm.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Station selector */}
          {eligibleStations.length > 0 && (
            <div>
              <div style={{ fontSize:10,color:"var(--text3)",textTransform:"uppercase",letterSpacing:1,fontWeight:800,marginBottom:8 }}>Station</div>
              <select value={stationId} onChange={e=>setStationId(e.target.value)}
                style={{ width:"100%",background:"rgba(255,255,255,0.05)",border:`1px solid ${m.color||"var(--border)"}40`,borderRadius:11,padding:"9px 12px",color:"var(--text)",fontFamily:"'Outfit',sans-serif",fontSize:13,cursor:"pointer" }}>
                <option value="__avg__">📊 Prix moyen ({eligibleStations.length} stations)</option>
                {eligibleStations.map(s=>(
                  <option key={s.id} value={s.id}>
                    {s.nom} — {s[fuel]?.toFixed(3)}€/L{bestS?.id===s.id?" ⭐":""}
                  </option>
                ))}
              </select>
              {bestS && (
                <div style={{ marginTop:6,fontSize:11,color:"var(--green)",fontWeight:700,display:"flex",alignItems:"center",gap:5 }}>
                  <span>⭐</span> Moins cher : {bestS.nom} à <strong>{bestS[fuel]?.toFixed(3)} €/L</strong>
                </div>
              )}
            </div>
          )}

          {/* Liters slider */}
          <div>
            <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8 }}>
              <div style={{ fontSize:10,color:"var(--text3)",textTransform:"uppercase",letterSpacing:1,fontWeight:800 }}>Volume</div>
              <div style={{ fontFamily:"'Fraunces',serif",fontWeight:900,fontSize:18,color:m.color||"var(--purple)" }}>{liters} L</div>
            </div>
            <input type="range" min={5} max={120} step={5} value={liters} onChange={e=>setLiters(+e.target.value)}
              style={{ width:"100%",accentColor:m.color||"var(--purple)",height:5,cursor:"pointer" }}/>
            <div style={{ display:"flex",justifyContent:"space-between",fontSize:10,color:"var(--text3)",marginTop:4 }}>
              <span>5 L</span>
              <div style={{ display:"flex",gap:8 }}>
                {[20,35,50,70].map(v=>(
                  <button key={v} onClick={()=>setLiters(v)}
                    style={{ background:liters===v?`${m.color||"#a78bfa"}22`:"rgba(255,255,255,0.04)",border:`1px solid ${liters===v?(m.color||"#a78bfa")+"44":"rgba(255,255,255,0.08)"}`,
                      borderRadius:7,padding:"2px 8px",fontSize:10,color:liters===v?(m.color||"var(--purple)"):"var(--text3)",
                      cursor:"pointer",fontFamily:"'Outfit',sans-serif",fontWeight:700 }}>
                    {v}L
                  </button>
                ))}
              </div>
              <span>120 L</span>
            </div>
          </div>
        </div>

        {/* RIGHT — Result */}
        <div style={{ display:"flex",flexDirection:"column",justifyContent:"center",alignItems:"center",gap:10,padding:"16px",borderRadius:16,background:`linear-gradient(135deg,${m.color||"#a78bfa"}0e,${m.color||"#a78bfa"}05)`,border:`1px solid ${m.color||"#a78bfa"}20` }}>
          {price != null ? (
            <>
              <div style={{ fontSize:10,color:"var(--text3)",textTransform:"uppercase",letterSpacing:1.2,fontWeight:800 }}>Coût estimé</div>
              <div style={{ fontFamily:"'Fraunces',serif",fontWeight:900,fontSize:52,color:m.color||"var(--purple)",lineHeight:1,textShadow:`0 0 40px ${m.color||"#a78bfa"}50` }}>
                {total?.toFixed(2)}<span style={{ fontSize:28 }}>€</span>
              </div>
              <div style={{ fontSize:12,color:"var(--text3)",textAlign:"center",lineHeight:1.6 }}>
                {liters}L de {m.label} · <strong style={{ color:"var(--text)" }}>{price.toFixed(3)} €/L</strong>
              </div>
              <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,width:"100%",marginTop:4 }}>
                <div style={{ textAlign:"center",padding:"9px",background:"rgba(255,255,255,0.04)",borderRadius:11,border:"1px solid rgba(255,255,255,0.07)" }}>
                  <div style={{ fontSize:9,color:"var(--text3)",fontWeight:800,textTransform:"uppercase",letterSpacing:.8,marginBottom:3 }}>≈ / 100km</div>
                  <div style={{ fontFamily:"'Fraunces',serif",fontWeight:900,fontSize:16,color:"var(--text)" }}>{per100?.toFixed(2)}€</div>
                  <div style={{ fontSize:9,color:"var(--text3)" }}>conso 6.5L</div>
                </div>
                <div style={{ textAlign:"center",padding:"9px",background:"rgba(255,255,255,0.04)",borderRadius:11,border:"1px solid rgba(255,255,255,0.07)" }}>
                  <div style={{ fontSize:9,color:"var(--text3)",fontWeight:800,textTransform:"uppercase",letterSpacing:.8,marginBottom:3 }}>Prix/L</div>
                  <div style={{ fontFamily:"'Fraunces',serif",fontWeight:900,fontSize:16,color:m.color||"var(--purple)" }}>{price.toFixed(3)}€</div>
                  <div style={{ fontSize:9,color:"var(--text3)" }}>à la pompe</div>
                </div>
              </div>
              {saving != null && saving > 0.01 && (
                <div style={{ width:"100%",padding:"7px 12px",background:"rgba(74,222,128,0.08)",border:"1px solid rgba(74,222,128,0.2)",borderRadius:10,fontSize:11,color:"var(--green)",fontWeight:700,textAlign:"center" }}>
                  💸 {fmt(saving)} économisés en allant à {bestS?.nom}
                </div>
              )}
            </>
          ) : (
            <div style={{ textAlign:"center",padding:20 }}>
              <div style={{ fontSize:36,marginBottom:8 }}>{m.icon||"⛽"}</div>
              <div style={{ fontSize:13,color:"var(--text3)",fontWeight:600 }}>Prix {m.label} non disponible<br/>dans cette localisation</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
