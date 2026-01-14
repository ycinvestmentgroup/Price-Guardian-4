
export interface User {
  id: string;
  name: string;
  email: string;
  avatar?: string;
  role: 'Admin' | 'Auditor' | 'Viewer';
  organization: string;
  lastLogin: string;
  is2FAEnabled: boolean;
}

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: 'Admin' | 'Auditor' | 'Viewer';
  status: 'Online' | 'Offline';
}

export interface VaultConfig {
  vaultId: string;
  inboundEmail: string;
  isCloudSyncEnabled: boolean;
  sharedApiKey?: string;
}

export interface PriceHistoryEntry {
  date: string;
  price: number;
  variance: number;
  percentChange: number;
  source: 'audit' | 'manual' | 'email';
  note?: string;
  invoiceNumber?: string;
}

export interface MasterItem {
  id: string;
  supplierName: string;
  name: string;
  currentPrice: number;
  history: PriceHistoryEntry[];
  lastUpdated: string;
}

export interface InvoiceItem {
  id: string;
  name: string;
  unitPrice: number;
  quantity: number;
  total: number;
  previousUnitPrice?: number;
  priceChange?: number; 
  percentChange?: number;
}

export type DocumentType = 'invoice' | 'credit_note' | 'debit_note' | 'quote';

export interface Invoice {
  id: string;
  supplierName: string;
  date: string;
  dueDate: string;
  deliveryLocation?: string;
  invoiceNumber: string;
  totalAmount: number;
  gstAmount: number;
  bankAccount: string;
  creditTerm: string;
  address?: string;
  abn?: string;
  tel?: string;
  email?: string;
  docType: DocumentType;
  items: InvoiceItem[];
  status: 'matched' | 'price_increase' | 'price_decrease' | 'mixed' | 'new_supplier';
  fileName: string;
  isPaid: boolean;
  isHold: boolean;
  receivedVia?: 'upload' | 'email';
}

export interface Supplier {
  id: string;
  name: string;
  bankAccount?: string;
  address?: string;
  abn?: string;
  tel?: string;
  email?: string;
  creditTerm?: string;
  totalSpent: number;
}