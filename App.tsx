
import React, { useState, useEffect, useMemo } from 'react';
import { 
  LayoutDashboard, Upload, History, CheckCircle2, Package, Wallet, 
  Trash2, Banknote, X, Menu, ShieldCheck, 
  TriangleAlert, Files, Activity, RefreshCcw, LogOut, Plus, 
  ChevronRight, ArrowRight, Mail, Lock, Building2, UserCircle, 
  Phone, MapPin, Search, Hash, TrendingUp, TrendingDown, Bell, Filter, Clock
} from 'lucide-react';

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
import { Invoice, User, InvoiceItem, Supplier, MasterItem, VaultConfig, PriceHistoryEntry } from './types';

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
  const [activeTab, setActiveTab] = useState<'dashboard' | 'upload' | 'history' | 'suppliers' | 'gst' | 'stock' | 'hold' | 'alerts'>('dashboard');
  const [rawInvoices, setRawInvoices] = useState<Invoice[]>([]);
  const [masterItems, setMasterItems] = useState<MasterItem[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [vault, setVault] = useState<VaultConfig>({
    vaultId: 'VLT-A82J9Z',
    inboundEmail: 'audit-vlt-a82j9z@priceguardian.ai',
    isCloudSyncEnabled: true
  });

  // UI States
  const [dataLoaded, setDataLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string>('');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [acceptedAlertHistory, setAcceptedAlertHistory] = useState<any[]>([]);

  // Auth & Cloud Load
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
          setAcceptedAlertHistory(data.acceptedAlertHistory || []);
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
        setAcceptedAlertHistory([]);
        setDataLoaded(false);
      }
      setIsAuthenticating(false);
    });

    return () => unsubscribe();
  }, []);

  // Automated Sync Engine
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
            acceptedAlertHistory: acceptedAlertHistory,
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
  }, [rawInvoices, masterItems, suppliers, vault, dataLoaded, acceptedAlertHistory]);

  const addToast = (message: string, type: Toast['type'] = 'info') => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000);
  };

  const handleVaultAccess = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginEmail || !loginPass) return addToast("Credentials required", "error");
    setLoading(true);
    setUploadProgress(authMode === 'login' ? "Opening Vault..." : "Initializing Vault...");
    try {
      if (authMode === 'login') {
        await signInWithEmailAndPassword(auth, loginEmail, loginPass);
      } else {
        await createUserWithEmailAndPassword(auth, loginEmail, loginPass);
      }
      addToast("Vault secured.", "success");
    } catch (err: any) {
      addToast(`Access Error: ${err.message}`, "error");
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      addToast("Vault locked.", "info");
    } catch (err) {
      addToast("Error locking vault.", "error");
    }
  };

  const deleteInvoice = (id: string) => {
    if (window.confirm("Delete this invoice permanently?")) {
      setRawInvoices(prev => prev.filter(inv => inv.id !== id));
      addToast("Invoice deleted", "info");
    }
  };

  const toggleInvoicePaid = (id: string) => {
    setRawInvoices(prev => prev.map(inv => inv.id === id ? { ...inv, isPaid: !inv.isPaid, isHold: false } : inv));
    addToast("Payment status updated", "success");
  };

  const toggleInvoiceHold = (id: string) => {
    setRawInvoices(prev => prev.map(inv => inv.id === id ? { ...inv, isHold: !inv.isHold, isPaid: false } : inv));
    addToast("Hold status updated", "warning");
  };

  const commitPriceChange = (itemId: string, alertData?: any) => {
    setMasterItems(prev => prev.map(item => {
      if (item.id === itemId) {
        const latestInv = rawInvoices.sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime())
          .find(inv => inv.supplierName === item.supplierName && inv.items.some(i => i.name === item.name));
        
        const foundItem = latestInv?.items.find(i => i.name === item.name);
        if (foundItem) {
          const newHistory: PriceHistoryEntry = {
            date: latestInv!.date,
            price: foundItem.unitPrice,
            variance: foundItem.unitPrice - item.currentPrice,
            percentChange: ((foundItem.unitPrice - item.currentPrice) / item.currentPrice) * 100,
            source: 'audit',
            invoiceNumber: latestInv!.invoiceNumber
          };
          
          if (alertData) {
            setAcceptedAlertHistory(prevH => [{
              ...alertData,
              acceptedAt: new Date().toISOString()
            }, ...prevH]);
          }

          return {
            ...item,
            currentPrice: foundItem.unitPrice,
            history: [newHistory, ...item.history],
            lastUpdated: new Date().toISOString()
          };
        }
      }
      return item;
    }));
    addToast("Master price updated", "success");
  };

  const enrichedInvoices = useMemo(() => {
    return rawInvoices.map((inv) => {
      let status: Invoice['status'] = 'matched';
      const enrichedItems = inv.items.map(item => {
        const master = masterItems.find(m => m.name === item.name && m.supplierName === inv.supplierName);
        if (master && master.currentPrice !== item.unitPrice) {
          const change = item.unitPrice - master.currentPrice;
          return {
            ...item,
            previousUnitPrice: master.currentPrice,
            priceChange: change,
            percentChange: (change / master.currentPrice) * 100
          };
        }
        return item;
      });

      const hasIncrease = enrichedItems.some(i => (i.priceChange || 0) > 0);
      const hasDecrease = enrichedItems.some(i => (i.priceChange || 0) < 0);
      if (hasIncrease && hasDecrease) status = 'mixed';
      else if (hasIncrease) status = 'price_increase';
      else if (hasDecrease) status = 'price_decrease';

      return { ...inv, items: enrichedItems, status };
    }).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [rawInvoices, masterItems]);

  const activeAlerts = useMemo(() => {
    const alerts: any[] = [];
    enrichedInvoices.forEach(inv => {
      inv.items.forEach(item => {
        if (item.priceChange && Math.abs(item.priceChange) > 0.01) {
          const isAccepted = acceptedAlertHistory.some(h => h.invoiceNumber === inv.invoiceNumber && h.itemName === item.name);
          if (!isAccepted) {
            alerts.push({
              id: `${inv.id}-${item.name}`,
              masterId: masterItems.find(m => m.name === item.name && m.supplierName === inv.supplierName)?.id,
              itemName: item.name,
              supplier: inv.supplierName,
              oldPrice: item.previousUnitPrice || 0,
              newPrice: item.unitPrice,
              change: item.percentChange || 0,
              amountChange: item.priceChange || 0,
              invoiceNumber: inv.invoiceNumber,
              date: inv.date
            });
          }
        }
      });
    });
    return alerts;
  }, [enrichedInvoices, acceptedAlertHistory, masterItems]);

  const stats = useMemo(() => {
    const unpaid = enrichedInvoices.filter(i => !i.isPaid && !i.isHold);
    const totalPayable = unpaid.reduce((sum, i) => sum + i.totalAmount, 0);
    const payableBySupplier = unpaid.reduce((acc: Record<string, number>, inv) => {
      acc[inv.supplierName] = (acc[inv.supplierName] || 0) + inv.totalAmount;
      return acc;
    }, {});
    
    const totalGst = enrichedInvoices.reduce((sum, i) => sum + i.gstAmount, 0);
    return { 
      totalPayable, 
      payableBySupplier: Object.entries(payableBySupplier).sort((a, b) => (b[1] as number) - (a[1] as number)),
      totalGst, 
      totalCount: enrichedInvoices.length, 
      supplierCount: suppliers.length 
    };
  }, [enrichedInvoices, suppliers]);

  const gstByMonth = useMemo(() => {
    const groups: Record<string, Record<string, number>> = {};
    enrichedInvoices.forEach(inv => {
      const month = inv.date.substring(0, 7);
      if (!groups[month]) groups[month] = {};
      groups[month][inv.supplierName] = (groups[month][inv.supplierName] || 0) + inv.gstAmount;
    });
    return Object.entries(groups).sort((a, b) => b[0].localeCompare(a[0]));
  }, [enrichedInvoices]);

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;
    setLoading(true);
    // Explicitly cast files as File[] to access properties
    for (const file of Array.from(files) as File[]) {
      setUploadProgress(`Auditing ${file.name}...`);
      try {
        const reader = new FileReader();
        const base64 = await new Promise<string>((resolve) => {
          reader.onload = () => resolve((reader.result as string).split(',')[1]);
          reader.readAsDataURL(file);
        });
        const data = await extractInvoiceData(base64, file.type || 'application/pdf') as any;
        
        const newInvoice: Invoice = {
          ...data, id: `inv-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
          isPaid: false, isHold: false, status: 'matched', fileName: file.name, receivedVia: 'upload'
        };

        setSuppliers(prev => {
          const existing = prev.find(s => s.name === data.supplierName);
          const supDetails: Supplier = { 
            id: existing?.id || `sup-${Date.now()}`,
            name: data.supplierName,
            bankAccount: data.bankAccount || existing?.bankAccount, 
            address: data.address || existing?.address, 
            abn: data.abn || existing?.abn, 
            tel: data.tel || existing?.tel, 
            email: data.email || existing?.email, 
            creditTerm: data.creditTerm || existing?.creditTerm,
            totalSpent: (existing?.totalSpent || 0) + data.totalAmount
          };
          if (existing) return prev.map(s => s.name === data.supplierName ? { ...s, ...supDetails } : s);
          return [...prev, supDetails];
        });

        setMasterItems(prev => {
          let updated = [...prev];
          data.items.forEach((item: any) => {
            const exists = updated.find(m => m.name === item.name && m.supplierName === data.supplierName);
            if (!exists) {
              updated.push({
                id: `mi-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
                supplierName: data.supplierName,
                name: item.name,
                currentPrice: item.unitPrice,
                lastUpdated: data.date,
                history: [{
                  date: data.date,
                  price: item.unitPrice,
                  variance: 0,
                  percentChange: 0,
                  source: 'audit',
                  invoiceNumber: data.invoiceNumber
                }]
              });
            }
          });
          return updated;
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

  const handleAcceptPrice = (alert: any) => {
    commitPriceChange(alert.masterId, alert);
    addToast("Price update accepted and committed", "success");
  };

  if (isAuthenticating) return null;

  if (!currentUser) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-6 relative overflow-hidden">
        <div className="w-full max-w-md relative z-10 animate-in fade-in zoom-in duration-500">
           <div className="flex flex-col items-center mb-10 text-center text-white">
              <div className="w-20 h-20 bg-blue-600 rounded-[2rem] flex items-center justify-center shadow-2xl mb-6"><ShieldCheck size={40} /></div>
              <h1 className="text-4xl font-black uppercase tracking-tighter">Price Guardian</h1>
              <p className="text-slate-400 font-bold uppercase tracking-widest text-[10px] mt-2">Secure AI Procurement</p>
           </div>
           <div className="bg-slate-800/50 backdrop-blur-xl border border-white/10 rounded-[2.5rem] p-10">
              <div className="flex space-x-2 mb-8 bg-slate-900/50 p-1.5 rounded-2xl">
                 <button onClick={() => setAuthMode('login')} className={`flex-1 py-3 text-[10px] font-black uppercase rounded-xl transition-all ${authMode === 'login' ? 'bg-slate-800 text-white shadow-lg' : 'text-slate-500'}`}>Login</button>
                 <button onClick={() => setAuthMode('signup')} className={`flex-1 py-3 text-[10px] font-black uppercase rounded-xl transition-all ${authMode === 'signup' ? 'bg-slate-800 text-white shadow-lg' : 'text-slate-500'}`}>Signup</button>
              </div>
              <form onSubmit={handleVaultAccess} className="space-y-6">
                 <div className="relative">
                    <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-600" size={18} />
                    <input type="email" value={loginEmail} onChange={e => setLoginEmail(e.target.value)} required className="w-full bg-slate-900/50 border border-white/5 rounded-2xl py-4 pl-12 pr-4 text-white text-xs outline-none" placeholder="Email" />
                 </div>
                 <div className="relative">
                    <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-600" size={18} />
                    <input type="password" value={loginPass} onChange={e => setLoginPass(e.target.value)} required className="w-full bg-slate-900/50 border border-white/5 rounded-2xl py-4 pl-12 pr-4 text-white text-xs outline-none" placeholder="Vault Key" />
                 </div>
                 <button type="submit" className="w-full bg-blue-600 hover:bg-blue-500 text-white py-5 rounded-2xl font-black uppercase text-xs tracking-widest transition-all">
                    {authMode === 'login' ? 'Enter Vault' : 'Initialize Vault'}
                 </button>
              </form>
           </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex bg-slate-50 font-sans text-slate-900 relative">
      <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[1000] space-y-2 w-full max-w-md px-4 pointer-events-none">
         {toasts.map(t => (
           <div key={t.id} className={`p-4 rounded-2xl shadow-2xl border flex items-start space-x-3 animate-in slide-in-from-top duration-300 pointer-events-auto ${t.type === 'success' ? 'bg-emerald-600' : t.type === 'warning' ? 'bg-amber-600' : 'bg-rose-600'} text-white`}>
              <div className="mt-0.5">{t.type === 'success' ? <CheckCircle2 size={18} /> : <TriangleAlert size={18} />}</div>
              <div className="flex-1 text-[11px] font-bold leading-tight uppercase">{t.message}</div>
           </div>
         ))}
      </div>

      <nav className={`fixed lg:sticky lg:top-0 inset-y-0 left-0 w-72 bg-slate-900 text-slate-400 flex flex-col shrink-0 z-[100] transition-transform duration-300 transform ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'} no-print h-screen overflow-y-auto`}>
        <div className="p-8 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center text-white"><ShieldCheck size={24} /></div>
            <span className="text-xl font-black text-white uppercase tracking-tighter">Guardian</span>
          </div>
          <button className="lg:hidden text-slate-400" onClick={() => setIsSidebarOpen(false)}><X /></button>
        </div>
        <div className="flex-1 px-4 space-y-1">
          <NavItem active={activeTab === 'dashboard'} onClick={() => {setActiveTab('dashboard'); setIsSidebarOpen(false)}} icon={LayoutDashboard} label="Dashboard" />
          <NavItem active={activeTab === 'upload'} onClick={() => {setActiveTab('upload'); setIsSidebarOpen(false)}} icon={Upload} label="Audit Center" />
          <NavItem active={activeTab === 'history'} onClick={() => {setActiveTab('history'); setIsSidebarOpen(false)}} icon={History} label="Audit History" />
          <NavItem active={activeTab === 'hold'} onClick={() => {setActiveTab('hold'); setIsSidebarOpen(false)}} icon={Clock} label="On Hold" />
          <NavItem active={activeTab === 'alerts'} onClick={() => {setActiveTab('alerts'); setIsSidebarOpen(false)}} icon={Bell} label="Price Alerts" />
          <NavItem active={activeTab === 'stock'} onClick={() => {setActiveTab('stock'); setIsSidebarOpen(false)}} icon={Package} label="Master Stock" />
          <NavItem active={activeTab === 'suppliers'} onClick={() => {setActiveTab('suppliers'); setIsSidebarOpen(false)}} icon={Building2} label="Vendor Records" />
          <NavItem active={activeTab === 'gst'} onClick={() => {setActiveTab('gst'); setIsSidebarOpen(false)}} icon={Banknote} label="GST Ledger" />
        </div>
        <div className="p-6 mt-auto">
           <div className="bg-slate-800 rounded-[2rem] p-4 flex flex-col space-y-3">
              <div className="flex items-center space-x-3 truncate">
                 <div className="w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center font-black text-xs">{currentUser.name[0]}</div>
                 <div className="text-white text-[10px] font-black uppercase truncate">{currentUser.name}</div>
              </div>
              <button onClick={handleLogout} className="flex items-center justify-center space-x-2 py-2.5 bg-slate-900 hover:bg-rose-900 text-slate-500 hover:text-white rounded-xl text-[9px] font-black uppercase transition-colors">
                 <LogOut size={14} /> <span>Lock Vault</span>
              </button>
           </div>
        </div>
      </nav>

      <main className="flex-1 p-4 lg:p-10 max-w-full overflow-x-hidden min-h-screen">
        <header className="flex lg:hidden items-center justify-between mb-6 bg-white p-4 rounded-2xl shadow-sm">
           <div className="flex items-center space-x-3">
              <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white"><ShieldCheck size={18} /></div>
              <span className="font-black text-slate-900 uppercase tracking-tighter">Guardian</span>
           </div>
           <button onClick={() => setIsSidebarOpen(true)} className="p-2 bg-slate-100 rounded-lg text-slate-600"><Menu size={20} /></button>
        </header>

        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
           <h1 className="text-2xl lg:text-3xl font-black text-slate-900 uppercase tracking-tighter">{activeTab.replace('_', ' ')}</h1>
           {activeAlerts.length > 0 && (
              <div className="bg-rose-50 border border-rose-200 px-4 py-2 rounded-xl flex items-center space-x-3 animate-pulse cursor-pointer" onClick={() => setActiveTab('alerts')}>
                <TriangleAlert size={16} className="text-rose-600" />
                <span className="text-[10px] font-black uppercase text-rose-700">{activeAlerts.length} Price Shifts Detected</span>
              </div>
           )}
        </div>

        <div className="space-y-8">
          {activeTab === 'dashboard' && (
            <div className="space-y-10">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-1">
                   <StatCard label="Total Payable" value={`$${stats.totalPayable.toFixed(2)}`} icon={Wallet} color="blue" />
                   <div className="mt-4 bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm">
                      <h4 className="text-[10px] font-black uppercase text-slate-400 mb-4 tracking-widest">Payable by Supplier</h4>
                      <div className="space-y-3 max-h-[300px] overflow-y-auto custom-scrollbar">
                         {stats.payableBySupplier.map(([name, amount]) => (
                            <div key={name} className="flex justify-between items-center py-3 border-b border-slate-50 last:border-0">
                               <span className="text-[10px] font-bold text-slate-700 truncate mr-2">{name}</span>
                               <span className="text-[11px] font-black text-slate-900">${(amount as number).toFixed(2)}</span>
                            </div>
                         ))}
                         {stats.payableBySupplier.length === 0 && <p className="text-[10px] font-bold text-slate-400 text-center py-6">No outstanding payables</p>}
                      </div>
                   </div>
                </div>
                <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <StatCard label="GST (YTD)" value={`$${stats.totalGst.toFixed(2)}`} icon={Banknote} color="emerald" />
                  <StatCard label="Total Audits" value={stats.totalCount} icon={Files} color="slate" />
                  <StatCard label="Active Vendors" value={stats.supplierCount} icon={Building2} color="blue" />
                  <StatCard label="Price Alerts" value={activeAlerts.length} icon={Bell} color="rose" />
                </div>
              </div>
              
              {/* Condensed Alert Preview on Dashboard */}
              <div className="bg-white rounded-[2rem] border border-slate-200 shadow-sm p-8">
                 <div className="flex justify-between items-center mb-6">
                    <h3 className="font-black uppercase text-xs tracking-widest flex items-center"><Bell size={18} className="mr-3 text-rose-500" /> Recent Price Variance</h3>
                    <button onClick={() => setActiveTab('alerts')} className="text-[10px] font-black uppercase text-blue-600 hover:underline">View All Alerts</button>
                 </div>
                 <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {activeAlerts.slice(0, 4).map(alert => (
                       <div key={alert.id} className="p-4 bg-slate-50 rounded-2xl flex items-center justify-between border border-transparent hover:border-slate-200 transition-all">
                          <div>
                             <p className="text-[9px] font-black text-slate-400 uppercase">{alert.supplier}</p>
                             <h4 className="text-[10px] font-black text-slate-900 uppercase truncate max-w-[120px]">{alert.itemName}</h4>
                          </div>
                          <div className="text-right">
                             <p className={`text-[11px] font-black ${alert.change > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                                {alert.change > 0 ? '+' : ''}{alert.change.toFixed(1)}%
                             </p>
                             <p className="text-[9px] font-bold text-slate-400">${alert.oldPrice.toFixed(2)} → ${alert.newPrice.toFixed(2)}</p>
                          </div>
                       </div>
                    ))}
                    {activeAlerts.length === 0 && (
                       <div className="col-span-2 py-8 text-center bg-slate-50 rounded-3xl">
                          <CheckCircle2 size={32} className="mx-auto text-emerald-500 mb-2" />
                          <p className="text-[10px] font-black uppercase text-slate-400">All Prices Optimized</p>
                       </div>
                    )}
                 </div>
              </div>
            </div>
          )}

          {activeTab === 'upload' && <UploadView handleFileUpload={handleFileUpload} loading={loading} progress={uploadProgress} vaultEmail={vault.inboundEmail} />}

          {activeTab === 'alerts' && (
             <div className="space-y-10">
                <div className="bg-slate-900 rounded-[2.5rem] p-10 text-white shadow-2xl relative overflow-hidden">
                   <div className="relative z-10">
                      <h3 className="font-black uppercase text-sm tracking-widest flex items-center mb-10 text-rose-400">
                         <Bell size={24} className="mr-4" /> ACTIVE PRICE ALERT HUB
                      </h3>
                      {activeAlerts.length > 0 ? (
                         <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            {activeAlerts.map(alert => (
                               <div key={alert.id} className="group relative flex flex-col p-8 bg-white/5 rounded-[2rem] border border-white/10 hover:border-rose-500/50 transition-all shadow-xl">
                                  <div className="flex justify-between items-start mb-6">
                                     <div className="flex items-center space-x-4">
                                        <div className={`w-14 h-14 rounded-2xl flex items-center justify-center shrink-0 ${alert.change > 0 ? 'bg-rose-500/20 text-rose-400' : 'bg-emerald-500/20 text-emerald-400'}`}>
                                           {alert.change > 0 ? <TrendingUp size={28} /> : <TrendingDown size={28} />}
                                        </div>
                                        <div>
                                           <p className="text-[10px] font-black text-slate-500 uppercase mb-1 tracking-wider">{alert.supplier}</p>
                                           <h4 className="font-black text-white text-lg uppercase leading-tight">{alert.itemName}</h4>
                                        </div>
                                     </div>
                                     <div className="text-right">
                                        <p className="text-[10px] font-black text-slate-500 uppercase mb-1">Inv: {alert.invoiceNumber}</p>
                                        <p className="text-[10px] font-black text-slate-500 uppercase">{alert.date}</p>
                                     </div>
                                  </div>
                                  <div className="grid grid-cols-3 gap-4 mb-8">
                                     <div className="bg-black/20 p-4 rounded-2xl">
                                        <p className="text-[9px] font-black text-slate-500 uppercase mb-1">Old Price</p>
                                        <p className="font-black text-slate-300 text-sm">${alert.oldPrice.toFixed(2)}</p>
                                     </div>
                                     <div className="bg-black/20 p-4 rounded-2xl">
                                        <p className="text-[9px] font-black text-slate-500 uppercase mb-1">New Price</p>
                                        <p className="font-black text-white text-sm">${alert.newPrice.toFixed(2)}</p>
                                     </div>
                                     <div className="bg-black/20 p-4 rounded-2xl">
                                        <p className="text-[9px] font-black text-slate-500 uppercase mb-1">Change</p>
                                        <p className={`font-black text-sm ${alert.change > 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                                           {alert.change > 0 ? '+' : ''}${Math.abs(alert.amountChange).toFixed(2)}
                                        </p>
                                     </div>
                                  </div>
                                  <button 
                                     onClick={() => handleAcceptPrice(alert)}
                                     className="w-full bg-blue-600 hover:bg-emerald-600 text-white py-4 rounded-2xl text-[11px] font-black uppercase transition-all shadow-xl shadow-blue-500/20 flex items-center justify-center space-x-3"
                                  >
                                     <CheckCircle2 size={18} />
                                     <span>Accept & Commit to Stock Registry</span>
                                  </button>
                               </div>
                            ))}
                         </div>
                      ) : (
                         <div className="py-24 text-center">
                            <ShieldCheck size={64} className="mx-auto text-emerald-500/50 mb-6" />
                            <h4 className="font-black text-white text-xl uppercase">All Prices Anchored</h4>
                            <p className="text-slate-500 font-bold uppercase text-[11px] tracking-widest mt-3">No pending price variances found in latest audits.</p>
                         </div>
                      )}
                   </div>
                </div>

                <div className="bg-white rounded-[2rem] border border-slate-200 shadow-sm p-10">
                   <h3 className="font-black uppercase text-xs tracking-widest text-slate-400 mb-8">Alert Transaction Log</h3>
                   <div className="space-y-4">
                      {acceptedAlertHistory.length > 0 ? acceptedAlertHistory.map((h, i) => (
                         <div key={i} className="flex flex-wrap items-center justify-between p-5 bg-slate-50 rounded-2xl border border-slate-100">
                            <div className="flex items-center space-x-4">
                               <div className="w-10 h-10 rounded-xl bg-slate-200 flex items-center justify-center text-slate-500"><CheckCircle2 size={20} /></div>
                               <div>
                                  <h4 className="text-[11px] font-black text-slate-900 uppercase">{h.itemName}</h4>
                                  <p className="text-[9px] font-bold text-slate-500 uppercase">{h.supplier} • Accepted on {new Date(h.acceptedAt).toLocaleDateString()}</p>
                               </div>
                            </div>
                            <div className="text-right">
                               <p className="text-[11px] font-black text-emerald-600 uppercase">Commited: ${h.newPrice.toFixed(2)}</p>
                               <p className="text-[9px] font-bold text-slate-400 uppercase">From Invoice {h.invoiceNumber}</p>
                            </div>
                         </div>
                      )) : (
                         <p className="text-[11px] font-bold text-slate-400 text-center py-12">No historical alerts recorded yet.</p>
                      )}
                   </div>
                </div>
             </div>
          )}

          {activeTab === 'history' && (
            <div className="bg-white rounded-[2rem] border border-slate-200 shadow-sm overflow-hidden">
               <div className="overflow-x-auto custom-scrollbar">
                  <table className="w-full text-left min-w-[900px]">
                     <thead>
                        <tr className="bg-slate-50 border-b text-[10px] font-black uppercase text-slate-400">
                           <th className="px-6 py-5">Date</th>
                           <th className="px-6 py-5">Vendor</th>
                           <th className="px-6 py-5">Inv #</th>
                           <th className="px-6 py-5 text-right">Total</th>
                           <th className="px-6 py-5 text-center">Audit Controls</th>
                           <th className="px-6 py-5 text-center">Actions</th>
                        </tr>
                     </thead>
                     <tbody className="divide-y divide-slate-100">
                        {enrichedInvoices.filter(i => !i.isHold).map(inv => (
                          <tr key={inv.id} className="hover:bg-slate-50 transition-colors group">
                            <td className="px-6 py-6 font-bold text-slate-500 text-[10px]">{inv.date}</td>
                            <td className="px-6 py-6 font-black text-slate-900 text-xs uppercase">{inv.supplierName}</td>
                            <td className="px-6 py-6 font-bold text-slate-400 text-xs">{inv.invoiceNumber}</td>
                            <td className="px-6 py-6 text-right font-black text-slate-900 text-xs">${inv.totalAmount.toFixed(2)}</td>
                            <td className="px-6 py-6">
                               <div className="flex items-center justify-center space-x-2">
                                  <button 
                                    onClick={() => toggleInvoicePaid(inv.id)}
                                    className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase border transition-all ${inv.isPaid ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-slate-400 border-slate-200 hover:border-emerald-500'}`}
                                  >
                                    SETTLED
                                  </button>
                                  <button 
                                    onClick={() => toggleInvoiceHold(inv.id)}
                                    className="px-3 py-1.5 rounded-lg text-[9px] font-black uppercase border border-slate-200 bg-white text-slate-400 hover:bg-rose-50 hover:text-rose-600 hover:border-rose-200 transition-all"
                                  >
                                    MOVE TO HOLD
                                  </button>
                               </div>
                            </td>
                            <td className="px-6 py-6 text-center">
                               <button onClick={() => deleteInvoice(inv.id)} className="p-2 text-slate-300 hover:text-rose-600 transition-colors"><Trash2 size={16} /></button>
                            </td>
                          </tr>
                        ))}
                     </tbody>
                  </table>
               </div>
            </div>
          )}

          {activeTab === 'hold' && (
             <div className="bg-white rounded-[2rem] border border-slate-200 shadow-sm overflow-hidden">
               <div className="overflow-x-auto custom-scrollbar">
                  <table className="w-full text-left min-w-[900px]">
                     <thead>
                        <tr className="bg-slate-50 border-b text-[10px] font-black uppercase text-slate-400">
                           <th className="px-6 py-5">Date Held</th>
                           <th className="px-6 py-5">Vendor</th>
                           <th className="px-6 py-5">Inv #</th>
                           <th className="px-6 py-5 text-right">Held Amount</th>
                           <th className="px-6 py-5 text-center">Actions</th>
                        </tr>
                     </thead>
                     <tbody className="divide-y divide-slate-100">
                        {enrichedInvoices.filter(i => i.isHold).map(inv => (
                          <tr key={inv.id} className="hover:bg-slate-50 transition-colors group">
                            <td className="px-6 py-6 font-bold text-slate-500 text-[10px]">{inv.date}</td>
                            <td className="px-6 py-6 font-black text-slate-900 text-xs uppercase">{inv.supplierName}</td>
                            <td className="px-6 py-6 font-bold text-slate-400 text-xs">{inv.invoiceNumber}</td>
                            <td className="px-6 py-6 text-right font-black text-rose-600 text-xs">${inv.totalAmount.toFixed(2)}</td>
                            <td className="px-6 py-6 text-center">
                               <button 
                                 onClick={() => toggleInvoiceHold(inv.id)}
                                 className="px-4 py-2 bg-slate-900 text-white rounded-xl text-[9px] font-black uppercase hover:bg-blue-600 transition-all"
                               >
                                 Release to Audit
                               </button>
                            </td>
                          </tr>
                        ))}
                        {enrichedInvoices.filter(i => i.isHold).length === 0 && (
                           <tr>
                              <td colSpan={5} className="px-6 py-20 text-center">
                                 <Clock size={32} className="mx-auto text-slate-300 mb-3" />
                                 <p className="text-[10px] font-black uppercase text-slate-400">No invoices currently on hold.</p>
                              </td>
                           </tr>
                        )}
                     </tbody>
                  </table>
               </div>
            </div>
          )}

          {activeTab === 'stock' && (
            <div className="space-y-6">
               <div className="bg-white rounded-[2rem] border border-slate-200 shadow-sm overflow-hidden">
                  <div className="p-6 border-b flex flex-wrap items-center justify-between gap-4">
                     <div className="relative flex-1 min-w-[300px]">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                        <input type="text" placeholder="Search Master Stock Registry..." className="w-full bg-slate-50 border-none rounded-2xl py-3 pl-12 pr-4 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500/20 transition-all" />
                     </div>
                  </div>
                  <div className="overflow-x-auto custom-scrollbar">
                     <table className="w-full text-left min-w-[1000px]">
                        <thead>
                           <tr className="bg-slate-50 border-b text-[10px] font-black uppercase text-slate-400">
                              <th className="px-6 py-5">Product Name</th>
                              <th className="px-6 py-5">Supplier</th>
                              <th className="px-6 py-5 text-right">Anchored Rate</th>
                              <th className="px-6 py-5 text-right">Last Audit</th>
                              <th className="px-6 py-5 text-center">Status</th>
                           </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                           {masterItems.map(item => {
                              const latestInvoice = rawInvoices.sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                                .find(inv => inv.supplierName === item.supplierName && inv.items.some(i => i.name === item.name));
                              const latestPrice = latestInvoice?.items.find(i => i.name === item.name)?.unitPrice || item.currentPrice;
                              const variance = latestPrice - item.currentPrice;
                              const isChanged = Math.abs(variance) > 0.01;

                              return (
                                <tr key={item.id} className="hover:bg-slate-50 transition-colors">
                                  <td className="px-6 py-6 font-black text-slate-900 text-xs uppercase">{item.name}</td>
                                  <td className="px-6 py-6 font-bold text-slate-400 text-[10px] uppercase">{item.supplierName}</td>
                                  <td className="px-6 py-6 text-right font-black text-slate-900 text-xs">${item.currentPrice.toFixed(2)}</td>
                                  <td className="px-6 py-6 text-right font-bold text-slate-500 text-xs">{item.lastUpdated}</td>
                                  <td className="px-6 py-6 text-center">
                                     {isChanged ? (
                                       <div className={`inline-flex items-center space-x-1 px-3 py-1 rounded-full text-[9px] font-black uppercase ${variance > 0 ? 'bg-rose-50 text-rose-600' : 'bg-emerald-50 text-emerald-600'}`}>
                                          {variance > 0 ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
                                          <span>PENDING SYNC</span>
                                       </div>
                                     ) : (
                                       <span className="text-[9px] font-black uppercase text-slate-300 tracking-widest">Locked</span>
                                     )}
                                  </td>
                                </tr>
                              );
                           })}
                        </tbody>
                     </table>
                  </div>
               </div>
            </div>
          )}

          {activeTab === 'suppliers' && (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
               {suppliers.map(sup => (
                 <div key={sup.id} className="bg-white rounded-[2rem] border border-slate-200 shadow-sm p-6 space-y-4 hover:shadow-md transition-shadow">
                    <div className="flex items-center justify-between border-b pb-4">
                       <h3 className="font-black text-slate-900 uppercase text-sm tracking-tight truncate flex-1 mr-4">{sup.name}</h3>
                       <div className="bg-blue-50 text-blue-700 px-3 py-1 rounded-full text-[9px] font-black">ACTIVE</div>
                    </div>
                    <div className="space-y-3">
                       <SupplierInfo icon={Hash} label="ABN" value={sup.abn || 'Not found'} />
                       <SupplierInfo icon={Building2} label="Address" value={sup.address || 'Not found'} />
                       <SupplierInfo icon={Phone} label="Contact" value={sup.tel || 'Not found'} />
                       <SupplierInfo icon={Mail} label="Email" value={sup.email || 'Not found'} />
                       <div className="pt-2 border-t mt-4">
                          <p className="text-[9px] font-black text-slate-400 uppercase mb-1">Bank Details</p>
                          <p className="text-[10px] font-bold text-blue-600">{sup.bankAccount || 'EFT details missing'}</p>
                       </div>
                       <div className="pt-2 flex justify-between items-center text-[10px] font-black uppercase">
                          <span className="text-slate-400">Total Volume</span>
                          <span className="text-slate-900">${sup.totalSpent.toLocaleString()}</span>
                       </div>
                    </div>
                 </div>
               ))}
            </div>
          )}

          {activeTab === 'gst' && (
            <div className="space-y-6">
               {gstByMonth.map(([month, data]) => {
                 const monthData = data as Record<string, number>;
                 const totalForMonth = Object.values(monthData).reduce((a, b) => (a as number) + (b as number), 0);
                 
                 return (
                   <div key={month} className="bg-white rounded-[2rem] border border-slate-200 shadow-sm overflow-hidden">
                      <div className="px-8 py-6 bg-slate-50 border-b flex justify-between items-center">
                         <h4 className="font-black text-slate-900 uppercase text-sm">{new Date(month).toLocaleDateString(undefined, {month: 'long', year: 'numeric'})}</h4>
                         <span className="bg-emerald-600 text-white px-4 py-1.5 rounded-xl text-[10px] font-black">
                            Total: ${(totalForMonth as number).toFixed(2)}
                         </span>
                      </div>
                      <div className="p-4">
                         <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {Object.entries(monthData).map(([name, amount]) => (
                               <div key={name} className="flex justify-between items-center p-4 bg-slate-50 rounded-2xl">
                                  <span className="font-black text-slate-700 text-[11px] uppercase truncate flex-1 mr-4">{name}</span>
                                  <span className="font-bold text-slate-900 text-xs">${(amount as number).toFixed(2)}</span>
                               </div>
                            ))}
                         </div>
                      </div>
                   </div>
                 );
               })}
            </div>
          )}
        </div>
      </main>

      {loading && (
        <div className="fixed inset-0 z-[500] bg-slate-900/95 backdrop-blur-md flex flex-col items-center justify-center text-white p-6">
           <div className="w-16 h-16 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-8" />
           <p className="text-xl font-black uppercase tracking-tighter animate-pulse">{uploadProgress}</p>
        </div>
      )}
    </div>
  );
};

