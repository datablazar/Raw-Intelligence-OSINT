import React, { useState, useEffect, useRef } from 'react';
import { MissionConfig, IntelligenceReport, ResearchPlan, Entity, SourceReference, ReportStructure, ReportSection, ProcessingLog } from '../types';
import { runStrategyPhase, runResearchPhase, runStructurePhase, runDraftingPhase, runFinalizePhase, extractUrls, generateMoreQueries, analyzeResearchCoverage, identifyStructuralGaps, conductTacticalResearch } from '../services/geminiService';
import { BrainCircuit, Globe, FileText, CheckCircle2, ChevronRight, Edit2, Search, Trash2, Shield, Activity, Terminal, ArrowRight, Play, Sparkles, Loader2 } from 'lucide-react';

interface MissionWizardProps {
  config: MissionConfig;
  onComplete: (report: IntelligenceReport) => void;
  onCancel: () => void;
}

type WizardStep = 'planning' | 'review_plan' | 'researching' | 'review_research' | 'structuring' | 'review_structure' | 'drafting' | 'finalizing';

// Moved outside to prevent re-creation on every render which causes focus loss
const ReviewContainer = ({ title, children, onNext, onCancel }: { title: string, children: React.ReactNode, onNext: () => void, onCancel: () => void }) => (
  <div className="flex flex-col h-full bg-gray-50 rounded-lg overflow-hidden border border-gray-200 shadow-xl animate-[fadeIn_0.3s_ease-out]">
    <div className="bg-uk-navy text-white px-6 py-4 flex justify-between items-center">
      <div className="flex items-center gap-3">
        <Edit2 className="w-5 h-5 text-uk-blue" />
        <h2 className="font-bold text-lg tracking-wide uppercase">{title}</h2>
      </div>
    </div>
    <div className="flex-1 overflow-y-auto p-6 space-y-6">
      {children}
    </div>
    <div className="p-4 bg-white border-t border-gray-200 flex justify-end gap-3">
       <button onClick={onCancel} className="px-4 py-2 text-gray-500 hover:text-red-600 font-bold uppercase text-xs">Abort Mission</button>
       <button onClick={onNext} className="px-6 py-2 bg-uk-blue text-white rounded font-bold uppercase text-xs hover:bg-uk-navy flex items-center gap-2">
         Proceed <ArrowRight className="w-4 h-4" />
       </button>
    </div>
  </div>
);

