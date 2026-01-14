import { GoogleGenAI, Type } from "@google/genai";

export const extractInvoiceData = async (base64Data: string, mimeType: string = 'application/pdf') => {
  // Upgrading to Pro for complex structural reasoning on multi-page/complex invoices
  const model = 'gemini-3-pro-preview';
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

  try {
    const response = await ai.models.generateContent({
      model,
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: mimeType || 'application/pdf',
              data: base64Data,
            },
          },
          {
            text: `Audit this procurement document. Extract exactly into the specified JSON format.
            Rules:
            1. Supplier Name: Extract the official business name.
            2. Line Items: Extract name, quantity, unit price, and subtotal for every row in the table.
            3. Totals: Capture GST (tax) and the final Grand Total.
            4. Metadata: Invoice number, date (YYYY-MM-DD), and due date (YYYY-MM-DD).
            5. Payment Details: Extract Bank Account details. Look specifically for 'EFT', 'BSB', 'Account Number', 'Acc No', 'Electronic Funds Transfer', or 'Payable to'. Also extract Credit Terms (e.g., 30 days, 7 days from invoice, etc).
            6. Business Info: Extract ABN (Australian Business Number) or Tax ID, physical address, primary email, and telephone number.
            7. Document Type determination: Decide if this is an 'invoice', 'credit_note', 'debit_note', or 'quote'.
            8. If a field is missing, use null for strings and 0 for numbers.`,
          },
        ],
      },
      config: {
        thinkingConfig: { thinkingBudget: 1024 },
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            docType: { 
              type: Type.STRING, 
              description: "Must be one of: 'invoice', 'credit_note', 'debit_note', 'quote'" 
            },
            supplierName: { type: Type.STRING },
            date: { type: Type.STRING },
            dueDate: { type: Type.STRING },
            invoiceNumber: { type: Type.STRING },
            totalAmount: { type: Type.NUMBER },
            gstAmount: { type: Type.NUMBER },
            bankAccount: { type: Type.STRING },
            creditTerm: { type: Type.STRING },
            address: { type: Type.STRING },
            abn: { type: Type.STRING },
            tel: { type: Type.STRING },
            email: { type: Type.STRING },
            items: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  name: { type: Type.STRING },
                  quantity: { type: Type.NUMBER },
                  unitPrice: { type: Type.NUMBER },
                  total: { type: Type.NUMBER },
                },
                required: ["name", "quantity", "unitPrice", "total"],
              },
            },
          },
          required: ["docType", "supplierName", "date", "dueDate", "invoiceNumber", "totalAmount", "items"],
        },
      },
    });

    const resultText = response.text;
    if (!resultText) {
      throw new Error("Empty response from AI. The document might be unreadable or empty.");
    }

    return JSON.parse(resultText);
  } catch (error: any) {
    console.error("Gemini Extraction Error:", error);
    throw new Error(error.message || "Auditing failed due to a network or parsing error.");
  }
};