const NavItem = ({ active, onClick, icon: Icon, label }: any) => (
  <button onClick={onClick} className={`w-full flex items-center space-x-4 px-6 py-4 rounded-2xl transition-all ${active ? 'bg-blue-600 text-white shadow-xl' : 'text-slate-400 hover:bg-slate-800'}`}>
    <Icon size={18} /> <span className="font-bold text-sm uppercase tracking-tighter">{label}</span>
  </button>
);

const StatCard = ({ label, value, icon: Icon, color }: any) => {
  const c: any = { blue: 'text-blue-600 bg-blue-50', emerald: 'text-emerald-600 bg-emerald-50', slate: 'text-slate-600 bg-slate-50', rose: 'text-rose-600 bg-rose-50' };
  return (
    <div className="bg-white p-6 lg:p-8 rounded-[2rem] border border-slate-200 shadow-sm transition-all hover:scale-[1.02]">
      <div className={`w-12 h-12 rounded-2xl flex items-center justify-center mb-6 shadow-sm ${c[color]}`}><Icon size={20} /></div>
      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">{label}</p>
      <h3 className="text-2xl font-black text-slate-900">{value}</h3>
    </div>
  );
};

const SupplierInfo = ({ icon: Icon, label, value }: any) => (
  <div className="flex items-start space-x-3">
     <div className="w-7 h-7 rounded-lg bg-slate-50 flex items-center justify-center text-slate-400 shrink-0 mt-0.5"><Icon size={14} /></div>
     <div className="min-w-0 flex-1">
        <p className="text-[9px] font-black text-slate-300 uppercase leading-none mb-1">{label}</p>
        <p className="text-[10px] font-bold text-slate-600 leading-tight truncate">{value}</p>
     </div>
  </div>
);