const MissionWizard: React.FC<MissionWizardProps> = ({ config, onComplete, onCancel }) => {
  const [step, setStep] = useState<WizardStep>('planning');
  const [logs, setLogs] = useState<ProcessingLog[]>([]);
  
  // Data State
  const [plan, setPlan] = useState<ResearchPlan | null>(null);
  const [entities, setEntities] = useState<Entity[]>([]);
  const [researchData, setResearchData] = useState<{ context: string, sources: SourceReference[] } | null>(null);
  const [structure, setStructure] = useState<ReportStructure | null>(null);
  
  // Editable State for Reviews
  const [editablePlan, setEditablePlan] = useState<ResearchPlan | null>(null);
  const [editableSources, setEditableSources] = useState<SourceReference[]>([]);
  const [editableStructure, setEditableStructure] = useState<ReportStructure | null>(null);
  
  // Helper States
  const [isGeneratingQueries, setIsGeneratingQueries] = useState(false);

  const logsEndRef = useRef<HTMLDivElement>(null);

  const addLog = (msg: string, type: ProcessingLog['type'] = 'info') => {
    setLogs(prev => [...prev, { id: crypto.randomUUID(), message: msg, type, timestamp: Date.now() }]);
  };

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // --- PHASE 1: PLANNING ---
  useEffect(() => {
    if (step === 'planning') {
      const execute = async () => {
        addLog("Initiating Phase 1: Strategic Triage...", 'planning');
        try {
          const { plan, entities } = await runStrategyPhase(config.rawText, config.instructions, addLog);
          setPlan(plan);
          setEntities(entities);
          setEditablePlan(plan);
          addLog("Strategy generated. Waiting for Analyst Review.", 'success');
          setStep('review_plan');
        } catch (e) {
          addLog(`Error: ${e}`, 'info');
        }
      };
      execute();
    }
  }, [step]);

  // --- PHASE 2: RESEARCH ---
  const handleApprovePlan = () => {
    if (!editablePlan) return;
    setPlan(editablePlan);
    setStep('researching');
  };
  
  const handleGenerateQueries = async () => {
    if (!editablePlan) return;
    setIsGeneratingQueries(true);
    try {
      addLog("Generating additional gap-fill queries...", 'ai');
      const newQueries = await generateMoreQueries(config.rawText, editablePlan.searchQueries, config.instructions);
      setEditablePlan(prev => prev ? ({
        ...prev,
        searchQueries: [...prev.searchQueries, ...newQueries]
      }) : null);
      addLog(`Added ${newQueries.length} new queries.`, 'success');
    } catch (e) {
      console.error(e);
      addLog("Failed to generate additional queries", 'info');
    } finally {
      setIsGeneratingQueries(false);
    }
  };

  useEffect(() => {
    if (step === 'researching' && plan) {
      const execute = async () => {
        addLog("Initiating Phase 2: Active Research...", 'network');
        try {
          const urls = extractUrls(config.rawText);
          
          // Step 2.1: Initial Broad/Targeted Research
          addLog("Executing Initial Research Plan...", 'network');
          const initialResult = await runResearchPhase(urls, plan.searchQueries || [], addLog);
          
          // Step 2.2: Feedback Loop / Coverage Analysis
          addLog("Analyzing Intel Coverage against Mission Objectives...", 'ai');
          const gapQueries = await analyzeResearchCoverage(
              initialResult.context, 
              plan.informationGaps || [], 
              config.instructions
          );

          let finalContext = initialResult.context;
          let finalSources = initialResult.sources;

          // Step 2.3: Iterative Deep Dive (if needed)
          if (gapQueries.length > 0) {
              addLog(`Identified coverage gaps. Executing ${gapQueries.length} targeted deep-dive queries...`, 'network');
              const tacticalResult = await conductTacticalResearch(gapQueries, addLog);
              
              // Merge Results
              finalContext = finalContext + "\n\n=== TACTICAL FOLLOW-UP ===\n" + tacticalResult.context;
              // Merge sources ensuring uniqueness
              const existingUrls = new Set(finalSources.map(s => s.url));
              tacticalResult.sources.forEach(s => {
                  if (!existingUrls.has(s.url)) {
                      finalSources.push(s);
                      existingUrls.add(s.url);
                  }
              });
              addLog("Iterative Research Complete. Coverage Gaps Addressed.", 'success');
          } else {
              addLog("Initial research coverage deemed sufficient.", 'success');
          }
          
          setResearchData({ context: finalContext, sources: finalSources });
          setEditableSources(finalSources);
          addLog(`Intel gathering complete. ${finalSources.length} assets secured. Waiting for Analyst Review.`, 'success');
          setStep('review_research');
        } catch (e) {
          addLog(`Research Error: ${e}`, 'info');
        }
      };
      execute();
    }
  }, [step, plan]);

  // --- PHASE 3: STRUCTURE ---
  const handleApproveResearch = () => {
    setStep('structuring');
  };

  useEffect(() => {
    if (step === 'structuring' && researchData) {
      const execute = async () => {
        addLog("Initiating Phase 3: Structural Design...", 'planning');
        try {
          const activeSources = editableSources.filter(s => s.active !== false);
          const sourceManifest = activeSources.map((s, i) => `[Source ${i+1}] ${s.title} (${s.url})`).join('\n');
          
          const fullContext = `
=== INTELLIGENCE DIRECTIVE ===
${config.instructions}

=== RAW INTELLIGENCE ===
${config.rawText}

=== VERIFIED SOURCE MANIFEST ===
${sourceManifest}

=== RESEARCH CONTENT ===
${researchData.context}`;

          const struct = await runStructurePhase(fullContext, config.instructions, addLog);
          setStructure(struct);
          setEditableStructure(struct);
          addLog("Report structure designed. Waiting for Analyst Review.", 'success');
          setStep('review_structure');
        } catch (e) { addLog(`Structure Error: ${e}`, 'info'); }
      };
      execute();
    }
  }, [step, researchData]);

  // --- PHASE 4 & 5: DRAFTING & FINALIZE ---
  const handleApproveStructure = async () => {
    if (!editableStructure) return;
    setStructure(editableStructure);
    
    // NEW STEP: Pre-Drafting Structural Coverage Check
    if (researchData) {
        addLog("Verifying Structural Coverage against Intelligence...", 'ai');
        try {
            const missingQueries = await identifyStructuralGaps(editableStructure, researchData.context);
            if (missingQueries.length > 0) {
                addLog(`Detected data voids for new sections. Executing ${missingQueries.length} tactical queries...`, 'network');
                // Run tactical research
                const tacticalResult = await conductTacticalResearch(missingQueries, addLog);
                
                // Update Context with new findings
                const updatedContext = researchData.context + "\n\n=== STRUCTURAL GAP FILL ===\n" + tacticalResult.context;
                
                // Update Sources silently (or log it)
                const currentSourceUrls = new Set(researchData.sources.map(s => s.url));
                const newSources = [...researchData.sources];
                tacticalResult.sources.forEach(s => {
                    if (!currentSourceUrls.has(s.url)) {
                        newSources.push({ ...s, active: true });
                        currentSourceUrls.add(s.url);
                    }
                });
                
                setResearchData({ context: updatedContext, sources: newSources });
                setEditableSources(newSources); // Ensure drafting uses updated sources list if needed
                addLog("Data voids filled. Proceeding to drafting.", 'success');
            } else {
                addLog("Structure fully supported by existing intelligence.", 'success');
            }
        } catch (e) {
            console.error("Gap check failed", e);
            addLog("Gap check warning. Proceeding with existing intel.", 'info');
        }
    }
    
    setStep('drafting');
  };

  useEffect(() => {
    if (step === 'drafting' && structure && researchData) {
      const execute = async () => {
        addLog("Initiating Phase 4: Drafting Content...", 'synthesizing');
        try {
          // Prepare enriched context for drafting
          const activeSources = editableSources.filter(s => s.active !== false);
          const sourceManifest = activeSources.map((s, i) => `[${i+1}] ${s.title}: ${s.summary} (${s.url})`).join('\n');
          
          const fullContext = `
=== INTELLIGENCE DIRECTIVE ===
${config.instructions}

=== RAW INTELLIGENCE ===
${config.rawText}

=== VERIFIED SOURCE INDEX (Use these for Citations) ===
${sourceManifest}

=== DETAILED RESEARCH CONTENT ===
${researchData.context}`;

          const sections = await runDraftingPhase(structure, fullContext, config.instructions, addLog);
          
          addLog("Initiating Phase 5: Final Compilation...", 'ai');
          const reliability = plan?.reliabilityAssessment || "Unknown";
          const meta = await runFinalizePhase(sections, reliability, config.instructions, addLog);

          const finalReport: IntelligenceReport = {
            classification: meta.classification,
            handlingInstructions: meta.handlingInstructions || "UK EYES ONLY",
            reportTitle: meta.reportTitle,
            referenceNumber: `UKIC-${new Date().getFullYear()}-${Math.floor(Math.random()*10000)}-INTREP`,
            dateOfInformation: new Date().toISOString().split('T')[0],
            executiveSummary: meta.executiveSummary,
            sections: sections,
            entities: entities,
            sourceReliability: reliability,
            analystComment: "Report generated via Sentinel v3.0 Guided Workflow.",
            overallConfidence: meta.overallConfidence,
            relevantLinks: activeSources // ONLY include active sources in final report
          };

          onComplete(finalReport);
        } catch (e) { addLog(`Drafting Error: ${e}`, 'info'); }
      };
      execute();
    }
  }, [step, structure]);

  // --- RENDER ---
  if (step.startsWith('review')) {
    return (
      <div className="absolute inset-0 bg-gray-950/90 z-50 p-4 md:p-8 backdrop-blur-sm">
        <div className="max-w-4xl mx-auto h-full flex flex-col">
          
          {/* REVIEW PLAN */}
          {step === 'review_plan' && editablePlan && (
            <ReviewContainer title="Review Mission Strategy" onNext={handleApprovePlan} onCancel={onCancel}>
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Reliability Assessment</label>
                  <textarea 
                    value={editablePlan.reliabilityAssessment}
                    onChange={(e) => setEditablePlan({...editablePlan, reliabilityAssessment: e.target.value})}
                    className="w-full p-3 border rounded font-mono text-sm h-24"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Search Queries (Gap Filling)</label>
                  <div className="space-y-2">
                    {editablePlan.searchQueries.map((q, i) => (
                      <div key={i} className="flex gap-2">
                        <input 
                          value={q} 
                          onChange={(e) => {
                             const newQ = [...editablePlan.searchQueries];
                             newQ[i] = e.target.value;
                             setEditablePlan({...editablePlan, searchQueries: newQ});
                          }}
                          className="flex-1 p-2 border rounded font-mono text-sm"
                        />
                        <button onClick={() => {
                           const newQ = editablePlan.searchQueries.filter((_, idx) => idx !== i);
                           setEditablePlan({...editablePlan, searchQueries: newQ});
                        }} className="text-red-500 hover:bg-red-50 p-2 rounded"><Trash2 className="w-4 h-4"/></button>
                      </div>
                    ))}
                    
                    <div className="flex gap-3 mt-2">
                       <button onClick={() => setEditablePlan({...editablePlan, searchQueries: [...editablePlan.searchQueries, ""]})} className="text-xs text-uk-blue font-bold uppercase flex items-center gap-1 hover:text-uk-navy">+ Add Query</button>
                       <button onClick={handleGenerateQueries} disabled={isGeneratingQueries} className="text-xs text-purple-600 font-bold uppercase flex items-center gap-1 hover:text-purple-800 disabled:opacity-50">
                          {isGeneratingQueries ? <Loader2 className="w-3 h-3 animate-spin"/> : <Sparkles className="w-3 h-3"/>}
                          Generate More (AI)
                       </button>
                    </div>
                  </div>
                </div>
              </ReviewContainer>
          )}

          {/* REVIEW RESEARCH */}
          {step === 'review_research' && (
            <ReviewContainer title="Review Intelligence Assets" onNext={handleApproveResearch} onCancel={onCancel}>
              <div className="space-y-2">
                 <p className="text-sm text-gray-500 mb-4">Uncheck sources to exclude them from the analysis.</p>
                 {editableSources.map((src, i) => (
                   <div key={i} className={`flex items-start gap-3 p-3 border rounded ${!src.active && src.active !== undefined ? 'opacity-50 bg-gray-100' : 'bg-white'}`}>
                      <input 
                        type="checkbox" 
                        checked={src.active !== false} 
                        onChange={(e) => {
                           const newSrcs = [...editableSources];
                           newSrcs[i] = { ...src, active: e.target.checked };
                           setEditableSources(newSrcs);
                        }}
                        className="mt-1"
                      />
                      <div>
                        <h4 className="font-bold text-sm text-uk-blue">{src.title || src.url}</h4>
                        <p className="text-xs text-gray-600 mt-1">{src.summary}</p>
                        <a href={src.url} target="_blank" rel="noreferrer" className="text-[10px] text-gray-400 hover:underline">{src.url}</a>
                      </div>
                   </div>
                 ))}
                 {editableSources.length === 0 && <p className="text-sm text-gray-500 italic">No external sources found. Analysis will rely solely on provided text.</p>}
              </div>
            </ReviewContainer>
          )}

          {/* REVIEW STRUCTURE */}
          {step === 'review_structure' && editableStructure && (
            <ReviewContainer title="Review Report Structure" onNext={handleApproveStructure} onCancel={onCancel}>
              <div className="space-y-4">
                 <p className="text-sm text-gray-500 mb-4">Define the narrative flow. The AI will write content for each section.</p>
                 {editableStructure.sections.map((sec, i) => (
                   <div key={i} className="border border-gray-300 rounded p-3 bg-white">
                      <div className="flex justify-between mb-2">
                        <input 
                          value={sec.title}
                          onChange={(e) => {
                             const newSecs = [...editableStructure.sections];
                             newSecs[i] = { ...sec, title: e.target.value };
                             setEditableStructure({ ...editableStructure, sections: newSecs });
                          }}
                          className="font-bold text-uk-navy text-sm border-b border-dashed border-gray-300 focus:border-uk-blue outline-none w-2/3"
                        />
                        <button onClick={() => {
                             const newSecs = editableStructure.sections.filter((_, idx) => idx !== i);
                             setEditableStructure({ ...editableStructure, sections: newSecs });
                        }} className="text-red-400 hover:text-red-600"><Trash2 className="w-4 h-4"/></button>
                      </div>
                      <textarea 
                        value={sec.guidance}
                        onChange={(e) => {
                             const newSecs = [...editableStructure.sections];
                             newSecs[i] = { ...sec, guidance: e.target.value };
                             setEditableStructure({ ...editableStructure, sections: newSecs });
                        }}
                        className="w-full text-xs text-gray-600 border border-gray-100 bg-gray-50 p-2 rounded h-16 resize-none"
                        placeholder="Guidance for the AI writer..."
                      />
                   </div>
                 ))}
                 <button onClick={() => setEditableStructure({
                   ...editableStructure, 
                   sections: [...editableStructure.sections, { title: "New Section", type: "text", guidance: "Analyze..." }]
                 })} className="w-full py-3 border-2 border-dashed border-gray-300 rounded text-gray-400 hover:border-uk-blue hover:text-uk-blue font-bold text-xs uppercase">+ Add Section</button>
              </div>
            </ReviewContainer>
          )}
        </div>
      </div>
    );
  }

  // --- LOADING VIEW (Legacy HUD Style) ---
  return (
    <div className="absolute inset-0 bg-gray-950/95 z-50 flex items-center justify-center backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl bg-black border border-uk-navy rounded-xl shadow-2xl overflow-hidden flex flex-col h-[600px]">
        <div className="bg-uk-navy/20 p-6 border-b border-uk-blue/20 flex items-center gap-4">
           {step === 'planning' && <BrainCircuit className="w-8 h-8 text-purple-400 animate-pulse" />}
           {step === 'researching' && <Globe className="w-8 h-8 text-cyan-400 animate-[spin_3s_linear_infinite]" />}
           {(step === 'structuring' || step === 'drafting') && <FileText className="w-8 h-8 text-yellow-400 animate-pulse" />}
           <div>
             <h2 className="text-xl text-white font-mono font-bold tracking-widest uppercase">
               {step === 'planning' ? 'Phase 1: Strategic Planning' : 
                step === 'researching' ? 'Phase 2: Deep Research' : 
                step === 'structuring' ? 'Phase 3: Structural Design' : 'Phase 4: Synthesis & Drafting'}
             </h2>
             <p className="text-xs text-uk-blue font-mono mt-1">SENTINEL AUTONOMOUS AGENT GRID ACTIVE</p>
           </div>
        </div>
        
        <div className="flex-grow bg-black p-6 font-mono text-xs overflow-y-auto space-y-2">
          {logs.map(log => (
            <div key={log.id} className="flex gap-3 animate-[fadeIn_0.1s_ease-out]">
               <span className="text-gray-600 flex-shrink-0 w-16 text-right">
                 {new Date(log.timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
               </span>
               <span className={`${log.type === 'network' ? 'text-cyan-400' : log.type === 'ai' ? 'text-purple-400' : log.type === 'success' ? 'text-green-400 font-bold' : 'text-gray-400'}`}>
                 {log.message}
               </span>
            </div>
          ))}
          <div ref={logsEndRef} />
        </div>
      </div>
    </div>
  );
};

export default MissionWizard;