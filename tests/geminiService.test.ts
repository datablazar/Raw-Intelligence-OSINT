import { describe, it, expect } from "vitest";
import { runDraftingPhase, runResearchPhase } from "../services/geminiService";
import type { ReportStructure } from "../types";
import type { GeminiTestAdapters } from "../services/geminiService";

const noopLog = () => {};

const getAnalyzeUrl = (text: string) => {
  const match = text.match(/Analyse\s+(.*?)\.\s+Return/i);
  return match ? match[1] : "";
};

describe("runResearchPhase", () => {
  it("builds citation blocks and dedupes sources", async () => {
    const generateSafe = async (params: any) => {
      const text = params?.contents?.[0]?.parts?.[0]?.text || "";
      if (text.startsWith("Analyse ")) {
        const url = getAnalyzeUrl(text);
        return {
          text: JSON.stringify({
            title: `Title for ${url}`,
            summary: `Summary for ${url}`,
            facts: [`Fact for ${url}`]
          })
        };
      }
      if (text.includes("USER MISSION")) {
        return { text: JSON.stringify({ queries: [] }) };
      }
      return { text: JSON.stringify({}) };
    };

    const executeSearchVector = async (query: string) => {
      return {
        text: `Summary for ${query}`,
        summary: `Summary for ${query}`,
        facts: [`Fact for ${query}`],
        sources: [
          {
            url: `https://source.local/${query}`,
            title: `Source ${query}`,
            summary: "From search"
          }
        ]
      };
    };

    const adapters: GeminiTestAdapters = { generateSafe, executeSearchVector };
    const result = await runResearchPhase(
      ["https://example.com/a", "https://example.com/a", "https://example.com/b"],
      ["alpha", "alpha", "beta"],
      noopLog,
      true,
      "mission",
      adapters
    );

    expect(result.context).toContain("[[SOURCE_ID: https://example.com/a]]");
    expect(result.context).toContain("[[SOURCE_ID: https://example.com/b]]");
    expect(result.context).toContain("[[SOURCE_ID: https://search.local/query?q=alpha]]");
    expect(result.context).toContain("[[SOURCE_ID: https://search.local/query?q=beta]]");
    expect(result.context).toContain("[[END_SOURCE]]");

    const urls = result.sources.map(source => source.url).sort();
    expect(urls).toEqual(
      [
        "https://example.com/a",
        "https://example.com/b",
        "https://source.local/alpha",
        "https://source.local/beta"
      ].sort()
    );
  });

  it("respects URL concurrency limits", async () => {
    const urls = Array.from({ length: 12 }, (_, i) => `https://example.com/${i}`);
    let active = 0;
    let maxActive = 0;

    const generateSafe = async (params: any) => {
      const text = params?.contents?.[0]?.parts?.[0]?.text || "";
      if (text.startsWith("Analyse ")) {
        active += 1;
        if (active > maxActive) maxActive = active;
        await new Promise(resolve => setTimeout(resolve, 5));
        active -= 1;
        const url = getAnalyzeUrl(text);
        return {
          text: JSON.stringify({
            title: `Title for ${url}`,
            summary: `Summary for ${url}`,
            facts: [`Fact for ${url}`]
          })
        };
      }
      if (text.includes("USER MISSION")) {
        return { text: JSON.stringify({ queries: [] }) };
      }
      return { text: JSON.stringify({}) };
    };

    const adapters: GeminiTestAdapters = {
      generateSafe,
      executeSearchVector: async () => ({ text: "", sources: [], summary: "", facts: [] })
    };

    await runResearchPhase(urls, [], noopLog, true, "mission", adapters);
    expect(maxActive).toBeLessThanOrEqual(5);
  });
});

describe("runDraftingPhase", () => {
  it("revises draft when editor rejects", async () => {
    const structure: ReportStructure = {
      sections: [
        { title: "Strategic Context", type: "text", guidance: "Summarize the situation." }
      ]
    };

    let writerCalls = 0;
    let editorCalls = 0;

    const generateSafe = async (params: any) => {
      const system = params?.config?.systemInstruction || "";
      const text = params?.contents?.[0]?.parts?.[0]?.text || "";
      if (system.includes("Senior Editor")) {
        editorCalls += 1;
        if (editorCalls === 1) {
          return { text: JSON.stringify({ verdict: "Rejected", feedback: "Add citations." }) };
        }
        return { text: JSON.stringify({ verdict: "Approved", feedback: "OK" }) };
      }
      if (system.includes("Senior Analyst")) {
        writerCalls += 1;
        if (text.includes("REVISION TASK")) {
          return { text: JSON.stringify({ content: "Revised draft [Source 1]", claims: ["Claim [Source 1]"] }) };
        }
        return { text: JSON.stringify({ content: "Draft without citation.", claims: ["Claim without citation"] }) };
      }
      return { text: JSON.stringify({}) };
    };

    const adapters: GeminiTestAdapters = { generateSafe };
    const result = await runDraftingPhase(structure, "context", [], "instructions", noopLog, true, adapters);

    expect(result[0].content).toBe("Revised draft [Source 1]");
    expect(writerCalls).toBe(2);
    expect(editorCalls).toBe(2);
  });

  it("fails open when editor crashes", async () => {
    const structure: ReportStructure = {
      sections: [
        { title: "Strategic Context", type: "text", guidance: "Summarize the situation." }
      ]
    };

    const generateSafe = async (params: any) => {
      const system = params?.config?.systemInstruction || "";
      if (system.includes("Senior Editor")) {
        throw new Error("timeout");
      }
      if (system.includes("Senior Analyst")) {
        return { text: JSON.stringify({ content: "Draft ok.", claims: ["Claim [Source 1]"] }) };
      }
      return { text: JSON.stringify({}) };
    };

    const adapters: GeminiTestAdapters = { generateSafe };
    const result = await runDraftingPhase(structure, "context", [], "instructions", noopLog, true, adapters);

    expect(result[0].content).toBe("Draft ok.");
  });
});
