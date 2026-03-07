import { useState, useEffect, useCallback, useMemo, useRef, memo, lazy, Suspense, useTransition, useDeferredValue } from "react";
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
const getDocRef = (uid) =\u003e doc(db, "budgets", uid);

const firestoreLoad = async (uid) =\u003e {
  try {
    const snap = await getDoc(getDocRef(uid));
    return snap.exists() ? snap.data().budget : null;
  } catch { return null; }
};

const firestoreSave = async (uid, data) =\u003e {
  try {
    await setDoc(getDocRef(uid), { budget: data, _ts: Date.now() }, { merge: true });
    return true;
  } catch (e) { console.error("Save error", e); return false; }
};

// ═══════════════════════════════════════════════════════════
//  PARTNER LINKING
// ═══════════════════════════════════════════════════════════
const getUserMetaRef = (uid) =\u003e doc(db, "userMeta", uid);
const getInviteRef   = (code) =\u003e doc(db, "inviteCodes", code.toUpperCase());

const generateInviteCode = () =\u003e {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i \u003c 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
};

const saveInviteCode = async (uid, code) =\u003e {
  try { await setDoc(getInviteRef(code), { ownerUID: uid, createdAt: Date.now() }); return true; }
  catch { return false; }
};

const getLinkedUID = async (uid) =\u003e {
  try {
    const snap = await getDoc(getUserMetaRef(uid));
    return snap.exists() ? (snap.data().linkedUID || null) : null;
  } catch { return null; }
};

const setLinkedUID = async (uid, linkedUID) =\u003e {
  try { await setDoc(getUserMetaRef(uid), { linkedUID }, { merge: true }); return true; }
  catch { return false; }
};

const resolveInviteCode = async (code) =\u003e {
  try {
    const snap = await getDoc(getInviteRef(code.trim().toUpperCase()));
    return snap.exists() ? snap.data().ownerUID : null;
  } catch { return null; }
};

// ═══════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════
const nowISO = () =\u003e new Date().toISOString();
const pad = n =\u003e String(n).padStart(2, "0");
const fmtDT = iso =\u003e {
  if (!iso) return "";
  const d = new Date(iso);
  return `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const fmtDate = iso =\u003e {
  if (!iso) return "";
  const d = new Date(iso);
  return `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()}`;
};
const mkid = () =\u003e `${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
const monthKey = (y,m) =\u003e `${y}-${pad(m+1)}`;
const curMonthKey = () =\u003e { const d=new Date(); return monthKey(d.getFullYear(),d.getMonth()); };
const monthLabel = k =\u003e {
  if (!k) return "";
  const [y,m] = k.split("-");
  return new Date(+y,+m-1,1).toLocaleDateString("fr-FR",{month:"long",year:"numeric"});
};
const monthLabelShort = k =\u003e {
  if (!k) return "";
  const [y,m] = k.split("-");
  return new Date(+y,+m-1,1).toLocaleDateString("fr-FR",{month:"short",year:"2-digit"});
};
const fmt = n =\u003e (n||0).toLocaleString("fr-FR",{minimumFractionDigits:0,maximumFractionDigits:2})+" €";
const fmtCompact = n =\u003e {
  if (Math.abs(n) \u003e= 1000) return (n/1000).toLocaleString("fr-FR",{maximumFractionDigits:1})+"k €";
  return fmt(n);
};

// Export CSV
const exportCSV = (transactions, categories, profiles, monthKey) =\u003e {
  const catMap = Object.fromEntries(categories.map(c=\u003e[c.id,c]));
  const profMap = Object.fromEntries(profiles.map(p=\u003e[p.id,p]));
  const header = "Date;Libellé;Montant;Catégorie;Profil;Auto\
";
  const rows = [...transactions]
    .sort((a,b) =\u003e new Date(a.timestamp) - new Date(b.timestamp))
    .map(t =\u003e [
      fmtDT(t.timestamp),
      `"${t.label}"`,
      (t.amount||0).toFixed(2),
      catMap[t.categoryId]?.name || "",
      profMap[t.profileId]?.name || "",
      t.auto ? "Oui" : "Non"
    ].join(";"))
    .join("\
");
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
  (next.bills || []).forEach(bill =\u003e {
    if (!bill.dueDate) return;
    const due = new Date(bill.dueDate);
    if (due \u003e now) return;
    const mk = monthKey(due.getFullYear(), due.getMonth());
    ensureMonth(next, mk);
    const md = next.monthsData[mk];
    if (md.billsProcessed[bill.id]) return;
    md.billsProcessed[bill.id] = nowISO();
    if (!bill.paid) bill.paid = {};
    bill.paid[mk] = true;
    if (bill.amount \u003e 0) {
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
  (next.recurringIncomes || []).forEach(ri =\u003e {
    const start = new Date(ri.startDate || nowISO());
    let cur = new Date(start.getFullYear(), start.getMonth(), 1);
    const endDate = new Date(now.getFullYear(), now.getMonth(), 1);
    while (cur \u003c= endDate) {
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
@import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800;900\u0026family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,700;1,9..144,400\u0026display=swap');
*{box-sizing:border-box;margin:0;padding:0;}
button,a,[role=button]{-webkit-tap-highlight-color:transparent;touch-action:manipulation;}
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
.expense-row{transition:background .22s, border-color .22s, box-shadow .22s;cursor:default;}
.expense-row:hover{background:linear-gradient(135deg,rgba(167,139,250,0.07),rgba(244,114,182,0.04)) !important;border-color:rgba(167,139,250,0.28) !important;box-shadow:0 4px 24px rgba(167,139,250,0.1),inset 0 1px 0 rgba(255,255,255,0.05) !important;}
.expense-row .row-actions{opacity:0;transform:translateX(8px);transition:opacity .2s, transform .2s;}
.expense-row:hover .row-actions{opacity:1;transform:translateX(0);}
/* Badge profil : décoratif seulement, ne doit pas intercepter les clics */
.tx-badge{pointer-events:none;}

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
/* iOS Safari : translateY dans les animations décale les touch targets → désactivé sur touch */
@media(hover:none){
  .fade-up{animation:fadeIn .25s ease both !important;}
  .slide-in{animation:fadeIn .2s ease both !important;}
  .scale-in{animation:fadeIn .2s ease both !important;}
  .float-icon{animation:none !important;}
}

/* ── RECHARTS ── */
.rc-tooltip{background:#1a1635;border:1px solid rgba(255,255,255,0.15);border-radius:12px;padding:10px 14px;font-family:'Outfit',sans-serif;font-size:12px;color:var(--text);box-shadow:0 8px 24px rgba(0,0,0,0.4);}

/* ── RESPONSIVE MOBILE (iPhone-first) ── */
@media(max-width:880px){
  /* Sidebar hidden off-screen, slides in on demand */
  .sidebar{transform:translateX(calc(-1 * var(--sw)));}
  .sidebar.open{transform:translateX(0);}
  .sidebar-overlay.open{display:block;}
  .main-area{margin-left:0 !important;}
  .content-grid{grid-template-columns:1fr !important;}
  .grid-4{grid-template-columns:1fr 1fr !important;}

  /* Page content : bottom padding = tab bar (60px) + safe area + breathing room */
  .page-content{
    padding:14px;
    padding-top:16px;
    padding-bottom:calc(68px + env(safe-area-inset-bottom));
    padding-left:calc(14px + env(safe-area-inset-left));
    padding-right:calc(14px + env(safe-area-inset-right));
    overflow-x:hidden;
  }

  /* ── TAB BAR ── */
  .bottom-nav{
    display:flex;
    position:fixed;
    bottom:0; left:0; right:0;
    /* Solid background, no blur (fixes iOS repaint glitch) */
    background:#0a0818;
    border-top:1px solid rgba(255,255,255,0.09);
    justify-content:space-around;
    align-items:flex-start;
    /* 60px content zone + safe area padding below */
    padding-top:10px;
    padding-bottom:env(safe-area-inset-bottom);
    padding-left:env(safe-area-inset-left);
    padding-right:env(safe-area-inset-right);
    z-index:250;
    /* Fixed total height so content never overlaps */
    height:calc(60px + env(safe-area-inset-bottom));
  }

  /* ── TAB ITEM ── */
  .bnav-item{
    display:flex;
    flex-direction:column;
    align-items:center;
    justify-content:flex-start;
    gap:2px;
    /* Minimum 44×44pt touch target (Apple HIG) */
    min-width:52px;
    min-height:44px;
    padding:2px 6px 0;
    border-radius:0;
    cursor:pointer;
    font-size:10px;
    font-weight:700;
    color:rgba(237,233,248,0.35);
    letter-spacing:0.2px;
    position:relative;
    -webkit-tap-highlight-color:transparent;
    touch-action:manipulation;
    user-select:none;
    /* Smooth color transition only (no transform = no tap-target offset bug) */
    transition:color .15s;
  }
  .bnav-item.active{ color:var(--purple); }
  .bnav-icon-wrap{
    width:44px; height:32px;
    display:flex; align-items:center; justify-content:center;
    border-radius:12px;
    transition:background .15s;
  }
  .bnav-item.active .bnav-icon-wrap{
    background:rgba(167,139,250,0.15);
  }
  .bnav-icon{ font-size:24px; line-height:1; }
  /* Active pill under icon */
  .bnav-item.active::before{
    content:'';
    position:absolute;
    top:0; left:50%;
    transform:translateX(-50%);
    width:32px; height:3px;
    border-radius:0 0 3px 3px;
    background:var(--purple);
  }

  /* ── TOPBAR ── */
  .topbar{
    height:calc(52px + env(safe-area-inset-top)) !important;
    padding-top:calc(8px + env(safe-area-inset-top)) !important;
    padding-left:calc(14px + env(safe-area-inset-left));
    padding-right:calc(14px + env(safe-area-inset-right));
    padding-bottom:8px;
  }
  .topbar-clock{ display:none; }
  /* Month selector chip in topbar (mobile only, injected via .topbar-month) */
  .topbar-month{
    display:flex !important;
    align-items:center;
    gap:5px;
    background:rgba(167,139,250,0.10);
    border:1px solid rgba(167,139,250,0.25);
    border-radius:20px;
    padding:5px 12px;
    font-size:12px;
    font-weight:800;
    color:var(--purple);
    cursor:pointer;
    white-space:nowrap;
    -webkit-tap-highlight-color:transparent;
  }
  .topbar-month select{
    background:transparent;
    border:none;
    color:var(--purple);
    font-family:'Outfit',sans-serif;
    font-size:12px;
    font-weight:800;
    padding:0;
    outline:none;
    cursor:pointer;
    -webkit-appearance:none;
    max-width:120px;
  }

  /* ── MORE SHEET (slide up) ── */
  .more-sheet-overlay{
    position:fixed; inset:0;
    background:rgba(0,0,0,0.6);
    backdrop-filter:blur(8px);
    -webkit-backdrop-filter:blur(8px);
    z-index:400;
  }
  .more-sheet{
    position:fixed;
    left:0; right:0; bottom:0;
    background:linear-gradient(180deg,#100e22,#0a0818);
    border-top:1px solid rgba(255,255,255,0.12);
    border-radius:24px 24px 0 0;
    padding:0 0 env(safe-area-inset-bottom);
    z-index:401;
    /* Slide up animation */
    animation:sheetUp .28s cubic-bezier(.32,1.25,.64,1) both;
  }
  @keyframes sheetUp{
    from{transform:translateY(100%)}
    to{transform:translateY(0)}
  }
  .more-sheet-handle{
    width:36px; height:4px;
    background:rgba(255,255,255,0.2);
    border-radius:2px;
    margin:12px auto 4px;
  }
  .more-sheet-title{
    font-size:11px; font-weight:900;
    letter-spacing:1.5px; text-transform:uppercase;
    color:rgba(237,233,248,0.35);
    padding:8px 20px 10px;
  }
  .more-sheet-row{
    display:flex; align-items:center; gap:14px;
    padding:14px 20px;
    border-top:1px solid rgba(255,255,255,0.05);
    font-size:15px; font-weight:700;
    color:var(--text);
    cursor:pointer;
    -webkit-tap-highlight-color:transparent;
    touch-action:manipulation;
    transition:background .15s;
  }
  .more-sheet-row:active{ background:rgba(255,255,255,0.05); }
  .more-sheet-icon{
    width:42px; height:42px;
    border-radius:13px;
    display:flex; align-items:center; justify-content:center;
    font-size:20px; flex-shrink:0;
  }
  .more-sheet-sep{
    height:8px;
    background:rgba(255,255,255,0.025);
    margin:4px 0;
  }
  .more-month-row{
    padding:12px 20px 4px;
  }
  .more-month-label{
    font-size:11px;font-weight:800;color:rgba(237,233,248,0.4);
    text-transform:uppercase;letter-spacing:1.2px;margin-bottom:6px;
  }
  .more-month-select{
    background:rgba(167,139,250,0.08);
    border:1px solid rgba(167,139,250,0.2);
    border-radius:12px;
    color:var(--text);
    padding:10px 14px;
    font-size:14px;font-weight:700;
    width:100%;
    font-family:'Outfit',sans-serif;
    outline:none;
  }

  /* ── EXPENSE ROW ── */
  .expense-row{
    padding:12px 14px !important;
    display:grid !important;
    grid-template-columns:auto 1fr auto !important;
    grid-template-rows:auto auto !important;
    gap:0 !important;
    align-items:center !important;
    column-gap:12px !important;
  }
  .expense-row .tx-icon-wrap{ grid-column:1; grid-row:1/3; align-self:center; overflow:visible; }
  .expense-row .tx-icon-wrap .tx-icon{ width:44px !important;height:44px !important;font-size:21px !important;border-radius:13px !important;box-shadow:none !important; }
  .expense-row .tx-icon-wrap .tx-badge{ width:18px !important;height:18px !important;font-size:10px !important;bottom:-3px !important;right:-3px !important;border-width:2px !important; }
  .expense-row .tx-text-col{ grid-column:2; grid-row:1; min-width:0; }
  .expense-row .tx-amount-col{ grid-column:3; grid-row:1; text-align:right; flex-shrink:0; }
  .expense-row .tx-amount-col \u003e div{ font-size:16px !important; }
  .expense-row .row-actions{ grid-column:2/4; grid-row:2; opacity:1 !important;transform:none !important;flex-direction:row !important;margin-top:8px;gap:6px !important;flex-wrap:nowrap; }
  .expense-row .row-actions .action-btn{ flex:1;justify-content:center;padding:8px 4px !important;font-size:11px !important;min-width:0;min-height:40px; }
  .expense-row .tx-badges-row{ display:flex;gap:4px;flex-wrap:nowrap;overflow:hidden; }
  .expense-row .tx-badges-row .tx-badge-cat{ font-size:11px !important;padding:3px 8px !important; }
  .expense-row .tx-badges-row .tx-badge-prof{ display:none !important; }
  .expense-row .tx-badges-row .tx-badge-date{ font-size:10px !important;padding:3px 7px !important; }
  .expense-row .tx-bar-row{ display:none !important; }
  .expense-row:hover{ transform:none !important;padding-left:14px !important; }
  .tip::after,.tip::before{ display:none !important; }

  /* KPI / toolbar */
  .expenses-kpi-bar{ grid-template-columns:1fr 1fr !important; }
  .expenses-kpi-bar \u003e div{ padding:12px 14px !important; }
  .expenses-kpi-bar .stat-num{ font-size:15px !important; }
  .expenses-toolbar{ flex-direction:column !important;gap:8px !important;padding:10px 12px !important; }
  .expenses-toolbar .toolbar-selects{ display:flex;gap:8px;width:100%; }
  .expenses-toolbar .toolbar-selects \u003e *{ flex:1; }
  .expenses-toolbar .toolbar-btns{ display:flex;gap:6px;width:100%; }
  .expenses-toolbar .toolbar-btns \u003e button{ flex:1;justify-content:center;font-size:11.5px !important;padding:9px 6px !important;min-height:44px; }

  /* Other sections */
  .income-card .stat-num{ font-size:22px !important; }
  .bill-hover-actions{ opacity:1 !important;transform:translateX(0) !important; }
  .profile-cards-grid{ grid-template-columns:1fr !important; }
  .stat-kpi-card{ padding:16px !important; }
  .stat-num{ font-size:clamp(18px,4vw,28px); }
}

@media(max-width:520px){
  .grid-2{ grid-template-columns:1fr !important; }
  .grid-3{ grid-template-columns:1fr 1fr !important; }
  .grid-4{ grid-template-columns:1fr 1fr !important; }
  .modal-box{ padding:20px;border-radius:20px; }
  .profile-card{ margin-bottom:2px; }
  .btn{ min-height:44px; }
  .nav-item{ min-height:46px; }
  .filter-chip{ padding:9px 14px !important;font-size:12.5px !important; }
  .fuel-sim-grid{ grid-template-columns:1fr !important; }
  .fuel-best-grid{ grid-template-columns:1fr 1fr !important;gap:10px !important; }
  .station-table-wrap{ overflow-x:auto;-webkit-overflow-scrolling:touch; }
  .expense-row .tx-title{ max-width:130px !important; }
}

@media(hover:none){
  .gtip{ display:none !important; }
}
@supports(padding-top:env(safe-area-inset-top)){
  .app-shell{ padding-top:0; }
  .auth-shell{ padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom); }
}

/* ── STANDALONE PWA — "Ajouter à l'écran d'accueil" iOS ── */
@media(display-mode:standalone){
  .topbar{
    height:calc(52px + env(safe-area-inset-top)) !important;
    padding-top:calc(8px + env(safe-area-inset-top)) !important;
    padding-left:calc(14px + env(safe-area-inset-left)) !important;
    padding-right:calc(14px + env(safe-area-inset-right)) !important;
    padding-bottom:8px !important;
  }
  .bottom-nav{
    height:calc(60px + env(safe-area-inset-bottom)) !important;
    padding-top:10px !important;
    padding-bottom:env(safe-area-inset-bottom) !important;
    align-items:flex-start !important;
  }
  .bnav-item{
    padding-top:2px !important;
    justify-content:flex-start !important;
  }
  .page-content{
    padding-bottom:calc(68px + env(safe-area-inset-bottom)) !important;
  }
}
`;

// ═══════════════════════════════════════════════════════════
//  GLOBAL TOOLTIP — desktop only, never on touch devices
// ═══════════════════════════════════════════════════════════
const isTouchDevice = () =\u003e window.matchMedia('(hover:none)').matches || ('ontouchstart' in window);

function GlobalTooltip() {
  const [tip, setTip] = useState(null);
  useEffect(() =\u003e {
    // Completely skip on touch/mobile — prevents freeze + misclick
    if (isTouchDevice()) return;
    let timer;
    const show = (e) =\u003e {
      const el = e.target.closest('[data-tip]');
      if (!el) return;
      clearTimeout(timer);
      timer = setTimeout(() =\u003e {
        const rect = el.getBoundingClientRect();
        const TIP_H = 38, TIP_W = 240, GAP = 10;
        const canAbove = rect.top - TIP_H - GAP \u003e 0;
        const canBelow = rect.bottom + TIP_H + GAP \u003c window.innerHeight;
        const below = !canAbove || (!canAbove \u0026\u0026 canBelow);
        let x = rect.left + rect.width / 2;
        x = Math.max(TIP_W / 2 + 6, Math.min(window.innerWidth - TIP_W / 2 - 6, x));
        setTip({ text: el.dataset.tip, x, y: below ? rect.bottom + GAP : rect.top - GAP, below });
      }, 120);
    };
    const hide = () =\u003e { clearTimeout(timer); setTip(null); };
    document.addEventListener('mouseover', show, { passive: true, capture: true });
    document.addEventListener('mouseout',  hide,  { passive: true, capture: true });
    document.addEventListener('scroll',    hide,  { passive: true });
    document.addEventListener('click',     hide,  { passive: true });
    return () =\u003e {
      clearTimeout(timer);
      document.removeEventListener('mouseover', show, true);
      document.removeEventListener('mouseout',  hide, true);
      document.removeEventListener('scroll',    hide);
      document.removeEventListener('click',     hide);
    };
  }, []);
  if (!tip) return null;
  return (
    \u003cdiv className={`gtip ${tip.below ? 'tip-below' : 'tip-above'}`}
      style={{ position:'fixed', left:tip.x, transform:'translateX(-50%)', zIndex:999999, pointerEvents:'none',
        ...(tip.below ? { top:tip.y } : { bottom:`calc(100vh - ${tip.y}px)` }) }}\u003e
      {tip.text}
    \u003c/div\u003e
  );
}

// ═══════════════════════════════════════════════════════════
//  FAVICON — SVG emoji injected dynamically
// ═══════════════════════════════════════════════════════════
// Hook mobile — détecte correctement iOS même sans meta viewport (innerWidth peut être 980 par défaut)
function useIsMobile() {
  const [mob, setMob] = useState(() =\u003e {
    // iOS sans meta viewport reporte innerWidth=980 → utiliser screen.width + ontouchstart
    const byWidth = Math.min(window.innerWidth, window.screen.width) \u003c= 880;
    const byTouch = 'ontouchstart' in window || navigator.maxTouchPoints \u003e 0;
    return byWidth || byTouch;
  });
  useEffect(() =\u003e {
    const check = () =\u003e {
      const byWidth = Math.min(window.innerWidth, window.screen.width) \u003c= 880;
      const byTouch = 'ontouchstart' in window || navigator.maxTouchPoints \u003e 0;
      setMob(byWidth || byTouch);
    };
    const mq = window.matchMedia('(max-width:880px)');
    mq.addEventListener('change', check);
    window.addEventListener('resize', check, { passive: true });
    return () =\u003e { mq.removeEventListener('change', check); window.removeEventListener('resize', check); };
  }, []);
  return mob;
}

function useFavicon() {
  useEffect(() =\u003e {
    const svg = `\u003csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"\u003e\u003cdefs\u003e\u003clinearGradient id="g" x1="0" y1="0" x2="1" y2="1"\u003e\u003cstop offset="0%" stop-color="%23a78bfa"/\u003e\u003cstop offset="100%" stop-color="%23f472b6"/\u003e\u003c/linearGradient\u003e\u003c/defs\u003e\u003crect width="100" height="100" rx="22" fill="url(%23g)"/\u003e\u003ctext y=".9em" font-size="72" x="12"\u003e💑\u003c/text\u003e\u003c/svg\u003e`;
    const link = document.querySelector("link[rel~='icon']") || Object.assign(document.createElement('link'), { rel: 'icon' });
    link.href = `data:image/svg+xml,${svg}`;
    link.type = 'image/svg+xml';
    document.head.appendChild(link);
    document.title = "DuoBudget 💑";
    // Fix mobile viewport - prevent unwanted zoom
    let vp = document.querySelector('meta[name="viewport"]');
    if (!vp) {
      vp = document.createElement('meta');
      vp.name = 'viewport';
      document.head.appendChild(vp);
    }
    vp.content = 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no';

    // ── PWA meta tags — safe-area correct en mode standalone (Add to Home Screen iOS) ──
    [
      ['apple-mobile-web-app-capable',          'yes'],
      ['mobile-web-app-capable',                'yes'],
      ['apple-mobile-web-app-status-bar-style', 'black-translucent'],
    ].forEach(([name, content]) => {
      let mt = document.querySelector(`meta[name="${name}"]`);
      if (!mt) { mt = document.createElement('meta'); mt.name = name; document.head.appendChild(mt); }
      mt.content = content;
    });
  }, []);
}

function getPasswordStrength(pwd) {
  if (!pwd) return { score: 0, label: "", color: "transparent" };
  let score = 0;
  if (pwd.length \u003e= 6)  score++;
  if (pwd.length \u003e= 10) score++;
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

  const switchView = (v) =\u003e { setView(v); setError(""); setInfo(""); setResetSent(false); setPassword(""); setInviteCode(""); setShowPwd(false); setTimeout(() =\u003e emailRef.current?.focus(), 80); };
  useEffect(() =\u003e { emailRef.current?.focus(); }, []);

  const AUTH_ERRORS = {
    "auth/invalid-email":"Adresse email invalide.","auth/user-not-found":"Aucun compte associé à cet email.",
    "auth/wrong-password":"Mot de passe incorrect.","auth/email-already-in-use":"Cette adresse est déjà utilisée.",
    "auth/weak-password":"Mot de passe trop court (6 caractères min).","auth/invalid-credential":"Email ou mot de passe incorrect.",
    "auth/too-many-requests":"Trop de tentatives. Veuillez patienter.","auth/network-request-failed":"Erreur réseau. Vérifiez votre connexion.",
  };

  const submit = async () =\u003e {
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

  const sendReset = async () =\u003e {
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
    \u003cdiv className="auth-shell"\u003e\u003cstyle\u003e{CSS}\u003c/style\u003e
      \u003cdiv className="auth-card scale-in" style={{ maxWidth:400 }}\u003e
        \u003cbutton className="reset-back-btn" onClick={() =\u003e switchView("login")}\u003e← Retour à la connexion\u003c/button\u003e
        {resetSent ? (
          \u003cdiv style={{ textAlign:"center",padding:"10px 0 20px" }} className="fade-up"\u003e
            \u003cdiv style={{ width:80,height:80,borderRadius:"50%",background:"radial-gradient(circle,rgba(74,222,128,0.2),rgba(74,222,128,0.05))",border:"2px solid rgba(74,222,128,0.4)",display:"flex",alignItems:"center",justifyContent:"center",boxShadow:"0 0 30px rgba(74,222,128,0.2)",margin:"0 auto 24px",animation:"scaleIn .4s cubic-bezier(.34,1.56,.64,1) both" }}\u003e
              \u003csvg width="36" height="36" viewBox="0 0 36 36" fill="none"\u003e\u003cpath className="check-anim" d="M8 18l7 7 13-13" stroke="#4ade80" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/\u003e\u003c/svg\u003e
            \u003c/div\u003e
            \u003cdiv style={{ fontFamily:"'Fraunces',serif",fontSize:24,fontWeight:700,marginBottom:10 }}\u003eEmail envoyé !\u003c/div\u003e
            \u003cp style={{ fontSize:14,color:"var(--text2)",lineHeight:1.6,marginBottom:6 }}\u003eUn lien de réinitialisation a été envoyé à\u003c/p\u003e
            \u003cdiv style={{ display:"inline-block",background:"rgba(167,139,250,0.1)",border:"1px solid rgba(167,139,250,0.3)",borderRadius:10,padding:"6px 14px",fontSize:13,fontWeight:700,color:"var(--purple)",marginBottom:20 }}\u003e{email}\u003c/div\u003e
            \u003cp style={{ fontSize:12,color:"var(--text3)",lineHeight:1.6,marginBottom:20 }}\u003eVérifiez vos spams si vous ne le voyez pas sous 5 minutes.\u003c/p\u003e
            \u003cbutton className="btn btn-primary" onClick={() =\u003e switchView("login")} style={{ width:"100%",justifyContent:"center",padding:"13px",fontSize:14 }}\u003e🔑 Retour à la connexion\u003c/button\u003e
          \u003c/div\u003e
        ) : (
          \u003c\u003e
            \u003cdiv style={{ textAlign:"center",marginBottom:28 }}\u003e
              \u003cdiv style={{ width:64,height:64,borderRadius:20,margin:"0 auto 16px",background:"linear-gradient(135deg,rgba(167,139,250,0.2),rgba(244,114,182,0.2))",border:"1px solid rgba(167,139,250,0.3)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:28 }}\u003e🔐\u003c/div\u003e
              \u003cdiv style={{ fontFamily:"'Fraunces',serif",fontSize:24,fontWeight:700,marginBottom:8 }}\u003eRéinitialiser\u003c/div\u003e
              \u003cp style={{ fontSize:13,color:"var(--text2)",lineHeight:1.6 }}\u003eEntrez votre email pour recevoir un lien de réinitialisation DuoBudget.\u003c/p\u003e
            \u003c/div\u003e
            \u003cdiv className="auth-field"\u003e
              \u003clabel\u003eAdresse email\u003c/label\u003e\u003cspan className="field-icon"\u003e✉️\u003c/span\u003e
              \u003cinput ref={emailRef} type="email" value={email} onChange={e =\u003e setEmail(e.target.value)} placeholder="vous@email.com" onKeyDown={e =\u003e e.key==="Enter" \u0026\u0026 sendReset()}/\u003e
            \u003c/div\u003e
            {error \u0026\u0026 \u003cdiv className="alert-banner alert-danger" style={{ marginBottom:16 }}\u003e⚠️ {error}\u003c/div\u003e}
            \u003cbutton className="btn btn-primary" onClick={sendReset} disabled={loading||!email.trim()} style={{ width:"100%",justifyContent:"center",padding:"14px",fontSize:15,marginTop:4 }}\u003e
              {loading ? \u003c\u003e\u003cspan className="spin" style={{ display:"inline-block",fontSize:16 }}\u003e⟳\u003c/span\u003e Envoi…\u003c/\u003e : "📨 Envoyer le lien"}
            \u003c/button\u003e
          \u003c/\u003e
        )}
      \u003c/div\u003e
    \u003c/div\u003e
  );

  const tabs = [
    { id:"login",    icon:"🔑", label:"Connexion" },
    { id:"register", icon:"✨", label:"Créer un compte" },
    { id:"join",     icon:"💑", label:"Rejoindre" },
  ];

  return (
    \u003cdiv className="auth-shell"\u003e\u003cstyle\u003e{CSS}\u003c/style\u003e
      \u003cdiv className="auth-card scale-in"\u003e
        {/* Header */}
        \u003cdiv style={{ textAlign:"center",marginBottom:26 }}\u003e
          \u003cdiv style={{ width:72,height:72,borderRadius:22,margin:"0 auto 16px",background:"var(--grad-main)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:32,boxShadow:"0 8px 32px rgba(167,139,250,0.4),0 0 0 1px rgba(255,255,255,0.08)",animation:"float 3s ease-in-out infinite" }}\u003e💑\u003c/div\u003e
          \u003cdiv className="glow-text" style={{ fontFamily:"'Fraunces',serif",fontSize:32,fontWeight:700,lineHeight:1 }}\u003eDuoBudget\u003c/div\u003e
          \u003cdiv style={{ fontSize:11,color:"var(--text3)",marginTop:5,letterSpacing:1.2,textTransform:"uppercase",fontWeight:600 }}\u003eFinance à deux\u003c/div\u003e
        \u003c/div\u003e

        {/* Tab bar */}
        \u003cdiv style={{ display:"flex",gap:3,marginBottom:24,background:"rgba(255,255,255,0.04)",borderRadius:14,padding:4 }}\u003e
          {tabs.map(({ id,icon,label }) =\u003e (
            \u003cbutton key={id} onClick={() =\u003e switchView(id)} style={{ flex:1,padding:"9px 6px",borderRadius:11,border:"none",cursor:"pointer",background:view===id?"var(--grad-main)":"transparent",color:view===id?"white":"var(--text3)",fontFamily:"'Outfit',sans-serif",fontWeight:700,fontSize:11,transition:"all .25s",display:"flex",alignItems:"center",justifyContent:"center",gap:4,boxShadow:view===id?"0 4px 14px rgba(167,139,250,0.35)":"none" }}\u003e
              \u003cspan style={{ fontSize:14 }}\u003e{icon}\u003c/span\u003e
              \u003cspan style={{ whiteSpace:"nowrap" }}\u003e{label}\u003c/span\u003e
            \u003c/button\u003e
          ))}
        \u003c/div\u003e

        {/* Join explanation */}
        {view === "join" \u0026\u0026 (
          \u003cdiv style={{ background:"rgba(167,139,250,0.07)",border:"1px solid rgba(167,139,250,0.2)",borderRadius:14,padding:"12px 16px",marginBottom:18,fontSize:12,color:"var(--text2)",lineHeight:1.6 }}\u003e
            💑 \u003cstrong style={{ color:"var(--purple)" }}\u003eRejoindre un espace partagé\u003c/strong\u003e\u003cbr/\u003e
            Votre partenaire doit partager son \u003cstrong\u003ecode d'invitation\u003c/strong\u003e depuis Réglages → Compte. Entrez-le ci-dessous pour accéder aux mêmes données.
          \u003c/div\u003e
        )}

        {/* Email field */}
        \u003cdiv className="auth-field"\u003e
          \u003clabel\u003e{view==="join"?"Votre adresse email":"Adresse email"}\u003c/label\u003e
          \u003cspan className="field-icon"\u003e✉️\u003c/span\u003e
          \u003cinput ref={emailRef} type="email" value={email} onChange={e =\u003e setEmail(e.target.value)} placeholder="vous@email.com" autoComplete="email" onKeyDown={e =\u003e e.key==="Enter" \u0026\u0026 submit()}/\u003e
        \u003c/div\u003e

        {/* Password field */}
        \u003cdiv className="auth-field" style={{ marginBottom:view!=="login"?6:4 }}\u003e
          \u003clabel\u003eMot de passe\u003c/label\u003e\u003cspan className="field-icon"\u003e🔒\u003c/span\u003e
          \u003cinput type={showPwd?"text":"password"} value={password} onChange={e =\u003e setPassword(e.target.value)} placeholder={view==="login"?"••••••••":"Minimum 6 caractères"} autoComplete={view==="login"?"current-password":"new-password"} onKeyDown={e =\u003e e.key==="Enter" \u0026\u0026 submit()} style={{ paddingRight:44 }}/\u003e
          \u003cbutton className="eye-btn" onClick={() =\u003e setShowPwd(v =\u003e !v)} type="button" tabIndex={-1}\u003e{showPwd?"🙈":"👁️"}\u003c/button\u003e
        \u003c/div\u003e

        {/* Password strength */}
        {view !== "login" \u0026\u0026 password.length\u003e0 \u0026\u0026 (
          \u003cdiv style={{ marginBottom:14 }}\u003e
            \u003cdiv className="pwd-strength"\u003e{[1,2,3,4,5].map(i =\u003e \u003cdiv key={i} className="pwd-strength-bar" style={{ background:i\u003c=pwdStrength.score?pwdStrength.color:"rgba(255,255,255,0.07)" }}/\u003e)}\u003c/div\u003e
            {pwdStrength.label \u0026\u0026 \u003cdiv style={{ fontSize:11,color:pwdStrength.color,marginTop:4,fontWeight:600,textAlign:"right" }}\u003e{pwdStrength.label}\u003c/div\u003e}
          \u003c/div\u003e
        )}

        {/* Invite code for join */}
        {view === "join" \u0026\u0026 (
          \u003cdiv className="auth-field"\u003e
            \u003clabel\u003eCode d'invitation partenaire\u003c/label\u003e
            \u003cspan className="field-icon"\u003e🔗\u003c/span\u003e
            \u003cinput value={inviteCode} onChange={e =\u003e setInviteCode(e.target.value.toUpperCase())} placeholder="Ex: AB3XK7" maxLength={6} style={{ letterSpacing:4,fontWeight:800,fontSize:18,textAlign:"center",textTransform:"uppercase" }} onKeyDown={e =\u003e e.key==="Enter" \u0026\u0026 submit()}/\u003e
          \u003c/div\u003e
        )}

        {/* Forgot password */}
        {view==="login" \u0026\u0026 \u003cdiv style={{ textAlign:"right",marginBottom:18,marginTop:4 }}\u003e\u003cbutton onClick={() =\u003e switchView("reset")} style={{ background:"none",border:"none",color:"var(--purple)",cursor:"pointer",fontFamily:"'Outfit',sans-serif",fontSize:12,fontWeight:600,padding:0 }}\u003eMot de passe oublié ?\u003c/button\u003e\u003c/div\u003e}

        {/* Errors/Info */}
        {error === "already-in-use" ? (
          \u003cdiv style={{ marginBottom:14,background:"rgba(251,191,36,0.08)",border:"1px solid rgba(251,191,36,0.3)",borderRadius:13,padding:"14px 16px" }}\u003e
            \u003cdiv style={{ fontWeight:800,color:"var(--yellow)",fontSize:13,marginBottom:8 }}\u003e⚠️ Cette adresse est déjà associée à un compte\u003c/div\u003e
            \u003cdiv style={{ fontSize:12,color:"var(--text2)",lineHeight:1.6,marginBottom:12 }}\u003e
              Un compte existe déjà avec \u003cstrong\u003e{email}\u003c/strong\u003e. Connectez-vous directement, ou réinitialisez votre mot de passe si vous l'avez oublié.
            \u003c/div\u003e
            \u003cdiv style={{ display:"flex",gap:8 }}\u003e
              \u003cbutton onClick={() =\u003e switchView("login")} style={{ flex:1,padding:"9px 10px",borderRadius:10,border:"1px solid rgba(167,139,250,0.4)",background:"rgba(167,139,250,0.12)",color:"var(--purple)",cursor:"pointer",fontFamily:"'Outfit',sans-serif",fontWeight:700,fontSize:12 }}\u003e
                🔑 Se connecter
              \u003c/button\u003e
              \u003cbutton onClick={() =\u003e switchView("reset")} style={{ flex:1,padding:"9px 10px",borderRadius:10,border:"1px solid rgba(251,191,36,0.3)",background:"rgba(251,191,36,0.08)",color:"var(--yellow)",cursor:"pointer",fontFamily:"'Outfit',sans-serif",fontWeight:700,fontSize:12 }}\u003e
                🔐 Mot de passe oublié
              \u003c/button\u003e
            \u003c/div\u003e
          \u003c/div\u003e
        ) : error ? (
          \u003cdiv className="alert-banner alert-danger" style={{ marginBottom:14 }}\u003e⚠️ {error}\u003c/div\u003e
        ) : null}
        {info  \u0026\u0026 \u003cdiv className="alert-banner alert-success" style={{ marginBottom:14 }}\u003e✅ {info}\u003c/div\u003e}

        {/* Submit */}
        \u003cbutton className="btn btn-primary" onClick={submit} disabled={loading||!email||!password||(view!=="login"\u0026\u0026pwdStrength.score\u003c1)} style={{ width:"100%",justifyContent:"center",padding:"14px",fontSize:15 }}\u003e
          {loading ? \u003c\u003e\u003cspan className="spin" style={{ display:"inline-block",fontSize:16 }}\u003e⟳\u003c/span\u003e En cours…\u003c/\u003e :
            view==="login"  ? "🔑 Se connecter" :
            view==="join"   ? "🤝 Rejoindre l'espace" :
            "🚀 Créer mon compte"}
        \u003c/button\u003e

        \u003cdiv className="auth-divider"\u003eSécurisé par Firebase\u003c/div\u003e
        \u003cdiv className="auth-features"\u003e
          {[["🔒","Chiffrement E2E"],["☁️","Sync temps réel"],["📱","PC \u0026 Mobile"],["💑","Espace partagé"]].map(([icon,label]) =\u003e (
            \u003cdiv key={label} className="auth-feature-pill"\u003e\u003cspan\u003e{icon}\u003c/span\u003e{label}\u003c/div\u003e
          ))}
        \u003c/div\u003e
      \u003c/div\u003e
    \u003c/div\u003e
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
  const [isLinked, setIsLinked] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [, startTransition] = useTransition();
  const navigateTo = useCallback((p) =\u003e { startTransition(() =\u003e setPage(p)); setSidebarOpen(false); }, []);

  const saveTimer = useRef(null);
  const isSaving = useRef(false);
  const localVersion = useRef(0);

  useEffect(() =\u003e { const unsub = onAuthStateChanged(auth, u =\u003e setUser(u||null)); return unsub; }, []);

  useEffect(() =\u003e {
    if (!user) { setReady(false); setActiveUID(null); setIsLinked(false); setData(INIT); return; }
    let unsub; let remoteTs = 0;
    setData(INIT); // reset before loading new user's data
    getLinkedUID(user.uid).then(async (linkedUID) =\u003e {
      const uid = linkedUID || user.uid;
      setActiveUID(uid);
      setIsLinked(!!linkedUID);
      firestoreLoad(uid).then(saved =\u003e {
        if (saved) { const { data:processed } = processDueBills(saved); setData(processed); remoteTs = saved._ts||0; }
        setReady(true);
        unsub = onSnapshot(getDocRef(uid), snap =\u003e {
          if (!snap.exists()) return;
          const remote = snap.data().budget; const ts = snap.data()._ts||0;
          if (ts \u003e remoteTs \u0026\u0026 !isSaving.current) { remoteTs = ts; const { data:processed } = processDueBills(remote); setData(processed); }
        });
      });
    });
    return () =\u003e unsub \u0026\u0026 unsub();
  }, [user]);

  useEffect(() =\u003e {
    if (!ready || !user || !activeUID) return;
    const ver = ++localVersion.current; setSyncStatus("saving");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () =\u003e {
      if (ver !== localVersion.current) return;
      isSaving.current = true;
      const ok = await firestoreSave(activeUID, data);
      isSaving.current = false; setSyncStatus(ok?"synced":"error");
    }, 1200);
    return () =\u003e clearTimeout(saveTimer.current);
  }, [data, ready, user, activeUID]);

  useEffect(() =\u003e {
    if (!ready) return;
    const t = setInterval(() =\u003e { setData(prev =\u003e { const { data:next,changed } = processDueBills(prev); return changed?next:prev; }); }, 60_000);
    return () =\u003e clearInterval(t);
  }, [ready]);

  const update = useCallback(fn =\u003e {
    setData(prev =\u003e {
      const next = typeof structuredClone === "function"
        ? structuredClone(prev)
        : JSON.parse(JSON.stringify(prev));
      fn(next);
      return next;
    });
  }, []);

  const allMonths = useMemo(() =\u003e {
    const keys = new Set([curMonthKey()]);
    Object.keys(data.monthsData).forEach(k =\u003e keys.add(k));
    for (let i=0; i\u003c12; i++) { const d=new Date(); d.setMonth(d.getMonth()-i); keys.add(monthKey(d.getFullYear(),d.getMonth())); }
    return Array.from(keys).sort().reverse();
  }, [data.monthsData]);

  const mdata = useCallback((key=selMonth) =\u003e {
    const md = data.monthsData[key];
    if (!md) return { transactions:[], incomes:{p1:0,p2:0,common:0}, billsProcessed:{} };
    return { ...md, incomes:md.incomes||{p1:0,p2:0,common:0} };
  }, [data.monthsData, selMonth]);

  if (user === undefined) return (
    \u003cdiv style={{ position:"fixed",inset:0,display:"flex",alignItems:"center",justifyContent:"center",background:"var(--bg)" }}\u003e
      \u003cstyle\u003e{CSS}\u003c/style\u003e
      \u003cdiv style={{ textAlign:"center" }}\u003e\u003cdiv style={{ fontSize:56,marginBottom:14,animation:"float 2s ease-in-out infinite" }}\u003e💑\u003c/div\u003e\u003cdiv className="glow-text" style={{ fontFamily:"'Fraunces',serif",fontSize:28 }}\u003eChargement…\u003c/div\u003e\u003c/div\u003e
    \u003c/div\u003e
  );
  if (!user) return \u003cAuthScreen /\u003e;
  if (!ready) return (
    \u003cdiv style={{ position:"fixed",inset:0,display:"flex",alignItems:"center",justifyContent:"center",background:"var(--bg)" }}\u003e
      \u003cstyle\u003e{CSS}\u003c/style\u003e
      \u003cdiv style={{ textAlign:"center" }}\u003e\u003cdiv style={{ fontSize:52,marginBottom:12,animation:"float 2s ease-in-out infinite" }}\u003e☁️\u003c/div\u003e\u003cdiv className="glow-text" style={{ fontFamily:"'Fraunces',serif",fontSize:22 }}\u003eSynchronisation…\u003c/div\u003e\u003cdiv style={{ fontSize:13,color:"var(--text3)",marginTop:6 }}\u003e{user.email}\u003c/div\u003e\u003c/div\u003e
    \u003c/div\u003e
  );

  const hasProfiles = data.profiles.length \u003e= 2;
  // New account with no profiles → show onboarding
  if (!hasProfiles) return (\u003c\u003e\u003cstyle\u003e{CSS}\u003c/style\u003e\u003cOnboardingScreen update={update} isLinked={isLinked} user={user}/\u003e\u003c/\u003e);

  const unpaidBills = data.bills.filter(b =\u003e !b.paid?.[selMonth]).length;
  const overdueBills = data.bills.filter(b =\u003e { if (b.paid?.[selMonth]) return false; return b.dueDate \u0026\u0026 new Date(b.dueDate) \u003c new Date(); }).length;

  const navItems = [
    { id:"dashboard", icon:"🏠", label:"Tableau de bord", desc:"Vue d'ensemble de vos finances" },
    { id:"incomes",   icon:"💵", label:"Revenus",         desc:"Gérer les revenus mensuels" },
    { id:"expenses",  icon:"💳", label:"Dépenses",        desc:"Toutes vos transactions du mois" },
    { id:"bills",     icon:"📋", label:"Factures",        desc:"Charges récurrentes à payer", badge:unpaidBills },
    { id:"stats",     icon:"📊", label:"Statistiques",    desc:"Analyses et tendances sur plusieurs mois" },
    { id:"essence",   icon:"⛽", label:"Carburants",      desc:"Prix carburants en temps réel" },
    { id:"settings",  icon:"⚙️", label:"Réglages",        desc:"Gérer profils, catégories, thème" },
  ];

  const navigate = navigateTo;
  const pageTitles = { dashboard:"Tableau de bord",incomes:"Revenus",expenses:"Dépenses",bills:"Factures",stats:"Statistiques",settings:"Réglages",essence:"⛽ Prix des carburants" };
  const syncLabel = { synced:"Synchronisé ✓",saving:"Sauvegarde…",error:"Erreur sync !" };
  const syncColor = { synced:"var(--green)",saving:"var(--yellow)",error:"var(--red)" };

  return (
    \u003c\u003e
      \u003cstyle\u003e{CSS}\u003c/style\u003e
      \u003cGlobalTooltip/\u003e
      \u003cdiv className="app-shell"\u003e
        \u003cdiv className={`sidebar-overlay ${sidebarOpen?"open":""}`} onClick={() =\u003e setSidebarOpen(false)}/\u003e

        \u003caside className={`sidebar ${sidebarOpen?"open":""}`}\u003e
          \u003cdiv style={{ padding:"20px 16px 18px",borderBottom:"1px solid var(--border)",background:"linear-gradient(180deg,rgba(167,139,250,0.06),transparent)" }}\u003e
            \u003cdiv style={{ display:"flex",alignItems:"center",gap:13 }}\u003e
              \u003cdiv style={{ width:46,height:46,borderRadius:15,background:"var(--grad-main)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,boxShadow:"0 6px 22px rgba(167,139,250,0.55),inset 0 1px 0 rgba(255,255,255,0.25)",flexShrink:0 }}\u003e💑\u003c/div\u003e
              \u003cdiv\u003e
                \u003cdiv className="glow-text" style={{ fontFamily:"'Fraunces',serif",fontSize:22,fontWeight:700,lineHeight:1 }}\u003eDuoBudget\u003c/div\u003e
                \u003cdiv style={{ fontSize:9,color:"var(--text3)",letterSpacing:1.6,textTransform:"uppercase",marginTop:3,fontWeight:700 }}\u003eFinance à deux\u003c/div\u003e
              \u003c/div\u003e
            \u003c/div\u003e
            \u003cdiv style={{ display:"flex",gap:6,marginTop:14 }}\u003e
              {data.profiles.filter(p =\u003e p.id!=="common").map(p =\u003e {
                const inc = mdata(selMonth).incomes[p.id]||0;
                const spent = mdata(selMonth).transactions.filter(t=\u003et.profileId===p.id).reduce((s,t)=\u003es+t.amount,0);
                return (
                  \u003cdiv key={p.id} className="tip" data-tip={`${p.name} · Revenu: ${fmt(inc)} · Dép: ${fmt(spent)}`}
                    style={{ flex:1,display:"flex",alignItems:"center",gap:8,padding:"9px 11px",borderRadius:12,background:`${p.color}0c`,border:`1px solid ${p.color}25`,cursor:"default",transition:"all .2s" }}
                    onMouseEnter={e=\u003ee.currentTarget.style.background=p.color+"1e"}
                    onMouseLeave={e=\u003ee.currentTarget.style.background=p.color+"0c"}\u003e
                    \u003cdiv style={{ width:32,height:32,borderRadius:10,background:p.color+"22",border:`1px solid ${p.color}35`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:17,overflow:"hidden",flexShrink:0 }}\u003e
                      {p.photo ? \u003cimg src={p.photo} alt={p.name} style={{ width:"100%",height:"100%",objectFit:"cover" }}/\u003e : p.avatar}
                    \u003c/div\u003e
                    \u003cdiv style={{ minWidth:0 }}\u003e
                      \u003cdiv style={{ fontSize:11.5,fontWeight:800,color:p.color,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}\u003e{p.name}\u003c/div\u003e
                      \u003cdiv style={{ fontSize:10,color:"var(--text3)",fontWeight:600,marginTop:1 }}\u003e{inc\u003e0?fmt(inc):"—"}\u003c/div\u003e
                    \u003c/div\u003e
                  \u003c/div\u003e
                );
              })}
            \u003c/div\u003e
          \u003c/div\u003e

          \u003cdiv style={{ padding:"12px 14px",borderBottom:"1px solid var(--border)" }}\u003e
            \u003cdiv style={{ fontSize:9,color:"var(--text3)",textTransform:"uppercase",letterSpacing:1.6,fontWeight:800,marginBottom:7,display:"flex",alignItems:"center",gap:6 }}\u003e
              \u003cspan\u003e📅\u003c/span\u003e Période
            \u003c/div\u003e
            \u003cselect value={selMonth} onChange={e =\u003e setSelMonth(e.target.value)} className="tip" data-tip="Changer le mois affiché"
              style={{ background:"rgba(167,139,250,0.08)",border:"1px solid rgba(167,139,250,0.22)",borderRadius:10,color:"var(--text)",padding:"8px 12px",fontSize:12,fontWeight:700,cursor:"pointer",width:"100%" }}\u003e
              {allMonths.map(k =\u003e \u003coption key={k} value={k}\u003e{monthLabel(k)}\u003c/option\u003e)}
            \u003c/select\u003e
          \u003c/div\u003e

          \u003cnav style={{ flex:1,paddingTop:4,overflowY:"auto" }}\u003e
            \u003cdiv className="nav-section-label"\u003eNavigation\u003c/div\u003e
            {navItems.slice(0,5).map(n =\u003e (
              \u003cdiv key={n.id} className={`nav-item tip ${page===n.id?"active":""}`} data-tip={n.desc||n.label} onClick={() =\u003e navigate(n.id)}\u003e
                \u003cdiv className="nav-icon-wrap"\u003e\u003cspan className="nav-icon"\u003e{n.icon}\u003c/span\u003e\u003c/div\u003e
                \u003cspan style={{ flex:1 }}\u003e{n.label}\u003c/span\u003e
                {n.badge\u003e0 \u0026\u0026 \u003cspan className="nav-badge"\u003e{overdueBills\u003e0?"⚠️ ":""}{n.badge}\u003c/span\u003e}
              \u003c/div\u003e
            ))}
            \u003cdiv className="nav-section-label"\u003ePlus\u003c/div\u003e
            \u003cdiv className={`nav-item tip ${page==="essence"?"active":""}`} data-tip="Prix carburants en temps réel" onClick={() =\u003e navigate("essence")}\u003e
              \u003cdiv className="nav-icon-wrap"\u003e\u003cspan className="nav-icon"\u003e⛽\u003c/span\u003e\u003c/div\u003e
              \u003cspan\u003eEssence\u003c/span\u003e
              \u003cspan style={{ fontSize:9,background:"rgba(251,191,36,0.15)",color:"var(--yellow)",borderRadius:20,padding:"2px 7px",fontWeight:800,border:"1px solid rgba(251,191,36,0.3)" }}\u003eLIVE\u003c/span\u003e
            \u003c/div\u003e
            \u003cdiv className="nav-section-label"\u003eSystème\u003c/div\u003e
            \u003cdiv className={`nav-item tip ${page==="settings"?"active":""}`} data-tip="Gérer profils, catégories" onClick={() =\u003e navigate("settings")}\u003e
              \u003cdiv className="nav-icon-wrap"\u003e\u003cspan className="nav-icon"\u003e⚙️\u003c/span\u003e\u003c/div\u003e
              \u003cspan\u003eRéglages\u003c/span\u003e
            \u003c/div\u003e
          \u003c/nav\u003e

          \u003cdiv style={{ padding:"12px 14px",borderTop:"1px solid var(--border)" }}\u003e
            \u003cdiv className="tip tip-left" data-tip="État de la synchronisation Firebase" style={{ display:"flex",alignItems:"center",gap:8,padding:"8px 10px",borderRadius:10,background:"rgba(255,255,255,0.03)",marginBottom:10,border:"1px solid var(--border)" }}\u003e
              \u003cdiv className={`sync-dot ${syncStatus}`}/\u003e\u003cspan style={{ fontSize:11,color:syncColor[syncStatus],fontWeight:700 }}\u003e{syncLabel[syncStatus]}\u003c/span\u003e
            \u003c/div\u003e
            \u003cbutton onClick={() =\u003e signOut(auth)} className="tip tip-left" data-tip="Se déconnecter"
              style={{ width:"100%",background:"rgba(248,113,113,0.06)",border:"1px solid rgba(248,113,113,0.16)",borderRadius:11,color:"var(--red)",cursor:"pointer",fontSize:12,fontWeight:700,padding:"10px",fontFamily:"'Outfit',sans-serif",transition:"all .22s",display:"flex",alignItems:"center",justifyContent:"center",gap:8 }}
              onMouseEnter={e=\u003e{e.currentTarget.style.background="rgba(248,113,113,0.16)";e.currentTarget.style.borderColor="rgba(248,113,113,0.35)";}}
              onMouseLeave={e=\u003e{e.currentTarget.style.background="rgba(248,113,113,0.06)";e.currentTarget.style.borderColor="rgba(248,113,113,0.16)";}}\u003e
              \u003cspan style={{ fontSize:16 }}\u003e🚪\u003c/span\u003e Déconnexion
            \u003c/button\u003e
          \u003c/div\u003e
        \u003c/aside\u003e

        \u003cdiv className="main-area"\u003e
          \u003cdiv className="topbar"\u003e
            \u003cbutton className="menu-btn" onClick={() =\u003e setSidebarOpen(o =\u003e !o)} aria-label="Menu"\u003e☰\u003c/button\u003e
            \u003cdiv style={{ fontFamily:"'Fraunces',serif",fontSize:19,fontWeight:700,color:"var(--text)",flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}\u003e{pageTitles[page]}\u003c/div\u003e
            \u003cdiv className="topbar-month"\u003e
              \u003cspan\u003e📅\u003c/span\u003e
              \u003cselect value={selMonth} onChange={e =\u003e setSelMonth(e.target.value)}\u003e
                {allMonths.map(k =\u003e \u003coption key={k} value={k}\u003e{monthLabelShort(k)}\u003c/option\u003e)}
              \u003c/select\u003e
            \u003c/div\u003e
            \u003cdiv style={{ display:"flex",alignItems:"center",gap:8,flexShrink:0 }}\u003e
              {page==="expenses" \u0026\u0026 (
                \u003c\u003e
                  \u003cbutton className="topbar-action-btn tip" data-tip="Exporter en CSV"
                    style={{ background:"rgba(255,255,255,0.07)",border:"1px solid var(--border)",color:"var(--text2)" }}
                    onClick={() =\u003e exportCSV(mdata(selMonth).transactions,data.categories,data.profiles,selMonth)}\u003e
                    📥 \u003cspan style={{ fontSize:12 }}\u003eCSV\u003c/span\u003e
                  \u003c/button\u003e
                  \u003cbutton className="topbar-action-btn tip" data-tip="Ajouter une dépense"
                    style={{ background:"var(--grad-main)",color:"white",boxShadow:"0 4px 14px rgba(167,139,250,0.35)" }}
                    onClick={() =\u003e setModal({ type:"addTransaction",selMonth })}\u003e
                    + Dépense
                  \u003c/button\u003e
                \u003c/\u003e
              )}
              {page==="bills" \u0026\u0026 (
                \u003cbutton className="topbar-action-btn tip" data-tip="Créer une facture récurrente"
                  style={{ background:"var(--grad-main)",color:"white",boxShadow:"0 4px 14px rgba(167,139,250,0.35)" }}
                  onClick={() =\u003e setModal({ type:"addBill" })}\u003e
                  + Facture
                \u003c/button\u003e
              )}
              {page==="incomes" \u0026\u0026 (
                \u003cbutton className="topbar-action-btn tip" data-tip="Ajouter un revenu récurrent"
                  style={{ background:"var(--grad-main)",color:"white",boxShadow:"0 4px 14px rgba(167,139,250,0.35)" }}
                  onClick={() =\u003e setModal({ type:"addRecurringIncome" })}\u003e
                  + Récurrent
                \u003c/button\u003e
              )}
              {/* Sync dot */}
              \u003cdiv className={`sync-dot tip ${syncStatus}`} data-tip={syncLabel[syncStatus]}/\u003e
              {/* Clock */}
              \u003cLiveClock/\u003e
            \u003c/div\u003e
          \u003c/div\u003e

          \u003cdiv className="page-content"\u003e
            {page==="dashboard" \u0026\u0026 \u003cDashboard data={data} update={update} selMonth={selMonth} mdata={mdata} setModal={setModal} allMonths={allMonths}/\u003e}
            {page==="incomes"   \u0026\u0026 \u003cIncomes   data={data} update={update} selMonth={selMonth} mdata={mdata} setModal={setModal}/\u003e}
            {page==="expenses"  \u0026\u0026 \u003cExpenses  data={data} update={update} selMonth={selMonth} mdata={mdata} setModal={setModal}/\u003e}
            {page==="bills"     \u0026\u0026 \u003cBills     data={data} update={update} selMonth={selMonth} mdata={mdata} setModal={setModal}/\u003e}
            {page==="stats"     \u0026\u0026 \u003cStats     data={data} selMonth={selMonth} mdata={mdata} allMonths={allMonths}/\u003e}
            {page==="essence"   \u0026\u0026 \u003cSuspense fallback={\u003cdiv style={{textAlign:"center",padding:60,color:"var(--text3)"}}\u003e⛽ Chargement…\u003c/div\u003e}\u003e\u003cEssencePage/\u003e\u003c/Suspense\u003e}
            {page==="settings"  \u0026\u0026 \u003cSettingsPage data={data} update={update} setModal={setModal} user={user} activeUID={activeUID}/\u003e}
          \u003c/div\u003e
        \u003c/div\u003e

        \u003cnav className="bottom-nav"\u003e
          {[
            { id:"dashboard", icon:"🏠", label:"Accueil" },
            { id:"expenses",  icon:"💳", label:"Dépenses" },
            { id:"bills",     icon:"📋", label:"Factures", badge:unpaidBills },
            { id:"stats",     icon:"📊", label:"Stats" },
          ].map(n =\u003e (
            \u003cdiv key={n.id} className={`bnav-item ${page===n.id?"active":""}`} onClick={() =\u003e navigate(n.id)}\u003e
              \u003cdiv className="bnav-icon-wrap"\u003e\u003cspan className="bnav-icon"\u003e{n.icon}\u003c/span\u003e\u003c/div\u003e
              \u003cspan\u003e{n.label}\u003c/span\u003e
              {n.badge\u003e0 \u0026\u0026 \u003cspan style={{ position:"absolute",top:0,right:2,background:overdueBills\u003e0?"var(--red)":"var(--yellow)",color:"white",borderRadius:10,padding:"0 5px",fontSize:9,fontWeight:800,minWidth:16,textAlign:"center" }}\u003e{n.badge}\u003c/span\u003e}
            \u003c/div\u003e
          ))}
          \u003cdiv className={`bnav-item ${["incomes","essence","settings"].includes(page)?"active":""}`} onClick={() =\u003e setMoreOpen(true)}\u003e
            \u003cdiv className="bnav-icon-wrap"\u003e\u003cspan className="bnav-icon"\u003e⋯\u003c/span\u003e\u003c/div\u003e
            \u003cspan\u003ePlus\u003c/span\u003e
          \u003c/div\u003e
        \u003c/nav\u003e

        {moreOpen \u0026\u0026 (
          \u003c\u003e
            \u003cdiv className="more-sheet-overlay" onClick={() =\u003e setMoreOpen(false)}/\u003e
            \u003cdiv className="more-sheet"\u003e
              \u003cdiv className="more-sheet-handle"/\u003e
              \u003cdiv className="more-month-row"\u003e
                \u003cdiv className="more-month-label"\u003e📅 Période\u003c/div\u003e
                \u003cselect className="more-month-select" value={selMonth} onChange={e =\u003e { setSelMonth(e.target.value); }}\u003e
                  {allMonths.map(k =\u003e \u003coption key={k} value={k}\u003e{monthLabel(k)}\u003c/option\u003e)}
                \u003c/select\u003e
              \u003c/div\u003e
              \u003cdiv className="more-sheet-title" style={{marginTop:10}}\u003eNavigation\u003c/div\u003e
              {[
                { id:"incomes",  icon:"💵", label:"Revenus",   desc:"Revenus du mois",          bg:"rgba(74,222,128,0.12)",  color:"#4ade80" },
                { id:"essence",  icon:"⛽", label:"Carburants",desc:"Prix en temps réel",        bg:"rgba(251,191,36,0.12)",  color:"#fbbf24", badge:"LIVE" },
                { id:"settings", icon:"⚙️", label:"Réglages",  desc:"Profils \u0026 catégories",      bg:"rgba(167,139,250,0.12)", color:"#a78bfa" },
              ].map(item =\u003e (
                \u003cdiv key={item.id} className="more-sheet-row" onClick={() =\u003e { navigate(item.id); setMoreOpen(false); }}\u003e
                  \u003cdiv className="more-sheet-icon" style={{background:item.bg}}\u003e\u003cspan\u003e{item.icon}\u003c/span\u003e\u003c/div\u003e
                  \u003cdiv style={{flex:1}}\u003e
                    \u003cdiv style={{fontWeight:800,fontSize:15}}\u003e{item.label}\u003c/div\u003e
                    \u003cdiv style={{fontSize:12,color:"rgba(237,233,248,0.45)",marginTop:1}}\u003e{item.desc}\u003c/div\u003e
                  \u003c/div\u003e
                  {item.badge \u0026\u0026 \u003cspan style={{fontSize:9,background:"rgba(251,191,36,0.18)",color:"#fbbf24",borderRadius:20,padding:"3px 8px",fontWeight:900,border:"1px solid rgba(251,191,36,0.3)"}}\u003e{item.badge}\u003c/span\u003e}
                  \u003cspan style={{color:"rgba(237,233,248,0.25)",fontSize:16}}\u003e›\u003c/span\u003e
                \u003c/div\u003e
              ))}
              \u003cdiv className="more-sheet-sep"/\u003e
              \u003cdiv className="more-sheet-row" style={{color:"var(--red)"}} onClick={() =\u003e { setMoreOpen(false); signOut(auth); }}\u003e
                \u003cdiv className="more-sheet-icon" style={{background:"rgba(248,113,113,0.12)"}}\u003e\u003cspan\u003e🚪\u003c/span\u003e\u003c/div\u003e
                \u003cdiv style={{flex:1}}\u003e\u003cdiv style={{fontWeight:800,fontSize:15,color:"var(--red)"}}\u003eDéconnexion\u003c/div\u003e\u003c/div\u003e
                \u003cdiv style={{display:"flex",alignItems:"center",gap:6,fontSize:11,color:"rgba(237,233,248,0.3)",fontWeight:600}}\u003e\u003cdiv className={`sync-dot ${syncStatus}`} style={{flexShrink:0}}/\u003e{syncLabel[syncStatus]}\u003c/div\u003e
              \u003c/div\u003e
              \u003cdiv style={{height:8}}/\u003e
            \u003c/div\u003e
          \u003c/\u003e
        )}

        {modal \u0026\u0026 \u003cModalRouter modal={modal} setModal={setModal} data={data} update={update} selMonth={selMonth}/\u003e}
      \u003c/div\u003e
    \u003c/\u003e
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
      \u003cdiv style={{ position:"fixed",inset:0,display:"flex",alignItems:"center",justifyContent:"center",padding:24,background:`radial-gradient(ellipse 80% 60% at 50% 0%,rgba(167,139,250,0.18),transparent 65%),var(--bg)` }}\u003e
        \u003cdiv style={{ maxWidth:480,width:"100%",textAlign:"center" }} className="fade-up"\u003e
          \u003cdiv style={{ fontSize:64,marginBottom:12,animation:"float 3s ease-in-out infinite" }}\u003e👋\u003c/div\u003e
          \u003ch1 style={{ fontFamily:"'Fraunces',serif",fontSize:36,marginBottom:8 }} className="glow-text"\u003eBienvenue !\u003c/h1\u003e
          \u003cp style={{ color:"var(--text2)",marginBottom:8,fontSize:14,lineHeight:1.6 }}\u003e
            Vous rejoignez un espace partagé. Créez votre profil personnel pour interagir avec cet espace.
          \u003c/p\u003e
          \u003cdiv style={{ display:"inline-flex",alignItems:"center",gap:8,background:"rgba(167,139,250,0.1)",border:"1px solid rgba(167,139,250,0.25)",borderRadius:20,padding:"6px 14px",fontSize:12,color:"var(--purple)",fontWeight:700,marginBottom:32 }}\u003e
            💑 Espace partagé · {user?.email}
          \u003c/div\u003e
          \u003cdiv className="glass" style={{ padding:28,borderRadius:24,marginBottom:24,textAlign:"left" }}\u003e
            \u003cdiv style={{ fontWeight:800,fontSize:15,marginBottom:18,color:"var(--purple)" }}\u003e🧑 Votre profil\u003c/div\u003e
            \u003cdiv style={{ textAlign:"center",fontSize:56,marginBottom:14 }}\u003e{myProfile.avatar}\u003c/div\u003e
            \u003cinput value={myProfile.name} onChange={e=\u003esetMyProfile(v=\u003e({...v,name:e.target.value}))}
              placeholder="Votre prénom…" style={{ marginBottom:14,textAlign:"center",fontSize:15,fontWeight:700 }}/\u003e
            \u003cdiv style={{ display:"flex",flexWrap:"wrap",gap:5,justifyContent:"center",marginBottom:14 }}\u003e
              {AVATARS.map(a =\u003e (
                \u003cbutton key={a} onClick={() =\u003e setMyProfile(v=\u003e({...v,avatar:a}))}
                  style={{ fontSize:18,background:myProfile.avatar===a?"rgba(167,139,250,0.2)":"rgba(255,255,255,0.05)",border:`2px solid ${myProfile.avatar===a?"#a78bfa":"transparent"}`,borderRadius:9,width:38,height:38,cursor:"pointer",transition:"all .15s" }}\u003e{a}\u003c/button\u003e
              ))}
            \u003c/div\u003e
            \u003cdiv style={{ display:"flex",flexWrap:"wrap",gap:6,justifyContent:"center" }}\u003e
              {colors.map(c =\u003e (
                \u003cbutton key={c} onClick={() =\u003e setMyProfile(v=\u003e({...v,color:c}))}
                  style={{ width:26,height:26,borderRadius:"50%",background:c,border:myProfile.color===c?"3px solid white":"2px solid transparent",cursor:"pointer",transition:"all .15s",boxShadow:myProfile.color===c?`0 0 10px ${c}`:"none" }}/\u003e
              ))}
            \u003c/div\u003e
          \u003c/div\u003e
          \u003cbutton className="btn btn-primary" onClick={() =\u003e {
            if (!myProfile.name.trim()) return;
            const pid = "p_" + Date.now();
            update(d =\u003e {
              d.profiles = [...(d.profiles||[]), { id:pid,name:myProfile.name.trim(),avatar:myProfile.avatar,color:myProfile.color }];
            });
          }} disabled={!myProfile.name.trim()} style={{ padding:"14px 52px",fontSize:16,opacity:!myProfile.name.trim()?0.4:1 }}\u003e
            🚀 Rejoindre l'espace
          \u003c/button\u003e
        \u003c/div\u003e
      \u003c/div\u003e
    );
  }

  // New account → full onboarding with two profiles
  if (step === 0) return (
    \u003cdiv style={{ position:"fixed",inset:0,display:"flex",alignItems:"center",justifyContent:"center",padding:24,background:`radial-gradient(ellipse 80% 60% at 50% 0%,rgba(167,139,250,0.2),transparent 65%),var(--bg)` }}\u003e
      \u003cdiv style={{ maxWidth:540,width:"100%",textAlign:"center" }} className="fade-up"\u003e
        \u003cdiv style={{ fontSize:72,marginBottom:14,animation:"float 3s ease-in-out infinite" }}\u003e💑\u003c/div\u003e
        \u003ch1 style={{ fontFamily:"'Fraunces',serif",fontSize:48,marginBottom:10 }} className="glow-text"\u003eDuoBudget\u003c/h1\u003e
        \u003cp style={{ color:"var(--text2)",marginBottom:10,fontSize:15,lineHeight:1.7 }}\u003e
          Votre espace financier à deux. Gérez vos revenus, dépenses et objectifs ensemble.
        \u003c/p\u003e
        \u003cdiv style={{ display:"flex",justifyContent:"center",gap:10,flexWrap:"wrap",marginBottom:36 }}\u003e
          {[["💑","Couple","Finance à deux"],["📊","Stats","Courbes \u0026 graphiques"],["⛽","Essence","Prix en temps réel"],["🔒","Sécurisé","Firebase chiffré"]].map(([i,t,s]) =\u003e (
            \u003cdiv key={t} style={{ background:"rgba(255,255,255,0.04)",border:"1px solid var(--border)",borderRadius:14,padding:"12px 18px",textAlign:"center",minWidth:100 }}\u003e
              \u003cdiv style={{ fontSize:22,marginBottom:4 }}\u003e{i}\u003c/div\u003e
              \u003cdiv style={{ fontWeight:800,fontSize:12 }}\u003e{t}\u003c/div\u003e
              \u003cdiv style={{ fontSize:10,color:"var(--text3)",marginTop:2 }}\u003e{s}\u003c/div\u003e
            \u003c/div\u003e
          ))}
        \u003c/div\u003e
        \u003cbutton className="btn btn-primary" onClick={() =\u003e setStep(1)} style={{ padding:"14px 56px",fontSize:16 }}\u003e
          ✨ Créer nos profils →
        \u003c/button\u003e
      \u003c/div\u003e
    \u003c/div\u003e
  );

  return (
    \u003cdiv style={{ position:"fixed",inset:0,display:"flex",alignItems:"center",justifyContent:"center",padding:24,background:`radial-gradient(ellipse 80% 60% at 50% 0%,rgba(167,139,250,0.18),transparent 65%),var(--bg)`,overflowY:"auto" }}\u003e
      \u003cdiv style={{ maxWidth:680,width:"100%",textAlign:"center" }} className="fade-up"\u003e
        \u003cdiv style={{ fontSize:52,marginBottom:8 }}\u003e🧑‍🤝‍🧑\u003c/div\u003e
        \u003ch2 style={{ fontFamily:"'Fraunces',serif",fontSize:34,marginBottom:6 }} className="glow-text"\u003eCréez vos profils\u003c/h2\u003e
        \u003cp style={{ color:"var(--text2)",marginBottom:28,fontSize:13 }}\u003eChaque partenaire a son propre profil. Un compte commun sera créé automatiquement.\u003c/p\u003e
        \u003cdiv style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:24 }}\u003e
          {[
            { label:"Profil 1",emoji:"💜",state:p1,set:setP1,color:"#a78bfa",defColor:"#a78bfa" },
            { label:"Profil 2",emoji:"🩷",state:p2,set:setP2,color:"#f472b6",defColor:"#f472b6" },
          ].map(({ label,emoji,state,set,color,defColor }) =\u003e (
            \u003cdiv key={label} className="glass" style={{ padding:24,borderRadius:22 }}\u003e
              \u003cdiv style={{ fontWeight:800,fontSize:13,marginBottom:14,color }}\u003e{emoji} {label}\u003c/div\u003e
              \u003cdiv style={{ fontSize:52,marginBottom:10 }}\u003e{state.avatar}\u003c/div\u003e
              \u003cinput value={state.name} onChange={e=\u003eset(v=\u003e({...v,name:e.target.value}))}
                placeholder="Ton prénom…" style={{ marginBottom:10,textAlign:"center",fontSize:14,fontWeight:700 }}/\u003e
              \u003cdiv style={{ display:"flex",flexWrap:"wrap",gap:4,justifyContent:"center",marginBottom:10 }}\u003e
                {AVATARS.slice(0,20).map(a =\u003e (
                  \u003cbutton key={a} onClick={() =\u003e set(v=\u003e({...v,avatar:a}))}
                    style={{ fontSize:16,background:state.avatar===a?`${color}25`:"rgba(255,255,255,0.05)",border:`2px solid ${state.avatar===a?color:"transparent"}`,borderRadius:8,width:34,height:34,cursor:"pointer",transition:"all .12s" }}\u003e{a}\u003c/button\u003e
                ))}
              \u003c/div\u003e
              \u003cdiv style={{ display:"flex",flexWrap:"wrap",gap:5,justifyContent:"center" }}\u003e
                {colors.map(c =\u003e (
                  \u003cbutton key={c} onClick={() =\u003e set(v=\u003e({...v,color:c}))}
                    style={{ width:22,height:22,borderRadius:"50%",background:c,border:state.color===c?"3px solid white":"2px solid transparent",cursor:"pointer",boxShadow:state.color===c?`0 0 8px ${c}`:"none" }}/\u003e
                ))}
              \u003c/div\u003e
            \u003c/div\u003e
          ))}
        \u003c/div\u003e
        \u003cdiv style={{ display:"flex",gap:12,justifyContent:"center" }}\u003e
          \u003cbutton className="btn btn-ghost" onClick={() =\u003e setStep(0)} style={{ padding:"12px 28px" }}\u003e← Retour\u003c/button\u003e
          \u003cbutton className="btn btn-primary" onClick={() =\u003e {
            if (!p1.name.trim()||!p2.name.trim()) return;
            update(d =\u003e { d.profiles = [
              { id:"p1",name:p1.name.trim(),avatar:p1.avatar,color:p1.color },
              { id:"p2",name:p2.name.trim(),avatar:p2.avatar,color:p2.color },
              { id:"common",name:"Compte commun",avatar:"🏦",color:"#60a5fa" },
            ]; });
          }} disabled={!p1.name.trim()||!p2.name.trim()} style={{ padding:"14px 44px",fontSize:15,opacity:(!p1.name.trim()||!p2.name.trim())?0.4:1 }}\u003e
            🚀 Commencer l'aventure !
          \u003c/button\u003e
        \u003c/div\u003e
      \u003c/div\u003e
    \u003c/div\u003e
  );
}

function SetupScreen({ update }) { return \u003cOnboardingScreen update={update} isLinked={false}/\u003e; }

function ProfileSetup({ label, emoji, color, value, onChange }) {
  return (
    \u003cdiv\u003e
      \u003cdiv style={{ fontWeight:700,fontSize:14,marginBottom:14,color }}\u003e{emoji} {label}\u003c/div\u003e
      \u003cdiv style={{ fontSize:56,marginBottom:14 }}\u003e{value.avatar}\u003c/div\u003e
      \u003cinput value={value.name} onChange={e =\u003e onChange(v=\u003e({...v,name:e.target.value}))} placeholder="Ton prénom…" style={{ marginBottom:14,textAlign:"center",fontSize:15 }}/\u003e
      \u003cdiv style={{ display:"flex",flexWrap:"wrap",gap:5,justifyContent:"center" }}\u003e
        {AVATARS.map(a =\u003e (
          \u003cbutton key={a} onClick={() =\u003e onChange(v=\u003e({...v,avatar:a}))} style={{ fontSize:18,background:value.avatar===a?`${color}25`:"rgba(255,255,255,0.05)",border:`2px solid ${value.avatar===a?color:"transparent"}`,borderRadius:9,width:38,height:38,cursor:"pointer",transition:"all .15s" }}\u003e{a}\u003c/button\u003e
        ))}
      \u003c/div\u003e
    \u003c/div\u003e
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

const DashboardRecentTx = memo(function DashboardRecentTx({ transactions, catMap, profMap }) {
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState(false);
  const filtered = useMemo(() =\u003e {
    const sorted = [...transactions].sort((a,b) =\u003e new Date(b.timestamp)-new Date(a.timestamp));
    if (!search.trim()) return expanded?sorted:sorted.slice(0,5);
    const q = search.toLowerCase();
    return sorted.filter(tx =\u003e tx.label.toLowerCase().includes(q)||(catMap[tx.categoryId]?.name||"").toLowerCase().includes(q)||(profMap[tx.profileId]?.name||"").toLowerCase().includes(q));
  }, [transactions, search, expanded, catMap, profMap]);

  return (
    \u003c\u003e
      \u003cdiv style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16 }}\u003e
        \u003cdiv style={{ display:"flex",alignItems:"center",gap:10 }}\u003e
          \u003cdiv style={{ width:36,height:36,borderRadius:11,background:"rgba(167,139,250,0.12)",border:"1px solid rgba(167,139,250,0.2)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:17 }}\u003e🕐\u003c/div\u003e
          \u003cdiv\u003e
            \u003cdiv style={{ fontWeight:800,fontSize:15 }}\u003eDernières transactions\u003c/div\u003e
            \u003cdiv style={{ fontSize:11,color:"var(--text3)",marginTop:1 }}\u003e{transactions.length} ce mois\u003c/div\u003e
          \u003c/div\u003e
        \u003c/div\u003e
        {transactions.length\u003e0 \u0026\u0026 \u003cdiv style={{ fontFamily:"'Fraunces',serif",fontSize:17,fontWeight:800,color:"var(--red)" }}\u003e-{fmt(transactions.reduce((s,t)=\u003es+t.amount,0))}\u003c/div\u003e}
      \u003c/div\u003e
      {transactions.length\u003e0 \u0026\u0026 (
        \u003cdiv style={{ position:"relative",marginBottom:14 }}\u003e
          \u003cspan style={{ position:"absolute",left:13,top:"50%",transform:"translateY(-50%)",fontSize:13,pointerEvents:"none",opacity:.4 }}\u003e🔍\u003c/span\u003e
          \u003cinput value={search} onChange={e =\u003e setSearch(e.target.value)} placeholder="Filtrer les transactions…" style={{ paddingLeft:36,background:"rgba(255,255,255,0.04)",border:"1px solid var(--border)",borderRadius:11,fontSize:12.5,padding:"9px 13px 9px 36px" }}/\u003e
          {search \u0026\u0026 \u003cbutton onClick={() =\u003e setSearch("")} style={{ position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",color:"var(--text3)",fontSize:17,lineHeight:1 }}\u003e×\u003c/button\u003e}
        \u003c/div\u003e
      )}
      {transactions.length===0 ? (
        \u003cdiv className="empty-state" style={{ padding:"32px 16px" }}\u003e\u003cdiv className="empty-icon"\u003e💸\u003c/div\u003e\u003cdiv style={{ fontSize:14,fontWeight:700 }}\u003eAucune transaction ce mois\u003c/div\u003e\u003c/div\u003e
      ) : filtered.length===0 ? (
        \u003cdiv style={{ padding:"20px",textAlign:"center",color:"var(--text3)",fontSize:13 }}\u003eAucun résultat pour « {search} »\u003c/div\u003e
      ) : (
        \u003cdiv style={{ display:"flex",flexDirection:"column",gap:8 }}\u003e
          {filtered.map(tx =\u003e {
            const cat = catMap[tx.categoryId]||{ icon:"❓",color:"#888",name:"Autre" };
            const prof = profMap[tx.profileId]||{ avatar:"❓",name:"?",color:"#888" };
            return (
              \u003cdiv key={tx.id}
                style={{ display:"flex",alignItems:"center",gap:12,padding:"12px 14px",borderRadius:16,background:"rgba(255,255,255,0.025)",border:`1px solid rgba(255,255,255,0.06)`,transition:"all .15s",position:"relative" }}
                onMouseEnter={e=\u003e{e.currentTarget.style.background="rgba(255,255,255,0.05)";e.currentTarget.style.borderColor=`${cat.color}30`;}}
                onMouseLeave={e=\u003e{e.currentTarget.style.background="rgba(255,255,255,0.025)";e.currentTarget.style.borderColor="rgba(255,255,255,0.06)";}}\u003e
                {/* Left color stripe */}
                \u003cdiv style={{ position:"absolute",left:0,top:0,bottom:0,width:3,borderRadius:"16px 0 0 16px",background:cat.color,opacity:.7 }}/\u003e
                {/* Category icon — no overlapping avatar, cleaner */}
                \u003cdiv style={{ width:46,height:46,borderRadius:14,flexShrink:0,background:`${cat.color}14`,border:`1.5px solid ${cat.color}28`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,marginLeft:6 }}\u003e
                  {cat.icon}
                \u003c/div\u003e
                {/* Middle info */}
                \u003cdiv style={{ flex:1,minWidth:0 }}\u003e
                  \u003cdiv style={{ fontWeight:700,fontSize:14,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",marginBottom:4 }}\u003e{tx.label}\u003c/div\u003e
                  \u003cdiv style={{ display:"flex",alignItems:"center",gap:5,flexWrap:"wrap" }}\u003e
                    \u003cspan style={{ display:"inline-flex",alignItems:"center",gap:3,background:`${cat.color}12`,borderRadius:20,padding:"2px 8px",fontSize:11,fontWeight:700,color:cat.color }}\u003e{cat.name}\u003c/span\u003e
                    \u003cspan style={{ display:"inline-flex",alignItems:"center",gap:3,background:`${prof.color}12`,borderRadius:20,padding:"2px 8px",fontSize:11,fontWeight:600,color:prof.color }}\u003e{prof.avatar} {prof.name}\u003c/span\u003e
                    \u003cspan style={{ fontSize:10,color:"var(--text3)",fontWeight:600 }}\u003e🕐 {smartDate(tx.timestamp)}\u003c/span\u003e
                  \u003c/div\u003e
                \u003c/div\u003e
                {/* Right amount */}
                \u003cdiv style={{ textAlign:"right",flexShrink:0,marginLeft:4 }}\u003e
                  \u003cdiv style={{ fontFamily:"'Fraunces',serif",fontWeight:900,fontSize:17,color:"var(--red)",whiteSpace:"nowrap" }}\u003e-{fmt(tx.amount)}\u003c/div\u003e
                  {tx.auto \u0026\u0026 \u003cdiv style={{ fontSize:9,color:"var(--purple)",fontWeight:800,marginTop:1,letterSpacing:.5 }}\u003eAUTO\u003c/div\u003e}
                \u003c/div\u003e
              \u003c/div\u003e
            );
          })}
          {!search \u0026\u0026 transactions.length\u003e5 \u0026\u0026 (
            \u003cbutton onClick={() =\u003e setExpanded(e=\u003e!e)} style={{ width:"100%",marginTop:4,background:"rgba(255,255,255,0.025)",border:"1px solid var(--border)",borderRadius:11,color:"var(--text3)",cursor:"pointer",fontSize:12,fontWeight:700,padding:"10px",fontFamily:"'Outfit',sans-serif",transition:"all .2s" }}\u003e
              {expanded ? "▲ Réduire" : `▼ Voir les ${transactions.length-5} autres transactions`}
            \u003c/button\u003e
          )}
        \u003c/div\u003e
      )}
    \u003c/\u003e
  );
});

// ═══════════════════════════════════════
// DASHBOARD — avec profil cards améliorées
// ═══════════════════════════════════════
function Dashboard({ data, update, selMonth, mdata, setModal, allMonths }) {
  const md = mdata(selMonth);
  const { incomes, transactions } = md;
  const [balanceView, setBalanceView] = useState("global");

  const catMap  = useMemo(() =\u003e Object.fromEntries(data.categories.map(c=\u003e[c.id,c])), [data.categories]);
  const profMap = useMemo(() =\u003e Object.fromEntries(data.profiles.map(p=\u003e[p.id,p])), [data.profiles]);

  const totalIncome = useMemo(() =\u003e (incomes.p1||0)+(incomes.p2||0)+(incomes.common||0), [incomes]);
  const totalExp    = useMemo(() =\u003e transactions.reduce((s,t) =\u003e s+t.amount, 0), [transactions]);

  const viewData = useMemo(() =\u003e {
    if (balanceView === "global") return { inc:totalIncome,exp:totalExp,label:"Global — tous les comptes",color:null };
    const prof = data.profiles.find(p =\u003e p.id===balanceView);
    const inc  = incomes[balanceView]||0;
    const exp  = transactions.filter(t=\u003et.profileId===balanceView).reduce((s,t)=\u003es+t.amount,0);
    return { inc,exp,label:prof?`${prof.avatar} ${prof.name}`:balanceView,color:prof?.color||null };
  }, [balanceView,totalIncome,totalExp,incomes,transactions,data.profiles]);

  const balance = viewData.inc - viewData.exp;
  const pct     = viewData.inc\u003e0 ? Math.min(100,(viewData.exp/viewData.inc)*100) : 0;
  const isPos   = balance \u003e= 0;

  const catTotals = useMemo(() =\u003e { const m={}; transactions.forEach(t =\u003e { m[t.categoryId]=(m[t.categoryId]||0)+t.amount; }); return m; }, [transactions]);
  const topCats = useMemo(() =\u003e Object.entries(catTotals).sort((a,b)=\u003eb[1]-a[1]).slice(0,6), [catTotals]);
  const pieData = useMemo(() =\u003e topCats.map(([cid,val]) =\u003e ({ name:(catMap[cid]?.icon||"")+" "+(catMap[cid]?.name||cid),value:val,color:catMap[cid]?.color||"#888" })), [topCats,catMap]);

  const unpaid  = useMemo(() =\u003e data.bills.filter(b=\u003e!b.paid?.[selMonth]).sort((a,b)=\u003e{ if(!a.dueDate)return 1; if(!b.dueDate)return -1; return new Date(a.dueDate)-new Date(b.dueDate); }), [data.bills,selMonth]);
  const paid    = useMemo(() =\u003e data.bills.filter(b=\u003eb.paid?.[selMonth]), [data.bills,selMonth]);
  const overdue = useMemo(() =\u003e unpaid.filter(b=\u003eb.dueDate\u0026\u0026new Date(b.dueDate)\u003cnew Date()), [unpaid]);

  const today       = new Date();
  const daysInMonth = new Date(today.getFullYear(),today.getMonth()+1,0).getDate();
  const dayOfMonth  = today.getDate();
  const projectedExp = dayOfMonth\u003e0 ? (totalExp/dayOfMonth)*daysInMonth : 0;
  const isCurMonth  = selMonth===curMonthKey();

  const CT = ({ active, payload }) =\u003e {
    if (!active||!payload?.length) return null;
    const d = payload[0];
    return \u003cdiv className="rc-tooltip"\u003e\u003cdiv style={{ fontWeight:700 }}\u003e{d.name}\u003c/div\u003e\u003cdiv style={{ color:d.payload.color }}\u003e{fmt(d.value)}\u003c/div\u003e\u003c/div\u003e;
  };

  const fmtDue = iso =\u003e {
    if (!iso) return null;
    const d = new Date(iso); const diff = Math.ceil((d-new Date())/86400000);
    const lbl = d.toLocaleDateString("fr-FR",{ day:"numeric",month:"short" });
    if (diff\u003c0)  return { text:`${lbl} · En retard`,color:"var(--red)" };
    if (diff===0) return { text:"Échéance aujourd'hui",color:"var(--red)" };
    if (diff\u003c=3) return { text:`${lbl} · dans ${diff}j`,color:"var(--orange)" };
    if (diff\u003c=7) return { text:`${lbl} · dans ${diff}j`,color:"var(--yellow)" };
    return { text:lbl,color:"var(--text3)" };
  };

  return (
    \u003cdiv className="fade-up"\u003e
      {pct\u003e=80 \u0026\u0026 viewData.inc\u003e0 \u0026\u0026 (
        \u003cdiv className={`alert-banner ${pct\u003e=100?"alert-danger":"alert-warning"}`} style={{ marginBottom:14 }}\u003e
          {pct\u003e=100?"🔴":"⚠️"}\u003cspan\u003e{pct\u003e=100?"Budget dépassé !":`Budget utilisé à ${Math.round(pct)}% — restez vigilant`}\u003c/span\u003e
        \u003c/div\u003e
      )}
      {overdue.length\u003e0 \u0026\u0026 (
        \u003cdiv className="alert-banner alert-danger" style={{ marginBottom:14 }}\u003e⏰ \u003cspan\u003e{overdue.length} facture{overdue.length\u003e1?"s":""} en retard de paiement !\u003c/span\u003e\u003c/div\u003e
      )}

      {/* ══ PROFILE CARDS AMÉLIORÉES — toujours remplies ══ */}
      \u003cdiv className="profile-cards-grid" style={{ display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12,marginBottom:20,overflow:"visible" }}\u003e
        {data.profiles.map((p,i) =\u003e {
          const inc   = incomes[p.id]||0;
          const spent = transactions.filter(t=\u003et.profileId===p.id).reduce((s,t)=\u003es+t.amount,0);
          const sel   = balanceView===p.id;
          const spentPct = inc\u003e0 ? Math.min(100,(spent/inc)*100) : 0;
          const savingsRate = inc\u003e0 ? Math.round(((inc-spent)/inc)*100) : null;
          const profileTx = transactions.filter(t=\u003et.profileId===p.id);
          const profCats = {};
          profileTx.forEach(t =\u003e { profCats[t.categoryId]=(profCats[t.categoryId]||0)+t.amount; });
          const topProfCat = Object.entries(profCats).sort((a,b)=\u003eb[1]-a[1]).slice(0,2);

          return (
            \u003cdiv key={p.id}
              className="profile-card tip tip-below"
              data-tip={`Cliquer pour filtrer · ${p.name} · Revenu: ${fmt(inc)} · Dépenses: ${fmt(spent)}`}
              onClick={() =\u003e setBalanceView(sel?"global":p.id)}
              style={{
                padding:"18px 18px 16px",
                background:sel?`${p.color}12`:"var(--glass)",
                border:`1.5px solid ${sel?p.color+"55":"var(--border)"}`,
                boxShadow:sel?`0 0 28px ${p.color}22`:"none",
              }}\u003e

              {/* Dot indicateur actif */}
              \u003cdiv style={{ position:"absolute",top:12,right:12,width:7,height:7,borderRadius:"50%",background:p.color,boxShadow:`0 0 8px ${p.color}` }}/\u003e

              {/* Header avatar + nom */}
              \u003cdiv style={{ display:"flex",alignItems:"center",gap:11,marginBottom:14 }}\u003e
                \u003cdiv style={{ width:50,height:50,borderRadius:15,background:`${p.color}18`,border:`2px solid ${p.color}35`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:26,flexShrink:0,boxShadow:`0 4px 14px ${p.color}20` }}\u003e
                  {p.avatar}
                \u003c/div\u003e
                \u003cdiv style={{ flex:1,minWidth:0 }}\u003e
                  \u003cdiv style={{ fontWeight:900,fontSize:16,color:p.color,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}\u003e{p.name}\u003c/div\u003e
                  \u003cspan style={{ fontSize:10,fontWeight:700,padding:"2px 8px",borderRadius:20,background:`${p.color}14`,border:`1px solid ${p.color}28`,color:p.color,textTransform:"uppercase",letterSpacing:.5 }}\u003e
                    {p.id==="common"?"🏦 Commun":"💼 Personnel"}
                  \u003c/span\u003e
                \u003c/div\u003e
                {sel \u0026\u0026 \u003cspan style={{ fontSize:9,color:p.color,fontWeight:900,letterSpacing:.6,textTransform:"uppercase",flexShrink:0 }}\u003e✓ Actif\u003c/span\u003e}
              \u003c/div\u003e

              {/* STATS GRID — toujours affichées (même avec 0) */}
              \u003cdiv style={{ display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:7,marginBottom:12 }}\u003e
                \u003cdiv className="tip" data-tip="Revenu mensuel de ce profil"
                  style={{ textAlign:"center",padding:"9px 4px",background:"rgba(74,222,128,0.06)",borderRadius:11,border:"1px solid rgba(74,222,128,0.15)" }}\u003e
                  \u003cdiv style={{ fontSize:16,marginBottom:3 }}\u003e💵\u003c/div\u003e
                  \u003cdiv style={{ fontSize:9,color:"var(--text3)",textTransform:"uppercase",letterSpacing:.4,fontWeight:700,marginBottom:2 }}\u003eRevenu\u003c/div\u003e
                  \u003cdiv style={{ fontSize:12,fontWeight:900,color:inc\u003e0?"var(--green)":"var(--text3)" }}\u003e{inc\u003e0?fmt(inc):"—"}\u003c/div\u003e
                \u003c/div\u003e
                \u003cdiv className="tip" data-tip={`${profileTx.length} transaction(s) ce mois`}
                  style={{ textAlign:"center",padding:"9px 4px",background:"rgba(248,113,113,0.06)",borderRadius:11,border:"1px solid rgba(248,113,113,0.14)" }}\u003e
                  \u003cdiv style={{ fontSize:16,marginBottom:3 }}\u003e💸\u003c/div\u003e
                  \u003cdiv style={{ fontSize:9,color:"var(--text3)",textTransform:"uppercase",letterSpacing:.4,fontWeight:700,marginBottom:2 }}\u003eDépensé\u003c/div\u003e
                  \u003cdiv style={{ fontSize:12,fontWeight:900,color:spent\u003e0?"var(--red)":"var(--text3)" }}\u003e{spent\u003e0?fmt(spent):"0 €"}\u003c/div\u003e
                \u003c/div\u003e
                \u003cdiv className="tip" data-tip="Taux d'épargne = (Revenu − Dépenses) / Revenu"
                  style={{ textAlign:"center",padding:"9px 4px",background:"rgba(45,212,191,0.06)",borderRadius:11,border:"1px solid rgba(45,212,191,0.15)" }}\u003e
                  \u003cdiv style={{ fontSize:16,marginBottom:3 }}\u003e💹\u003c/div\u003e
                  \u003cdiv style={{ fontSize:9,color:"var(--text3)",textTransform:"uppercase",letterSpacing:.4,fontWeight:700,marginBottom:2 }}\u003eÉpargne\u003c/div\u003e
                  \u003cdiv style={{ fontSize:12,fontWeight:900,color:savingsRate===null?"var(--text3)":savingsRate\u003c0?"var(--red)":"var(--teal)" }}\u003e
                    {savingsRate!==null?`${savingsRate}%`:"—"}
                  \u003c/div\u003e
                \u003c/div\u003e
              \u003c/div\u003e

              {/* Barre de progression (toujours visible) */}
              \u003cdiv style={{ marginBottom:12 }}\u003e
                \u003cdiv style={{ display:"flex",justifyContent:"space-between",fontSize:10,color:"var(--text3)",marginBottom:5 }}\u003e
                  \u003cspan\u003eBudget utilisé\u003c/span\u003e
                  \u003cspan style={{ fontWeight:800,color:spentPct\u003e80?"var(--red)":spentPct\u003e60?"var(--orange)":inc\u003e0?p.color:"var(--text3)" }}\u003e
                    {inc\u003e0?`${Math.round(spentPct)}%`:"Revenu non défini"}
                  \u003c/span\u003e
                \u003c/div\u003e
                \u003cdiv className="progress-track" style={{ height:5 }}\u003e
                  \u003cdiv className="progress-fill" style={{ width:`${spentPct}%`,background:spentPct\u003e80?"var(--grad-red)":p.color,boxShadow:`0 0 8px ${p.color}50` }}/\u003e
                \u003c/div\u003e
              \u003c/div\u003e

              {/* Top catégories si disponibles */}
              {topProfCat.length\u003e0 \u0026\u0026 (
                \u003cdiv style={{ display:"flex",gap:4,flexWrap:"wrap",marginBottom:12 }}\u003e
                  {topProfCat.map(([cid,amt]) =\u003e {
                    const cat = catMap[cid]||{ icon:"❓",name:"?",color:"#888" };
                    return (
                      \u003cspan key={cid} className="tip" data-tip={`${cat.name} : ${fmt(amt)}`}
                        style={{ display:"inline-flex",alignItems:"center",gap:3,background:`${cat.color}14`,border:`1px solid ${cat.color}25`,borderRadius:20,padding:"2px 8px",fontSize:10,fontWeight:700,color:cat.color }}\u003e
                        {cat.icon} {fmt(amt)}
                      \u003c/span\u003e
                    );
                  })}
                \u003c/div\u003e
              )}

              {/* Nb transactions badge */}
              \u003cdiv style={{ marginBottom:14,display:"flex",alignItems:"center",gap:7,flexWrap:"wrap" }}\u003e
                \u003cspan style={{ fontSize:11,color:"var(--text3)",background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:20,padding:"3px 10px",fontWeight:600 }}\u003e
                  🧾 {profileTx.length} transaction{profileTx.length\u003e1?"s":""}
                \u003c/span\u003e
                {spent\u003e0\u0026\u0026inc\u003e0\u0026\u0026\u003cspan style={{ fontSize:11,color:p.color,background:`${p.color}12`,border:`1px solid ${p.color}28`,borderRadius:20,padding:"3px 10px",fontWeight:700 }}\u003e
                  💰 Reste : {fmt(inc-spent)}
                \u003c/span\u003e}
              \u003c/div\u003e

              {/* BOUTON MODIFIER — grand, gradient couleur profil */}
              \u003cbutton
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
                onMouseEnter={e=\u003e{ e.currentTarget.style.transform="translateY(-2px)"; e.currentTarget.style.boxShadow=`0 10px 30px ${p.color}65, inset 0 1px 0 rgba(255,255,255,0.18)`; }}
                onMouseLeave={e=\u003e{ e.currentTarget.style.transform=""; e.currentTarget.style.boxShadow=`0 6px 22px ${p.color}45, inset 0 1px 0 rgba(255,255,255,0.18)`; }}
                onClick={e=\u003e{ e.stopPropagation(); setModal({ type:"editIncome",profileId:p.id,selMonth }); }}\u003e
                \u003cdiv style={{ width:30,height:30,borderRadius:9,background:"rgba(255,255,255,0.2)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:15,flexShrink:0 }}\u003e✏️\u003c/div\u003e
                \u003cspan style={{ flex:1,textAlign:"left" }}\u003eModifier le revenu de \u003cstrong\u003e{p.name}\u003c/strong\u003e\u003c/span\u003e
                \u003cdiv style={{ background:"rgba(0,0,0,0.18)",borderRadius:9,padding:"4px 10px",fontSize:12,fontWeight:900,flexShrink:0 }}\u003e
                  {inc\u003e0?`+${fmt(inc)}`:"Non défini"}
                \u003c/div\u003e
              \u003c/button\u003e
            \u003c/div\u003e
          );
        })}
      \u003c/div\u003e


      \u003cdiv className="content-grid"\u003e
        \u003cdiv style={{ display:"flex",flexDirection:"column",gap:16 }}\u003e

          {/* BALANCE CARD */}
          \u003cdiv className="card" style={{ position:"relative",overflow:"hidden",borderColor:isPos?"rgba(74,222,128,0.2)":"rgba(248,113,113,0.2)" }}\u003e
            \u003cdiv style={{ position:"absolute",inset:0,background:isPos?"radial-gradient(ellipse 80% 60% at 50% -20%,rgba(74,222,128,0.07),transparent)":"radial-gradient(ellipse 80% 60% at 50% -20%,rgba(248,113,113,0.07),transparent)",pointerEvents:"none" }}/\u003e
            \u003cdiv style={{ display:"flex",gap:3,marginBottom:18,background:"rgba(255,255,255,0.04)",borderRadius:10,padding:3 }}\u003e
              {[{ id:"global",label:"🌐 Global",color:null },...data.profiles.map(p=\u003e({ id:p.id,label:`${p.avatar} ${p.name}`,color:p.color }))].map(v =\u003e (
                \u003cbutton key={v.id} onClick={() =\u003e setBalanceView(v.id)} style={{ flex:1,padding:"7px 4px",borderRadius:8,border:balanceView===v.id?`1px solid ${v.color?v.color+"45":"rgba(255,255,255,0.15)"}`:"1px solid transparent",cursor:"pointer",background:balanceView===v.id?(v.color?`${v.color}18`:"rgba(255,255,255,0.1)"):"transparent",color:balanceView===v.id?(v.color||"var(--text)"):"var(--text3)",fontFamily:"'Outfit',sans-serif",fontWeight:700,fontSize:11,transition:"all .2s",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis" }}\u003e
                  {v.label}
                \u003c/button\u003e
              ))}
            \u003c/div\u003e
            \u003cdiv style={{ fontSize:11,color:"var(--text3)",textTransform:"uppercase",letterSpacing:1.5,textAlign:"center",marginBottom:10 }}\u003eReste à vivre · {viewData.label}\u003c/div\u003e
            \u003cdiv className="stat-num" style={{ fontSize:58,textAlign:"center",color:isPos?"var(--green)":"var(--red)",textShadow:`0 0 40px ${isPos?"rgba(74,222,128,0.25)":"rgba(248,113,113,0.25)"}`,marginBottom:20,lineHeight:1 }}\u003e{fmt(balance)}\u003c/div\u003e
            \u003cdiv style={{ display:"flex",justifyContent:"center",gap:28,marginBottom:16 }}\u003e
              \u003cdiv style={{ textAlign:"center" }}\u003e
                \u003cdiv style={{ fontSize:10,color:"var(--text3)",marginBottom:4,textTransform:"uppercase",letterSpacing:.5 }}\u003e💵 Revenus\u003c/div\u003e
                \u003cdiv style={{ fontSize:18,fontWeight:800,color:"var(--green)" }}\u003e+{fmt(viewData.inc)}\u003c/div\u003e
              \u003c/div\u003e
              \u003cdiv style={{ width:1,background:"var(--border)" }}/\u003e
              \u003cdiv style={{ textAlign:"center" }}\u003e
                \u003cdiv style={{ fontSize:10,color:"var(--text3)",marginBottom:4,textTransform:"uppercase",letterSpacing:.5 }}\u003e💸 Dépenses\u003c/div\u003e
                \u003cdiv style={{ fontSize:18,fontWeight:800,color:"var(--red)" }}\u003e-{fmt(viewData.exp)}\u003c/div\u003e
              \u003c/div\u003e
            \u003c/div\u003e
            {viewData.inc\u003e0 \u0026\u0026 (
              \u003c\u003e
                \u003cdiv style={{ display:"flex",justifyContent:"space-between",fontSize:12,color:"var(--text3)",marginBottom:7 }}\u003e
                  \u003cspan\u003eBudget utilisé\u003c/span\u003e
                  \u003cspan style={{ fontWeight:800,color:pct\u003e80?"var(--red)":pct\u003e60?"var(--orange)":"var(--green)" }}\u003e{Math.round(pct)}%\u003c/span\u003e
                \u003c/div\u003e
                \u003cdiv className="progress-track" style={{ height:8 }}\u003e
                  \u003cdiv className="progress-fill" style={{ width:`${pct}%`,background:pct\u003e80?"var(--grad-red)":pct\u003e60?"linear-gradient(90deg,var(--yellow),var(--orange))":"var(--grad-green)" }}/\u003e
                \u003c/div\u003e
              \u003c/\u003e
            )}
            {isCurMonth \u0026\u0026 totalIncome \u003e 0 \u0026\u0026 (
              \u003cdiv style={{ marginTop:14,borderRadius:16,border:"1px solid rgba(167,139,250,0.2)",overflow:"hidden",background:"rgba(167,139,250,0.03)" }}\u003e
                \u003cdiv style={{ padding:"11px 16px",background:"rgba(167,139,250,0.07)",borderBottom:"1px solid rgba(167,139,250,0.12)",display:"flex",alignItems:"center",justifyContent:"space-between" }}\u003e
                  \u003cdiv style={{ display:"flex",alignItems:"center",gap:8 }}\u003e
                    \u003cspan style={{ fontSize:16 }}\u003e📋\u003c/span\u003e
                    \u003cdiv\u003e
                      \u003cdiv style={{ fontSize:12,fontWeight:800,color:"var(--purple)" }}\u003eBilan fin de mois\u003c/div\u003e
                      \u003cdiv style={{ fontSize:10,color:"var(--text3)",marginTop:1 }}\u003eDépenses réelles + factures à régler\u003c/div\u003e
                    \u003c/div\u003e
                  \u003c/div\u003e
                  \u003cdiv style={{ background:"rgba(167,139,250,0.12)",border:"1px solid rgba(167,139,250,0.22)",borderRadius:20,padding:"3px 10px",fontSize:10,color:"var(--purple)",fontWeight:700,flexShrink:0 }}\u003e
                    {daysInMonth - dayOfMonth} j restants
                  \u003c/div\u003e
                \u003c/div\u003e
                \u003cdiv style={{ padding:"12px 16px 14px" }}\u003e
                  {(() =\u003e {
                    const unpaidTotal = data.bills.filter(b =\u003e !b.paid?.[selMonth] \u0026\u0026 b.amount\u003e0).reduce((s,b)=\u003es+b.amount,0);
                    const projTotal   = totalExp + unpaidTotal;
                    const projBalance = totalIncome - projTotal;
                    const isOver      = projTotal \u003e totalIncome;
                    return (\u003c\u003e
                      \u003cdiv style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:10 }}\u003e
                        {[
                          { icon:"💸",label:"Dépensé",        val:`-${fmt(totalExp)}`,           color:"var(--red)",   bg:"rgba(248,113,113,0.06)",  bd:"rgba(248,113,113,0.14)" },
                          { icon:"📋",label:"Factures restantes", val:unpaidTotal\u003e0?`-${fmt(unpaidTotal)}`:"Tout réglé ✓", color:unpaidTotal\u003e0?"var(--orange)":"var(--green)", bg:unpaidTotal\u003e0?"rgba(251,146,60,0.06)":"rgba(74,222,128,0.06)", bd:unpaidTotal\u003e0?"rgba(251,146,60,0.15)":"rgba(74,222,128,0.15)" },
                          { icon:"⚖️",label:"Solde estimé",   val:fmt(projBalance),              color:projBalance\u003e=0?"var(--green)":"var(--red)", bg:projBalance\u003e=0?"rgba(74,222,128,0.06)":"rgba(248,113,113,0.06)", bd:projBalance\u003e=0?"rgba(74,222,128,0.14)":"rgba(248,113,113,0.14)" },
                        ].map(s=\u003e(
                          \u003cdiv key={s.label} style={{ textAlign:"center",padding:"11px 6px",background:s.bg,borderRadius:12,border:`1px solid ${s.bd}` }}\u003e
                            \u003cdiv style={{ fontSize:18,marginBottom:4 }}\u003e{s.icon}\u003c/div\u003e
                            \u003cdiv style={{ fontSize:9,color:"var(--text3)",textTransform:"uppercase",letterSpacing:.6,fontWeight:800,marginBottom:5 }}\u003e{s.label}\u003c/div\u003e
                            \u003cdiv style={{ fontFamily:"'Fraunces',serif",fontSize:15,fontWeight:900,color:s.color }}\u003e{s.val}\u003c/div\u003e
                          \u003c/div\u003e
                        ))}
                      \u003c/div\u003e
                      \u003cdiv style={{ padding:"7px 12px",borderRadius:10,fontSize:11,fontWeight:700,background:isOver?"rgba(248,113,113,0.08)":"rgba(74,222,128,0.06)",border:`1px solid ${isOver?"rgba(248,113,113,0.2)":"rgba(74,222,128,0.18)"}`,color:isOver?"var(--red)":"var(--green)" }}\u003e
                        {isOver ? `⚠️ Budget dépassé de ${fmt(projTotal-totalIncome)} si toutes les factures sont réglées.` : `✅ Il vous restera ${fmt(projBalance)} après paiement de toutes les factures.`}
                      \u003c/div\u003e
                    \u003c/\u003e);
                  })()}
                \u003c/div\u003e
              \u003c/div\u003e
            )}
          \u003c/div\u003e

          {/* CATEGORY BREAKDOWN */}
          \u003cdiv className="card"\u003e
            \u003cdiv style={{ fontWeight:800,fontSize:14,marginBottom:16,display:"flex",alignItems:"center",gap:9 }}\u003e
              \u003cdiv style={{ width:32,height:32,borderRadius:10,background:"rgba(251,146,60,0.1)",border:"1px solid rgba(251,146,60,0.2)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16 }}\u003e📊\u003c/div\u003e
              Répartition des dépenses
            \u003c/div\u003e
            {topCats.length===0 ? \u003cdiv className="empty-state"\u003e\u003cdiv className="empty-icon"\u003e📊\u003c/div\u003eAucune dépense ce mois\u003c/div\u003e : (
              \u003cdiv style={{ display:"flex",flexDirection:"column",gap:11 }}\u003e
                {topCats.map(([cid,amt]) =\u003e {
                  const cat = catMap[cid]||{ icon:"❓",name:cid,color:"#888" };
                  const p   = totalExp\u003e0 ? (amt/totalExp)*100 : 0;
                  return (
                    \u003cdiv key={cid}\u003e
                      \u003cdiv style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:5 }}\u003e
                        \u003cdiv style={{ display:"flex",alignItems:"center",gap:7 }}\u003e
                          \u003cdiv style={{ width:26,height:26,borderRadius:8,background:`${cat.color}15`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14 }}\u003e{cat.icon}\u003c/div\u003e
                          \u003cspan style={{ fontSize:13,fontWeight:600 }}\u003e{cat.name}\u003c/span\u003e
                          \u003cspan style={{ fontSize:10,color:"var(--text3)",background:"rgba(255,255,255,0.05)",borderRadius:20,padding:"1px 7px" }}\u003e{Math.round(p)}%\u003c/span\u003e
                        \u003c/div\u003e
                        \u003cspan style={{ fontWeight:800,fontSize:13 }}\u003e{fmt(amt)}\u003c/span\u003e
                      \u003c/div\u003e
                      \u003cdiv className="progress-track" style={{ height:5 }}\u003e\u003cdiv className="progress-fill" style={{ width:`${p}%`,background:cat.color }}/\u003e\u003c/div\u003e
                    \u003c/div\u003e
                  );
                })}
              \u003c/div\u003e
            )}
          \u003c/div\u003e

          {/* RECENT TX */}
          \u003cdiv className="card"\u003e\u003cDashboardRecentTx transactions={transactions} catMap={catMap} profMap={profMap}/\u003e\u003c/div\u003e
        \u003c/div\u003e

        {/* ── RIGHT COLUMN ── */}
        \u003cdiv style={{ display:"flex",flexDirection:"column",gap:14 }}\u003e
          {pieData.length\u003e0 \u0026\u0026 (
            \u003cdiv className="card"\u003e
              \u003cdiv style={{ fontWeight:800,fontSize:14,marginBottom:12,display:"flex",alignItems:"center",gap:9 }}\u003e
                \u003cdiv style={{ width:32,height:32,borderRadius:10,background:"rgba(251,146,60,0.1)",border:"1px solid rgba(251,146,60,0.2)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16 }}\u003e🥧\u003c/div\u003e
                Vue circulaire
              \u003c/div\u003e
              \u003cResponsiveContainer width="100%" height={185}\u003e
                \u003cPieChart\u003e
                  \u003cPie data={pieData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={2} dataKey="value"\u003e
                    {pieData.map((e,i) =\u003e \u003cCell key={i} fill={e.color} stroke="transparent"/\u003e)}
                  \u003c/Pie\u003e
                  \u003cTooltip content={\u003cCT/\u003e}/\u003e
                \u003c/PieChart\u003e
              \u003c/ResponsiveContainer\u003e
              \u003cdiv style={{ display:"flex",flexWrap:"wrap",gap:6,marginTop:4 }}\u003e
                {pieData.slice(0,6).map((d,i) =\u003e \u003cdiv key={i} style={{ display:"flex",alignItems:"center",gap:5,fontSize:11 }}\u003e\u003cdiv style={{ width:8,height:8,borderRadius:2,background:d.color,flexShrink:0 }}/\u003e\u003cspan style={{ color:"var(--text3)" }}\u003e{d.name}\u003c/span\u003e\u003c/div\u003e)}
              \u003c/div\u003e
            \u003c/div\u003e
          )}

          {/* BILLS WIDGET — avec HOVER GLOW sur chaque item */}
          \u003cdiv className="card"\u003e
            \u003cdiv style={{ fontWeight:800,fontSize:14,marginBottom:14,display:"flex",alignItems:"center",justifyContent:"space-between" }}\u003e
              \u003cdiv style={{ display:"flex",alignItems:"center",gap:9 }}\u003e
                \u003cdiv style={{ width:32,height:32,borderRadius:10,background:"rgba(167,139,250,0.1)",border:"1px solid rgba(167,139,250,0.2)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16 }}\u003e📋\u003c/div\u003e
                Factures
              \u003c/div\u003e
              \u003cspan style={{ fontSize:11,color:"var(--text3)",fontWeight:600 }}\u003e{monthLabel(selMonth)}\u003c/span\u003e
            \u003c/div\u003e
            {data.bills.length===0 ? (
              \u003cdiv className="empty-state" style={{ padding:"18px 0" }}\u003e\u003cdiv className="empty-icon"\u003e📋\u003c/div\u003eAucune facture\u003c/div\u003e
            ) : (
              \u003c\u003e
                \u003cdiv style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:7,marginBottom:12 }}\u003e
                  {[
                    { v:paid.length,l:"Payées",c:"var(--green)",bg:"rgba(74,222,128,0.08)",bd:"rgba(74,222,128,0.18)" },
                    { v:unpaid.length,l:"En attente",c:"var(--yellow)",bg:"rgba(251,191,36,0.08)",bd:"rgba(251,191,36,0.18)" },
                    { v:overdue.length,l:"En retard",c:"var(--red)",bg:"rgba(248,113,113,0.08)",bd:"rgba(248,113,113,0.22)" },
                  ].map(s =\u003e (
                    \u003cdiv key={s.l} style={{ textAlign:"center",background:s.bg,border:`1px solid ${s.bd}`,borderRadius:11,padding:"9px 4px" }}\u003e
                      \u003cdiv className="stat-num" style={{ fontSize:22,color:s.c }}\u003e{s.v}\u003c/div\u003e
                      \u003cdiv style={{ fontSize:10,color:"var(--text3)",fontWeight:600 }}\u003e{s.l}\u003c/div\u003e
                    \u003c/div\u003e
                  ))}
                \u003c/div\u003e
                \u003cdiv className="progress-track" style={{ height:5,marginBottom:13 }}\u003e
                  \u003cdiv className="progress-fill" style={{ width:`${data.bills.length?(paid.length/data.bills.length)*100:0}%`,background:"var(--grad-green)" }}/\u003e
                \u003c/div\u003e
                \u003cdiv style={{ display:"flex",flexDirection:"column",gap:7 }}\u003e
                  {unpaid.slice(0,4).map(b =\u003e {
                    const due = fmtDue(b.dueDate);
                    const isOvr = b.dueDate\u0026\u0026new Date(b.dueDate)\u003cnew Date();
                    return (
                      \u003cdiv key={b.id}
                        className={`dash-bill-item tip ${isOvr?"overdue":""}`}
                        data-tip={`${b.name} · ${fmt(b.amount)} · ${isOvr?"⚠️ En retard !":`Échéance: ${b.dueDate?new Date(b.dueDate).toLocaleDateString("fr-FR"):"—"}`}`}
                        style={{
                          display:"flex",alignItems:"center",gap:10,padding:"12px 14px",
                          background:isOvr?"rgba(248,113,113,0.06)":"rgba(255,255,255,0.03)",
                          border:`1px solid ${isOvr?"rgba(248,113,113,0.22)":"rgba(255,255,255,0.07)"}`,
                          borderRadius:13,
                        }}\u003e
                        \u003cspan style={{ fontSize:22,flexShrink:0 }}\u003e{b.icon||"📋"}\u003c/span\u003e
                        \u003cdiv style={{ flex:1,minWidth:0 }}\u003e
                          \u003cdiv style={{ fontWeight:700,fontSize:13,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}\u003e{b.name}\u003c/div\u003e
                          {due \u0026\u0026 \u003cdiv style={{ display:"flex",alignItems:"center",gap:4,marginTop:3 }}\u003e
                            \u003cspan style={{ fontSize:11,color:due.color,fontWeight:700 }}\u003e📅 {due.text}\u003c/span\u003e
                          \u003c/div\u003e}
                        \u003c/div\u003e
                        \u003cdiv style={{ fontWeight:800,fontSize:14,color:isOvr?"var(--red)":"var(--orange)",flexShrink:0 }}\u003e-{fmt(b.amount)}\u003c/div\u003e
                      \u003c/div\u003e
                    );
                  })}
                  {unpaid.length\u003e4 \u0026\u0026 \u003cdiv style={{ textAlign:"center",fontSize:11,color:"var(--text3)",padding:"5px 0" }}\u003e+{unpaid.length-4} autre{unpaid.length-4\u003e1?"s":""}\u003c/div\u003e}
                  {unpaid.length===0 \u0026\u0026 \u003cdiv style={{ textAlign:"center",fontSize:13,color:"var(--green)",fontWeight:700,padding:"10px 0" }}\u003e🎉 Toutes les factures sont payées !\u003c/div\u003e}
                \u003c/div\u003e
              \u003c/\u003e
            )}
          \u003c/div\u003e

          {/* QUICK STATS */}
          \u003cdiv className="card"\u003e
            \u003cdiv style={{ fontWeight:800,fontSize:14,marginBottom:13,display:"flex",alignItems:"center",gap:9 }}\u003e
              \u003cdiv style={{ width:32,height:32,borderRadius:10,background:"rgba(251,191,36,0.1)",border:"1px solid rgba(251,191,36,0.2)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16 }}\u003e⚡\u003c/div\u003e
              Stats rapides
            \u003c/div\u003e
            \u003cdiv style={{ display:"flex",flexDirection:"column",gap:7 }}\u003e
              {[
                { label:"Tx. moy./jour",    val:fmt(dayOfMonth\u003e0?totalExp/dayOfMonth:0),  icon:"📅",color:"var(--blue)",  tip:"Dépense moyenne par jour ce mois" },
                { label:"Plus grosse dép.", val:transactions.length?fmt(Math.max(...transactions.map(t=\u003et.amount))):"—",icon:"🔺",color:"var(--orange)",tip:"Transaction la plus élevée" },
                { label:"Nb. transactions", val:transactions.length,icon:"🧾",color:"var(--purple)",tip:"Nombre d'opérations enregistrées" },
                { label:"Taux d'épargne",   val:totalIncome\u003e0?`${Math.round(((totalIncome-totalExp)/totalIncome)*100)}%`:"—",icon:"💹",color:"var(--green)",tip:"Pourcentage du revenu non dépensé" },
              ].map(s =\u003e (
                \u003cdiv key={s.label} className="tip" data-tip={s.tip}
                  style={{ display:"flex",alignItems:"center",gap:10,padding:"10px 12px",background:"rgba(255,255,255,0.025)",borderRadius:11,border:"1px solid rgba(255,255,255,0.05)",transition:"all .2s",cursor:"default" }}
                  onMouseEnter={e=\u003e{e.currentTarget.style.background="rgba(255,255,255,0.05)";e.currentTarget.style.borderColor="rgba(255,255,255,0.1)";}}
                  onMouseLeave={e=\u003e{e.currentTarget.style.background="rgba(255,255,255,0.025)";e.currentTarget.style.borderColor="rgba(255,255,255,0.05)";}}\u003e
                  \u003cspan style={{ fontSize:17 }}\u003e{s.icon}\u003c/span\u003e
                  \u003cspan style={{ flex:1,fontSize:12.5,color:"var(--text2)",fontWeight:600 }}\u003e{s.label}\u003c/span\u003e
                  \u003cspan style={{ fontWeight:800,fontSize:14,color:s.color }}\u003e{s.val}\u003c/span\u003e
                \u003c/div\u003e
              ))}
            \u003c/div\u003e
          \u003c/div\u003e
        \u003c/div\u003e
      \u003c/div\u003e
    \u003c/div\u003e
  );
}


function LiveClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() =\u003e { const t = setInterval(() =\u003e setNow(new Date()), 1000); return () =\u003e clearInterval(t); }, []);
  const weekday = now.toLocaleDateString("fr-FR", { weekday:"long" });
  const day     = now.toLocaleDateString("fr-FR", { day:"numeric" });
  const month   = now.toLocaleDateString("fr-FR", { month:"long" });
  const year    = now.getFullYear();
  const hh = pad(now.getHours()), mm = pad(now.getMinutes()), ss = pad(now.getSeconds());
  return (
    \u003cdiv className="topbar-clock"\u003e
      \u003cdiv className="topbar-clock-date"\u003e
        \u003cdiv style={{ fontSize:10,color:"rgba(237,233,248,0.42)",textTransform:"uppercase",letterSpacing:2,fontWeight:900,marginBottom:3 }}\u003e
          {weekday}
        \u003c/div\u003e
        \u003cdiv style={{ fontSize:14,color:"rgba(237,233,248,0.88)",fontWeight:800,lineHeight:1,letterSpacing:-.2 }}\u003e
          {day} {month} \u003cspan style={{ color:"rgba(237,233,248,0.38)",fontWeight:600,fontSize:12 }}\u003e{year}\u003c/span\u003e
        \u003c/div\u003e
      \u003c/div\u003e
      \u003cdiv className="topbar-clock-time"\u003e
        \u003cspan style={{ fontSize:28,fontWeight:900,color:"var(--text)",letterSpacing:-2,lineHeight:1 }}\u003e{hh}:{mm}\u003c/span\u003e
        \u003cspan style={{ fontSize:15,fontWeight:800,color:"var(--purple)",minWidth:26,lineHeight:1,animation:"pulse 1s steps(1) infinite",alignSelf:"flex-end",paddingBottom:1 }}\u003e:{ss}\u003c/span\u003e
      \u003c/div\u003e
    \u003c/div\u003e
  );
}

function Incomes({ data, update, selMonth, mdata, setModal }) {
  const md = mdata(selMonth);
  const { incomes } = md;
  const totalInc = (incomes.p1||0)+(incomes.p2||0)+(incomes.common||0);
  const totalExp = md.transactions.reduce((s,t) =\u003e s+t.amount, 0);

  return (
    \u003cdiv className="fade-up content-grid"\u003e
      \u003cdiv style={{ display:"flex",flexDirection:"column",gap:16 }}\u003e
        \u003cdiv style={{ fontWeight:700,fontSize:12,color:"var(--text3)",textTransform:"uppercase",letterSpacing:1.5 }}\u003eRevenus — {monthLabel(selMonth)}\u003c/div\u003e

        {data.profiles.map((p,i) =\u003e {
          const inc = incomes[p.id]||0;
          const pctOfTotal = totalInc\u003e0 ? (inc/totalInc)*100 : 0;
          const profileTx = md.transactions.filter(t=\u003et.profileId===p.id);
          const profileSpent = profileTx.reduce((s,t)=\u003es+t.amount,0);
          const savingsRate = inc\u003e0 ? Math.round(((inc-profileSpent)/inc)*100) : null;
          const remaining = inc - profileSpent;
          const isCommon = p.id==="common";
          const typeLabel = isCommon ? "🏦 Compte commun" : "💼 Compte personnel";
          const typeDesc  = isCommon ? "Fonds partagés du couple" : "Revenu individuel mensuel";
          return (
            \u003cdiv key={p.id} className={`income-card fade-up stagger-${i+1}`}
              style={{ padding:0,background:"var(--glass)",border:`1px solid var(--border)`,boxShadow:"var(--shadow-card)" }}\u003e

              {/* BANDE COULEUR TOP */}
              \u003cdiv style={{ height:4,background:`linear-gradient(90deg,${p.color},${p.color}44)`,borderRadius:"var(--r) var(--r) 0 0" }}/\u003e

              \u003cdiv style={{ padding:"22px 24px" }}\u003e
                {/* ── HEADER ── */}
                \u003cdiv style={{ display:"flex",alignItems:"flex-start",gap:16,marginBottom:20 }}\u003e
                  \u003cdiv className="tip" data-tip={`${p.name} · ${typeDesc}`} style={{ position:"relative",flexShrink:0 }}\u003e
                    \u003cdiv style={{ width:64,height:64,borderRadius:18,background:`${p.color}18`,border:`2px solid ${p.color}40`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:32,boxShadow:`0 8px 24px ${p.color}25` }}\u003e
                      {p.avatar}
                    \u003c/div\u003e
                    \u003cdiv style={{ position:"absolute",bottom:-5,right:-5,width:22,height:22,borderRadius:"50%",background:"var(--grad-main)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,border:"2.5px solid var(--bg2)",fontWeight:900,color:"#fff" }}\u003e
                      {isCommon?"🏦":p.id==="p1"?"1":"2"}
                    \u003c/div\u003e
                  \u003c/div\u003e
                  \u003cdiv style={{ flex:1,minWidth:0 }}\u003e
                    \u003cdiv style={{ fontWeight:900,fontSize:20,color:p.color,marginBottom:4,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}\u003e{p.name}\u003c/div\u003e
                    \u003cspan className="tip" data-tip={typeDesc}
                      style={{ display:"inline-flex",alignItems:"center",gap:5,fontSize:11,fontWeight:700,padding:"3px 11px",borderRadius:20,background:`${p.color}15`,border:`1px solid ${p.color}30`,color:p.color,textTransform:"uppercase",letterSpacing:.5 }}\u003e
                      {typeLabel}
                    \u003c/span\u003e
                    \u003cdiv style={{ fontSize:12,color:"var(--text3)",marginTop:6 }}\u003e
                      {isCommon ? "Revenus partagés du couple" : `${profileTx.length} transaction${profileTx.length\u003e1?"s":""} ce mois`}
                    \u003c/div\u003e
                  \u003c/div\u003e
                  \u003cdiv style={{ textAlign:"right",flexShrink:0 }}\u003e
                    \u003cdiv style={{ fontSize:9,color:"var(--text3)",textTransform:"uppercase",letterSpacing:1,fontWeight:700,marginBottom:4 }}\u003eRevenu mensuel\u003c/div\u003e
                    \u003cdiv className="stat-num" style={{ fontSize:30,color:inc\u003e0?"var(--green)":"var(--text3)",lineHeight:1,textShadow:inc\u003e0?"0 0 30px rgba(74,222,128,0.25)":"none" }}\u003e
                      {inc\u003e0?`+${fmt(inc)}`:"—"}
                    \u003c/div\u003e
                    {totalInc\u003e0\u0026\u0026inc\u003e0\u0026\u0026\u003cdiv style={{ fontSize:11,color:"var(--text3)",marginTop:3,fontWeight:600 }}\u003e{Math.round(pctOfTotal)}% du total\u003c/div\u003e}
                  \u003c/div\u003e
                \u003c/div\u003e

                {/* ── STATS GRID 3 colonnes ── */}
                \u003cdiv style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:16 }}\u003e
                  {[
                    { icon:"💵",label:"Revenu",fullLabel:"Revenu mensuel",val:inc\u003e0?`+${fmt(inc)}`:"Non défini",color:"var(--green)",tip:"Revenu mensuel de ce profil",bg:"rgba(74,222,128,0.06)",bd:"rgba(74,222,128,0.15)" },
                    { icon:"💸",label:"Dépensé",fullLabel:"Total dépensé",val:profileSpent\u003e0?`-${fmt(profileSpent)}`:"0 €",color:"var(--red)",tip:`Somme des ${profileTx.length} transactions de ce profil`,bg:"rgba(248,113,113,0.06)",bd:"rgba(248,113,113,0.14)" },
                    { icon:"💹",label:"Épargne",fullLabel:"Taux d'épargne",val:savingsRate!==null?`${savingsRate}%`:"—",color:savingsRate!==null\u0026\u0026savingsRate\u003c0?"var(--red)":"var(--teal)",tip:"Taux d'épargne = (Revenu - Dépenses) / Revenu",bg:"rgba(45,212,191,0.06)",bd:"rgba(45,212,191,0.15)" },
                  ].map(s =\u003e (
                    \u003cdiv key={s.label} className="tip" data-tip={s.tip}
                      style={{ textAlign:"center",padding:"12px 8px",background:s.bg,borderRadius:13,border:`1px solid ${s.bd}`,transition:"all .2s",cursor:"default" }}
                      onMouseEnter={e=\u003e{e.currentTarget.style.transform="translateY(-2px)";e.currentTarget.style.boxShadow="0 6px 20px rgba(0,0,0,0.2)";}}
                      onMouseLeave={e=\u003e{e.currentTarget.style.transform="";e.currentTarget.style.boxShadow="";}}\u003e
                      \u003cdiv style={{ fontSize:20,marginBottom:5 }}\u003e{s.icon}\u003c/div\u003e
                      \u003cdiv style={{ fontSize:9,color:"var(--text3)",textTransform:"uppercase",letterSpacing:.5,fontWeight:800,marginBottom:4 }}\u003e{s.fullLabel}\u003c/div\u003e
                      \u003cdiv className="stat-num" style={{ fontSize:14,fontWeight:900,color:s.color }}\u003e{s.val}\u003c/div\u003e
                    \u003c/div\u003e
                  ))}
                \u003c/div\u003e

                {/* ── BARRE DE PROGRESSION ── */}
                {inc\u003e0 \u0026\u0026 (
                  \u003cdiv style={{ marginBottom:16 }}\u003e
                    \u003cdiv style={{ display:"flex",justifyContent:"space-between",alignItems:"center",fontSize:11,color:"var(--text3)",marginBottom:7 }}\u003e
                      \u003cspan style={{ fontWeight:600 }}\u003ePart du revenu total utilisée\u003c/span\u003e
                      \u003cspan style={{ fontWeight:800,color:profileSpent/inc\u003e0.8?"var(--red)":profileSpent/inc\u003e0.6?"var(--orange)":p.color }}\u003e
                        {Math.round(profileSpent/inc*100)}%
                      \u003c/span\u003e
                    \u003c/div\u003e
                    \u003cdiv className="progress-track" style={{ height:7 }}\u003e
                      \u003cdiv className="progress-fill" style={{ width:`${Math.min(100,(profileSpent/inc)*100)}%`,background:profileSpent/inc\u003e0.8?"var(--grad-red)":p.color,boxShadow:`0 0 12px ${p.color}40` }}/\u003e
                    \u003c/div\u003e
                    \u003cdiv style={{ display:"flex",justifyContent:"space-between",fontSize:10,color:"var(--text3)",marginTop:5 }}\u003e
                      \u003cspan\u003e💸 Dépensé : {fmt(profileSpent)}\u003c/span\u003e
                      \u003cspan style={{ color:remaining\u003e=0?"var(--green)":"var(--red)",fontWeight:700 }}\u003e
                        {remaining\u003e=0?"💰":"⚠️"} Reste : {fmt(Math.abs(remaining))}
                      \u003c/span\u003e
                    \u003c/div\u003e
                  \u003c/div\u003e
                )}

                {/* ── PART DU TOTAL ── */}
                {totalInc\u003e0\u0026\u0026inc\u003e0\u0026\u0026(
                  \u003cdiv style={{ marginBottom:16 }}\u003e
                    \u003cdiv style={{ display:"flex",justifyContent:"space-between",fontSize:11,color:"var(--text3)",marginBottom:7 }}\u003e
                      \u003cspan style={{ fontWeight:600 }}\u003ePart du revenu total du foyer\u003c/span\u003e
                      \u003cspan style={{ fontWeight:800,color:p.color }}\u003e{Math.round(pctOfTotal)}%\u003c/span\u003e
                    \u003c/div\u003e
                    \u003cdiv className="progress-track" style={{ height:5 }}\u003e
                      \u003cdiv className="progress-fill" style={{ width:`${pctOfTotal}%`,background:p.color,boxShadow:`0 0 10px ${p.color}50` }}/\u003e
                    \u003c/div\u003e
                  \u003c/div\u003e
                )}

                {/* ── BOUTON MODIFIER PLEINE LARGEUR — couleur du profil ── */}
                \u003cbutton className="tip"
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
                  onMouseEnter={e=\u003e{e.currentTarget.style.transform="translateY(-2px)";e.currentTarget.style.boxShadow=`0 8px 28px ${p.color}60`;}}
                  onMouseLeave={e=\u003e{e.currentTarget.style.transform="";e.currentTarget.style.boxShadow=`0 4px 18px ${p.color}45`;}}
                  onClick={() =\u003e setModal({ type:"editIncome",profileId:p.id,selMonth })}\u003e
                  \u003cdiv style={{ width:26,height:26,borderRadius:8,background:"rgba(255,255,255,0.2)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14 }}\u003e✏️\u003c/div\u003e
                  Modifier le revenu de \u003cstrong\u003e{p.name}\u003c/strong\u003e
                \u003c/button\u003e
              \u003c/div\u003e
            \u003c/div\u003e
          );
        })}

        {data.recurringIncomes?.length\u003e0 \u0026\u0026 (
          \u003cdiv className="card"\u003e
            \u003cdiv style={{ fontWeight:700,fontSize:13,marginBottom:14,display:"flex",alignItems:"center",gap:6 }}\u003e
              🔄 Revenus récurrents
              \u003cspan style={{ marginLeft:"auto",background:"rgba(74,222,128,0.12)",color:"var(--green)",borderRadius:20,padding:"2px 8px",fontSize:11 }}\u003e{data.recurringIncomes.length} actif{data.recurringIncomes.length\u003e1?"s":""}\u003c/span\u003e
            \u003c/div\u003e
            {data.recurringIncomes.map(ri =\u003e {
              const prof = data.profiles.find(p =\u003e p.id===ri.profileId);
              return (
                \u003cdiv key={ri.id} style={{ display:"flex",alignItems:"center",gap:12,padding:"11px 0",borderBottom:"1px solid var(--border)" }}\u003e
                  \u003cdiv style={{ width:38,height:38,borderRadius:10,background:`${prof?.color||"#888"}18`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:22 }}\u003e{prof?.avatar||"❓"}\u003c/div\u003e
                  \u003cdiv style={{ flex:1 }}\u003e
                    \u003cdiv style={{ fontWeight:600,fontSize:13 }}\u003e{prof?.name}\u003c/div\u003e
                    \u003cdiv style={{ fontSize:11,color:"var(--text3)" }}\u003eDepuis {fmtDate(ri.startDate)} · Mensuel\u003c/div\u003e
                  \u003c/div\u003e
                  \u003cdiv style={{ fontWeight:800,color:"var(--green)",fontSize:15 }}\u003e+{fmt(ri.amount)}\u003c/div\u003e
                  \u003cbutton className="btn-icon tip" data-tip="Supprimer ce revenu récurrent" style={{ color:"var(--red)",background:"rgba(248,113,113,0.08)" }}
                    onClick={() =\u003e update(d =\u003e { d.recurringIncomes = d.recurringIncomes.filter(r =\u003e r.id!==ri.id); })}\u003e🗑\u003c/button\u003e
                \u003c/div\u003e
              );
            })}
          \u003c/div\u003e
        )}
      \u003c/div\u003e

      \u003cdiv style={{ display:"flex",flexDirection:"column",gap:14 }}\u003e
        \u003cdiv className="card"\u003e
          \u003cdiv style={{ fontWeight:700,fontSize:13,marginBottom:14 }}\u003e📊 Récapitulatif\u003c/div\u003e
          {[
            { label:"Total revenus",  val:`+${fmt(totalInc)}`,                  color:"var(--green)",  icon:"💵",tip:"Somme de tous les revenus du mois" },
            { label:"Total dépenses", val:`-${fmt(totalExp)}`,                  color:"var(--red)",    icon:"💸",tip:"Somme de toutes les dépenses" },
            { label:"Reste à vivre",  val:fmt(totalInc-totalExp),               color:totalInc\u003e=totalExp?"var(--green)":"var(--red)",icon:"⚖️",tip:"Revenu - Dépenses = budget disponible" },
            { label:"Taux d'épargne", val:totalInc\u003e0?`${Math.round(((totalInc-totalExp)/totalInc)*100)}%`:"—",color:"var(--purple)",icon:"💹",tip:"Pourcentage du revenu non dépensé" },
          ].map(s =\u003e (
            \u003cdiv key={s.label} className="tip" data-tip={s.tip} style={{ display:"flex",alignItems:"center",gap:12,padding:"11px 0",borderBottom:"1px solid var(--border)" }}\u003e
              \u003cspan style={{ fontSize:20 }}\u003e{s.icon}\u003c/span\u003e
              \u003cspan style={{ flex:1,fontSize:13,color:"var(--text2)" }}\u003e{s.label}\u003c/span\u003e
              \u003cspan style={{ fontWeight:800,fontSize:15,color:s.color }}\u003e{s.val}\u003c/span\u003e
            \u003c/div\u003e
          ))}
        \u003c/div\u003e
        \u003cdiv className="card" style={{ textAlign:"center",padding:28 }}\u003e
          \u003cdiv style={{ fontSize:42,marginBottom:10 }}\u003e🔄\u003c/div\u003e
          \u003cdiv style={{ fontWeight:700,marginBottom:6 }}\u003eRevenus récurrents\u003c/div\u003e
          \u003cdiv style={{ fontSize:12,color:"var(--text2)",marginBottom:18 }}\u003eConfigurez un revenu mensuel automatique\u003c/div\u003e
          \u003cbutton className="btn btn-primary" style={{ width:"100%" }} onClick={() =\u003e setModal({ type:"addRecurringIncome" })}\u003e+ Ajouter un revenu récurrent\u003c/button\u003e
        \u003c/div\u003e
      \u003c/div\u003e
    \u003c/div\u003e
  );
}


function Expenses({ data, update, selMonth, mdata, setModal }) {
  const isMobile = useIsMobile();
  const md = mdata(selMonth);
  const { transactions } = md;
  const [filter, setFilter]   = useState("all");
  const [search, setSearch]   = useState("");
  const [sort, setSort]       = useState("date_desc");
  const [groupBy, setGroupBy] = useState("none");
  const [confirmClear, setConfirmClear] = useState(false);
  const deferredSearch = useDeferredValue(search);

  const catMap  = useMemo(() =\u003e Object.fromEntries(data.categories.map(c=\u003e[c.id,c])), [data.categories]);
  const profMap = useMemo(() =\u003e Object.fromEntries(data.profiles.map(p=\u003e[p.id,p])), [data.profiles]);

  const filtered = useMemo(() =\u003e {
    let txs = filter==="all" ? transactions : transactions.filter(t =\u003e t.profileId===filter||t.categoryId===filter);
    if (deferredSearch.trim()) { const q=deferredSearch.toLowerCase(); txs = txs.filter(t =\u003e t.label.toLowerCase().includes(q)||(catMap[t.categoryId]?.name||"").toLowerCase().includes(q)); }
    return txs;
  }, [transactions,filter,deferredSearch,catMap]);

  const sorted = useMemo(() =\u003e {
    const arr = [...filtered];
    switch(sort) {
      case "date_asc":    return arr.sort((a,b) =\u003e new Date(a.timestamp)-new Date(b.timestamp));
      case "amount_desc": return arr.sort((a,b) =\u003e b.amount-a.amount);
      case "amount_asc":  return arr.sort((a,b) =\u003e a.amount-b.amount);
      default:            return arr.sort((a,b) =\u003e new Date(b.timestamp)-new Date(a.timestamp));
    }
  }, [filtered,sort]);

  const total    = useMemo(() =\u003e sorted.reduce((s,t)=\u003es+t.amount,0), [sorted]);
  const totalAll = useMemo(() =\u003e transactions.reduce((s,t)=\u003es+t.amount,0), [transactions]);

  const del = id =\u003e update(d =\u003e { ensureMonth(d,selMonth); d.monthsData[selMonth].transactions = d.monthsData[selMonth].transactions.filter(t=\u003et.id!==id); });
  const duplicate = tx =\u003e update(d =\u003e { ensureMonth(d,selMonth); d.monthsData[selMonth].transactions.push({ ...tx,id:mkid(),timestamp:nowISO(),auto:false }); });
  const clearAll = () =\u003e { update(d =\u003e { ensureMonth(d,selMonth); d.monthsData[selMonth].transactions = []; }); setConfirmClear(false); };

  const grouped = useMemo(() =\u003e {
    if (groupBy==="none") return [{ key:"all",label:null,items:sorted }];
    if (groupBy==="day") {
      const map = new Map();
      sorted.forEach(tx =\u003e {
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
      sorted.forEach(tx =\u003e {
        const cat = catMap[tx.categoryId]||{ id:"?",name:"Autre",icon:"❓",color:"#888" };
        if (!map.has(cat.id)) map.set(cat.id,{ key:cat.id,label:cat.name,icon:cat.icon,color:cat.color,items:[] });
        map.get(cat.id).items.push(tx);
      });
      return Array.from(map.values()).sort((a,b) =\u003e b.items.reduce((s,t)=\u003es+t.amount,0)-a.items.reduce((s,t)=\u003es+t.amount,0));
    }
    return [{ key:"all",label:null,items:sorted }];
  }, [sorted,groupBy,catMap]);

  return (
    \u003cdiv className="fade-up"\u003e
      {/* KPI BAR */}
      \u003cdiv className="expenses-kpi-bar" style={{ display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:18 }}\u003e
        {[
          { label:"Total dépensé",    val:`-${fmt(totalAll)}`,  color:"var(--red)",    icon:"💸",bg:"rgba(248,113,113,0.08)",border:"rgba(248,113,113,0.18)",tip:"Somme totale des dépenses" },
          { label:"Transactions",     val:transactions.length,  color:"var(--text)",   icon:"🧾",bg:"rgba(255,255,255,0.03)",border:"var(--border)",tip:"Nombre d'opérations enregistrées" },
          { label:"Dépense moyenne",  val:fmt(transactions.length?totalAll/transactions.length:0),color:"var(--orange)",icon:"📊",bg:"rgba(251,146,60,0.08)",border:"rgba(251,146,60,0.18)",tip:"Montant moyen par transaction" },
          { label:"Plus grosse dép.", val:transactions.length?fmt(Math.max(...transactions.map(t=\u003et.amount))):"—",color:"var(--purple)",icon:"🔺",bg:"rgba(167,139,250,0.08)",border:"rgba(167,139,250,0.2)",tip:"Transaction la plus élevée du mois" },
        ].map(s =\u003e (
          \u003cdiv key={s.label} className="tip" data-tip={s.tip}
            style={{ background:s.bg,border:`1px solid ${s.border}`,borderRadius:14,padding:isMobile?"10px 10px":"16px 18px",display:"flex",alignItems:"center",gap:isMobile?8:13,cursor:"default",transition:"all .2s",minHeight:isMobile?72:undefined }}
            onMouseEnter={isMobile?undefined:e=\u003e{e.currentTarget.style.transform="translateY(-2px)";e.currentTarget.style.boxShadow="0 8px 28px rgba(0,0,0,0.3)";}}
            onMouseLeave={isMobile?undefined:e=\u003e{e.currentTarget.style.transform="";e.currentTarget.style.boxShadow="";}}\u003e
            \u003cdiv style={{ width:isMobile?32:42,height:isMobile?32:42,borderRadius:12,background:"rgba(255,255,255,0.06)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:isMobile?16:20,flexShrink:0 }}\u003e{s.icon}\u003c/div\u003e
            \u003cdiv style={{ minWidth:0 }}\u003e
              \u003cdiv style={{ fontSize:isMobile?9:10.5,color:"var(--text3)",textTransform:"uppercase",letterSpacing:.9,fontWeight:800,marginBottom:4,lineHeight:1.2 }}\u003e{s.label}\u003c/div\u003e
              \u003cdiv className="stat-num" style={{ fontSize:isMobile?13:17,fontWeight:900,color:s.color }}\u003e{s.val}\u003c/div\u003e
            \u003c/div\u003e
          \u003c/div\u003e
        ))}
      \u003c/div\u003e

      {/* TOOLBAR */}
      {isMobile ? (
        \u003cdiv style={{ marginBottom:12 }}\u003e
          {/* Ligne 1 : recherche */}
          \u003cdiv style={{ position:"relative",marginBottom:8 }}\u003e
            \u003cspan style={{ position:"absolute",left:12,top:"50%",transform:"translateY(-50%)",fontSize:13,pointerEvents:"none",opacity:.4 }}\u003e🔍\u003c/span\u003e
            \u003cinput value={search} onChange={e =\u003e setSearch(e.target.value)} placeholder="Rechercher…" style={{ paddingLeft:34,background:"rgba(255,255,255,0.05)",border:"1px solid var(--border)",borderRadius:10,fontSize:13 }}/\u003e
            {search \u0026\u0026 \u003cbutton onClick={() =\u003e setSearch("")} style={{ position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",color:"var(--text3)",fontSize:18,lineHeight:1 }}\u003e×\u003c/button\u003e}
          \u003c/div\u003e
          {/* Ligne 2 : tri + groupe + actions */}
          \u003cdiv style={{ display:"flex",gap:6 }}\u003e
            \u003cselect value={sort} onChange={e =\u003e setSort(e.target.value)} style={{ flex:1,padding:"8px 8px",fontSize:11,background:"rgba(255,255,255,0.06)",border:"1px solid var(--border)",borderRadius:10 }}\u003e
              \u003coption value="date_desc"\u003eDate ↓\u003c/option\u003e\u003coption value="date_asc"\u003eDate ↑\u003c/option\u003e
              \u003coption value="amount_desc"\u003eMontant ↓\u003c/option\u003e\u003coption value="amount_asc"\u003eMontant ↑\u003c/option\u003e
            \u003c/select\u003e
            \u003cselect value={groupBy} onChange={e =\u003e setGroupBy(e.target.value)} style={{ flex:1,padding:"8px 8px",fontSize:11,background:"rgba(255,255,255,0.06)",border:"1px solid var(--border)",borderRadius:10 }}\u003e
              \u003coption value="none"\u003eSans groupe\u003c/option\u003e\u003coption value="day"\u003ePar jour\u003c/option\u003e\u003coption value="category"\u003ePar catégorie\u003c/option\u003e
            \u003c/select\u003e
            \u003cbutton type="button" onClick={() =\u003e setModal({ type:"importCIC", selMonth })}
              style={{ flexShrink:0,padding:"8px 10px",borderRadius:10,border:"1px solid rgba(27,46,143,0.4)",background:"rgba(27,46,143,0.12)",color:"#8AACFF",cursor:"pointer",fontSize:11,fontWeight:700,fontFamily:"'Outfit',sans-serif",touchAction:"manipulation",WebkitTapHighlightColor:"transparent" }}\u003e
              🏦 CIC
            \u003c/button\u003e
            {transactions.length\u003e0 \u0026\u0026 !confirmClear \u0026\u0026 (
              \u003cbutton type="button" onClick={() =\u003e setConfirmClear(true)}
                style={{ flexShrink:0,padding:"8px 10px",borderRadius:10,border:"1px solid rgba(248,113,113,0.22)",background:"rgba(248,113,113,0.07)",color:"var(--red)",cursor:"pointer",fontSize:11,fontWeight:700,fontFamily:"'Outfit',sans-serif",touchAction:"manipulation",WebkitTapHighlightColor:"transparent" }}\u003e
                🗑
              \u003c/button\u003e
            )}
            {confirmClear \u0026\u0026 (
              \u003c\u003e
                \u003cbutton type="button" onClick={clearAll} style={{ flexShrink:0,padding:"8px 12px",borderRadius:9,border:"1px solid rgba(248,113,113,0.5)",background:"rgba(248,113,113,0.2)",color:"var(--red)",cursor:"pointer",fontSize:12,fontWeight:800,fontFamily:"'Outfit',sans-serif",touchAction:"manipulation",WebkitTapHighlightColor:"transparent" }}\u003eOui\u003c/button\u003e
                \u003cbutton type="button" onClick={() =\u003e setConfirmClear(false)} style={{ flexShrink:0,padding:"8px 12px",borderRadius:9,border:"1px solid var(--border)",background:"var(--glass)",color:"var(--text2)",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"'Outfit',sans-serif",touchAction:"manipulation",WebkitTapHighlightColor:"transparent" }}\u003eNon\u003c/button\u003e
              \u003c/\u003e
            )}
          \u003c/div\u003e
        \u003c/div\u003e
      ) : (
      \u003cdiv className="expenses-toolbar" style={{ display:"flex",gap:8,marginBottom:14,alignItems:"center",background:"var(--glass)",border:"1px solid var(--border)",borderRadius:15,padding:"10px 14px",flexWrap:"wrap" }}\u003e
        \u003cdiv style={{ position:"relative",flex:1,minWidth:180 }}\u003e
          \u003cspan style={{ position:"absolute",left:12,top:"50%",transform:"translateY(-50%)",fontSize:13,pointerEvents:"none",opacity:.4 }}\u003e🔍\u003c/span\u003e
          \u003cinput value={search} onChange={e =\u003e setSearch(e.target.value)} placeholder="Rechercher une dépense…" style={{ paddingLeft:34,background:"rgba(255,255,255,0.05)",border:"1px solid var(--border)",borderRadius:10,fontSize:13 }}/\u003e
          {search \u0026\u0026 \u003cbutton onClick={() =\u003e setSearch("")} style={{ position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",color:"var(--text3)",fontSize:18,lineHeight:1 }}\u003e×\u003c/button\u003e}
        \u003c/div\u003e
        \u003cdiv className="tip" data-tip="Trier les transactions" style={{ display:"flex",alignItems:"center",gap:6,flexShrink:0 }}\u003e
          \u003cspan style={{ fontSize:11,color:"var(--text3)",fontWeight:800,whiteSpace:"nowrap" }}\u003e↕\u003c/span\u003e
          \u003cselect value={sort} onChange={e =\u003e setSort(e.target.value)} style={{ width:"auto",padding:"8px 10px",fontSize:12,background:"rgba(255,255,255,0.06)",border:"1px solid var(--border)",borderRadius:10 }}\u003e
            \u003coption value="date_desc"\u003eDate ↓\u003c/option\u003e\u003coption value="date_asc"\u003eDate ↑\u003c/option\u003e
            \u003coption value="amount_desc"\u003eMontant ↓\u003c/option\u003e\u003coption value="amount_asc"\u003eMontant ↑\u003c/option\u003e
          \u003c/select\u003e
        \u003c/div\u003e
        \u003cdiv className="tip" data-tip="Grouper les transactions" style={{ display:"flex",alignItems:"center",gap:6,flexShrink:0 }}\u003e
          \u003cspan style={{ fontSize:11,color:"var(--text3)",fontWeight:800,whiteSpace:"nowrap" }}\u003e⊞\u003c/span\u003e
          \u003cselect value={groupBy} onChange={e =\u003e setGroupBy(e.target.value)} style={{ width:"auto",padding:"8px 10px",fontSize:12,background:"rgba(255,255,255,0.06)",border:"1px solid var(--border)",borderRadius:10 }}\u003e
            \u003coption value="none"\u003eAucun\u003c/option\u003e\u003coption value="day"\u003ePar jour\u003c/option\u003e\u003coption value="category"\u003ePar catégorie\u003c/option\u003e
          \u003c/select\u003e
        \u003c/div\u003e
        \u003cbutton onClick={() =\u003e setModal({ type:"importCIC", selMonth })} className="tip" data-tip="Importer les opérations CIC depuis le presse-papiers"
          style={{ display:"flex",alignItems:"center",gap:6,padding:"8px 14px",borderRadius:10,border:"1px solid rgba(27,46,143,0.4)",background:"rgba(27,46,143,0.12)",color:"#8AACFF",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"'Outfit',sans-serif",transition:"all .2s",flexShrink:0 }}
          onMouseEnter={e=\u003e{e.currentTarget.style.background="rgba(27,46,143,0.25)";e.currentTarget.style.borderColor="rgba(27,46,143,0.6)";e.currentTarget.style.color="#fff";}}
          onMouseLeave={e=\u003e{e.currentTarget.style.background="rgba(27,46,143,0.12)";e.currentTarget.style.borderColor="rgba(27,46,143,0.4)";e.currentTarget.style.color="#8AACFF";}}\u003e
          🏦 Importer CIC
        \u003c/button\u003e
        {transactions.length\u003e0 \u0026\u0026 !confirmClear \u0026\u0026 (
          \u003cbutton onClick={() =\u003e setConfirmClear(true)} className="tip" data-tip="Supprimer toutes les dépenses du mois"
            style={{ display:"flex",alignItems:"center",gap:6,padding:"8px 14px",borderRadius:10,border:"1px solid rgba(248,113,113,0.22)",background:"rgba(248,113,113,0.07)",color:"var(--red)",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"'Outfit',sans-serif",transition:"all .2s",flexShrink:0 }}
            onMouseEnter={e=\u003e{e.currentTarget.style.background="rgba(248,113,113,0.18)";e.currentTarget.style.borderColor="rgba(248,113,113,0.45)";}}
            onMouseLeave={e=\u003e{e.currentTarget.style.background="rgba(248,113,113,0.07)";e.currentTarget.style.borderColor="rgba(248,113,113,0.22)";}}\u003e
            🗑 Tout effacer
          \u003c/button\u003e
        )}
        {confirmClear \u0026\u0026 (
          \u003cdiv style={{ display:"flex",alignItems:"center",gap:6,flexShrink:0 }}\u003e
            \u003cspan style={{ fontSize:12,color:"var(--red)",fontWeight:700 }}\u003eConfirmer ?\u003c/span\u003e
            \u003cbutton onClick={clearAll} style={{ padding:"7px 12px",borderRadius:9,border:"1px solid rgba(248,113,113,0.5)",background:"rgba(248,113,113,0.2)",color:"var(--red)",cursor:"pointer",fontSize:12,fontWeight:800,fontFamily:"'Outfit',sans-serif" }}\u003eOui\u003c/button\u003e
            \u003cbutton onClick={() =\u003e setConfirmClear(false)} style={{ padding:"7px 12px",borderRadius:9,border:"1px solid var(--border)",background:"var(--glass)",color:"var(--text2)",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"'Outfit',sans-serif" }}\u003eAnnuler\u003c/button\u003e
          \u003c/div\u003e
        )}
      \u003c/div\u003e
      )}

      {/* FILTER CHIPS */}
      \u003cdiv style={{ marginBottom:16,paddingTop:4 }}\u003e
        \u003cdiv className="filter-bar" style={{
          display:"flex",
          gap:7,
          flexWrap: isMobile ? "nowrap" : "wrap",
          overflowX: isMobile ? "auto" : "visible",
          overflowY: "visible",
          paddingBottom:8,
          paddingTop:4,
          WebkitOverflowScrolling:"touch",
          scrollbarWidth:"none",
          msOverflowStyle:"none",
        }}\u003e
          {[
            { id:"all",label:"Tout",icon:"",tip:"Afficher toutes les dépenses" },
            ...data.profiles.map(p =\u003e ({ id:p.id,label:p.name,icon:p.avatar,tip:`Dépenses de ${p.name}`,color:p.color })),
            ...data.categories.map(c =\u003e ({ id:c.id,label:c.name,icon:c.icon,tip:`Catégorie : ${c.name}`,color:c.color })),
          ].map(f =\u003e (
            \u003cdiv key={f.id}
              className={`filter-chip ${filter===f.id?"active":""}`}
              onClick={() =\u003e setFilter(filter===f.id\u0026\u0026f.id!=="all"?"all":f.id)}
              style={{
                flexShrink: isMobile ? 0 : undefined,
                ...(filter===f.id\u0026\u0026f.color ? { borderColor:f.color+"66",background:f.color+"18",color:f.color,boxShadow:`0 2px 12px ${f.color}22` } : {}),
              }}\u003e
              {f.icon \u0026\u0026 \u003cspan className="chip-emoji"\u003e{f.icon}\u003c/span\u003e}
              \u003cspan\u003e{f.label}\u003c/span\u003e
            \u003c/div\u003e
          ))}
        \u003c/div\u003e
      \u003c/div\u003e

      {/* RESULTS HEADER */}
      \u003cdiv style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14,padding:"0 2px" }}\u003e
        \u003cdiv style={{ display:"flex",alignItems:"center",gap:9 }}\u003e
          \u003cspan style={{ fontSize:13,color:"var(--text2)",fontWeight:700 }}\u003e{sorted.length} transaction{sorted.length!==1?"s":""}\u003c/span\u003e
          {search \u0026\u0026 \u003cspan style={{ fontSize:11,background:"rgba(167,139,250,0.12)",border:"1px solid rgba(167,139,250,0.25)",color:"var(--purple)",borderRadius:20,padding:"3px 10px",fontWeight:700 }}\u003e🔍 "{search}"\u003c/span\u003e}
          {filter!=="all" \u0026\u0026 \u003cbutton onClick={() =\u003e setFilter("all")} style={{ fontSize:11,background:"rgba(251,146,60,0.1)",border:"1px solid rgba(251,146,60,0.25)",color:"var(--orange)",borderRadius:20,padding:"3px 10px",fontWeight:700,cursor:"pointer",fontFamily:"'Outfit',sans-serif" }}\u003e✕ Filtre actif\u003c/button\u003e}
        \u003c/div\u003e
        \u003cdiv style={{ fontFamily:"'Fraunces',serif",fontSize:22,fontWeight:900,color:"var(--red)",textShadow:"0 0 20px rgba(248,113,113,0.3)" }}\u003e-{fmt(total)}\u003c/div\u003e
      \u003c/div\u003e

      {/* TRANSACTION LIST */}
      {sorted.length===0 ? (
        \u003cdiv className="card empty-state"\u003e
          \u003cdiv className="empty-icon"\u003e{search?"🔍":"💸"}\u003c/div\u003e
          \u003cdiv style={{ fontSize:16,fontWeight:700,marginBottom:6 }}\u003e{search?"Aucun résultat":"Aucune dépense ce mois"}\u003c/div\u003e
          \u003cdiv style={{ fontSize:13 }}\u003e{search?`Aucune dépense pour "${search}"`:"Ajoutez votre première dépense !"}\u003c/div\u003e
        \u003c/div\u003e
      ) : (
        \u003cdiv style={{ display:"flex",flexDirection:"column",gap:groupBy==="none"?0:16 }}\u003e
          {grouped.map((group) =\u003e {
            const groupTotal = group.items.reduce((s,t)=\u003es+t.amount,0);
            return (
              \u003cdiv key={group.key}\u003e
                {group.label \u0026\u0026 (
                  \u003cdiv style={{ display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 6px",marginBottom:8 }}\u003e
                    \u003cdiv style={{ display:"flex",alignItems:"center",gap:10 }}\u003e
                      {group.icon \u0026\u0026 \u003cdiv style={{ width:32,height:32,borderRadius:10,background:`${group.color}18`,border:`1px solid ${group.color}28`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:17 }}\u003e{group.icon}\u003c/div\u003e}
                      {!group.icon \u0026\u0026 \u003cdiv style={{ width:6,height:24,borderRadius:3,background:"var(--grad-main)" }}/\u003e}
                      \u003cspan style={{ fontSize:14,fontWeight:900,color:"var(--text)",textTransform:groupBy==="day"?"capitalize":"none" }}\u003e{group.label}\u003c/span\u003e
                      \u003cspan style={{ fontSize:11,color:"var(--text3)",background:"rgba(255,255,255,0.06)",borderRadius:20,padding:"2px 9px",fontWeight:700 }}\u003e{group.items.length} tx\u003c/span\u003e
                    \u003c/div\u003e
                    \u003cspan style={{ fontFamily:"'Fraunces',serif",fontWeight:800,fontSize:16,color:"var(--red)" }}\u003e-{fmt(groupTotal)}\u003c/span\u003e
                  \u003c/div\u003e
                )}

                \u003cdiv style={{ background:"var(--glass)",border:"1px solid var(--border)",borderRadius:18,overflow:"visible",boxShadow:"0 2px 20px rgba(0,0,0,0.2)",position:"relative" }}\u003e
                  {group.items.map((tx, idx) =\u003e {
                    const cat  = catMap[tx.categoryId]||{ icon:"❓",color:"#888",name:"Autre" };
                    const prof = profMap[tx.profileId]||{ avatar:"❓",name:"?",color:"#888" };
                    const isLast = idx===group.items.length-1;
                    const pct = totalAll\u003e0 ? Math.round((tx.amount/totalAll)*100) : 0;
                    const amountBar = totalAll\u003e0 ? (tx.amount/totalAll)*100 : 0;

                    return (
                      \u003cdiv key={tx.id}
                        style={{
                          borderBottom: isLast ? "none" : "1px solid rgba(255,255,255,0.05)",
                          background: "transparent",
                          transition: isMobile ? "none" : "background .2s",
                          borderRadius: isLast ? "0 0 18px 18px" : 0,
                        }}
                        onMouseEnter={isMobile ? undefined : e =\u003e { e.currentTarget.style.background=`linear-gradient(135deg,${cat.color}08,rgba(167,139,250,0.05))`; }}
                        onMouseLeave={isMobile ? undefined : e =\u003e { e.currentTarget.style.background="transparent"; }}\u003e

                        {isMobile ? (
                          /* ── MOBILE LAYOUT ── */
                          \u003cdiv style={{ padding:"12px 14px" }}\u003e
                            {/* Row 1: icon + title + amount */}
                            \u003cdiv style={{ display:"flex",alignItems:"center",gap:10,marginBottom:8 }}\u003e
                              {/* Icon — overflow:hidden pour que le badge ne déborde pas */}
                              \u003cdiv style={{ position:"relative",flexShrink:0,width:50,height:50 }}\u003e
                                \u003cdiv style={{ width:50,height:50,borderRadius:14,background:`linear-gradient(135deg,${cat.color}22,${cat.color}08)`,border:`2px solid ${cat.color}35`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:24 }}\u003e
                                  {cat.icon}
                                \u003c/div\u003e
                                \u003cdiv style={{ position:"absolute",bottom:0,right:0,width:18,height:18,borderRadius:"50%",background:prof.color||"var(--bg3)",border:"2px solid var(--bg)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,pointerEvents:"none",zIndex:1 }}\u003e
                                  {prof.avatar}
                                \u003c/div\u003e
                              \u003c/div\u003e
                              {/* Title + category */}
                              \u003cdiv style={{ flex:1,minWidth:0 }}\u003e
                                \u003cdiv style={{ fontWeight:800,fontSize:14,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",marginBottom:3 }}\u003e{tx.label}\u003c/div\u003e
                                \u003cdiv style={{ display:"flex",alignItems:"center",gap:5,flexWrap:"nowrap",overflow:"hidden" }}\u003e
                                  \u003cspan style={{ display:"inline-flex",alignItems:"center",gap:3,background:`${cat.color}15`,borderRadius:20,padding:"2px 8px",border:`1px solid ${cat.color}25`,fontSize:11,fontWeight:700,color:cat.color,flexShrink:0 }}\u003e
                                    {cat.icon} {cat.name}
                                  \u003c/span\u003e
                                  \u003cspan style={{ fontSize:10.5,color:"var(--text3)",flexShrink:0 }}\u003e
                                    🕐 {smartDate(tx.timestamp)}
                                  \u003c/span\u003e
                                \u003c/div\u003e
                              \u003c/div\u003e
                              {/* Amount */}
                              \u003cdiv style={{ fontFamily:"'Fraunces',serif",fontWeight:900,fontSize:17,color:"var(--red)",flexShrink:0 }}\u003e
                                -{fmt(tx.amount)}
                              \u003c/div\u003e
                            \u003c/div\u003e
                            {/* Row 2: action buttons — height fixe pour éviter le décalage iOS */}
                            \u003cdiv style={{ display:"flex",gap:6 }}\u003e
                              \u003cbutton
                                type="button"
                                onTouchEnd={e =\u003e { e.preventDefault(); e.stopPropagation(); setModal({ type:"editTransaction",tx,selMonth }); }}
                                onClick={e =\u003e { e.stopPropagation(); setModal({ type:"editTransaction",tx,selMonth }); }}
                                style={{ flex:1,height:40,display:"flex",alignItems:"center",justifyContent:"center",gap:4,borderRadius:10,border:"1px solid rgba(167,139,250,0.4)",background:"rgba(167,139,250,0.1)",color:"var(--purple)",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"'Outfit',sans-serif",touchAction:"manipulation",WebkitTapHighlightColor:"transparent",userSelect:"none" }}\u003e
                                ✏️ Modifier
                              \u003c/button\u003e
                              \u003cbutton
                                type="button"
                                onTouchEnd={e =\u003e { e.preventDefault(); e.stopPropagation(); duplicate(tx); }}
                                onClick={e =\u003e { e.stopPropagation(); duplicate(tx); }}
                                style={{ flex:1,height:40,display:"flex",alignItems:"center",justifyContent:"center",gap:4,borderRadius:10,border:"1px solid rgba(96,165,250,0.4)",background:"rgba(96,165,250,0.1)",color:"#60a5fa",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"'Outfit',sans-serif",touchAction:"manipulation",WebkitTapHighlightColor:"transparent",userSelect:"none" }}\u003e
                                📋 Dupliquer
                              \u003c/button\u003e
                              \u003cbutton
                                type="button"
                                onTouchEnd={e =\u003e { e.preventDefault(); e.stopPropagation(); del(tx.id); }}
                                onClick={e =\u003e { e.stopPropagation(); del(tx.id); }}
                                style={{ flex:1,height:40,display:"flex",alignItems:"center",justifyContent:"center",gap:4,borderRadius:10,border:"1px solid rgba(248,113,113,0.4)",background:"rgba(248,113,113,0.1)",color:"var(--red)",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"'Outfit',sans-serif",touchAction:"manipulation",WebkitTapHighlightColor:"transparent",userSelect:"none" }}\u003e
                                🗑 Suppr.
                              \u003c/button\u003e
                            \u003c/div\u003e
                          \u003c/div\u003e
                        ) : (
                          /* ── DESKTOP LAYOUT ── */
                          \u003cdiv className="expense-row" style={{ display:"flex",alignItems:"center",gap:16,padding:"20px 22px",borderLeft:"3px solid transparent",transition:"all .22s" }}
                            onMouseEnter={e =\u003e { e.currentTarget.style.borderLeftColor=cat.color; e.currentTarget.style.paddingLeft="28px"; }}
                            onMouseLeave={e =\u003e { e.currentTarget.style.borderLeftColor="transparent"; e.currentTarget.style.paddingLeft="22px"; }}\u003e

                            \u003cdiv style={{ position:"relative",flexShrink:0 }} className="tx-icon-wrap"\u003e
                              \u003cdiv className="tx-icon" style={{ width:62,height:62,borderRadius:20,background:`linear-gradient(135deg,${cat.color}22,${cat.color}08)`,border:`2px solid ${cat.color}35`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:28,boxShadow:`0 8px 22px ${cat.color}20,inset 0 1px 0 rgba(255,255,255,0.07)` }}\u003e
                                {cat.icon}
                              \u003c/div\u003e
                              \u003cdiv className="tx-badge" style={{ position:"absolute",bottom:-6,right:-6,width:24,height:24,borderRadius:"50%",background:prof.color||"var(--bg3)",border:"2.5px solid var(--bg)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,boxShadow:`0 2px 8px rgba(0,0,0,0.5)` }}\u003e
                                {prof.avatar}
                              \u003c/div\u003e
                            \u003c/div\u003e

                            \u003cdiv className="tx-text-col" style={{ display:"flex",flexDirection:"column",gap:8,flex:1,minWidth:0 }}\u003e
                              \u003cdiv style={{ display:"flex",alignItems:"center",gap:8 }}\u003e
                                \u003cspan className="tx-title" style={{ fontWeight:900,fontSize:16,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:260 }}\u003e{tx.label}\u003c/span\u003e
                                {tx.auto \u0026\u0026 \u003cspan style={{ flexShrink:0,fontSize:9.5,background:"rgba(167,139,250,0.15)",border:"1px solid rgba(167,139,250,0.3)",color:"var(--purple)",borderRadius:20,padding:"2px 8px",fontWeight:800 }}\u003e🤖 AUTO\u003c/span\u003e}
                              \u003c/div\u003e
                              \u003cdiv style={{ display:"flex",alignItems:"center",gap:6,flexWrap:"wrap" }}\u003e
                                \u003cspan className="tip" data-tip={`Profil : ${prof.name}`} style={{ display:"inline-flex",alignItems:"center",gap:5,background:`${prof.color||"#888"}12`,borderRadius:20,padding:"4px 11px",border:`1px solid ${prof.color||"#888"}25`,fontSize:12,fontWeight:700,color:prof.color||"var(--text2)" }}\u003e
                                  \u003cspan style={{ fontSize:14 }}\u003e{prof.avatar}\u003c/span\u003e\u003cspan\u003e{prof.name}\u003c/span\u003e
                                \u003c/span\u003e
                                \u003cspan className="tip" data-tip={`Catégorie : ${cat.name}`} style={{ display:"inline-flex",alignItems:"center",gap:5,background:`${cat.color}12`,borderRadius:20,padding:"4px 11px",border:`1px solid ${cat.color}28`,fontSize:12,fontWeight:700,color:cat.color }}\u003e
                                  \u003cspan\u003e{cat.icon}\u003c/span\u003e\u003cspan\u003e{cat.name}\u003c/span\u003e
                                \u003c/span\u003e
                                \u003cspan className="tip" data-tip="Date" style={{ display:"inline-flex",alignItems:"center",gap:4,background:"rgba(255,255,255,0.04)",borderRadius:20,padding:"4px 11px",border:"1px solid rgba(255,255,255,0.07)",fontSize:11.5,color:"var(--text3)",fontWeight:600 }}\u003e
                                  🕐 {smartDate(tx.timestamp)}
                                \u003c/span\u003e
                              \u003c/div\u003e
                              \u003cdiv style={{ display:"flex",alignItems:"center",gap:8 }}\u003e
                                \u003cdiv style={{ flex:1,maxWidth:160,height:3,background:"rgba(255,255,255,0.07)",borderRadius:3,overflow:"hidden" }}\u003e
                                  \u003cdiv style={{ width:`${amountBar}%`,height:"100%",background:`linear-gradient(90deg,${cat.color},${cat.color}80)`,borderRadius:3,transition:"width .6s" }}/\u003e
                                \u003c/div\u003e
                                \u003cspan style={{ fontSize:10,color:"var(--text3)",fontWeight:700 }}\u003e{pct}% du total\u003c/span\u003e
                              \u003c/div\u003e
                            \u003c/div\u003e

                            \u003cdiv className="tx-amount-col tip" data-tip={`${pct}% du total mensuel`} style={{ marginLeft:"auto",textAlign:"right",flexShrink:0,minWidth:100 }}\u003e
                              \u003cdiv style={{ fontFamily:"'Fraunces',serif",fontWeight:900,fontSize:22,color:"var(--red)",textShadow:"0 0 18px rgba(248,113,113,0.3)",letterSpacing:-.5 }}\u003e
                                -{fmt(tx.amount)}
                              \u003c/div\u003e
                            \u003c/div\u003e

                            \u003cdiv className="row-actions" style={{ display:"flex",flexDirection:"column",gap:5,flexShrink:0 }}\u003e
                              \u003cbutton onClick={() =\u003e setModal({ type:"editTransaction",tx,selMonth })} className="action-btn action-btn-edit tip" data-tip="Modifier"\u003e✏️ Modifier\u003c/button\u003e
                              \u003cbutton onClick={() =\u003e duplicate(tx)} className="action-btn action-btn-dup tip" data-tip="Dupliquer"\u003e📋 Dupliquer\u003c/button\u003e
                              \u003cbutton onClick={() =\u003e del(tx.id)} className="action-btn action-btn-del tip" data-tip="Supprimer"\u003e🗑 Supprimer\u003c/button\u003e
                            \u003c/div\u003e
                          \u003c/div\u003e
                        )}
                      \u003c/div\u003e
                    );
                  })}
                \u003c/div\u003e
              \u003c/div\u003e
            );
          })}
        \u003c/div\u003e
      )}
    \u003c/div\u003e
  );
}


function Bills({ data, update, selMonth, mdata, setModal }) {
  const [search, setSearch]         = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [confirmClear, setConfirmClear] = useState(false);

  const toggle = billId =\u003e {
    update(d =\u003e {
      const bill = d.bills.find(b =\u003e b.id===billId);
      if (!bill) return;
      if (!bill.paid) bill.paid = {};
      const wasPaid = bill.paid[selMonth];
      bill.paid[selMonth] = !wasPaid;
      ensureMonth(d, selMonth);
      if (!wasPaid) {
        d.monthsData[selMonth].transactions.push({ id:mkid(),label:bill.name,amount:bill.amount||0,categoryId:bill.categoryId||"c7",profileId:bill.profileId||"common",timestamp:nowISO(),fromBill:billId });
      } else {
        d.monthsData[selMonth].transactions = d.monthsData[selMonth].transactions.filter(t =\u003e t.fromBill!==billId);
      }
    });
  };

  const del = id =\u003e update(d =\u003e { d.bills = d.bills.filter(b =\u003e b.id!==id); });

  const clearAllBills = () =\u003e {
    update(d =\u003e {
      if (d.monthsData[selMonth]) {
        d.monthsData[selMonth].transactions = (d.monthsData[selMonth].transactions||[]).filter(t =\u003e !t.fromBill);
      }
      d.bills.forEach(b =\u003e { if (b.paid) delete b.paid[selMonth]; });
    });
    setConfirmClear(false);
  };

  const allBillsFiltered = useMemo(() =\u003e {
    let bills = [...data.bills];
    if (search.trim()) { const q=search.toLowerCase(); bills = bills.filter(b =\u003e b.name.toLowerCase().includes(q)); }
    const now = new Date();
    bills = bills.filter(b =\u003e {
      const isPaid = b.paid?.[selMonth];
      const isOverdue = b.dueDate\u0026\u0026new Date(b.dueDate)\u003cnow\u0026\u0026!isPaid;
      if (filterStatus==="paid")    return isPaid;
      if (filterStatus==="unpaid")  return !isPaid\u0026\u0026!isOverdue;
      if (filterStatus==="overdue") return isOverdue;
      return true;
    });
    return bills;
  }, [data.bills,search,filterStatus,selMonth]);

  const overdueList  = useMemo(() =\u003e allBillsFiltered.filter(b=\u003e!b.paid?.[selMonth]\u0026\u0026b.dueDate\u0026\u0026new Date(b.dueDate)\u003cnew Date()).sort((a,b)=\u003enew Date(a.dueDate)-new Date(b.dueDate)), [allBillsFiltered,selMonth]);
  const pendingList  = useMemo(() =\u003e allBillsFiltered.filter(b=\u003e!b.paid?.[selMonth]\u0026\u0026!(b.dueDate\u0026\u0026new Date(b.dueDate)\u003cnew Date())).sort((a,b)=\u003e{ if(!a.dueDate)return 1; if(!b.dueDate)return -1; return new Date(a.dueDate)-new Date(b.dueDate); }), [allBillsFiltered,selMonth]);
  const unpaid = useMemo(() =\u003e allBillsFiltered.filter(b=\u003e!b.paid?.[selMonth]).sort((a,b)=\u003e{ if(!a.dueDate)return 1; if(!b.dueDate)return -1; return new Date(a.dueDate)-new Date(b.dueDate); }), [allBillsFiltered,selMonth]);
  const paid        = useMemo(() =\u003e allBillsFiltered.filter(b=\u003eb.paid?.[selMonth]), [allBillsFiltered,selMonth]);
  const totalUnpaid = useMemo(() =\u003e data.bills.filter(b=\u003e!b.paid?.[selMonth]).reduce((s,b)=\u003es+(b.amount||0),0), [data.bills,selMonth]);
  const totalPaid   = useMemo(() =\u003e data.bills.filter(b=\u003eb.paid?.[selMonth]).reduce((s,b)=\u003es+(b.amount||0),0), [data.bills,selMonth]);
  const overdueCount = useMemo(() =\u003e data.bills.filter(b=\u003eb.dueDate\u0026\u0026new Date(b.dueDate)\u003cnew Date()\u0026\u0026!b.paid?.[selMonth]).length, [data.bills,selMonth]);

  return (
    \u003cdiv className="fade-up content-grid"\u003e
      \u003cdiv\u003e
        \u003cdiv style={{ marginBottom:16,display:"flex",flexDirection:"column",gap:10 }}\u003e
          \u003cdiv style={{ display:"flex",gap:8,alignItems:"center" }}\u003e
            \u003cdiv style={{ position:"relative",flex:1 }}\u003e
              \u003cspan style={{ position:"absolute",left:14,top:"50%",transform:"translateY(-50%)",fontSize:14,pointerEvents:"none",opacity:.5 }}\u003e🔍\u003c/span\u003e
              \u003cinput value={search} onChange={e =\u003e setSearch(e.target.value)} placeholder="Rechercher une facture…"
                style={{ paddingLeft:40,background:"rgba(255,255,255,0.06)",border:"1px solid var(--border)",borderRadius:13,fontSize:13,height:42 }}/\u003e
              {search \u0026\u0026 \u003cbutton onClick={() =\u003e setSearch("")} style={{ position:"absolute",right:12,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",color:"var(--text3)",fontSize:16,lineHeight:1 }}\u003e×\u003c/button\u003e}
            \u003c/div\u003e
            {data.bills.length\u003e0 \u0026\u0026 !confirmClear \u0026\u0026 (
              \u003cbutton className="tip" data-tip={`Réinitialiser toutes les factures de ${monthLabel(selMonth)}`}
                onClick={() =\u003e setConfirmClear(true)}
                style={{ display:"flex",alignItems:"center",gap:6,padding:"10px 14px",borderRadius:11,border:"1px solid rgba(248,113,113,0.25)",background:"rgba(248,113,113,0.07)",color:"var(--red)",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"'Outfit',sans-serif",transition:"all .2s",flexShrink:0,whiteSpace:"nowrap" }}
                onMouseEnter={e=\u003e{e.currentTarget.style.background="rgba(248,113,113,0.2)";}}
                onMouseLeave={e=\u003e{e.currentTarget.style.background="rgba(248,113,113,0.07)";}}\u003e
                🗑 Effacer le mois
              \u003c/button\u003e
            )}
            {confirmClear \u0026\u0026 (
              \u003cdiv style={{ display:"flex",alignItems:"center",gap:6,flexShrink:0,background:"rgba(248,113,113,0.08)",border:"1px solid rgba(248,113,113,0.25)",borderRadius:12,padding:"8px 12px" }}\u003e
                \u003cspan style={{ fontSize:12,color:"var(--red)",fontWeight:700 }}\u003eRéinitialiser ?\u003c/span\u003e
                \u003cbutton onClick={clearAllBills} style={{ padding:"5px 10px",borderRadius:8,border:"1px solid rgba(248,113,113,0.5)",background:"rgba(248,113,113,0.25)",color:"var(--red)",cursor:"pointer",fontSize:11,fontWeight:800,fontFamily:"'Outfit',sans-serif" }}\u003eOui\u003c/button\u003e
                \u003cbutton onClick={() =\u003e setConfirmClear(false)} style={{ padding:"5px 10px",borderRadius:8,border:"1px solid var(--border)",background:"var(--glass)",color:"var(--text2)",cursor:"pointer",fontSize:11,fontWeight:700,fontFamily:"'Outfit',sans-serif" }}\u003eNon\u003c/button\u003e
              \u003c/div\u003e
            )}
          \u003c/div\u003e
          \u003cdiv style={{ display:"flex",gap:7,flexWrap:"wrap" }}\u003e
            {[
              { id:"all",     label:"Toutes",       count:data.bills.length },
              { id:"unpaid",  label:"En attente",   count:data.bills.filter(b=\u003e!b.paid?.[selMonth]\u0026\u0026!(b.dueDate\u0026\u0026new Date(b.dueDate)\u003cnew Date())).length },
              { id:"overdue", label:"⚠️ En retard", count:overdueCount },
              { id:"paid",    label:"✅ Payées",     count:data.bills.filter(b=\u003eb.paid?.[selMonth]).length },
            ].map(f =\u003e (
              \u003cbutton key={f.id} onClick={() =\u003e setFilterStatus(f.id)} style={{
                padding:"6px 13px",borderRadius:20,border:"none",cursor:"pointer",fontFamily:"'Outfit',sans-serif",fontSize:12,fontWeight:700,
                background:filterStatus===f.id?(f.id==="overdue"?"rgba(248,113,113,0.2)":f.id==="paid"?"rgba(74,222,128,0.15)":"rgba(167,139,250,0.15)"):"rgba(255,255,255,0.05)",
                color:filterStatus===f.id?(f.id==="overdue"?"var(--red)":f.id==="paid"?"var(--green)":"var(--purple)"):"var(--text3)",
                border:`1px solid ${filterStatus===f.id?(f.id==="overdue"?"rgba(248,113,113,0.35)":f.id==="paid"?"rgba(74,222,128,0.3)":"rgba(167,139,250,0.3)"):"var(--border)"}`,
                transition:"all .15s",display:"flex",alignItems:"center",gap:5,
              }}\u003e
                {f.label}\u003cspan style={{ background:"rgba(255,255,255,0.08)",borderRadius:10,padding:"1px 6px",fontSize:10 }}\u003e{f.count}\u003c/span\u003e
              \u003c/button\u003e
            ))}
          \u003c/div\u003e
        \u003c/div\u003e

        {data.bills.length===0 ? (
          \u003cdiv className="card empty-state"\u003e\u003cdiv className="empty-icon"\u003e📋\u003c/div\u003eAucune facture configurée\u003c/div\u003e
        ) : allBillsFiltered.length===0 ? (
          \u003cdiv className="card empty-state"\u003e
            \u003cdiv className="empty-icon"\u003e{search?"🔍":"📋"}\u003c/div\u003e
            \u003cdiv style={{ fontSize:15,fontWeight:700,marginBottom:6 }}\u003e{search?"Aucun résultat":"Aucune facture"}\u003c/div\u003e
          \u003c/div\u003e
        ) : (
          \u003c\u003e
            {overdueList.length\u003e0 \u0026\u0026 (
              \u003cdiv style={{ marginBottom:16 }}\u003e
                \u003cdiv className="bill-section-hdr" style={{ color:"var(--red)" }}\u003e
                  \u003cspan\u003e⚠️\u003c/span\u003e\u003cspan\u003eEn retard de paiement ({overdueList.length})\u003c/span\u003e
                \u003c/div\u003e
                \u003cdiv style={{ background:"rgba(248,113,113,0.04)",borderRadius:14,border:"1px solid rgba(248,113,113,0.12)",padding:"2px 0",marginBottom:4 }}\u003e
                  \u003cdiv style={{ padding:"8px 14px 4px",fontSize:11,color:"var(--red)",fontWeight:600,opacity:.8 }}\u003e
                    💳 Ces prélèvements automatiques ont dépassé leur date d'échéance. Marquez-les comme payés une fois débités.
                  \u003c/div\u003e
                \u003c/div\u003e
                {overdueList.map((b,i) =\u003e \u003cBillRow key={b.id} bill={b} selMonth={selMonth} onToggle={toggle} onDelete={del} profiles={data.profiles} idx={i} setModal={setModal}/\u003e)}
              \u003c/div\u003e
            )}
            {pendingList.length\u003e0 \u0026\u0026 (
              \u003cdiv style={{ marginBottom:16 }}\u003e
                \u003cdiv className="bill-section-hdr" style={{ color:"var(--yellow)" }}\u003e
                  \u003cspan\u003e⏳\u003c/span\u003e\u003cspan\u003eEn attente ({pendingList.length})\u003c/span\u003e
                \u003c/div\u003e
                {pendingList.map((b,i) =\u003e \u003cBillRow key={b.id} bill={b} selMonth={selMonth} onToggle={toggle} onDelete={del} profiles={data.profiles} idx={i} setModal={setModal}/\u003e)}
              \u003c/div\u003e
            )}
            {paid.length\u003e0 \u0026\u0026 (
              \u003cdiv\u003e
                \u003cdiv className="bill-section-hdr" style={{ color:"var(--green)" }}\u003e
                  \u003cspan\u003e✅\u003c/span\u003e\u003cspan\u003eRéglées ({paid.length})\u003c/span\u003e
                \u003c/div\u003e
                {paid.map((b,i) =\u003e \u003cBillRow key={b.id} bill={b} selMonth={selMonth} onToggle={toggle} onDelete={del} profiles={data.profiles} idx={i} setModal={setModal}/\u003e)}
              \u003c/div\u003e
            )}
          \u003c/\u003e
        )}
      \u003c/div\u003e

      \u003cdiv style={{ display:"flex",flexDirection:"column",gap:14 }}\u003e
        \u003cdiv className="card"\u003e
          \u003cdiv style={{ fontWeight:700,fontSize:13,marginBottom:14 }}\u003e📊 Progression — {monthLabel(selMonth)}\u003c/div\u003e
          \u003cdiv style={{ display:"flex",gap:10,marginBottom:14 }}\u003e
            {[
              { l:"Payées",    v:data.bills.filter(b=\u003eb.paid?.[selMonth]).length,  c:"var(--green)",bg:"rgba(74,222,128,0.08)" },
              { l:"En attente",v:data.bills.filter(b=\u003e!b.paid?.[selMonth]).length, c:"var(--yellow)",bg:"rgba(251,191,36,0.08)" },
            ].map(s =\u003e (
              \u003cdiv key={s.l} style={{ flex:1,textAlign:"center",background:s.bg,borderRadius:12,padding:"12px 6px" }}\u003e
                \u003cdiv className="stat-num" style={{ fontSize:28,color:s.c }}\u003e{s.v}\u003c/div\u003e
                \u003cdiv style={{ fontSize:11,color:"var(--text3)" }}\u003e{s.l}\u003c/div\u003e
              \u003c/div\u003e
            ))}
          \u003c/div\u003e
          \u003cdiv className="progress-track" style={{ height:10,marginBottom:10 }}\u003e
            \u003cdiv className="progress-fill" style={{ width:data.bills.length?`${(data.bills.filter(b=\u003eb.paid?.[selMonth]).length/data.bills.length)*100}%`:"0%",background:"var(--grad-green)" }}/\u003e
          \u003c/div\u003e
          \u003cdiv style={{ display:"flex",justifyContent:"space-between",fontSize:12,color:"var(--text3)",marginBottom:12 }}\u003e
            \u003cspan\u003e{data.bills.length} factures\u003c/span\u003e
            \u003cspan style={{ color:"var(--red)",fontWeight:700 }}\u003e{totalUnpaid\u003e0?`-${fmt(totalUnpaid)} restant`:"🎉 Tout payé !"}\u003c/span\u003e
          \u003c/div\u003e
          {totalPaid\u003e0 \u0026\u0026 (
            \u003cdiv style={{ display:"flex",justifyContent:"space-between",fontSize:12,padding:"8px 12px",background:"rgba(74,222,128,0.06)",borderRadius:10 }}\u003e
              \u003cspan style={{ color:"var(--text3)" }}\u003eDéjà réglé\u003c/span\u003e
              \u003cspan style={{ color:"var(--green)",fontWeight:700 }}\u003e+{fmt(totalPaid)}\u003c/span\u003e
            \u003c/div\u003e
          )}
          {overdueCount\u003e0 \u0026\u0026 (
            \u003cdiv style={{ display:"flex",justifyContent:"space-between",fontSize:12,padding:"8px 12px",background:"rgba(248,113,113,0.06)",borderRadius:10,marginTop:8 }}\u003e
              \u003cspan style={{ color:"var(--red)" }}\u003e⚠️ En retard\u003c/span\u003e
              \u003cspan style={{ color:"var(--red)",fontWeight:700 }}\u003e{overdueCount} facture{overdueCount\u003e1?"s":""}\u003c/span\u003e
            \u003c/div\u003e
          )}
        \u003c/div\u003e
        \u003cdiv className="card" style={{ textAlign:"center",padding:28 }}\u003e
          \u003cdiv style={{ fontSize:42,marginBottom:10 }}\u003e📋\u003c/div\u003e
          \u003cdiv style={{ fontWeight:700,marginBottom:6 }}\u003eNouvelle facture\u003c/div\u003e
          \u003cdiv style={{ fontSize:12,color:"var(--text2)",marginBottom:18 }}\u003eCharges fixes récurrentes\u003c/div\u003e
          \u003cbutton className="btn btn-primary" style={{ width:"100%" }} onClick={() =\u003e setModal({ type:"addBill" })}\u003e+ Créer une facture\u003c/button\u003e
        \u003c/div\u003e
      \u003c/div\u003e
    \u003c/div\u003e
  );
}

function BillRow({ bill, selMonth, onToggle, onDelete, profiles, idx, setModal }) {
  const isPaid    = bill.paid?.[selMonth];
  const prof      = profiles.find(p =\u003e p.id===bill.profileId);
  const dueDate   = bill.dueDate ? new Date(bill.dueDate) : null;
  const isOverdue = dueDate\u0026\u0026dueDate\u003cnew Date()\u0026\u0026!isPaid;

  // Compute due date details
  const getDueInfo = () =\u003e {
    if (!dueDate) return null;
    const now = new Date();
    const diffMs = dueDate - now;
    const diffDays = Math.ceil(diffMs / 86400000);
    const dayNum = dueDate.getDate();
    const monthName = dueDate.toLocaleDateString("fr-FR", { month:"long" });
    const yearStr = dueDate.getFullYear() !== now.getFullYear() ? ` ${dueDate.getFullYear()}` : "";
    const timeStr = dueDate.toLocaleTimeString("fr-FR",{ hour:"2-digit",minute:"2-digit" });
    if (isOverdue \u0026\u0026 !isPaid) {
      const daysLate = Math.abs(diffDays);
      return { label:`${dayNum} ${monthName}${yearStr}`, time:timeStr, badge:`${daysLate} j de retard`, badgeColor:"var(--red)", badgeBg:"rgba(248,113,113,0.12)", badgeBorder:"rgba(248,113,113,0.3)", icon:"⚠️", countdown:null };
    }
    if (diffDays\u003c=0) return { label:`${dayNum} ${monthName}${yearStr}`, time:timeStr, badge:"Aujourd'hui !", badgeColor:"var(--red)", badgeBg:"rgba(248,113,113,0.12)", badgeBorder:"rgba(248,113,113,0.3)", icon:"🔔", countdown:0 };
    if (diffDays\u003c=3) return { label:`${dayNum} ${monthName}${yearStr}`, time:timeStr, badge:`dans ${diffDays} j`, badgeColor:"var(--orange)", badgeBg:"rgba(251,146,60,0.12)", badgeBorder:"rgba(251,146,60,0.3)", icon:"⏱️", countdown:diffDays };
    if (diffDays\u003c=7) return { label:`${dayNum} ${monthName}${yearStr}`, time:timeStr, badge:`dans ${diffDays} j`, badgeColor:"var(--yellow)", badgeBg:"rgba(251,191,36,0.1)", badgeBorder:"rgba(251,191,36,0.28)", icon:"📅", countdown:diffDays };
    return { label:`${dayNum} ${monthName}${yearStr}`, time:timeStr, badge:`dans ${diffDays} j`, badgeColor:"var(--text3)", badgeBg:"rgba(255,255,255,0.04)", badgeBorder:"var(--border)", icon:"📅", countdown:diffDays };
  };
  const dueInfo = getDueInfo();

  const statusColor  = isPaid?"var(--green)":isOverdue?"var(--red)":"var(--yellow)";
  const statusBg     = isPaid?"rgba(74,222,128,0.08)":isOverdue?"rgba(248,113,113,0.08)":"rgba(251,191,36,0.06)";
  const statusBorder = isPaid?"rgba(74,222,128,0.25)":isOverdue?"rgba(248,113,113,0.35)":"rgba(251,191,36,0.2)";
  const statusLabel  = isPaid?"✅ Payée":isOverdue?"⚠️ En retard":"⏳ En attente";

  return (
    \u003cdiv className={`bill-card-row fade-up stagger-${(idx%5)+1}`}
      style={{ marginBottom:14,background:"var(--glass)",border:`1px solid ${statusBorder}`,borderRadius:18,overflow:"hidden",opacity:isPaid?0.72:1,transition:"all .28s cubic-bezier(.4,0,.2,1)",boxShadow:isOverdue?"0 0 20px rgba(248,113,113,0.1)":undefined,position:"relative" }}\u003e
      \u003cdiv style={{ height:3,background:`linear-gradient(90deg,${statusColor},transparent)` }}/\u003e
      \u003cdiv style={{ padding:"16px 18px" }}\u003e
        {/* Header */}
        \u003cdiv style={{ display:"flex",alignItems:"center",gap:14,marginBottom:14 }}\u003e
          \u003cdiv style={{ width:52,height:52,borderRadius:14,flexShrink:0,background:statusBg,border:`1px solid ${statusBorder}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:26 }}\u003e
            {bill.icon||"📋"}
          \u003c/div\u003e
          \u003cdiv style={{ flex:1,minWidth:0 }}\u003e
            \u003cdiv style={{ fontWeight:800,fontSize:17,textDecoration:isPaid?"line-through":"none",color:isPaid?"var(--text3)":"var(--text)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",marginBottom:5 }}\u003e{bill.name}\u003c/div\u003e
            \u003cdiv style={{ display:"flex",gap:6,flexWrap:"wrap" }}\u003e
              \u003cspan style={{ display:"inline-flex",alignItems:"center",gap:4,background:statusBg,border:`1px solid ${statusBorder}`,color:statusColor,borderRadius:20,padding:"3px 10px",fontSize:11,fontWeight:700 }}\u003e{statusLabel}\u003c/span\u003e
              {bill.recurring \u0026\u0026 \u003cspan style={{ display:"inline-flex",alignItems:"center",gap:4,background:"rgba(167,139,250,0.12)",border:"1px solid rgba(167,139,250,0.3)",color:"var(--purple)",borderRadius:20,padding:"3px 10px",fontSize:11,fontWeight:700 }}\u003e🔄 Récurrent\u003c/span\u003e}
            \u003c/div\u003e
          \u003c/div\u003e
          {bill.amount\u003e0 \u0026\u0026 (
            \u003cdiv style={{ fontFamily:"'Fraunces',serif",fontWeight:800,fontSize:20,color:isOverdue?"var(--red)":"var(--text)",flexShrink:0 }}\u003e-{fmt(bill.amount)}\u003c/div\u003e
          )}
        \u003c/div\u003e

          {/* Info grid — compte + échéance redesignée */}
          \u003cdiv style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14 }}\u003e
            {/* Compte */}
            \u003cdiv style={{ background:"rgba(255,255,255,0.03)",borderRadius:14,padding:"12px 14px",border:"1px solid var(--border)" }}\u003e
              \u003cdiv style={{ fontSize:9,color:"var(--text3)",textTransform:"uppercase",letterSpacing:1.2,marginBottom:8,fontWeight:800 }}\u003eCompte\u003c/div\u003e
              \u003cdiv style={{ display:"flex",alignItems:"center",gap:8 }}\u003e
                \u003cdiv style={{ width:32,height:32,borderRadius:9,background:prof?`${prof.color}22`:"rgba(255,255,255,0.06)",border:`1.5px solid ${prof?.color||"var(--border)"}40`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16 }}\u003e{prof?.avatar||"🏦"}\u003c/div\u003e
                \u003cdiv style={{ fontWeight:800,fontSize:14,color:prof?.color||"var(--text)" }}\u003e{prof?.name||"—"}\u003c/div\u003e
              \u003c/div\u003e
            \u003c/div\u003e

            {/* Échéance redesignée — plus grande et visuelle */}
            \u003cdiv style={{ background:dueInfo?`${dueInfo.badgeBg}`:"rgba(255,255,255,0.03)",borderRadius:14,padding:"12px 14px",border:`1.5px solid ${dueInfo\u0026\u0026!isPaid?dueInfo.badgeBorder:"var(--border)"}` }}\u003e
              \u003cdiv style={{ fontSize:9,color:"var(--text3)",textTransform:"uppercase",letterSpacing:1.2,marginBottom:8,fontWeight:800 }}\u003eÉchéance\u003c/div\u003e
              {dueInfo ? (
                \u003cdiv\u003e
                  \u003cdiv style={{ display:"flex",alignItems:"center",gap:6,marginBottom:6 }}\u003e
                    \u003cspan style={{ fontSize:20,lineHeight:1 }}\u003e{dueInfo.icon}\u003c/span\u003e
                    \u003cdiv style={{ fontFamily:"'Fraunces',serif",fontWeight:900,fontSize:17,color:isPaid?"var(--text3)":dueInfo.badgeColor,lineHeight:1.1 }}\u003e{dueInfo.label}\u003c/div\u003e
                  \u003c/div\u003e
                  {!isPaid \u0026\u0026 (
                    \u003cdiv style={{ display:"inline-flex",alignItems:"center",gap:4,background:dueInfo.badgeBg,border:`1px solid ${dueInfo.badgeBorder}`,color:dueInfo.badgeColor,borderRadius:20,padding:"4px 11px",fontSize:12,fontWeight:900,letterSpacing:.2 }}\u003e
                      {dueInfo.badge}
                    \u003c/div\u003e
                  )}
                \u003c/div\u003e
              ) : (
                \u003cdiv style={{ fontWeight:600,fontSize:13,color:"var(--text3)",marginTop:4 }}\u003e— Pas d'échéance\u003c/div\u003e
              )}
            \u003c/div\u003e
          \u003c/div\u003e

        {/* Actions */}
        \u003cdiv style={{ display:"flex",gap:8,alignItems:"center" }}\u003e
          \u003cbutton onClick={() =\u003e onToggle(bill.id)} style={{
            flex:1,padding:"11px",borderRadius:12,cursor:"pointer",fontFamily:"'Outfit',sans-serif",fontWeight:800,fontSize:14,
            background:isPaid?"rgba(74,222,128,0.12)":"rgba(167,139,250,0.12)",
            border:`1px solid ${isPaid?"rgba(74,222,128,0.35)":"rgba(167,139,250,0.35)"}`,
            color:isPaid?"var(--green)":"var(--purple)",transition:"all .2s",
          }}\u003e
            {isPaid?"↩️ Marquer impayée":"✅ Marquer comme payée"}
          \u003c/button\u003e
          \u003cdiv className="bill-hover-actions" style={{ display:"flex",gap:6 }}\u003e
            \u003cbutton onClick={() =\u003e setModal({ type:"editBill",bill })}
              className="tip action-btn action-btn-edit" data-tip="Modifier cette facture"
              style={{ display:"flex",alignItems:"center",gap:5,padding:"9px 14px",borderRadius:11,border:"1px solid rgba(167,139,250,0.3)",background:"rgba(167,139,250,0.1)",color:"var(--purple)",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"'Outfit',sans-serif",transition:"all .2s",whiteSpace:"nowrap" }}\u003e
              ✏️ Modifier
            \u003c/button\u003e
            \u003cbutton onClick={() =\u003e onDelete(bill.id)}
              className="tip action-btn action-btn-del" data-tip="Supprimer cette facture définitivement"
              style={{ display:"flex",alignItems:"center",gap:5,padding:"9px 14px",borderRadius:11,border:"1px solid rgba(248,113,113,0.3)",background:"rgba(248,113,113,0.08)",color:"var(--red)",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"'Outfit',sans-serif",transition:"all .2s",whiteSpace:"nowrap" }}\u003e
              🗑 Supprimer
            \u003c/button\u003e
          \u003c/div\u003e
        \u003c/div\u003e
      \u003c/div\u003e
    \u003c/div\u003e
  );
}


const Stats = memo(function Stats({ data, selMonth, mdata, allMonths }) {
  const [period, setPeriod]   = useState("month");
  const [statTab, setStatTab] = useState("overview");
  const catMap = useMemo(() =\u003e Object.fromEntries(data.categories.map(c=\u003e[c.id,c])), [data.categories]);

  const months = useMemo(() =\u003e {
    const all = [...allMonths].reverse();
    if (period==="month")   return [selMonth];
    if (period==="quarter") { const [y,m]=selMonth.split("-").map(Number); return all.filter(k=\u003e{ const [ky,km]=k.split("-").map(Number); return ky===y\u0026\u0026Math.abs(km-m)\u003c3; }); }
    if (period==="year")    { const y=selMonth.slice(0,4); return all.filter(k=\u003ek.startsWith(y)); }
    return [selMonth];
  }, [period,selMonth,allMonths]);

  const allTx   = useMemo(() =\u003e months.flatMap(k=\u003e(data.monthsData[k]?.transactions||[])), [months,data.monthsData]);
  const totalExp = useMemo(() =\u003e allTx.reduce((s,t)=\u003es+t.amount,0), [allTx]);
  const totalInc = useMemo(() =\u003e months.reduce((s,k) =\u003e { const inc=data.monthsData[k]?.incomes||{}; return s+(inc.p1||0)+(inc.p2||0)+(inc.common||0); },0), [months,data.monthsData]);

  const pieData = useMemo(() =\u003e {
    const m={};
    allTx.forEach(t=\u003e{ m[t.categoryId]=(m[t.categoryId]||0)+t.amount; });
    return Object.entries(m).map(([cid,val])=\u003e({ name:(catMap[cid]?.icon||"")+" "+(catMap[cid]?.name||cid),value:val,color:catMap[cid]?.color||"#888" })).sort((a,b)=\u003eb.value-a.value);
  }, [allTx,catMap]);

  const timelineData = useMemo(() =\u003e [...allMonths].slice(0,12).reverse().map(k =\u003e {
    const m   = data.monthsData[k];
    const exp = m?.transactions.reduce((s,t)=\u003es+t.amount,0)||0;
    const inc = m?(m.incomes?.p1||0)+(m.incomes?.p2||0)+(m.incomes?.common||0):0;
    return { month:monthLabelShort(k),dépenses:exp,revenus:inc,solde:inc-exp };
  }), [allMonths,data.monthsData]);

  const profBreakdown = useMemo(() =\u003e data.profiles.filter(p=\u003ep.id!=="common").map(p =\u003e {
    const spent = allTx.filter(t=\u003et.profileId===p.id).reduce((s,t)=\u003es+t.amount,0);
    const inc   = months.reduce((s,k)=\u003es+(data.monthsData[k]?.incomes?.[p.id]||0),0);
    return { ...p,spent,inc,balance:inc-spent };
  }), [data.profiles,allTx,months,data.monthsData]);

  const prevMonths = useMemo(() =\u003e {
    const all=[...allMonths].reverse();
    if (period==="month") { const idx=all.indexOf(selMonth); return idx\u003e=0\u0026\u0026idx+1\u003call.length?[all[idx+1]]:[]; }
    return [];
  }, [period,selMonth,allMonths]);

  const prevExp = useMemo(() =\u003e prevMonths.flatMap(k=\u003e(data.monthsData[k]?.transactions||[])).reduce((s,t)=\u003es+t.amount,0), [prevMonths,data.monthsData]);
  const trendPct = prevExp\u003e0 ? ((totalExp-prevExp)/prevExp)*100 : null;
  const savingsRate = totalInc\u003e0 ? Math.round(((totalInc-totalExp)/totalInc)*100) : null;
  const avgPerDay = (() =\u003e { const today = new Date(); const days = period==="month"?today.getDate():months.length*30; return days\u003e0?totalExp/days:0; })();

  const CT = ({ active,payload,label }) =\u003e {
    if (!active||!payload?.length) return null;
    return \u003cdiv className="rc-tooltip"\u003e\u003cdiv style={{ fontWeight:700,marginBottom:4,fontSize:12 }}\u003e{label}\u003c/div\u003e{payload.map((p,i)=\u003e\u003cdiv key={i} style={{ color:p.color,fontSize:11 }}\u003e{p.name}: {fmt(p.value)}\u003c/div\u003e)}\u003c/div\u003e;
  };
  const PT = ({ active,payload }) =\u003e {
    if (!active||!payload?.length) return null;
    const d=payload[0];
    return \u003cdiv className="rc-tooltip"\u003e\u003cdiv style={{ fontWeight:700 }}\u003e{d.name}\u003c/div\u003e\u003cdiv style={{ color:d.payload.color }}\u003e{fmt(d.value)}\u003c/div\u003e\u003cdiv style={{ fontSize:10,color:"var(--text3)" }}\u003e{totalExp\u003e0?Math.round((d.value/totalExp)*100):0}%\u003c/div\u003e\u003c/div\u003e;
  };

  const KpiCard = ({ icon, label, value, color, gradient, sub }) =\u003e (
    \u003cdiv className="stat-kpi-card" style={{ background:`linear-gradient(145deg,${gradient[0]},${gradient[1]})`,border:`1px solid ${color}28`,boxShadow:`0 8px 28px ${color}20,0 2px 8px rgba(0,0,0,0.4)` }}\u003e
      \u003cdiv style={{ display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:14 }}\u003e
        \u003cdiv style={{ width:44,height:44,borderRadius:13,background:`${color}20`,border:`1px solid ${color}30`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:22 }}\u003e{icon}\u003c/div\u003e
        {sub \u0026\u0026 \u003cdiv style={{ fontSize:11,color:`${color}99`,fontWeight:700,background:`${color}12`,borderRadius:20,padding:"3px 9px",maxWidth:"55%",textAlign:"right",lineHeight:1.3 }}\u003e{sub}\u003c/div\u003e}
      \u003c/div\u003e
      \u003cdiv style={{ fontSize:10,color:"rgba(255,255,255,0.45)",textTransform:"uppercase",letterSpacing:1.5,marginBottom:6,fontWeight:800 }}\u003e{label}\u003c/div\u003e
      \u003cdiv className="stat-num" style={{ fontSize:28,color:"white",letterSpacing:-.5,lineHeight:1 }}\u003e{value}\u003c/div\u003e
    \u003c/div\u003e
  );

  return (
    \u003cdiv className="fade-up"\u003e
      {/* Period + Tab controls */}
      \u003cdiv style={{ display:"flex",gap:10,marginBottom:22,alignItems:"center",flexWrap:"wrap" }}\u003e
        \u003cdiv className="filter-bar" style={{ flex:1 }}\u003e
          {[{ id:"month",label:"Ce mois" },{ id:"quarter",label:"Trimestre" },{ id:"year",label:"Année" }].map(p =\u003e (
            \u003cdiv key={p.id} className={`filter-chip ${period===p.id?"active":""}`} onClick={() =\u003e setPeriod(p.id)}\u003e{p.label}\u003c/div\u003e
          ))}
        \u003c/div\u003e
        \u003cdiv className="filter-bar"\u003e
          {[{ id:"overview",icon:"🌐",label:"Vue d'ensemble" },{ id:"categories",icon:"🥧",label:"Catégories" },{ id:"timeline",icon:"📈",label:"Historique" },{ id:"profiles",icon:"👥",label:"Profils" }].map(t =\u003e (
            \u003cdiv key={t.id} className={`filter-chip ${statTab===t.id?"active":""}`} onClick={() =\u003e setStatTab(t.id)}
              style={{ borderColor:statTab===t.id?"rgba(96,165,250,0.5)":"var(--border)",background:statTab===t.id?"rgba(96,165,250,0.12)":"var(--glass)",color:statTab===t.id?"var(--blue)":"var(--text2)" }}\u003e
              \u003cspan style={{ fontSize:14 }}\u003e{t.icon}\u003c/span\u003e{t.label}
            \u003c/div\u003e
          ))}
        \u003c/div\u003e
      \u003c/div\u003e

      {statTab==="overview" \u0026\u0026 (
        \u003cdiv\u003e
          {/* KPI Cards row */}
          \u003cdiv className="grid-4" style={{ marginBottom:20 }}\u003e
            \u003cKpiCard icon="💵" label="Revenus" value={`+${fmtCompact(totalInc)}`} color="#4ade80" gradient={["#052e16","#065f46"]} sub={period==="month"?monthLabel(selMonth):undefined}/\u003e
            \u003cKpiCard icon="💸" label="Dépenses" value={`-${fmtCompact(totalExp)}`} color="#f87171" gradient={["#2d0000","#450a0a"]} sub={allTx.length+" transactions"}/\u003e
            \u003cKpiCard icon="⚖️" label="Solde net" value={fmtCompact(totalInc-totalExp)} color={totalInc\u003e=totalExp?"#4ade80":"#f87171"} gradient={totalInc\u003e=totalExp?["#052e16","#065f46"]:["#2d0000","#450a0a"]} sub={savingsRate!==null?`Épargne: ${savingsRate}%`:undefined}/\u003e
            \u003cKpiCard icon="📅" label="Moy. / jour" value={fmtCompact(avgPerDay)} color="#a78bfa" gradient={["#1e0a3c","#2d1b69"]} sub={trendPct!==null?`${trendPct\u003e0?"↑":"↓"} ${Math.abs(Math.round(trendPct))}% vs mois préc.`:undefined}/\u003e
          \u003c/div\u003e
          {trendPct!==null \u0026\u0026 (
            \u003cdiv className={`alert-banner ${trendPct\u003e0?"alert-warning":"alert-success"}`} style={{ marginBottom:18 }}\u003e
              {trendPct\u003e0?"📈":"📉"}\u003cspan\u003eDépenses {trendPct\u003e0?"en hausse de":"en baisse de"} \u003cstrong\u003e{Math.abs(Math.round(trendPct))}%\u003c/strong\u003e par rapport au mois précédent ({fmt(prevExp)})\u003c/span\u003e
            \u003c/div\u003e
          )}
          \u003cdiv className="content-grid"\u003e
            \u003cdiv style={{ display:"flex",flexDirection:"column",gap:14 }}\u003e
              \u003cdiv className="card"\u003e
                \u003cdiv style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16 }}\u003e
                  \u003cdiv style={{ fontWeight:800,fontSize:14 }}\u003e📊 Revenus vs Dépenses — 12 mois\u003c/div\u003e
                \u003c/div\u003e
                \u003cResponsiveContainer width="100%" height={220}\u003e
                  \u003cAreaChart data={timelineData.filter(d=\u003ed.revenus\u003e0||d.dépenses\u003e0)} margin={{ top:4,right:4,left:0,bottom:0 }}\u003e
                    \u003cdefs\u003e
                      \u003clinearGradient id="gR" x1="0" y1="0" x2="0" y2="1"\u003e\u003cstop offset="5%" stopColor="#4ade80" stopOpacity={0.3}/\u003e\u003cstop offset="95%" stopColor="#4ade80" stopOpacity={0}/\u003e\u003c/linearGradient\u003e
                      \u003clinearGradient id="gE" x1="0" y1="0" x2="0" y2="1"\u003e\u003cstop offset="5%" stopColor="#f87171" stopOpacity={0.3}/\u003e\u003cstop offset="95%" stopColor="#f87171" stopOpacity={0}/\u003e\u003c/linearGradient\u003e
                    \u003c/defs\u003e
                    \u003cXAxis dataKey="month" tick={{ fill:"rgba(237,233,248,0.35)",fontSize:10 }} axisLine={false} tickLine={false}/\u003e
                    \u003cYAxis tick={{ fill:"rgba(237,233,248,0.35)",fontSize:10 }} axisLine={false} tickLine={false} width={72} tickFormatter={v=\u003ev\u003e0?fmtCompact(v):"."}/\u003e
                    \u003cTooltip content={\u003cCT/\u003e}/\u003e
                    \u003cArea type="monotone" dataKey="revenus"  stroke="#4ade80" strokeWidth={2.5} fill="url(#gR)" name="Revenus" dot={false}/\u003e
                    \u003cArea type="monotone" dataKey="dépenses" stroke="#f87171" strokeWidth={2.5} fill="url(#gE)" name="Dépenses" dot={false}/\u003e
                  \u003c/AreaChart\u003e
                \u003c/ResponsiveContainer\u003e
              \u003c/div\u003e
              {/* Top 5 catégories */}
              {pieData.length\u003e0 \u0026\u0026 (
                \u003cdiv className="card"\u003e
                  \u003cdiv style={{ fontWeight:800,fontSize:14,marginBottom:14 }}\u003e🏆 Top catégories\u003c/div\u003e
                  {pieData.slice(0,5).map((d,i) =\u003e (
                    \u003cdiv key={i} style={{ display:"flex",alignItems:"center",gap:10,marginBottom:12 }}\u003e
                      \u003cdiv style={{ width:9,height:9,borderRadius:3,background:d.color,flexShrink:0 }}/\u003e
                      \u003cspan style={{ flex:1,fontSize:13,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}\u003e{d.name}\u003c/span\u003e
                      \u003cspan style={{ fontSize:11,color:"var(--text3)",background:"rgba(255,255,255,0.05)",borderRadius:20,padding:"2px 8px",fontWeight:700,flexShrink:0 }}\u003e{totalExp\u003e0?Math.round((d.value/totalExp)*100):0}%\u003c/span\u003e
                      \u003cspan style={{ fontWeight:800,fontSize:13,color:d.color,flexShrink:0 }}\u003e{fmt(d.value)}\u003c/span\u003e
                      \u003cdiv className="progress-track" style={{ width:60,height:5,flexShrink:0 }}\u003e\u003cdiv className="progress-fill" style={{ width:`${totalExp\u003e0?(d.value/totalExp)*100:0}%`,background:d.color }}/\u003e\u003c/div\u003e
                    \u003c/div\u003e
                  ))}
                \u003c/div\u003e
              )}
            \u003c/div\u003e
            \u003cdiv style={{ display:"flex",flexDirection:"column",gap:14 }}\u003e
              {pieData.length\u003e0 \u0026\u0026 (
                \u003cdiv className="card"\u003e
                  \u003cdiv style={{ fontWeight:800,fontSize:14,marginBottom:10 }}\u003e🥧 Répartition\u003c/div\u003e
                  \u003cResponsiveContainer width="100%" height={190}\u003e
                    \u003cPieChart\u003e
                      \u003cPie data={pieData} cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={3} dataKey="value"\u003e
                        {pieData.map((e,i) =\u003e \u003cCell key={i} fill={e.color} stroke="transparent"/\u003e)}
                      \u003c/Pie\u003e
                      \u003cTooltip content={\u003cPT/\u003e}/\u003e
                    \u003c/PieChart\u003e
                  \u003c/ResponsiveContainer\u003e
                  \u003cdiv style={{ display:"flex",flexWrap:"wrap",gap:5,marginTop:4 }}\u003e
                    {pieData.slice(0,6).map((d,i) =\u003e \u003cdiv key={i} style={{ display:"flex",alignItems:"center",gap:4,fontSize:11 }}\u003e\u003cdiv style={{ width:8,height:8,borderRadius:2,background:d.color }}/\u003e\u003cspan style={{ color:"var(--text3)" }}\u003e{d.name}\u003c/span\u003e\u003c/div\u003e)}
                  \u003c/div\u003e
                \u003c/div\u003e
              )}
              \u003cdiv className="card"\u003e
                \u003cdiv style={{ fontWeight:800,fontSize:14,marginBottom:12 }}\u003e📊 Solde mensuel\u003c/div\u003e
                \u003cResponsiveContainer width="100%" height={150}\u003e
                  \u003cBarChart data={timelineData.filter(d=\u003ed.revenus\u003e0||d.dépenses\u003e0)} margin={{ top:4,right:4,left:0,bottom:0 }}\u003e
                    \u003cXAxis dataKey="month" tick={{ fill:"rgba(237,233,248,0.35)",fontSize:9 }} axisLine={false} tickLine={false}/\u003e
                    \u003cYAxis tick={{ fill:"rgba(237,233,248,0.35)",fontSize:9 }} axisLine={false} tickLine={false} width={62} tickFormatter={v=\u003efmtCompact(v)}/\u003e
                    \u003cTooltip content={\u003cCT/\u003e}/\u003e
                    \u003cBar dataKey="solde" name="Solde" radius={[5,5,0,0]} maxBarSize={40}\u003e
                      {timelineData.filter(d=\u003ed.revenus\u003e0||d.dépenses\u003e0).map((e,i) =\u003e \u003cCell key={i} fill={e.solde\u003e0?"#4ade80":e.solde\u003c0?"#f87171":"rgba(255,255,255,0.1)"}/\u003e)}
                    \u003c/Bar\u003e
                  \u003c/BarChart\u003e
                \u003c/ResponsiveContainer\u003e
              \u003c/div\u003e
            \u003c/div\u003e
          \u003c/div\u003e
        \u003c/div\u003e
      )}

      {statTab==="categories" \u0026\u0026 (
        \u003cdiv className="content-grid"\u003e
          \u003cdiv className="card"\u003e
            \u003cdiv style={{ fontWeight:800,fontSize:14,marginBottom:20 }}\u003e🔍 Analyse par catégorie\u003c/div\u003e
            {pieData.length===0 ? \u003cdiv className="empty-state"\u003e\u003cdiv className="empty-icon"\u003e📊\u003c/div\u003eAucune dépense\u003c/div\u003e
              : pieData.map((d,i) =\u003e (
                \u003cdiv key={i} style={{ marginBottom:18 }}\u003e
                  \u003cdiv style={{ display:"flex",justifyContent:"space-between",marginBottom:7,fontSize:13 }}\u003e
                    \u003cdiv style={{ display:"flex",alignItems:"center",gap:8 }}\u003e
                      \u003cdiv style={{ width:32,height:32,borderRadius:9,background:`${d.color}18`,border:`1px solid ${d.color}30`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16 }}\u003e{d.name.split(" ")[0]}\u003c/div\u003e
                      \u003cspan style={{ fontWeight:700 }}\u003e{d.name.split(" ").slice(1).join(" ")}\u003c/span\u003e
                    \u003c/div\u003e
                    \u003cdiv style={{ display:"flex",gap:10,alignItems:"center" }}\u003e
                      \u003cspan style={{ color:"var(--text3)",fontSize:11,background:"rgba(255,255,255,0.06)",borderRadius:20,padding:"2px 8px",fontWeight:700 }}\u003e{totalExp\u003e0?Math.round((d.value/totalExp)*100):0}%\u003c/span\u003e
                      \u003cspan style={{ fontWeight:800,color:d.color,fontSize:15 }}\u003e{fmt(d.value)}\u003c/span\u003e
                    \u003c/div\u003e
                  \u003c/div\u003e
                  \u003cdiv className="progress-track" style={{ height:8,borderRadius:20 }}\u003e
                    \u003cdiv className="progress-fill" style={{ width:`${totalExp\u003e0?(d.value/totalExp)*100:0}%`,background:`linear-gradient(90deg,${d.color},${d.color}88)`,borderRadius:20 }}/\u003e
                  \u003c/div\u003e
                \u003c/div\u003e
              ))
            }
          \u003c/div\u003e
          {pieData.length\u003e0 \u0026\u0026 (
            \u003cdiv className="card"\u003e
              \u003cdiv style={{ fontWeight:800,fontSize:14,marginBottom:10 }}\u003e🥧 Distribution\u003c/div\u003e
              \u003cResponsiveContainer width="100%" height={300}\u003e
                \u003cPieChart\u003e
                  \u003cPie data={pieData} cx="50%" cy="50%" outerRadius={120} paddingAngle={3} dataKey="value"\u003e
                    {pieData.map((e,i) =\u003e \u003cCell key={i} fill={e.color} stroke="transparent"/\u003e)}
                  \u003c/Pie\u003e
                  \u003cTooltip content={\u003cPT/\u003e}/\u003e
                  \u003cLegend formatter={v =\u003e \u003cspan style={{ fontSize:11,color:"var(--text2)" }}\u003e{v}\u003c/span\u003e}/\u003e
                \u003c/PieChart\u003e
              \u003c/ResponsiveContainer\u003e
            \u003c/div\u003e
          )}
        \u003c/div\u003e
      )}

      {statTab==="timeline" \u0026\u0026 (
        \u003cdiv style={{ display:"flex",flexDirection:"column",gap:16 }}\u003e
          \u003cdiv className="card"\u003e
            \u003cdiv style={{ fontWeight:800,fontSize:14,marginBottom:16 }}\u003e📈 Évolution sur 12 mois\u003c/div\u003e
            \u003cResponsiveContainer width="100%" height={240}\u003e
              \u003cAreaChart data={timelineData} margin={{ top:4,right:4,left:0,bottom:0 }}\u003e
                \u003cdefs\u003e
                  \u003clinearGradient id="gR2" x1="0" y1="0" x2="0" y2="1"\u003e\u003cstop offset="5%" stopColor="#4ade80" stopOpacity={0.35}/\u003e\u003cstop offset="95%" stopColor="#4ade80" stopOpacity={0}/\u003e\u003c/linearGradient\u003e
                  \u003clinearGradient id="gE2" x1="0" y1="0" x2="0" y2="1"\u003e\u003cstop offset="5%" stopColor="#f87171" stopOpacity={0.35}/\u003e\u003cstop offset="95%" stopColor="#f87171" stopOpacity={0}/\u003e\u003c/linearGradient\u003e
                \u003c/defs\u003e
                \u003cXAxis dataKey="month" tick={{ fill:"rgba(237,233,248,0.35)",fontSize:11 }} axisLine={false} tickLine={false}/\u003e
                \u003cYAxis tick={{ fill:"rgba(237,233,248,0.35)",fontSize:11 }} axisLine={false} tickLine={false} width={75} tickFormatter={v=\u003efmtCompact(v)}/\u003e
                \u003cTooltip content={\u003cCT/\u003e}/\u003e\u003cLegend formatter={v =\u003e \u003cspan style={{ fontSize:12,color:"var(--text2)" }}\u003e{v}\u003c/span\u003e}/\u003e
                \u003cArea type="monotone" dataKey="revenus"  stroke="#4ade80" strokeWidth={2.5} fill="url(#gR2)" name="Revenus" dot={false}/\u003e
                \u003cArea type="monotone" dataKey="dépenses" stroke="#f87171" strokeWidth={2.5} fill="url(#gE2)" name="Dépenses" dot={false}/\u003e
              \u003c/AreaChart\u003e
            \u003c/ResponsiveContainer\u003e
          \u003c/div\u003e
          \u003cdiv className="card"\u003e
            \u003cdiv style={{ fontWeight:800,fontSize:14,marginBottom:14 }}\u003e💹 Solde net mensuel\u003c/div\u003e
            \u003cResponsiveContainer width="100%" height={190}\u003e
              \u003cBarChart data={timelineData} margin={{ top:4,right:4,left:0,bottom:0 }}\u003e
                \u003cXAxis dataKey="month" tick={{ fill:"rgba(237,233,248,0.35)",fontSize:11 }} axisLine={false} tickLine={false}/\u003e
                \u003cYAxis tick={{ fill:"rgba(237,233,248,0.35)",fontSize:11 }} axisLine={false} tickLine={false} width={75} tickFormatter={v=\u003efmtCompact(v)}/\u003e
                \u003cTooltip content={\u003cCT/\u003e}/\u003e
                \u003cBar dataKey="solde" name="Solde net" radius={[6,6,0,0]}\u003e{timelineData.map((e,i) =\u003e \u003cCell key={i} fill={e.solde\u003e=0?"#4ade80":"#f87171"}/\u003e)}\u003c/Bar\u003e
              \u003c/BarChart\u003e
            \u003c/ResponsiveContainer\u003e
          \u003c/div\u003e
          {timelineData.some(d=\u003ed.solde!==0) \u0026\u0026 (() =\u003e {
            const withData = timelineData.filter(d=\u003ed.revenus\u003e0||d.dépenses\u003e0);
            if (withData.length\u003c2) return null;
            const best  = withData.reduce((a,b)=\u003ea.solde\u003eb.solde?a:b);
            const worst = withData.reduce((a,b)=\u003ea.solde\u003cb.solde?a:b);
            return (
              \u003cdiv className="grid-2"\u003e
                \u003cdiv className="card" style={{ borderColor:"rgba(74,222,128,0.25)",background:"rgba(74,222,128,0.04)",textAlign:"center" }}\u003e
                  \u003cdiv style={{ fontSize:32,marginBottom:8 }}\u003e🏆\u003c/div\u003e
                  \u003cdiv style={{ fontSize:11,color:"var(--text3)",marginBottom:4 }}\u003eMeilleur mois\u003c/div\u003e
                  \u003cdiv style={{ fontWeight:800,fontSize:15 }}\u003e{best.month}\u003c/div\u003e
                  \u003cdiv style={{ fontWeight:900,color:"var(--green)",fontSize:18,marginTop:4 }}\u003e{fmt(best.solde)}\u003c/div\u003e
                \u003c/div\u003e
                \u003cdiv className="card" style={{ borderColor:"rgba(248,113,113,0.25)",background:"rgba(248,113,113,0.04)",textAlign:"center" }}\u003e
                  \u003cdiv style={{ fontSize:32,marginBottom:8 }}\u003e📉\u003c/div\u003e
                  \u003cdiv style={{ fontSize:11,color:"var(--text3)",marginBottom:4 }}\u003eMois difficile\u003c/div\u003e
                  \u003cdiv style={{ fontWeight:800,fontSize:15 }}\u003e{worst.month}\u003c/div\u003e
                  \u003cdiv style={{ fontWeight:900,color:"var(--red)",fontSize:18,marginTop:4 }}\u003e{fmt(worst.solde)}\u003c/div\u003e
                \u003c/div\u003e
              \u003c/div\u003e
            );
          })()}
        \u003c/div\u003e
      )}

      {statTab==="profiles" \u0026\u0026 (
        \u003cdiv className="content-grid"\u003e
          {profBreakdown.map(p =\u003e (
            \u003cdiv key={p.id} className="card" style={{ borderColor:`${p.color}25`,background:`${p.color}04` }}\u003e
              \u003cdiv style={{ display:"flex",alignItems:"center",gap:14,marginBottom:18 }}\u003e
                \u003cdiv style={{ width:56,height:56,borderRadius:16,background:`${p.color}18`,border:`2px solid ${p.color}35`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:28 }}\u003e{p.avatar}\u003c/div\u003e
                \u003cdiv\u003e
                  \u003cdiv style={{ fontWeight:900,fontSize:18,color:p.color }}\u003e{p.name}\u003c/div\u003e
                  \u003cdiv style={{ fontSize:12,color:"var(--text3)" }}\u003eSolde : \u003cstrong style={{ color:p.balance\u003e=0?"var(--green)":"var(--red)" }}\u003e{fmt(p.balance)}\u003c/strong\u003e\u003c/div\u003e
                \u003c/div\u003e
              \u003c/div\u003e
              \u003cdiv className="grid-2" style={{ marginBottom:16 }}\u003e
                \u003cdiv style={{ background:"rgba(74,222,128,0.08)",borderRadius:12,padding:"12px",textAlign:"center",border:"1px solid rgba(74,222,128,0.15)" }}\u003e
                  \u003cdiv style={{ fontSize:10,color:"var(--text3)",marginBottom:4,textTransform:"uppercase",letterSpacing:.5 }}\u003eRevenus\u003c/div\u003e
                  \u003cdiv style={{ fontWeight:900,color:"var(--green)",fontSize:18 }}\u003e+{fmt(p.inc)}\u003c/div\u003e
                \u003c/div\u003e
                \u003cdiv style={{ background:"rgba(248,113,113,0.08)",borderRadius:12,padding:"12px",textAlign:"center",border:"1px solid rgba(248,113,113,0.15)" }}\u003e
                  \u003cdiv style={{ fontSize:10,color:"var(--text3)",marginBottom:4,textTransform:"uppercase",letterSpacing:.5 }}\u003eDépenses\u003c/div\u003e
                  \u003cdiv style={{ fontWeight:900,color:"var(--red)",fontSize:18 }}\u003e-{fmt(p.spent)}\u003c/div\u003e
                \u003c/div\u003e
              \u003c/div\u003e
              {p.inc\u003e0 \u0026\u0026 (\u003c\u003e
                \u003cdiv style={{ display:"flex",justifyContent:"space-between",fontSize:12,color:"var(--text3)",marginBottom:6 }}\u003e
                  \u003cspan\u003eBudget utilisé\u003c/span\u003e
                  \u003cspan style={{ fontWeight:800,color:p.spent\u003ep.inc?"var(--red)":"var(--green)" }}\u003e{Math.round((p.spent/p.inc)*100)}%\u003c/span\u003e
                \u003c/div\u003e
                \u003cdiv className="progress-track" style={{ height:8 }}\u003e\u003cdiv className="progress-fill" style={{ width:`${Math.min(100,(p.spent/p.inc)*100)}%`,background:p.color,boxShadow:`0 0 8px ${p.color}50` }}/\u003e\u003c/div\u003e
              \u003c/\u003e)}
            \u003c/div\u003e
          ))}
        \u003c/div\u003e
      )}
    \u003c/div\u003e
  );
});

// ═══════════════════════════════════════════════════════════
//  MODAL ROUTER
// ═══════════════════════════════════════════════════════════
function ModalRouter({ modal, setModal, data, update, selMonth }) {
  const close = () =\u003e setModal(null);
  // Close on Escape
  useEffect(() =\u003e {
    const h = e =\u003e e.key === "Escape" \u0026\u0026 close();
    window.addEventListener("keydown", h);
    return () =\u003e window.removeEventListener("keydown", h);
  }, []);

  if (modal.type === "editIncome")          return \u003cIncomeModal              close={close} data={data} update={update} profileId={modal.profileId} selMonth={modal.selMonth||selMonth}/\u003e;
  if (modal.type === "addTransaction")      return \u003cAddTxModal               close={close} data={data} update={update} selMonth={modal.selMonth||selMonth}/\u003e;
  if (modal.type === "importCIC")           return \u003cImportCICModal           close={close} data={data} update={update} selMonth={modal.selMonth||selMonth}/\u003e;
  if (modal.type === "editTransaction")     return \u003cEditTxModal              close={close} data={data} update={update} tx={modal.tx} selMonth={modal.selMonth||selMonth}/\u003e;
  if (modal.type === "addBill")             return \u003cAddBillModal             close={close} data={data} update={update}/\u003e;
  if (modal.type === "editBill")            return \u003cEditBillModal            close={close} data={data} update={update} bill={modal.bill}/\u003e;
  if (modal.type === "editProfile")         return \u003cEditProfileModal         close={close} data={data} update={update} profileId={modal.profileId}/\u003e;
  if (modal.type === "addRecurringIncome")  return \u003cAddRecurringIncomeModal  close={close} data={data} update={update}/\u003e;
  return null;
}

function ModalWrap({ close, title, children }) {
  return (
    \u003cdiv className="modal-overlay" onClick={e =\u003e e.target===e.currentTarget \u0026\u0026 close()}\u003e
      \u003cdiv className="modal-box scale-in"\u003e
        \u003cdiv style={{ fontWeight:800,fontSize:18,marginBottom:20,display:"flex",alignItems:"center",justifyContent:"space-between" }}\u003e
          \u003cspan\u003e{title}\u003c/span\u003e
          \u003cbutton onClick={close} style={{ background:"none",border:"none",color:"var(--text3)",cursor:"pointer",fontSize:24,lineHeight:1,transition:"color .2s" }}
            onMouseEnter={e=\u003ee.target.style.color="var(--text)"} onMouseLeave={e=\u003ee.target.style.color="var(--text3)"}\u003e×\u003c/button\u003e
        \u003c/div\u003e
        {children}
      \u003c/div\u003e
    \u003c/div\u003e
  );
}

function IncomeModal({ close, data, update, profileId, selMonth }) {
  const profile = data.profiles.find(p =\u003e p.id===profileId);
  const current = data.monthsData[selMonth]?.incomes?.[profileId] || 0;
  const [val, setVal] = useState(current || "");
  const inputRef = useRef();
  useEffect(() =\u003e { inputRef.current?.focus(); }, []);
  const save = () =\u003e {
    update(d =\u003e { ensureMonth(d, selMonth); d.monthsData[selMonth].incomes[profileId] = parseFloat(val)||0; });
    close();
  };
  return (
    \u003cModalWrap close={close} title={`💵 Revenu — ${profile?.name}`}\u003e
      \u003cdiv style={{ textAlign:"center",marginBottom:20 }}\u003e
        \u003cdiv style={{ fontSize:56,marginBottom:8 }}\u003e{profile?.avatar}\u003c/div\u003e
        \u003cdiv style={{ fontSize:12,color:"var(--text2)" }}\u003e{monthLabel(selMonth)}\u003c/div\u003e
      \u003c/div\u003e
      \u003clabel\u003eMontant (€)\u003c/label\u003e
      \u003cinput ref={inputRef} type="number" value={val} onChange={e =\u003e setVal(e.target.value)}
        placeholder="Ex: 2500" style={{ marginBottom:20,fontSize:18,textAlign:"center" }}
        onKeyDown={e =\u003e e.key==="Enter" \u0026\u0026 save()}/\u003e
      \u003cdiv style={{ display:"flex",gap:10 }}\u003e
        \u003cbutton className="btn btn-ghost" onClick={close} style={{ flex:1 }}\u003eAnnuler\u003c/button\u003e
        \u003cbutton className="btn btn-primary" onClick={save} style={{ flex:1 }}\u003eEnregistrer\u003c/button\u003e
      \u003c/div\u003e
    \u003c/ModalWrap\u003e
  );
}

function AddTxModal({ close, data, update, selMonth }) {
  const [label, setLabel]           = useState("");
  const [amount, setAmount]         = useState("");
  const [catId, setCatId]           = useState(data.categories[0]?.id || "");
  const [profId, setProfId]         = useState(data.profiles[0]?.id || "");
  const [customDate, setCustomDate] = useState("");
  const labelRef = useRef();
  useEffect(() =\u003e { labelRef.current?.focus(); }, []);
  const save = () =\u003e {
    if (!label.trim() || !amount) return;
    update(d =\u003e {
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
    \u003cModalWrap close={close} title="💳 Nouvelle dépense"\u003e
      \u003cdiv style={{ marginBottom:12 }}\u003e
        \u003clabel\u003eLibellé\u003c/label\u003e
        \u003cinput ref={labelRef} value={label} onChange={e =\u003e setLabel(e.target.value)} placeholder="Ex: Courses Lidl"/\u003e
      \u003c/div\u003e
      \u003cdiv style={{ marginBottom:12 }}\u003e
        \u003clabel\u003eMontant (€)\u003c/label\u003e
        \u003cinput type="number" value={amount} onChange={e =\u003e setAmount(e.target.value)} placeholder="0.00"/\u003e
      \u003c/div\u003e
      \u003cdiv className="grid-2" style={{ marginBottom:12 }}\u003e
        \u003cdiv\u003e
          \u003clabel\u003eCatégorie\u003c/label\u003e
          \u003cselect value={catId} onChange={e =\u003e setCatId(e.target.value)}\u003e
            {data.categories.map(c =\u003e \u003coption key={c.id} value={c.id}\u003e{c.icon} {c.name}\u003c/option\u003e)}
          \u003c/select\u003e
        \u003c/div\u003e
        \u003cdiv\u003e
          \u003clabel\u003eProfil\u003c/label\u003e
          \u003cselect value={profId} onChange={e =\u003e setProfId(e.target.value)}\u003e
            {data.profiles.map(p =\u003e \u003coption key={p.id} value={p.id}\u003e{p.avatar} {p.name}\u003c/option\u003e)}
          \u003c/select\u003e
        \u003c/div\u003e
      \u003c/div\u003e
      \u003cdiv style={{ marginBottom:18 }}\u003e
        \u003clabel\u003eDate (optionnel)\u003c/label\u003e
        \u003cinput type="datetime-local" value={customDate} onChange={e =\u003e setCustomDate(e.target.value)}/\u003e
      \u003c/div\u003e
      \u003cdiv style={{ display:"flex",gap:10 }}\u003e
        \u003cbutton className="btn btn-ghost" onClick={close} style={{ flex:1 }}\u003eAnnuler\u003c/button\u003e
        \u003cbutton className="btn btn-primary" onClick={save} style={{ flex:1 }} disabled={!label.trim()||!amount}\u003eAjouter\u003c/button\u003e
      \u003c/div\u003e
    \u003c/ModalWrap\u003e
  );
}

function EditTxModal({ close, data, update, tx, selMonth }) {
  const [label, setLabel]       = useState(tx.label || "");
  const [amount, setAmount]     = useState(tx.amount || "");
  const [catId, setCatId]       = useState(tx.categoryId || data.categories[0]?.id || "");
  const [profId, setProfId]     = useState(tx.profileId || data.profiles[0]?.id || "");
  const [customDate, setDate]   = useState(tx.timestamp ? tx.timestamp.slice(0,16) : "");
  const save = () =\u003e {
    if (!label.trim() || !amount) return;
    update(d =\u003e {
      ensureMonth(d, selMonth);
      const idx = d.monthsData[selMonth].transactions.findIndex(t =\u003e t.id===tx.id);
      if (idx \u003e= 0) {
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
    \u003cModalWrap close={close} title="✏️ Modifier la dépense"\u003e
      \u003cdiv style={{ marginBottom:12 }}\u003e
        \u003clabel\u003eLibellé\u003c/label\u003e
        \u003cinput value={label} onChange={e =\u003e setLabel(e.target.value)} placeholder="Ex: Courses Lidl" autoFocus/\u003e
      \u003c/div\u003e
      \u003cdiv style={{ marginBottom:12 }}\u003e
        \u003clabel\u003eMontant (€)\u003c/label\u003e
        \u003cinput type="number" value={amount} onChange={e =\u003e setAmount(e.target.value)} placeholder="0.00"/\u003e
      \u003c/div\u003e
      \u003cdiv className="grid-2" style={{ marginBottom:12 }}\u003e
        \u003cdiv\u003e
          \u003clabel\u003eCatégorie\u003c/label\u003e
          \u003cselect value={catId} onChange={e =\u003e setCatId(e.target.value)}\u003e
            {data.categories.map(c =\u003e \u003coption key={c.id} value={c.id}\u003e{c.icon} {c.name}\u003c/option\u003e)}
          \u003c/select\u003e
        \u003c/div\u003e
        \u003cdiv\u003e
          \u003clabel\u003eProfil\u003c/label\u003e
          \u003cselect value={profId} onChange={e =\u003e setProfId(e.target.value)}\u003e
            {data.profiles.map(p =\u003e \u003coption key={p.id} value={p.id}\u003e{p.avatar} {p.name}\u003c/option\u003e)}
          \u003c/select\u003e
        \u003c/div\u003e
      \u003c/div\u003e
      \u003cdiv style={{ marginBottom:18 }}\u003e
        \u003clabel\u003eDate\u003c/label\u003e
        \u003cinput type="datetime-local" value={customDate} onChange={e =\u003e setDate(e.target.value)}/\u003e
      \u003c/div\u003e
      \u003cdiv style={{ display:"flex",gap:10 }}\u003e
        \u003cbutton className="btn btn-ghost" onClick={close} style={{ flex:1 }}\u003eAnnuler\u003c/button\u003e
        \u003cbutton className="btn btn-primary" onClick={save} style={{ flex:1 }} disabled={!label.trim()||!amount}\u003eEnregistrer\u003c/button\u003e
      \u003c/div\u003e
    \u003c/ModalWrap\u003e
  );
}

function ImportCICModal({ close, data, update, selMonth }) {
  const [step, setStep]         = useState("paste"); // paste | preview | done
  const [raw, setRaw]           = useState("");
  const [parsed, setParsed]     = useState([]);
  const [duplicates, setDups]   = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [profId, setProfId]     = useState(data.profiles[0]?.id || "");
  const [error, setError]       = useState("");
  const textRef = useRef();
  useEffect(() =\u003e { textRef.current?.focus(); }, []);

  // Auto-categorisation rules
  const CIC_RULES = [
    { patterns:[/carrefour|lidl|aldi|leclerc|intermarché|super u|monoprix|franprix|casino|picard/i], catName:"Courses" },
    { patterns:[/sncf|ratp|navigo|uber|blablacar|oui\.sncf|transdev/i], catName:"Transport" },
    { patterns:[/netflix|spotify|amazon prime|deezer|disney|canal\+/i], catName:"Abonnements" },
    { patterns:[/edf|engie|total energie|veolia|orange|sfr|free|bouygue/i], catName:"Factures" },
    { patterns:[/restaurant|brasserie|mcdonald|quick|burger|pizza|sushi|kebab|café|bar /i], catName:"Restaurant" },
    { patterns:[/pharmacie|médecin|docteur|clinique|hopital|mutuelle/i], catName:"Santé" },
    { patterns:[/amazon|fnac|darty|cdiscount|zalando|shein|h\u0026m|zara/i], catName:"Shopping" },
    { patterns:[/total|bp|shell|esso|carburant|station/i], catName:"Carburant" },
    { patterns:[/loyer|syndic|assurance|maif|axa/i], catName:"Logement" },
    { patterns:[/salaire|virement|prime|remboursement/i], catName:"Revenus" },
  ];
  const catByName = name =\u003e data.categories.find(c =\u003e c.name.toLowerCase().includes(name.toLowerCase()))?.id || data.categories[0]?.id || "";
  const autoCategory = label =\u003e {
    for (const rule of CIC_RULES) {
      if (rule.patterns.some(p =\u003e p.test(label))) return catByName(rule.catName);
    }
    return data.categories[0]?.id || "";
  };

  const parseClipboard = async () =\u003e {
    let text = raw;
    if (!text.trim()) {
      try { text = await navigator.clipboard.readText(); setRaw(text); }
      catch { setError("Impossible de lire le presse-papiers. Colle le texte manuellement."); return; }
    }
    setError("");
    try {
      const payload = JSON.parse(text);
      if (!payload._duobudget || !Array.isArray(payload.transactions)) {
        setError("Format invalide. Assure-toi d'avoir cliqué 'Sync DuoBudget' sur CIC Filbanque.");
        return;
      }
      const existing = data.monthsData?.[selMonth]?.transactions || [];
      const existLabels = new Set(existing.map(t =\u003e `${t.label}__${t.amount}__${t.timestamp?.slice(0,10)}`));
      const txs = payload.transactions.map(t =\u003e ({
        id: mkid(),
        label: t.label,
        amount: Math.abs(t.amount),
        categoryId: autoCategory(t.label),
        profileId: profId,
        timestamp: t.date ? new Date(t.date).toISOString() : nowISO(),
        source: "CIC",
      }));
      const dups = new Set();
      txs.forEach(t =\u003e { if (existLabels.has(`${t.label}__${t.amount}__${t.timestamp.slice(0,10)}`)) dups.add(t.id); });
      setDups(dups);
      setSelected(new Set(txs.filter(t =\u003e !dups.has(t.id)).map(t =\u003e t.id)));
      setParsed(txs);
      setStep("preview");
    } catch { setError("Format invalide. Colle le JSON copié par l'extension CIC."); }
  };

  const doImport = () =\u003e {
    const toImport = parsed.filter(t =\u003e selected.has(t.id)).map(t =\u003e ({ ...t, profileId: profId }));
    if (!toImport.length) { close(); return; }
    update(d =\u003e {
      ensureMonth(d, selMonth);
      d.monthsData[selMonth].transactions.push(...toImport);
    });
    setStep("done");
  };

  const toggleAll = () =\u003e {
    const nonDup = parsed.filter(t =\u003e !duplicates.has(t.id)).map(t =\u003e t.id);
    if (selected.size === nonDup.length) setSelected(new Set());
    else setSelected(new Set(nonDup));
  };

  const fmt = n =\u003e n.toLocaleString("fr-FR",{style:"currency",currency:"EUR"});
  const totalSel = parsed.filter(t =\u003e selected.has(t.id)).reduce((s,t)=\u003es+t.amount,0);

  if (step === "done") return (
    \u003cModalWrap close={close} title="✅ Import terminé"\u003e
      \u003cdiv style={{ textAlign:"center",padding:"20px 0" }}\u003e
        \u003cdiv style={{ fontSize:64,marginBottom:12 }}\u003e🎉\u003c/div\u003e
        \u003cdiv style={{ fontSize:22,fontWeight:900,marginBottom:8 }}\u003e{parsed.filter(t=\u003eselected.has(t.id)).length} opérations importées\u003c/div\u003e
        \u003cdiv style={{ fontSize:14,color:"var(--text2)",marginBottom:28 }}\u003eElles apparaissent maintenant dans vos dépenses du mois.\u003c/div\u003e
        \u003cbutton className="btn btn-primary" onClick={close} style={{ minWidth:160 }}\u003eFermer\u003c/button\u003e
      \u003c/div\u003e
    \u003c/ModalWrap\u003e
  );

  if (step === "preview") return (
    \u003cModalWrap close={close} title={`🏦 Importer CIC — ${parsed.length} opérations`}\u003e
      {/* Profil assigné */}
      \u003cdiv style={{ marginBottom:14 }}\u003e
        \u003clabel\u003eAssigner au profil\u003c/label\u003e
        \u003cselect value={profId} onChange={e=\u003e{setProfId(e.target.value);}} style={{ marginBottom:0 }}\u003e
          {data.profiles.map(p=\u003e\u003coption key={p.id} value={p.id}\u003e{p.avatar} {p.name}\u003c/option\u003e)}
        \u003c/select\u003e
      \u003c/div\u003e
      {/* Toggle all */}
      \u003cdiv style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10 }}\u003e
        \u003cdiv style={{ fontSize:12,color:"var(--text2)",fontWeight:700 }}\u003e
          \u003cspan style={{ color:"var(--purple)" }}\u003e{selected.size}\u003c/span\u003e/{parsed.length} sélectionnées
          {duplicates.size\u003e0 \u0026\u0026 \u003cspan style={{ marginLeft:8,fontSize:11,color:"var(--orange)" }}\u003e· {duplicates.size} doublons exclus\u003c/span\u003e}
        \u003c/div\u003e
        \u003cbutton onClick={toggleAll} style={{ fontSize:11,background:"rgba(167,139,250,0.1)",border:"1px solid rgba(167,139,250,0.25)",color:"var(--purple)",borderRadius:8,padding:"4px 10px",cursor:"pointer",fontWeight:700,fontFamily:"'Outfit',sans-serif" }}\u003e
          {selected.size===parsed.filter(t=\u003e!duplicates.has(t.id)).length?"Déselectionner":"Tout sélectionner"}
        \u003c/button\u003e
      \u003c/div\u003e
      {/* Liste */}
      \u003cdiv style={{ maxHeight:320,overflowY:"auto",borderRadius:12,border:"1px solid var(--border)",marginBottom:14 }}\u003e
        {parsed.map((tx, i) =\u003e {
          const cat = data.categories.find(c=\u003ec.id===tx.categoryId)||{icon:"❓",color:"#888"};
          const isDup = duplicates.has(tx.id);
          const isSel = selected.has(tx.id);
          return (
            \u003cdiv key={tx.id} onClick={()=\u003e{ if(isDup) return; const ns=new Set(selected); ns.has(tx.id)?ns.delete(tx.id):ns.add(tx.id); setSelected(ns); }}
              style={{ display:"flex",alignItems:"center",gap:10,padding:"10px 14px",borderBottom:i\u003cparsed.length-1?"1px solid rgba(255,255,255,0.05)":"none",cursor:isDup?"default":"pointer",opacity:isDup?0.45:1,background:isSel\u0026\u0026!isDup?"rgba(167,139,250,0.06)":"transparent",transition:"background .15s" }}\u003e
              \u003cdiv style={{ width:20,height:20,borderRadius:6,border:`2px solid ${isSel\u0026\u0026!isDup?"var(--purple)":"var(--border)"}`,background:isSel\u0026\u0026!isDup?"var(--purple)":"transparent",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,fontSize:11,color:"#fff",transition:"all .15s" }}\u003e
                {isSel\u0026\u0026!isDup \u0026\u0026 "✓"}
              \u003c/div\u003e
              \u003cdiv style={{ fontSize:16,flexShrink:0 }}\u003e{cat.icon}\u003c/div\u003e
              \u003cdiv style={{ flex:1,minWidth:0 }}\u003e
                \u003cdiv style={{ fontSize:13,fontWeight:700,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}\u003e{tx.label}\u003c/div\u003e
                \u003cdiv style={{ fontSize:11,color:"var(--text3)",marginTop:1 }}\u003e{new Date(tx.timestamp).toLocaleDateString("fr-FR")}\u003c/div\u003e
              \u003c/div\u003e
              \u003cdiv style={{ display:"flex",alignItems:"center",gap:8,flexShrink:0 }}\u003e
                {isDup \u0026\u0026 \u003cspan style={{ fontSize:9,background:"rgba(251,146,60,0.15)",border:"1px solid rgba(251,146,60,0.3)",color:"var(--orange)",borderRadius:8,padding:"2px 6px",fontWeight:700 }}\u003eDOUBLON\u003c/span\u003e}
                \u003cspan style={{ fontWeight:900,fontSize:14,color:"var(--red)" }}\u003e-{fmt(tx.amount)}\u003c/span\u003e
              \u003c/div\u003e
            \u003c/div\u003e
          );
        })}
      \u003c/div\u003e
      {/* Total + actions */}
      \u003cdiv style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14,padding:"8px 12px",background:"rgba(248,113,113,0.07)",border:"1px solid rgba(248,113,113,0.18)",borderRadius:10 }}\u003e
        \u003cspan style={{ fontSize:12,color:"var(--text2)",fontWeight:700 }}\u003eTotal à importer\u003c/span\u003e
        \u003cspan style={{ fontFamily:"'Fraunces',serif",fontSize:20,fontWeight:900,color:"var(--red)" }}\u003e-{fmt(totalSel)}\u003c/span\u003e
      \u003c/div\u003e
      \u003cdiv style={{ display:"flex",gap:10 }}\u003e
        \u003cbutton className="btn btn-ghost" onClick={close} style={{ flex:1 }}\u003eAnnuler\u003c/button\u003e
        \u003cbutton className="btn btn-primary" onClick={doImport} style={{ flex:1 }} disabled={selected.size===0}\u003e
          Importer {selected.size} opération{selected.size!==1?"s":""}
        \u003c/button\u003e
      \u003c/div\u003e
    \u003c/ModalWrap\u003e
  );

  // Step: paste
  return (
    \u003cModalWrap close={close} title="🏦 Importer depuis CIC"\u003e
      \u003cdiv style={{ marginBottom:16,padding:"12px 14px",background:"rgba(27,46,143,0.1)",border:"1px solid rgba(27,46,143,0.3)",borderRadius:12,fontSize:13,lineHeight:1.6,color:"var(--text2)" }}\u003e
        \u003cstrong style={{ color:"var(--text)" }}\u003eComment ça marche :\u003c/strong\u003e\u003cbr/\u003e
        1. Ouvre CIC Filbanque dans ton navigateur\u003cbr/\u003e
        2. Clique sur \u003cstrong\u003eSync DuoBudget\u003c/strong\u003e (bouton en bas à droite)\u003cbr/\u003e
        3. Reviens ici et clique \u003cstrong\u003eColler \u0026amp; Analyser\u003c/strong\u003e
      \u003c/div\u003e
      {error \u0026\u0026 \u003cdiv style={{ marginBottom:12,padding:"10px 14px",background:"rgba(248,113,113,0.1)",border:"1px solid rgba(248,113,113,0.3)",borderRadius:10,fontSize:13,color:"var(--red)",fontWeight:600 }}\u003e{error}\u003c/div\u003e}
      \u003cdiv style={{ marginBottom:14 }}\u003e
        \u003clabel\u003eProfil à associer\u003c/label\u003e
        \u003cselect value={profId} onChange={e=\u003esetProfId(e.target.value)}\u003e
          {data.profiles.map(p=\u003e\u003coption key={p.id} value={p.id}\u003e{p.avatar} {p.name}\u003c/option\u003e)}
        \u003c/select\u003e
      \u003c/div\u003e
      \u003cdiv style={{ marginBottom:16 }}\u003e
        \u003clabel\u003eDonnées copiées (optionnel — laisser vide pour coller automatiquement)\u003c/label\u003e
        \u003ctextarea ref={textRef} value={raw} onChange={e=\u003esetRaw(e.target.value)} placeholder="Colle ici le JSON copié par l'extension CIC, ou laisse vide pour lecture auto du presse-papiers…" rows={4}
          style={{ resize:"vertical",fontFamily:"monospace",fontSize:11.5,color:"var(--text3)" }}/\u003e
      \u003c/div\u003e
      \u003cdiv style={{ display:"flex",gap:10 }}\u003e
        \u003cbutton className="btn btn-ghost" onClick={close} style={{ flex:1 }}\u003eAnnuler\u003c/button\u003e
        \u003cbutton className="btn btn-primary" onClick={parseClipboard} style={{ flex:1 }}\u003e
          📋 Coller \u0026amp; Analyser
        \u003c/button\u003e
      \u003c/div\u003e
    \u003c/ModalWrap\u003e
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
  const save = () =\u003e {
    if (!name.trim()) return;
    update(d =\u003e {
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
    \u003cModalWrap close={close} title="📋 Nouvelle facture"\u003e
      \u003cdiv style={{ marginBottom:12 }}\u003e
        \u003clabel\u003eNom\u003c/label\u003e
        \u003cinput value={name} onChange={e =\u003e setName(e.target.value)} placeholder="Ex: Électricité EDF" autoFocus/\u003e
      \u003c/div\u003e
      \u003cdiv style={{ marginBottom:12 }}\u003e
        \u003clabel\u003eIcône\u003c/label\u003e
        \u003cdiv style={{ display:"flex",flexWrap:"wrap",gap:5 }}\u003e
          {BILL_ICONS.map(i =\u003e (
            \u003cbutton key={i} onClick={() =\u003e setIcon(i)} style={{
              fontSize:18, background:icon===i?"rgba(167,139,250,0.2)":"rgba(255,255,255,0.05)",
              border:`2px solid ${icon===i?"var(--purple)":"transparent"}`,
              borderRadius:8, width:36, height:36, cursor:"pointer", transition:"all .15s",
            }}\u003e{i}\u003c/button\u003e
          ))}
        \u003c/div\u003e
      \u003c/div\u003e
      \u003cdiv className="grid-2" style={{ marginBottom:12 }}\u003e
        \u003cdiv\u003e
          \u003clabel\u003eMontant (€)\u003c/label\u003e
          \u003cinput type="number" value={amount} onChange={e =\u003e setAmount(e.target.value)} placeholder="0 = variable"/\u003e
        \u003c/div\u003e
        \u003cdiv\u003e
          \u003clabel\u003eDate d'échéance\u003c/label\u003e
          \u003cinput type="date" value={dueDate} onChange={e =\u003e setDueDate(e.target.value)}/\u003e
        \u003c/div\u003e
      \u003c/div\u003e
      \u003cdiv className="grid-2" style={{ marginBottom:12 }}\u003e
        \u003cdiv\u003e
          \u003clabel\u003ePayé par\u003c/label\u003e
          \u003cselect value={profId} onChange={e =\u003e setProfId(e.target.value)}\u003e
            {data.profiles.map(p =\u003e \u003coption key={p.id} value={p.id}\u003e{p.avatar} {p.name}\u003c/option\u003e)}
          \u003c/select\u003e
        \u003c/div\u003e
        \u003cdiv\u003e
          \u003clabel\u003eCatégorie\u003c/label\u003e
          \u003cselect value={catId} onChange={e =\u003e setCatId(e.target.value)}\u003e
            {data.categories.map(c =\u003e \u003coption key={c.id} value={c.id}\u003e{c.icon} {c.name}\u003c/option\u003e)}
          \u003c/select\u003e
        \u003c/div\u003e
      \u003c/div\u003e
      \u003cdiv style={{ display:"flex",alignItems:"center",gap:10,marginBottom:20,background:"rgba(167,139,250,0.08)",borderRadius:12,padding:13 }}\u003e
        \u003cinput type="checkbox" id="rec" checked={recurring} onChange={e =\u003e setRecurring(e.target.checked)} style={{ width:"auto",cursor:"pointer" }}/\u003e
        \u003clabel htmlFor="rec" style={{ margin:0,cursor:"pointer",fontSize:13,color:"var(--text)" }}\u003e🔄 Facture récurrente mensuelle\u003c/label\u003e
      \u003c/div\u003e
      \u003cdiv style={{ display:"flex",gap:10 }}\u003e
        \u003cbutton className="btn btn-ghost" onClick={close} style={{ flex:1 }}\u003eAnnuler\u003c/button\u003e
        \u003cbutton className="btn btn-primary" onClick={save} style={{ flex:1 }} disabled={!name.trim()}\u003eCréer\u003c/button\u003e
      \u003c/div\u003e
    \u003c/ModalWrap\u003e
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
  const save = () =\u003e {
    if (!name.trim()) return;
    update(d =\u003e {
      const idx = d.bills.findIndex(b =\u003e b.id===bill.id);
      if (idx\u003e=0) {
        d.bills[idx] = { ...d.bills[idx], name:name.trim(), amount:parseFloat(amount)||0, icon, profileId:profId, categoryId:catId,
          dueDate:dueDate ? new Date(dueDate).toISOString() : null, recurring };
      }
    });
    close();
  };
  return (
    \u003cModalWrap close={close} title="✏️ Modifier la facture"\u003e
      \u003cdiv style={{ marginBottom:12 }}\u003e
        \u003clabel\u003eNom\u003c/label\u003e
        \u003cinput value={name} onChange={e =\u003e setName(e.target.value)} placeholder="Ex: Électricité EDF" autoFocus/\u003e
      \u003c/div\u003e
      \u003cdiv style={{ marginBottom:12 }}\u003e
        \u003clabel\u003eIcône\u003c/label\u003e
        \u003cdiv style={{ display:"flex",flexWrap:"wrap",gap:5 }}\u003e
          {BILL_ICONS.map(i =\u003e (
            \u003cbutton key={i} onClick={() =\u003e setIcon(i)} style={{
              fontSize:18, background:icon===i?"rgba(167,139,250,0.2)":"rgba(255,255,255,0.05)",
              border:`2px solid ${icon===i?"var(--purple)":"transparent"}`,
              borderRadius:8, width:36, height:36, cursor:"pointer", transition:"all .15s",
            }}\u003e{i}\u003c/button\u003e
          ))}
        \u003c/div\u003e
      \u003c/div\u003e
      \u003cdiv className="grid-2" style={{ marginBottom:12 }}\u003e
        \u003cdiv\u003e
          \u003clabel\u003eMontant (€)\u003c/label\u003e
          \u003cinput type="number" value={amount} onChange={e =\u003e setAmount(e.target.value)} placeholder="0 = variable"/\u003e
        \u003c/div\u003e
        \u003cdiv\u003e
          \u003clabel\u003eDate d'échéance\u003c/label\u003e
          \u003cinput type="date" value={dueDate} onChange={e =\u003e setDueDate(e.target.value)}/\u003e
        \u003c/div\u003e
      \u003c/div\u003e
      \u003cdiv className="grid-2" style={{ marginBottom:12 }}\u003e
        \u003cdiv\u003e
          \u003clabel\u003ePayé par\u003c/label\u003e
          \u003cselect value={profId} onChange={e =\u003e setProfId(e.target.value)}\u003e
            {data.profiles.map(p =\u003e \u003coption key={p.id} value={p.id}\u003e{p.avatar} {p.name}\u003c/option\u003e)}
          \u003c/select\u003e
        \u003c/div\u003e
        \u003cdiv\u003e
          \u003clabel\u003eCatégorie\u003c/label\u003e
          \u003cselect value={catId} onChange={e =\u003e setCatId(e.target.value)}\u003e
            {data.categories.map(c =\u003e \u003coption key={c.id} value={c.id}\u003e{c.icon} {c.name}\u003c/option\u003e)}
          \u003c/select\u003e
        \u003c/div\u003e
      \u003c/div\u003e
      \u003cdiv style={{ display:"flex",alignItems:"center",gap:10,marginBottom:20,background:"rgba(167,139,250,0.08)",borderRadius:12,padding:13 }}\u003e
        \u003cinput type="checkbox" id="rec-edit" checked={recurring} onChange={e =\u003e setRecurring(e.target.checked)} style={{ width:"auto",cursor:"pointer" }}/\u003e
        \u003clabel htmlFor="rec-edit" style={{ margin:0,cursor:"pointer",fontSize:13,color:"var(--text)" }}\u003e🔄 Facture récurrente mensuelle\u003c/label\u003e
      \u003c/div\u003e
      \u003cdiv style={{ display:"flex",gap:10 }}\u003e
        \u003cbutton className="btn btn-ghost" onClick={close} style={{ flex:1 }}\u003eAnnuler\u003c/button\u003e
        \u003cbutton className="btn btn-primary" onClick={save} style={{ flex:1 }} disabled={!name.trim()}\u003eEnregistrer\u003c/button\u003e
      \u003c/div\u003e
    \u003c/ModalWrap\u003e
  );
}

function EditProfileModal({ close, data, update, profileId }) {
  const profile = data.profiles.find(p =\u003e p.id===profileId);
  const [name, setName]     = useState(profile?.name || "");
  const [avatar, setAvatar] = useState(profile?.avatar || "😊");
  const [color, setColor]   = useState(profile?.color || "#a78bfa");
  const save = () =\u003e {
    update(d =\u003e {
      const p = d.profiles.find(p =\u003e p.id===profileId);
      if (p) { p.name = name.trim(); p.avatar = avatar; p.color = color; }
    });
    close();
  };
  return (
    \u003cModalWrap close={close} title="✏️ Modifier le profil"\u003e
      \u003cdiv style={{ textAlign:"center",fontSize:64,marginBottom:10 }}\u003e{avatar}\u003c/div\u003e
      \u003cdiv className="grid-2" style={{ marginBottom:12 }}\u003e
        \u003cdiv\u003e
          \u003clabel\u003ePrénom\u003c/label\u003e
          \u003cinput value={name} onChange={e =\u003e setName(e.target.value)} onKeyDown={e =\u003e e.key==="Enter" \u0026\u0026 save()} autoFocus/\u003e
        \u003c/div\u003e
        \u003cdiv\u003e
          \u003clabel\u003eCouleur\u003c/label\u003e
          \u003cdiv style={{ display:"flex",gap:6,flexWrap:"wrap" }}\u003e
            {PROFILE_COLORS.map(c =\u003e (
              \u003cbutton key={c} onClick={() =\u003e setColor(c)} style={{ width:28,height:28,borderRadius:"50%",background:c,border:`3px solid ${color===c?"white":"transparent"}`,cursor:"pointer",transition:"all .15s" }}/\u003e
            ))}
          \u003c/div\u003e
        \u003c/div\u003e
      \u003c/div\u003e
      \u003clabel\u003eAvatar\u003c/label\u003e
      \u003cdiv style={{ display:"flex",flexWrap:"wrap",gap:6,justifyContent:"center",marginBottom:20 }}\u003e
        {AVATARS.map(a =\u003e (
          \u003cbutton key={a} onClick={() =\u003e setAvatar(a)} style={{
            fontSize:20, background:avatar===a?"rgba(167,139,250,0.2)":"rgba(255,255,255,0.05)",
            border:`2px solid ${avatar===a?"var(--purple)":"transparent"}`,
            borderRadius:9, width:40, height:40, cursor:"pointer",
          }}\u003e{a}\u003c/button\u003e
        ))}
      \u003c/div\u003e
      \u003cdiv style={{ display:"flex",gap:10 }}\u003e
        \u003cbutton className="btn btn-ghost" onClick={close} style={{ flex:1 }}\u003eAnnuler\u003c/button\u003e
        \u003cbutton className="btn btn-primary" onClick={save} style={{ flex:1 }}\u003eEnregistrer\u003c/button\u003e
      \u003c/div\u003e
    \u003c/ModalWrap\u003e
  );
}

function AddRecurringIncomeModal({ close, data, update }) {
  const [profId, setProfId]     = useState(data.profiles[0]?.id || "");
  const [amount, setAmount]     = useState("");
  const [startDate, setStartDate] = useState(curMonthKey()+"-01");
  const save = () =\u003e {
    if (!amount) return;
    update(d =\u003e {
      if (!d.recurringIncomes) d.recurringIncomes = [];
      d.recurringIncomes.push({
        id:mkid(), profileId:profId, amount:parseFloat(amount),
        startDate:new Date(startDate).toISOString(),
      });
    });
    close();
  };
  return (
    \u003cModalWrap close={close} title="🔄 Revenu récurrent"\u003e
      \u003cdiv style={{ background:"rgba(74,222,128,0.07)",borderRadius:12,padding:14,marginBottom:16,fontSize:13,color:"var(--text2)",lineHeight:1.5 }}\u003e
        Ce revenu sera appliqué automatiquement chaque mois à partir de la date choisie.
      \u003c/div\u003e
      \u003cdiv style={{ marginBottom:12 }}\u003e
        \u003clabel\u003eProfil\u003c/label\u003e
        \u003cselect value={profId} onChange={e =\u003e setProfId(e.target.value)}\u003e
          {data.profiles.map(p =\u003e \u003coption key={p.id} value={p.id}\u003e{p.avatar} {p.name}\u003c/option\u003e)}
        \u003c/select\u003e
      \u003c/div\u003e
      \u003cdiv style={{ marginBottom:12 }}\u003e
        \u003clabel\u003eMontant mensuel (€)\u003c/label\u003e
        \u003cinput type="number" value={amount} onChange={e =\u003e setAmount(e.target.value)} placeholder="Ex: 2500" autoFocus/\u003e
      \u003c/div\u003e
      \u003cdiv style={{ marginBottom:20 }}\u003e
        \u003clabel\u003eDate de début\u003c/label\u003e
        \u003cinput type="date" value={startDate} onChange={e =\u003e setStartDate(e.target.value)}/\u003e
      \u003c/div\u003e
      \u003cdiv style={{ display:"flex",gap:10 }}\u003e
        \u003cbutton className="btn btn-ghost" onClick={close} style={{ flex:1 }}\u003eAnnuler\u003c/button\u003e
        \u003cbutton className="btn btn-primary" onClick={save} style={{ flex:1 }} disabled={!amount}\u003eCréer\u003c/button\u003e
      \u003c/div\u003e
    \u003c/ModalWrap\u003e
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

  const genCode = async () =\u003e {
    setCodeLoading(true);
    const code = generateInviteCode();
    const ok = await saveInviteCode(activeUID || user.uid, code);
    if (ok) {
      update(d =\u003e { d.inviteCode = code; });
      setInviteCode(code);
    }
    setCodeLoading(false);
  };

  const copyCode = () =\u003e {
    if (!inviteCode) return;
    navigator.clipboard?.writeText(inviteCode).then(() =\u003e { setCodeCopied(true); setTimeout(() =\u003e setCodeCopied(false), 2000); });
  };

  const changePassword = async () =\u003e {
    if (!pwdOld || !pwdNew) { setPwdErr("Remplissez les deux champs."); return; }
    if (pwdNew.length \u003c 6) { setPwdErr("Nouveau mot de passe trop court (6 caractères min)."); return; }
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
  const verifyBeforeDelete = async () =\u003e {
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
  const doDelete = async () =\u003e {
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

  const resetDel = () =\u003e { setDelStep(0); setDelPwd(""); setDelErr(""); };

  const pwdStr = getPasswordStrength(pwdNew);

  return (
    \u003cdiv className="fade-up"\u003e
      \u003cdiv className="tab-bar" style={{ marginBottom:20 }}\u003e
        {[["profiles","👥","Profils"],["categories","🏷️","Catégories"],["account","🔐","Compte"]].map(([id,icon,label]) =\u003e (
          \u003cbutton key={id} className={`tab-item ${tab===id?"active":""}`} onClick={() =\u003e setTab(id)}\u003e
            \u003cspan style={{ fontSize:16 }}\u003e{icon}\u003c/span\u003e{label}
          \u003c/button\u003e
        ))}
      \u003c/div\u003e

      {tab==="profiles" \u0026\u0026 (
        \u003cdiv className="content-grid"\u003e
          \u003cdiv style={{ display:"flex",flexDirection:"column",gap:12 }}\u003e
            {data.profiles.map(p =\u003e (
              \u003cdiv key={p.id} className="card" style={{ display:"flex",alignItems:"center",gap:16,borderColor:`${p.color}25` }}\u003e
                {/* Avatar / photo */}
                \u003cdiv style={{ position:"relative",flexShrink:0 }}\u003e
                  {p.photo ? (
                    \u003cimg src={p.photo} alt={p.name} style={{ width:56,height:56,borderRadius:16,objectFit:"cover",border:`2px solid ${p.color}50` }}/\u003e
                  ) : (
                    \u003cdiv style={{ width:56,height:56,borderRadius:16,background:`${p.color}18`,border:`2px solid ${p.color}35`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:28 }}\u003e{p.avatar}\u003c/div\u003e
                  )}
                  {/* Photo upload overlay */}
                  \u003clabel style={{ position:"absolute",inset:0,borderRadius:16,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(0,0,0,0)",transition:"background .2s",margin:0 }}
                    onMouseEnter={e=\u003ee.currentTarget.style.background="rgba(0,0,0,0.55)"}
                    onMouseLeave={e=\u003ee.currentTarget.style.background="rgba(0,0,0,0)"}\u003e
                    \u003cspan style={{ fontSize:18,opacity:0,transition:"opacity .2s" }} ref={r=\u003e{if(r)r.closest('label').addEventListener('mouseenter',()=\u003er.style.opacity=1);if(r)r.closest('label')?.addEventListener('mouseleave',()=\u003er.style.opacity=0);}}\u003e📷\u003c/span\u003e
                    \u003cinput type="file" accept="image/*" style={{ display:"none" }} onChange={e=\u003e{
                      const f=e.target.files?.[0]; if(!f) return;
                      const reader=new FileReader();
                      reader.onload=ev=\u003eupdate(d=\u003e{ const prof=d.profiles.find(x=\u003ex.id===p.id); if(prof) prof.photo=ev.target.result; });
                      reader.readAsDataURL(f);
                    }}/\u003e
                  \u003c/label\u003e
                \u003c/div\u003e
                \u003cdiv style={{ flex:1 }}\u003e
                  \u003cdiv style={{ fontWeight:800,fontSize:16,color:p.color }}\u003e{p.name}\u003c/div\u003e
                  \u003cdiv style={{ fontSize:12,color:"var(--text3)",marginTop:2 }}\u003e{p.id==="common"?"Compte commun":"Compte personnel"}\u003c/div\u003e
                  {p.photo \u0026\u0026 (
                    \u003cbutton onClick={() =\u003e update(d=\u003e{ const prof=d.profiles.find(x=\u003ex.id===p.id); if(prof) prof.photo=null; })}
                      style={{ marginTop:5,background:"none",border:"none",cursor:"pointer",fontSize:10,color:"var(--text3)",fontFamily:"'Outfit',sans-serif",padding:0,fontWeight:600 }}\u003e
                      🗑️ Supprimer la photo
                    \u003c/button\u003e
                  )}
                \u003c/div\u003e
                \u003cbutton className="btn btn-ghost btn-sm" onClick={() =\u003e setModal({ type:"editProfile",profileId:p.id })}\u003e✏️ Modifier\u003c/button\u003e
              \u003c/div\u003e
            ))}
          \u003c/div\u003e
          \u003cdiv className="card"\u003e
            \u003cdiv style={{ fontWeight:700,fontSize:13,marginBottom:12 }}\u003e📸 Photo de profil\u003c/div\u003e
            \u003cdiv style={{ fontSize:12,color:"var(--text2)",lineHeight:1.7 }}\u003e
              Cliquez sur l'avatar pour ajouter une photo personnalisée. Les photos sont stockées localement dans votre espace.
            \u003c/div\u003e
            \u003cdiv style={{ marginTop:12,padding:"10px 14px",background:"rgba(167,139,250,0.06)",border:"1px solid rgba(167,139,250,0.15)",borderRadius:11,fontSize:11,color:"var(--text3)",lineHeight:1.6 }}\u003e
              💡 Formats acceptés : JPG, PNG, GIF, WEBP
            \u003c/div\u003e
          \u003c/div\u003e
        \u003c/div\u003e
      )}

      {tab==="categories" \u0026\u0026 (
        \u003cdiv className="grid-2"\u003e
          {data.categories.map(c =\u003e (
            \u003cdiv key={c.id} className="card card-sm" style={{ display:"flex",alignItems:"center",gap:12,borderColor:`${c.color}22` }}\u003e
              \u003cdiv style={{ width:40,height:40,borderRadius:11,background:`${c.color}18`,border:`1px solid ${c.color}30`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:20 }}\u003e{c.icon}\u003c/div\u003e
              \u003cdiv style={{ flex:1 }}\u003e
                \u003cdiv style={{ fontWeight:700,color:c.color }}\u003e{c.name}\u003c/div\u003e
                \u003cdiv style={{ fontSize:10,color:"var(--text3)",marginTop:2 }}\u003eID: {c.id}\u003c/div\u003e
              \u003c/div\u003e
              \u003cdiv style={{ width:14,height:14,borderRadius:"50%",background:c.color,flexShrink:0 }}/\u003e
            \u003c/div\u003e
          ))}
        \u003c/div\u003e
      )}

      {tab==="account" \u0026\u0026 (
        \u003cdiv className="content-grid"\u003e
          {/* Partner invite code */}
          \u003cdiv style={{ display:"flex",flexDirection:"column",gap:16 }}\u003e
            \u003cdiv className="card" style={{ borderColor:"rgba(167,139,250,0.2)" }}\u003e
              \u003cdiv style={{ display:"flex",alignItems:"center",gap:10,marginBottom:14 }}\u003e
                \u003cdiv style={{ width:38,height:38,borderRadius:11,background:"rgba(167,139,250,0.12)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:20 }}\u003e💑\u003c/div\u003e
                \u003cdiv\u003e
                  \u003cdiv style={{ fontWeight:800,fontSize:14 }}\u003eCode d'invitation partenaire\u003c/div\u003e
                  \u003cdiv style={{ fontSize:11,color:"var(--text3)" }}\u003ePartagez ce code avec votre partenaire pour accéder au même espace\u003c/div\u003e
                \u003c/div\u003e
              \u003c/div\u003e
              {inviteCode ? (
                \u003cdiv\u003e
                  \u003cdiv style={{ display:"flex",gap:8,marginBottom:10 }}\u003e
                    \u003cdiv style={{ flex:1,background:"rgba(167,139,250,0.08)",border:"1px solid rgba(167,139,250,0.3)",borderRadius:12,padding:"14px",textAlign:"center",fontFamily:"'Fraunces',serif",fontSize:28,fontWeight:900,letterSpacing:8,color:"var(--purple)" }}\u003e{inviteCode}\u003c/div\u003e
                  \u003c/div\u003e
                  \u003cdiv style={{ display:"flex",gap:8 }}\u003e
                    \u003cbutton className="btn btn-primary" style={{ flex:1 }} onClick={copyCode}\u003e{codeCopied?"✅ Copié !":"📋 Copier le code"}\u003c/button\u003e
                    \u003cbutton className="btn btn-ghost btn-sm" onClick={genCode} disabled={codeLoading}\u003e🔄\u003c/button\u003e
                  \u003c/div\u003e
                  \u003cdiv style={{ fontSize:11,color:"var(--text3)",marginTop:10,lineHeight:1.6 }}\u003e
                    ℹ️ Votre partenaire doit créer un compte via "Rejoindre" et entrer ce code.
                  \u003c/div\u003e
                \u003c/div\u003e
              ) : (
                \u003cbutton className="btn btn-primary" style={{ width:"100%" }} onClick={genCode} disabled={codeLoading}\u003e
                  {codeLoading ? "Génération…" : "✨ Générer un code d'invitation"}
                \u003c/button\u003e
              )}
            \u003c/div\u003e

            {/* Change password */}
            \u003cdiv className="card"\u003e
              \u003cdiv style={{ display:"flex",alignItems:"center",gap:10,marginBottom:16 }}\u003e
                \u003cdiv style={{ width:38,height:38,borderRadius:11,background:"rgba(96,165,250,0.12)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:20 }}\u003e🔐\u003c/div\u003e
                \u003cdiv\u003e
                  \u003cdiv style={{ fontWeight:800,fontSize:14 }}\u003eChanger le mot de passe\u003c/div\u003e
                  \u003cdiv style={{ fontSize:11,color:"var(--text3)" }}\u003eCompte : {user?.email}\u003c/div\u003e
                \u003c/div\u003e
              \u003c/div\u003e
              \u003cdiv style={{ marginBottom:12 }}\u003e
                \u003clabel\u003eMot de passe actuel\u003c/label\u003e
                \u003cinput type="password" value={pwdOld} onChange={e=\u003esetPwdOld(e.target.value)} placeholder="••••••••" autoComplete="current-password"/\u003e
              \u003c/div\u003e
              \u003cdiv style={{ marginBottom:8 }}\u003e
                \u003clabel\u003eNouveau mot de passe\u003c/label\u003e
                \u003cinput type="password" value={pwdNew} onChange={e=\u003esetPwdNew(e.target.value)} placeholder="Minimum 6 caractères" autoComplete="new-password"/\u003e
              \u003c/div\u003e
              {pwdNew.length\u003e0 \u0026\u0026 (
                \u003cdiv style={{ marginBottom:12 }}\u003e
                  \u003cdiv className="pwd-strength"\u003e{[1,2,3,4,5].map(i =\u003e \u003cdiv key={i} className="pwd-strength-bar" style={{ background:i\u003c=pwdStr.score?pwdStr.color:"rgba(255,255,255,0.07)" }}/\u003e)}\u003c/div\u003e
                  {pwdStr.label \u0026\u0026 \u003cdiv style={{ fontSize:11,color:pwdStr.color,marginTop:4,textAlign:"right",fontWeight:600 }}\u003e{pwdStr.label}\u003c/div\u003e}
                \u003c/div\u003e
              )}
              {pwdErr \u0026\u0026 \u003cdiv className="alert-banner alert-danger" style={{ marginBottom:12 }}\u003e⚠️ {pwdErr}\u003c/div\u003e}
              {pwdOk  \u0026\u0026 \u003cdiv className="alert-banner alert-success" style={{ marginBottom:12 }}\u003e✅ Mot de passe modifié avec succès !\u003c/div\u003e}
              \u003cbutton className="btn btn-primary" style={{ width:"100%" }} onClick={changePassword} disabled={pwdLoading||!pwdOld||!pwdNew}\u003e
                {pwdLoading ? "Modification…" : "🔑 Mettre à jour le mot de passe"}
              \u003c/button\u003e
            \u003c/div\u003e
          \u003c/div\u003e

          {/* Account info + Danger zone */}
          \u003cdiv className="card"\u003e
            \u003cdiv style={{ fontWeight:700,fontSize:13,marginBottom:14 }}\u003e👤 Mon compte\u003c/div\u003e
            \u003cdiv style={{ display:"flex",flexDirection:"column",gap:10,marginBottom:20 }}\u003e
              {[
                { label:"Email",    val:user?.email,       icon:"✉️" },
                { label:"UID",      val:user?.uid?.slice(0,12)+"…", icon:"🔑" },
                { label:"Données",  val:activeUID===user?.uid?"Votre espace":"Espace partagé", icon:"💾" },
              ].map(({ label,val,icon }) =\u003e (
                \u003cdiv key={label} style={{ display:"flex",alignItems:"center",gap:10,padding:"10px 14px",background:"rgba(255,255,255,0.03)",borderRadius:11,border:"1px solid var(--border)" }}\u003e
                  \u003cspan style={{ fontSize:16 }}\u003e{icon}\u003c/span\u003e
                  \u003cspan style={{ fontSize:12,color:"var(--text3)",fontWeight:600,flex:1 }}\u003e{label}\u003c/span\u003e
                  \u003cspan style={{ fontSize:12,fontWeight:700,color:"var(--text2)",overflow:"hidden",textOverflow:"ellipsis",maxWidth:140 }}\u003e{val}\u003c/span\u003e
                \u003c/div\u003e
              ))}
            \u003c/div\u003e

            {/* ── Zone de danger ── */}
            \u003cdiv style={{ borderTop:"1px solid rgba(248,113,113,0.18)",paddingTop:18 }}\u003e
              \u003cdiv style={{ display:"flex",alignItems:"center",gap:7,marginBottom:14 }}\u003e
                \u003cdiv style={{ width:6,height:6,borderRadius:"50%",background:"var(--red)",boxShadow:"0 0 8px var(--red)",animation:"pulse 2s infinite" }}/\u003e
                \u003cspan style={{ fontSize:10,color:"var(--red)",textTransform:"uppercase",letterSpacing:2,fontWeight:900 }}\u003eZone de danger\u003c/span\u003e
              \u003c/div\u003e

              {/* Étape 0 — bouton initial */}
              {delStep === 0 \u0026\u0026 (
                \u003cbutton onClick={() =\u003e setDelStep(1)}
                  style={{ width:"100%",padding:"11px 16px",borderRadius:12,border:"1px solid rgba(248,113,113,0.3)",background:"rgba(248,113,113,0.06)",color:"var(--red)",cursor:"pointer",fontFamily:"'Outfit',sans-serif",fontWeight:700,fontSize:13,display:"flex",alignItems:"center",justifyContent:"center",gap:8,transition:"all .2s" }}
                  onMouseEnter={e=\u003e{e.currentTarget.style.background="rgba(248,113,113,0.14)";e.currentTarget.style.borderColor="rgba(248,113,113,0.5)";}}
                  onMouseLeave={e=\u003e{e.currentTarget.style.background="rgba(248,113,113,0.06)";e.currentTarget.style.borderColor="rgba(248,113,113,0.3)";}}\u003e
                  🗑️ Supprimer mon compte
                \u003c/button\u003e
              )}

              {/* Étape 1 — saisie du mot de passe */}
              {delStep === 1 \u0026\u0026 (
                \u003cdiv style={{ background:"rgba(248,113,113,0.05)",border:"1px solid rgba(248,113,113,0.2)",borderRadius:14,padding:"16px" }} className="fade-up"\u003e
                  \u003cdiv style={{ fontWeight:800,fontSize:13,color:"var(--red)",marginBottom:6 }}\u003e🔐 Confirmer votre identité\u003c/div\u003e
                  \u003cdiv style={{ fontSize:12,color:"var(--text2)",lineHeight:1.65,marginBottom:14 }}\u003e
                    Saisissez votre mot de passe actuel pour confirmer. La suppression est \u003cstrong\u003eirréversible\u003c/strong\u003e.
                  \u003c/div\u003e
                  \u003cinput type="password" value={delPwd} onChange={e=\u003esetDelPwd(e.target.value)}
                    placeholder="Votre mot de passe" autoFocus
                    onKeyDown={e=\u003ee.key==="Enter"\u0026\u0026verifyBeforeDelete()}
                    style={{ marginBottom:10,background:"rgba(248,113,113,0.06)",border:"1px solid rgba(248,113,113,0.25)",borderRadius:11 }}/\u003e
                  {delErr \u0026\u0026 \u003cdiv style={{ fontSize:12,color:"var(--red)",fontWeight:700,marginBottom:10 }}\u003e⚠️ {delErr}\u003c/div\u003e}
                  \u003cdiv style={{ display:"flex",gap:8 }}\u003e
                    \u003cbutton onClick={resetDel} style={{ flex:1,padding:"9px",borderRadius:10,border:"1px solid var(--border)",background:"var(--glass)",color:"var(--text2)",cursor:"pointer",fontFamily:"'Outfit',sans-serif",fontWeight:700,fontSize:13 }}\u003e
                      Annuler
                    \u003c/button\u003e
                    \u003cbutton onClick={verifyBeforeDelete} disabled={delLoading||!delPwd}
                      style={{ flex:1,padding:"9px",borderRadius:10,border:"1px solid rgba(248,113,113,0.4)",background:"rgba(248,113,113,0.15)",color:"var(--red)",cursor:delLoading||!delPwd?"not-allowed":"pointer",fontFamily:"'Outfit',sans-serif",fontWeight:800,fontSize:13,opacity:!delPwd?.5:1 }}\u003e
                      {delLoading?"Vérification…":"Continuer →"}
                    \u003c/button\u003e
                  \u003c/div\u003e
                \u003c/div\u003e
              )}

              {/* Étape 2 — confirmation finale */}
              {delStep === 2 \u0026\u0026 (
                \u003cdiv style={{ background:"rgba(248,113,113,0.08)",border:"2px solid rgba(248,113,113,0.4)",borderRadius:14,padding:"18px" }} className="fade-up"\u003e
                  \u003cdiv style={{ fontSize:24,textAlign:"center",marginBottom:10 }}\u003e⚠️\u003c/div\u003e
                  \u003cdiv style={{ fontWeight:900,fontSize:14,color:"var(--red)",textAlign:"center",marginBottom:8 }}\u003eSuppression définitive\u003c/div\u003e
                  \u003cdiv style={{ fontSize:12,color:"var(--text2)",lineHeight:1.7,marginBottom:16,textAlign:"center" }}\u003e
                    Le compte \u003cstrong style={{ color:"var(--text)" }}\u003e{user?.email}\u003c/strong\u003e et toutes ses données seront \u003cstrong\u003edéfinitivement supprimés\u003c/strong\u003e. Cette action est irréversible.
                  \u003c/div\u003e
                  {delErr \u0026\u0026 \u003cdiv style={{ fontSize:12,color:"var(--red)",fontWeight:700,marginBottom:10,textAlign:"center" }}\u003e⚠️ {delErr}\u003c/div\u003e}
                  \u003cdiv style={{ display:"flex",gap:8 }}\u003e
                    \u003cbutton onClick={resetDel} style={{ flex:1,padding:"11px",borderRadius:10,border:"1px solid var(--border)",background:"var(--glass)",color:"var(--text2)",cursor:"pointer",fontFamily:"'Outfit',sans-serif",fontWeight:700,fontSize:13 }}\u003e
                      ✋ Annuler
                    \u003c/button\u003e
                    \u003cbutton onClick={doDelete} disabled={delLoading}
                      style={{ flex:1.4,padding:"11px",borderRadius:10,border:"none",background:"linear-gradient(135deg,#f87171,#dc2626)",color:"white",cursor:delLoading?"not-allowed":"pointer",fontFamily:"'Outfit',sans-serif",fontWeight:900,fontSize:13,boxShadow:"0 4px 18px rgba(248,113,113,0.45)",opacity:delLoading?.6:1 }}\u003e
                      {delLoading?"Suppression…":"🗑️ Supprimer définitivement"}
                    \u003c/button\u003e
                  \u003c/div\u003e
                \u003c/div\u003e
              )}
            \u003c/div\u003e
          \u003c/div\u003e
        \u003c/div\u003e
      )}
    \u003c/div\u003e
  );
}



// ═══════════════════════════════════════════════════════════
//  ESSENCE — Prix carburants France
// ═══════════════════════════════════════════════════════════

const haversineKm = (la1,lo1,la2,lo2) =\u003e {
  const R=6371, d2r=Math.PI/180;
  const dLa=(la2-la1)*d2r, dLo=(lo2-lo1)*d2r;
  const a=Math.sin(dLa/2)**2+Math.cos(la1*d2r)*Math.cos(la2*d2r)*Math.sin(dLo/2)**2;
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
};
const fmtKm = km =\u003e km==null ? null : km\u003c1 ? `${Math.round(km*1000)} m` : `${km.toFixed(1)} km`;

// ── Base de données marques avec SVG logos inline ──
const BRAND_DATA = {
  "totalenergies": {
    label:"TotalEnergies", abbr:"TE", bg:"#150A00", fg:"#fff",
    patterns:[/totalenergies/i, /total\s*energies/i],
    logo: (s) =\u003e (
      \u003csvg width={s} height={s} viewBox="0 0 100 100"\u003e
        \u003crect width="100" height="100" fill="#150A00"/\u003e
        \u003cdefs\u003e
          \u003clinearGradient id="teg1" x1="0" y1="0" x2="1" y2="1"\u003e
            \u003cstop offset="0%" stopColor="#E8000D"/\u003e\u003cstop offset="55%" stopColor="#FF6B00"/\u003e\u003cstop offset="100%" stopColor="#00A650"/\u003e
          \u003c/linearGradient\u003e
          \u003clinearGradient id="teg2" x1="0" y1="1" x2="1" y2="0"\u003e
            \u003cstop offset="0%" stopColor="#003F9B"/\u003e\u003cstop offset="100%" stopColor="#00A4E4"/\u003e
          \u003c/linearGradient\u003e
        \u003c/defs\u003e
        \u003crect x="18" y="18" width="64" height="16" rx="8" fill="url(#teg1)"/\u003e
        \u003crect x="42" y="18" width="16" height="56" rx="8" fill="url(#teg1)"/\u003e
        \u003cpath d="M14 66 Q14 50 30 50 Q46 50 46 66 Q46 76 38 79 Q22 83 14 74 Z" fill="url(#teg2)"/\u003e
        \u003crect x="14" y="62" width="32" height="6" rx="3" fill="#150A00"/\u003e
      \u003c/svg\u003e
    )
  },
  "total_access": {
    label:"Total Access", abbr:"TA", bg:"#E8000D", fg:"#fff",
    patterns:[/total\s*access/i],
    logo: null
  },
  "total": {
    label:"Total", abbr:"TO", bg:"#E8000D", fg:"#fff",
    patterns:[/\btotal\b/i],
    logo: null
  },
  "leclerc": {
    label:"E. Leclerc", abbr:"E.", bg:"#00309A", fg:"#fff",
    patterns:[/e\.?\s*leclerc/i, /petro\s*est/i, /sodibrag/i, /galec/i, /sodia/i, /\bleclerc\b/i],
    logo: (s) =\u003e (
      \u003csvg width={s} height={s} viewBox="0 0 100 100"\u003e
        \u003crect width="100" height="100" fill="#00309A"/\u003e
        \u003ctext x="50" y="62" textAnchor="middle" fill="#fff"
          style={{fontFamily:"Arial Black,sans-serif",fontSize:42,fontWeight:900,letterSpacing:-2}}\u003eE.\u003c/text\u003e
        \u003ctext x="50" y="82" textAnchor="middle" fill="#FFD700"
          style={{fontFamily:"Arial,sans-serif",fontSize:14,fontWeight:700,letterSpacing:0.5}}\u003eLECLERC\u003c/text\u003e
      \u003c/svg\u003e
    )
  },
  "intermarche": {
    label:"Intermarché", abbr:"IN", bg:"#E30613", fg:"#fff",
    patterns:[/intermarche/i, /intermarché/i, /jeandeline/i, /vert.?bois/i],
    logo: (s) =\u003e (
      \u003csvg width={s} height={s} viewBox="0 0 100 100"\u003e
        \u003crect width="100" height="100" fill="#E30613"/\u003e
        \u003ccircle cx="50" cy="42" r="22" fill="#fff"/\u003e
        \u003ccircle cx="50" cy="42" r="14" fill="#E30613"/\u003e
        \u003ccircle cx="50" cy="42" r="7" fill="#fff"/\u003e
        \u003crect x="16" y="70" width="68" height="12" rx="3" fill="#fff"/\u003e
        \u003ctext x="50" y="80" textAnchor="middle" fill="#E30613"
          style={{fontFamily:"Arial,sans-serif",fontSize:10,fontWeight:900}}\u003eINTERMARCHÉ\u003c/text\u003e
      \u003c/svg\u003e
    )
  },
  "shell": {
    label:"Shell", abbr:"SH", bg:"#FBCE07", fg:"#CC0000",
    patterns:[/\bshell\b/i],
    logo: (s) =\u003e (
      \u003csvg width={s} height={s} viewBox="0 0 100 100"\u003e
        \u003crect width="100" height="100" fill="#FBCE07"/\u003e
        \u003cpath d="M50 10 L58 35 L85 35 L63 52 L72 78 L50 61 L28 78 L37 52 L15 35 L42 35 Z" fill="#CC0000"/\u003e
      \u003c/svg\u003e
    )
  },
  "bp": {
    label:"BP", abbr:"BP", bg:"#00772A", fg:"#FBCE07",
    patterns:[/\bbp\b/i],
    logo: (s) =\u003e (
      \u003csvg width={s} height={s} viewBox="0 0 100 100"\u003e
        \u003crect width="100" height="100" fill="#00772A"/\u003e
        \u003ccircle cx="50" cy="50" r="36" fill="#FBCE07" opacity="0.2"/\u003e
        \u003ctext x="50" y="64" textAnchor="middle" fill="#FBCE07"
          style={{fontFamily:"Helvetica,Arial,sans-serif",fontSize:44,fontWeight:900,letterSpacing:-2}}\u003ebp\u003c/text\u003e
      \u003c/svg\u003e
    )
  },
  "esso": {
    label:"Esso", abbr:"ES", bg:"#003399", fg:"#fff",
    patterns:[/\besso\b/i],
    logo: (s) =\u003e (
      \u003csvg width={s} height={s} viewBox="0 0 100 100"\u003e
        \u003crect width="100" height="100" fill="#003399"/\u003e
        \u003ctext x="50" y="65" textAnchor="middle" fill="#fff"
          style={{fontFamily:"Arial Black,sans-serif",fontSize:40,fontWeight:900,fontStyle:"italic"}}\u003eesso\u003c/text\u003e
      \u003c/svg\u003e
    )
  },
  "carrefour": {
    label:"Carrefour", abbr:"CF", bg:"#004B93", fg:"#fff",
    patterns:[/carrefour/i],
    logo: (s) =\u003e (
      \u003csvg width={s} height={s} viewBox="0 0 100 100"\u003e
        \u003crect width="100" height="100" fill="#004B93"/\u003e
        \u003cpath d="M50 20 L50 80" stroke="#fff" strokeWidth="0"/\u003e
        \u003cpath d="M30 20 L50 50 L30 80" fill="#004B93" stroke="none"/\u003e
        \u003cpath d="M70 20 L50 50 L70 80" fill="#004B93" stroke="none"/\u003e
        \u003cpolygon points="28,18 50,50 28,82 38,82 60,50 38,18" fill="#E30613"/\u003e
        \u003cpolygon points="72,18 50,50 72,82 62,82 40,50 62,18" fill="#004B93"/\u003e
        \u003cpolygon points="50,18 72,18 62,18 50,50" fill="#E30613"/\u003e
        \u003cpolygon points="50,82 72,82 62,82 50,50" fill="#E30613"/\u003e
        \u003cpolygon points="28,18 50,18 38,18 50,50" fill="#004B93"/\u003e
        \u003cpolygon points="28,82 50,82 38,82 50,50" fill="#004B93"/\u003e
        \u003cpath d="M42 18 L58 18 L68 34 L50 50 L32 34 Z" fill="#E30613"/\u003e
        \u003cpath d="M42 82 L58 82 L68 66 L50 50 L32 66 Z" fill="#E30613"/\u003e
      \u003c/svg\u003e
    )
  },
  "auchan": {
    label:"Auchan", abbr:"AU", bg:"#E42312", fg:"#fff",
    patterns:[/auchan/i],
    logo: null
  },
  "casino": {
    label:"Casino", abbr:"CA", bg:"#E31E24", fg:"#fff",
    patterns:[/géant\s*casino/i, /geant\s*casino/i, /\bcasino\b/i],
    logo: null
  },
  "cora": {
    label:"Cora", abbr:"CO", bg:"#E8751A", fg:"#fff",
    patterns:[/\bcora\b/i],
    logo: null
  },
  "super_u": {
    label:"Super U", abbr:"SU", bg:"#005BAF", fg:"#fff",
    patterns:[/super\s*u\b/i, /hyper\s*u\b/i, /u\s*express/i, /syst.me\s*u/i],
    logo: (s) =\u003e (
      \u003csvg width={s} height={s} viewBox="0 0 100 100"\u003e
        \u003crect width="100" height="100" fill="#005BAF"/\u003e
        \u003ctext x="50" y="68" textAnchor="middle" fill="#fff"
          style={{fontFamily:"Arial Black,sans-serif",fontSize:58,fontWeight:900,letterSpacing:-2}}\u003eU\u003c/text\u003e
      \u003c/svg\u003e
    )
  },
  "lidl": {
    label:"Lidl", abbr:"LI", bg:"#0050AA", fg:"#FBCE07",
    patterns:[/\blidl\b/i],
    logo: (s) =\u003e (
      \u003csvg width={s} height={s} viewBox="0 0 100 100"\u003e
        \u003crect width="100" height="100" rx="20" fill="#0050AA"/\u003e
        \u003ccircle cx="50" cy="42" r="26" fill="#E8000D" stroke="#fff" strokeWidth="3"/\u003e
        \u003ccircle cx="50" cy="42" r="18" fill="#FBCE07"/\u003e
        \u003ctext x="50" y="95" textAnchor="middle" fill="#fff"
          style={{fontFamily:"Arial Black,sans-serif",fontSize:14,fontWeight:900,letterSpacing:1}}\u003eLIDL\u003c/text\u003e
      \u003c/svg\u003e
    )
  },
  "colruyt": { label:"Colruyt", abbr:"CL", bg:"#E63226", fg:"#fff", patterns:[/colruyt/i], logo:null },
  "netto":   { label:"Netto",   abbr:"NE", bg:"#E63226", fg:"#fff", patterns:[/\bnetto\b/i], logo:null },
  "elan":    { label:"Élan",    abbr:"EL", bg:"#0EA5E9", fg:"#fff", patterns:[/elan|élan/i], logo:null },
  "vito":    { label:"Vito",    abbr:"VI", bg:"#7C3AED", fg:"#fff", patterns:[/\bvito\b/i], logo:null },
  "relais":  { label:"Relais",  abbr:"RL", bg:"#F59E0B", fg:"#1a1a1a", patterns:[/\brelais\b/i], logo:null },
  "dyneff":  { label:"Dyneff",  abbr:"DY", bg:"#FF6600", fg:"#fff", patterns:[/dyneff/i], logo:null },
};

// ── Détection marque (cherche dans nom, enseignes ET adresse) ──
const detectBrand = (nom, enseignes, adresse) =\u003e {
  const src = `${nom||""} ${Array.isArray(enseignes)?enseignes.join(" "):(enseignes||"")} ${adresse||""}`.toLowerCase();
  for(const [key, b] of Object.entries(BRAND_DATA)){
    if(b.patterns.some(re=\u003ere.test(src))) return {...b, key};
  }
  return null;
};

// ── Composant icône de marque ──
function BrandIcon({ nom, enseignes, adresse, size=44 }) {
  const brand = detectBrand(nom, enseignes, adresse);
  const r = Math.round(size * 0.26);

  if(brand?.logo){
    return (
      \u003cdiv style={{width:size,height:size,borderRadius:r,overflow:"hidden",flexShrink:0,
        boxShadow:`0 3px 12px ${brand.bg}60`}}\u003e
        {brand.logo(size)}
      \u003c/div\u003e
    );
  }

  // Badge générique avec initiales
  const b = brand || {
    abbr: (nom||"?").split(/\s+/).slice(0,2).map(w=\u003ew[0]||"").join("").toUpperCase().slice(0,2)||"⛽",
    bg:"#1e293b", fg:"rgba(255,255,255,0.8)"
  };
  return (
    \u003cdiv style={{
      width:size,height:size,borderRadius:r,flexShrink:0,
      background:b.bg, color:b.fg,
      boxShadow:`0 3px 12px ${b.bg === "#1e293b" ? "rgba(0,0,0,0.4)" : b.bg+"60"}`,
      display:"flex",alignItems:"center",justifyContent:"center",
      fontSize:Math.round(size*0.31),fontWeight:900,
      fontFamily:"'Outfit',sans-serif",letterSpacing:-0.5,
    }}\u003e{b.abbr}\u003c/div\u003e
  );
}

// ── Résolution du vrai nom d'établissement ──
// Cherche dans enseignes, puis nom API, puis tente OSM plus tard
const resolveNom = (r) =\u003e {
  const adresse = (r.adresse||"").trim();

  // 1. Champ enseignes officiel
  let ens = r.enseignes;
  if(typeof ens==="string"){ try{ens=JSON.parse(ens);}catch{ens=ens?[ens]:[];} }
  const ensStr = Array.isArray(ens) ? ens.filter(Boolean).join(" ").trim() : (ens||"").trim();
  if(ensStr) return { nom:ensStr, nomIsAdresse:false };

  // 2. Vérifier si r.nom est différent de l'adresse
  const nomApi = (r.nom||"").trim();
  const norm = s =\u003e s.toLowerCase().replace(/[,.']/g,"").replace(/\s+/g," ").trim();
  const nomSameAsAddr = !nomApi ||
    norm(nomApi) === norm(adresse) ||
    norm(adresse).includes(norm(nomApi).slice(0,15)) ||
    norm(nomApi).includes(norm(adresse).slice(0,15));

  if(nomApi \u0026\u0026 !nomSameAsAddr){
    return { nom:nomApi, nomIsAdresse:false };
  }

  // 3. Détection depuis adresse (stations autoroute, grandes surfaces connues)
  const brand = detectBrand("", "", adresse);
  if(brand) return { nom:brand.label, nomIsAdresse:false };

  // 4. Fallback → adresse courte
  const adresseComp = adresse.split(",")[0].trim() || nomApi || `Station`;
  return { nom:adresseComp, nomIsAdresse:true };
};

// ── Modal navigation ──
function NavModal({ station, userLat, userLng, onClose }) {
  const lat = station.lat, lng = station.lng;
  if(!lat || !lng) return null;
  const dist = (userLat\u0026\u0026userLng\u0026\u0026station._dist!=null) ? fmtKm(station._dist) : null;
  const opts = [
    { label:"Apple Plans",  icon:"🍎", sub:"Navigation native iOS / macOS",  href:`https://maps.apple.com/?daddr=${lat},${lng}\u0026dirflg=d` },
    { label:"Google Maps",  icon:"🗺️", sub:"Tous appareils",                  href:`https://maps.google.com/maps?daddr=${lat},${lng}` },
    { label:"Waze",         icon:"🔵", sub:"Trafic en temps réel",            href:`https://waze.com/ul?ll=${lat},${lng}\u0026navigate=yes` },
    { label:"Here WeGo",    icon:"📡", sub:"Navigation offline",              href:`https://share.here.com/r/${lat},${lng}` },
  ];
  return (
    \u003cdiv onClick={e=\u003ee.target===e.currentTarget\u0026\u0026onClose()}
      style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.8)",backdropFilter:"blur(16px)",
        display:"flex",alignItems:"center",justifyContent:"center",zIndex:3000,padding:20}}\u003e
      \u003cdiv style={{background:"linear-gradient(145deg,#0d0b1e,#1a1635)",border:"1px solid rgba(255,255,255,0.12)",
        borderRadius:24,padding:24,width:"100%",maxWidth:400}}\u003e
        \u003cdiv style={{display:"flex",alignItems:"flex-start",gap:14,marginBottom:20}}\u003e
          \u003cBrandIcon nom={station.nom} enseignes={station.enseignes} adresse={station.adresse} size={50}/\u003e
          \u003cdiv style={{flex:1,minWidth:0}}\u003e
            \u003cdiv style={{fontWeight:900,fontSize:15,color:"#fff",textTransform:"uppercase",letterSpacing:.5,marginBottom:3}}\u003e
              {(station.nom||"Station").toUpperCase()}
            \u003c/div\u003e
            \u003cdiv style={{fontSize:11,color:"var(--text3)",lineHeight:1.5}}\u003e
              {station.adresse}{station.ville?` — ${station.ville}`:""}
            \u003c/div\u003e
            {dist\u0026\u0026\u003cdiv style={{fontSize:12,color:"var(--yellow)",fontWeight:800,marginTop:5}}\u003e📍 {dist}\u003c/div\u003e}
          \u003c/div\u003e
          \u003cbutton onClick={onClose} style={{background:"rgba(255,255,255,0.08)",border:"none",
            color:"var(--text3)",cursor:"pointer",fontSize:18,width:32,height:32,borderRadius:8,
            display:"flex",alignItems:"center",justifyContent:"center"}}\u003e✕\u003c/button\u003e
        \u003c/div\u003e
        \u003cdiv style={{fontSize:10,color:"var(--text3)",marginBottom:12,fontWeight:700,
          textTransform:"uppercase",letterSpacing:1.2}}\u003eNavigation vers cette station\u003c/div\u003e
        {opts.map(o=\u003e(
          \u003ca key={o.label} href={o.href} target="_blank" rel="noopener noreferrer"
            style={{display:"flex",alignItems:"center",gap:14,padding:"13px 16px",marginBottom:8,
              background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)",
              borderRadius:14,textDecoration:"none",color:"#fff",transition:"all .18s",cursor:"pointer"}}
            onMouseEnter={e=\u003e{e.currentTarget.style.background="rgba(167,139,250,0.12)";e.currentTarget.style.borderColor="rgba(167,139,250,0.3)"}}
            onMouseLeave={e=\u003e{e.currentTarget.style.background="rgba(255,255,255,0.04)";e.currentTarget.style.borderColor="rgba(255,255,255,0.08)"}}\u003e
            \u003cspan style={{fontSize:24,flexShrink:0}}\u003e{o.icon}\u003c/span\u003e
            \u003cdiv style={{flex:1}}\u003e
              \u003cdiv style={{fontWeight:700,fontSize:13}}\u003e{o.label}\u003c/div\u003e
              \u003cdiv style={{fontSize:11,color:"var(--text3)"}}\u003e{o.sub}\u003c/div\u003e
            \u003c/div\u003e
            \u003cspan style={{color:"var(--text3)",fontSize:18}}\u003e›\u003c/span\u003e
          \u003c/a\u003e
        ))}
      \u003c/div\u003e
    \u003c/div\u003e
  );
}

// ── Carte Leaflet ──
function FuelMapLeaflet({ stations, userLat, userLng }) {
  const mapRef=useRef(null), instRef=useRef(null);
  useEffect(()=\u003e{
    if(!mapRef.current) return;
    const init=()=\u003e{
      if(instRef.current){instRef.current.remove();instRef.current=null;}
      const L=window.L;
      const center=userLat\u0026\u0026userLng?[userLat,userLng]:[48.638,4.946];
      const map=L.map(mapRef.current,{zoomControl:true}).setView(center,userLat?13:10);
      instRef.current=map;
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{attribution:"© OpenStreetMap",maxZoom:19}).addTo(map);
      if(userLat\u0026\u0026userLng){
        const ui=L.divIcon({html:`\u003cdiv style="width:20px;height:20px;background:#a78bfa;border:3px solid #fff;border-radius:50%;box-shadow:0 0 0 5px rgba(167,139,250,0.25)"\u003e\u003c/div\u003e`,className:"",iconSize:[20,20],iconAnchor:[10,10]});
        L.marker([userLat,userLng],{icon:ui}).addTo(map).bindPopup("\u003cb\u003e📍 Vous êtes ici\u003c/b\u003e");
      }
      stations.forEach(s=\u003e{
        if(!s.lat||!s.lng) return;
        const brand=detectBrand(s.nom,s.enseignes,s.adresse)||{abbr:"⛽",bg:"#374151",fg:"#fff"};
        const dist=(userLat\u0026\u0026userLng)?fmtKm(haversineKm(userLat,userLng,s.lat,s.lng)):null;
        const fuels=['gazole','sp95','e10','sp98'].filter(k=\u003es[k]!=null)
          .map(k=\u003e`\u003cspan style="background:#1e293b;color:#e2e8f0;padding:2px 6px;border-radius:5px;font-size:11px;margin:2px"\u003e${k.toUpperCase()} ${s[k].toFixed(3)}€\u003c/span\u003e`).join("");
        const icon=L.divIcon({
          html:`\u003cdiv style="background:${brand.bg};color:${brand.fg};width:38px;height:38px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:900;font-family:Outfit,sans-serif;border:2.5px solid rgba(255,255,255,0.9);box-shadow:0 4px 12px rgba(0,0,0,0.4)"\u003e${brand.abbr}\u003c/div\u003e`,
          className:"",iconSize:[38,38],iconAnchor:[19,19]
        });
        L.marker([s.lat,s.lng],{icon}).addTo(map).bindPopup(L.popup({maxWidth:270}).setContent(`
          \u003cdiv style="font-family:Outfit,sans-serif;padding:4px"\u003e
            \u003cdiv style="font-weight:900;font-size:14px;text-transform:uppercase;margin-bottom:2px"\u003e${(s.nom||"Station").slice(0,28)}\u003c/div\u003e
            \u003cdiv style="font-size:11px;color:#64748b;margin-bottom:6px"\u003e${s.adresse||""}${s.ville?" · "+s.ville:""}\u003c/div\u003e
            ${dist?`\u003cdiv style="font-size:11px;font-weight:700;color:#8b5cf6;margin-bottom:6px"\u003e📍 ${dist}\u003c/div\u003e`:""}
            \u003cdiv style="margin-bottom:10px;display:flex;flex-wrap:wrap;gap:2px"\u003e${fuels}\u003c/div\u003e
            \u003ca href="https://maps.google.com/maps?daddr=${s.lat},${s.lng}" target="_blank"
              style="display:block;text-align:center;background:linear-gradient(135deg,#a78bfa,#f472b6);color:#fff;padding:9px;border-radius:10px;text-decoration:none;font-weight:800;font-size:13px"\u003e🗺️ Démarrer\u003c/a\u003e
          \u003c/div\u003e`));
      });
    };
    if(!window.L){
      if(!document.querySelector("#lf-css")){const l=document.createElement("link");l.id="lf-css";l.rel="stylesheet";l.href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";document.head.appendChild(l);}
      if(!document.querySelector("#lf-js")){const s=document.createElement("script");s.id="lf-js";s.src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";s.onload=init;document.head.appendChild(s);}
      else{setTimeout(init,100);}
    } else{init();}
    return()=\u003e{if(instRef.current){instRef.current.remove();instRef.current=null;}};
  },[stations,userLat,userLng]);
  return \u003cdiv ref={mapRef} style={{width:"100%",height:520,borderRadius:18,overflow:"hidden",border:"1px solid var(--border)",boxShadow:"0 8px 32px rgba(0,0,0,0.4)"}}/\u003e;
}

// ═══════════════════════════════════════════════════════════
function EssencePage() {
  const FUEL_META = {
    gazole: { label:"Gazole", icon:"🚛", color:"#fbbf24" },
    sp95:   { label:"SP95",   icon:"⛽", color:"#60a5fa" },
    e10:    { label:"E10",    icon:"🌿", color:"#4ade80" },
    sp98:   { label:"SP98",   icon:"🔵", color:"#a78bfa" },
  };

  const LS_KEY = "duobudget_fuel_v7";

  const [stations,   setStations]   = useState([]);
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState("");
  const [lastUpdate, setLastUpdate] = useState(null);
  const [history,    setHistory]    = useState([]);
  const [activeTab,  setActiveTab]  = useState("prices");
  const [chartFuel,  setChartFuel]  = useState("sp95");
  const [citySearch, setCitySearch] = useState("Saint-Dizier");
  const [cityInput,  setCityInput]  = useState("Saint-Dizier");
  const [radius,     setRadius]     = useState(10);
  const [countdown,  setCountdown]  = useState(600);
  const [userLat,    setUserLat]    = useState(null);
  const [userLng,    setUserLng]    = useState(null);
  const [locating,   setLocating]   = useState(false);
  const [navStation, setNavStation] = useState(null);
  const intervalRef  = useRef(null);

  useEffect(()=\u003e{
    try{
      const s=localStorage.getItem(LS_KEY);
      if(s){const{stations:st,history:h,city,ts}=JSON.parse(s);
        if(st){setStations(st);setLastUpdate(new Date(ts));}
        if(h) setHistory(h);
        if(city){setCitySearch(city);setCityInput(city);}
      }
    }catch{}
  },[]);

  useEffect(()=\u003e{
    const t=setInterval(()=\u003esetCountdown(c=\u003ec\u003c=1?600:c-1),1000);
    return()=\u003eclearInterval(t);
  },[]);

  // ── GPS toggle ──
  const locateUser = () =\u003e {
    if(userLat\u0026\u0026userLng){
      setUserLat(null); setUserLng(null);
      doFetch(citySearch, radius);
      return;
    }
    if(!navigator.geolocation){setError("Géolocalisation non supportée.");return;}
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      ({coords})=\u003e{setUserLat(coords.latitude);setUserLng(coords.longitude);setLocating(false);doFetchGeo(coords.latitude,coords.longitude,radius);},
      ()=\u003e{setLocating(false);setError("Localisation refusée.");},
      {enableHighAccuracy:true,timeout:9000}
    );
  };

  const parseResults=(results,city)=\u003eresults.map(r=\u003e{
    const fuels={};
    Object.keys(FUEL_META).forEach(k=\u003e{const v=parseFloat(r[k+"_prix"]);fuels[k]=isNaN(v)?null:v;});
    const geo=r.geom?.coordinates||r.coordonnees?.coordinates;
    const lat=geo?geo[1]:null, lng=geo?geo[0]:null;
    const adresse=(r.adresse||"").trim();
    const {nom,nomIsAdresse}=resolveNom(r);
    return {
      id:r.id||adresse, nom, nomIsAdresse,
      enseignes:r.enseignes||"", adresse,
      ville:r.ville||city, cp:r.cp||"",
      lat,lng, ...fuels,
    };
  }).filter(s=\u003eObject.keys(FUEL_META).some(k=\u003es[k]!=null));

  const finalize=async(parsed,city)=\u003e{
    // ── Enrichissement OSM ──
    let enriched=parsed;
    const withGeo=parsed.filter(s=\u003es.lat\u0026\u0026s.lng);
    if(withGeo.length\u003e0){
      try{
        const lats=withGeo.map(s=\u003es.lat),lngs=withGeo.map(s=\u003es.lng);
        const pad=0.03;
        const bbox=[(Math.min(...lats)-pad).toFixed(5),(Math.min(...lngs)-pad).toFixed(5),(Math.max(...lats)+pad).toFixed(5),(Math.max(...lngs)+pad).toFixed(5)].join(",");
        const ovQ=`[out:json][timeout:10];(node[amenity=fuel](${bbox});way[amenity=fuel](${bbox}););out center tags;`;
        const ENDPOINTS=["https://overpass-api.de/api/interpreter","https://overpass.kuro.mu/api/interpreter","https://overpass.openstreetmap.ru/api/interpreter"];
        let ovData=null;
        for(const ep of ENDPOINTS){
          try{const r=await fetch(ep,{method:"POST",body:"data="+encodeURIComponent(ovQ),signal:AbortSignal.timeout(8000)});if(r.ok){ovData=await r.json();break;}}catch{}
        }
        if(ovData?.elements?.length){
          const haverM=(la1,lo1,la2,lo2)=\u003e{const R=6371000,d2r=Math.PI/180,dLa=(la2-la1)*d2r,dLo=(lo2-lo1)*d2r,a=Math.sin(dLa/2)**2+Math.cos(la1*d2r)*Math.cos(la2*d2r)*Math.sin(dLo/2)**2;return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));};
          const osmNodes=ovData.elements.map(el=\u003e({
            lat:el.lat??el.center?.lat,lng:el.lon??el.center?.lon,
            // Priority: brand \u003e operator \u003e name
            name:el.tags?.brand||el.tags?.operator||el.tags?.name||"",
          })).filter(n=\u003en.lat\u0026\u0026n.lng\u0026\u0026n.name\u0026\u0026n.name.length\u003e2\u0026\u0026!/^\d/.test(n.name));

          enriched=parsed.map(s=\u003e{
            if(!s.lat||!s.lng) return s;
            // Distance max 300m pour matcher
            let best=null,bestDist=300;
            osmNodes.forEach(n=\u003e{const d=haverM(s.lat,s.lng,n.lat,n.lng);if(d\u003cbestDist){bestDist=d;best=n;}});
            if(!best) return s;
            return{...s,nom:best.name,enseignes:best.name,nomIsAdresse:false};
          });
        }
      }catch{}
    }
    setStations(enriched);
    setLastUpdate(new Date());
    const ts=new Date().toISOString();
    const tsFmt=new Date().toLocaleDateString("fr-FR",{day:"2-digit",month:"short"})+" "+new Date().toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"});
    const newE=enriched.map(s=\u003e({ts,tsFmt,stationId:s.id,stationNom:(s.nom||"Station").slice(0,20),...Object.fromEntries(Object.keys(FUEL_META).map(k=\u003e[k,s[k]]))}));
    setHistory(prev=\u003e{
      const cutoff=new Date(Date.now()-86400000*30).toISOString(),last10=new Date(Date.now()-600000).toISOString();
      const next=[...prev.filter(e=\u003ee.ts\u003e=cutoff\u0026\u0026e.ts\u003clast10),...newE].slice(-800);
      try{localStorage.setItem(LS_KEY,JSON.stringify({stations:enriched,history:next,city,ts:Date.now()}));}catch{}
      return next;
    });
  };

  const doFetchGeo=useCallback(async(lat,lng,km)=\u003e{
    setLoading(true);setError("");setCountdown(600);
    try{
      const BASE="https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/prix-des-carburants-en-france-flux-instantane-v2/records";
      const w=encodeURIComponent(`distance(geom, geom'POINT(${lng} ${lat})', ${Math.round(km*1000)}m)`);
      const res=await fetch(`${BASE}?where=${w}\u0026limit=100\u0026timezone=Europe%2FParis`);
      if(!res.ok) throw new Error(`Erreur API ${res.status}`);
      const json=await res.json();
      const parsed=parseResults(json.results||[],"Ma position");
      if(!parsed.length) throw new Error("Aucune station trouvée dans ce rayon.");
      await finalize(parsed,"Ma position");
    }catch(e){setError(e.message||"Erreur inconnue");}
    setLoading(false);
  },[]);

  const doFetch=useCallback(async(city=citySearch,km=radius)=\u003e{
    setLoading(true);setError("");setCountdown(600);
    try{
      const BASE="https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/prix-des-carburants-en-france-flux-instantane-v2/records";
      const isCP=/^\d{5}$/.test(city.trim());
      let results=[];
      const geoSearch=async(lat,lng,kmR)=\u003e{const w=encodeURIComponent(`distance(geom, geom'POINT(${lng} ${lat})', ${Math.round(kmR*1000)}m)`);const r=await fetch(`${BASE}?where=${w}\u0026limit=100\u0026timezone=Europe%2FParis`);if(!r.ok)return[];const j=await r.json();return j.results||[];};
      if(isCP){
        const w=encodeURIComponent(`cp="${city.trim()}"`);
        const res=await fetch(`${BASE}?where=${w}\u0026limit=100\u0026timezone=Europe%2FParis`);
        if(!res.ok) throw new Error(`Erreur API ${res.status}`);
        const json=await res.json(); results=json.results||[];
        if(km\u003e0\u0026\u0026results.length\u003e0){
          const geo=results[0].geom?.coordinates||results[0].coordonnees?.coordinates;
          if(geo){const[lng,lat]=geo;const extra=await geoSearch(lat,lng,km);const seen=new Set(results.map(r=\u003er.id||r.adresse));extra.forEach(r=\u003e{if(!seen.has(r.id||r.adresse)){seen.add(r.id||r.adresse);results.push(r);}});}
        }
      } else {
        let cLat=null,cLng=null;
        try{const nr=await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(city.trim())}\u0026countrycodes=fr\u0026format=json\u0026limit=1`,{headers:{"Accept-Language":"fr"}});if(nr.ok){const nj=await nr.json();if(nj.length){cLat=parseFloat(nj[0].lat);cLng=parseFloat(nj[0].lon);}}}catch{}
        if(cLat\u0026\u0026cLng){results=await geoSearch(cLat,cLng,Math.max(km,5));}
        else{
          const cityN=city.trim().toUpperCase();
          const w=encodeURIComponent(`ville="${cityN}"`);
          const res=await fetch(`${BASE}?where=${w}\u0026limit=100\u0026timezone=Europe%2FParis`);
          if(!res.ok)throw new Error(`Erreur API ${res.status}`);
          const json=await res.json();results=json.results||[];
          if(!results.length){const w2=encodeURIComponent(`ville like "${cityN}%"`);const r2=await fetch(`${BASE}?where=${w2}\u0026limit=100\u0026timezone=Europe%2FParis`);if(r2.ok){const j2=await r2.json();results=j2.results||[];}}
        }
      }
      if(!results.length) throw new Error(`Aucune station trouvée pour "${city}".`);
      const parsed=parseResults(results,city);
      if(!parsed.length) throw new Error(`Aucun prix disponible pour "${city}".`);
      await finalize(parsed,city);
    }catch(e){setError(e.message||"Erreur inconnue");}
    setLoading(false);
  },[citySearch]);

  useEffect(()=\u003e{
    doFetch(citySearch);
    if(intervalRef.current)clearInterval(intervalRef.current);
    intervalRef.current=setInterval(()=\u003edoFetch(citySearch),10*60*1000);
    return()=\u003eclearInterval(intervalRef.current);
  },[citySearch]);

  const handleSearch=()=\u003e{const c=cityInput.trim();if(!c)return;setCitySearch(c);doFetch(c,radius);};

  const stationsWithDist=useMemo(()=\u003e{
    if(!userLat||!userLng) return stations;
    return [...stations].map(s=\u003e({...s,_dist:(s.lat\u0026\u0026s.lng)?haversineKm(userLat,userLng,s.lat,s.lng):null})).sort((a,b)=\u003e(a._dist??9999)-(b._dist??9999));
  },[stations,userLat,userLng]);

  const bestStation=useMemo(()=\u003e{
    const res={};
    Object.keys(FUEL_META).forEach(k=\u003e{const sorted=stationsWithDist.filter(s=\u003es[k]!=null).sort((a,b)=\u003ea[k]-b[k]);res[k]=sorted[0]||null;});
    return res;
  },[stationsWithDist]);

  const avgPrices=useMemo(()=\u003e{
    const res={};
    Object.keys(FUEL_META).forEach(k=\u003e{const vals=stationsWithDist.map(s=\u003es[k]).filter(v=\u003ev!=null);res[k]=vals.length?vals.reduce((a,b)=\u003ea+b,0)/vals.length:null;});
    return res;
  },[stationsWithDist]);

  const chartData=useMemo(()=\u003e{const byTs={};history.forEach(e=\u003e{if(!byTs[e.ts])byTs[e.ts]={ts:e.ts,tsFmt:e.tsFmt};if(e[chartFuel]!=null)byTs[e.ts][e.stationNom]=e[chartFuel];});return Object.values(byTs).sort((a,b)=\u003ea.ts.localeCompare(b.ts)).slice(-60);},[history,chartFuel]);
  const chartLines=useMemo(()=\u003e{const names=new Set();chartData.forEach(d=\u003eObject.keys(d).filter(k=\u003ek!=="ts"\u0026\u0026k!=="tsFmt").forEach(k=\u003enames.add(k)));const COLORS=["#60a5fa","#f472b6","#4ade80","#fbbf24","#a78bfa","#f87171"];return[...names].map((n,i)=\u003e({key:n,color:COLORS[i%COLORS.length]}));},[chartData]);

  const fmtUpd=d=\u003ed?d.toLocaleDateString("fr-FR",{day:"2-digit",month:"short"})+" à "+d.toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"}):null;
  const mm=String(Math.floor(countdown/60)).padStart(2,"0"),ss2=String(countdown%60).padStart(2,"0");

  const FuelTooltip=({active,payload,label})=\u003e{
    if(!active||!payload?.length)return null;
    return\u003cdiv style={{background:"var(--card,#1a1635)",border:"1px solid var(--border)",borderRadius:10,padding:"10px 14px",fontSize:12}}\u003e
      \u003cdiv style={{fontWeight:800,marginBottom:6,color:"var(--text2)"}}\u003e{label}\u003c/div\u003e
      {payload.map(p=\u003e\u003cdiv key={p.dataKey} style={{color:p.color,fontWeight:700,marginBottom:3}}\u003e{p.name}: {p.value?.toFixed(3)} €/L\u003c/div\u003e)}
    \u003c/div\u003e;
  };

  return (
    \u003cdiv className="fade-up" style={{maxWidth:1140,margin:"0 auto"}}\u003e

      {/* ── Header ── */}
      \u003cdiv className="card" style={{marginBottom:18,background:"linear-gradient(135deg,rgba(251,191,36,0.06),rgba(167,139,250,0.04))",borderColor:"rgba(251,191,36,0.2)"}}\u003e
        \u003cdiv style={{display:"flex",alignItems:"center",gap:12,marginBottom:14,flexWrap:"wrap"}}\u003e
          \u003cdiv style={{width:48,height:48,borderRadius:15,background:"linear-gradient(135deg,#f59e0b,#fbbf24)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:24,boxShadow:"0 6px 20px rgba(251,191,36,0.4)",flexShrink:0}}\u003e⛽\u003c/div\u003e
          \u003cdiv style={{flex:1,minWidth:0}}\u003e
            \u003cdiv style={{fontWeight:900,fontSize:17,marginBottom:2}}\u003ePrix des carburants\u003c/div\u003e
            \u003cdiv style={{fontSize:11,color:"var(--text3)",display:"flex",alignItems:"center",gap:7,flexWrap:"wrap"}}\u003e
              {loading?\u003c\u003e\u003cspan style={{color:"var(--yellow)",animation:"spin .7s linear infinite",display:"inline-block"}}\u003e⟳\u003c/span\u003e Actualisation…\u003c/\u003e
                :error?\u003cspan style={{color:"var(--red)"}}\u003e⚠️ Erreur\u003c/span\u003e
                :stationsWithDist.length\u003e0?\u003c\u003e\u003cspan style={{color:"var(--green)"}}\u003e●\u003c/span\u003e {stationsWithDist.length} station{stationsWithDist.length\u003e1?"s":""} · {fmtUpd(lastUpdate)}\u003c/\u003e
                :"En attente…"}
              {!loading\u0026\u0026\u003cspan\u003e· Actu dans \u003cstrong style={{color:"var(--yellow)"}}\u003e{mm}:{ss2}\u003c/strong\u003e\u003c/span\u003e}
              {userLat\u0026\u0026\u003cspan style={{color:"var(--purple)",fontWeight:700}}\u003e· 📍 GPS actif\u003c/span\u003e}
            \u003c/div\u003e
          \u003c/div\u003e
          \u003cdiv style={{display:"flex",gap:5,flexShrink:0,flexWrap:"wrap"}}\u003e
            {[["prices","💰 Prix"],["map","🗺️ Carte"],["chart","📈 Courbes"]].map(([id,lb])=\u003e(
              \u003cbutton key={id} onClick={()=\u003esetActiveTab(id)}
                style={{padding:"8px 14px",borderRadius:10,border:activeTab===id?"1px solid rgba(167,139,250,0.5)":"1px solid var(--border)",background:activeTab===id?"rgba(167,139,250,0.18)":"var(--glass)",color:activeTab===id?"var(--purple)":"var(--text2)",cursor:"pointer",fontFamily:"'Outfit',sans-serif",fontWeight:700,fontSize:12}}\u003e
                {lb}
              \u003c/button\u003e
            ))}
            \u003cbutton onClick={()=\u003edoFetch(citySearch,radius)} disabled={loading}
              style={{padding:"8px 12px",borderRadius:10,border:"1px solid var(--border)",background:"var(--glass)",color:"var(--text2)",cursor:"pointer",fontSize:14}}\u003e
              {loading?"⟳":"🔄"}
            \u003c/button\u003e
          \u003c/div\u003e
        \u003c/div\u003e
        \u003cdiv style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}\u003e
          \u003cdiv style={{flex:1,minWidth:180,position:"relative"}}\u003e
            \u003cspan style={{position:"absolute",left:11,top:"50%",transform:"translateY(-50%)",fontSize:14,pointerEvents:"none"}}\u003e🔍\u003c/span\u003e
            \u003cinput value={cityInput} onChange={e=\u003esetCityInput(e.target.value)} onKeyDown={e=\u003ee.key==="Enter"\u0026\u0026handleSearch()}
              placeholder="Code postal (52100) ou ville…"
              style={{paddingLeft:34,fontSize:13,borderRadius:11,background:"rgba(255,255,255,0.06)",border:"1px solid var(--border)"}}/\u003e
          \u003c/div\u003e
          \u003cdiv style={{display:"flex",alignItems:"center",gap:6,background:"rgba(255,255,255,0.04)",border:"1px solid var(--border)",borderRadius:11,padding:"0 10px",flexShrink:0,height:42}}\u003e
            \u003cspan style={{fontSize:12,color:"var(--text3)",fontWeight:700,whiteSpace:"nowrap"}}\u003e📍 Rayon\u003c/span\u003e
            \u003cselect value={radius} onChange={e=\u003esetRadius(+e.target.value)}
              style={{background:"transparent",border:"none",color:"var(--yellow)",fontFamily:"'Outfit',sans-serif",fontWeight:800,fontSize:13,cursor:"pointer",padding:"0 4px",outline:"none"}}\u003e
              {[2,5,10,20,30,50].map(v=\u003e\u003coption key={v} value={v}\u003e{v} km\u003c/option\u003e)}
            \u003c/select\u003e
          \u003c/div\u003e
          \u003cbutton className="btn btn-primary" onClick={handleSearch} disabled={loading||!cityInput.trim()}
            style={{padding:"11px 20px",fontSize:13,whiteSpace:"nowrap",flexShrink:0}}\u003eChercher\u003c/button\u003e
          \u003cbutton onClick={locateUser} disabled={locating}
            style={{padding:"11px 16px",borderRadius:11,flexShrink:0,cursor:"pointer",
              border:userLat?"1px solid rgba(248,113,113,0.4)":"1px solid rgba(167,139,250,0.35)",
              background:userLat?"rgba(248,113,113,0.12)":"rgba(255,255,255,0.05)",
              color:userLat?"var(--red)":"var(--text2)",
              fontFamily:"'Outfit',sans-serif",fontWeight:700,fontSize:13,
              display:"flex",alignItems:"center",gap:7,transition:"all .2s",whiteSpace:"nowrap"}}\u003e
            {locating?\u003c\u003e\u003cspan style={{animation:"spin .7s linear infinite",display:"inline-block"}}\u003e⟳\u003c/span\u003e Localisation…\u003c/\u003e
              :userLat?\u003c\u003e📍 Désactiver GPS\u003c/\u003e
              :\u003c\u003e📍 Me localiser\u003c/\u003e}
          \u003c/button\u003e
        \u003c/div\u003e
      \u003c/div\u003e

      {error\u0026\u0026(
        \u003cdiv style={{background:"rgba(248,113,113,0.07)",border:"1px solid rgba(248,113,113,0.22)",borderRadius:14,padding:"14px 18px",marginBottom:16}}\u003e
          \u003cdiv style={{fontWeight:800,color:"var(--red)",marginBottom:4}}\u003e⚠️ {error}\u003c/div\u003e
          \u003cdiv style={{fontSize:11,color:"var(--text3)"}}\u003eEssayez un code postal ou vérifiez votre connexion.\u003c/div\u003e
        \u003c/div\u003e
      )}

      {/* ══ TAB PRIX ══ */}
      {activeTab==="prices"\u0026\u0026stationsWithDist.length\u003e0\u0026\u0026(
        \u003cdiv\u003e

          {/* ── 4 cartes meilleurs prix – redesign ── */}
          \u003cdiv style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:14,marginBottom:22}} className="fuel-best-grid"\u003e
            {Object.entries(FUEL_META).map(([k,meta])=\u003e{
              const best=bestStation[k];
              if(!best) return null;
              const brand=detectBrand(best.nom,best.enseignes,best.adresse);
              const dist=best._dist!=null?fmtKm(best._dist):null;
              return (
                \u003cdiv key={k}
                  onClick={()=\u003ebest.lat\u0026\u0026setNavStation(best)}
                  style={{
                    background:`linear-gradient(160deg,${meta.color}18,${meta.color}06)`,
                    border:`1.5px solid ${meta.color}35`,borderRadius:20,
                    overflow:"hidden",cursor:best.lat?"pointer":"default",
                    transition:"transform .18s,box-shadow .18s",position:"relative",
                  }}
                  onMouseEnter={e=\u003e{if(best.lat){e.currentTarget.style.transform="translateY(-3px)";e.currentTarget.style.boxShadow=`0 14px 36px ${meta.color}30`;}}}
                  onMouseLeave={e=\u003e{e.currentTarget.style.transform="";e.currentTarget.style.boxShadow="";}}\u003e

                  {/* Bandeau coloré */}
                  \u003cdiv style={{padding:"11px 14px 10px",background:`linear-gradient(135deg,${meta.color}28,${meta.color}10)`,borderBottom:`1px solid ${meta.color}25`,display:"flex",alignItems:"center",justifyContent:"space-between"}}\u003e
                    \u003cdiv style={{display:"flex",alignItems:"center",gap:8}}\u003e
                      \u003cdiv style={{width:28,height:28,borderRadius:8,background:`${meta.color}22`,border:`1.5px solid ${meta.color}45`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14}}\u003e{meta.icon}\u003c/div\u003e
                      \u003cspan style={{fontWeight:900,fontSize:13,color:meta.color,letterSpacing:.5,textTransform:"uppercase"}}\u003e{meta.label}\u003c/span\u003e
                    \u003c/div\u003e
                    {/* Bouton navigation haut droite */}
                    \u003cbutton
                      onClick={e=\u003e{e.stopPropagation();best.lat\u0026\u0026setNavStation(best);}}
                      style={{width:30,height:30,borderRadius:8,border:`1px solid ${meta.color}35`,
                        background:`${meta.color}15`,color:meta.color,cursor:"pointer",fontSize:14,
                        display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,
                        transition:"all .15s"}}
                      title="Démarrer l'itinéraire"
                      onMouseEnter={e=\u003e{e.currentTarget.style.background=`${meta.color}30`;}}
                      onMouseLeave={e=\u003e{e.currentTarget.style.background=`${meta.color}15`;}}\u003e
                      🗺️
                    \u003c/button\u003e
                  \u003c/div\u003e

                  {/* Corps */}
                  \u003cdiv style={{padding:"14px 16px 16px"}}\u003e
                    {/* Prix */}
                    \u003cdiv style={{display:"flex",alignItems:"baseline",gap:4,marginBottom:14}}\u003e
                      \u003cspan style={{fontFamily:"'Fraunces',serif",fontWeight:900,fontSize:38,color:"var(--text)",letterSpacing:-2,lineHeight:1}}\u003e{best[k].toFixed(3)}\u003c/span\u003e
                      \u003cspan style={{fontSize:12,color:"var(--text3)",fontWeight:500}}\u003e€/L\u003c/span\u003e
                    \u003c/div\u003e

                    {/* Station */}
                    \u003cdiv style={{display:"flex",alignItems:"flex-start",gap:10,paddingTop:10,borderTop:`1px solid ${meta.color}18`}}\u003e
                      \u003cBrandIcon nom={best.nom} enseignes={best.enseignes} adresse={best.adresse} size={36}/\u003e
                      \u003cdiv style={{flex:1,minWidth:0}}\u003e
                        \u003cdiv style={{fontWeight:900,fontSize:11,color:"#fff",textTransform:"uppercase",letterSpacing:.4,lineHeight:1.3,marginBottom:3,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}\u003e
                          {(best.nom||"Station").toUpperCase()}
                        \u003c/div\u003e
                        {!best.nomIsAdresse\u0026\u0026(
                          \u003cdiv style={{fontSize:10,color:"var(--text3)",lineHeight:1.4,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}\u003e
                            {best.adresse}
                          \u003c/div\u003e
                        )}
                        {best.ville\u0026\u0026(
                          \u003cdiv style={{fontSize:10,color:"var(--text3)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}\u003e{best.ville}\u003c/div\u003e
                        )}
                        {/* Distance */}
                        {dist\u0026\u0026(
                          \u003cdiv style={{marginTop:5,display:"inline-flex",alignItems:"center",gap:4,
                            background:"rgba(167,139,250,0.14)",border:"1px solid rgba(167,139,250,0.3)",
                            borderRadius:20,padding:"2px 9px",fontSize:10,fontWeight:800,color:"var(--purple)"}}\u003e
                            📍 {dist}
                          \u003c/div\u003e
                        )}
                      \u003c/div\u003e
                    \u003c/div\u003e
                  \u003c/div\u003e
                \u003c/div\u003e
              );
            })}
          \u003c/div\u003e

          {/* ── Tableau stations – redesign pro ── */}
          \u003cdiv style={{borderRadius:20,overflow:"hidden",border:"1px solid var(--border)",
            boxShadow:"0 4px 24px rgba(0,0,0,0.35)",marginBottom:14}}\u003e

            {/* Header tableau */}
            \u003cdiv style={{padding:"16px 22px",background:"linear-gradient(135deg,rgba(251,191,36,0.08),rgba(167,139,250,0.04))",borderBottom:"1px solid var(--border)",display:"flex",alignItems:"center",gap:12}}\u003e
              \u003cdiv style={{width:36,height:36,borderRadius:11,background:"rgba(251,191,36,0.16)",border:"1px solid rgba(251,191,36,0.3)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18}}\u003e📍\u003c/div\u003e
              \u003cdiv\u003e
                \u003cdiv style={{fontWeight:900,fontSize:16}}\u003eStations à \u003cspan style={{color:"var(--yellow)"}}\u003e{stationsWithDist[0]?.ville||citySearch}\u003c/span\u003e\u003c/div\u003e
                \u003cdiv style={{fontSize:10,color:"var(--text3)",marginTop:1}}\u003ePrix en €/L · Données gouvernementales · Temps réel\u003c/div\u003e
              \u003c/div\u003e
              \u003cdiv style={{marginLeft:"auto",background:"rgba(251,191,36,0.14)",border:"1px solid rgba(251,191,36,0.3)",borderRadius:20,padding:"5px 14px",fontSize:12,color:"var(--yellow)",fontWeight:800,flexShrink:0}}\u003e
                {stationsWithDist.length} station{stationsWithDist.length\u003e1?"s":""}
              \u003c/div\u003e
            \u003c/div\u003e

            {/* Colonnes header */}
            \u003cdiv style={{display:"grid",gridTemplateColumns:"minmax(220px,2fr) repeat(4,1fr) 50px",background:"rgba(0,0,0,0.3)",borderBottom:"1px solid rgba(255,255,255,0.06)"}}\u003e
              \u003cdiv style={{padding:"10px 22px",fontSize:10,fontWeight:900,color:"var(--text3)",textTransform:"uppercase",letterSpacing:1.5}}\u003e
                Station / Adresse
              \u003c/div\u003e
              {Object.entries(FUEL_META).map(([k,m])=\u003e(
                \u003cdiv key={k} style={{padding:"8px 0",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:3}}\u003e
                  \u003cdiv style={{width:32,height:32,borderRadius:10,background:`${m.color}18`,border:`1.5px solid ${m.color}35`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16}}\u003e{m.icon}\u003c/div\u003e
                  \u003cspan style={{fontSize:10,color:m.color,fontWeight:900,letterSpacing:.5}}\u003e{m.label}\u003c/span\u003e
                \u003c/div\u003e
              ))}
              \u003cdiv style={{padding:"10px 8px",fontSize:10,fontWeight:900,color:"var(--text3)",textTransform:"uppercase",letterSpacing:1,textAlign:"center"}}\u003eNav\u003c/div\u003e
            \u003c/div\u003e

            {/* Lignes */}
            {stationsWithDist.map((s,i)=\u003e{
              const isEven=i%2===0;
              const rowBg=isEven?"rgba(255,255,255,0.012)":"transparent";
              const nomDisplay=(s.nom||"Station").toUpperCase();
              return (
                \u003cdiv key={s.id||i}
                  style={{display:"grid",gridTemplateColumns:"minmax(220px,2fr) repeat(4,1fr) 50px",borderTop:"1px solid rgba(255,255,255,0.04)",background:rowBg,transition:"background .12s",cursor:"pointer"}}
                  onMouseEnter={e=\u003ee.currentTarget.style.background="rgba(167,139,250,0.06)"}
                  onMouseLeave={e=\u003ee.currentTarget.style.background=rowBg}
                  onClick={()=\u003es.lat\u0026\u0026setNavStation(s)}\u003e

                  {/* Colonne station */}
                  \u003cdiv style={{padding:"13px 22px",display:"flex",alignItems:"center",gap:12,position:"relative"}}\u003e
                    \u003cBrandIcon nom={s.nom} enseignes={s.enseignes} adresse={s.adresse} size={42}/\u003e
                    \u003cdiv style={{flex:1,minWidth:0}}\u003e
                      \u003cdiv style={{fontWeight:900,fontSize:12,color:"#fff",letterSpacing:.5,marginBottom:2,textTransform:"uppercase",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}\u003e
                        {nomDisplay}
                      \u003c/div\u003e
                      {!s.nomIsAdresse\u0026\u0026s.adresse\u0026\u0026(
                        \u003cdiv style={{fontSize:10,color:"var(--text3)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}\u003e
                          {s.adresse}{s.ville?` — ${s.ville}`:""}
                        \u003c/div\u003e
                      )}
                      {(s.nomIsAdresse||!s.adresse)\u0026\u0026s.ville\u0026\u0026(
                        \u003cdiv style={{fontSize:10,color:"var(--text3)"}}\u003e{s.ville}\u003c/div\u003e
                      )}
                      \u003cdiv style={{display:"flex",alignItems:"center",gap:6,marginTop:3,flexWrap:"wrap"}}\u003e
                        {s.cp\u0026\u0026\u003cspan style={{fontSize:9,color:"var(--text3)",background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:6,padding:"1px 6px",fontWeight:700}}\u003e📮 {s.cp}\u003c/span\u003e}
                        {s._dist!=null\u0026\u0026\u003cspan style={{fontSize:9,fontWeight:800,color:"var(--purple)",background:"rgba(167,139,250,0.12)",border:"1px solid rgba(167,139,250,0.25)",borderRadius:20,padding:"1px 7px"}}\u003e📍 {fmtKm(s._dist)}\u003c/span\u003e}
                      \u003c/div\u003e
                    \u003c/div\u003e
                  \u003c/div\u003e

                  {/* Colonnes prix */}
                  {Object.entries(FUEL_META).map(([k,m])=\u003e{
                    const isBest=s[k]!=null\u0026\u0026s[k]===bestStation[k]?.[k]\u0026\u0026stationsWithDist.filter(x=\u003ex[k]!=null).length\u003e1;
                    return (
                      \u003cdiv key={k} style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"13px 8px",gap:3}}\u003e
                        {s[k]!=null?(
                          \u003c\u003e
                            \u003cdiv style={{fontFamily:"'Fraunces',serif",fontWeight:900,fontSize:17,
                              color:isBest?m.color:"var(--text)",
                              textShadow:isBest?`0 0 16px ${m.color}60`:"none",letterSpacing:-.5}}\u003e
                              {s[k].toFixed(3)}
                            \u003c/div\u003e
                            {isBest\u0026\u0026(
                              \u003cspan style={{fontSize:9,fontWeight:900,color:m.color,background:`${m.color}16`,
                                border:`1px solid ${m.color}35`,borderRadius:6,padding:"1px 6px",whiteSpace:"nowrap"}}\u003e
                                ✓ Moins cher
                              \u003c/span\u003e
                            )}
                          \u003c/\u003e
                        ):(
                          \u003cspan style={{color:"rgba(255,255,255,0.1)",fontSize:18}}\u003e—\u003c/span\u003e
                        )}
                      \u003c/div\u003e
                    );
                  })}

                  {/* Bouton navigation */}
                  \u003cdiv style={{display:"flex",alignItems:"center",justifyContent:"center",padding:"0 6px"}}
                    onClick={e=\u003e{e.stopPropagation();s.lat\u0026\u0026setNavStation(s);}}\u003e
                    {s.lat\u0026\u0026(
                      \u003cdiv style={{width:32,height:32,borderRadius:9,background:"rgba(167,139,250,0.1)",
                        border:"1px solid rgba(167,139,250,0.2)",display:"flex",alignItems:"center",
                        justifyContent:"center",fontSize:14,cursor:"pointer",transition:"all .15s"}}
                        onMouseEnter={e=\u003e{e.currentTarget.style.background="rgba(167,139,250,0.22)";e.currentTarget.style.borderColor="rgba(167,139,250,0.4)";}}
                        onMouseLeave={e=\u003e{e.currentTarget.style.background="rgba(167,139,250,0.1)";e.currentTarget.style.borderColor="rgba(167,139,250,0.2)";}}\u003e
                        🗺️
                      \u003c/div\u003e
                    )}
                  \u003c/div\u003e
                \u003c/div\u003e
              );
            })}
          \u003c/div\u003e

          \u003cFuelSimulator stations={stationsWithDist} avgPrices={avgPrices} FUEL_META={FUEL_META} citySearch={citySearch}/\u003e
        \u003c/div\u003e
      )}

      {activeTab==="prices"\u0026\u0026!loading\u0026\u0026stationsWithDist.length===0\u0026\u0026!error\u0026\u0026(
        \u003cdiv style={{textAlign:"center",padding:"60px 20px",color:"var(--text3)"}}\u003e
          \u003cdiv style={{fontSize:52,marginBottom:12}}\u003e⛽\u003c/div\u003e
          \u003cdiv style={{fontWeight:700,fontSize:15}}\u003eRecherchez une ville pour afficher les prix\u003c/div\u003e
        \u003c/div\u003e
      )}

      {/* ══ TAB CARTE ══ */}
      {activeTab==="map"\u0026\u0026(
        \u003cdiv\u003e
          {!userLat\u0026\u0026(
            \u003cdiv style={{background:"rgba(167,139,250,0.07)",border:"1px solid rgba(167,139,250,0.2)",borderRadius:14,padding:"14px 18px",marginBottom:14,display:"flex",alignItems:"center",gap:12}}\u003e
              \u003cspan style={{fontSize:22}}\u003e📍\u003c/span\u003e
              \u003cdiv style={{flex:1}}\u003e
                \u003cdiv style={{fontWeight:700,fontSize:13,marginBottom:2}}\u003eActivez la géolocalisation\u003c/div\u003e
                \u003cdiv style={{fontSize:11,color:"var(--text3)"}}\u003ePour voir les distances et trier par proximité\u003c/div\u003e
              \u003c/div\u003e
              \u003cbutton onClick={locateUser} disabled={locating}
                style={{padding:"9px 16px",borderRadius:10,border:"1px solid rgba(167,139,250,0.4)",background:"rgba(167,139,250,0.15)",color:"var(--purple)",cursor:"pointer",fontFamily:"'Outfit',sans-serif",fontWeight:700,fontSize:13,whiteSpace:"nowrap"}}\u003e
                {locating?"⟳ …":"📍 Me localiser"}
              \u003c/button\u003e
            \u003c/div\u003e
          )}
          {loading?(
            \u003cdiv className="card" style={{textAlign:"center",padding:60}}\u003e
              \u003cdiv style={{fontSize:34,animation:"spin .8s linear infinite",display:"inline-block",marginBottom:14}}\u003e⟳\u003c/div\u003e
            \u003c/div\u003e
          ):stationsWithDist.length\u003e0?(
            \u003cFuelMapLeaflet stations={stationsWithDist} userLat={userLat} userLng={userLng}/\u003e
          ):(
            \u003cdiv className="card" style={{textAlign:"center",padding:60}}\u003e
              \u003cdiv style={{fontSize:44,marginBottom:12}}\u003e🗺️\u003c/div\u003e
              \u003cdiv style={{color:"var(--text3)",fontWeight:700}}\u003eLancez une recherche pour afficher la carte\u003c/div\u003e
            \u003c/div\u003e
          )}
        \u003c/div\u003e
      )}

      {/* ══ TAB COURBES ══ */}
      {activeTab==="chart"\u0026\u0026(
        \u003cdiv\u003e
          \u003cdiv style={{display:"flex",gap:8,marginBottom:16,flexWrap:"wrap"}}\u003e
            {Object.entries(FUEL_META).map(([k,m])=\u003e(
              \u003cbutton key={k} onClick={()=\u003esetChartFuel(k)}
                style={{padding:"6px 12px",borderRadius:9,border:chartFuel===k?`1px solid ${m.color}`:"1px solid var(--border)",background:chartFuel===k?`${m.color}18`:"var(--glass)",color:chartFuel===k?m.color:"var(--text3)",cursor:"pointer",fontFamily:"'Outfit',sans-serif",fontWeight:700,fontSize:12}}\u003e
                {m.icon} {m.label}
              \u003c/button\u003e
            ))}
          \u003c/div\u003e
          \u003cdiv className="card" style={{marginBottom:14}}\u003e
            \u003cdiv style={{fontWeight:800,fontSize:14,marginBottom:4}}\u003e📈 {FUEL_META[chartFuel]?.icon} {FUEL_META[chartFuel]?.label} · {citySearch}\u003c/div\u003e
            \u003cdiv style={{fontSize:11,color:"var(--text3)",marginBottom:16}}\u003eActualisation toutes les 10 min · {chartData.length} points\u003c/div\u003e
            {chartData.length\u003e=2?(
              \u003cResponsiveContainer width="100%" height={300}\u003e
                \u003cLineChart data={chartData} margin={{top:5,right:20,left:0,bottom:5}}\u003e
                  \u003cCartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)"/\u003e
                  \u003cXAxis dataKey="tsFmt" tick={{fill:"var(--text3)",fontSize:10}} tickLine={false} axisLine={{stroke:"var(--border)"}}/\u003e
                  \u003cYAxis domain={["auto","auto"]} tick={{fill:"var(--text3)",fontSize:10}} tickLine={false} axisLine={false} tickFormatter={v=\u003ev?.toFixed(3)+"€"}/\u003e
                  \u003cTooltip content={\u003cFuelTooltip/\u003e}/\u003e
                  \u003cLegend wrapperStyle={{fontSize:11,paddingTop:10}}/\u003e
                  {chartLines.map(l=\u003e(\u003cLine key={l.key} type="monotone" dataKey={l.key} stroke={l.color} strokeWidth={2.5} dot={{r:3,fill:l.color,strokeWidth:0}} activeDot={{r:5,strokeWidth:0}} name={l.key}/\u003e))}
                \u003c/LineChart\u003e
              \u003c/ResponsiveContainer\u003e
            ):(
              \u003cdiv style={{textAlign:"center",padding:"40px 20px",color:"var(--text3)"}}\u003e
                \u003cdiv style={{fontSize:44,marginBottom:10}}\u003e📊\u003c/div\u003e
                \u003cdiv style={{fontWeight:700,marginBottom:16}}\u003eHistorique en cours de constitution\u003c/div\u003e
                \u003cbutton className="btn btn-primary" onClick={()=\u003edoFetch(citySearch)} disabled={loading}\u003e🔄 Actualiser\u003c/button\u003e
              \u003c/div\u003e
            )}
          \u003c/div\u003e
          {stationsWithDist.length\u003e0\u0026\u0026avgPrices[chartFuel]!=null\u0026\u0026(
            \u003cdiv className="card"\u003e
              \u003cdiv style={{fontWeight:800,fontSize:14,marginBottom:14}}\u003e📊 Comparatif — {FUEL_META[chartFuel]?.label}\u003c/div\u003e
              \u003cResponsiveContainer width="100%" height={200}\u003e
                \u003cBarChart data={stationsWithDist.filter(s=\u003es[chartFuel]!=null).map(s=\u003e({nom:(s.nom||"Station").slice(0,14),prix:s[chartFuel]}))} margin={{top:0,right:16,left:0,bottom:0}}\u003e
                  \u003cCartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false}/\u003e
                  \u003cXAxis dataKey="nom" tick={{fill:"var(--text3)",fontSize:10}} tickLine={false} axisLine={{stroke:"var(--border)"}}/\u003e
                  \u003cYAxis domain={["auto","auto"]} tick={{fill:"var(--text3)",fontSize:10}} tickLine={false} axisLine={false} tickFormatter={v=\u003ev.toFixed(3)}/\u003e
                  \u003cTooltip formatter={v=\u003e[v?.toFixed(3)+" €/L","Prix"]} contentStyle={{background:"var(--card,#1a1635)",border:"1px solid var(--border)",borderRadius:10,fontSize:12}}/\u003e
                  \u003cBar dataKey="prix" radius={[8,8,0,0]} fill={FUEL_META[chartFuel]?.color||"#a78bfa"} maxBarSize={80}/\u003e
                \u003c/BarChart\u003e
              \u003c/ResponsiveContainer\u003e
            \u003c/div\u003e
          )}
        \u003c/div\u003e
      )}

      \u003cdiv style={{marginTop:16,padding:"10px 14px",fontSize:11,color:"var(--text3)",textAlign:"center"}}\u003e
        Source : \u003cstrong style={{color:"var(--text2)"}}\u003edata.economie.gouv.fr\u003c/strong\u003e — API officielle · Actualisation toutes les 10 min · OpenStreetMap pour les noms
      \u003c/div\u003e

      {navStation\u0026\u0026\u003cNavModal station={navStation} userLat={userLat} userLng={userLng} onClose={()=\u003esetNavStation(null)}/\u003e}
    \u003c/div\u003e
  );
}
function FuelSimulator({ stations, avgPrices, FUEL_META, citySearch }) {
  const VEHICLES = {
    "Renault": {
      "Clio 1.0 TCe 90": { conso:5.4, fuel:"sp95" }, "Clio 1.5 dCi 85": { conso:3.9, fuel:"gazole" },
      "Captur 1.0 TCe 100": { conso:5.9, fuel:"sp95" }, "Captur 1.5 dCi 115": { conso:4.5, fuel:"gazole" },
      "Mégane 1.3 TCe 140": { conso:6.2, fuel:"sp95" }, "Mégane 1.5 dCi 115": { conso:4.2, fuel:"gazole" },
      "Kadjar 1.5 dCi 110": { conso:4.7, fuel:"gazole" }, "Arkana 1.3 TCe 140": { conso:6.4, fuel:"sp95" },
      "Austral 1.2 E-Tech 200": { conso:5.5, fuel:"sp95" },
    },
    "Peugeot": {
      "208 1.2 PureTech 75": { conso:5.3, fuel:"sp95" }, "208 1.5 BlueHDi 100": { conso:3.8, fuel:"gazole" },
      "308 1.2 PureTech 130": { conso:6.3, fuel:"sp95" }, "308 1.5 BlueHDi 130": { conso:4.4, fuel:"gazole" },
      "2008 1.2 PureTech 100": { conso:6.0, fuel:"sp95" }, "2008 1.5 BlueHDi 110": { conso:4.3, fuel:"gazole" },
      "3008 1.5 BlueHDi 130": { conso:4.8, fuel:"gazole" }, "408 1.2 PureTech 130": { conso:6.6, fuel:"sp95" },
    },
    "Citroën": {
      "C3 1.2 PureTech 83": { conso:5.2, fuel:"sp95" }, "C3 1.5 BlueHDi 100": { conso:3.7, fuel:"gazole" },
      "C4 1.2 PureTech 130": { conso:6.2, fuel:"sp95" }, "C4 1.5 BlueHDi 130": { conso:4.3, fuel:"gazole" },
      "C5 Aircross 1.5 BlueHDi 130": { conso:4.7, fuel:"gazole" }, "Berlingo 1.5 BlueHDi 130": { conso:5.1, fuel:"gazole" },
    },
    "Volkswagen": {
      "Polo 1.0 TSI 95": { conso:5.3, fuel:"sp95" }, "Golf 1.5 TSI 130": { conso:6.4, fuel:"sp95" },
      "Golf 2.0 TDI 115": { conso:4.5, fuel:"gazole" }, "Tiguan 2.0 TDI 150": { conso:5.6, fuel:"gazole" },
      "T-Roc 1.5 TSI 150": { conso:7.0, fuel:"sp95" }, "Passat 2.0 TDI 150": { conso:4.8, fuel:"gazole" },
    },
    "Toyota": {
      "Yaris 1.5 Hybrid": { conso:4.1, fuel:"sp95" }, "Yaris Cross 1.5 Hybrid": { conso:5.0, fuel:"sp95" },
      "Corolla 1.8 Hybrid": { conso:4.5, fuel:"sp95" }, "C-HR 2.0 Hybrid": { conso:5.1, fuel:"sp95" },
      "RAV4 2.5 Hybrid": { conso:6.0, fuel:"sp95" },
    },
    "Dacia": {
      "Sandero 1.0 TCe 90": { conso:5.9, fuel:"sp95" }, "Duster 1.5 dCi 115": { conso:5.1, fuel:"gazole" },
      "Jogger 1.0 TCe 110": { conso:6.5, fuel:"sp95" }, "Duster 1.3 TCe 130": { conso:7.0, fuel:"sp95" },
    },
    "Ford": {
      "Puma 1.0 EcoBoost 125": { conso:6.2, fuel:"sp95" }, "Focus 1.5 EcoBoost 182": { conso:6.7, fuel:"sp95" },
      "Focus 1.5 EcoBlue 120": { conso:4.7, fuel:"gazole" }, "Kuga 1.5 EcoBlue 120": { conso:5.4, fuel:"gazole" },
    },
    "BMW": {
      "Série 1 116d": { conso:4.8, fuel:"gazole" }, "Série 1 118i": { conso:6.9, fuel:"sp95" },
      "Série 3 320d": { conso:5.2, fuel:"gazole" }, "Série 3 330i": { conso:7.8, fuel:"sp95" },
      "X1 xDrive20d": { conso:5.5, fuel:"gazole" }, "X3 xDrive20d": { conso:6.1, fuel:"gazole" },
    },
    "Mercedes": {
      "Classe A 180d": { conso:4.4, fuel:"gazole" }, "Classe A 200": { conso:7.2, fuel:"sp95" },
      "Classe C 220d": { conso:5.0, fuel:"gazole" }, "GLA 200d": { conso:5.3, fuel:"gazole" },
      "GLC 220d": { conso:6.2, fuel:"gazole" },
    },
    "Autre": {
      "Citadine essence (≈5.5L)": { conso:5.5, fuel:"sp95" }, "Berline essence (≈7L)": { conso:7.0, fuel:"sp95" },
      "SUV essence (≈8L)": { conso:8.0, fuel:"sp95" }, "Citadine diesel (≈4L)": { conso:4.0, fuel:"gazole" },
      "SUV diesel (≈6L)": { conso:6.0, fuel:"gazole" }, "Hybride (≈4.5L)": { conso:4.5, fuel:"sp95" },
    },
  };

  const availableFuels = Object.keys(FUEL_META).filter(k =\u003e avgPrices[k] != null || stations.some(s =\u003e s[k] != null));
  const [fuel, setFuel]           = useState(availableFuels[0] || "gazole");
  const [liters, setLiters]       = useState(50);
  const [stationId, setStationId] = useState("__avg__");
  const [selMake, setSelMake]     = useState("");
  const [selModel, setSelModel]   = useState("");
  const [manualConso, setManualConso] = useState(7);

  const vehicleData    = selMake \u0026\u0026 selModel ? VEHICLES[selMake]?.[selModel] : null;
  const vehicleConso   = vehicleData?.conso ?? null;
  const effectiveConso = vehicleConso ?? manualConso;

  const eligibleStations = stations.filter(s =\u003e s[fuel] != null);
  const selectedStation  = stationId === "__avg__" ? null : eligibleStations.find(s =\u003e s.id === stationId);
  const price  = selectedStation ? selectedStation[fuel] : avgPrices[fuel];
  const bestS  = eligibleStations.length \u003e 0 ? eligibleStations.reduce((a,b) =\u003e a[fuel]\u003cb[fuel]?a:b) : null;
  const total  = price != null ? price * liters : null;
  const per100 = price != null ? price * effectiveConso : null;
  const saving = bestS \u0026\u0026 selectedStation \u0026\u0026 bestS.id !== selectedStation.id
    ? (selectedStation[fuel] - bestS[fuel]) * liters : null;
  const m = FUEL_META[fuel] || {};

  return (
    \u003cdiv style={{ borderRadius:18,overflow:"hidden",border:`1px solid ${m.color||"var(--border)"}25`,marginBottom:14,background:"rgba(255,255,255,0.018)" }}\u003e
      \u003cdiv style={{ padding:"13px 18px",background:`linear-gradient(135deg,${m.color||"#a78bfa"}0d,transparent)`,borderBottom:`1px solid ${m.color||"var(--border)"}15`,display:"flex",alignItems:"center",gap:10 }}\u003e
        \u003cdiv style={{ width:36,height:36,borderRadius:11,background:`${m.color||"#a78bfa"}16`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18 }}\u003e🧮\u003c/div\u003e
        \u003cdiv\u003e
          \u003cdiv style={{ fontWeight:900,fontSize:14 }}\u003eSimulateur de plein\u003c/div\u003e
          \u003cdiv style={{ fontSize:10,color:"var(--text3)",marginTop:1 }}\u003e
            {citySearch} · {vehicleConso ? `${selMake} · ${vehicleConso}L/100` : `${effectiveConso}L/100 (manuel)`}
          \u003c/div\u003e
        \u003c/div\u003e
      \u003c/div\u003e

      \u003cdiv className="fuel-sim-grid" style={{ padding:"16px 18px",display:"grid",gridTemplateColumns:"1fr 1fr",gap:16 }}\u003e
        \u003cdiv style={{ display:"flex",flexDirection:"column",gap:13 }}\u003e

          \u003cdiv\u003e
            \u003clabel style={{ fontSize:10,color:"var(--text3)",textTransform:"uppercase",letterSpacing:1,fontWeight:800,display:"block",marginBottom:6 }}\u003eCarburant\u003c/label\u003e
            \u003cdiv style={{ display:"flex",gap:5,flexWrap:"wrap" }}\u003e
              {availableFuels.map(k=\u003e{ const fm=FUEL_META[k]; const s=fuel===k;
                return \u003cbutton key={k} onClick={()=\u003e{setFuel(k);setStationId("__avg__");}}
                  style={{ padding:"5px 10px",borderRadius:9,border:s?`1.5px solid ${fm.color}`:"1px solid var(--border)",background:s?`${fm.color}16`:"var(--glass)",color:s?fm.color:"var(--text3)",cursor:"pointer",fontFamily:"'Outfit',sans-serif",fontWeight:s?800:600,fontSize:11,transition:"all .15s" }}\u003e
                  {fm.icon} {fm.label}
                \u003c/button\u003e;
              })}
            \u003c/div\u003e
          \u003c/div\u003e

          {eligibleStations.length \u003e 0 \u0026\u0026 (
            \u003cdiv\u003e
              \u003clabel style={{ fontSize:10,color:"var(--text3)",textTransform:"uppercase",letterSpacing:1,fontWeight:800,display:"block",marginBottom:6 }}\u003eStation\u003c/label\u003e
              \u003cselect value={stationId} onChange={e=\u003esetStationId(e.target.value)}
                style={{ width:"100%",background:"rgba(255,255,255,0.05)",border:`1px solid ${m.color||"var(--border)"}30`,borderRadius:10,padding:"8px 11px",color:"var(--text)",fontFamily:"'Outfit',sans-serif",fontSize:12,cursor:"pointer" }}\u003e
                \u003coption value="__avg__"\u003e📊 Prix moyen · {eligibleStations.length} stations\u003c/option\u003e
                {eligibleStations.map(s=\u003e\u003coption key={s.id} value={s.id}\u003e{s.nom} — {s[fuel]?.toFixed(3)}€{bestS?.id===s.id?" ⭐":""}\u003c/option\u003e)}
              \u003c/select\u003e
              {bestS \u0026\u0026 \u003cdiv style={{ marginTop:4,fontSize:10,color:"var(--green)",fontWeight:700 }}\u003e⭐ {bestS.nom} · {bestS[fuel]?.toFixed(3)} €/L\u003c/div\u003e}
            \u003c/div\u003e
          )}

          \u003cdiv\u003e
            \u003cdiv style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6 }}\u003e
              \u003clabel style={{ fontSize:10,color:"var(--text3)",textTransform:"uppercase",letterSpacing:1,fontWeight:800 }}\u003eVolume\u003c/label\u003e
              \u003cspan style={{ fontFamily:"'Fraunces',serif",fontWeight:900,fontSize:18,color:m.color||"var(--purple)" }}\u003e{liters} L\u003c/span\u003e
            \u003c/div\u003e
            \u003cinput type="range" min={5} max={120} step={5} value={liters} onChange={e=\u003esetLiters(+e.target.value)}
              style={{ width:"100%",accentColor:m.color||"var(--purple)",cursor:"pointer",marginBottom:6 }}/\u003e
            \u003cdiv style={{ display:"flex",gap:5 }}\u003e
              {[20,35,50,70,100].map(v=\u003e(
                \u003cbutton key={v} onClick={()=\u003esetLiters(v)}
                  style={{ flex:1,padding:"4px 2px",borderRadius:8,border:`1px solid ${liters===v?(m.color||"#a78bfa")+"40":"rgba(255,255,255,0.08)"}`,background:liters===v?`${m.color||"#a78bfa"}18`:"rgba(255,255,255,0.04)",color:liters===v?(m.color||"var(--purple)"):"var(--text3)",cursor:"pointer",fontFamily:"'Outfit',sans-serif",fontWeight:700,fontSize:10 }}\u003e
                  {v}L
                \u003c/button\u003e
              ))}
            \u003c/div\u003e
          \u003c/div\u003e

          \u003cdiv\u003e
            \u003clabel style={{ fontSize:10,color:"var(--text3)",textTransform:"uppercase",letterSpacing:1,fontWeight:800,display:"block",marginBottom:6 }}\u003eMon véhicule\u003c/label\u003e
            \u003cdiv style={{ display:"flex",gap:6,marginBottom:6 }}\u003e
              \u003cselect value={selMake} onChange={e=\u003e{ setSelMake(e.target.value); setSelModel(""); }}
                style={{ flex:1,background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.09)",borderRadius:10,padding:"7px 9px",color:selMake?"var(--text)":"var(--text3)",fontFamily:"'Outfit',sans-serif",fontSize:11,cursor:"pointer" }}\u003e
                \u003coption value=""\u003eMarque…\u003c/option\u003e
                {Object.keys(VEHICLES).map(mk=\u003e\u003coption key={mk} value={mk}\u003e{mk}\u003c/option\u003e)}
              \u003c/select\u003e
              {selMake \u0026\u0026 (
                \u003cselect value={selModel} onChange={e=\u003esetSelModel(e.target.value)}
                  style={{ flex:2,background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.09)",borderRadius:10,padding:"7px 9px",color:selModel?"var(--text)":"var(--text3)",fontFamily:"'Outfit',sans-serif",fontSize:11,cursor:"pointer" }}\u003e
                  \u003coption value=""\u003eModèle…\u003c/option\u003e
                  {Object.keys(VEHICLES[selMake]).map(mo=\u003e\u003coption key={mo} value={mo}\u003e{mo}\u003c/option\u003e)}
                \u003c/select\u003e
              )}
            \u003c/div\u003e
            {vehicleConso ? (
              \u003cdiv style={{ display:"flex",alignItems:"center",gap:7,padding:"6px 10px",background:"rgba(74,222,128,0.07)",border:"1px solid rgba(74,222,128,0.18)",borderRadius:9 }}\u003e
                \u003cspan\u003e🚗\u003c/span\u003e
                \u003cdiv style={{ flex:1 }}\u003e
                  \u003cdiv style={{ fontSize:11,fontWeight:800,color:"var(--green)" }}\u003e{vehicleConso} L/100 km (WLTP)\u003c/div\u003e
                  \u003cdiv style={{ fontSize:9,color:"var(--text3)" }}\u003e{selMake} {selModel}\u003c/div\u003e
                \u003c/div\u003e
                \u003cbutton onClick={()=\u003e{ setSelMake(""); setSelModel(""); }} style={{ background:"none",border:"none",color:"var(--text3)",cursor:"pointer",fontSize:16,lineHeight:1 }}\u003e×\u003c/button\u003e
              \u003c/div\u003e
            ) : (
              \u003cdiv style={{ display:"flex",alignItems:"center",gap:8 }}\u003e
                \u003cspan style={{ fontSize:10,color:"var(--text3)",whiteSpace:"nowrap" }}\u003eOu manuellement :\u003c/span\u003e
                \u003cinput type="number" value={manualConso} onChange={e=\u003esetManualConso(Math.max(1,+e.target.value))} min={1} max={30} step={0.1}
                  style={{ width:68,fontSize:13,fontWeight:700,padding:"5px 9px",borderRadius:9,textAlign:"center",background:"rgba(255,255,255,0.06)",border:"1px solid var(--border)",color:"var(--text)" }}/\u003e
                \u003cspan style={{ fontSize:10,color:"var(--text3)" }}\u003eL / 100 km\u003c/span\u003e
              \u003c/div\u003e
            )}
          \u003c/div\u003e
        \u003c/div\u003e

        \u003cdiv style={{ display:"flex",flexDirection:"column",justifyContent:"center",alignItems:"center",gap:11,padding:"20px 14px",borderRadius:15,background:`linear-gradient(145deg,${m.color||"#a78bfa"}0b,rgba(0,0,0,0.1))`,border:`1px solid ${m.color||"#a78bfa"}1a` }}\u003e
          {price != null ? (\u003c\u003e
            \u003cdiv style={{ fontSize:9,color:"var(--text3)",textTransform:"uppercase",letterSpacing:1.5,fontWeight:800 }}\u003eCoût du plein\u003c/div\u003e
            \u003cdiv style={{ fontFamily:"'Fraunces',serif",fontWeight:900,lineHeight:1,color:m.color||"var(--purple)",textShadow:`0 0 36px ${m.color||"#a78bfa"}45`,textAlign:"center" }}\u003e
              \u003cspan style={{ fontSize:52 }}\u003e{total?.toFixed(2)}\u003c/span\u003e\u003cspan style={{ fontSize:24 }}\u003e€\u003c/span\u003e
            \u003c/div\u003e
            \u003cdiv style={{ fontSize:10,color:"var(--text3)",textAlign:"center",lineHeight:1.7 }}\u003e
              {liters} L · {m.label} · \u003cstrong style={{ color:"var(--text)" }}\u003e{price.toFixed(3)} €/L\u003c/strong\u003e
            \u003c/div\u003e
            \u003cdiv style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:7,width:"100%" }}\u003e
              {[
                { label:"/ 100 km", val:`${per100?.toFixed(2)}€`, sub:`${effectiveConso}L/100` },
                { label:"Prix / L",  val:`${price.toFixed(3)}€`,  sub:"à la pompe" },
              ].map(s=\u003e(
                \u003cdiv key={s.label} style={{ textAlign:"center",padding:"9px 6px",background:"rgba(255,255,255,0.04)",borderRadius:10,border:"1px solid rgba(255,255,255,0.06)" }}\u003e
                  \u003cdiv style={{ fontSize:9,color:"var(--text3)",fontWeight:800,textTransform:"uppercase",letterSpacing:.7,marginBottom:4 }}\u003e{s.label}\u003c/div\u003e
                  \u003cdiv style={{ fontFamily:"'Fraunces',serif",fontWeight:900,fontSize:15,color:"var(--text)" }}\u003e{s.val}\u003c/div\u003e
                  \u003cdiv style={{ fontSize:9,color:"var(--text3)",marginTop:1 }}\u003e{s.sub}\u003c/div\u003e
                \u003c/div\u003e
              ))}
            \u003c/div\u003e
            {saving!=null \u0026\u0026 saving\u003e0.01 \u0026\u0026 (
              \u003cdiv style={{ width:"100%",padding:"7px 11px",background:"rgba(74,222,128,0.07)",border:"1px solid rgba(74,222,128,0.16)",borderRadius:9,fontSize:10,color:"var(--green)",fontWeight:700,textAlign:"center" }}\u003e
                💸 Économisez {saving.toFixed(2)} € chez {bestS?.nom}
              \u003c/div\u003e
            )}
          \u003c/\u003e) : (
            \u003cdiv style={{ textAlign:"center",padding:20 }}\u003e
              \u003cdiv style={{ fontSize:38,marginBottom:8 }}\u003e{m.icon||"⛽"}\u003c/div\u003e
              \u003cdiv style={{ fontSize:12,color:"var(--text3)",fontWeight:600 }}\u003ePrix non disponible\u003cbr/\u003edans cette zone\u003c/div\u003e
            \u003c/div\u003e
          )}
        \u003c/div\u003e
      \u003c/div\u003e
    \u003c/div\u003e
  );
}
