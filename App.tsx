import React, { useState, useEffect, useMemo } from 'react';
import { 
  LayoutDashboard, Upload, History, CheckCircle2, Package, Wallet, 
  Check, ShoppingBag, Trash2, Banknote, CalendarDays, X, Zap, Menu, ShieldCheck, 
  TriangleAlert, Files, ArrowUpRight, Save, History as HistoryIcon,
  Mail, Hash, Image as ImageIcon, BellRing, TrendingDown, TrendingUp, ChevronDown, ChevronRight,
  Info, CreditCard, Clock, PauseCircle, ArrowRight, UserCircle, MapPin, Phone, Download, Printer,
  Square, CheckSquare, Plus, Users, Share2, Globe, RefreshCcw, Mailbox, Lock, LogOut, Settings, FileText,
  Activity
} from 'lucide-react';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  AreaChart, Area 
} from 'recharts';

// Firebase Imports
import { auth, db } from './firebase';
import { 
  onAuthStateChanged, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut,
  User as FirebaseUser
} from "firebase/auth";
import {
  doc,
  setDoc,
  getDoc
} from "firebase/firestore";

import { extractInvoiceData } from './services/geminiService';
import { Invoice, User, InvoiceItem, Supplier, MasterItem, PriceHistoryEntry, TeamMember, VaultConfig } from './types';

interface Toast {
  id: number;
  message: string;
  type: 'success' | 'error' | 'info' | 'warning';
}

