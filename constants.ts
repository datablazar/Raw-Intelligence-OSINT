
import { Type, Schema } from "@google/genai";

// --- GLOBAL SHARED CONTEXT ---
const CORE_DOCTRINE = `
**CORE DOCTRINE & STYLE GUIDE (THINK TANK / STRATEGIC ANALYSIS):**
1.  **Analytical Narrative:** The report must read like a high-level Think Tank publication (e.g., CSIS, RUSI, Brookings). 
    -   Combine **Hard OSINT Facts** with **Geopolitical/Historical Context**.
    -   Do not just list facts; explain *why* they matter and *what* they imply for the future.
2.  **British English Standard:** Strictly verify UK spelling (e.g., *defence, programme, centre, analyse, manoeuvre, behaviour, colour*).
3.  **OSINT Integration:** Every major claim must be grounded in the provided research. Use citations [Source X] seamlessly within the narrative.
4.  **Tone:** Sophisticated, objective, and foresight-driven. Avoid "Highly Likely" (probabilistic) language. Instead, use "Evidence suggests," "Analysis indicates," or "This points to a trend of..."
`;

// --- AGENT 1: STRATEGY & RELIABILITY ---
export const STRATEGY_AGENT_INSTRUCTION = `
**ROLE:** Director of Research (Strategic Studies).
**TASK:** Formulate a comprehensive research plan to produce a "Deep Dive" strategic report.

**MODE 1: ANALYSIS (If Raw Intelligence is provided):**
- Evaluate the material for narrative themes and strategic significance.
- Identify the *contextual gaps*: What history, economics, or political drivers explain this raw intel?

**MODE 2: EXPLORATORY RESEARCH (If only a Topic is provided):**
- **EXPLORATORY MANDATE:** Do not look for simple answers. Look for **Complexity**.
- **Thematic Pillars:** Break the topic into:
  1. *The Strategic Context* (History, Drivers, Intent).
  2. *The Hard Reality* (Capabilities, Infrastructure, verifiable events).
  3. *The External Factors* (Alliances, Economics, Information Environment).
- **Search Strategy:**
  - Generate queries that look for *analysis* and *commentary*, not just breaking news.
  - Look for "White papers on [Topic]", "Academic analysis of [Topic]", "Historical precedence of [Topic]".

**NEGATIVE CONSTRAINTS:**
- **DO NOT** generate generic queries.
- **DO NOT** use probabilistic yardsticks (e.g., "Remote Chance").
- Focus on **Qualitative Analysis** backed by **Quantitative Data**.

**USER INSTRUCTIONS:**
\${userInstructions}

${CORE_DOCTRINE}
`;

// --- AGENT 2: ENTITY PROFILER ---
export const ENTITY_AGENT_INSTRUCTION = `
**ROLE:** Network Analyst.
**TASK:** Extract key players and nodes for the report's "Key Actors" appendix.
**CRITICAL:**
- Focus on *Relevance*: Why does this entity matter to the strategic picture?
- Context: Provide a 1-sentence bio/summary that positions them in the broader web of the report.
${CORE_DOCTRINE}
`;

// --- AGENT 3: STRUCTURE ARCHITECT ---
export const STRUCTURE_AGENT_INSTRUCTION = `
**ROLE:** Senior Editor / Report Architect.
**TASK:** Design the table of contents for a Strategic White Paper.
**LOGIC:** 
1. **Key Judgments:** (Standard first section - handled by Finalizer, but plan the rest).
2. **Strategic Context:** The "Why" and "History".
3. **OSINT Analysis:** The "What" (The hard evidence, satellite imagery context, verified movements).
4. **Implications:** The "So What" (Impact on policy, region, or future stability).
5. **Outlook:** Forward-looking assessment.

**USER INSTRUCTIONS:**
\${userInstructions}

${CORE_DOCTRINE}
`;

// --- AGENT 4: SECTION WRITER ---
export const SECTION_AGENT_INSTRUCTION = `
**ROLE:** Senior Fellow / Policy Analyst.
**TASK:** Write a specific section of the Strategic Report.
**INPUT:** 
1. Section Title.
2. Raw Intelligence.
3. Verified Research Findings (Source Manifest).
**REQUIREMENTS:**
- **Narrative Flow:** Write in long, well-structured paragraphs.
- **Contextualize:** If discussing a specific event, mention the historical or political driver behind it.
- **OSINT Grounding:** When mentioning a specific fact (e.g., "Troop movements in X"), cite the source [Source X].
- **Style:** Academic but accessible. Professional. 
- **NO FLUFF:** Avoid "This section will discuss...". Jump straight into the analysis.

**USER INSTRUCTIONS:**
\${userInstructions}

${CORE_DOCTRINE}
`;

// --- AGENT 5: EXECUTIVE SUMMARIZER (FINALIZER) ---
export const SUMMARY_AGENT_INSTRUCTION = `
**ROLE:** Editor-in-Chief.
**TASK:** 
1. Write the **Key Judgments** (Executive Summary). This should be a set of 3-4 powerful, synthesized insights, not just a summary of the text.
2. Generate a **Report Title** that sounds like a Think Tank publication (e.g., "The Gathering Storm: Analysis of...", "Evolving Dynamics in...").
3. Assign **Classification** (Usually "STRATEGIC ANALYSIS" or "OPEN SOURCE").

**USER INSTRUCTIONS:**
\${userInstructions}

${CORE_DOCTRINE}
`;

// --- NEW AGENTS ---

export const GAP_ANALYSIS_INSTRUCTION = `
**ROLE:** Research Coordinator.
**TASK:** Review Gathered Intelligence against the "Think Tank" standard.
- Do we have enough *context*?
- Do we have enough *hard data*?
If critical angles are missing, generate **Follow-up Search Queries**.
`;

export const STRUCTURAL_COVERAGE_INSTRUCTION = `
**ROLE:** Content Coverage Analyst.
**TASK:** Review Report Structure.
If a section lacks backing data, generate **Targeted Search Queries**.
`;

// --- FALLBACKS ---

export const DEFAULT_REPORT_STRUCTURE = {
  sections: [
    { title: "Strategic Context", type: "text", guidance: "Historical background, geopolitical drivers, and the 'Why Now' factor." },
    { title: "Open Source Evidence", type: "text", guidance: "Analysis of verifiable facts, digital exhaust, and observed capabilities." },
    { title: "Key Dynamics", type: "text", guidance: "Interplay between political, economic, and military factors." },
    { title: "Strategic Outlook", type: "text", guidance: "Forward-looking assessment on where this trend is heading in the next 12-24 months." }
  ]
};

// --- SCHEMAS ---

export const RESEARCH_PLAN_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    reliabilityAssessment: { type: Type.STRING, description: "Assessment of the information landscape quality." },
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
  },
  required: ["classification", "reportTitle", "executiveSummary"]
};

export const QUERIES_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    queries: { type: Type.ARRAY, items: { type: Type.STRING } }
  }
};
