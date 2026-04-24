import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export interface DealAnalysis {
  name: string;
  address?: string;
  assetType: string;
  docType: 'Listing' | 'Offering Memorandum' | 'Market Report';
  price: number;
  capRate?: number;
  noi?: number;
  units?: number;
  squareFootage?: number;
  yearBuilt?: number;
  cashOnCashReturn?: number;
  debtCoverageRatio?: number;
  loanAssumptions?: {
    ltv: number;
    interestRate: number;
    amortization: number;
  };
  confidenceScore: number;
  hiddenGemScore: number;
  dealHeatRating: number;
  redFlags: string[];
  valueAddOpportunities: string[];
  summary: string;
  analysis: string;
  historicalComparison: {
    period: string;
    analysis: string;
  }[];
  negotiationStrategy: {
    target: 'Seller' | 'Buyer';
    doubt: string;
    combat: string;
  }[];
  ownerCriticalQuestions: {
    question: string;
    answer: string;
  }[];
}

export async function analyzeCREDocument(
  text: string, 
  files?: { mimeType: string, data: string }[],
  existingDeals?: DealAnalysis[],
  forcedDocType?: 'Listing' | 'Offering Memorandum' | 'Market Report'
): Promise<DealAnalysis[]> {
  const existingDealsContext = existingDeals && existingDeals.length > 0 
    ? `\n\nInternal Historical Benchmarks (User's Previous Analyzed Deals):\n${JSON.stringify(existingDeals.map(d => ({
        name: d.name,
        type: d.assetType,
        price: d.price,
        capRate: d.capRate,
        noi: d.noi,
        sqft: d.squareFootage,
        score: d.hiddenGemScore
      })))}`
    : "";

  const typeInstruction = forcedDocType 
    ? `The user has explicitly classified this as a '${forcedDocType}'. Ensure the analysis reflects this intent.`
    : `Categorize each as either a 'Listing' (short summary/first impression), 'Offering Memorandum' (deep dive document with rent rolls and PIs), or 'Market Report' (macro trends overview for IE).`;

  const parts: any[] = [
    { text: `Analyze the following commercial real estate document (OM, Rent Roll, T-12, or Listing Summaries) for properties in the Inland Empire or surrounding regions. 
    Extract key metrics and provide a professional analysis as a seasoned CRE agent.
    
    If multiple properties are detected (e.g., a list of favorites or a portfolio summary), provide a separate analysis for each property.
    ${typeInstruction}
    
    For "first impressions" or partial listings, extract as much data as possible (Price, Location, Type) and provide a high-level agent's take.
    For Offering Memorandums (OMs), synthesize data across ALL pages. Look specifically for 'Rent Roll' tables, 'Pro Forma' income statements, and 'Investment Highlights'.
    
    Compare and contrast current data with historical trends as far back as you can detect (e.g., pre-2008, 2012 recovery, 2021 peak, and current high-rate environment).
    
    CRITICAL: Also compare these new properties against the user's own historical data provided below. Identify if this is a better or worse deal than what they've seen before.
    
    Provide a structured historical comparison for key periods.${existingDealsContext}
    
    Document Input:
    ${text}
    ` }
  ];

  if (files && files.length > 0) {
    files.forEach(file => {
      parts.push({
        inlineData: {
          mimeType: file.mimeType,
          data: file.data
        }
      });
    });
  }

  const response = await ai.models.generateContent({
    model: "gemini-flash-latest",
    contents: [{ role: "user", parts }],
    config: {
      systemInstruction: `You are a seasoned Inland Empire Commercial Real Estate Agent and Underwriter. You are direct, confident, and practical. 
      You know the IE market inside and out, tracking trends from the early 2000s through the 2008 crash, the 2012-2019 expansion, the 2021 peak, and today's high-interest-rate environment.
      
      FINANCIAL UNDERWRITING: 
      For every deal, you must perform a preliminary underwriting analysis. 
      Assume a standard commercial loan for the region: 65-75% LTV, 6.5-7.5% interest rate, and 25-30 year amortization unless the document suggests otherwise.
      Calculate the Debt Coverage Ratio (DCR) and Year-1 Cash-on-Cash (CoC) return.
      If NOI is missing, estimate it based on asset type and market averages for the IE.
      
      DATA VERACITY:
      Assign a 'confidenceScore' (0-100) based on how much clear data was available vs. how much you had to estimate.

      NEGOTIATION STRATEGY:
      Foresee common objections or doubts from both Sellers and Buyers (especially retail owners who are cautious right now).
      Provide 'Combat' points (rebuttals) to address these doubts using market logic, financial math, or local IE context.
      
      OWNER'S HOT SEAT:
      Identify the 3 most critical, high-stakes questions a property owner (Seller) would likely ask you about this specific analysis or the IE market. 
      Provide a concise, professional, and tactical answer for each.
      
      You identify red flags and value-add opportunities even from partial listing data.`,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            name: { type: Type.STRING },
            address: { type: Type.STRING },
            docType: { type: Type.STRING, enum: ["Listing", "Offering Memorandum", "Market Report"] },
            assetType: { type: Type.STRING, enum: ["Industrial", "Multifamily", "Retail", "Office", "Land", "Mixed Use", "Specialty"] },
            price: { type: Type.NUMBER },
            capRate: { type: Type.NUMBER },
            noi: { type: Type.NUMBER },
            units: { type: Type.NUMBER },
            squareFootage: { type: Type.NUMBER },
            yearBuilt: { type: Type.NUMBER },
            cashOnCashReturn: { type: Type.NUMBER, description: "Estimated Year-1 Cash-on-Cash return (%)" },
            debtCoverageRatio: { type: Type.NUMBER, description: "Calculated Debt Coverage Ratio (e.g. 1.25)" },
            loanAssumptions: {
              type: Type.OBJECT,
              properties: {
                ltv: { type: Type.NUMBER },
                interestRate: { type: Type.NUMBER },
                amortization: { type: Type.NUMBER }
              },
              required: ["ltv", "interestRate", "amortization"]
            },
            confidenceScore: { type: Type.NUMBER, description: "Data veracity score from 0-100" },
            hiddenGemScore: { type: Type.NUMBER, description: "Score from 1-100" },
            dealHeatRating: { type: Type.NUMBER, description: "Rating from 0-100" },
            redFlags: { type: Type.ARRAY, items: { type: Type.STRING } },
            valueAddOpportunities: { type: Type.ARRAY, items: { type: Type.STRING } },
            summary: { type: Type.STRING, description: "A one-sentence punchy summary for the dashboard card." },
            analysis: { type: Type.STRING, description: "Detailed professional analysis including historical context and underwriting rationale." },
            historicalComparison: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  period: { type: Type.STRING, description: "e.g., '2021 Peak', '2008 Crash', '2012 Recovery'" },
                  analysis: { type: Type.STRING, description: "How this property's metrics compare to that period." }
                },
                required: ["period", "analysis"]
              }
            },
            negotiationStrategy: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  target: { type: Type.STRING, enum: ["Seller", "Buyer"] },
                  doubt: { type: Type.STRING, description: "The specific objection or market fear." },
                  combat: { type: Type.STRING, description: "The strategic rebuttal or talking point." }
                },
                required: ["target", "doubt", "combat"]
              }
            },
            ownerCriticalQuestions: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  question: { type: Type.STRING },
                  answer: { type: Type.STRING }
                },
                required: ["question", "answer"]
              },
              maxItems: 3
            }
          },
          required: ["name", "assetType", "docType", "price", "hiddenGemScore", "dealHeatRating", "redFlags", "valueAddOpportunities", "summary", "analysis", "historicalComparison", "confidenceScore", "negotiationStrategy", "ownerCriticalQuestions"]
        }
      }
    }
  });

  return JSON.parse(response.text);
}

export async function generateMarketReport(deals: any[]): Promise<string> {
  const response = await ai.models.generateContent({
    model: "gemini-flash-latest",
    contents: `Based on these recent deals in the Inland Empire, generate a concise market report update.
    
    Recent Deals:
    ${JSON.stringify(deals)}
    `,
    config: {
      systemInstruction: "You are a seasoned Inland Empire Commercial Real Estate Agent. Provide a direct, practical market update focusing on pricing trends, cap rates, and rent levels compared to the 2021 peak.",
    }
  });

  return response.text;
}
