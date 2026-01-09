
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
import { AnalysisReport, Attachment, ResearchPlan, SourceReference, Entity, ReportSection, DeepResearchResult, ReportStructure, ReportStructureItem, ResearchSectionResult, FailedSource } from "../types";

// --- CONFIGURATION ---
// Unified model for efficiency
const MODEL_FAST = 'gemini-3-flash-preview';
const MODEL_QUALITY = 'gemini-3-flash-preview';
const MODEL_FALLBACK = 'gemini-3-flash-preview';

// Tiers allow balancing cost/latency. 
const CONFIG_EXTRACTION = { responseMimeType: "application/json" };
const CONFIG_REASONING = { responseMimeType: "application/json" };
const CONFIG_DEEP_THINKING = { responseMimeType: "application/json" };

const SOURCE_ANALYSIS_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    title: { type: Type.STRING },
    summary: { type: Type.STRING },
    facts: { type: Type.ARRAY, items: { type: Type.STRING } },
    entities: { type: Type.ARRAY, items: { type: Type.STRING } },
    dates: { type: Type.ARRAY, items: { type: Type.STRING } }
  },
  required: ["summary", "facts"]
};

const SEARCH_VECTOR_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    summary: { type: Type.STRING },
    facts: { type: Type.ARRAY, items: { type: Type.STRING } },
    sources: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          url: { type: Type.STRING },
          title: { type: Type.STRING }
        },
        required: ["url"]
      }
    }
  },
  required: ["summary", "facts", "sources"]
};

const SECTION_DRAFT_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    content: { 
      anyOf: [
        { type: Type.STRING },
        { type: Type.ARRAY, items: { type: Type.STRING } }
      ]
    },
    claims: { type: Type.ARRAY, items: { type: Type.STRING } }
  },
  required: ["content", "claims"]
};

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

const estimateTokens = (text: string) => {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
};

const collectTextFromContents = (contents: any) => {
  if (!Array.isArray(contents)) return "";
  const textParts: string[] = [];
  contents.forEach(content => {
    const parts = content?.parts || [];
    parts.forEach((part: any) => {
      if (typeof part?.text === "string") {
        textParts.push(part.text);
      }
    });
  });
  return textParts.join("\n");
};

// --- ERROR HANDLING & RETRY LOGIC ---

/**
 * Wraps generateContent with robust error handling.
 * Throws specific errors for UI handling instead of automatic fallback.
 */
const generateSafe = async (params: { model: string, contents: any, config?: any }, attempt = 1): Promise<any> => {
  const ai = getClient();
  try {
    const promptText = collectTextFromContents(params.contents);
    const tokenEstimate = estimateTokens(promptText);
    if (promptText) {
      console.info(`[Sentinel] Model ${params.model} ~${tokenEstimate} tokens (${promptText.length} chars).`);
    }
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

const MAX_FACTS_PER_SOURCE = 10;
const MAX_EVIDENCE_SOURCES = 10;
const MAX_EVIDENCE_CONTENT_CHARS = 1200;

const formatEvidenceContent = (summary: string, facts: string[]) => {
  const trimmedSummary = summary?.trim();
  const trimmedFacts = facts.map(f => f.trim()).filter(Boolean);
  return [
    trimmedSummary ? `SUMMARY: ${trimmedSummary}` : "",
    ...trimmedFacts.map(f => `- ${f}`)
  ].filter(Boolean).join("\n");
};

type ContextSegments = {
  instructions: string;
  raw: string;
  sources: string;
  research: string;
};

const extractSegment = (label: string, text: string, nextLabels: string[]) => {
  const startIndex = text.indexOf(label);
  if (startIndex === -1) return "";
  const afterStart = startIndex + label.length;
  let endIndex = text.length;
  nextLabels.forEach(next => {
    const idx = text.indexOf(next, afterStart);
    if (idx !== -1 && idx < endIndex) endIndex = idx;
  });
  return text.slice(afterStart, endIndex).trim();
};

const parseContextSegments = (context: string): ContextSegments => {
  const hasMarkers = context.includes("INSTRUCTIONS:") || context.includes("RAW:") || context.includes("RESEARCH:");
  if (!hasMarkers) {
    return { instructions: "", raw: "", sources: "", research: context.trim() };
  }
  return {
    instructions: extractSegment("INSTRUCTIONS:", context, ["RAW:", "SOURCES:", "RESEARCH:"]),
    raw: extractSegment("RAW:", context, ["SOURCES:", "RESEARCH:"]),
    sources: extractSegment("SOURCES:", context, ["RESEARCH:"]),
    research: extractSegment("RESEARCH:", context, [])
  };
};

type EvidenceBlock = {
  url: string;
  title: string;
  content: string;
  block: string;
};

const extractCitationBlocks = (text: string): EvidenceBlock[] => {
  const blocks: EvidenceBlock[] = [];
  const regex = /\[\[SOURCE_ID:\s*([^\]]+)\]\]\s*\[\[TITLE:\s*([^\]]+)\]\]\s*([\s\S]*?)\s*\[\[END_SOURCE\]\]/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const url = match[1].trim();
    const title = match[2].trim();
    const rawContent = match[3].trim();
    const trimmedContent = rawContent.length > MAX_EVIDENCE_CONTENT_CHARS
      ? `${rawContent.slice(0, MAX_EVIDENCE_CONTENT_CHARS)}...`
      : rawContent;
    const block = `[[SOURCE_ID: ${url}]]\n[[TITLE: ${title}]]\n${trimmedContent}\n[[END_SOURCE]]`;
    if (!url || url.includes("directive.local")) continue;
    blocks.push({ url, title, content: trimmedContent, block });
  }
  return blocks;
};

