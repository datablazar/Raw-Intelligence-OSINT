
import { GoogleGenAI, Type, Chat, FunctionDeclaration } from "@google/genai";
import { 
  STRATEGY_AGENT_INSTRUCTION, 
  ENTITY_AGENT_INSTRUCTION, 
  STRUCTURE_AGENT_INSTRUCTION,
  SECTION_AGENT_INSTRUCTION,
  SUMMARY_AGENT_INSTRUCTION,
  GAP_ANALYSIS_INSTRUCTION,
  STRUCTURAL_COVERAGE_INSTRUCTION,
  RESEARCH_PLAN_SCHEMA,
  ENTITY_LIST_SCHEMA,
  STRUCTURE_SCHEMA,
  SECTION_CONTENT_SCHEMA,
  FINAL_METADATA_SCHEMA,
  QUERIES_SCHEMA
} from "../constants";
import { IntelligenceReport, Attachment, ResearchPlan, SourceReference, Entity, ReportSection, DeepResearchResult, ReportStructure, ResearchSectionResult } from "../types";

const getClient = () => {
  if (!process.env.API_KEY) {
    throw new Error("API Key is missing. Please ensure process.env.API_KEY is available.");
  }
  return new GoogleGenAI({ apiKey: process.env.API_KEY });
};

