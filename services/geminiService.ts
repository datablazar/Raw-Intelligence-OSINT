
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
  QUERIES_SCHEMA,
  DEFAULT_REPORT_STRUCTURE
} from "../constants";
import { IntelligenceReport, Attachment, ResearchPlan, SourceReference, Entity, ReportSection, DeepResearchResult, ReportStructure, ResearchSectionResult } from "../types";

// --- SINGLETON CLIENT ---
let clientInstance: GoogleGenAI | null = null;

const getClient = () => {
  if (!process.env.API_KEY) {
    throw new Error("API Key is missing. Please ensure process.env.API_KEY is available.");
  }
  if (!clientInstance) {
    clientInstance = new GoogleGenAI({ apiKey: process.env.API_KEY });
  }
  return clientInstance;
};

// --- CLIENT SIDE UTILS ---

export const extractUrls = (text: string): string[] => {
  const urlRegex = /(https?:\/\/[^\s<>"'()[\]]+)/g;
  const matches = text.match(urlRegex);
  if (!matches) return [];
  // Clean punctuation from end of URLs
  return Array.from(new Set(matches.map(url => url.replace(/[.,;:"')\]}]+$/, ''))));
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

// SMART JSON PARSER: Extracts JSON from chatty responses
const safeParseJSON = <T>(text: string, fallback: T): T => {
  try {
    let cleanText = text.trim();
    
    // 1. Remove markdown code blocks if present
    if (cleanText.includes('```')) {
      cleanText = cleanText.replace(/```json/g, '').replace(/```/g, '');
    }

    // 2. Find the JSON object/array bounds
    const firstBrace = cleanText.indexOf('{');
    const firstBracket = cleanText.indexOf('[');
    
    let start = -1;
    let end = -1;

    // Determine if we are looking for an object or array
    if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
        start = firstBrace;
        end = cleanText.lastIndexOf('}') + 1;
    } else if (firstBracket !== -1) {
        start = firstBracket;
        end = cleanText.lastIndexOf(']') + 1;
    }

    if (start !== -1 && end !== -1) {
        cleanText = cleanText.substring(start, end);
    }

    return JSON.parse(cleanText) as T;
  } catch (e) {
    console.warn("JSON Parse Failed. Fallback triggered.", { textPreview: text.substring(0, 100) });
    return fallback;
  }
};

type LogCallback = (message: string, type: 'info' | 'network' | 'ai' | 'success' | 'planning' | 'synthesizing', activeTask?: string) => void;

// Helper to construct parts from text and attachments
const constructParts = (text: string, attachments: Attachment[] = []) => {
  const parts: any[] = [{ text }];
  attachments.forEach(att => {
    if (att.textContent) {
      let docContent = `\n[ATTACHED DOCUMENT: ${att.file.name}]\n`;
      if (att.context) docContent += `[USER CONTEXT: ${att.context}]\n`;
      docContent += `${att.textContent}\n[END DOCUMENT]\n`;
      parts.push({ text: docContent });
    } else if (att.base64) {
      if (att.context) {
          parts.push({ text: `[CONTEXT FOR NEXT MEDIA ASSET (${att.file.name}): ${att.context}]` });
      }
      parts.push({ inlineData: { data: att.base64, mimeType: att.mimeType } });
    }
  });
  return parts;
};

// --- PHASE 1: STRATEGY ---
export const runStrategyPhase = async (rawText: string, attachments: Attachment[], instructions: string, log: LogCallback): Promise<{ plan: ResearchPlan, entities: Entity[] }> => {
  const ai = getClient();
  const instructionWithUser = STRATEGY_AGENT_INSTRUCTION.replace('${userInstructions}', instructions);
  const contents = [{ role: 'user', parts: constructParts(`RAW INTEL: ${rawText.substring(0, 25000)}`, attachments) }];
  
  try {
    const [planRes, entityRes] = await Promise.all([
      ai.models.generateContent({
        model: 'gemini-3-pro-preview',
        contents: contents,
        config: {
          systemInstruction: instructionWithUser,
          responseMimeType: "application/json",
          responseSchema: RESEARCH_PLAN_SCHEMA,
          thinkingConfig: { thinkingBudget: 4096 }
        }
      }),
      ai.models.generateContent({
        model: 'gemini-3-pro-preview',
        contents: contents,
        config: {
          systemInstruction: ENTITY_AGENT_INSTRUCTION,
          responseMimeType: "application/json",
          responseSchema: ENTITY_LIST_SCHEMA,
          thinkingConfig: { thinkingBudget: 1024 }
        }
      })
    ]);

    const plan = safeParseJSON<ResearchPlan>(planRes.text || "{}", { 
        reliabilityAssessment: "Pending Analysis", informationGaps: [], searchQueries: [] 
    });
    
    // Fallback: Ensure at least one query exists if text is present
    if (plan.searchQueries.length === 0 && (rawText.length > 50 || attachments.length > 0)) {
        plan.searchQueries.push("Context and background investigation for provided intelligence");
    }

    const entities = safeParseJSON<{entities: Entity[]}>(entityRes.text || "{}", { entities: [] }).entities;

    return { plan, entities };

  } catch (error) {
    console.error("Strategy Phase Error", error);
    return {
        plan: { reliabilityAssessment: "Analysis Failed", informationGaps: [], searchQueries: [] },
        entities: []
    };
  }
};

// --- PHASE 2: RESEARCH ---
export const runResearchPhase = async (urls: string[], queries: string[], log: LogCallback): Promise<DeepResearchResult> => {
  const ai = getClient();
  const contextParts: string[] = [];
  const gatheredSources: Map<string, SourceReference> = new Map();

  // A. URL Deep Read
  if (urls.length > 0) {
    const urlTasks = urls.map(async (url) => {
      log(`Interrogating Source: ${url}`, 'network', url);
      try {
        const res = await ai.models.generateContent({
          model: 'gemini-3-pro-preview',
          contents: [{ role: 'user', parts: [{ text: `Analyze ${url}. Extract Title, Summary, Names, Dates, and Key Events. JSON Output.` }] }],
          config: { 
             responseMimeType: "application/json",
             tools: [{ googleSearch: {} }],
             thinkingConfig: { thinkingBudget: 1024 } 
          }
        });
        const data = safeParseJSON(res.text || "{}", { title: "", summary: "", content: "" });
        const title = data.title || formatSourceTitle(url);
        gatheredSources.set(url, { url, title, summary: data.summary || "Analyzed source." });
        return `[SOURCE: ${title}]\n${data.content || JSON.stringify(data)}`;
      } catch (e) {
        return `[SOURCE ERROR: ${url}]`;
      }
    });
    const urlResults = await Promise.all(urlTasks);
    contextParts.push(...urlResults);
  }

  // B. Google Search Grid
  if (queries.length > 0) {
    const batchSize = 5;
    for (let i = 0; i < queries.length; i += batchSize) {
        const batch = queries.slice(i, i + batchSize);
        const batchResults = await Promise.all(batch.map(async (q) => {
            log(`OSINT Grid Search: ${q}`, 'network', 'Search Grid');
            try {
                const res = await ai.models.generateContent({
                    model: 'gemini-3-pro-preview',
                    contents: [{ role: 'user', parts: [{ text: `Detailed report on: "${q}". List URLs used.` }] }],
                    config: { tools: [{ googleSearch: {} }] }
                });

                // Metadata Extraction
                res.candidates?.[0]?.groundingMetadata?.groundingChunks?.forEach((c: any) => {
                    if (c.web?.uri && !c.web.uri.includes('vertexaisearch')) {
                        gatheredSources.set(c.web.uri, {
                            url: c.web.uri,
                            title: c.web.title || formatSourceTitle(c.web.uri),
                            summary: `Source via query: "${q}"`
                        });
                    }
                });

                return `[QUERY: ${q}]\n${res.text || ""}`;
            } catch { return ""; }
        }));
        contextParts.push(...batchResults);
    }
  }

  return { context: contextParts.join("\n\n"), sources: Array.from(gatheredSources.values()) };
};

// --- PHASE 3: STRUCTURE ---
export const runStructurePhase = async (context: string, attachments: Attachment[], instructions: string, log: LogCallback): Promise<ReportStructure> => {
  const ai = getClient();
  const instructionWithUser = STRUCTURE_AGENT_INSTRUCTION.replace('${userInstructions}', instructions);
  const contents = [{ role: 'user', parts: constructParts(`CONTEXT:\n${context.substring(0, 30000)}`, attachments) }];

  try {
    const res = await ai.models.generateContent({
      model: 'gemini-3-pro-preview',
      contents: contents,
      config: {
        systemInstruction: instructionWithUser,
        responseMimeType: "application/json",
        responseSchema: STRUCTURE_SCHEMA,
        thinkingConfig: { thinkingBudget: 2048 }
      }
    });
    
    const structure = safeParseJSON<ReportStructure>(res.text || "{}", DEFAULT_REPORT_STRUCTURE as ReportStructure);
    if (!structure.sections || structure.sections.length === 0) return DEFAULT_REPORT_STRUCTURE as ReportStructure;
    return structure;
  } catch (e) {
      return DEFAULT_REPORT_STRUCTURE as ReportStructure;
  }
};

// --- PHASE 4: DRAFTING ---
export const runDraftingPhase = async (structure: ReportStructure, context: string, attachments: Attachment[], instructions: string, log: LogCallback): Promise<ReportSection[]> => {
  const ai = getClient();
  const baseInstruction = SECTION_AGENT_INSTRUCTION.replace('${userInstructions}', instructions);

  const sectionPromises = structure.sections.map(async (sectionPlan) => {
     log(`Drafting Component: ${sectionPlan.title}`, 'ai', sectionPlan.title);
     try {
         const parts = constructParts(`
            SECTION: ${sectionPlan.title}
            GUIDANCE: ${sectionPlan.guidance}
            CONTEXT: ${context.substring(0, 30000)}
         `, attachments);

         const res = await ai.models.generateContent({
            model: 'gemini-3-pro-preview',
            contents: [{ role: 'user', parts: parts }],
            config: {
                systemInstruction: baseInstruction,
                responseMimeType: "application/json",
                responseSchema: SECTION_CONTENT_SCHEMA,
                thinkingConfig: { thinkingBudget: 2048 }
            }
         });
         const contentData = safeParseJSON(res.text || "{}", { content: "Data insufficient." });
         return {
             title: sectionPlan.title,
             type: sectionPlan.type,
             content: contentData.content
         } as ReportSection;
     } catch (e) {
         return { title: sectionPlan.title, type: sectionPlan.type, content: "Processing error." } as ReportSection;
     }
  });

  return await Promise.all(sectionPromises);
};

// --- PHASE 5: FINALIZE ---
export const runFinalizePhase = async (sections: ReportSection[], reliability: string, instructions: string, log: LogCallback): Promise<any> => {
  const ai = getClient();
  const instructionWithUser = SUMMARY_AGENT_INSTRUCTION.replace('${userInstructions}', instructions);

  try {
      const res = await ai.models.generateContent({
        model: 'gemini-3-pro-preview',
        contents: [{ role: 'user', parts: [{ text: `BODY: ${JSON.stringify(sections)}\nRELIABILITY: ${reliability}` }] }],
        config: {
            systemInstruction: instructionWithUser,
            responseMimeType: "application/json",
            responseSchema: FINAL_METADATA_SCHEMA,
            thinkingConfig: { thinkingBudget: 2048 }
        }
      });
      return safeParseJSON(res.text || "{}", {
          classification: "OFFICIAL-SENSITIVE",
          reportTitle: "INTELLIGENCE REPORT",
          executiveSummary: "Summary generation failed.",
          overallConfidence: "Moderate Probability"
      });
  } catch {
      return {
          classification: "OFFICIAL-SENSITIVE",
          reportTitle: "INTELLIGENCE REPORT",
          executiveSummary: "Error during finalization.",
          overallConfidence: "Low Probability"
      };
  }
};

// --- UTILS ---

export const generateMoreQueries = async (rawText: string, currentQueries: string[], instructions: string): Promise<string[]> => {
  const ai = getClient();
  try {
      const response = await ai.models.generateContent({
        model: 'gemini-3-pro-preview',
        contents: [{ role: 'user', parts: [{ text: `Generate 5 gap-filling queries based on: ${rawText.substring(0,5000)}` }] }],
        config: {
          responseMimeType: "application/json",
          responseSchema: QUERIES_SCHEMA,
          thinkingConfig: { thinkingBudget: 1024 }
        }
      });
      return safeParseJSON<{queries: string[]}>(response.text || "{}", { queries: [] }).queries;
  } catch { return []; }
};

export const analyzeResearchCoverage = async (currentContext: string, originalGaps: string[], instructions: string): Promise<string[]> => {
  const ai = getClient();
  try {
      const response = await ai.models.generateContent({
        model: 'gemini-3-pro-preview',
        contents: [{ role: 'user', parts: [{ text: `Gaps: ${JSON.stringify(originalGaps)}. Context: ${currentContext.substring(0, 10000)}. Generate queries if needed.` }] }],
        config: {
          systemInstruction: GAP_ANALYSIS_INSTRUCTION,
          responseMimeType: "application/json",
          responseSchema: QUERIES_SCHEMA,
          thinkingConfig: { thinkingBudget: 1024 }
        }
      });
      return safeParseJSON<{queries: string[]}>(response.text || "{}", { queries: [] }).queries;
  } catch { return []; }
};

export const identifyStructuralGaps = async (structure: ReportStructure, currentContext: string): Promise<string[]> => {
  const ai = getClient();
  try {
      const response = await ai.models.generateContent({
        model: 'gemini-3-pro-preview',
        contents: [{ role: 'user', parts: [{ text: `Structure: ${JSON.stringify(structure)}. Context: ${currentContext.substring(0, 10000)}. Missing info?` }] }],
        config: {
          systemInstruction: STRUCTURAL_COVERAGE_INSTRUCTION,
          responseMimeType: "application/json",
          responseSchema: QUERIES_SCHEMA,
          thinkingConfig: { thinkingBudget: 1024 }
        }
      });
      return safeParseJSON<{queries: string[]}>(response.text || "{}", { queries: [] }).queries;
  } catch { return []; }
};

export const conductTacticalResearch = async (queries: string[], log: LogCallback): Promise<DeepResearchResult> => {
    return runResearchPhase([], queries, log);
};

// --- CHAT TOOLS ---
const editReportTool: FunctionDeclaration = {
    name: 'edit_report_section',
    description: 'Update or create a report section.',
    parameters: {
      type: Type.OBJECT,
      properties: { sectionTitle: { type: Type.STRING }, content: { type: Type.STRING } },
      required: ['sectionTitle', 'content']
    }
};

const addSourcesTool: FunctionDeclaration = {
    name: 'add_sources_to_report',
    description: 'Add new verified URLs.',
    parameters: {
      type: Type.OBJECT,
      properties: { urls: { type: Type.ARRAY, items: { type: Type.STRING } } },
      required: ['urls']
    }
};

const searchGoogleTool: FunctionDeclaration = {
    name: 'search_google',
    description: 'Perform a Google Search.',
    parameters: {
      type: Type.OBJECT,
      properties: { query: { type: Type.STRING } },
      required: ['query']
    }
};

export const createReportChatSession = (report: IntelligenceReport, rawContext: string) => {
    const ai = getClient();
    return ai.chats.create({
      model: 'gemini-3-pro-preview',
      config: {
        systemInstruction: `You are 'Sentinel Assistant'. Report: ${JSON.stringify(report)}. Raw: ${rawContext.substring(0,2000)}. Protocol: Professional UK Intelligence.`,
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
        contents: [{ role: 'user', parts: [{ text: `Search: "${query}". Summarize.` }] }],
        config: { tools: [{ googleSearch: {} }] }
      });
      return response.text || "No results.";
    } catch { return "Search failed."; }
};
  
export const sendChatMessage = async (chat: Chat, message: string, attachments: Attachment[] = []) => {
    const parts: any[] = [];
    if (message.trim()) parts.push({ text: message });
    attachments.forEach(att => {
        if (att.textContent) {
            let docContent = `\n[ATTACHED DOCUMENT: ${att.file.name}]\n`;
            if (att.context) docContent += `[USER CONTEXT: ${att.context}]\n`;
            docContent += `${att.textContent}\n[END DOCUMENT]\n`;
            parts.push({ text: docContent });
        } else if (att.base64) {
            if (att.context) {
                parts.push({ text: `[CONTEXT FOR NEXT MEDIA ASSET (${att.file.name}): ${att.context}]` });
            }
            parts.push({ inlineData: { data: att.base64, mimeType: att.mimeType } });
        }
    });
    return await chat.sendMessage({ message: parts });
};

export const refineSection = async (report: IntelligenceReport, sectionTitle: string, instruction: string): Promise<any> => {
    const ai = getClient();
    const section = report.sections.find(s => s.title === sectionTitle);
    if (!section) throw new Error("Section not found");
  
    const prompt = `Refine section '${sectionTitle}'. Instruction: ${instruction}. Current: ${JSON.stringify(section.content)}`;
    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-preview',
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        responseMimeType: "application/json",
        responseSchema: SECTION_CONTENT_SCHEMA,
        thinkingConfig: { thinkingBudget: 1024 }
      }
    });
    return safeParseJSON(response.text || "{}", { content: section.content }).content;
};

export interface VerificationResult {
    status: 'Verified' | 'Disputed' | 'Inconclusive' | 'Analysis';
    explanation: string;
}
  
export const verifyClaim = async (claim: string): Promise<VerificationResult & { groundingMetadata: any }> => {
    const ai = getClient();
    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-preview',
      contents: [{ role: 'user', parts: [{ text: `Verify: "${claim}". JSON Output.` }] }],
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
    return { 
        ...safeParseJSON<VerificationResult>(response.text || "{}", { status: "Inconclusive", explanation: "Error." }), 
        groundingMetadata: response.candidates?.[0]?.groundingMetadata 
    };
};

export const conductDeepResearch = async (topic: string, fullContext: string): Promise<ResearchSectionResult> => {
    const ai = getClient();
    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-preview',
      contents: [{ role: 'user', parts: [{ text: `Deep research on "${topic}". Context: ${fullContext.substring(0, 10000)}` }] }],
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
              items: { type: Type.OBJECT, properties: { url: { type: Type.STRING }, title: { type: Type.STRING }, summary: { type: Type.STRING } } } 
            }
          },
          required: ["title", "content", "links"]
        },
        thinkingConfig: { thinkingBudget: 4096 }
      }
    });
    
    const result = safeParseJSON(response.text || "{}", { title: topic, content: "Research failed.", links: [] });
    // Merge grounding links (fallback)
    const groundingLinks = response.candidates?.[0]?.groundingMetadata?.groundingChunks
      ?.map((c: any) => ({ 
          url: c.web?.uri, 
          title: c.web?.title || formatSourceTitle(c.web?.uri), 
          summary: 'Search Result' 
      }))
      .filter((s: any) => s.url && !s.url.includes('vertexaisearch')) || [];
  
    return { ...result, links: [...(result.links || []), ...groundingLinks] };
};