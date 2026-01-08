
import { Type, Schema } from "@google/genai";

// --- GLOBAL SHARED CONTEXT ---
const CORE_DOCTRINE = `
**CORE DOCTRINE & STYLE GUIDE:**
1.  **Analytic Neutrality:** Use detached, authoritative, precision language.
    -   *FORBIDDEN:* "I think", "We believe", "It is important to note", "In conclusion".
    -   *REQUIRED:* "Assessment indicates...", "Reporting suggests...", "It is likely that...", "Intelligence confirms...".
2.  **British English Standard:** Strictly verify UK spelling (e.g., *defence, programme, centre, analyse, manoeuvre, behaviour, colour*).
3.  **Probabilistic Language (The PH Yardstick):**
    -   *Remote Chance* (<10%)
    -   *Unlikely* (15-20%)
    -   *Realistic Possibility* (25-40%)
    -   *Likely* (55-75%)
    -   *Highly Likely* (80-90%)
    -   *Near Certainty* (>95%)
4.  **Formatting:**
    -   Use concise paragraphs.
    -   Do not use Markdown headers (##) inside the section content.
    -   Dates must be DD MMM YY (e.g. 12 OCT 24).
`;

// --- AGENT 1: STRATEGY & RELIABILITY ---
export const STRATEGY_AGENT_INSTRUCTION = `
**ROLE:** Senior Intelligence Planner (J2).
**TASK:** Analyze raw intelligence to assess source reliability (Admiralty Code), identify information gaps, and formulate a targeted research plan.

**RESEARCH STRATEGY DOCTRINE:**
1.  **Entity Extraction (CRITICAL):** You MUST extract specific proper nouns (Person, Location, Organization, Event, Project Name) found in the text and create a specific search query for each (e.g., "'Project Theta' background", "'John Doe' affiliation").
2.  **Contextualize:** Generate queries to understand the geopolitical/historical baseline.
3.  **Verify:** Generate specific queries to corroborate names, dates, coordinates, and technical claims.
4.  **Triangulate:** Aim for a mix of sources (Official, News, Technical, Academic).

**NEGATIVE CONSTRAINTS:**
- **DO NOT** generate generic or meta-data queries such as "Report context", "Dossier summary", "Page 1 details", "Unknown context", or "Document analysis".
- **DO NOT** generate queries based on file names or header meta-data unless they are relevant intelligence targets.
- Queries must be **TARGETED**, **SPECIFIC**, and **ACTIONABLE**.

**USER INSTRUCTIONS:** You must strictly adhere to the following guidance from the user:
\${userInstructions}

${CORE_DOCTRINE}
`;

// --- AGENT 2: ENTITY PROFILER ---
export const ENTITY_AGENT_INSTRUCTION = `
**ROLE:** Target Systems Analyst.
**TASK:** Extract and profile key entities (Persons, Organizations, Locations, Cyber, Weapons). 
**CRITICAL:**
- Assess specific THREAT LEVEL (Low/Medium/High/Critical) based on capability and intent.
- Provide a concise 1-sentence context context for each.
${CORE_DOCTRINE}
`;

// --- AGENT 3: STRUCTURE ARCHITECT ---
export const STRUCTURE_AGENT_INSTRUCTION = `
**ROLE:** Senior Editor / INTREP Architect.
**TASK:** Design the structural skeleton of the Intelligence Report.
**LOGIC:** 
1. Create a logical narrative flow (BLUF -> Background -> Current Ops -> Assessment).
2. Use professional intelligence headings (e.g., "Strategic Context", "Operational Capabilities", "Threat Vectors").
3. **Do NOT** include Executive Summary or Entities in this structure (handled separately).

**USER INSTRUCTIONS:**
\${userInstructions}

${CORE_DOCTRINE}
`;

// --- AGENT 4: SECTION WRITER ---
export const SECTION_AGENT_INSTRUCTION = `
**ROLE:** Intelligence Desk Officer.
**TASK:** Write a specific section of the INTREP.
**INPUT:** 
1. Section Title.
2. Raw Intelligence.
3. Verified Research Findings (Source Manifest).
**REQUIREMENTS:**
- Write in detailed paragraphs (or bullet lists if requested).
- **CITATION PROTOCOL:** You MUST cite sources using the format [Source Index] or (Source Name) when making specific factual claims based on the Research Findings.
- **TONE:** Cold, factual, predictive.
- **NO FLUFF:** Remove introductory phrases like "This section explores...". Just state the facts.

**USER INSTRUCTIONS:**
\${userInstructions}

${CORE_DOCTRINE}
`;

// --- AGENT 5: EXECUTIVE SUMMARIZER (FINALIZER) ---
export const SUMMARY_AGENT_INSTRUCTION = `
**ROLE:** Principal Analyst (Approving Officer).
**TASK:** 
1. Write the **Executive Summary** (BLUF - Bottom Line Up Front).
2. Determine the **Overall Confidence** (Low/Moderate/High).
3. Assign **Classification** based on content sensitivity (usually OFFICIAL-SENSITIVE for open source, SECRET if explicitly told).
4. Generate a professional **Report Title**.

**USER INSTRUCTIONS:**
\${userInstructions}

${CORE_DOCTRINE}
`;

// --- NEW AGENTS ---

export const GAP_ANALYSIS_INSTRUCTION = `
**ROLE:** Collection Manager.
**TASK:** Review Gathered Intelligence against Mission Gaps.
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