export const extractUrls = (text: string): string[] => {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const matches = text.match(urlRegex);
  if (!matches) return [];
  // Clean trailing punctuation which simple regex often captures
  return Array.from(new Set(matches.map(url => url.replace(/[.,;:"')\]]+$/, ''))));
};

const formatSourceTitle = (url: string): string => {
  try {
    const hostname = new URL(url).hostname;
    const name = hostname.replace(/^www\./, '');
    return name.charAt(0).toUpperCase() + name.slice(1);
  } catch {
    return "External Source";
  }
};

type LogCallback = (message: string, type: 'info' | 'network' | 'ai' | 'success' | 'planning' | 'synthesizing', activeTask?: string) => void;

// --- PHASE 1: STRATEGY & TRIAGE ---
export const runStrategyPhase = async (rawText: string, instructions: string, log: LogCallback): Promise<{ plan: ResearchPlan, entities: Entity[] }> => {
  const ai = getClient();
  const instructionWithUser = STRATEGY_AGENT_INSTRUCTION.replace('${userInstructions}', instructions);
  
  const [planRes, entityRes] = await Promise.all([
    ai.models.generateContent({
      model: 'gemini-3-pro-preview',
      contents: [{ role: 'user', parts: [{ text: `RAW INTEL: ${rawText.substring(0, 20000)}` }] }],
      config: {
        systemInstruction: instructionWithUser,
        responseMimeType: "application/json",
        responseSchema: RESEARCH_PLAN_SCHEMA,
        thinkingConfig: { thinkingBudget: 2048 }
      }
    }),
    ai.models.generateContent({
      model: 'gemini-3-pro-preview',
      contents: [{ role: 'user', parts: [{ text: `RAW INTEL: ${rawText.substring(0, 20000)}` }] }],
      config: {
        systemInstruction: ENTITY_AGENT_INSTRUCTION,
        responseMimeType: "application/json",
        responseSchema: ENTITY_LIST_SCHEMA,
        thinkingConfig: { thinkingBudget: 1024 }
      }
    })
  ]);

  return {
    plan: JSON.parse(planRes.text || "{}"),
    entities: (JSON.parse(entityRes.text || "{}") as any).entities || []
  };
};

// --- HELPER: GENERATE MORE QUERIES ---
export const generateMoreQueries = async (rawText: string, currentQueries: string[], instructions: string): Promise<string[]> => {
  const ai = getClient();
  const prompt = `
    ROLE: Intelligence Research Planner.
    TASK: Generate 5 additional, distinct search queries to investigate the following intelligence subject.
    
    CONTEXT: ${rawText.substring(0, 10000)}
    USER INSTRUCTIONS: ${instructions}
    EXISTING QUERIES (Do not duplicate): ${JSON.stringify(currentQueries)}
    
    OUTPUT: JSON Array of strings. Example: { "queries": ["query 1", "query 2"] }
  `;

  const response = await ai.models.generateContent({
    model: 'gemini-3-pro-preview',
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    config: {
      responseMimeType: "application/json",
      responseSchema: QUERIES_SCHEMA,
      thinkingConfig: { thinkingBudget: 1024 }
    }
  });

  const result = JSON.parse(response.text || "{}");
  return result.queries || [];
};

// --- NEW HELPER: ANALYZE RESEARCH GAP (FEEDBACK LOOP) ---
export const analyzeResearchCoverage = async (
  currentContext: string, 
  originalGaps: string[], 
  instructions: string
): Promise<string[]> => {
  const ai = getClient();
  const prompt = `
    ORIGINAL INFO GAPS: ${JSON.stringify(originalGaps)}
    MISSION INSTRUCTIONS: ${instructions}
    
    GATHERED INTELLIGENCE SUMMARY (First 25k chars):
    ${currentContext.substring(0, 25000)}
    
    TASK: Analyze if the gathered intelligence sufficiently covers the gaps and instructions.
    If coverage is weak for any critical area, generate 3-5 high-value, specific search queries to target the missing info.
    If coverage is sufficient, return empty array.
  `;

  const response = await ai.models.generateContent({
    model: 'gemini-3-pro-preview',
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    config: {
      systemInstruction: GAP_ANALYSIS_INSTRUCTION,
      responseMimeType: "application/json",
      responseSchema: QUERIES_SCHEMA,
      thinkingConfig: { thinkingBudget: 1024 }
    }
  });

  const result = JSON.parse(response.text || "{}");
  return result.queries || [];
};

// --- NEW HELPER: IDENTIFY STRUCTURAL GAPS (PRE-DRAFTING CHECK) ---
export const identifyStructuralGaps = async (
  structure: ReportStructure, 
  currentContext: string
): Promise<string[]> => {
  const ai = getClient();
  const prompt = `
    PROPOSED REPORT STRUCTURE:
    ${JSON.stringify(structure)}
    
    AVAILABLE INTELLIGENCE (First 25k chars):
    ${currentContext.substring(0, 25000)}
    
    TASK: Identify if any section in the structure lacks sufficient data in the available intelligence.
    Generate targeted search queries for any unsupported sections.
    Return empty array if all sections have data.
  `;

  const response = await ai.models.generateContent({
    model: 'gemini-3-pro-preview',
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    config: {
      systemInstruction: STRUCTURAL_COVERAGE_INSTRUCTION,
      responseMimeType: "application/json",
      responseSchema: QUERIES_SCHEMA,
      thinkingConfig: { thinkingBudget: 1024 }
    }
  });

  const result = JSON.parse(response.text || "{}");
  return result.queries || [];
};

// --- PHASE 2: DEEP RESEARCH ---
export const runResearchPhase = async (urls: string[], queries: string[], log: LogCallback): Promise<DeepResearchResult> => {
  const ai = getClient();
  const contextParts: string[] = [];
  const gatheredSources: Map<string, SourceReference> = new Map();

  // A. URL Deep Read
  if (urls.length > 0) {
    const urlTasks = urls.map(async (url) => {
      log(`Scanning: ${url}`, 'network', url);
      try {
        const res = await ai.models.generateContent({
          model: 'gemini-3-pro-preview',
          contents: [{ role: 'user', parts: [{ text: `Analyze ${url}. Extract Title, Summary, Names, Dates, and Key Events relevant to intelligence reporting. JSON Output.` }] }],
          config: { 
             responseMimeType: "application/json",
             tools: [{ googleSearch: {} }],
             thinkingConfig: { thinkingBudget: 1024 } 
          }
        });
        const data = JSON.parse(res.text || "{}");
        const title = data.title || formatSourceTitle(url);
        gatheredSources.set(url, { url, title, summary: data.summary || "Analyzed source." });
        return `[SOURCE: ${title}]\n${data.content || JSON.stringify(data)}`;
      } catch (e) {
        gatheredSources.set(url, { url, title: formatSourceTitle(url), summary: "Source accessed." });
        return `[SOURCE ERROR: ${url}]`;
      }
    });
    const urlResults = await Promise.all(urlTasks);
    contextParts.push(...urlResults);
  }

  // B. Google Search
  if (queries.length > 0) {
    const queryTasks = queries.slice(0, 15).map(async (q) => {
      log(`Searching: ${q}`, 'network', 'Search Grid');
      try {
        const res = await ai.models.generateContent({
          model: 'gemini-3-pro-preview',
          contents: [{ role: 'user', parts: [{ text: `Search for: "${q}". Provide a detailed intelligence summary including specific dates, entities, and confirmed events.` }] }],
          config: { tools: [{ googleSearch: {} }] }
        });
        
        // 1. Capture Grounding Metadata
        res.candidates?.[0]?.groundingMetadata?.groundingChunks?.forEach((c: any) => {
           if (c.web?.uri && !c.web.uri.includes('vertexaisearch')) {
               gatheredSources.set(c.web.uri, {
                   url: c.web.uri,
                   title: c.web.title || formatSourceTitle(c.web.uri),
                   summary: `Found via search: "${q}"`
               });
           }
        });

        // 2. Capture URLs in text
        const textResponse = res.text || "";
        const fallbackUrls = extractUrls(textResponse);
        fallbackUrls.forEach(u => {
             if (u.length > 10 && !gatheredSources.has(u)) {
                gatheredSources.set(u, {
                   url: u,
                   title: formatSourceTitle(u),
                   summary: `Referenced in search result for: "${q}"`
                });
             }
        });

        return `[SEARCH QUERY: ${q}]\n${textResponse}`;
      } catch { return ""; }
    });
    const results = await Promise.all(queryTasks);
    results.forEach(r => { if(r) contextParts.push(r); });
  }

  return { context: contextParts.join("\n\n"), sources: Array.from(gatheredSources.values()) };
};

// --- TACTICAL RESEARCH BURST (For Gap Filling) ---
export const conductTacticalResearch = async (queries: string[], log: LogCallback): Promise<DeepResearchResult> => {
    // Re-use the existing logic but optimized for speed (no URL deep reads, just search)
    return runResearchPhase([], queries, log);
};

// --- PHASE 3: STRUCTURE ---
export const runStructurePhase = async (context: string, instructions: string, log: LogCallback): Promise<ReportStructure> => {
  const ai = getClient();
  const instructionWithUser = STRUCTURE_AGENT_INSTRUCTION.replace('${userInstructions}', instructions);

  const res = await ai.models.generateContent({
    model: 'gemini-3-pro-preview',
    contents: [{ role: 'user', parts: [{ text: `CONTEXT:\n${context.substring(0, 30000)}` }] }],
    config: {
      systemInstruction: instructionWithUser,
      responseMimeType: "application/json",
      responseSchema: STRUCTURE_SCHEMA,
      thinkingConfig: { thinkingBudget: 2048 }
    }
  });
  return JSON.parse(res.text || "{}") as ReportStructure;
};

// --- PHASE 4: DRAFTING ---
export const runDraftingPhase = async (structure: ReportStructure, context: string, instructions: string, log: LogCallback): Promise<ReportSection[]> => {
  const ai = getClient();
  // Enhanced instructions to prevent header repetition and markdown artifacts
  const baseInstruction = SECTION_AGENT_INSTRUCTION.replace('${userInstructions}', instructions);
  const strictInstruction = `${baseInstruction}
  
  **IMPORTANT FORMATTING RULES:**
  1. Do NOT repeat the section title in your output.
  2. Do NOT use markdown headers (e.g., #, ##, ###).
  3. Start directly with the content paragraphs or list items.
  4. Output purely the body content for the section.
  `;

  const sectionPromises = structure.sections.map(async (sectionPlan) => {
     log(`Drafting: ${sectionPlan.title}`, 'ai', sectionPlan.title);
     const res = await ai.models.generateContent({
        model: 'gemini-3-pro-preview',
        contents: [{ role: 'user', parts: [{ text: `
            SECTION TITLE: ${sectionPlan.title}
            SPECIFIC GUIDANCE: ${sectionPlan.guidance}
            CONTEXT: ${context.substring(0, 30000)}
        ` }] }],
        config: {
            systemInstruction: strictInstruction,
            responseMimeType: "application/json",
            responseSchema: SECTION_CONTENT_SCHEMA,
            thinkingConfig: { thinkingBudget: 2048 }
        }
     });
     const contentData = JSON.parse(res.text || "{}");
     return {
         title: sectionPlan.title,
         type: sectionPlan.type,
         content: contentData.content
     } as ReportSection;
  });

  return await Promise.all(sectionPromises);
};

// --- PHASE 5: FINALIZE ---
export const runFinalizePhase = async (sections: ReportSection[], reliability: string, instructions: string, log: LogCallback): Promise<any> => {
  const ai = getClient();
  const instructionWithUser = SUMMARY_AGENT_INSTRUCTION.replace('${userInstructions}', instructions);

  const res = await ai.models.generateContent({
    model: 'gemini-3-pro-preview',
    contents: [{ role: 'user', parts: [{ text: `
        BODY: ${JSON.stringify(sections)}
        RELIABILITY: ${reliability}
        Generate Executive Summary.
    ` }] }],
    config: {
        systemInstruction: instructionWithUser,
        responseMimeType: "application/json",
        responseSchema: FINAL_METADATA_SCHEMA,
        thinkingConfig: { thinkingBudget: 2048 }
    }
  });
  return JSON.parse(res.text || "{}");
};

// --- TOOLS (Unchanged) ---
const editReportTool: FunctionDeclaration = {
    name: 'edit_report_section',
    description: 'Update or create a specific section of the intelligence report.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        sectionTitle: { type: Type.STRING },
        content: { type: Type.STRING }
      },
      required: ['sectionTitle', 'content']
    }
};

const addSourcesTool: FunctionDeclaration = {
    name: 'add_sources_to_report',
    description: 'Add new verified source URLs.',
    parameters: {
      type: Type.OBJECT,
      properties: { urls: { type: Type.ARRAY, items: { type: Type.STRING } } },
      required: ['urls']
    }
};

const searchGoogleTool: FunctionDeclaration = {
    name: 'search_google',
    description: 'Perform a Google Search to verify facts or gather information.',
    parameters: {
      type: Type.OBJECT,
      properties: { query: { type: Type.STRING } },
      required: ['query']
    }
};

export const createReportChatSession = (report: IntelligenceReport, rawContext: string) => {
    const ai = getClient();
    const systemContext = `
      You are 'Sentinel Assistant'. Context: Analysis of INTREP ${report.referenceNumber}.
      Report Data: ${JSON.stringify(report)}
      Raw Data Snippet: ${rawContext.substring(0, 2000)}...
      Mission: Verify facts, edit report, add sources.
      Protocol: Concise, professional, British English.
    `;
    return ai.chats.create({
      model: 'gemini-3-pro-preview',
      config: {
        systemInstruction: systemContext,
        thinkingConfig: { thinkingBudget: 1024 },
        tools: [{ functionDeclarations: [editReportTool, addSourcesTool, searchGoogleTool] }]
      }
    });
};
  
export const performSearchQuery = async (query: string): Promise<string> => {
    const ai = getClient();
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-3-pro-preview',
        contents: [{ role: 'user', parts: [{ text: `Search for: "${query}". Summarize key findings and list URLs.` }] }],
        config: { 
          tools: [{ googleSearch: {} }] 
        }
      });
      return response.text || "No search results available.";
    } catch (e) {
      console.error("Search tool error:", e);
      return "Search failed.";
    }
};
  
