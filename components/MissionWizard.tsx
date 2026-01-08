
import React, { useState, useEffect, useRef } from 'react';
import { MissionConfig, IntelligenceReport, ResearchPlan, Entity, SourceReference, ReportStructure, ReportSection, ProcessingLog } from '../types';
import { runStrategyPhase, runResearchPhase, runStructurePhase, runDraftingPhase, runFinalizePhase, extractUrls, generateMoreQueries, analyzeResearchCoverage, identifyStructuralGaps, conductTacticalResearch } from '../services/geminiService';
import { BrainCircuit, Globe, FileText, Activity, Terminal, ArrowRight, Shield, Target, Lock, Wifi, Cpu, Layers, X } from 'lucide-react';

interface MissionWizardProps {
  config: MissionConfig;
  onComplete: (report: IntelligenceReport) => void;
  onCancel: () => void;
}

type WizardStep = 'planning' | 'review_plan' | 'researching' | 'review_research' | 'structuring' | 'review_structure' | 'drafting' | 'finalizing';

// --- VISUAL COMPONENTS ---

const TacticalSpinner = () => (
  <div className="relative w-16 h-16 flex items-center justify-center">
    <div className="absolute inset-0 border-4 border-gray-800 rounded-full"></div>
    <div className="absolute inset-0 border-t-4 border-uk-blue rounded-full animate-spin"></div>
    <div className="absolute inset-2 border-2 border-gray-800 rounded-full"></div>
    <div className="absolute inset-2 border-b-2 border-cyan-500 rounded-full animate-[spin_3s_linear_infinite]"></div>
  </div>
);

const StepIndicator = ({ current, step, label, icon: Icon }: any) => {
  const isActive = current === step;
  const isPast = ['planning', 'researching', 'structuring', 'drafting'].indexOf(current) > ['planning', 'researching', 'structuring', 'drafting'].indexOf(step);
  
  return (
    <div className={`flex flex-col items-center gap-2 ${isActive ? 'opacity-100 scale-110' : 'opacity-40'} transition-all duration-500`}>
      <div className={`w-10 h-10 rounded-full flex items-center justify-center border-2 ${isActive ? 'bg-uk-blue/20 border-uk-blue text-uk-blue shadow-[0_0_15px_rgba(29,78,216,0.5)]' : 'border-gray-700 bg-gray-900 text-gray-500'}`}>
        <Icon className="w-5 h-5" />
      </div>
      <span className="text-[10px] font-bold uppercase tracking-widest">{label}</span>
    </div>
  );
};

// --- MAIN WIZARD ---

