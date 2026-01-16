import { GoogleGenAI, Type } from "@google/genai";

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Extracts invoice data from a base64 string using Gemini AI.
 * Implements exponential backoff to handle 429 (Quota Exceeded) errors gracefully.
 * Now handles both PDF and Image MIME types explicitly.
 */
export const extractInvoiceData = async (
  base64Data: string, 
  mimeType: string = 'application/pdf', 
  retries = 3, 
  delay = 8000
) => {
  // Use gemini-3-flash-preview as it has excellent OCR capabilities for images
  const modelName = 'gemini-3-flash-preview';
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

  // Ensure we have a valid MIME type for images or PDF
  const validMimeType = mimeType.startsWith('image/') || mimeType === 'application/pdf' 
    ? mimeType 
    : 'application/pdf';

  try {
    const response = await ai.models.generateContent({
      model: modelName,
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: validMimeType,
              data: base64Data,
            },
          },
          {
            text: `Analyze this procurement document (invoice/receipt). 
            Perform high-accuracy OCR to extract the following data into the specified JSON format.
            
            JSON Structure Rules:
            1. supplierName: Legal business name found at the top.
            2. docType: Identify if it is an 'invoice', 'credit_note', 'debit_note', or 'quote'.
            3. items: Array of objects with 'name', 'quantity' (number), 'unitPrice' (number), and 'total' (number).
            4. totalAmount: Final grand total inclusive of tax.
            5. gstAmount: Total tax amount (GST/VAT).
            6. invoiceNumber: Unique reference string.
            7. date: Document date in YYYY-MM-DD.
            8. dueDate: Payment due date in YYYY-MM-DD.
            9. bankAccount: Any EFT, BSB, or Account number found.
            10. businessInfo: Extract ABN, Address, Tel, and Email if visible.
            
            Return ONLY a valid JSON object. Do not include markdown formatting like \`\`\`json.`,
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
    
    if (!resultText) {
      // If response.text is empty, check if we got candidates but no text (Safety block)
      throw new Error("Guardian AI was unable to read this document clearly. Please ensure the image is bright and the text is legible.");
    }

    try {
      return JSON.parse(resultText);
    } catch (parseError) {
      console.error("JSON Parse Error:", resultText);
      throw new Error("Audit failed: The AI response format was invalid. Please try a clearer photo.");
    }

  } catch (error: any) {
    const isQuotaError = 
      error.status === 'RESOURCE_EXHAUSTED' || 
      error.message?.includes('429') || 
      error.message?.includes('quota') ||
      error.message?.includes('capacity');

    if (isQuotaError && retries > 0) {
      console.warn(`Guardian Intelligence is at capacity. Retrying in ${delay / 1000}s... (${retries} attempts remaining)`);
      await wait(delay);
      return extractInvoiceData(base64Data, validMimeType, retries - 1, delay * 2);
    }

    if (isQuotaError) {
      throw new Error("Audit capacity limit reached. Please wait 1-2 minutes before trying again or use a smaller batch.");
    }

    console.error("Extraction Error Detail:", error);
    throw new Error(error.message || "Auditing failed due to a processing error.");
  }
};
