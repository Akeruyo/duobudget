import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey:            "AIzaSyCzTXCbQtU4NIY_xB93H53sdMVXjG0BN3o",
  authDomain:        "duobudget-f4500.firebaseapp.com",
  projectId:         "duobudget-f4500",
  storageBucket:     "duobudget-f4500.firebasestorage.app",
  messagingSenderId: "212024272312",
  appId:             "1:212024272312:web:96b4a41cba3ec2f26adb4d"
};

const app  = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db   = getFirestore(app);