const UploadView = ({ handleFileUpload, vaultEmail }: any) => (
  <div className="max-w-4xl mx-auto py-12 lg:py-20 text-center">
    <div className="w-20 h-20 bg-blue-600 text-white rounded-[2rem] flex items-center justify-center mx-auto mb-10 shadow-2xl"><Upload size={32} /></div>
    <h2 className="text-3xl lg:text-4xl font-black text-slate-900 uppercase tracking-tighter mb-4">Ingestion Gateway</h2>
    <p className="text-slate-400 font-bold mb-12 text-[10px] lg:text-[11px] uppercase tracking-widest leading-relaxed px-4">Forward PDFs to <span className="text-blue-600 lowercase">{vaultEmail}</span> or upload below.</p>
    <label className="group relative block cursor-pointer px-4">
      <div className="border-4 border-dashed border-slate-200 rounded-[3rem] p-12 lg:p-24 bg-white transition-all group-hover:border-blue-500 group-hover:bg-blue-50">
        <Plus size={32} className="mx-auto text-slate-300 group-hover:text-blue-500 mb-4 transition-transform group-hover:scale-125" />
        <p className="text-slate-400 font-black uppercase text-xs">Drop Invoices Here</p>
      </div>
      <input type="file" className="hidden" onChange={handleFileUpload} accept="application/pdf,image/*" multiple />
    </label>
  </div>
);

export default App;
