# 🚀 Guide de déploiement DuoBudget
## PC + iPhone synchronisés en temps réel via Firebase + Vercel

---

## ÉTAPE 1 — Créer le projet Firebase (5 min)

1. Va sur https://console.firebase.google.com
2. Clique **"Créer un projet"** → nomme-le `duobudget`
3. Désactive Google Analytics (pas nécessaire) → **Créer**

### Activer l'authentification
4. Dans le menu gauche → **Authentication** → **Commencer**
5. Onglet **"Sign-in method"** → **Email/Mot de passe** → Activer → Enregistrer

### Activer Firestore
6. Menu gauche → **Firestore Database** → **Créer une base de données**
7. Choisis **"Mode production"** → sélectionne une région (ex: `europe-west3`) → Activer
8. Onglet **"Règles"** → remplace tout par :
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /budgets/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```
9. Clique **Publier**

### Récupérer la config
10. Menu gauche → **⚙️ Paramètres du projet** → onglet **"Vos applications"**
11. Clique l'icône **"</>"** (Web) → nomme l'app `duobudget-web` → **Enregistrer**
12. Copie le bloc `firebaseConfig` qui s'affiche — tu en auras besoin à l'étape 3

---

## ÉTAPE 2 — Préparer le code (2 min)

Structure des fichiers à créer sur ton PC :
```
duobudget/
├── index.html
├── package.json
├── vite.config.js
└── src/
    ├── main.jsx
    ├── App.jsx
    └── firebase.js   ← à compléter
```

Tous ces fichiers sont fournis dans ce dossier.

---

## ÉTAPE 3 — Configurer Firebase dans le code (1 min)

Ouvre le fichier `src/firebase.js` et remplace les valeurs par ta config Firebase :

```js
const firebaseConfig = {
  apiKey:            "AIzaSy...",           // ← ta vraie clé
  authDomain:        "duobudget.firebaseapp.com",
  projectId:         "duobudget",
  storageBucket:     "duobudget.appspot.com",
  messagingSenderId: "123456789",
  appId:             "1:123456789:web:abc..."
};
```

---

## ÉTAPE 4 — Tester en local (optionnel)

Dans le dossier `duobudget/` :
```bash
npm install
npm run dev
```
Ouvre http://localhost:5173 → crée un compte → teste l'app ✅

---

## ÉTAPE 5 — Déployer sur Vercel (5 min)

### Créer un repo GitHub
1. Va sur https://github.com → **New repository** → nomme-le `duobudget`
2. Sur ton PC dans le dossier `duobudget/` :
```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/TON_USERNAME/duobudget.git
git push -u origin main
```

### Déployer sur Vercel
3. Va sur https://vercel.com → connecte-toi avec GitHub
4. **"Add New Project"** → importe `duobudget`
5. Framework: **Vite** (détecté automatiquement)
6. Clique **Deploy** → attends 1-2 min

✅ Ton app est en ligne sur `https://duobudget-xxx.vercel.app` !

---

## ÉTAPE 6 — Installer sur iPhone comme une vraie app

1. Sur ton iPhone, ouvre **Safari** (obligatoirement Safari, pas Chrome)
2. Va sur ton URL Vercel
3. Appuie sur le bouton **Partager** (carré avec flèche vers le haut)
4. Sélectionne **"Sur l'écran d'accueil"**
5. Nomme-la "DuoBudget" → **Ajouter**

🎉 L'icône apparaît sur ton écran d'accueil comme une vraie app !

---

## ✅ Comment ça marche ensuite

- **Toi et ton/ta partenaire** créez chacun un compte avec votre email
- Vous partagez les **mêmes données** → elles se synchronisent en temps réel
- Le point vert **"Synchronisé ✓"** dans la sidebar confirme la synchro
- Toute modification sur PC apparaît sur iPhone en quelques secondes

---

## 🔒 Sécurité

- Les données sont chiffrées et privées (règles Firestore)
- Chaque compte n'accède qu'à ses propres données
- Firebase gère l'authentification de façon sécurisée

---

## 🆘 Problèmes fréquents

**"Permission denied" dans Firestore**
→ Vérifie que les règles Firestore ont bien été publiées (Étape 1, point 9)

**L'app ne se met pas à jour sur l'iPhone**
→ Ferme l'app et rouvre-la, ou vide le cache Safari

**Erreur de build sur Vercel**
→ Vérifie que `firebase.js` contient ta vraie config (pas les placeholders)