const summariseEvidenceBlocks = (blocks: EvidenceBlock[], maxSources = 8, maxFacts = 3) => {
  const summaries: string[] = [];
  const selected = blocks.slice(0, maxSources);
  selected.forEach(block => {
    const lines = block.content.split("\n").map(line => line.trim()).filter(Boolean);
    const facts = lines
      .filter(line => line.startsWith("-") || line.startsWith("*") || /^\d+\./.test(line) || line.startsWith("SUMMARY:"))
      .map(line => line.replace(/^[-*]\s*/, '').replace(/^\d+\.\s*/, '').replace(/^SUMMARY:\s*/i, ''))
      .filter(Boolean)
      .slice(0, maxFacts);
    const factText = facts.length > 0 ? facts.join("; ") : "Key details extracted.";
    summaries.push(`- ${block.title}: ${factText}`);
  });
  return summaries.join("\n");
};

const buildStructureContext = (context: string) => {
  const parsed = parseContextSegments(context);
  const evidenceBlocks = extractCitationBlocks(parsed.research || context);
  const evidenceSummary = summariseEvidenceBlocks(evidenceBlocks, 8, 2);
  const rawSnippet = parsed.raw ? parsed.raw.slice(0, 2000) : "";
  const parts = [];
  if (rawSnippet) parts.push(`RAW SNIPPET:\n${rawSnippet}`);
  if (evidenceSummary) parts.push(`EVIDENCE SUMMARY:\n${evidenceSummary}`);
  if (evidenceBlocks.length > 0) parts.push(`SOURCE COUNT: ${evidenceBlocks.length}`);
  return parts.join("\n\n").trim();
};

type LogCallback = (message: string, type: 'info' | 'network' | 'ai' | 'success' | 'planning' | 'synthesizing', details?: string[]) => void;