const App: React.FC = () => {
  // Auth State
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isAuthenticating, setIsAuthenticating] = useState(true);
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPass, setLoginPass] = useState('');

  // App Data State
  const [activeTab, setActiveTab] = useState<'dashboard' | 'upload' | 'history' | 'suppliers' | 'items' | 'variances' | 'gst' | 'team' | 'settings'>('dashboard');
  const [historyTab, setHistoryTab] = useState<'outstanding' | 'settled' | 'hold'>('outstanding');
  
  // Data States
  const [rawInvoices, setRawInvoices] = useState<Invoice[]>([]);
  const [masterItems, setMasterItems] = useState<MasterItem[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [vault, setVault] = useState<VaultConfig>({
    vaultId: 'VLT-A82J9Z',
    inboundEmail: 'audit-vlt-a82j9z@priceguardian.ai',
    isCloudSyncEnabled: true
  });

  // UI & Persistence Guards
  const [dataLoaded, setDataLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string>('');
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);
  const [selectedSupplierId, setSelectedSupplierId] = useState<string | null>(null);
  const [selectedMasterItemId, setSelectedMasterItemId] = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [bulkSelection, setBulkSelection] = useState<Set<string>>(new Set());
  const [varianceSelection, setVarianceSelection] = useState<Set<string>>(new Set());
  const [isSyncing, setIsSyncing] = useState(false);

  // 1. Phase 3 Cloud Load
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (fbUser: FirebaseUser | null) => {
      if (fbUser) {
        const docRef = doc(db, "users", fbUser.uid);
        const docSnap = await getDoc(docRef);
        
        if (docSnap.exists()) {
          const data = docSnap.data();
          setRawInvoices(data.invoices || []);
          setMasterItems(data.masterItems || []);
          setSuppliers(data.suppliers || []);
          if (data.vault) setVault(data.vault);
        }

        setCurrentUser({
          id: fbUser.uid,
          name: fbUser.email?.split('@')[0].toUpperCase() || 'USER',
          email: fbUser.email || '',
          role: 'Admin',
          organization: 'Firebase Vault',
          lastLogin: new Date().toISOString(),
          is2FAEnabled: false
        });
        
        setDataLoaded(true);
      } else {
        setCurrentUser(null);
        setRawInvoices([]);
        setMasterItems([]);
        setSuppliers([]);
        setDataLoaded(false);
      }
      setIsAuthenticating(false);
    });

    return () => unsubscribe();
  }, []);

  // 2. Automated Sync Engine
  useEffect(() => {
    if (auth.currentUser && dataLoaded) {
      const syncToCloud = async () => {
        setIsSyncing(true);
        try {
          const docRef = doc(db, "users", auth.currentUser!.uid);
          await setDoc(docRef, {
            invoices: rawInvoices,
            masterItems: masterItems,
            suppliers: suppliers,
            vault: vault,
            lastSynced: new Date().toISOString()
          }, { merge: true });
        } catch (err) {
          console.error("Firestore Sync Error:", err);
        } finally {
          setTimeout(() => setIsSyncing(false), 800);
        }
      };
      
      const debounceTimer = setTimeout(syncToCloud, 3000);
      return () => clearTimeout(debounceTimer);
    }
  }, [rawInvoices, masterItems, suppliers, vault, dataLoaded]);

  const addToast = (message: string, type: Toast['type'] = 'info') => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 6000);
  };

  const handleVaultAccess = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginEmail || !loginPass) return addToast("Credentials required", "error");

    setLoading(true);
    setUploadProgress(authMode === 'login' ? "Opening Vault..." : "Initializing Vault...");
    
    try {
      if (authMode === 'login') {
        await signInWithEmailAndPassword(auth, loginEmail, loginPass);
        addToast("Vault secured.", "success");
      } else {
        await createUserWithEmailAndPassword(auth, loginEmail, loginPass);
        addToast("Cloud vault provisioned.", "success");
      }
    } catch (err: any) {
      const msg = err.code?.replace('auth/', '').replace(/-/g, ' ') || err.message;
      addToast(`Access Error: ${msg}`, "error");
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      addToast("Vault locked.", "info");
    } catch (err: any) {
      addToast("Error locking vault.", "error");
    }
  };

  const enrichedInvoices = useMemo(() => {
    return rawInvoices.map((inv) => {
      const itemsWithVariances = inv.items.map((item) => {
        const master = masterItems.find(m => m.supplierName === inv.supplierName && m.name === item.name);
        const baseline = master?.currentPrice;
        const diff = baseline !== undefined ? item.unitPrice - baseline : 0;
        const pct = baseline ? (diff / baseline) * 100 : 0;
        return { ...item, previousUnitPrice: baseline, priceChange: diff, percentChange: pct } as InvoiceItem;
      });

      let status: Invoice['status'] = 'matched';
      const hasIncrease = itemsWithVariances.some(i => (i.priceChange || 0) > 0.01);
      const hasDecrease = itemsWithVariances.some(i => (i.priceChange || 0) < -0.01);
      if (hasIncrease && hasDecrease) status = 'mixed';
      else if (hasIncrease) status = 'price_increase';
      else if (hasDecrease) status = 'price_decrease';

      return { ...inv, items: itemsWithVariances, status };
    }).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [rawInvoices, masterItems]);

  const pendingVariances = useMemo(() => {
    const logs: any[] = [];
    enrichedInvoices.forEach(inv => {
      inv.items.forEach(item => {
        if (item.priceChange !== undefined && Math.abs(item.priceChange) > 0.01) {
          const master = masterItems.find(m => m.supplierName === inv.supplierName && m.name === item.name);
          const isSynced = master && Math.abs(master.currentPrice - item.unitPrice) < 0.001;
          if (!isSynced) {
            logs.push({
              key: `${inv.id}-${item.name}`,
              invoiceId: inv.id, invoiceNumber: inv.invoiceNumber, date: inv.date,
              supplierName: inv.supplierName, itemName: item.name, oldPrice: item.previousUnitPrice || 0,
              newPrice: item.unitPrice, variance: item.priceChange, pct: item.percentChange,
              masterItemId: master?.id
            });
          }
        }
      });
    });
    return logs.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [enrichedInvoices, masterItems]);

  const spendTrendData = useMemo(() => {
    const months = Array.from({length: 6}, (_, i) => {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      return d.toISOString().substring(0, 7);
    }).reverse();

    return months.map(m => {
      const spend = enrichedInvoices
        .filter(inv => inv.date.startsWith(m))
        .reduce((sum, inv) => sum + inv.totalAmount, 0);
      return { name: new Date(m).toLocaleDateString(undefined, {month: 'short'}), amount: spend };
    });
  }, [enrichedInvoices]);

  const stats = useMemo(() => {
    const unpaid = enrichedInvoices.filter(i => !i.isPaid && !i.isHold);
    const totalPayable = unpaid.reduce((sum, i) => sum + i.totalAmount, 0);
    const totalGst = enrichedInvoices.reduce((sum, i) => sum + i.gstAmount, 0);
    const supplierOutstanding: Record<string, number> = {};
    unpaid.forEach(inv => {
      supplierOutstanding[inv.supplierName] = (supplierOutstanding[inv.supplierName] || 0) + inv.totalAmount;
    });
    return { totalPayable, totalGst, totalCount: enrichedInvoices.length, supplierCount: suppliers.length, supplierOutstanding };
  }, [enrichedInvoices, suppliers]);

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;
    setLoading(true);
    for (const file of Array.from(files) as File[]) {
      setUploadProgress(`Auditing ${file.name}...`);
      try {
        const reader = new FileReader();
        const base64 = await new Promise<string>((resolve) => {
          reader.onload = () => resolve((reader.result as string).split(',')[1]);
          reader.readAsDataURL(file);
        });
        const data: any = await extractInvoiceData(base64, file.type || 'application/pdf');
        
        const newInvoice: Invoice = {
          ...data, id: `inv-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
          isPaid: false, isHold: false, status: 'matched', fileName: file.name, receivedVia: 'upload'
        };

        setSuppliers(prev => {
          const existing = prev.find(s => s.name === data.supplierName);
          const supDetails = { 
            bankAccount: data.bankAccount || existing?.bankAccount, 
            address: data.address || existing?.address, 
            abn: data.abn || existing?.abn, 
            tel: data.tel || existing?.tel, 
            email: data.email || existing?.email, 
            creditTerm: data.creditTerm || existing?.creditTerm 
          };
          if (existing) return prev.map(s => s.name === data.supplierName ? { ...s, ...supDetails } : s);
          return [...prev, { id: `sup-${Date.now()}`, name: data.supplierName, totalSpent: 0, ...supDetails }];
        });

        setRawInvoices(prev => [newInvoice, ...prev]);
        addToast(`Audited: ${data.invoiceNumber}`, 'success');
      } catch (err: any) {
        addToast(`Audit Failed: ${err.message}`, 'error');
      }
    }
    setLoading(false);
    setActiveTab('dashboard');
  };

  if (isAuthenticating) return null;

  if (!currentUser) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-6 relative overflow-hidden font-sans">
        <div className="absolute top-0 left-0 w-full h-full opacity-10 pointer-events-none">
           <div className="absolute top-10 left-10 w-96 h-96 bg-blue-600 rounded-full blur-[120px]" />
           <div className="absolute bottom-10 right-10 w-96 h-96 bg-emerald-600 rounded-full blur-[120px]" />
        </div>

        <div className="w-full max-w-md animate-in fade-in zoom-in duration-500 relative z-10">
           <div className="flex flex-col items-center mb-10 text-center">
              <div className="w-20 h-20 bg-blue-600 rounded-[2rem] flex items-center justify-center text-white shadow-2xl shadow-blue-500/30 mb-6">
                 <ShieldCheck size={40} />
              </div>
              <h1 className="text-4xl font-black text-white uppercase tracking-tighter mb-2 leading-none">Price Guardian</h1>
              <p className="text-slate-400 font-bold uppercase tracking-[0.2em] text-[10px]">Secure Procurement Vault</p>
           </div>

           <div className="bg-slate-800/50 backdrop-blur-xl border border-white/10 rounded-[2.5rem] p-10 shadow-2xl">
              <div className="flex space-x-2 mb-8 bg-slate-900/50 p-1.5 rounded-2xl border border-white/5">
                 <button onClick={() => setAuthMode('login')} className={`flex-1 py-3 text-[10px] font-black uppercase rounded-xl transition-all ${authMode === 'login' ? 'bg-slate-800 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}>Access Vault</button>
                 <button onClick={() => setAuthMode('signup')} className={`flex-1 py-3 text-[10px] font-black uppercase rounded-xl transition-all ${authMode === 'signup' ? 'bg-slate-800 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}>New Account</button>
              </div>

              <form onSubmit={handleVaultAccess} className="space-y-6">
                 <div>
                    <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-2 block ml-1">Email</label>
                    <div className="relative">
                       <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-600" size={18} />
                       <input type="email" value={loginEmail} onChange={e => setLoginEmail(e.target.value)} required className="w-full bg-slate-900/50 border border-white/5 rounded-2xl py-4 pl-12 pr-4 text-white text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500 transition-all" placeholder="name@business.com" />
                    </div>
                 </div>
                 <div>
                    <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-2 block ml-1">Vault Key</label>
                    <div className="relative">
                       <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-600" size={18} />
                       <input type="password" value={loginPass} onChange={e => setLoginPass(e.target.value)} required className="w-full bg-slate-900/50 border border-white/5 rounded-2xl py-4 pl-12 pr-4 text-white text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500 transition-all" placeholder="••••••••" />
                    </div>
                 </div>
                 <button type="submit" className="w-full bg-blue-600 hover:bg-blue-500 text-white py-5 rounded-2xl font-black uppercase text-xs tracking-widest shadow-2xl shadow-blue-500/20 transition-all active:scale-[0.98] mt-4 flex items-center justify-center space-x-3">
                    <span>{authMode === 'login' ? 'Enter Vault' : 'Initialize Vault'}</span>
                    <ArrowRight size={18} />
                 </button>
              </form>
           </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex bg-slate-50 font-sans text-slate-900 overflow-hidden print:bg-white relative">
      <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[1000] space-y-2 w-full max-w-md px-4 no-print pointer-events-none">
         {toasts.map(t => (
           <div key={t.id} className={`p-4 rounded-2xl shadow-2xl border flex items-start space-x-3 animate-in slide-in-from-top duration-300 pointer-events-auto ${t.type === 'success' ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white'}`}>
              <div className="mt-0.5">{t.type === 'success' ? <CheckCircle2 size={18} /> : <TriangleAlert size={18} />}</div>
              <div className="flex-1 text-[11px] font-medium leading-tight opacity-90">{t.message}</div>
           </div>
         ))}
      </div>

      <nav className="w-72 bg-slate-900 text-slate-400 flex flex-col shrink-0 fixed inset-y-0 left-0 lg:sticky lg:top-0 h-screen z-[100] transition-transform duration-300 no-print">
        <div className="p-10 flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center text-white shadow-xl"><ShieldCheck size={24} /></div>
            <span className="text-xl font-black text-white uppercase tracking-tighter">Guardian</span>
          </div>
        </div>
        <div className="flex-1 px-4 space-y-2 overflow-y-auto custom-scrollbar">
          <NavItem active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} icon={LayoutDashboard} label="Dashboard" />
          <NavItem active={activeTab === 'upload'} onClick={() => setActiveTab('upload')} icon={Upload} label="Audit Center" />
          <NavItem active={activeTab === 'history'} onClick={() => setActiveTab('history')} icon={History} label="History" />
          <NavItem active={activeTab === 'items'} onClick={() => setActiveTab('items')} icon={ShoppingBag} label="Baselines" />
          <NavItem active={activeTab === 'variances'} onClick={() => setActiveTab('variances')} icon={HistoryIcon} label="Variances" alertCount={pendingVariances.length} />
          <NavItem active={activeTab === 'suppliers'} onClick={() => setActiveTab('suppliers')} icon={Package} label="Vendors" />
          <NavItem active={activeTab === 'gst'} onClick={() => setActiveTab('gst')} icon={Banknote} label="GST Records" />
        </div>
        <div className="p-6">
           <div className="bg-slate-800 rounded-[2rem] p-5 flex flex-col space-y-4">
              <div className="flex items-center space-x-3">
                 <div className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center font-black text-xs">{currentUser.name[0]}</div>
                 <div className="min-w-0 flex-1 truncate text-white text-[10px] font-black uppercase">{currentUser.name}</div>
              </div>
              <button onClick={handleLogout} className="flex items-center justify-center space-x-2 py-3 bg-slate-900 hover:bg-rose-900/40 hover:text-rose-400 text-slate-500 rounded-xl text-[9px] font-black uppercase">
                 <LogOut size={14} /> <span>Lock Vault</span>
              </button>
           </div>
        </div>
      </nav>

      <main className="flex-1 overflow-y-auto p-4 lg:p-12 relative h-screen custom-scrollbar transition-all">
        <header className="flex justify-between items-center mb-8 no-print sticky top-0 bg-slate-50/90 backdrop-blur-md py-4 z-[80]">
          <h1 className="text-2xl lg:text-3xl font-black text-slate-900 uppercase tracking-tighter">{activeTab}</h1>
          <div className="flex items-center space-x-4">
             <div className="flex items-center space-x-2 px-4 py-2 bg-white border border-slate-200 rounded-xl text-[10px] font-black uppercase shadow-sm">
                <RefreshCcw size={14} className={isSyncing ? "text-amber-500 animate-spin" : "text-emerald-500"} />
                <span>{isSyncing ? "Syncing..." : "Secured"}</span>
             </div>
          </div>
        </header>

        <div className="max-w-7xl mx-auto space-y-10">
          {activeTab === 'dashboard' && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                <StatCard label="Total Payable" value={`$${stats.totalPayable.toLocaleString()}`} icon={Wallet} color="blue" />
                <StatCard label="Price Alerts" value={pendingVariances.length} icon={TriangleAlert} color="amber" />
                <StatCard label="Invoices Audited" value={stats.totalCount} icon={Files} color="emerald" />
                <StatCard label="Vendors" value={stats.supplierCount} icon={Package} color="slate" />
              </div>
              <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm p-8 h-80">
                 <h3 className="font-black text-slate-900 uppercase text-xs mb-6 flex items-center"><Activity size={18} className="mr-3 text-blue-600" /> SPEND TRAJECTORY</h3>
                 <ResponsiveContainer width="100%" height="80%">
                    <AreaChart data={spendTrendData}>
                       <defs><linearGradient id="col" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#2563eb" stopOpacity={0.1}/><stop offset="95%" stopColor="#2563eb" stopOpacity={0}/></linearGradient></defs>
                       <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fontSize: 10, fontWeight: 900, fill: '#94a3b8'}} />
                       <YAxis hide />
                       <Tooltip contentStyle={{borderRadius: '16px', border: 'none', fontWeight: 900, fontSize: '10px'}} />
                       <Area type="monotone" dataKey="amount" stroke="#2563eb" strokeWidth={4} fill="url(#col)" />
                    </AreaChart>
                 </ResponsiveContainer>
              </div>
            </>
          )}

          {activeTab === 'upload' && <UploadView handleFileUpload={handleFileUpload} loading={loading} progress={uploadProgress} vaultEmail={vault.inboundEmail} />}

          {activeTab === 'history' && (
            <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden">
               <div className="p-8 border-b border-slate-100 flex items-center space-x-4 bg-slate-50/50">
                  <div className="w-10 h-10 bg-slate-900 text-white rounded-xl flex items-center justify-center"><History size={20}/></div>
                  <h3 className="font-black text-slate-900 uppercase text-sm">Audit History</h3>
               </div>
               <div className="overflow-x-auto">
                  <table className="w-full text-left min-w-[800px]">
                     <thead><tr className="bg-slate-50 text-[10px] font-black uppercase text-slate-400 border-b"><th className="px-8 py-5">Date</th><th className="px-8 py-5">Vendor</th><th className="px-8 py-5 text-right">Liability</th><th className="px-8 py-5 text-center">Status</th></tr></thead>
                     <tbody className="divide-y divide-slate-50">
                        {enrichedInvoices.map(inv => (
                          <tr key={inv.id} className="hover:bg-slate-50 transition-all cursor-pointer" onClick={() => setSelectedInvoiceId(inv.id)}>
                            <td className="px-8 py-6 font-bold text-slate-500 text-[10px]">{inv.date}</td>
                            <td className="px-8 py-6 font-black text-slate-900 text-xs uppercase">{inv.supplierName}</td>
                            <td className="px-8 py-6 text-right font-black text-slate-900 text-xs">${inv.totalAmount.toFixed(2)}</td>
                            <td className="px-8 py-6"><div className="flex justify-center"><AuditBadge status={inv.status} hold={inv.isHold} /></div></td>
                          </tr>
                        ))}
                     </tbody>
                  </table>
               </div>
            </div>
          )}
        </div>
      </main>

      {loading && (
        <div className="fixed inset-0 z-[500] bg-slate-900/95 backdrop-blur-md flex flex-col items-center justify-center text-white p-6">
           <div className="w-16 h-16 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-8" />
           <p className="text-xl font-black uppercase tracking-tighter">{uploadProgress}</p>
        </div>
      )}
    </div>
  );
};

