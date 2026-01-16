import { GoogleGenAI, Type } from "@google/genai";

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Extracts invoice data from a base64 string using Gemini AI.
 * Implements exponential backoff to handle 429 (Quota Exceeded) errors gracefully.
 */
export const extractInvoiceData = async (
  base64Data: string, 
  mimeType: string = 'application/pdf', 
  retries = 3, 
  delay = 8000
) => {
  const modelName = 'gemini-3-flash-preview';
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

  try {
    const response = await ai.models.generateContent({
      model: modelName,
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
            1. Supplier Name: Official business name.
            2. Line Items: Extract name, quantity, unit price, and subtotal.
            3. Totals: Capture GST amount and Grand Total.
            4. Metadata: Invoice number, date (YYYY-MM-DD), and due date (YYYY-MM-DD).
            5. Payment: Bank Account details (EFT/BSB/Acc).
            6. Business: ABN, physical address, email, and telephone.
            7. Terms: Payment window (e.g., 30 days).
            8. Type: 'invoice', 'credit_note', 'debit_note', or 'quote'.`,
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

    const resultText = response.text;
    if (!resultText) throw new Error("Empty response from AI.");
    return JSON.parse(resultText);

  } catch (error: any) {
    const isQuotaError = 
      error.status === 'RESOURCE_EXHAUSTED' || 
      error.message?.includes('429') || 
      error.message?.includes('quota') ||
      error.message?.includes('capacity');

    if (isQuotaError && retries > 0) {
      console.warn(`Guardian Intelligence is at capacity. Retrying in ${delay / 1000}s... (${retries} attempts remaining)`);
      await wait(delay);
      // Double the delay for the next attempt (exponential backoff)
      return extractInvoiceData(base64Data, mimeType, retries - 1, delay * 2);
    }

    if (isQuotaError) {
      throw new Error("Audit capacity limit reached. The Free Tier of Gemini has a strict per-minute limit. Please wait 1-2 minutes before trying again.");
    }

    console.error("Extraction Error:", error);
    throw new Error(error.message || "Auditing failed.");
  }
};