export type GeminiTestAdapters = {
  generateSafe?: typeof generateSafe;
  executeSearchVector?: typeof executeSearchVector;
};

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
      userPromptText = `RAW INTEL: ${rawText.substring(0, 12000)}`;
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
          ...modelSettings.config,
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
            plan.searchQueries.push("Context and background investigation for provided material");
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
const executeSearchVector = async (query: string, log: LogCallback, useFallback = false): Promise<{ text: string, sources: SourceReference[], summary: string, facts: string[] }> => {
    log(`Initializing Search Vector: "${query}"`, 'network');
    const modelSettings = getModelConfig(useFallback, 'fast');

    try {
        const MAX_SEARCH_ATTEMPTS = 2;
        let fallbackResult = { text: "", sources: [] as SourceReference[], summary: "", facts: [] as string[] };

        for (let attempt = 1; attempt <= MAX_SEARCH_ATTEMPTS; attempt += 1) {
            const res = await generateSafe({
                model: modelSettings.model,
                contents: [{ role: 'user', parts: [{ text: `Query: "${query}". Return JSON with: summary (1-2 sentences), facts (5-7 bullet facts), sources (url/title). Keep facts concise.` }] }],
                config: {
                  ...CONFIG_EXTRACTION,
                  tools: [{ googleSearch: {} }],
                  responseSchema: SEARCH_VECTOR_SCHEMA
                }
            });

            const gatheredSources: SourceReference[] = [];
            const rawUrls: string[] = [];
            const parsed = safeParseJSON(res.text || "{}", { summary: "", facts: [], sources: [] as { url: string; title?: string }[] });
            const summary = String(parsed.summary || "").trim();
            const facts = Array.isArray(parsed.facts) ? parsed.facts.filter(Boolean).slice(0, MAX_FACTS_PER_SOURCE) : [];

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

            // 2. Sources from JSON payload
            (parsed.sources || []).forEach(source => {
                if (source?.url && isValidSourceUrl(source.url) && !rawUrls.includes(source.url)) {
                    rawUrls.push(source.url);
                    gatheredSources.push({
                        url: source.url,
                        title: source.title || formatSourceTitle(source.url),
                        summary: `Source via query: "${query}"`
                    });
                }
            });

            // 3. Fallback Text Extraction
            const textResponse = formatEvidenceContent(summary, facts);
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

            fallbackResult = { text: textResponse, sources: gatheredSources, summary, facts };

            if (rawUrls.length > 0) {
                log(`Data Acquired: "${query}"`, 'success', rawUrls);
                return fallbackResult;
            }

            if (attempt < MAX_SEARCH_ATTEMPTS) {
                log(`No links returned for "${query}". Retrying...`, 'info');
                await new Promise(r => setTimeout(r, 800));
                continue;
            }

            log(`Search Complete (No Direct Links): "${query}"`, 'info');
            return fallbackResult;
        }

        return fallbackResult;

    } catch (e) {
        log(`Vector Failed: "${query}"`, 'info');
        return { text: "", sources: [], summary: "", facts: [] };
    }
};

