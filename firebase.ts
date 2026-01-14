
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBce0_E1F4ZuhNRikhdi8_TK4h40WAg2Ks",
  authDomain: "price-guardian-7e9e8.firebaseapp.com",
  projectId: "price-guardian-7e9e8",
  storageBucket: "price-guardian-7e9e8.firebasestorage.app",
  messagingSenderId: "462512423308",
  appId: "1:462512423308:web:b6ba93e4487c5f8df456a9",
  measurementId: "G-BDQ3YRYK4L"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Export for use in App.tsx
export const auth = getAuth(app);
export const db = getFirestore(app);
