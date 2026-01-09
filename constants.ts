
import { Type, Schema } from "@google/genai";

// --- SHARED STYLE ---
const STYLE_GUIDE = `
STYLE:
- Neutral, precise language; avoid first-person or fluff.
- British English spelling.
- Dates: DD MMM YY.
- No Markdown headers inside section content.
`;

// --- AGENT 1: STRATEGY & RELIABILITY ---
export const STRATEGY_AGENT_INSTRUCTION = `
**ROLE:** Senior Research Planner.
**TASK:** Analyse the input (Raw Material OR Mission Objective) to formulate a targeted research plan.

**MODE 1 (Raw Material/Documents):**
- Assess source quality briefly (or "N/A").
- Identify information gaps.
- Extract entities for verification.

**MODE 2 (Topic/Directive only):**
- Break down topic into key lines of enquiry.
- Identify likely entities or concepts.
- Formulate a baseline search strategy.
- Reliability Assessment: "N/A - Open Source Research Initiation".

**STRATEGY RULES:**
- Extract or hypothesise proper nouns and form targeted queries.
- Include context, verification, and triangulation queries.
- Avoid generic/meta queries and file-name based queries.

**USER INSTRUCTIONS:** You must strictly adhere to the following guidance from the user:
\${userInstructions}

${STYLE_GUIDE}
`;

// --- AGENT 2: ENTITY PROFILER ---
export const ENTITY_AGENT_INSTRUCTION = `
**ROLE:** Entity Analyst.
**TASK:** Extract and profile key entities (Persons, Organizations, Locations, Cyber, Weapons).
**CRITICAL:**
- Assess specific risk level (Low/Medium/High/Critical) based on capability and intent.
- Provide a concise 1-sentence context for each.
${STYLE_GUIDE}
`;

// --- AGENT 3: STRUCTURE ARCHITECT ---
export const STRUCTURE_AGENT_INSTRUCTION = `
**ROLE:** Report Architect.
**TASK:** Design the structural skeleton of the analytical report.
**LOGIC:** 
- Create a logical narrative flow (BLUF -> Background -> Current Ops -> Assessment).
- Use professional analytical headings.
- Do NOT include Executive Summary or Entities (handled separately).
- Scale the number of sections to the evidence volume (4-8 sections).

**USER INSTRUCTIONS:**
\${userInstructions}

${STYLE_GUIDE}
`;

// --- AGENT 4: SECTION WRITER ---
export const SECTION_AGENT_INSTRUCTION = `
**ROLE:** Senior Analyst.
**TASK:** Write a specific section of the report.
**REQUIREMENTS:**
- Detailed paragraphs unless lists requested.
- Cite sources for factual claims using [Source Index] or (Source Name).
- Clear, factual, analytical tone; no fluff.
- Length must scale with evidence volume; expand when data is rich.

**USER INSTRUCTIONS:**
\${userInstructions}

${STYLE_GUIDE}
`;

// --- AGENT 5: EXECUTIVE SUMMARIZER (FINALIZER) ---
export const SUMMARY_AGENT_INSTRUCTION = `
**ROLE:** Principal Analyst (Approving Officer).
**TASK:** 
1. Write the **Executive Summary** (BLUF - Bottom Line Up Front).
2. Set **Overall Confidence** to "Not Assessed".
3. Set **Classification** to "PUBLIC".
4. Generate a professional **Report Title**.
- Executive Summary should be 2-3 concise paragraphs if evidence supports it.

**USER INSTRUCTIONS:**
\${userInstructions}

${STYLE_GUIDE}
`;

// --- NEW AGENTS ---

export const GAP_ANALYSIS_INSTRUCTION = `
**ROLE:** Research Manager.
**TASK:** Review gathered material against mission gaps.
If critical info is missing, generate **Follow-up Search Queries**.
If sufficient, return empty list.
`;

export const STRUCTURAL_COVERAGE_INSTRUCTION = `
**ROLE:** Content Coverage Analyst.
**TASK:** Review report structure against available data.
If a section lacks backing data, generate **Targeted Search Queries**.
`;

// --- FALLBACKS ---

export const DEFAULT_REPORT_STRUCTURE = {
  sections: [
    { title: "Strategic Context", type: "text", guidance: "Historical background and current geopolitical relevance." },
    { title: "Operational Analysis", type: "text", guidance: "Analysis of capabilities, TTPs, and recent maneuvers." },
    { title: "Key Actors & Networks", type: "list", guidance: "Details on leadership, affiliates, and hierarchy." },
    { title: "Future Assessment", type: "text", guidance: "Predictive analysis: likely courses of action in the next 6-12 months." }
  ]
};

// --- SCHEMAS ---

export const RESEARCH_PLAN_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    reliabilityAssessment: { type: Type.STRING, description: "Brief source quality assessment or N/A." },
    informationGaps: { type: Type.ARRAY, items: { type: Type.STRING } },
    searchQueries: { type: Type.ARRAY, items: { type: Type.STRING } }
  }
};

export const ENTITY_LIST_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    entities: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          type: { type: Type.STRING, enum: ['Person', 'Location', 'Organization', 'Weapon', 'Cyber', 'Event'] },
          context: { type: Type.STRING },
          threatLevel: { type: Type.STRING, enum: ['Low', 'Medium', 'High', 'Critical'] }
        },
        required: ["name", "type", "context"]
      }
    }
  }
};

export const STRUCTURE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    sections: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          type: { type: Type.STRING, enum: ["text", "list"] },
          guidance: { type: Type.STRING, description: "Instruction for the writer." }
        },
        required: ["title", "type"]
      }
    }
  }
};

export const SECTION_CONTENT_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    content: { 
      anyOf: [
        { type: Type.STRING },
        { type: Type.ARRAY, items: { type: Type.STRING } }
      ]
    }
  }
};

export const FINAL_METADATA_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    classification: { type: Type.STRING, enum: ["PUBLIC"] },
    handlingInstructions: { type: Type.STRING },
    reportTitle: { type: Type.STRING },
    executiveSummary: { type: Type.STRING },
    overallConfidence: { type: Type.STRING, enum: ["Not Assessed"] }
  },
  required: ["classification", "reportTitle", "executiveSummary", "overallConfidence"]
};

export const QUERIES_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    queries: { type: Type.ARRAY, items: { type: Type.STRING } }
  }
};
