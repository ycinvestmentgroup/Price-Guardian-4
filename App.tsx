import React, { useState, useEffect, useMemo } from 'react';
import { 
  LayoutDashboard, Upload, History, CheckCircle2, Package, Wallet, 
  Trash2, Banknote, X, Menu, ShieldCheck, 
  TriangleAlert, Files, RefreshCcw, LogOut, Plus, 
  Mail, Lock, Building2, Phone, Search, Hash, TrendingUp, TrendingDown, Bell, Clock, FileSpreadsheet, Eye, Undo2, MapPin
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
    vaultId: 'VLT-' + Math.random().toString(36).substring(2, 8).toUpperCase(),
    inboundEmail: 'audit-vlt@priceguardian.ai',
    isCloudSyncEnabled: true
  });

  // UI States
  const [dataLoaded, setDataLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string>('');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);

  const resetLocalData = () => {
    setRawInvoices([]);
    setMasterItems([]);
    setSuppliers([]);
    setAcceptedAlertHistory([]);
    setSelectedStockItems([]);
    setSelectedInvoice(null);
    setDataLoaded(false);
  };

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
        } else {
          resetLocalData();
        }

        setCurrentUser({
          id: fbUser.uid,
          name: fbUser.email?.split('@')[0].toUpperCase() || 'USER',
          email: fbUser.email || '',
          role: 'Admin',
          organization: 'Price Guardian Private Vault',
          lastLogin: new Date().toISOString(),
          is2FAEnabled: false
        });
        
        setDataLoaded(true);
      } else {
        setCurrentUser(null);
        resetLocalData();
      }
      setIsAuthenticating(false);
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (auth.currentUser && dataLoaded) {
      const syncToCloud = async () => {
        setIsSyncing(true);
        try {
          const docRef = doc(db, "users", auth.currentUser!.uid);
          
          // Fix for "Unsupported field value: undefined"
          const sanitize = (val: any): any => {
            if (val === undefined) return null;
            if (val === null) return null;
            if (Array.isArray(val)) return val.map(sanitize);
            if (typeof val === 'object') {
              const cleaned: any = {};
              for (const key in val) {
                cleaned[key] = sanitize(val[key]);
              }
              return cleaned;
            }
            return val;
          };

          const payload = sanitize({
            invoices: rawInvoices,
            masterItems: masterItems,
            suppliers: suppliers,
            acceptedAlertHistory: acceptedAlertHistory,
            vault: vault,
            lastSynced: new Date().toISOString()
          });

          await setDoc(docRef, payload, { merge: true });
        } catch (err) {
          console.error("Firestore Sync Error:", err);
        } finally {
          setTimeout(() => setIsSyncing(false), 800);
        }
      };
      const debounceTimer = setTimeout(syncToCloud, 2000);
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
    try {
      if (authMode === 'login') {
        await signInWithEmailAndPassword(auth, loginEmail, loginPass);
      } else {
        resetLocalData();
        await createUserWithEmailAndPassword(auth, loginEmail, loginPass);
      }
    } catch (err: any) {
      addToast(`Access Error: ${err.message}`, "error");
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      resetLocalData();
    } catch (err) {
      addToast("Error locking vault.", "error");
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;
    setLoading(true);
    setUploadProgress('Analyzing document with Gemini AI...');
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const reader = new FileReader();
        const base64Promise = new Promise<string>((resolve) => {
          reader.onload = () => resolve((reader.result as string).split(',')[1]);
          reader.readAsDataURL(file);
        });
        const base64Data = await base64Promise;
        const extractedData = await extractInvoiceData(base64Data, file.type);
        
        const newInvoice: Invoice = {
          ...extractedData,
          id: Math.random().toString(36).substring(2, 9),
          fileName: file.name,
          isPaid: false,
          isHold: false,
          receivedVia: 'upload',
          status: 'matched',
          gstAmount: extractedData.gstAmount || 0,
          bankAccount: extractedData.bankAccount || '',
          creditTerm: extractedData.creditTerm || '',
          address: extractedData.address || '',
          abn: extractedData.abn || '',
          tel: extractedData.tel || '',
          email: extractedData.email || '',
          dueDate: extractedData.dueDate || extractedData.date
        };

        setRawInvoices(prev => [newInvoice, ...prev]);
        setSuppliers(prev => {
          const exists = prev.find(s => s.name === newInvoice.supplierName);
          if (exists) {
            return prev.map(s => s.name === newInvoice.supplierName ? { 
              ...s, 
              totalSpent: s.totalSpent + newInvoice.totalAmount,
              abn: extractedData.abn || s.abn || '',
              email: extractedData.email || s.email || '',
              address: extractedData.address || s.address || '',
              tel: extractedData.tel || s.tel || '',
              bankAccount: extractedData.bankAccount || s.bankAccount || ''
            } : s);
          }
          return [...prev, {
            id: Math.random().toString(36).substring(2, 9),
            name: newInvoice.supplierName,
            totalSpent: newInvoice.totalAmount,
            abn: extractedData.abn || '',
            email: extractedData.email || '',
            address: extractedData.address || '',
            tel: extractedData.tel || '',
            bankAccount: extractedData.bankAccount || '',
            creditTerm: extractedData.creditTerm || ''
          }];
        });

        setMasterItems(prev => {
          let updated = [...prev];
          newInvoice.items.forEach(item => {
            const masterIdx = updated.findIndex(m => m.name === item.name && m.supplierName === newInvoice.supplierName);
            if (masterIdx === -1) {
              updated.push({
                id: Math.random().toString(36).substring(2, 9),
                supplierName: newInvoice.supplierName,
                name: item.name,
                currentPrice: item.unitPrice,
                lastUpdated: newInvoice.date,
                history: [{ 
                  date: newInvoice.date, 
                  price: item.unitPrice, 
                  variance: 0, 
                  percentChange: 0, 
                  source: 'audit', 
                  invoiceNumber: newInvoice.invoiceNumber 
                }]
              });
            }
          });
          return updated;
        });
      }
      addToast("Audited and verified.", "success");
      setActiveTab('history');
    } catch (err: any) {
      addToast(`Audit Failed: ${err.message}`, "error");
    } finally {
      setLoading(false);
      setUploadProgress('');
    }
  };

  const handleAcceptPrice = (alert: any) => {
    setMasterItems(prev => prev.map(item => {
      if (item.id === alert.masterId) {
        const newHistory: PriceHistoryEntry = {
          date: alert.date, price: alert.newPrice, variance: alert.amountChange,
          percentChange: alert.change, source: 'audit', invoiceNumber: alert.invoiceNumber
        };
        // Record the shift in the global history
        setAcceptedAlertHistory(prevH => [{ 
          ...alert, 
          acceptedAt: new Date().toISOString() 
        }, ...prevH]);
        return { ...item, currentPrice: alert.newPrice, history: [newHistory, ...item.history], lastUpdated: alert.date };
      }
      return item;
    }));
    addToast("Price Anchor Updated.", "success");
  };

  const deleteInvoice = (id: string) => {
    if (window.confirm("Delete this invoice permanently?")) {
      setRawInvoices(prev => prev.filter(inv => inv.id !== id));
      addToast("Invoice removed.", "info");
    }
  };

  const deleteMasterItem = (id: string) => {
    if (window.confirm("Remove this item?")) {
      setMasterItems(prev => prev.filter(item => item.id !== id));
      addToast("Registry entry removed.", "info");
    }
  };

  const exportStockToCSV = () => {
    if (selectedStockItems.length === 0) return;
    const itemsToExport = masterItems.filter(item => selectedStockItems.includes(item.id));
    const header = "Name,Supplier,Current Price,Last Updated\n";
    const csvContent = itemsToExport.map(item => `"${item.name}","${item.supplierName}",${item.currentPrice},"${item.lastUpdated}"`).join("\n");
    const blob = new Blob([header + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `Stock_Export_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
  };

  const toggleInvoicePaid = (id: string) => {
    setRawInvoices(prev => prev.map(inv => inv.id === id ? { ...inv, isPaid: !inv.isPaid, isHold: false } : inv));
  };

  const toggleInvoiceHold = (id: string) => {
    setRawInvoices(prev => prev.map(inv => inv.id === id ? { ...inv, isHold: !inv.isHold, isPaid: false } : inv));
  };

  const enrichedInvoices = useMemo(() => {
    return rawInvoices.map((inv) => {
      const enrichedItems = inv.items.map(item => {
        const master = masterItems.find(m => m.name === item.name && m.supplierName === inv.supplierName);
        if (master && Math.abs(master.currentPrice - item.unitPrice) > 0.001) {
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
            const master = masterItems.find(m => m.name === item.name && m.supplierName === inv.supplierName);
            if (master) {
              alerts.push({
                id: `${inv.id}-${item.name}`,
                masterId: master.id,
                itemName: item.name, supplier: inv.supplierName, oldPrice: item.previousUnitPrice || 0,
                newPrice: item.unitPrice, change: item.percentChange || 0, amountChange: item.priceChange || 0,
                invoiceNumber: inv.invoiceNumber, date: inv.date
              });
            }
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
      groups[month][inv.supplierName] = (groups[month][inv.supplierName] || 0) + (inv.gstAmount || 0);
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
    const totalGst = enrichedInvoices.reduce((sum, i) => sum + (i.gstAmount || 0), 0);
    return { 
      totalPayable, 
      payableBySupplier: Object.entries(payableBySupplier).sort((a, b) => (b[1] as number) - (a[1] as number)),
      totalGst, totalCount: enrichedInvoices.length, supplierCount: suppliers.length 
    };
  }, [enrichedInvoices, suppliers]);

  return (
    <div className="min-h-screen flex bg-slate-50 font-sans text-slate-900 relative">
      <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[1000] space-y-2 w-full max-w-md px-4 pointer-events-none">
         {toasts.map(t => (
           <div key={t.id} className={`p-4 rounded-2xl shadow-2xl border flex items-start space-x-3 pointer-events-auto ${t.type === 'success' ? 'bg-emerald-600' : t.type === 'warning' ? 'bg-amber-600' : 'bg-rose-600'} text-white animate-in slide-in-from-top-4`}>
              <div className="flex-1 text-[11px] font-bold uppercase">{t.message}</div>
           </div>
         ))}
      </div>

      {!currentUser ? (
        <div className="min-h-screen w-full bg-slate-900 flex items-center justify-center p-6 text-center">
          <div className="w-full max-w-md text-white">
             <div className="w-20 h-20 bg-blue-600 rounded-[2rem] flex items-center justify-center shadow-2xl mb-6 mx-auto"><ShieldCheck size={40} /></div>
             <h1 className="text-4xl font-black uppercase tracking-tighter mb-10">Price Guardian</h1>
             <div className="bg-slate-800/50 backdrop-blur-xl border border-white/10 rounded-[2.5rem] p-10 text-left shadow-2xl">
                <div className="flex space-x-2 mb-8 bg-slate-900/50 p-1.5 rounded-2xl">
                   <button onClick={() => setAuthMode('login')} className={`flex-1 py-3 text-[10px] font-black uppercase rounded-xl transition-all ${authMode === 'login' ? 'bg-slate-800 text-white shadow-lg' : 'text-slate-500'}`}>Login</button>
                   <button onClick={() => setAuthMode('signup')} className={`flex-1 py-3 text-[10px] font-black uppercase rounded-xl transition-all ${authMode === 'signup' ? 'bg-slate-800 text-white shadow-lg' : 'text-slate-500'}`}>Signup</button>
                </div>
                <form onSubmit={handleVaultAccess} className="space-y-6">
                   <div className="relative">
                      <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-600" size={18} />
                      <input type="email" value={loginEmail} onChange={e => setLoginEmail(e.target.value)} required className="w-full bg-slate-900/50 border border-white/5 rounded-2xl py-4 pl-12 text-white text-xs outline-none" placeholder="Email Address" />
                   </div>
                   <div className="relative">
                      <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-600" size={18} />
                      <input type="password" value={loginPass} onChange={e => setLoginPass(e.target.value)} required className="w-full bg-slate-900/50 border border-white/5 rounded-2xl py-4 pl-12 text-white text-xs outline-none" placeholder="Password" />
                   </div>
                   <button type="submit" className="w-full bg-blue-600 text-white py-5 rounded-2xl font-black uppercase text-xs tracking-widest">{authMode === 'login' ? 'Enter Vault' : 'Initialize Database'}</button>
                </form>
             </div>
          </div>
        </div>
      ) : (
        <>
          <nav className={`fixed lg:sticky lg:top-0 inset-y-0 left-0 w-72 bg-slate-900 text-slate-400 flex flex-col shrink-0 z-[100] transition-transform duration-300 transform ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'} h-screen overflow-y-auto`}>
            <div className="p-8 flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center text-white"><ShieldCheck size={24} /></div>
                <span className="text-xl font-black text-white uppercase tracking-tighter">Guardian</span>
              </div>
              <button className="lg:hidden" onClick={() => setIsSidebarOpen(false)}><X /></button>
            </div>
            <div className="flex-1 px-4 space-y-1">
              <NavItem active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} icon={LayoutDashboard} label="Dashboard" />
              <NavItem active={activeTab === 'upload'} onClick={() => setActiveTab('upload')} icon={Upload} label="Audit Center" />
              <NavItem active={activeTab === 'history'} onClick={() => setActiveTab('history')} icon={History} label="Audit History" />
              <NavItem active={activeTab === 'paid_history'} onClick={() => setActiveTab('paid_history')} icon={CheckCircle2} label="Payment Records" />
              <NavItem active={activeTab === 'hold'} onClick={() => setActiveTab('hold')} icon={Clock} label="On Hold" />
              <NavItem active={activeTab === 'alerts'} onClick={() => setActiveTab('alerts')} icon={Bell} label="Price Alert Hub" />
              <NavItem active={activeTab === 'stock'} onClick={() => setActiveTab('stock')} icon={Package} label="Master Stock" />
              <NavItem active={activeTab === 'suppliers'} onClick={() => setActiveTab('suppliers')} icon={Building2} label="Vendors" />
              <NavItem active={activeTab === 'gst'} onClick={() => setActiveTab('gst')} icon={Banknote} label="GST Ledger" />
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
                    <span className="text-[10px] font-black uppercase text-rose-700">{activeAlerts.length} Shift Alerts</span>
                  </div>
               )}
            </div>

            <div className="space-y-8">
              {activeTab === 'dashboard' && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  <div className="lg:col-span-1 space-y-6">
                    <StatCard label="Total Outstanding" value={`$${stats.totalPayable.toFixed(2)}`} icon={Wallet} color="blue" />
                    <div className="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm">
                      <h4 className="text-[10px] font-black uppercase text-slate-400 mb-4 tracking-widest">Supplier Summary</h4>
                      <div className="space-y-3">
                        {stats.payableBySupplier.slice(0, 5).map(([name, amount]) => (
                          <div key={name} className="flex justify-between items-center py-3 border-b border-slate-50 last:border-0 text-left">
                            <span className="text-[10px] font-bold text-slate-700 truncate mr-2">{name}</span>
                            <span className="text-[11px] font-black text-slate-900">${(amount as number).toFixed(2)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4 auto-rows-min">
                    <StatCard label="Audited Documents" value={stats.totalCount} icon={Files} color="slate" />
                    <StatCard label="Total GST (YTD)" value={`$${stats.totalGst.toFixed(2)}`} icon={Banknote} color="emerald" />
                  </div>
                </div>
              )}

              {activeTab === 'upload' && <UploadView handleFileUpload={handleFileUpload} loading={loading} progress={uploadProgress} vaultEmail={vault.inboundEmail} />}
              {activeTab === 'history' && <AuditHistoryView enrichedInvoices={enrichedInvoices} toggleInvoicePaid={toggleInvoicePaid} toggleInvoiceHold={toggleInvoiceHold} setSelectedInvoice={setSelectedInvoice} deleteInvoice={deleteInvoice} />}
              {activeTab === 'paid_history' && <PaidHistoryView enrichedInvoices={enrichedInvoices} toggleInvoicePaid={toggleInvoicePaid} setSelectedInvoice={setSelectedInvoice} deleteInvoice={deleteInvoice} />}
              {activeTab === 'hold' && <HoldView enrichedInvoices={enrichedInvoices} toggleInvoiceHold={toggleInvoiceHold} />}
              {activeTab === 'alerts' && <AlertsHubView activeAlerts={activeAlerts} handleAcceptPrice={handleAcceptPrice} acceptedAlertHistory={acceptedAlertHistory} />}
              {activeTab === 'stock' && <MasterStockView masterItems={masterItems} selectedStockItems={selectedStockItems} setSelectedStockItems={setSelectedStockItems} exportStockToCSV={exportStockToCSV} deleteMasterItem={deleteMasterItem} />}
              {activeTab === 'suppliers' && <VendorsView suppliers={suppliers} rawInvoices={rawInvoices} />}
              {activeTab === 'gst' && <GstLedgerView gstByMonth={gstByMonth} />}
            </div>
          </main>
        </>
      )}

      {selectedInvoice && <InvoiceViewerModal selectedInvoice={selectedInvoice} setSelectedInvoice={setSelectedInvoice} />}
      
      {loading && (
        <div className="fixed inset-0 z-[500] bg-slate-900/95 backdrop-blur-md flex flex-col items-center justify-center text-white p-6 text-center">
           <div className="w-16 h-16 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-8" />
           <p className="text-xl font-black uppercase tracking-tighter animate-pulse">{uploadProgress}</p>
        </div>
      )}
    </div>
  );
};

