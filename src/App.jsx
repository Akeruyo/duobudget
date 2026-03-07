import { useState, useEffect, useCallback, useMemo, useRef, memo, lazy, Suspense } from "react";
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

const getDocRef = (uid) => doc(db, "budgets", uid);

const firestoreLoad = async (uid) => {
  try {
    const snap = await getDoc(getDocRef(uid));
    return snap.exists() ? snap.data().budget : null;
  } catch (e) {
    console.error("Erreur lors du chargement des données depuis Firestore:", e);
    return null;
  }
};

const firestoreSave = async (uid, data) => {
  try {
    await setDoc(getDocRef(uid), { budget: data, _ts: Date.now() }, { merge: true });
    return true;
  } catch (e) {
    console.error("Erreur lors de la sauvegarde des données dans Firestore:", e);
    return false;
  }
};

const getUserMetaRef = (uid) => doc(db, "userMeta", uid);
const getInviteRef = (code) => doc(db, "inviteCodes", code.toUpperCase());

const generateInviteCode = () => {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
};

const saveInviteCode = async (uid, code) => {
  try {
    await setDoc(getInviteRef(code), { ownerUID: uid, createdAt: Date.now() });
    return true;
  } catch (e) {
    console.error("Erreur lors de la sauvegarde du code d'invitation:", e);
    return false;
  }
};

const getLinkedUID = async (uid) => {
  try {
    const snap = await getDoc(getUserMetaRef(uid));
    return snap.exists() ? (snap.data().linkedUID || null) : null;
  } catch (e) {
    console.error("Erreur lors de la récupération de l'UID lié:", e);
    return null;
  }
};

const setLinkedUID = async (uid, linkedUID) => {
  try {
    await setDoc(getUserMetaRef(uid), { linkedUID }, { merge: true });
    return true;
  } catch (e) {
    console.error("Erreur lors de la définition de l'UID lié:", e);
    return false;
  }
};

const resolveInviteCode = async (code) => {
  try {
    const snap = await getDoc(getInviteRef(code.trim().toUpperCase()));
    return snap.exists() ? snap.data().ownerUID : null;
  } catch (e) {
    console.error("Erreur lors de la résolution du code d'invitation:", e);
    return null;
  }
};

// Helpers
const nowISO = () => new Date().toISOString();
const pad = n => String(n).padStart(2, "0");
const fmtDT = iso => {
  if (!iso) return "";
  const d = new Date(iso);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const fmtDate = iso => {
  if (!iso) return "";
  const d = new Date(iso);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
};
const mkid = () => `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
const monthKey = (y, m) => `${y}-${pad(m + 1)}`;
const curMonthKey = () => { const d = new Date(); return monthKey(d.getFullYear(), d.getMonth()); };
const monthLabel = k => {
  if (!k) return "";
  const [y, m] = k.split("-");
  return new Date(+y, +m - 1, 1).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
};
const fmt = n => (n || 0).toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + " €";
const fmtCompact = n => {
  if (Math.abs(n) >= 1000) return (n / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 1 }) + "k €";
  return fmt(n);
};

// Export CSV
const exportCSV = (transactions, categories, profiles, monthKey) => {
  const catMap = Object.fromEntries(categories.map(c => [c.id, c]));
  const profMap = Object.fromEntries(profiles.map(p => [p.id, p]));
  const header = "Date;Libellé;Montant;Catégorie;Profil;Auto\n";
  const rows = [...transactions]
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
    .map(t => [
      fmtDT(t.timestamp),
      `"${t.label}"`,
      (t.amount || 0).toFixed(2),
      catMap[t.categoryId]?.name || "",
      profMap[t.profileId]?.name || "",
      t.auto ? "Oui" : "Non"
    ].join(";"))
    .join("\n");
  const blob = new Blob(["\uFEFF" + header + rows], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `budget_${monthKey}.csv`; a.click();
  URL.revokeObjectURL(url);
};

const DEFAULT_CATS = [
  { id: "c1", name: "Loyer", icon: "🏠", color: "#FF6B6B" },
  { id: "c2", name: "Alimentation", icon: "🛒", color: "#4ECDC4" },
  { id: "c3", name: "Transport", icon: "🚗", color: "#45B7D1" },
  { id: "c4", name: "Loisirs", icon: "🎬", color: "#96CEB4" },
  { id: "c5", name: "Santé", icon: "💊", color: "#FFEAA7" },
  { id: "c6", name: "Vêtements", icon: "👗", color: "#DDA0DD" },
  { id: "c7", name: "Énergie", icon: "⚡", color: "#F0E68C" },
  { id: "c8", name: "Abonnements", icon: "📱", color: "#98FB98" },
  { id: "c9", name: "Restaurant", icon: "🍽️", color: "#FFB347" },
  { id: "c10", name: "Épargne", icon: "💰", color: "#87CEEB" },
];

const INIT = { profiles: [], categories: DEFAULT_CATS, monthsData: {}, bills: [], recurringIncomes: [], savingsGoal: 0 };

function ensureMonth(d, key) {
  if (!d.monthsData[key]) d.monthsData[key] = { transactions: [], incomes: { p1: 0, p2: 0, common: 0 }, billsProcessed: {} };
  if (!d.monthsData[key].billsProcessed) d.monthsData[key].billsProcessed = {};
  if (!d.monthsData[key].incomes) d.monthsData[key].incomes = { p1: 0, p2: 0, common: 0 };
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
  
  return { next, changed };
}

// Styles CSS
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800;900&family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,700;1,9..144,400&display=swap');
* { box-sizing: border-box; margin: 0; padding: 0; }
button, a, [role=button] { -webkit-tap-highlight-color: transparent; touch-action: manipulation; }
:root {
  --bg: #07060f; --bg2: #0e0c1e; --bg3: #15122a; --bg4: #1a1635;
  --text: #ede9f8; --border: rgba(255, 255, 255, 0.09);
}
html, body, #root { font-family: 'Outfit', sans-serif; width: 100%; height: 100%; background: var(--bg); color: var(--text); }
`;

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

  const navigateTo = useCallback((p) => { setPage(p); setSidebarOpen(false); }, []);

  const saveTimer = useRef(null);
  const isSaving = useRef(false);
  const localVersion = useRef(0);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) {
        setReady(false);
        setActiveUID(null);
        setIsLinked(false);
        setData(INIT);
        return;
      }
      setData(INIT);
      const linkedUID = await getLinkedUID(u.uid);
      const uid = linkedUID || u.uid;
      setActiveUID(uid);
      setIsLinked(!!linkedUID);

      const saved = await firestoreLoad(uid);
      if (saved) {
        const { processed } = processDueBills(saved);
        setData(processed);
      }
      setReady(true);

      const unsubFirestore = onSnapshot(getDocRef(uid), (snap) => {
        if (snap.exists()) {
          const remote = snap.data().budget;
          setData(processDueBills(remote).data);
        }
      });

      return () => unsubFirestore();
    });

    return () => unsub();
  }, []);

  return (
    <>
      <style>{CSS}</style>
      {/* Rest of your application JSX goes here */}
    </>
  );
}