const NavItem = ({ active, onClick, icon: Icon, label, alertCount }: any) => (
  <button onClick={onClick} className={`w-full flex items-center space-x-4 px-6 py-4 rounded-2xl transition-all relative ${active ? 'bg-blue-600 text-white shadow-xl' : 'text-slate-400 hover:bg-slate-800'}`}>
    <Icon size={20} /> <span className="font-bold text-sm tracking-tight">{label}</span>
    {alertCount > 0 && <span className="absolute right-6 bg-rose-600 text-white w-5 h-5 rounded-full text-[10px] font-black flex items-center justify-center border-2 border-slate-900">{alertCount}</span>}
  </button>
);

const StatCard = ({ label, value, icon: Icon, color }: any) => {
  const c: any = { blue: 'text-blue-600 bg-blue-50', amber: 'text-rose-600 bg-rose-50', emerald: 'text-emerald-600 bg-emerald-50', slate: 'text-slate-600 bg-slate-50' };
  return (
    <div className="bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-sm hover:shadow-lg transition-all">
      <div className={`w-12 h-12 rounded-2xl flex items-center justify-center mb-6 shadow-sm ${c[color]}`}><Icon size={20} /></div>
      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">{label}</p>
      <h3 className="text-2xl font-black text-slate-900">{value}</h3>
    </div>
  );
};