const MissionWizard: React.FC<MissionWizardProps> = ({ config, onComplete, onCancel }) => {
  const [step, setStep] = useState<WizardStep>('planning');
  const [logs, setLogs] = useState<ProcessingLog[]>([]);
  
  // Data State
  const [plan, setPlan] = useState<ResearchPlan | null>(null);
  const [entities, setEntities] = useState<Entity[]>([]);
  const [researchData, setResearchData] = useState<{ context: string, sources: SourceReference[] } | null>(null);
  const [structure, setStructure] = useState<ReportStructure | null>(null);
  
  // Edit State
  const [editablePlan, setEditablePlan] = useState<ResearchPlan | null>(null);
  const [editableSources, setEditableSources] = useState<SourceReference[]>([]);
  const [editableStructure, setEditableStructure] = useState<ReportStructure | null>(null);
  
  const logsEndRef = useRef<HTMLDivElement>(null);
  const addLog = (msg: string, type: ProcessingLog['type'] = 'info') => {
    setLogs(prev => [...prev, { id: crypto.randomUUID(), message: msg, type, timestamp: Date.now() }]);
  };

  useEffect(() => { logsEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [logs]);

  // --- LOGIC HOOKS (Identical Logic, Improved UI) ---

  // PHASE 1
  useEffect(() => {
    if (step === 'planning') {
      const execute = async () => {
        addLog("Initializing Sentinel Strategy Engine...", 'planning');
        try {
          // Pass attachments to Strategy Phase
          const { plan, entities } = await runStrategyPhase(config.rawText, config.attachments, config.instructions, addLog);
          setPlan(plan); setEntities(entities); setEditablePlan(plan);
          addLog("Strategy formulated. Awaiting Operator authorization.", 'success');
          setStep('review_plan');
        } catch (e) { addLog(`Critical Failure: ${e}`, 'info'); }
      };
      execute();
    }
  }, [step]);

  // PHASE 2
  const handleApprovePlan = () => { if (editablePlan) { setPlan(editablePlan); setStep('researching'); } };
  
  useEffect(() => {
    if (step === 'researching' && plan) {
      const execute = async () => {
        addLog("Deploying Global Crawler Swarm...", 'network');
        try {
          const combinedText = config.rawText + "\n" + config.attachments.map(a => a.textContent || "").join(" ");
          const initialResult = await runResearchPhase(extractUrls(combinedText), plan.searchQueries || [], addLog);
          const gapQueries = await analyzeResearchCoverage(initialResult.context, plan.informationGaps || [], config.instructions);
          
          let finalContext = initialResult.context;
          let finalSources = initialResult.sources;

          if (gapQueries.length > 0) {
              addLog(`Coverage gaps detected. Deploying ${gapQueries.length} tactical agents...`, 'network');
              const tacticalResult = await conductTacticalResearch(gapQueries, addLog);
              finalContext += "\n\n" + tacticalResult.context;
              finalSources = [...finalSources, ...tacticalResult.sources.filter(s => !finalSources.find(fs => fs.url === s.url))];
          }
          setResearchData({ context: finalContext, sources: finalSources });
          setEditableSources(finalSources);
          addLog("Intelligence gathering complete.", 'success');
          setStep('review_research');
        } catch (e) { addLog(`Research Error: ${e}`, 'info'); }
      };
      execute();
    }
  }, [step, plan]);

  // PHASE 3
  const handleApproveResearch = () => setStep('structuring');

  useEffect(() => {
    if (step === 'structuring' && researchData) {
      const execute = async () => {
        addLog("Architecting Report Skeleton...", 'planning');
        try {
          const activeSources = editableSources.filter(s => s.active !== false);
          const sourceManifest = activeSources.map((s, i) => `[Source ${i+1}] ${s.title} (${s.url})`).join('\n');
          const fullContext = `INSTRUCTIONS: ${config.instructions}\nRAW: ${config.rawText}\nSOURCES: ${sourceManifest}\nRESEARCH: ${researchData.context}`;
          
          // Pass attachments to Structure Phase
          const struct = await runStructurePhase(fullContext, config.attachments, config.instructions, addLog);
          setStructure(struct); setEditableStructure(struct);
          addLog("Structure generated.", 'success');
          setStep('review_structure');
        } catch (e) { addLog(`Structure Error: ${e}`, 'info'); }
      };
      execute();
    }
  }, [step, researchData]);

  // PHASE 4 & 5
  const handleApproveStructure = async () => {
    if (!editableStructure || !researchData) return;
    setStructure(editableStructure);
    // Structural Gap Check
    addLog("Verifying structural integrity against gathered intel...", 'ai');
    const missingQueries = await identifyStructuralGaps(editableStructure, researchData.context);
    if (missingQueries.length > 0) {
        addLog(`Gap detected. Filling void with ${missingQueries.length} queries...`, 'network');
        const tacticalResult = await conductTacticalResearch(missingQueries, addLog);
        setResearchData(prev => prev ? ({ ...prev, context: prev.context + tacticalResult.context }) : null);
    }
    setStep('drafting');
  };

  useEffect(() => {
    if (step === 'drafting' && structure && researchData) {
      const execute = async () => {
        addLog("Synthesizing Final Product...", 'synthesizing');
        try {
          const activeSources = editableSources.filter(s => s.active !== false);
          const sourceManifest = activeSources.map((s, i) => `[${i+1}] ${s.title}: ${s.summary} (${s.url})`).join('\n');
          const fullContext = `INSTRUCTIONS: ${config.instructions}\nRAW: ${config.rawText}\nSOURCES: ${sourceManifest}\nRESEARCH: ${researchData.context}`;

          // Pass attachments to Drafting Phase
          const sections = await runDraftingPhase(structure, fullContext, config.attachments, config.instructions, addLog);
          addLog("Finalizing Metadata and Classification...", 'ai');
          const meta = await runFinalizePhase(sections, plan?.reliabilityAssessment || "Unknown", config.instructions, addLog);

          onComplete({
            classification: meta.classification,
            handlingInstructions: meta.handlingInstructions || "UK EYES ONLY",
            reportTitle: meta.reportTitle,
            referenceNumber: `UKIC-${new Date().getFullYear()}-${Math.floor(Math.random()*10000)}-INTREP`,
            dateOfInformation: new Date().toISOString().split('T')[0],
            executiveSummary: meta.executiveSummary,
            sections: sections,
            entities: entities,
            sourceReliability: plan?.reliabilityAssessment || "Unknown",
            analystComment: "Generated via Sentinel.",
            overallConfidence: meta.overallConfidence,
            relevantLinks: activeSources
          });
        } catch (e) { addLog(`Drafting Error: ${e}`, 'info'); }
      };
      execute();
    }
  }, [step, structure]);


  // --- RENDER ---
  
  const isReview = step.startsWith('review');

  return (
    <div className="absolute inset-0 bg-gray-950 z-50 text-gray-100 font-mono flex flex-col">
      
      {/* Header */}
      <div className="h-16 border-b border-gray-800 bg-gray-900 flex items-center justify-between px-6">
         <div className="flex items-center gap-3">
             <Shield className="w-6 h-6 text-uk-blue animate-pulse" />
             <h1 className="text-lg font-bold tracking-widest uppercase">Sentinel <span className="text-uk-blue">Process Grid</span></h1>
         </div>
         <button onClick={onCancel} className="text-xs text-red-500 hover:text-red-400 font-bold uppercase tracking-wider">[ ABORT OPERATION ]</button>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden">
         
         {/* Left Panel: Log Terminal */}
         <div className={`flex flex-col border-r border-gray-800 bg-black transition-all duration-500 ${isReview ? 'w-1/3' : 'w-full max-w-2xl mx-auto border-r-0 border-x'}`}>
            <div className="p-2 border-b border-gray-800 bg-gray-900/50 flex items-center justify-between">
               <span className="text-[10px] uppercase font-bold text-gray-500 flex items-center gap-2"><Terminal className="w-3 h-3"/> System Log</span>
               <Activity className="w-3 h-3 text-green-500 animate-pulse" />
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-2 font-mono text-xs">
               {logs.map(log => (
                 <div key={log.id} className="flex gap-3 opacity-80 hover:opacity-100">
                    <span className="text-gray-600 shrink-0">{new Date(log.timestamp).toLocaleTimeString([], {hour12: false, hour:'2-digit', minute:'2-digit', second:'2-digit'})}</span>
                    <span className={`${log.type === 'network' ? 'text-cyan-400' : log.type === 'ai' ? 'text-purple-400' : log.type === 'success' ? 'text-green-400' : 'text-gray-300'}`}>
                      {log.type === 'network' && '> [NET] '}
                      {log.type === 'ai' && '> [CPU] '}
                      {log.message}
                    </span>
                 </div>
               ))}
               <div ref={logsEndRef} />
            </div>
         </div>

         {/* Right Panel: Visualization / Review */}
         {isReview && (
            <div className="flex-1 bg-gray-900 overflow-y-auto p-8 animate-[slideIn_0.3s_ease-out]">
               {step === 'review_plan' && editablePlan && (
                  <div className="max-w-3xl mx-auto space-y-6">
                     <h2 className="text-xl font-bold uppercase text-white border-b border-gray-700 pb-2 flex items-center gap-2"><Target className="w-5 h-5 text-uk-blue"/> Mission Strategy Review</h2>
                     
                     <div className="bg-black border border-gray-800 p-4 rounded">
                        <label className="text-xs text-gray-500 uppercase font-bold">Reliability Assessment</label>
                        <textarea value={editablePlan.reliabilityAssessment} onChange={e=>setEditablePlan({...editablePlan, reliabilityAssessment: e.target.value})} className="w-full bg-transparent text-sm mt-2 focus:outline-none text-gray-300" rows={3} />
                     </div>

                     <div className="space-y-2">
                        <label className="text-xs text-gray-500 uppercase font-bold">Planned Vectors (Queries)</label>
                        {editablePlan.searchQueries.map((q, i) => (
                           <div key={i} className="flex gap-2 items-center">
                              <span className="text-gray-600 text-xs py-2 w-6 text-right font-mono">{i+1 < 10 ? `0${i+1}` : i+1}.</span>
                              <input 
                                value={q} 
                                onChange={e => {
                                  const n = [...editablePlan.searchQueries];
                                  n[i] = e.target.value;
                                  setEditablePlan({...editablePlan, searchQueries: n});
                                }} 
                                className="flex-1 bg-gray-800 border border-gray-700 p-2 rounded text-sm text-cyan-300 font-mono focus:border-uk-blue outline-none transition-colors" 
                              />
                              <button 
                                onClick={() => {
                                  const n = editablePlan.searchQueries.filter((_, idx) => idx !== i);
                                  setEditablePlan({...editablePlan, searchQueries: n});
                                }}
                                className="p-2 text-gray-500 hover:text-red-500 transition-colors"
                                title="Remove Query"
                              >
                                <X className="w-4 h-4" />
                              </button>
                           </div>
                        ))}
                        {editablePlan.searchQueries.length === 0 && (
                          <div className="text-xs text-gray-500 italic p-2 text-center border border-dashed border-gray-800 rounded">
                            No search vectors defined. Add manual queries or proceed without research.
                          </div>
                        )}
                        <button 
                          onClick={() => setEditablePlan({
                            ...editablePlan, 
                            searchQueries: [...editablePlan.searchQueries, ""]
                          })}
                          className="text-xs text-uk-blue hover:text-white font-bold uppercase mt-2"
                        >
                          + Add Vector
                        </button>
                     </div>

                     <div className="flex justify-end pt-4">
                        <button onClick={handleApprovePlan} className="bg-uk-blue hover:bg-blue-600 text-white px-6 py-2 rounded font-bold uppercase text-xs flex items-center gap-2">Initialize Phase 2 <ArrowRight className="w-4 h-4"/></button>
                     </div>
                  </div>
               )}

               {step === 'review_research' && (
                  <div className="max-w-3xl mx-auto space-y-6">
                     <h2 className="text-xl font-bold uppercase text-white border-b border-gray-700 pb-2 flex items-center gap-2"><Globe className="w-5 h-5 text-cyan-500"/> Intelligence Asset Review</h2>
                     <div className="space-y-2">
                        {editableSources.map((src, i) => (
                           <div key={i} className={`p-3 border rounded border-gray-800 flex gap-3 ${src.active !== false ? 'bg-gray-800/50' : 'opacity-50'}`}>
                              <input type="checkbox" checked={src.active !== false} onChange={e => {const n=[...editableSources];n[i]={...src, active: e.target.checked};setEditableSources(n)}} />
                              <div>
                                 <div className="font-bold text-sm text-cyan-400 truncate w-full">{src.title}</div>
                                 <div className="text-xs text-gray-500 truncate">{src.url}</div>
                              </div>
                           </div>
                        ))}
                     </div>
                     <div className="flex justify-end pt-4">
                        <button onClick={handleApproveResearch} className="bg-uk-blue hover:bg-blue-600 text-white px-6 py-2 rounded font-bold uppercase text-xs flex items-center gap-2">Initialize Phase 3 <ArrowRight className="w-4 h-4"/></button>
                     </div>
                  </div>
               )}

               {step === 'review_structure' && editableStructure && (
                  <div className="max-w-3xl mx-auto space-y-6">
                     <h2 className="text-xl font-bold uppercase text-white border-b border-gray-700 pb-2 flex items-center gap-2"><Layers className="w-5 h-5 text-yellow-500"/> Structural Design Review</h2>
                     <div className="space-y-4">
                        {editableStructure.sections.map((sec, i) => (
                           <div key={i} className="p-4 bg-gray-800 border border-gray-700 rounded relative group">
                              <input value={sec.title} onChange={e=>{const n=[...editableStructure.sections];n[i]={...sec, title:e.target.value};setEditableStructure({...editableStructure, sections:n})}} className="bg-transparent font-bold text-white w-full border-b border-gray-600 pb-1 mb-2 focus:border-uk-blue outline-none" />
                              <textarea value={sec.guidance} onChange={e=>{const n=[...editableStructure.sections];n[i]={...sec, guidance:e.target.value};setEditableStructure({...editableStructure, sections:n})}} className="w-full bg-black/20 text-xs text-gray-400 p-2 rounded h-16 resize-none" />
                           </div>
                        ))}
                     </div>
                     <div className="flex justify-end pt-4">
                        <button onClick={handleApproveStructure} className="bg-uk-blue hover:bg-blue-600 text-white px-6 py-2 rounded font-bold uppercase text-xs flex items-center gap-2">Execute Synthesis <ArrowRight className="w-4 h-4"/></button>
                     </div>
                  </div>
               )}
            </div>
         )}
      </div>

      {/* Footer Status Bar */}
      <div className="h-20 bg-gray-900 border-t border-gray-800 flex justify-center items-center gap-8">
         <StepIndicator current={step} step="planning" label="Strategy" icon={BrainCircuit} />
         <div className="w-12 h-px bg-gray-800"></div>
         <StepIndicator current={step} step="researching" label="Intel Grid" icon={Globe} />
         <div className="w-12 h-px bg-gray-800"></div>
         <StepIndicator current={step} step="structuring" label="Architecture" icon={Layers} />
         <div className="w-12 h-px bg-gray-800"></div>
         <StepIndicator current={step} step="drafting" label="Synthesis" icon={FileText} />
      </div>
    </div>
  );
};

export default MissionWizard;