export const sendChatMessage = async (chat: Chat, message: string, attachments: Attachment[] = []) => {
    const parts: any[] = [];
    if (message.trim()) parts.push({ text: message });
    attachments.forEach(att => parts.push({ inlineData: { data: att.base64, mimeType: att.mimeType } }));
    return await chat.sendMessage({ message: parts });
};

export const refineSection = async (report: IntelligenceReport, sectionTitle: string, instruction: string): Promise<any> => {
    const ai = getClient();
    const section = report.sections.find(s => s.title === sectionTitle);
    if (!section) throw new Error("Section not found");
  
    const prompt = `Refine section '${sectionTitle}'. Instruction: ${instruction}. Current Content: ${JSON.stringify(section.content)}`;
  
    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-preview',
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        responseMimeType: "application/json",
        responseSchema: SECTION_CONTENT_SCHEMA, // Use the smaller schema
        thinkingConfig: { thinkingBudget: 1024 }
      }
    });
    const result = JSON.parse(response.text || "{}");
    return result.content;
};

export interface VerificationResult {
    status: 'Verified' | 'Disputed' | 'Inconclusive' | 'Analysis';
    explanation: string;
}
  
export const verifyClaim = async (claim: string): Promise<VerificationResult & { groundingMetadata: any }> => {
    const ai = getClient();
    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-preview',
      contents: [{ role: 'user', parts: [{ text: `Verify claim: "${claim}". Return JSON status/explanation.` }] }],
      config: {
        tools: [{ googleSearch: {} }],
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            status: { type: Type.STRING, enum: ["Verified", "Disputed", "Inconclusive", "Analysis"] },
            explanation: { type: Type.STRING }
          },
          required: ["status", "explanation"]
        }
      }
    });
    const result = JSON.parse(response.text || "{}");
    return { ...result, groundingMetadata: response.candidates?.[0]?.groundingMetadata };
};