// --- PHASE 2: RESEARCH ---
export const runResearchPhase = async (
  urls: string[],
  queries: string[],
  log: LogCallback,
  useFallback = false,
  mission = "",
  adapters?: GeminiTestAdapters
): Promise<DeepResearchResult> => {
  const MAX_RESEARCH_DEPTH = 3;
  const MAX_URL_CONCURRENCY = 5;
  const URL_REQUEST_DELAY_MS = 750;
  const contextParts: string[] = [];
  const gatheredSources: Map<string, SourceReference> = new Map();
  const failedUrls: FailedSource[] = [];
  const visitedQueries = new Set<string>();
  const modelSettings = getModelConfig(useFallback, 'fast');
  const contextSourceIds = new Set<string>();
  const generateSafeAdapter = adapters?.generateSafe ?? generateSafe;
  const executeSearchVectorAdapter = adapters?.executeSearchVector ?? executeSearchVector;

  type SourceStatus = 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  type SourceRegistryEntry = {
    url: string;
    status: SourceStatus;
    title?: string;
    summary?: string;
    lastError?: string;
  };
  const sourceRegistry = new Map<string, SourceRegistryEntry>();
  const citationDirectiveUrl = "https://directive.local/citation-format";
  type EvidenceRecord = {
    url: string;
    title: string;
    summary: string;
    facts: string[];
  };
  const evidenceStore = new Map<string, EvidenceRecord>();

  const buildCitationBlock = (url: string, title: string, content: string) => {
    const safeTitle = title?.trim() || "External Source";
    const safeContent = content?.trim() ? content.trim() : "No extractable content.";
    return `[[SOURCE_ID: ${url}]]\n[[TITLE: ${safeTitle}]]\n${safeContent}\n[[END_SOURCE]]`;
  };

  const ensureCitationDirective = () => {
    if (contextSourceIds.has(citationDirectiveUrl)) return;
    const directiveContent = [
      "CITATION FORMAT REQUIRED:",
      "Each source MUST be wrapped as:",
      "[[SOURCE_ID: <url>]]",
      "[[TITLE: <title>]]",
      "<extracted_content>",
      "[[END_SOURCE]]"
    ].join("\n");
    contextParts.push(buildCitationBlock(citationDirectiveUrl, "Citation Format", directiveContent));
    contextSourceIds.add(citationDirectiveUrl);
  };

  const appendCitationBlock = (url: string, title: string, content: string) => {
    if (!url || contextSourceIds.has(url)) return;
    ensureCitationDirective();
    contextParts.push(buildCitationBlock(url, title, content));
    contextSourceIds.add(url);
  };

  const setRegistryStatus = (url: string, status: SourceStatus, update?: Partial<SourceRegistryEntry>) => {
    const existing = sourceRegistry.get(url);
    sourceRegistry.set(url, {
      url,
      status,
      title: update?.title || existing?.title,
      summary: update?.summary || existing?.summary,
      lastError: update?.lastError || existing?.lastError
    });
  };

  const upsertEvidence = (record: EvidenceRecord) => {
    if (!record.url || !isValidSourceUrl(record.url)) return;
    const existing = evidenceStore.get(record.url);
    const mergedFacts = new Set([...(existing?.facts || []), ...(record.facts || [])]);
    evidenceStore.set(record.url, {
      url: record.url,
      title: record.title || existing?.title || "External Source",
      summary: record.summary || existing?.summary || "",
      facts: Array.from(mergedFacts).slice(0, MAX_FACTS_PER_SOURCE)
    });
  };

  const buildEvidenceSummary = () => {
    const records = Array.from(evidenceStore.values()).slice(0, 12);
    const lines = records.map(record => {
      const facts = record.facts.slice(0, 3);
      const factText = facts.length > 0 ? facts.join("; ") : "Key details extracted.";
      return `- ${record.title}: ${factText}`;
    });
    return lines.join("\n");
  };

  const upsertSource = (source: SourceReference) => {
    if (!source.url || !isValidSourceUrl(source.url)) return;
    const existing = gatheredSources.get(source.url);
    gatheredSources.set(source.url, {
      url: source.url,
      title: source.title || existing?.title,
      summary: source.summary || existing?.summary
    });
  };

  const registerDiscoveredSource = (source: SourceReference) => {
    if (!source.url || !isValidSourceUrl(source.url)) return;
    upsertSource(source);
    const registryEntry = sourceRegistry.get(source.url);
    if (!registryEntry) {
      sourceRegistry.set(source.url, {
        url: source.url,
        status: 'QUEUED',
        title: source.title,
        summary: source.summary
      });
      return;
    }
    if (registryEntry.status === 'COMPLETED' || registryEntry.status === 'FAILED') return;
    sourceRegistry.set(source.url, {
      ...registryEntry,
      title: registryEntry.title || source.title,
      summary: registryEntry.summary || source.summary
    });
  };

  const markSourceCompleted = (url: string, title: string, summary: string) => {
    if (!url || !isValidSourceUrl(url)) return;
    upsertSource({ url, title, summary });
    setRegistryStatus(url, 'COMPLETED', { title, summary });
  };

  const addFailedUrl = (url: string, reason: string, isHighValue: boolean) => {
    if (!url) return;
    if (failedUrls.find(f => f.url === url)) return;
    failedUrls.push({ url, reason, isHighValue });
  };

  const runWithConcurrency = async <T,>(items: T[], limit: number, handler: (item: T) => Promise<void>) => {
    if (items.length === 0) return;
    let nextIndex = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (true) {
        const currentIndex = nextIndex++;
        if (currentIndex >= items.length) break;
        if (currentIndex > 0 && URL_REQUEST_DELAY_MS > 0) {
          await new Promise(resolve => setTimeout(resolve, URL_REQUEST_DELAY_MS));
        }
        await handler(items[currentIndex]);
      }
    });
    await Promise.all(workers);
  };

  const getQueuedUrls = () => {
    return Array.from(sourceRegistry.values())
      .filter(entry => entry.status === 'QUEUED')
      .map(entry => entry.url);
  };

  const harvest = async (urlBatch: string[], queryBatch: string[]) => {
    const uniqueUrls = urlBatch
      .map(url => url.trim())
      .filter(Boolean);
    const urlsToProcess = new Set<string>();

    uniqueUrls.forEach(url => {
      if (!isValidSourceUrl(url)) {
        addFailedUrl(url, "Invalid or unsupported source URL", true);
        setRegistryStatus(url, 'FAILED', { lastError: "Invalid or unsupported source URL" });
        return;
      }
      const registryEntry = sourceRegistry.get(url);
      if (registryEntry?.status === 'PROCESSING' || registryEntry?.status === 'COMPLETED' || registryEntry?.status === 'FAILED') {
        return;
      }
      if (!registryEntry) setRegistryStatus(url, 'QUEUED');
      urlsToProcess.add(url);
    });

    await runWithConcurrency(Array.from(urlsToProcess), MAX_URL_CONCURRENCY, async (url) => {
      setRegistryStatus(url, 'PROCESSING');
      log(`Interrogating Direct Source: ${url}`, 'network');
      try {
        const res = await generateSafeAdapter({
          model: modelSettings.model,
          contents: [{ role: 'user', parts: [{ text: `Analyse ${url}. Return JSON with title, summary (1-2 sentences), facts (5-8 concise bullets), entities, dates.` }] }],
          config: { 
            ...CONFIG_EXTRACTION,
            tools: [{ googleSearch: {} }],
            responseSchema: SOURCE_ANALYSIS_SCHEMA
          }
        });

        if (!res.text) throw new Error("Empty response");

        const data = safeParseJSON(res.text || "{}", { title: "", summary: "", facts: [] as string[] });
        const title = data.title || formatSourceTitle(url);
        const summary = data.summary || "Analysed source.";
        const facts = Array.isArray(data.facts) ? data.facts.filter(Boolean).slice(0, MAX_FACTS_PER_SOURCE) : [];
        const evidenceContent = formatEvidenceContent(summary, facts);
        upsertEvidence({ url, title, summary, facts });
        markSourceCompleted(url, title, summary);
        appendCitationBlock(url, title, evidenceContent);
      } catch (e: any) {
        const reason = e.message || "Access Denied / Timeout";
        log(`Failed to access: ${url}`, 'info');
        addFailedUrl(url, reason, true);
        setRegistryStatus(url, 'FAILED', { lastError: reason });
      }
    });

    const filteredQueries = queryBatch
      .map(q => q.trim())
      .filter(q => q && !visitedQueries.has(q));

    filteredQueries.forEach(q => visitedQueries.add(q));

    if (filteredQueries.length > 0) {
      const batchSize = 3;
      for (let i = 0; i < filteredQueries.length; i += batchSize) {
        const batch = filteredQueries.slice(i, i + batchSize);
        const batchResults = await Promise.all(batch.map(q => executeSearchVectorAdapter(q, log, useFallback)));

        batchResults.forEach((res, index) => {
          const query = batch[index];
          if (res.text) {
            const queryUrl = `https://search.local/query?q=${encodeURIComponent(query)}`;
            upsertEvidence({ url: queryUrl, title: `Search Summary: ${query}`, summary: res.summary, facts: res.facts });
            appendCitationBlock(queryUrl, `Search Summary: ${query}`, res.text);
          }
          res.sources.forEach(registerDiscoveredSource);
        });
        
        if (i + batchSize < filteredQueries.length) {
          await new Promise(r => setTimeout(r, 1000));
        }
      }
    }
  };

  const reviewForGaps = async (): Promise<string[]> => {
    const evidenceSummary = buildEvidenceSummary();
    const sourcesList = Array.from(gatheredSources.values())
      .map(source => `${source.title || "Source"} (${source.url})`)
      .slice(0, 50)
      .join("\n");
    const prompt = [
      `USER MISSION: ${mission || "Not provided"}`,
      `ALREADY ASKED QUERIES: ${JSON.stringify(Array.from(visitedQueries))}`,
      `KNOWN SOURCES:\n${sourcesList || "None"}`,
      `EVIDENCE SUMMARY:\n${evidenceSummary || "None"}`,
      "CITATION FORMAT IS MANDATORY: [[SOURCE_ID: <url>]] [[TITLE: <title>]] <extracted_content> [[END_SOURCE]].",
      "TASK: Review the information gathered so far against the User's Mission. Are there critical gaps? If yes, what specific questions do we need to ask next?",
      "Return JSON in the schema: {\"queries\": [\"...\"]}.",
      "If no gaps, return {\"queries\": []}.",
      "Do not repeat prior queries or ask for information already covered."
    ].join("\n\n");

    try {
      const response = await generateSafeAdapter({
        model: MODEL_QUALITY,
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: {
          ...CONFIG_REASONING,
          responseSchema: QUERIES_SCHEMA,
        }
      });
      return safeParseJSON<{queries: string[]}>(response.text || "{}", { queries: [] }).queries;
    } catch (e) {
      log("Gap review failed. Continuing with gathered data.", 'info');
      return [];
    }
  };

  const runLoop = async (urlBatch: string[], queryBatch: string[], depth: number) => {
    await harvest(urlBatch, queryBatch);
    const queuedUrls = getQueuedUrls();
    if (queuedUrls.length > 0) {
      await harvest(queuedUrls, []);
    }

    if (depth >= MAX_RESEARCH_DEPTH) return;

    log("Reviewing gathered data for gaps...", 'ai');
    const newQueries = await reviewForGaps();
    const filteredNewQueries = newQueries
      .map(q => q.trim())
      .filter(q => q && !visitedQueries.has(q));

    if (filteredNewQueries.length === 0) {
      log("Gap review indicates coverage is sufficient.", 'success');
      return;
    }

    log(`Gaps detected. Launching ${filteredNewQueries.length} follow-up vectors...`, 'planning');
    await runLoop([], filteredNewQueries, depth + 1);
  };

  await runLoop(urls, queries, 0);

  return { 
    context: contextParts.join("\n\n"), 
    sources: Array.from(gatheredSources.values()),
    failedUrls: failedUrls
  };
};