const AuditBadge = ({ status, hold }: { status: string, hold?: boolean }) => {
  const config: any = { matched: { bg: 'bg-emerald-50 text-emerald-700', text: 'CLEAN' }, price_increase: { bg: 'bg-rose-50 text-rose-700', text: 'ALERT' }, price_decrease: { bg: 'bg-blue-50 text-blue-700', text: 'SAVING' } };
  const s = hold ? { bg: 'bg-slate-900 text-white', text: 'HOLD' } : config[status] || config.matched;
  return <div className={`px-3 py-1 rounded-full text-[9px] font-black border border-black/5 ${s.bg}`}>{s.text}</div>;
};

const UploadView = ({ handleFileUpload, loading, progress, vaultEmail }: any) => (
  <div className="max-w-4xl mx-auto py-20 text-center animate-in fade-in duration-700">
    <div className="w-24 h-24 bg-blue-600 text-white rounded-[2.5rem] flex items-center justify-center mx-auto mb-10 shadow-2xl"><Upload size={40} /></div>
    <h2 className="text-4xl font-black text-slate-900 uppercase tracking-tighter mb-4">Ingestion Gateway</h2>
    <p className="text-slate-400 font-bold mb-12 text-[11px] uppercase tracking-widest leading-relaxed">Forward PDFs to <span className="text-blue-600 lowercase">{vaultEmail}</span> or upload manually below.</p>
    <label className="group relative block cursor-pointer">
      <div className="border-4 border-dashed border-slate-200 rounded-[4rem] p-24 bg-white transition-all group-hover:border-blue-500 group-hover:bg-blue-50">
        <Plus size={32} className="mx-auto text-slate-300 group-hover:text-blue-500 mb-4" />
        <p className="text-slate-400 font-black uppercase text-xs">Drop Invoices Here</p>
      </div>
      <input type="file" className="hidden" onChange={handleFileUpload} accept="application/pdf,image/*" multiple />
    </label>
  </div>
);

export default App;