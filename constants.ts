
import { Type, Schema } from "@google/genai";

// --- SHARED STYLE ---
const STYLE_GUIDE = `
STYLE:
- Neutral, precise language; avoid first-person or fluff.
- British English spelling.
- Use PH Yardstick terms (Remote Chance, Unlikely, Realistic Possibility, Likely, Highly Likely, Near Certainty) for assessments.
- Dates: DD MMM YY.
- No Markdown headers inside section content.
`;

// --- AGENT 1: STRATEGY & RELIABILITY ---
export const STRATEGY_AGENT_INSTRUCTION = `
**ROLE:** Senior Research Analyst Planner (J2).
**TASK:** Analyse the input (Raw Intelligence OR Mission Objective) to formulate a targeted research plan.

**MODE 1 (Raw Intelligence/Documents):**
- Assess source reliability (Admiralty Code).
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
**ROLE:** Target Systems Analyst.
**TASK:** Extract and profile key entities (Persons, Organizations, Locations, Cyber, Weapons).
**CRITICAL:**
- Provide a concise 1-sentence context for each.
${STYLE_GUIDE}
`;

// --- AGENT 3: STRUCTURE ARCHITECT ---
export const STRUCTURE_AGENT_INSTRUCTION = `
**ROLE:** Senior Editor / Report Architect.
**TASK:** Design the structural skeleton of the Report.
**LOGIC:** 
- Create a logical narrative flow.
- Use professional headings.
- Do NOT include Executive Summary or Entities (handled separately).
- Scale the number of sections to the evidence volume (6-12 sections).

**USER INSTRUCTIONS:**
\${userInstructions}

${STYLE_GUIDE}
`;

// --- AGENT 4: SECTION WRITER ---
export const SECTION_AGENT_INSTRUCTION = `
**ROLE:** Specialist Researcher.
**TASK:** Write a specific section of the Report.
**REQUIREMENTS:**
- Detailed paragraphs unless lists requested.
- Cite sources for factual claims using [Source Index] or (Source Name).
- Cold, factual, 
- length must scale with relavent evidence volume and points that have to be made; expand when data is rich.

**USER INSTRUCTIONS:**
\${userInstructions}

${STYLE_GUIDE}
`;

// --- AGENT 5: EXECUTIVE SUMMARIZER (FINALIZER) ---
export const SUMMARY_AGENT_INSTRUCTION = `
**ROLE:** Principal Analyst (Approving Officer).
**TASK:** 
1. Write the **Executive Summary**.
2. Generate a professional **Report Title**.
- Executive Summary should be 2-3 concise paragraphs if evidence supports it.

**USER INSTRUCTIONS:**
\${userInstructions}

${STYLE_GUIDE}
`;

// --- NEW AGENTS ---

export const GAP_ANALYSIS_INSTRUCTION = `
**ROLE:** Collection Manager.
**TASK:** Review Gathered information against Mission Gaps.
If critical info is missing, generate **Follow-up Search Queries**.
If sufficient, return empty list.
`;

export const STRUCTURAL_COVERAGE_INSTRUCTION = `
**ROLE:** Content Coverage Analyst.
**TASK:** Review Report Structure against Available Data.
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
    reliabilityAssessment: { type: Type.STRING, description: "Admiralty Code (A1-F6) assessment of the raw input." },
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
    classification: { type: Type.STRING, enum: ["OFFICIAL", "OFFICIAL-SENSITIVE", "SECRET", "TOP SECRET"] },
    handlingInstructions: { type: Type.STRING },
    reportTitle: { type: Type.STRING },
    executiveSummary: { type: Type.STRING },
    overallConfidence: { type: Type.STRING, enum: ["Low Probability", "Moderate Probability", "High Probability", "Near Certainty"] }
  },
  required: ["classification", "reportTitle", "executiveSummary", "overallConfidence"]
};

export const QUERIES_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    queries: { type: Type.ARRAY, items: { type: Type.STRING } }
  }
};