// --- Sub-Components ---

const AlertsHubView = ({ activeAlerts, handleAcceptPrice, acceptedAlertHistory }: any) => (
  <div className="space-y-10">
    <div className="bg-slate-900 rounded-[2.5rem] p-10 text-white shadow-2xl relative overflow-hidden text-left">
      <div className="flex justify-between items-center mb-10">
        <h3 className="font-black uppercase text-sm tracking-widest flex items-center text-rose-400">
          <Bell size={24} className="mr-4" /> Live Price Drift Detected
        </h3>
        <div className="bg-rose-500/20 px-4 py-1.5 rounded-full text-[10px] font-black uppercase text-rose-300">
          {activeAlerts.length} Pending Actions
        </div>
      </div>
      
      {activeAlerts.length > 0 ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {activeAlerts.map((alert: any) => (
            <div key={alert.id} className="flex flex-col p-8 bg-white/5 rounded-[2rem] border border-white/10 hover:border-rose-500/50 transition-all group">
              <div className="flex justify-between items-start mb-6">
                <div className="min-w-0">
                  <p className="text-[10px] font-black text-slate-500 uppercase mb-1">{alert.supplier}</p>
                  <h4 className="font-black text-white text-lg uppercase leading-tight truncate">{alert.itemName}</h4>
                  <p className="text-[10px] font-bold text-slate-500 mt-2">Detected in Inv #{alert.invoiceNumber}</p>
                </div>
                <div className={`shrink-0 px-4 py-2 rounded-xl text-[11px] font-black uppercase ${alert.change > 0 ? 'bg-rose-500/20 text-rose-400' : 'bg-emerald-500/20 text-emerald-400'}`}>
                  {alert.change > 0 ? '+' : ''}{alert.change.toFixed(1)}%
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4 mb-8 text-left">
                <div className="bg-black/20 p-4 rounded-2xl">
                  <p className="text-[9px] font-black text-slate-500 uppercase mb-1">Anchored Rate</p>
                  <p className="font-black text-white text-sm">${alert.oldPrice.toFixed(2)}</p>
                </div>
                <div className="bg-black/20 p-4 rounded-2xl">
                  <p className="text-[9px] font-black text-slate-500 uppercase mb-1">Proposed Rate</p>
                  <p className="font-black text-white text-sm">${alert.newPrice.toFixed(2)}</p>
                </div>
              </div>

              <button 
                onClick={() => handleAcceptPrice(alert)} 
                className="w-full bg-blue-600 hover:bg-emerald-600 text-white py-4 rounded-2xl text-[11px] font-black uppercase transition-all shadow-lg active:scale-95"
              >
                Anchor Adjusted Price
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="py-24 text-center">
          <ShieldCheck size={64} className="mx-auto text-emerald-500/50 mb-6" />
          <h4 className="font-black text-white uppercase">Vault Anchors are Stable</h4>
          <p className="text-slate-500 font-bold uppercase text-[10px] mt-2">No price deviations found in recent audits.</p>
        </div>
      )}
    </div>

    {/* Adjustment History Table */}
    <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden text-left">
      <div className="p-8 border-b flex justify-between items-center">
        <div>
          <h3 className="font-black text-slate-900 uppercase text-sm tracking-tight flex items-center">
            <History size={18} className="mr-3 text-slate-400" /> Adjustment Audit Trail
          </h3>
          <p className="text-[10px] font-bold text-slate-400 uppercase mt-1">Permanent record of all accepted price anchor shifts</p>
        </div>
        <div className="bg-slate-100 px-4 py-2 rounded-xl text-[10px] font-black text-slate-500 uppercase">
          {acceptedAlertHistory.length} Record(s)
        </div>
      </div>
      
      <div className="overflow-x-auto custom-scrollbar">
        <table className="w-full text-left min-w-[1000px]">
          <thead>
            <tr className="bg-slate-50 border-b text-[10px] font-black uppercase text-slate-400">
              <th className="px-8 py-5">Date of Impact</th>
              <th className="px-8 py-5">Vendor & Item</th>
              <th className="px-8 py-5">Audit Ref</th>
              <th className="px-8 py-5 text-right">Anchored Rate</th>
              <th className="px-8 py-5 text-right">Variance</th>
              <th className="px-8 py-5 text-center">Auth Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {acceptedAlertHistory.map((entry: any, idx: number) => (
              <tr key={idx} className="hover:bg-slate-50 transition-colors">
                <td className="px-8 py-6">
                  <p className="text-[11px] font-black text-slate-900">{entry.date}</p>
                  <p className="text-[9px] font-bold text-slate-400 mt-0.5 uppercase">Logged {new Date(entry.acceptedAt).toLocaleDateString()}</p>
                </td>
                <td className="px-8 py-6">
                  <p className="text-[9px] font-black text-blue-600 uppercase mb-1">{entry.supplier}</p>
                  <p className="text-[11px] font-black text-slate-900 uppercase">{entry.itemName}</p>
                </td>
                <td className="px-8 py-6">
                  <div className="flex items-center space-x-2">
                    <Hash size={12} className="text-slate-300" />
                    <span className="text-[10px] font-bold text-slate-500">Inv #{entry.invoiceNumber}</span>
                  </div>
                </td>
                <td className="px-8 py-6 text-right">
                  <p className="text-[11px] font-black text-slate-900">${entry.newPrice.toFixed(2)}</p>
                  <p className="text-[9px] font-bold text-slate-400 mt-0.5 uppercase">Prev: ${entry.oldPrice.toFixed(2)}</p>
                </td>
                <td className="px-8 py-6 text-right">
                  <div className={`inline-flex items-center space-x-1 font-black text-[11px] ${entry.change > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                    {entry.change > 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                    <span>{entry.change > 0 ? '+' : ''}{entry.change.toFixed(1)}%</span>
                  </div>
                </td>
                <td className="px-8 py-6 text-center">
                  <span className="bg-emerald-50 text-emerald-600 px-3 py-1 rounded-lg text-[9px] font-black uppercase border border-emerald-100">Verified</span>
                </td>
              </tr>
            ))}
            {acceptedAlertHistory.length === 0 && (
              <tr>
                <td colSpan={6} className="py-24 text-center">
                  <Files size={40} className="mx-auto text-slate-200 mb-4" />
                  <p className="text-[10px] font-black text-slate-300 uppercase">Audit trail is currently empty.</p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  </div>
);

const AuditHistoryView = ({ enrichedInvoices, toggleInvoicePaid, toggleInvoiceHold, setSelectedInvoice, deleteInvoice }: any) => (
  <div className="bg-white rounded-[2rem] border border-slate-200 shadow-sm overflow-hidden text-left">
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
              {enrichedInvoices.filter((i: any) => !i.isPaid && !i.isHold).map((inv: any) => (
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
                       <button onClick={() => setSelectedInvoice(inv)} className="p-2 text-slate-400 hover:text-blue-600"><Eye size={16} /></button>
                       <button onClick={() => deleteInvoice(inv.id)} className="p-2 text-slate-300 hover:text-rose-600"><Trash2 size={16} /></button>
                     </div>
                  </td>
                </tr>
              ))}
           </tbody>
        </table>
     </div>
  </div>
);

const PaidHistoryView = ({ enrichedInvoices, toggleInvoicePaid, setSelectedInvoice, deleteInvoice }: any) => (
  <div className="bg-white rounded-[2rem] border border-slate-200 shadow-sm overflow-hidden text-left">
     <div className="overflow-x-auto custom-scrollbar">
        <table className="w-full text-left min-w-[900px]">
           <thead>
              <tr className="bg-slate-50 border-b text-[10px] font-black uppercase text-slate-400">
                 <th className="px-6 py-5">Date</th>
                 <th className="px-6 py-5">Vendor</th>
                 <th className="px-6 py-5 text-right">Settled Amount</th>
                 <th className="px-6 py-5 text-center">Action</th>
                 <th className="px-6 py-5 text-center">Actions</th>
              </tr>
           </thead>
           <tbody className="divide-y divide-slate-100">
              {enrichedInvoices.filter((i: any) => i.isPaid).map((inv: any) => (
                <tr key={inv.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-6 py-6 font-bold text-slate-500 text-[10px]">{inv.date}</td>
                  <td className="px-6 py-6 font-black text-slate-900 text-xs uppercase">{inv.supplierName}</td>
                  <td className="px-6 py-6 text-right font-black text-emerald-600 text-xs">${inv.totalAmount.toFixed(2)}</td>
                  <td className="px-6 py-6 text-center">
                     <button onClick={() => toggleInvoicePaid(inv.id)} className="px-3 py-1.5 rounded-lg text-[9px] font-black uppercase border border-slate-200 bg-white text-slate-400 hover:bg-slate-900 hover:text-white transition-all flex items-center justify-center space-x-1 mx-auto"><Undo2 size={12} /> <span>Re-Audit</span></button>
                  </td>
                  <td className="px-6 py-6 text-center">
                     <div className="flex items-center justify-center space-x-2">
                       <button onClick={() => setSelectedInvoice(inv)} className="p-2 text-slate-400 hover:text-blue-600"><Eye size={16} /></button>
                       <button onClick={() => deleteInvoice(inv.id)} className="p-2 text-slate-300 hover:text-rose-600"><Trash2 size={16} /></button>
                     </div>
                  </td>
                </tr>
              ))}
           </tbody>
        </table>
     </div>
  </div>
);

const HoldView = ({ enrichedInvoices, toggleInvoiceHold }: any) => (
  <div className="bg-white rounded-[2rem] border border-slate-200 shadow-sm overflow-hidden text-left">
     <div className="overflow-x-auto custom-scrollbar">
        <table className="w-full text-left min-w-[900px]">
           <tbody className="divide-y divide-slate-100">
              {enrichedInvoices.filter((i: any) => i.isHold).map((inv: any) => (
                <tr key={inv.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-6 py-6 font-bold text-slate-500 text-[10px]">{inv.date}</td>
                  <td className="px-6 py-6 font-black text-slate-900 text-xs uppercase">{inv.supplierName}</td>
                  <td className="px-6 py-6 text-right font-black text-rose-600 text-xs">${inv.totalAmount.toFixed(2)}</td>
                  <td className="px-6 py-6 text-center">
                     <button onClick={() => toggleInvoiceHold(inv.id)} className="px-4 py-2 bg-slate-900 text-white rounded-xl text-[9px] font-black uppercase hover:bg-blue-600 transition-all">Release</button>
                  </td>
                </tr>
              ))}
           </tbody>
        </table>
     </div>
  </div>
);

const MasterStockView = ({ masterItems, selectedStockItems, setSelectedStockItems, exportStockToCSV, deleteMasterItem }: any) => (
  <div className="bg-white rounded-[2rem] border border-slate-200 shadow-sm overflow-hidden text-left">
     <div className="p-6 border-b flex items-center justify-between">
        <div className="relative w-full max-w-md text-left">
           <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
           <input type="text" placeholder="Search Master Registry..." className="w-full bg-slate-50 border-none rounded-2xl py-3 pl-12 text-xs font-bold outline-none" />
        </div>
        <button onClick={exportStockToCSV} disabled={selectedStockItems.length === 0} className={`flex items-center space-x-2 px-6 py-3 rounded-2xl text-[10px] font-black uppercase transition-all ${selectedStockItems.length > 0 ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-400 cursor-not-allowed'}`}><FileSpreadsheet size={16} /> <span>Extract CSV ({selectedStockItems.length})</span></button>
     </div>
     <div className="overflow-x-auto custom-scrollbar">
        <table className="w-full text-left min-w-[1000px]">
           <thead>
              <tr className="bg-slate-50 border-b text-[10px] font-black uppercase text-slate-400">
                 <th className="px-6 py-5 w-10"><input type="checkbox" checked={selectedStockItems.length === masterItems.length && masterItems.length > 0} onChange={(e) => e.target.checked ? setSelectedStockItems(masterItems.map((m: any) => m.id)) : setSelectedStockItems([])} className="rounded" /></th>
                 <th className="px-6 py-5">Item Name</th>
                 <th className="px-6 py-5">Vendor</th>
                 <th className="px-6 py-5 text-right">Anchored Rate</th>
                 <th className="px-6 py-5 text-center">Actions</th>
              </tr>
           </thead>
           <tbody className="divide-y divide-slate-100">
              {masterItems.map((item: any) => (
                <tr key={item.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-6 py-6"><input type="checkbox" checked={selectedStockItems.includes(item.id)} onChange={() => selectedStockItems.includes(item.id) ? setSelectedStockItems((prev: any) => prev.filter((i: any) => i !== item.id)) : setSelectedStockItems((prev: any) => [...prev, item.id])} className="rounded" /></td>
                  <td className="px-6 py-6 font-black text-slate-900 text-xs uppercase">{item.name}</td>
                  <td className="px-6 py-6 font-bold text-slate-400 text-[10px] uppercase">{item.supplierName}</td>
                  <td className="px-6 py-6 text-right font-black text-slate-900 text-xs">${item.currentPrice.toFixed(2)}</td>
                  <td className="px-6 py-6 text-center"><button onClick={() => deleteMasterItem(item.id)} className="p-2 text-slate-300 hover:text-rose-600"><Trash2 size={16} /></button></td>
                </tr>
              ))}
           </tbody>
        </table>
     </div>
  </div>
);

const VendorsView = ({ suppliers, rawInvoices }: { suppliers: Supplier[], rawInvoices: Invoice[] }) => (
  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-8 text-left">
     {suppliers.map((sup) => {
       const outstanding = rawInvoices.filter(inv => inv.supplierName === sup.name && !inv.isPaid && !inv.isHold).reduce((sum, inv) => sum + inv.totalAmount, 0);
       return (
        <div key={sup.id} className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm p-8 space-y-6 hover:shadow-xl hover:border-blue-200 transition-all group relative overflow-hidden">
            <div className="flex items-start justify-between">
              <div className="flex items-center space-x-4">
                  <div className="w-14 h-14 bg-blue-50 rounded-[1.25rem] flex items-center justify-center text-blue-600 group-hover:bg-blue-600 group-hover:text-white transition-all duration-500">
                    <Building2 size={28} />
                  </div>
                  <div className="min-w-0">
                      <h3 className="font-black text-slate-900 uppercase text-base tracking-tight truncate max-w-[180px]">{sup.name}</h3>
                      <p className="text-[10px] font-black text-blue-600 uppercase tracking-widest mt-0.5">Verified Entity</p>
                  </div>
              </div>
              {outstanding > 0 && <div className="bg-amber-50 text-amber-600 px-3 py-1 rounded-full text-[9px] font-black uppercase border border-amber-100">Pending Payables</div>}
            </div>

            <div className="grid grid-cols-2 gap-4">
                <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                    <p className="text-[9px] font-black text-slate-400 uppercase mb-1">Total Volume</p>
                    <p className="font-black text-slate-900 text-sm">${sup.totalSpent.toLocaleString()}</p>
                </div>
                <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                    <p className="text-[9px] font-black text-slate-400 uppercase mb-1">Outstanding</p>
                    <p className={`font-black text-sm ${outstanding > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>${outstanding.toFixed(2)}</p>
                </div>
            </div>

            <div className="space-y-4 py-2 text-left">
               <div className="grid grid-cols-2 gap-4">
                  <SupplierInfo icon={Hash} label="ABN" value={sup.abn || 'N/A'} />
                  <SupplierInfo icon={Phone} label="Contact" value={sup.tel || 'N/A'} />
               </div>
               <SupplierInfo icon={Mail} label="Official Email" value={sup.email || 'N/A'} />
               
               <div className="p-4 bg-slate-900 rounded-2xl border border-slate-800 text-white">
                  <div className="flex items-start space-x-3">
                     <Lock size={14} className="text-emerald-400 mt-1 shrink-0" />
                     <div className="min-w-0">
                        <p className="text-[9px] font-black text-slate-500 uppercase mb-1 text-left">Settlement Account (EFT)</p>
                        <p className="text-[11px] font-black truncate">{sup.bankAccount || 'Banking details required'}</p>
                     </div>
                  </div>
               </div>

               <div className="pt-2">
                  <div className="flex items-start space-x-3">
                     <MapPin size={14} className="text-slate-400 mt-1 shrink-0" />
                     <div className="min-w-0 text-left">
                        <p className="text-[9px] font-black text-slate-400 uppercase mb-1 text-left">Registered Address</p>
                        <p className="text-[10px] font-bold text-slate-600 leading-relaxed italic">{sup.address || 'Address information not audited'}</p>
                     </div>
                  </div>
               </div>
            </div>
        </div>
       );
     })}
     {suppliers.length === 0 && (
       <div className="col-span-full py-24 text-center">
          <Building2 size={64} className="mx-auto text-slate-200 mb-6" />
          <h4 className="font-black text-slate-400 uppercase">Vendor Intelligence Not Found</h4>
          <p className="text-slate-300 font-bold uppercase text-[10px] mt-2">Upload invoices to build business profiles.</p>
       </div>
     )}
  </div>
);

const GstLedgerView = ({ gstByMonth }: any) => (
  <div className="space-y-6">
    {gstByMonth.map(([month, supplierGstMap]: any) => {
        const monthlyTotal = Object.values(supplierGstMap).reduce((a: any, b: any) => a + b, 0);
        return (
          <div key={month} className="bg-white rounded-[2rem] border border-slate-200 shadow-sm overflow-hidden mb-8 text-left">
            <div className="px-8 py-6 bg-slate-50 border-b flex justify-between items-center">
              <h4 className="font-black text-slate-900 uppercase text-sm">{month} Summary</h4>
              <div className="bg-emerald-600 text-white px-4 py-1.5 rounded-xl text-[10px] font-black shadow-lg shadow-emerald-200">Total GST: ${(monthlyTotal as number).toFixed(2)}</div>
            </div>
            <div className="p-8 grid grid-cols-1 md:grid-cols-3 gap-4 text-left">
              {Object.entries(supplierGstMap).map(([name, amount]: any) => (
                <div key={name} className="p-5 bg-slate-50 rounded-2xl border border-slate-100 text-left">
                  <p className="text-[9px] font-black text-slate-400 uppercase mb-2 truncate">{name}</p>
                  <span className="font-black text-slate-900 text-lg">${amount.toFixed(2)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
  </div>
);

const InvoiceViewerModal = ({ selectedInvoice, setSelectedInvoice }: any) => (
  <div className="fixed inset-0 z-[1000] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 text-left">
    <div className="bg-white w-full max-w-2xl rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95">
       <div className="p-8 bg-slate-900 text-white flex justify-between items-start text-left">
          <div className="text-left"><h2 className="text-2xl font-black uppercase tracking-tighter text-left">{selectedInvoice.supplierName}</h2><p className="text-xs font-bold text-blue-400 mt-1">Invoice #{selectedInvoice.invoiceNumber}</p></div>
          <button onClick={() => setSelectedInvoice(null)} className="p-2 bg-white/10 rounded-xl hover:bg-white/20"><X size={20} /></button>
       </div>
       <div className="p-8 overflow-y-auto custom-scrollbar flex-1 space-y-8 text-left">
          <div className="grid grid-cols-2 gap-4">
             <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 text-left"><p className="text-[9px] font-black text-slate-400 uppercase mb-1 text-left">Total Payable</p><p className="font-black text-xl text-slate-900 text-left">${selectedInvoice.totalAmount.toFixed(2)}</p></div>
             <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 text-left"><p className="text-[9px] font-black text-slate-400 uppercase mb-1 text-left">GST Credit</p><p className="font-black text-xl text-emerald-600 text-left">${(selectedInvoice.gstAmount || 0).toFixed(2)}</p></div>
          </div>
          <div className="space-y-2 text-left">
            {selectedInvoice.items.map((item: any, idx: number) => (
              <div key={idx} className="flex justify-between items-center p-4 bg-slate-50 rounded-xl border border-slate-100">
                <div className="min-w-0 text-left"><p className="text-[11px] font-black text-slate-900 uppercase truncate text-left">{item.name}</p><p className="text-[9px] font-bold text-slate-400 uppercase text-left">{item.quantity} units x ${item.unitPrice.toFixed(2)}</p></div>
                <p className="text-[11px] font-black text-slate-900 ml-4">${item.total.toFixed(2)}</p>
              </div>
            ))}
          </div>
       </div>
    </div>
  </div>
);

const NavItem = ({ active, onClick, icon: Icon, label }: any) => (
  <button onClick={onClick} className={`w-full flex items-center space-x-4 px-6 py-4 rounded-2xl transition-all ${active ? 'bg-blue-600 text-white shadow-xl' : 'text-slate-400 hover:bg-slate-800'}`}>
    <Icon size={18} /> <span className="font-bold text-sm uppercase tracking-tighter">{label}</span>
  </button>
);

const StatCard = ({ label, value, icon: Icon, color }: any) => {
  const c: any = { blue: 'text-blue-600 bg-blue-50', emerald: 'text-emerald-600 bg-emerald-50', slate: 'text-slate-600 bg-slate-50', rose: 'text-rose-600 bg-rose-50' };
  return (
    <div className="bg-white p-6 lg:p-8 rounded-[2rem] border border-slate-200 shadow-sm transition-all hover:scale-[1.02] text-left">
      <div className={`w-12 h-12 rounded-2xl flex items-center justify-center mb-6 shadow-sm ${c[color]}`}><Icon size={20} /></div>
      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 text-left">{label}</p>
      <h3 className="text-2xl font-black text-slate-900 text-left">{value}</h3>
    </div>
  );
};

const SupplierInfo = ({ icon: Icon, label, value }: any) => (
  <div className="flex items-start space-x-3 min-w-0 text-left">
     <div className="w-7 h-7 rounded-lg bg-slate-50 flex items-center justify-center text-slate-400 shrink-0 mt-0.5"><Icon size={14} /></div>
     <div className="min-w-0 flex-1 text-left">
        <p className="text-[9px] font-black text-slate-300 uppercase leading-none mb-1 text-left">{label}</p>
        <p className="text-[10px] font-bold text-slate-600 leading-tight truncate text-left">{value}</p>
     </div>
  </div>
);

const UploadView = ({ handleFileUpload, vaultEmail }: any) => (
  <div className="max-w-4xl mx-auto py-20 text-center">
    <div className="w-20 h-20 bg-blue-600 text-white rounded-[2rem] flex items-center justify-center mx-auto mb-10 shadow-2xl"><Upload size={32} /></div>
    <h2 className="text-4xl font-black text-slate-900 uppercase tracking-tighter mb-4">Ingestion Gateway</h2>
    <p className="text-slate-400 font-bold mb-12 text-[11px] uppercase tracking-widest leading-relaxed">FORWARD PDFs TO: <span className="text-blue-600 lowercase">{vaultEmail}</span></p>
    <label className="group relative block cursor-pointer px-4">
      <div className="border-4 border-dashed border-slate-200 rounded-[3rem] p-24 bg-white transition-all group-hover:border-blue-500 group-hover:bg-blue-50 shadow-sm">
        <Plus size={32} className="mx-auto text-slate-300 group-hover:text-blue-500 mb-4 transition-transform group-hover:scale-125" />
        <p className="text-slate-400 font-black uppercase text-xs tracking-widest">Auditor Dropbox</p>
      </div>
      <input type="file" className="hidden" onChange={handleFileUpload} accept="application/pdf,image/*" multiple />
    </label>
  </div>
);

export default App;