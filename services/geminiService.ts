import { GoogleGenAI, Type } from "@google/genai";

export const extractInvoiceData = async (base64Data: string, mimeType: string = 'application/pdf') => {
  // Use gemini-3-flash-preview for extraction tasks
  const model = 'gemini-3-flash-preview';
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
            2. Line Items: Extract name, quantity, unit price, and subtotal.
            3. Totals: Capture GST (tax) and Grand Total.
            4. Metadata: Invoice number, date (YYYY-MM-DD), and due date (YYYY-MM-DD).
            5. Payment Details: Extract Bank Account details (EFT/BSB/Acc).
            6. Business Info: Extract ABN (Australian Business Number), physical address, email, and telephone.
            7. Credit Terms: Extract the payment window (e.g., 30 days).
            8. Document Type: Decide if 'invoice', 'credit_note', 'debit_note', or 'quote'.`,
          },
        ],
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            docType: { type: Type.STRING },
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
          required: ["docType", "supplierName", "date", "invoiceNumber", "totalAmount", "items"],
        },
      },
    });

    // Access .text property directly as per @google/genai guidelines
    const resultText = response.text;
    if (!resultText) throw new Error("Empty response from AI.");
    return JSON.parse(resultText);
  } catch (error: any) {
    console.error("Extraction Error:", error);
    throw new Error(error.message || "Auditing failed.");
  }
};
