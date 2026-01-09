
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
import { IntelligenceReport, Attachment, ResearchPlan, SourceReference, Entity, ReportSection, DeepResearchResult, ReportStructure, ResearchSectionResult, FailedSource } from "../types";

// --- CONFIGURATION ---
// Primary Models
const MODEL_FAST = 'gemini-3-flash-preview';
const MODEL_QUALITY = 'gemini-3-pro-preview';
// Fallback Model (Reliable, Standard Tier)
const MODEL_FALLBACK = 'gemini-2.0-flash';

// Tiers allow balancing cost/latency. 
const CONFIG_EXTRACTION = { responseMimeType: "application/json" };
const CONFIG_REASONING = { responseMimeType: "application/json", thinkingConfig: { thinkingBudget: 2048 } };
const CONFIG_DEEP_THINKING = { responseMimeType: "application/json", thinkingConfig: { thinkingBudget: 4096 } };

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

// --- ERROR HANDLING & RETRY LOGIC ---

/**
 * Wraps generateContent with robust error handling.
 * Throws specific errors for UI handling instead of automatic fallback.
 */
const generateSafe = async (params: { model: string, contents: any, config?: any }, attempt = 1): Promise<any> => {
  const ai = getClient();
  try {
    return await ai.models.generateContent(params);
  } catch (e: any) {
    const msg = e.toString().toLowerCase();
    const isRateLimit = msg.includes("429") || msg.includes("quota") || msg.includes("resource_exhausted");
    
    if (isRateLimit) {
        if (attempt > 3) {
            // Throw specific string for UI to catch
            throw new Error("QUOTA_EXCEEDED");
        }
        
        // Critical: Handle Limit 0 immediately without retry loops if possible, 
        // but now we throw to let UI decide.
        if (msg.includes("limit: 0") || msg.includes("not found") || msg.includes("404")) {
             throw new Error("QUOTA_EXCEEDED");
        }

        // Standard Exponential Backoff for transient rate limits
        const delay = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s
        console.warn(`[Sentinel] Rate limit hit. Retrying in ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
        return generateSafe(params, attempt + 1);
    }
    throw e;
  }
};

// --- CLIENT SIDE UTILS ---

export const extractUrls = (text: string): string[] => {
  const urlRegex = /(https?:\/\/[^\s<>"'()[\]]+)/g;
  const matches = text.match(urlRegex);
  if (!matches) return [];
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

const isValidSourceUrl = (url: string): boolean => {
    return !url.includes('vertexaisearch') && !url.includes('google.com/search') && !url.includes('google.com/url');
};

const safeParseJSON = <T>(text: string, fallback: T): T => {
  try {
    let cleanText = text.trim();
    cleanText = cleanText.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/, '');
    
    const firstBrace = cleanText.indexOf('{');
    const firstBracket = cleanText.indexOf('[');
    let start = -1;
    let end = -1;

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
    console.warn("JSON Parse Error:", e);
    return fallback;
  }
};

type LogCallback = (message: string, type: 'info' | 'network' | 'ai' | 'success' | 'planning' | 'synthesizing', details?: string[]) => void;

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

// --- HELPER: GET MODEL CONFIG ---
const getModelConfig = (useFallback: boolean, type: 'quality' | 'fast') => {
    if (useFallback) return { model: MODEL_FALLBACK, config: CONFIG_EXTRACTION }; // Fallback usually doesn't support thinking
    
    if (type === 'quality') return { model: MODEL_QUALITY, config: CONFIG_DEEP_THINKING };
    return { model: MODEL_FAST, config: CONFIG_EXTRACTION };
};

// --- PHASE 1: STRATEGY ---
export const runStrategyPhase = async (rawText: string, attachments: Attachment[], instructions: string, log: LogCallback, useFallback = false): Promise<{ plan: ResearchPlan, entities: Entity[] }> => {
  const instructionWithUser = STRATEGY_AGENT_INSTRUCTION.replace('${userInstructions}', instructions);
  
  const isPureResearch = (!rawText || rawText.trim().length === 0) && (!attachments || attachments.length === 0);
  
  let userPromptText = "";
  if (isPureResearch) {
      userPromptText = `MISSION OBJECTIVE / RESEARCH TOPIC: ${instructions}`;
  } else {
      userPromptText = `RAW INTEL: ${rawText.substring(0, 25000)}`;
  }

  const contents = [{ role: 'user', parts: constructParts(userPromptText, attachments) }];
  const modelSettings = getModelConfig(useFallback, 'quality');

  try {
    // Run Strategy and Entity Extraction.
    const [planRes, entityRes] = await Promise.all([
      generateSafe({
        model: modelSettings.model,
        contents: contents,
        config: {
          ...modelSettings.config,
          systemInstruction: instructionWithUser,
          responseSchema: RESEARCH_PLAN_SCHEMA,
        }
      }),
      generateSafe({
        model: modelSettings.model,
        contents: contents,
        config: {
          ...modelSettings.config, // Downgrade thinking for entities if needed
          thinkingConfig: useFallback ? undefined : { thinkingBudget: 2048 },
          systemInstruction: ENTITY_AGENT_INSTRUCTION,
          responseSchema: ENTITY_LIST_SCHEMA,
        }
      })
    ]);

    const plan = safeParseJSON<ResearchPlan>(planRes.text || "{}", { 
        reliabilityAssessment: "Pending Analysis", informationGaps: [], searchQueries: [] 
    });
    
    if (plan.searchQueries.length === 0) {
        if (isPureResearch && instructions) {
            plan.searchQueries.push(`Comprehensive background research on: ${instructions}`);
        } else if (rawText.length > 50 || attachments.length > 0) {
            plan.searchQueries.push("Context and background investigation for provided intelligence");
        }
    }

    const entities = safeParseJSON<{entities: Entity[]}>(entityRes.text || "{}", { entities: [] }).entities;

    return { plan, entities };

  } catch (error) {
    console.error("Strategy Phase Error", error);
    throw error; // Bubble up for UI handling
  }
};

// --- HELPER: EXECUTE SINGLE VECTOR ---
const executeSearchVector = async (query: string, log: LogCallback, useFallback = false): Promise<{ text: string, sources: SourceReference[] }> => {
    log(`Initializing Search Vector: "${query}"`, 'network');
    const modelSettings = getModelConfig(useFallback, 'fast');
    
    try {
        const res = await generateSafe({
            model: modelSettings.model, 
            contents: [{ role: 'user', parts: [{ text: `Detailed report on: "${query}". Include list of source URLs used at the end.` }] }],
            config: { tools: [{ googleSearch: {} }] } 
        });

        const gatheredSources: SourceReference[] = [];
        const rawUrls: string[] = [];

        // 1. Capture Grounding Metadata
        res.candidates?.[0]?.groundingMetadata?.groundingChunks?.forEach((c: any) => {
            const uri = c.web?.uri;
            if (uri && isValidSourceUrl(uri)) {
                rawUrls.push(uri);
                gatheredSources.push({
                    url: uri,
                    title: c.web.title || formatSourceTitle(uri),
                    summary: `Source via query: "${query}"`
                });
            }
        });

        // 2. Fallback Text Extraction
        const textResponse = res.text || "";
        const textUrls = extractUrls(textResponse);
        textUrls.forEach(url => {
            if (isValidSourceUrl(url) && !rawUrls.includes(url)) {
                rawUrls.push(url);
                gatheredSources.push({
                    url: url,
                    title: formatSourceTitle(url),
                    summary: `Extracted from analysis of "${query}"`
                });
            }
        });

        if (rawUrls.length > 0) {
            log(`Data Acquired: "${query}"`, 'success', rawUrls);
        } else {
            log(`Search Complete (No Direct Links): "${query}"`, 'info');
        }

        return { text: `[QUERY: ${query}]\n${textResponse}`, sources: gatheredSources };

    } catch (e) {
        log(`Vector Failed: "${query}"`, 'info');
        return { text: "", sources: [] };
    }
};

// --- PHASE 2: RESEARCH ---
export const runResearchPhase = async (urls: string[], queries: string[], log: LogCallback, useFallback = false): Promise<DeepResearchResult> => {
  const contextParts: string[] = [];
  const gatheredSources: Map<string, SourceReference> = new Map();
  const failedUrls: FailedSource[] = [];
  const modelSettings = getModelConfig(useFallback, 'fast');

  // A. URL Deep Read
  if (urls.length > 0) {
    const urlTasks = urls.map(async (url) => {
      log(`Interrogating Direct Source: ${url}`, 'network');
      try {
        const res = await generateSafe({
          model: modelSettings.model, 
          contents: [{ role: 'user', parts: [{ text: `Analyze ${url}. Extract Title, Summary, Names, Dates, and Key Events. JSON Output.` }] }],
          config: { ...CONFIG_EXTRACTION, tools: [{ googleSearch: {} }] }
        });
        
        if (!res.text) throw new Error("Empty response");

        const data = safeParseJSON(res.text || "{}", { title: "", summary: "", content: "" });
        const title = data.title || formatSourceTitle(url);
        
        if (isValidSourceUrl(url)) {
            gatheredSources.set(url, { url, title, summary: data.summary || "Analyzed source." });
        }
        return `[SOURCE: ${title}]\n${data.content || JSON.stringify(data)}`;
      } catch (e: any) {
        log(`Failed to access: ${url}`, 'info');
        failedUrls.push({
            url: url,
            reason: e.message || "Access Denied / Timeout",
            isHighValue: true
        });
        return `[SOURCE ERROR: ${url}]`;
      }
    });
    
    // Run URL tasks
    const urlResults = await Promise.all(urlTasks);
    contextParts.push(...urlResults);
  }

  // B. Google Search Grid
  if (queries.length > 0) {
    const batchSize = 3; 
    for (let i = 0; i < queries.length; i += batchSize) {
        const batch = queries.slice(i, i + batchSize);
        const batchResults = await Promise.all(batch.map(q => executeSearchVector(q, log, useFallback)));
        
        batchResults.forEach(res => {
            if (res.text) contextParts.push(res.text);
            res.sources.forEach(s => gatheredSources.set(s.url, s));
        });
        
        if (i + batchSize < queries.length) {
            await new Promise(r => setTimeout(r, 1000));
        }
    }
  }

  return { 
      context: contextParts.join("\n\n"), 
      sources: Array.from(gatheredSources.values()),
      failedUrls: failedUrls
  };
};

// --- PHASE 3: STRUCTURE ---
export const runStructurePhase = async (context: string, attachments: Attachment[], instructions: string, log: LogCallback, useFallback = false): Promise<ReportStructure> => {
  const instructionWithUser = STRUCTURE_AGENT_INSTRUCTION.replace('${userInstructions}', instructions);
  const contents = [{ role: 'user', parts: constructParts(`CONTEXT:\n${context.substring(0, 30000)}`, attachments) }];
  const modelSettings = getModelConfig(useFallback, 'quality');

  try {
    const res = await generateSafe({
      model: modelSettings.model,
      contents: contents,
      config: {
        ...modelSettings.config,
        systemInstruction: instructionWithUser,
        responseSchema: STRUCTURE_SCHEMA,
      }
    });
    
    const structure = safeParseJSON<ReportStructure>(res.text || "{}", DEFAULT_REPORT_STRUCTURE as ReportStructure);
    if (!structure.sections || structure.sections.length === 0) return DEFAULT_REPORT_STRUCTURE as ReportStructure;
    return structure;
  } catch (e) {
      console.error(e);
      throw e; // Bubble up for UI handling
  }
};

// --- PHASE 4: DRAFTING ---
export const runDraftingPhase = async (structure: ReportStructure, context: string, attachments: Attachment[], instructions: string, log: LogCallback, useFallback = false): Promise<ReportSection[]> => {
  const baseInstruction = SECTION_AGENT_INSTRUCTION.replace('${userInstructions}', instructions);
  const results: ReportSection[] = [];
  const modelSettings = getModelConfig(useFallback, 'quality');
  
  const BATCH_SIZE = 3;
  
  for (let i = 0; i < structure.sections.length; i += BATCH_SIZE) {
      const batch = structure.sections.slice(i, i + BATCH_SIZE);
      const batchPromises = batch.map(async (sectionPlan) => {
         log(`Drafting Component: ${sectionPlan.title}`, 'ai');
         try {
             const parts = constructParts(`
                SECTION: ${sectionPlan.title}
                GUIDANCE: ${sectionPlan.guidance}
                CONTEXT: ${context.substring(0, 30000)} 
             `, attachments);

             const res = await generateSafe({
                model: modelSettings.model,
                contents: [{ role: 'user', parts: parts }],
                config: {
                    ...modelSettings.config,
                    systemInstruction: baseInstruction,
                    responseSchema: SECTION_CONTENT_SCHEMA,
                }
             });
             
             const contentData = safeParseJSON(res.text || "{}", { content: "Data insufficient." });
             return {
                 title: sectionPlan.title,
                 type: sectionPlan.type,
                 content: contentData.content
             } as ReportSection;

         } catch (e: any) {
             if (e.message === 'QUOTA_EXCEEDED') throw e; // Bubble critical errors
             console.error(`Drafting error for ${sectionPlan.title}`, e);
             return { title: sectionPlan.title, type: sectionPlan.type, content: "Drafting Error: content generation failed." } as ReportSection;
         }
      });
      
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
      
      if (i + BATCH_SIZE < structure.sections.length) {
          await new Promise(r => setTimeout(r, 1500));
      }
  }

  return results;
};

// --- PHASE 5: FINALIZE ---
export const runFinalizePhase = async (sections: ReportSection[], reliability: string, instructions: string, log: LogCallback, useFallback = false): Promise<any> => {
  const instructionWithUser = SUMMARY_AGENT_INSTRUCTION.replace('${userInstructions}', instructions);
  const modelSettings = getModelConfig(useFallback, 'quality');
  
  try {
      const res = await generateSafe({
        model: modelSettings.model,
        contents: [{ role: 'user', parts: [{ text: `BODY: ${JSON.stringify(sections)}\nRELIABILITY: ${reliability}` }] }],
        config: {
            ...modelSettings.config, // Downgrade if needed
            thinkingConfig: useFallback ? undefined : { thinkingBudget: 2048 },
            systemInstruction: instructionWithUser,
            responseSchema: FINAL_METADATA_SCHEMA,
        }
      });
      
      return safeParseJSON(res.text || "{}", {
        classification: "OFFICIAL-SENSITIVE",
        reportTitle: "INTELLIGENCE REPORT",
        executiveSummary: "Summary generation failed.",
        overallConfidence: "Low Probability"
      });
  } catch (e: any) {
      if (e.message === 'QUOTA_EXCEEDED') throw e;
      return {
          classification: "OFFICIAL-SENSITIVE",
          reportTitle: "INTELLIGENCE REPORT (DRAFT)",
          executiveSummary: "Summary generation failed.",
          overallConfidence: "Low Probability"
      };
  }
};

// --- UTILS ---

export const generateMoreQueries = async (rawText: string, currentQueries: string[], instructions: string): Promise<string[]> => {
  try {
      const prompt = `
        ROLE: Senior Intelligence Planner.
        TASK: Generate 3-5 NEW, DISTINCT search queries to expand the research strategy.
        CONTEXT: ${rawText.substring(0, 5000)}
        CURRENT STRATEGY: ${JSON.stringify(currentQueries)}
        USER DIRECTION: ${instructions}
        CONSTRAINT: Do not duplicate existing queries. Focus on gaps.
      `;
      
      const response = await generateSafe({
        model: MODEL_QUALITY,
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: {
          ...CONFIG_REASONING,
          responseSchema: QUERIES_SCHEMA,
        }
      });
      return safeParseJSON<{queries: string[]}>(response.text || "{}", { queries: [] }).queries;
  } catch { return []; }
};

export const analyzeResearchCoverage = async (currentContext: string, originalGaps: string[], instructions: string): Promise<string[]> => {
  try {
      const response = await generateSafe({
        model: MODEL_QUALITY,
        contents: [{ role: 'user', parts: [{ text: `Gaps: ${JSON.stringify(originalGaps)}. Context: ${currentContext.substring(0, 10000)}. Generate queries if needed.` }] }],
        config: {
          ...CONFIG_REASONING,
          systemInstruction: GAP_ANALYSIS_INSTRUCTION,
          responseSchema: QUERIES_SCHEMA,
        }
      });
      return safeParseJSON<{queries: string[]}>(response.text || "{}", { queries: [] }).queries;
  } catch { return []; }
};

export const identifyStructuralGaps = async (structure: ReportStructure, currentContext: string): Promise<string[]> => {
  try {
      const response = await generateSafe({
        model: MODEL_QUALITY,
        contents: [{ role: 'user', parts: [{ text: `Structure: ${JSON.stringify(structure)}. Context: ${currentContext.substring(0, 10000)}. Missing info?` }] }],
        config: {
          ...CONFIG_REASONING,
          systemInstruction: STRUCTURAL_COVERAGE_INSTRUCTION,
          responseSchema: QUERIES_SCHEMA,
        }
      });
      return safeParseJSON<{queries: string[]}>(response.text || "{}", { queries: [] }).queries;
  } catch { return []; }
};

export const conductTacticalResearch = async (queries: string[], log: LogCallback): Promise<DeepResearchResult> => {
    return runResearchPhase([], queries, log, true); // Tactical always uses safe/fast mode (fallback enabled mostly)
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
      model: MODEL_FALLBACK, 
      config: {
        systemInstruction: `You are 'Sentinel Assistant'. Report: ${JSON.stringify(report)}. Raw: ${rawContext.substring(0,2000)}. Protocol: Professional UK Intelligence.`,
        tools: [{ functionDeclarations: [editReportTool, addSourcesTool, searchGoogleTool] }]
      }
    });
};
  
export const performSearchQuery = async (query: string): Promise<string> => {
    try {
      const response = await generateSafe({
        model: MODEL_FAST,
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
    const section = report.sections.find(s => s.title === sectionTitle);
    if (!section) throw new Error("Section not found");
  
    const prompt = `Refine section '${sectionTitle}'. Instruction: ${instruction}. Current: ${JSON.stringify(section.content)}`;
    try {
        const response = await generateSafe({
            model: MODEL_QUALITY,
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            config: {
                ...CONFIG_REASONING,
                responseSchema: SECTION_CONTENT_SCHEMA,
            }
        });
        return safeParseJSON(response.text || "{}", { content: section.content }).content;
    } catch (e) {
        return section.content; // Fallback to original
    }
};

export interface VerificationResult {
    status: 'Verified' | 'Disputed' | 'Inconclusive' | 'Analysis';
    explanation: string;
}
  
export const verifyClaim = async (claim: string): Promise<VerificationResult & { groundingMetadata: any }> => {
    try {
        const response = await generateSafe({
          model: MODEL_QUALITY,
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
    } catch (e) {
        return { status: "Inconclusive", explanation: "Verification service unavailable.", groundingMetadata: null };
    }
};

export const conductDeepResearch = async (topic: string, fullContext: string): Promise<ResearchSectionResult> => {
    try {
        const response = await generateSafe({
          model: MODEL_QUALITY,
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
        const groundingLinks = response.candidates?.[0]?.groundingMetadata?.groundingChunks
          ?.map((c: any) => ({ 
              url: c.web?.uri, 
              title: c.web?.title || formatSourceTitle(c.web?.uri), 
              summary: 'Search Result' 
          }))
          .filter((s: any) => s.url && isValidSourceUrl(s.url)) || [];
      
        return { ...result, links: [...(result.links || []), ...groundingLinks] };
    } catch (e) {
        return { title: topic, content: "Research subsystem unavailable.", links: [] };
    }
};