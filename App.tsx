import React, { useState, useEffect, useMemo } from 'react';
import { 
  LayoutDashboard, Upload, History, CheckCircle2, Package, Wallet, 
  Trash2, Banknote, X, Menu, ShieldCheck, 
  TriangleAlert, Files, RefreshCcw, LogOut, Plus, 
  Mail, Lock, Building2, Phone, Search, Hash, TrendingUp, TrendingDown, Bell, Clock, FileSpreadsheet, Eye, Undo2
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
import { Invoice, User, Supplier, MasterItem, VaultConfig, PriceHistoryEntry } from './types';

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
  const [activeTab, setActiveTab] = useState<'dashboard' | 'upload' | 'history' | 'paid_history' | 'suppliers' | 'gst' | 'stock' | 'hold' | 'alerts'>('dashboard');
  const [rawInvoices, setRawInvoices] = useState<Invoice[]>([]);
  const [masterItems, setMasterItems] = useState<MasterItem[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [acceptedAlertHistory, setAcceptedAlertHistory] = useState<any[]>([]);
  const [selectedStockItems, setSelectedStockItems] = useState<string[]>([]);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
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

  const deleteMasterItem = (id: string) => {
    if (window.confirm("Remove this item from Master Stock?")) {
      setMasterItems(prev => prev.filter(item => item.id !== id));
      addToast("Item removed from registry", "info");
    }
  };

  const exportStockToCSV = () => {
    if (selectedStockItems.length === 0) return addToast("Select items to export", "warning");
    const itemsToExport = masterItems.filter(item => selectedStockItems.includes(item.id));
    const header = "Name,Supplier,Current Price,Last Updated\n";
    const csvContent = itemsToExport.map(item => 
      `"${item.name}","${item.supplierName}",${item.currentPrice},"${item.lastUpdated}"`
    ).join("\n");
    const blob = new Blob([header + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `Master_Stock_${new Date().toISOString().split('T')[0]}.csv`);
    link.click();
    addToast("Exporting CSV...", "success");
  };

  const toggleInvoicePaid = (id: string) => {
    setRawInvoices(prev => prev.map(inv => inv.id === id ? { ...inv, isPaid: !inv.isPaid, isHold: false } : inv));
    addToast("Payment status updated", "success");
  };

  const toggleInvoiceHold = (id: string) => {
    setRawInvoices(prev => prev.map(inv => inv.id === id ? { ...inv, isHold: !inv.isHold, isPaid: false } : inv));
    addToast("Status updated", "warning");
  };

  const commitPriceChange = (itemId: string, alertData: any) => {
    setMasterItems(prev => prev.map(item => {
      if (item.id === itemId) {
        const newHistory: PriceHistoryEntry = {
          date: alertData.date, price: alertData.newPrice, variance: alertData.amountChange,
          percentChange: alertData.change, source: 'audit', invoiceNumber: alertData.invoiceNumber
        };
        setAcceptedAlertHistory(prevH => [{ ...alertData, acceptedAt: new Date().toISOString() }, ...prevH]);
        return { ...item, currentPrice: alertData.newPrice, history: [newHistory, ...item.history], lastUpdated: alertData.date };
      }
      return item;
    }));
    addToast("Master price updated", "success");
  };

  const enrichedInvoices = useMemo(() => {
    return rawInvoices.map((inv) => {
      const enrichedItems = inv.items.map(item => {
        const master = masterItems.find(m => m.name === item.name && m.supplierName === inv.supplierName);
        if (master && master.currentPrice !== item.unitPrice) {
          const change = item.unitPrice - master.currentPrice;
          return { ...item, previousUnitPrice: master.currentPrice, priceChange: change, percentChange: (change / master.currentPrice) * 100 };
        }
        return item;
      });
      return { ...inv, items: enrichedItems };
    }).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [rawInvoices, masterItems]);

  const activeAlerts = useMemo(() => {
    const alerts: any[] = [];
    enrichedInvoices.forEach(inv => {
      inv.items.forEach(item => {
        if (item.priceChange && Math.abs(item.priceChange) > 0.01) {
          const alreadyAccepted = acceptedAlertHistory.some(h => h.invoiceNumber === inv.invoiceNumber && h.itemName === item.name);
          const newerAcceptedExists = acceptedAlertHistory.some(h => h.itemName === item.name && h.supplier === inv.supplierName && new Date(h.date) > new Date(inv.date));
          if (!alreadyAccepted && !newerAcceptedExists) {
            alerts.push({
              id: `${inv.id}-${item.name}`,
              masterId: masterItems.find(m => m.name === item.name && m.supplierName === inv.supplierName)?.id,
              itemName: item.name, supplier: inv.supplierName, oldPrice: item.previousUnitPrice || 0,
              newPrice: item.unitPrice, change: item.percentChange || 0, amountChange: item.priceChange || 0,
              invoiceNumber: inv.invoiceNumber, date: inv.date
            });
          }
        }
      });
    });
    return alerts;
  }, [enrichedInvoices, acceptedAlertHistory, masterItems]);

  const gstByMonth = useMemo(() => {
    const groups: Record<string, Record<string, number>> = {};
    rawInvoices.forEach(inv => {
      const month = inv.date.substring(0, 7);
      if (!groups[month]) groups[month] = {};
      groups[month][inv.supplierName] = (groups[month][inv.supplierName] || 0) + inv.gstAmount;
    });
    return Object.entries(groups).sort((a, b) => b[0].localeCompare(a[0]));
  }, [rawInvoices]);

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
      totalGst, totalCount: enrichedInvoices.length, supplierCount: suppliers.length 
    };
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
        const data = await extractInvoiceData(base64, file.type || 'application/pdf') as any;
        const newInvoice: Invoice = {
          ...data, id: `inv-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
          isPaid: false, isHold: false, status: 'matched', fileName: file.name, receivedVia: 'upload'
        };
        setSuppliers(prev => {
          const existing = prev.find(s => s.name === data.supplierName);
          const supDetails: Supplier = { 
            id: existing?.id || `sup-${Date.now()}`, name: data.supplierName,
            bankAccount: data.bankAccount || existing?.bankAccount, address: data.address || existing?.address, 
            abn: data.abn || existing?.abn, tel: data.tel || existing?.tel, email: data.email || existing?.email, 
            creditTerm: data.creditTerm || existing?.creditTerm, totalSpent: (existing?.totalSpent || 0) + data.totalAmount
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
                supplierName: data.supplierName, name: item.name, currentPrice: item.unitPrice,
                lastUpdated: data.date,
                history: [{ date: data.date, price: item.unitPrice, variance: 0, percentChange: 0, source: 'audit', invoiceNumber: data.invoiceNumber }]
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
        <div className="w-full max-w-md relative z-10 text-center text-white">
           <div className="w-20 h-20 bg-blue-600 rounded-[2rem] flex items-center justify-center shadow-2xl mb-6 mx-auto"><ShieldCheck size={40} /></div>
           <h1 className="text-4xl font-black uppercase tracking-tighter mb-10">Price Guardian</h1>
           <div className="bg-slate-800/50 backdrop-blur-xl border border-white/10 rounded-[2.5rem] p-10 text-left">
              <div className="flex space-x-2 mb-8 bg-slate-900/50 p-1.5 rounded-2xl">
                 <button onClick={() => setAuthMode('login')} className={`flex-1 py-3 text-[10px] font-black uppercase rounded-xl ${authMode === 'login' ? 'bg-slate-800 text-white' : 'text-slate-500'}`}>Login</button>
                 <button onClick={() => setAuthMode('signup')} className={`flex-1 py-3 text-[10px] font-black uppercase rounded-xl ${authMode === 'signup' ? 'bg-slate-800 text-white' : 'text-slate-500'}`}>Signup</button>
              </div>
              <form onSubmit={handleVaultAccess} className="space-y-6">
                 <div className="relative">
                    <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-600" size={18} />
                    <input type="email" value={loginEmail} onChange={e => setLoginEmail(e.target.value)} required className="w-full bg-slate-900/50 border border-white/5 rounded-2xl py-4 pl-12 text-white text-xs outline-none" placeholder="Email" />
                 </div>
                 <div className="relative">
                    <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-600" size={18} />
                    <input type="password" value={loginPass} onChange={e => setLoginPass(e.target.value)} required className="w-full bg-slate-900/50 border border-white/5 rounded-2xl py-4 pl-12 text-white text-xs outline-none" placeholder="Key" />
                 </div>
                 <button type="submit" className="w-full bg-blue-600 text-white py-5 rounded-2xl font-black uppercase text-xs tracking-widest transition-all hover:bg-blue-500">Enter Vault</button>
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
           <div key={t.id} className={`p-4 rounded-2xl shadow-2xl border flex items-start space-x-3 pointer-events-auto ${t.type === 'success' ? 'bg-emerald-600' : t.type === 'warning' ? 'bg-amber-600' : 'bg-rose-600'} text-white animate-in slide-in-from-top-4`}>
              <div className="flex-1 text-[11px] font-bold uppercase">{t.message}</div>
           </div>
         ))}
      </div>

      <nav className={`fixed lg:sticky lg:top-0 inset-y-0 left-0 w-72 bg-slate-900 text-slate-400 flex flex-col shrink-0 z-[100] transition-transform duration-300 transform ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'} h-screen overflow-y-auto`}>
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
          <NavItem active={activeTab === 'paid_history'} onClick={() => {setActiveTab('paid_history'); setIsSidebarOpen(false)}} icon={CheckCircle2} label="Payment Records" />
          <NavItem active={activeTab === 'hold'} onClick={() => {setActiveTab('hold'); setIsSidebarOpen(false)}} icon={Clock} label="On Hold" />
          <NavItem active={activeTab === 'alerts'} onClick={() => {setActiveTab('alerts'); setIsSidebarOpen(false)}} icon={Bell} label="Price Alert Hub" />
          <NavItem active={activeTab === 'stock'} onClick={() => {setActiveTab('stock'); setIsSidebarOpen(false)}} icon={Package} label="Master Stock" />
          <NavItem active={activeTab === 'suppliers'} onClick={() => {setActiveTab('suppliers'); setIsSidebarOpen(false)}} icon={Building2} label="Vendors" />
          <NavItem active={activeTab === 'gst'} onClick={() => {setActiveTab('gst'); setIsSidebarOpen(false)}} icon={Banknote} label="GST Ledger" />
        </div>
        <div className="p-6 mt-auto">
           <button onClick={handleLogout} className="w-full flex items-center justify-center space-x-2 py-3 bg-slate-800 hover:bg-rose-900 text-slate-500 hover:text-white rounded-xl text-[10px] font-black uppercase transition-colors">
              <LogOut size={14} /> <span>Lock Vault</span>
           </button>
        </div>
      </nav>

      <main className="flex-1 p-4 lg:p-10 max-w-full overflow-x-hidden min-h-screen">
        <header className="flex lg:hidden items-center justify-between mb-6 bg-white p-4 rounded-2xl shadow-sm">
           <div className="flex items-center space-x-3">
              <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white"><ShieldCheck size={18} /></div>
              <span className="font-black text-slate-900 uppercase">Guardian</span>
           </div>
           <button onClick={() => setIsSidebarOpen(true)} className="p-2 bg-slate-100 rounded-lg text-slate-600"><Menu size={20} /></button>
        </header>

        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
           <h1 className="text-2xl lg:text-3xl font-black text-slate-900 uppercase tracking-tighter">{activeTab.replace('_', ' ')}</h1>
           {activeAlerts.length > 0 && (
              <div onClick={() => setActiveTab('alerts')} className="bg-rose-50 border border-rose-200 px-4 py-2 rounded-xl flex items-center space-x-3 animate-pulse cursor-pointer">
                <TriangleAlert size={16} className="text-rose-600" />
                <span className="text-[10px] font-black uppercase text-rose-700">{activeAlerts.length} Price Shifts</span>
              </div>
           )}
        </div>

        <div className="space-y-8">
          {activeTab === 'dashboard' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-1 space-y-6">
                <StatCard label="Total Outstanding" value={`$${stats.totalPayable.toFixed(2)}`} icon={Wallet} color="blue" />
                <div className="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm">
                  <h4 className="text-[10px] font-black uppercase text-slate-400 mb-4 tracking-widest">Outstanding by Supplier</h4>
                  <div className="space-y-3 max-h-[400px] overflow-y-auto custom-scrollbar">
                    {stats.payableBySupplier.map(([name, amount]) => (
                      <div key={name} className="flex justify-between items-center py-3 border-b border-slate-50 last:border-0">
                        <span className="text-[10px] font-bold text-slate-700 truncate mr-2">{name}</span>
                        <span className="text-[11px] font-black text-slate-900">${(amount as number).toFixed(2)}</span>
                      </div>
                    ))}
                    {stats.payableBySupplier.length === 0 && <p className="text-[10px] font-bold text-slate-400 text-center py-6">No outstanding balances</p>}
                  </div>
                </div>
              </div>
              <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4 auto-rows-min">
                <StatCard label="Total Audits" value={stats.totalCount} icon={Files} color="slate" />
                <StatCard label="GST (YTD)" value={`$${stats.totalGst.toFixed(2)}`} icon={Banknote} color="emerald" />
                <StatCard label="Active Vendors" value={stats.supplierCount} icon={Building2} color="blue" />
                <StatCard label="Active Alerts" value={activeAlerts.length} icon={Bell} color="rose" />
                
                <div className="sm:col-span-2 bg-slate-900 rounded-[2rem] p-8 text-white">
                  <h3 className="font-black text-xs uppercase mb-6 flex items-center"><Bell size={18} className="mr-3 text-rose-500" /> Price Variance Preview</h3>
                  <div className="space-y-4">
                    {activeAlerts.slice(0, 3).map(alert => (
                      <div key={alert.id} className="flex justify-between items-center p-4 bg-white/5 rounded-2xl">
                        <div>
                          <p className="text-[9px] font-black text-slate-500 uppercase">{alert.supplier}</p>
                          <h4 className="text-[10px] font-black uppercase truncate max-w-[150px]">{alert.itemName}</h4>
                        </div>
                        <div className="text-right">
                          <p className={`text-xs font-black ${alert.change > 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                            {alert.change > 0 ? '+' : ''}{alert.change.toFixed(1)}%
                          </p>
                          <button onClick={() => setActiveTab('alerts')} className="text-[9px] font-black uppercase text-blue-400 mt-1">View Hub</button>
                        </div>
                      </div>
                    ))}
                    {activeAlerts.length === 0 && <p className="text-[10px] font-bold text-slate-500 text-center py-4 uppercase">All prices optimized</p>}
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'upload' && <UploadView handleFileUpload={handleFileUpload} loading={loading} progress={uploadProgress} vaultEmail={vault.inboundEmail} />}

          {activeTab === 'alerts' && (
            <div className="space-y-10">
              <div className="bg-slate-900 rounded-[2.5rem] p-10 text-white shadow-2xl overflow-hidden relative">
                <h3 className="font-black uppercase text-sm tracking-widest flex items-center mb-10 text-rose-400"><Bell size={24} className="mr-4" /> Live Price Alert Hub</h3>
                {activeAlerts.length > 0 ? (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {activeAlerts.map(alert => (
                      <div key={alert.id} className="flex flex-col p-8 bg-white/5 rounded-[2rem] border border-white/10 hover:border-rose-500/50 transition-all">
                        <div className="flex justify-between items-start mb-6">
                          <div>
                            <p className="text-[10px] font-black text-slate-500 uppercase mb-1">{alert.supplier}</p>
                            <h4 className="font-black text-white text-lg uppercase leading-tight">{alert.itemName}</h4>
                            <p className="text-[10px] font-bold text-slate-500 mt-2 uppercase">INV: {alert.invoiceNumber} • {alert.date}</p>
                          </div>
                          <div className={`px-4 py-2 rounded-xl text-[11px] font-black uppercase ${alert.change > 0 ? 'bg-rose-500/20 text-rose-400' : 'bg-emerald-500/20 text-emerald-400'}`}>
                            {alert.change > 0 ? '+' : ''}{alert.change.toFixed(1)}%
                          </div>
                        </div>
                        <div className="grid grid-cols-3 gap-4 mb-8">
                          <div className="bg-black/20 p-4 rounded-2xl text-center">
                            <p className="text-[9px] font-black text-slate-500 uppercase mb-1">Current</p>
                            <p className="font-black text-white text-sm">${alert.oldPrice.toFixed(2)}</p>
                          </div>
                          <div className="bg-black/20 p-4 rounded-2xl text-center">
                            <p className="text-[9px] font-black text-slate-500 uppercase mb-1">New</p>
                            <p className="font-black text-white text-sm">${alert.newPrice.toFixed(2)}</p>
                          </div>
                          <div className="bg-black/20 p-4 rounded-2xl text-center">
                            <p className="text-[9px] font-black text-slate-500 uppercase mb-1">Difference</p>
                            <p className={`font-black text-sm ${alert.change > 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                              {alert.change > 0 ? '+' : ''}${Math.abs(alert.amountChange).toFixed(2)}
                            </p>
                          </div>
                        </div>
                        <button onClick={() => handleAcceptPrice(alert)} className="w-full bg-blue-600 hover:bg-emerald-600 text-white py-4 rounded-2xl text-[11px] font-black uppercase transition-all flex items-center justify-center space-x-3">
                          <CheckCircle2 size={18} /> <span>Accept Price Shift</span>
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="py-24 text-center">
                    <ShieldCheck size={64} className="mx-auto text-emerald-500/50 mb-6" />
                    <h4 className="font-black text-white uppercase">All Prices Optimized</h4>
                  </div>
                )}
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
                           <th className="px-6 py-5 text-center">Process</th>
                           <th className="px-6 py-5 text-center">Actions</th>
                        </tr>
                     </thead>
                     <tbody className="divide-y divide-slate-100">
                        {enrichedInvoices.filter(i => !i.isPaid && !i.isHold).map(inv => (
                          <tr key={inv.id} className="hover:bg-slate-50 transition-colors">
                            <td className="px-6 py-6 font-bold text-slate-500 text-[10px]">{inv.date}</td>
                            <td className="px-6 py-6 font-black text-slate-900 text-xs uppercase">{inv.supplierName}</td>
                            <td className="px-6 py-6 font-bold text-slate-400 text-xs">{inv.invoiceNumber}</td>
                            <td className="px-6 py-6 text-right font-black text-slate-900 text-xs">${inv.totalAmount.toFixed(2)}</td>
                            <td className="px-6 py-6 text-center">
                               <div className="flex items-center justify-center space-x-2">
                                  <button onClick={() => toggleInvoicePaid(inv.id)} className="px-3 py-1.5 rounded-lg text-[9px] font-black uppercase bg-white text-emerald-600 border border-emerald-200 hover:bg-emerald-600 hover:text-white transition-all">Settle</button>
                                  <button onClick={() => toggleInvoiceHold(inv.id)} className="px-3 py-1.5 rounded-lg text-[9px] font-black uppercase border border-slate-200 bg-white text-slate-400 hover:text-rose-600 transition-all">Hold</button>
                               </div>
                            </td>
                            <td className="px-6 py-6 text-center">
                               <div className="flex items-center justify-center space-x-2">
                                 <button onClick={() => setSelectedInvoice(inv)} className="p-2 text-slate-400 hover:text-blue-600 transition-colors"><Eye size={16} /></button>
                                 <button onClick={() => deleteInvoice(inv.id)} className="p-2 text-slate-300 hover:text-rose-600 transition-colors"><Trash2 size={16} /></button>
                               </div>
                            </td>
                          </tr>
                        ))}
                        {enrichedInvoices.filter(i => !i.isPaid && !i.isHold).length === 0 && (
                          <tr><td colSpan={6} className="px-6 py-20 text-center uppercase font-black text-slate-400 text-[10px]">No pending audits</td></tr>
                        )}
                     </tbody>
                  </table>
               </div>
            </div>
          )}

          {activeTab === 'paid_history' && (
            <div className="bg-white rounded-[2rem] border border-slate-200 shadow-sm overflow-hidden">
               <div className="overflow-x-auto custom-scrollbar">
                  <table className="w-full text-left min-w-[900px]">
                     <thead>
                        <tr className="bg-slate-50 border-b text-[10px] font-black uppercase text-slate-400">
                           <th className="px-6 py-5">Date</th>
                           <th className="px-6 py-5">Vendor</th>
                           <th className="px-6 py-5">Inv #</th>
                           <th className="px-6 py-5 text-right">Settled Amount</th>
                           <th className="px-6 py-5 text-center">Reverse</th>
                           <th className="px-6 py-5 text-center">Actions</th>
                        </tr>
                     </thead>
                     <tbody className="divide-y divide-slate-100">
                        {enrichedInvoices.filter(i => i.isPaid).map(inv => (
                          <tr key={inv.id} className="hover:bg-slate-50 transition-colors">
                            <td className="px-6 py-6 font-bold text-slate-500 text-[10px]">{inv.date}</td>
                            <td className="px-6 py-6 font-black text-slate-900 text-xs uppercase">{inv.supplierName}</td>
                            <td className="px-6 py-6 font-bold text-slate-400 text-xs">{inv.invoiceNumber}</td>
                            <td className="px-6 py-6 text-right font-black text-emerald-600 text-xs">${inv.totalAmount.toFixed(2)}</td>
                            <td className="px-6 py-6 text-center">
                               <button onClick={() => toggleInvoicePaid(inv.id)} className="px-3 py-1.5 rounded-lg text-[9px] font-black uppercase border border-slate-200 bg-white text-slate-400 hover:bg-slate-900 hover:text-white transition-all flex items-center justify-center space-x-1 mx-auto">
                                 <Undo2 size={12} /> <span>Back to Audit</span>
                               </button>
                            </td>
                            <td className="px-6 py-6 text-center">
                               <div className="flex items-center justify-center space-x-2">
                                 <button onClick={() => setSelectedInvoice(inv)} className="p-2 text-slate-400 hover:text-blue-600 transition-colors"><Eye size={16} /></button>
                                 <button onClick={() => deleteInvoice(inv.id)} className="p-2 text-slate-300 hover:text-rose-600 transition-colors"><Trash2 size={16} /></button>
                               </div>
                            </td>
                          </tr>
                        ))}
                        {enrichedInvoices.filter(i => i.isPaid).length === 0 && (
                          <tr><td colSpan={6} className="px-6 py-20 text-center uppercase font-black text-slate-400 text-[10px]">No payment records found</td></tr>
                        )}
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
                           <th className="px-6 py-5">Date</th>
                           <th className="px-6 py-5">Vendor</th>
                           <th className="px-6 py-5 text-right">Amount</th>
                           <th className="px-6 py-5 text-center">Action</th>
                        </tr>
                     </thead>
                     <tbody className="divide-y divide-slate-100">
                        {enrichedInvoices.filter(i => i.isHold).map(inv => (
                          <tr key={inv.id} className="hover:bg-slate-50 transition-colors">
                            <td className="px-6 py-6 font-bold text-slate-500 text-[10px]">{inv.date}</td>
                            <td className="px-6 py-6 font-black text-slate-900 text-xs uppercase">{inv.supplierName}</td>
                            <td className="px-6 py-6 text-right font-black text-rose-600 text-xs">${inv.totalAmount.toFixed(2)}</td>
                            <td className="px-6 py-6 text-center">
                               <button onClick={() => toggleInvoiceHold(inv.id)} className="px-4 py-2 bg-slate-900 text-white rounded-xl text-[9px] font-black uppercase hover:bg-blue-600 transition-all">Release to Audit</button>
                            </td>
                          </tr>
                        ))}
                        {enrichedInvoices.filter(i => i.isHold).length === 0 && (
                           <tr><td colSpan={4} className="px-6 py-20 text-center"><p className="text-[10px] font-black uppercase text-slate-400">No invoices on hold.</p></td></tr>
                        )}
                     </tbody>
                  </table>
               </div>
            </div>
          )}

          {activeTab === 'stock' && (
            <div className="bg-white rounded-[2rem] border border-slate-200 shadow-sm overflow-hidden">
               <div className="p-6 border-b flex items-center justify-between">
                  <div className="relative w-full max-w-md">
                     <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                     <input type="text" placeholder="Search Master Stock..." className="w-full bg-slate-50 border-none rounded-2xl py-3 pl-12 text-xs font-bold outline-none" />
                  </div>
                  <button onClick={exportStockToCSV} disabled={selectedStockItems.length === 0} className={`flex items-center space-x-2 px-6 py-3 rounded-2xl text-[10px] font-black uppercase transition-all ${selectedStockItems.length > 0 ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-400 cursor-not-allowed'}`}><FileSpreadsheet size={16} /> <span>CSV ({selectedStockItems.length})</span></button>
               </div>
               <div className="overflow-x-auto custom-scrollbar">
                  <table className="w-full text-left min-w-[1000px]">
                     <thead>
                        <tr className="bg-slate-50 border-b text-[10px] font-black uppercase text-slate-400">
                           <th className="px-6 py-5 w-10"><input type="checkbox" checked={selectedStockItems.length === masterItems.length && masterItems.length > 0} onChange={(e) => e.target.checked ? setSelectedStockItems(masterItems.map(m => m.id)) : setSelectedStockItems([])} className="rounded" /></th>
                           <th className="px-6 py-5">Product Name</th>
                           <th className="px-6 py-5">Supplier</th>
                           <th className="px-6 py-5 text-right">Anchored Rate</th>
                           <th className="px-6 py-5 text-right">Last Updated</th>
                           <th className="px-6 py-5 text-center">Actions</th>
                        </tr>
                     </thead>
                     <tbody className="divide-y divide-slate-100">
                        {masterItems.map(item => (
                          <tr key={item.id} className="hover:bg-slate-50 transition-colors">
                            <td className="px-6 py-6"><input type="checkbox" checked={selectedStockItems.includes(item.id)} onChange={() => selectedStockItems.includes(item.id) ? setSelectedStockItems(prev => prev.filter(i => i !== item.id)) : setSelectedStockItems(prev => [...prev, item.id])} className="rounded" /></td>
                            <td className="px-6 py-6 font-black text-slate-900 text-xs uppercase">{item.name}</td>
                            <td className="px-6 py-6 font-bold text-slate-400 text-[10px] uppercase">{item.supplierName}</td>
                            <td className="px-6 py-6 text-right font-black text-slate-900 text-xs">${item.currentPrice.toFixed(2)}</td>
                            <td className="px-6 py-6 text-right font-bold text-slate-500 text-xs">{item.lastUpdated}</td>
                            <td className="px-6 py-6 text-center"><button onClick={() => deleteMasterItem(item.id)} className="p-2 text-slate-300 hover:text-rose-600 transition-colors"><Trash2 size={16} /></button></td>
                          </tr>
                        ))}
                     </tbody>
                  </table>
               </div>
            </div>
          )}

          {activeTab === 'suppliers' && (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
               {suppliers.map(sup => {
                 const outstanding = rawInvoices.filter(inv => inv.supplierName === sup.name && !inv.isPaid && !inv.isHold).reduce((sum, inv) => sum + inv.totalAmount, 0);
                 return (
                  <div key={sup.id} className="bg-white rounded-[2rem] border border-slate-200 shadow-sm p-8 space-y-6 hover:shadow-lg transition-all group">
                      <div className="flex items-start justify-between">
                        <div className="flex items-center space-x-4">
                            <div className="w-12 h-12 bg-blue-50 rounded-2xl flex items-center justify-center text-blue-600 group-hover:bg-blue-600 group-hover:text-white transition-colors"><Building2 size={24} /></div>
                            <div>
                                <h3 className="font-black text-slate-900 uppercase text-sm tracking-tight">{sup.name}</h3>
                                <p className="text-[10px] font-black text-blue-600 uppercase tracking-widest mt-1">Vendor Intelligence</p>
                            </div>
                        </div>
                        {outstanding > 0 && <div className="bg-amber-50 text-amber-600 px-3 py-1 rounded-full text-[9px] font-black uppercase">Outstanding</div>}
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="bg-slate-50 p-4 rounded-2xl">
                            <p className="text-[9px] font-black text-slate-400 uppercase mb-1">Total Volume</p>
                            <p className="font-black text-slate-900 text-xs">${sup.totalSpent.toLocaleString()}</p>
                        </div>
                        <div className="bg-slate-50 p-4 rounded-2xl">
                            <p className="text-[9px] font-black text-slate-400 uppercase mb-1">Outstanding</p>
                            <p className={`font-black text-xs ${outstanding > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>${outstanding.toFixed(2)}</p>
                        </div>
                      </div>
                      <div className="space-y-3 pt-2">
                        <SupplierInfo icon={Hash} label="ABN" value={sup.abn || 'Not found'} />
                        <SupplierInfo icon={Phone} label="Contact" value={sup.tel || 'Not found'} />
                        <SupplierInfo icon={Mail} label="Email" value={sup.email || 'Not found'} />
                        <SupplierInfo icon={Lock} label="Bank Details" value={sup.bankAccount || 'EFT Details Missing'} />
                      </div>
                      <div className="pt-4 border-t border-slate-100">
                        <p className="text-[9px] font-black text-slate-400 uppercase mb-2">Registered Address</p>
                        <p className="text-[10px] font-bold text-slate-600 leading-relaxed italic">{sup.address || 'Address information not extracted'}</p>
                      </div>
                  </div>
                 );
               })}
            </div>
          )}

          {activeTab === 'gst' && (
            <div className="space-y-6">
              <div className="bg-slate-900 rounded-[2.5rem] p-10 text-white mb-8">
                <div className="flex items-center space-x-4 mb-4"><Banknote className="text-emerald-500" size={32} /><h3 className="text-2xl font-black uppercase tracking-tighter">GST Compliance Ledger</h3></div>
                <p className="text-slate-400 text-xs font-bold uppercase tracking-widest">Organized monthly tax audit records.</p>
              </div>
              {gstByMonth.map(([month, supplierGstMap]) => {
                  const monthlyTotal = Object.values(supplierGstMap).reduce((a, b) => (a as number) + (b as number), 0);
                  const displayDate = new Date(month + "-02").toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
                  return (
                    <div key={month} className="bg-white rounded-[2rem] border border-slate-200 shadow-sm overflow-hidden mb-8">
                      <div className="px-8 py-6 bg-slate-50 border-b flex justify-between items-center">
                        <div className="flex items-center space-x-3"><Clock size={18} className="text-slate-400" /><h4 className="font-black text-slate-900 uppercase text-sm tracking-tight">{displayDate}</h4></div>
                        <div className="bg-emerald-600 text-white px-4 py-1.5 rounded-xl text-[10px] font-black shadow-lg shadow-emerald-600/20">Claimable: ${(monthlyTotal as number).toFixed(2)}</div>
                      </div>
                      <div className="p-8"><div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">{Object.entries(supplierGstMap).map(([name, amount]) => (<div key={name} className="flex flex-col p-5 bg-slate-50 rounded-2xl border border-slate-100 hover:border-slate-200 transition-all"><p className="text-[9px] font-black text-slate-400 uppercase mb-2 truncate">{name}</p><div className="flex justify-between items-end"><span className="font-black text-slate-900 text-lg">${(amount as number).toFixed(2)}</span><span className="text-[9px] font-black text-emerald-600 uppercase tracking-widest">Input Credit</span></div></div>))}</div></div>
                    </div>
                  );
                })}
            </div>
          )}
        </div>
      </main>

      {selectedInvoice && (
        <div className="fixed inset-0 z-[1000] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-2xl rounded-[2.5rem] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col max-h-[90vh]">
             <div className="p-8 bg-slate-900 text-white flex justify-between items-start shrink-0">
                <div>
                   <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Audit Details</p>
                   <h2 className="text-2xl font-black uppercase tracking-tighter">{selectedInvoice.supplierName}</h2>
                   <p className="text-xs font-bold text-blue-400 mt-1">Invoice #{selectedInvoice.invoiceNumber} • {selectedInvoice.date}</p>
                </div>
                <button onClick={() => setSelectedInvoice(null)} className="p-2 bg-white/10 rounded-xl hover:bg-white/20 transition-all"><X size={20} /></button>
             </div>
             <div className="p-8 overflow-y-auto custom-scrollbar flex-1 space-y-8">
                <div className="grid grid-cols-2 gap-4">
                   <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                      <p className="text-[9px] font-black text-slate-400 uppercase mb-1">Total Amount</p>
                      <p className="font-black text-xl text-slate-900">${selectedInvoice.totalAmount.toFixed(2)}</p>
                   </div>
                   <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                      <p className="text-[9px] font-black text-slate-400 uppercase mb-1">GST Included</p>
                      <p className="font-black text-xl text-emerald-600">${selectedInvoice.gstAmount.toFixed(2)}</p>
                   </div>
                </div>
                <div>
                   <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">Audited Line Items</h4>
                   <div className="space-y-2">
                      {selectedInvoice.items.map((item, idx) => (
                         <div key={idx} className="flex justify-between items-center p-4 bg-slate-50 rounded-xl border border-slate-100 hover:border-slate-200 transition-all">
                            <div>
                               <p className="text-[11px] font-black text-slate-900 uppercase">{item.name}</p>
                               <p className="text-[9px] font-bold text-slate-400 uppercase">{item.quantity} units @ ${item.unitPrice.toFixed(2)}</p>
                            </div>
                            <div className="text-right">
                               <p className="text-[11px] font-black text-slate-900">${item.total.toFixed(2)}</p>
                               {item.priceChange !== undefined && item.priceChange !== 0 && (
                                  <p className={`text-[9px] font-black uppercase ${item.priceChange > 0 ? 'text-rose-500' : 'text-emerald-500'}`}>{item.priceChange > 0 ? 'Increase' : 'Decrease'}</p>
                               )}
                            </div>
                         </div>
                      ))}
                   </div>
                </div>
                <div className="pt-6 border-t border-slate-100">
                   <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">Vendor Intelligence</h4>
                   <div className="grid grid-cols-2 gap-x-8 gap-y-4">
                      <SupplierInfo icon={Hash} label="ABN" value={selectedInvoice.abn || 'Not found'} />
                      <SupplierInfo icon={Phone} label="Contact" value={selectedInvoice.tel || 'Not found'} />
                      <SupplierInfo icon={Mail} label="Email" value={selectedInvoice.email || 'Not found'} />
                      <SupplierInfo icon={Lock} label="Banking" value={selectedInvoice.bankAccount || 'EFT Details Missing'} />
                      <div className="col-span-2 mt-2">
                         <SupplierInfo icon={MapPin} label="Audited Address" value={selectedInvoice.address || 'No physical address found'} />
                      </div>
                   </div>
                </div>
             </div>
             <div className="p-8 bg-slate-50 border-t border-slate-100 shrink-0">
                <button onClick={() => setSelectedInvoice(null)} className="w-full py-4 bg-slate-900 text-white rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-slate-800 transition-all">Close Viewer</button>
             </div>
          </div>
        </div>
      )}

      {loading && (
        <div className="fixed inset-0 z-[500] bg-slate-900/95 backdrop-blur-md flex flex-col items-center justify-center text-white p-6">
           <div className="w-16 h-16 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-8" />
           <p className="text-xl font-black uppercase tracking-tighter animate-pulse">{uploadProgress}</p>
        </div>
      )}
    </div>
  );
};

const MapPin = ({ size, className }: any) => <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>;

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
  <div className="max-w-4xl mx-auto py-20 text-center">
    <div className="w-20 h-20 bg-blue-600 text-white rounded-[2rem] flex items-center justify-center mx-auto mb-10 shadow-2xl"><Upload size={32} /></div>
    <h2 className="text-4xl font-black text-slate-900 uppercase tracking-tighter mb-4">Ingestion Gateway</h2>
    <p className="text-slate-400 font-bold mb-12 text-[11px] uppercase tracking-widest leading-relaxed">Forward PDFs to <span className="text-blue-600 lowercase">{vaultEmail}</span> or upload below.</p>
    <label className="group relative block cursor-pointer px-4">
      <div className="border-4 border-dashed border-slate-200 rounded-[3rem] p-24 bg-white transition-all group-hover:border-blue-500 group-hover:bg-blue-50">
        <Plus size={32} className="mx-auto text-slate-300 group-hover:text-blue-500 mb-4 transition-transform group-hover:scale-125" />
        <p className="text-slate-400 font-black uppercase text-xs">Drop Invoices Here</p>
      </div>
      <input type="file" className="hidden" onChange={handleFileUpload} accept="application/pdf,image/*" multiple />
    </label>
  </div>
);

export default App;