// --- PHASE 3: STRUCTURE ---
export const runStructurePhase = async (context: string, attachments: Attachment[], instructions: string, log: LogCallback, useFallback = false): Promise<ReportStructure> => {
  const instructionWithUser = STRUCTURE_AGENT_INSTRUCTION.replace('${userInstructions}', instructions);
  const structureContext = buildStructureContext(context) || context.substring(0, 8000);
  const contents = [{ role: 'user', parts: constructParts(`CONTEXT:\n${structureContext.substring(0, 12000)}`, attachments) }];
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
    const evidenceCount = extractCitationBlocks(context).length;
    if (evidenceCount >= 6 && structure.sections.length < 5) {
      const extras: ReportStructureItem[] = [
        { title: "Key Findings", type: "list", guidance: "Evidence-backed findings derived from sources." },
        { title: "Actors & Relationships", type: "text", guidance: "Key actors, affiliations, and relationships." },
        { title: "Methods & Patterns", type: "text", guidance: "Methods, techniques, and observable patterns." }
      ];
      const existingTitles = new Set(structure.sections.map(section => section.title.toLowerCase()));
      extras.forEach(extra => {
        if (!existingTitles.has(extra.title.toLowerCase())) {
          structure.sections.push(extra);
        }
      });
    }
    return structure;
  } catch (e) {
      console.error(e);
      throw e; // Bubble up for UI handling
  }
};

