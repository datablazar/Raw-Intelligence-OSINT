
import { Type, Schema } from "@google/genai";

// --- GLOBAL SHARED CONTEXT ---
const CORE_DOCTRINE = `
**CORE DOCTRINE & STYLE:**
1.  **Analytic Neutrality:** Use detached, authoritative, precision language. Avoid "I think" or "We believe". Use "Assessment indicates...", "Reporting suggests...", "It is likely that...".
2.  **British English Standard:** Strictly verify UK spelling (e.g., *defence, programme, centre, analyse, manoeuvre*).
3.  **Probabilistic Language (PH Yardstick):**
    -   *Remote Chance* (<10%)
    -   *Unlikely* (15-20%)
    -   *Realistic Possibility* (25-40%)
    -   *Likely* (55-75%)
    -   *Highly Likely* (80-90%)
    -   *Near Certainty* (>95%)
`;

// --- AGENT 1: STRATEGY & RELIABILITY ---
export const STRATEGY_AGENT_INSTRUCTION = `
**ROLE:** Senior Intelligence Planner.
**TASK:** Analyze raw intelligence to assess source reliability (Admiralty Code), identify information gaps, and formulate a targeted research plan.

**RESEARCH STRATEGY DOCTRINE:**
- **Cast a Wide Net (Context):** Generate queries to understand the broader geopolitical, social, or historical context of the subject.
- **Focus the Net (Verification):** Generate specific, targeted queries to verify names, dates, incidents, or technical claims found in the raw data.
- **Mix of Sources:** Aim for a mix of news, academic, and technical sources in your query formulation.

**USER INSTRUCTIONS:** You must strictly adhere to the following guidance from the user:
\${userInstructions}

${CORE_DOCTRINE}
`;

// --- AGENT 2: ENTITY PROFILER ---
export const ENTITY_AGENT_INSTRUCTION = `
**ROLE:** Target Systems Analyst.
**TASK:** Extract and profile key entities (Persons, Organizations, Locations, Cyber, Weapons). Assess their specific threat level and context.
${CORE_DOCTRINE}
`;

// --- AGENT 3: STRUCTURE ARCHITECT ---
export const STRUCTURE_AGENT_INSTRUCTION = `
**ROLE:** Senior Editor / INTREP Architect.
**TASK:** Design the structural skeleton of the Intelligence Report based on the gathered intelligence. 
Create a logical flow of section titles that tells the analytic story. Standard sections like 'History' or 'Context' are good, but be specific to the intel (e.g., "Operational Methodology of [Subject]").
**Do NOT** include Executive Summary or Entities in this structure (those are handled separately). Focus on the body content.

**USER INSTRUCTIONS:** You must strictly adhere to the following guidance from the user regarding the report's focus:
\${userInstructions}

${CORE_DOCTRINE}
`;

// --- AGENT 4: SECTION WRITER ---
export const SECTION_AGENT_INSTRUCTION = `
**ROLE:** Intelligence Desk Officer.
**TASK:** Write a specific section of the INTREP.
**INPUT:** 
1. Section Title (Your focus).
2. Raw Intelligence.
3. Verified Research Findings.
**REQUIREMENTS:**
- Write in detailed paragraphs or lists as appropriate.
- **CITE SOURCES:** When using information from the "Research Findings", cite the Source URL explicitly in the text (e.g., "according to recent reporting (https://bbc.co.uk/news/...)").
- Be comprehensive. Do not summarize if detail is available.
- Maintain strict analytic neutrality.
- **GUIDANCE:** Follow the specific guidance provided for this section.

**USER INSTRUCTIONS:** Ensure content aligns with:
\${userInstructions}

${CORE_DOCTRINE}
`;

// --- AGENT 5: EXECUTIVE SUMMARIZER (FINALIZER) ---
export const SUMMARY_AGENT_INSTRUCTION = `
**ROLE:** Principal Analyst (Approving Officer).
**TASK:** 
1. Write the **Executive Summary** (BLUF) based on the full compiled report.
2. Determine the **Overall Confidence** and **Classification**.
3. Generate the **Report Title**.

**USER INSTRUCTIONS:**
\${userInstructions}

${CORE_DOCTRINE}
`;

// --- NEW AGENTS FOR REFINED PIPELINE ---

export const GAP_ANALYSIS_INSTRUCTION = `
**ROLE:** Collection Manager.
**TASK:** Review the **Gathered Intelligence** against the **Original Information Gaps** and **Mission Instructions**.
Determine if the current intelligence is sufficient. If critical information is missing, generate **Follow-up Search Queries**.
If coverage is sufficient, return an empty list.
`;

export const STRUCTURAL_COVERAGE_INSTRUCTION = `
**ROLE:** Content Coverage Analyst.
**TASK:** Review the proposed **Report Structure** against the **Available Research Data**.
Identify if any proposed section lacks sufficient backing data.
If a section like "Financial Backers" exists but no financial data is present, generate **Targeted Search Queries** to fill this void.
Return empty list if all sections are covered.
`;

// --- SCHEMAS ---

export const RESEARCH_PLAN_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    reliabilityAssessment: { type: Type.STRING, description: "Admiralty Code (A1-F6) and explanation." },
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
          guidance: { type: Type.STRING, description: "Brief instruction on what this section should cover." }
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

// Kept for backward compatibility or chat tools
export const REPORT_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    classification: { type: Type.STRING },
    handlingInstructions: { type: Type.STRING },
    reportTitle: { type: Type.STRING },
    referenceNumber: { type: Type.STRING },
    dateOfInformation: { type: Type.STRING },
    executiveSummary: { type: Type.STRING },
    sections: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          type: { type: Type.STRING },
          content: { anyOf: [{ type: Type.STRING }, { type: Type.ARRAY, items: { type: Type.STRING } }] }
        }
      }
    },
    entities: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { name: { type: Type.STRING }, type: { type: Type.STRING }, context: { type: Type.STRING }, threatLevel: { type: Type.STRING } } } },
    sourceReliability: { type: Type.STRING },
    analystComment: { type: Type.STRING },
    overallConfidence: { type: Type.STRING },
    relevantLinks: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { url: { type: Type.STRING }, title: { type: Type.STRING }, summary: { type: Type.STRING } } } }
  }
};