export const conductDeepResearch = async (topic: string, fullContext: string): Promise<ResearchSectionResult> => {
    const ai = getClient();
    const prompt = `
      TASK: Deep research on "${topic}". 
      CONTEXT: ${fullContext}
      OUTPUT: JSON with title, detailed content, and links (with title/summary).
    `;
    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-preview',
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        tools: [{ googleSearch: {} }],
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            content: { type: Type.STRING },
            links: { 
              type: Type.ARRAY, 
              items: { 
                type: Type.OBJECT, 
                properties: { 
                   url: { type: Type.STRING }, 
                   title: { type: Type.STRING },
                   summary: { type: Type.STRING } 
                } 
              } 
            }
          },
          required: ["title", "content", "links"]
        },
        thinkingConfig: { thinkingBudget: 4096 }
      }
    });
    
    const result = JSON.parse(response.text || "{}");
    
    // Merge grounding links if any (fallback)
    const groundingLinks = response.candidates?.[0]?.groundingMetadata?.groundingChunks
      ?.map((c: any) => ({ 
          url: c.web?.uri, 
          title: c.web?.title || formatSourceTitle(c.web?.uri), 
          summary: 'Identified via Search Grounding' 
      }))
      .filter((s: any) => s.url && !s.url.includes('vertexaisearch')) || [];
  
    const mergedLinks = [...(result.links || [])];
    groundingLinks.forEach((gl: any) => {
       if (!mergedLinks.find(l => l.url === gl.url)) mergedLinks.push(gl);
    });
  
    return { ...result, links: mergedLinks };
};