// --- PHASE 4: DRAFTING ---
export const runDraftingPhase = async (
  structure: ReportStructure,
  context: string,
  attachments: Attachment[],
  instructions: string,
  log: LogCallback,
  useFallback = false,
  adapters?: GeminiTestAdapters
): Promise<ReportSection[]> => {
  const baseInstruction = SECTION_AGENT_INSTRUCTION.replace('${userInstructions}', instructions);
  const results: ReportSection[] = [];
  const modelSettings = getModelConfig(useFallback, 'quality');
  const generateSafeAdapter = adapters?.generateSafe ?? generateSafe;
  const parsedContext = parseContextSegments(context);
  const evidenceBlocks = extractCitationBlocks(parsedContext.research || context);
  const rawSnippet = parsedContext.raw ? parsedContext.raw.slice(0, 2000) : "";
  const editorInstruction = `
ROLE: Senior Editor.
TASK: Audit the draft against doctrine and evidence.
CHECKS REQUIRED:
1) Missing citations for factual claims (use [Source X] where applicable).
2) Subjective or speculative language.
3) Logical gaps or unsupported assertions.
OUTPUT: Provide a verdict and corrective feedback focused on claims and citations.
`;

  const REVIEW_VERDICT_SCHEMA = {
    type: Type.OBJECT,
    properties: {
      verdict: { type: Type.STRING, enum: ["Approved", "Rejected"] },
      feedback: { type: Type.STRING }
    },
    required: ["verdict", "feedback"]
  };

  const MAX_REVISIONS = 2;

  const normaliseDraftContent = (content: string | string[]) => {
    if (Array.isArray(content)) return content.join("\n");
    return content;
  };

  const getKeywords = (text: string) => {
    return text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(word => word.length > 3);
  };

  const selectEvidenceBlocks = (sectionPlan: ReportStructureItem) => {
    if (evidenceBlocks.length === 0) return [];
    const keywords = new Set([...getKeywords(sectionPlan.title), ...getKeywords(sectionPlan.guidance)]);
    const scored = evidenceBlocks.map(block => {
      const haystack = `${block.title} ${block.content}`.toLowerCase();
      let score = 0;
      keywords.forEach(word => {
        if (haystack.includes(word)) score += 1;
      });
      return { block, score };
    });
    const sorted = scored.sort((a, b) => b.score - a.score);
    const selected = sorted.filter(item => item.score > 0).map(item => item.block);
    const fallback = selected.length > 0 ? selected : sorted.map(item => item.block);
    return fallback.slice(0, MAX_EVIDENCE_SOURCES);
  };

  const buildLengthGuide = (sourceCount: number, sectionType: ReportStructureItem["type"]) => {
    const paragraphTarget = Math.min(10, Math.max(3, Math.ceil(sourceCount * 2)));
    const listTarget = Math.min(18, Math.max(6, sourceCount * 3));
    if (sectionType === "list") {
      return `Provide ${listTarget}-${listTarget + 2} bullets if evidence supports it.`;
    }
    return `Provide ${paragraphTarget}-${paragraphTarget + 1} paragraphs if evidence supports it.`;
  };

  const buildEvidencePack = (sectionPlan: ReportStructureItem) => {
    const selected = selectEvidenceBlocks(sectionPlan);
    if (selected.length === 0) {
      return { pack: rawSnippet ? `RAW SNIPPET:\n${rawSnippet}` : "", count: 0 };
    }
    const manifest = selected.map((block, index) => `[Source ${index + 1}] ${block.title} (${block.url})`);
    const evidenceText = selected.map(block => block.block).join("\n\n");
    return {
      pack: `SOURCE MANIFEST:\n${manifest.join("\n")}\n\nEVIDENCE:\n${evidenceText}`,
      count: selected.length
    };
  };

  const buildDraftPrompt = (
    sectionPlan: ReportStructureItem,
    evidencePack: string,
    lengthGuide: string,
    draft?: string,
    feedback?: string
  ) => {
    const basePrompt = [
      `SECTION: ${sectionPlan.title}`,
      `GUIDANCE: ${sectionPlan.guidance}`,
      evidencePack ? `EVIDENCE PACK:\n${evidencePack}` : "EVIDENCE PACK: None",
      `LENGTH TARGET: ${lengthGuide}`,
      "USE ALL RELEVANT FACTS from the evidence pack where applicable.",
      "OUTPUT: Provide content plus a short claims list with citations (3-8 items)."
    ];

    if (draft && feedback) {
      basePrompt.push(
        "REVISION TASK: Update the draft to resolve the editor feedback.",
        `PREVIOUS DRAFT:\n${draft}`,
        `EDITOR FEEDBACK:\n${feedback}`
      );
    }

    return basePrompt.join("\n");
  };

  type DraftPayload = { content: string | string[]; claims: string[] };

  const normaliseClaims = (claims: string[]) => {
    return claims.map(c => c.trim()).filter(Boolean).slice(0, 8);
  };

  const generateSectionDraft = async (
    sectionPlan: ReportStructureItem,
    evidencePack: string,
    lengthGuide: string,
    draft?: string,
    feedback?: string
  ): Promise<DraftPayload> => {
    const parts = constructParts(buildDraftPrompt(sectionPlan, evidencePack, lengthGuide, draft, feedback), attachments);

    const res = await generateSafeAdapter({
      model: modelSettings.model,
      contents: [{ role: 'user', parts: parts }],
      config: {
        ...modelSettings.config,
        systemInstruction: baseInstruction,
        responseSchema: SECTION_DRAFT_SCHEMA,
      }
    });

    const contentData = safeParseJSON(res.text || "{}", { content: "Data insufficient.", claims: [] as string[] });
    return {
      content: contentData.content,
      claims: normaliseClaims(contentData.claims || [])
    };
  };

  const reviewDraft = async (sectionPlan: ReportStructureItem, claims: string[], evidencePack: string) => {
    const prompt = [
      `SECTION: ${sectionPlan.title}`,
      `CLAIMS:\n${claims.join("\n") || "None"}`,
      evidencePack ? `EVIDENCE PACK:\n${evidencePack}` : "EVIDENCE PACK: None",
      "Provide verdict and feedback. Use JSON schema."
    ].join("\n\n");

    try {
      const response = await generateSafeAdapter({
        model: MODEL_QUALITY,
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: {
          ...CONFIG_REASONING,
          systemInstruction: editorInstruction,
          responseSchema: REVIEW_VERDICT_SCHEMA,
        }
      });
      return safeParseJSON<{ verdict: "Approved" | "Rejected"; feedback: string }>(response.text || "{}", { verdict: "Approved", feedback: "OK" });
    } catch (e) {
      log(`Editor review failed for ${sectionPlan.title}. Defaulting to draft.`, 'info');
      return null;
    }
  };

  const BATCH_SIZE = 3;

  for (let i = 0; i < structure.sections.length; i += BATCH_SIZE) {
      const batch = structure.sections.slice(i, i + BATCH_SIZE);
       const batchPromises = batch.map(async (sectionPlan) => {
          log(`Drafting Component: ${sectionPlan.title}`, 'ai');
          try {
              const evidence = buildEvidencePack(sectionPlan);
              const evidencePack = evidence.pack;
              const lengthGuide = buildLengthGuide(evidence.count, sectionPlan.type);
              let currentDraft = await generateSectionDraft(sectionPlan, evidencePack, lengthGuide);
              for (let attempt = 0; attempt <= MAX_REVISIONS; attempt++) {
                const review = await reviewDraft(sectionPlan, currentDraft.claims, evidencePack);
                if (!review || review.verdict === "Approved") {
                  if (review?.verdict === "Approved") {
                    log(`Editor approved: ${sectionPlan.title}`, 'success');
                  }
                  break;
                }
                log(`Revision requested: ${sectionPlan.title}`, 'planning');
                if (attempt === MAX_REVISIONS) break;
                currentDraft = await generateSectionDraft(
                  sectionPlan,
                  evidencePack,
                  lengthGuide,
                  normaliseDraftContent(currentDraft.content),
                  review.feedback
                );
              }

              return {
               title: sectionPlan.title,
               type: sectionPlan.type,
               content: currentDraft.content
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
            ...modelSettings.config,
            systemInstruction: instructionWithUser,
            responseSchema: FINAL_METADATA_SCHEMA,
        }
      });
      
      return safeParseJSON(res.text || "{}", {
        classification: "PUBLIC",
        reportTitle: "ANALYTICAL REPORT",
        executiveSummary: "Summary generation failed.",
        overallConfidence: "Not Assessed"
      });
  } catch (e: any) {
      if (e.message === 'QUOTA_EXCEEDED') throw e;
      return {
          classification: "PUBLIC",
          reportTitle: "ANALYTICAL REPORT (DRAFT)",
          executiveSummary: "Summary generation failed.",
          overallConfidence: "Not Assessed"
      };
  }
};

// --- UTILS ---

export const generateMoreQueries = async (rawText: string, currentQueries: string[], instructions: string): Promise<string[]> => {
  try {
      const prompt = `
        ROLE: Senior Research Planner.
        TASK: Generate 3-5 NEW, DISTINCT search queries to expand the research strategy.
        CONTEXT: ${rawText.substring(0, 2000)}
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
        contents: [{ role: 'user', parts: [{ text: `Gaps: ${JSON.stringify(originalGaps)}. Context: ${currentContext.substring(0, 6000)}. Generate queries if needed.` }] }],
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
        contents: [{ role: 'user', parts: [{ text: `Structure: ${JSON.stringify(structure)}. Context: ${currentContext.substring(0, 6000)}. Missing info?` }] }],
        config: {
          ...CONFIG_REASONING,
          systemInstruction: STRUCTURAL_COVERAGE_INSTRUCTION,
          responseSchema: QUERIES_SCHEMA,
        }
      });
      return safeParseJSON<{queries: string[]}>(response.text || "{}", { queries: [] }).queries;
  } catch { return []; }
};

export const conductTacticalResearch = async (queries: string[], log: LogCallback, mission = ""): Promise<DeepResearchResult> => {
    return runResearchPhase([], queries, log, true, mission); // Tactical always uses safe/fast mode (fallback enabled mostly)
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

export const createReportChatSession = (report: AnalysisReport, rawContext: string) => {
    const ai = getClient();
    return ai.chats.create({
      model: MODEL_FALLBACK, 
      config: {
        systemInstruction: `You are 'Sentinel Assistant'. Report: ${JSON.stringify(report)}. Raw: ${rawContext.substring(0,2000)}. Protocol: Professional analytical reporting.`,
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

export const refineSection = async (report: AnalysisReport, sectionTitle: string, instruction: string): Promise<any> => {
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
          contents: [{ role: 'user', parts: [{ text: `Deep research on "${topic}". Context: ${fullContext.substring(0, 6000)}` }] }],
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
            }
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
