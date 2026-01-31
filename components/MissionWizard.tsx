
import React, { useState, useEffect, useRef } from 'react';
import { MissionConfig, IntelligenceReport, ResearchPlan, Entity, SourceReference, ReportStructure, ReportSection, ProcessingLog, FailedSource, Attachment } from '../types';
import { runStrategyPhase, runResearchPhase, runStructurePhase, runDraftingPhase, runFinalizePhase, extractUrls, generateMoreQueries, analyzeResearchCoverage, identifyStructuralGaps, conductTacticalResearch } from '../services/geminiService';
import { BrainCircuit, Globe, FileText, Activity, Terminal, ArrowRight, Shield, Target, Lock, Wifi, Cpu, Layers, X, ChevronRight, ChevronDown, ExternalLink, Plus, Link, Link2, AlertTriangle, Upload, RefreshCw, Paperclip, AlertOctagon } from 'lucide-react';
import mammoth from 'mammoth';

interface MissionWizardProps {
  config: MissionConfig;
  onComplete: (report: IntelligenceReport) => void;
  onCancel: () => void;
}

type WizardStep = 'planning' | 'review_plan' | 'researching' | 'review_research' | 'structuring' | 'review_structure' | 'drafting' | 'finalizing';

// --- VISUAL COMPONENTS ---

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

const LogItem: React.FC<{ log: ProcessingLog }> = ({ log }) => {
    const [expanded, setExpanded] = useState(true);
    const hasDetails = log.details && log.details.length > 0;

    return (
        <div className="flex flex-col gap-1 opacity-90 hover:opacity-100 group">
             <div className="flex gap-3 items-start">
                <span className="text-gray-600 shrink-0 font-mono text-[10px] pt-0.5">
                    {new Date(log.timestamp).toLocaleTimeString([], {hour12: false, hour:'2-digit', minute:'2-digit', second:'2-digit'})}
                </span>
                <div className="flex-1 flex flex-col">
                    <div className="flex items-center gap-2">
                        <span className={`${log.type === 'network' ? 'text-cyan-400' : log.type === 'ai' ? 'text-purple-400' : log.type === 'success' ? 'text-green-400' : 'text-gray-300'}`}>
                        {log.type === 'network' && '> [NET] '}
                        {log.type === 'ai' && '> [CPU] '}
                        {log.message}
                        </span>
                        {hasDetails && (
                            <button onClick={() => setExpanded(!expanded)} className="text-gray-500 hover:text-white transition-colors">
                                {expanded ? <ChevronDown className="w-3 h-3"/> : <ChevronRight className="w-3 h-3"/>}
                            </button>
                        )}
                    </div>
                    
                    {hasDetails && expanded && (
                        <div className="ml-2 mt-1 border-l border-gray-800 pl-4 py-1 space-y-1">
                            {log.details!.map((detail, idx) => (
                                <div key={idx} className="text-[10px] text-gray-500 font-mono flex items-center gap-2 truncate">
                                    <span className="w-1.5 h-1.5 rounded-full bg-gray-800"></span>
                                    <a href={detail} target="_blank" rel="noreferrer" className="hover:text-uk-blue hover:underline truncate w-full block">{detail}</a>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
             </div>
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
  const [failedSources, setFailedSources] = useState<FailedSource[]>([]);
  const [structure, setStructure] = useState<ReportStructure | null>(null);
  
  // Edit State
  const [editablePlan, setEditablePlan] = useState<ResearchPlan | null>(null);
  const [editableSources, setEditableSources] = useState<SourceReference[]>([]);
  const [editableStructure, setEditableStructure] = useState<ReportStructure | null>(null);
  
  // Interaction State
  const [isGeneratingQueries, setIsGeneratingQueries] = useState(false);
  const [showAddSource, setShowAddSource] = useState(false);
  const [newSourceUrl, setNewSourceUrl] = useState('');
  const [newSourceTitle, setNewSourceTitle] = useState('');
  const [newPlanUrl, setNewPlanUrl] = useState('');
  const [resolvingSourceUrl, setResolvingSourceUrl] = useState<string | null>(null);
  const [resolveText, setResolveText] = useState('');
  const resolveFileInput = useRef<HTMLInputElement>(null);

  // Error & Fallback Logic
  const [errorState, setErrorState] = useState<{ message: string, type: 'quota' | 'general' } | null>(null);
  const [useFallbackModel, setUseFallbackModel] = useState(false);
  const [retryTrigger, setRetryTrigger] = useState(0);

  const logsEndRef = useRef<HTMLDivElement>(null);
  const hasInitialized = useRef(false);

  const addLog = (msg: string, type: ProcessingLog['type'] = 'info', details?: string[]) => {
    setLogs(prev => [...prev, { id: crypto.randomUUID(), message: msg, type, timestamp: Date.now(), details }]);
  };

  useEffect(() => { logsEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [logs]);

  // Handle Quota Errors and trigger the Modal
  const handleError = (e: any) => {
      if (e.message === 'QUOTA_EXCEEDED') {
          setErrorState({ message: "High-Tier Model Quota Exceeded. The AI service is currently unavailable at this quality level.", type: 'quota' });
          addLog("CRITICAL: MODEL QUOTA EXCEEDED. OPERATION HALTED.", 'info');
      } else {
          setErrorState({ message: e.message || "An unexpected system failure occurred.", type: 'general' });
          addLog(`CRITICAL: SYSTEM ERROR - ${e.message}`, 'info');
      }
  };

  const handleRetryWithFallback = () => {
      setUseFallbackModel(true);
      setErrorState(null);
      addLog("Rerouting to Standard Model (Gemini 2.0 Flash) for resilience...", 'success');
      setRetryTrigger(prev => prev + 1); // Triggers the useEffects again
  };

  // PHASE 1
  useEffect(() => {
    if ((step === 'planning' && !plan) || (step === 'planning' && errorState === null && retryTrigger > 0)) {
      if (errorState) return; // Don't run if error pending
      const execute = async () => {
        addLog(`Initializing Sentinel Strategy Engine... ${useFallbackModel ? '[FALLBACK MODE]' : ''}`, 'planning');
        try {
          const combinedText = config.rawText + "\n" + config.attachments.map(a => a.textContent || "").join(" ");
          const extractedDocUrls = extractUrls(combinedText);
          if (extractedDocUrls.length > 0) addLog(`Extracted ${extractedDocUrls.length} references from source documents.`, 'info');

          const { plan, entities } = await runStrategyPhase(config.rawText, config.attachments, config.instructions, addLog, useFallbackModel);
          
          const fullPlan: ResearchPlan = { 
              ...plan, 
              foundUrls: Array.from(new Set([...(plan.foundUrls || []), ...extractedDocUrls])) 
          };

          setPlan(fullPlan); setEntities(entities); setEditablePlan(fullPlan);
          addLog("Strategy formulated. Awaiting Operator authorization.", 'success');
          setStep('review_plan');
        } catch (e) { handleError(e); }
      };
      execute();
    }
  }, [step, retryTrigger]);

  // PHASE 2
  const handleApprovePlan = () => { if (editablePlan) { setPlan(editablePlan); setStep('researching'); } };
  
  useEffect(() => {
    if ((step === 'researching' && plan && !researchData) || (step === 'researching' && errorState === null && retryTrigger > 0)) {
      if (errorState) return;
      const execute = async () => {
        addLog(`Deploying Global Crawler Swarm... ${useFallbackModel ? '[FALLBACK MODE]' : ''}`, 'network');
        try {
          const urlsToScan = plan!.foundUrls || [];
          const initialResult = await runResearchPhase(urlsToScan, plan!.searchQueries || [], addLog, useFallbackModel);
          
          if (initialResult.failedUrls && initialResult.failedUrls.length > 0) {
              setFailedSources(initialResult.failedUrls);
              addLog(`${initialResult.failedUrls.length} targets failed acquisition. Manual intervention requested.`, 'network');
          }

          const gapQueries = await analyzeResearchCoverage(initialResult.context, plan!.informationGaps || [], config.instructions);
          let finalContext = initialResult.context;
          let finalSources = initialResult.sources;

          if (gapQueries.length > 0) {
              addLog(`Coverage gaps detected. Deploying ${gapQueries.length} tactical agents...`, 'network');
              const tacticalResult = await conductTacticalResearch(gapQueries, addLog); // Tactical auto-uses fallback/fast usually
              finalContext += "\n\n" + tacticalResult.context;
              finalSources = [...finalSources, ...tacticalResult.sources.filter(s => !finalSources.find(fs => fs.url === s.url))];
          }
          setResearchData({ context: finalContext, sources: finalSources });
          setEditableSources(finalSources);
          addLog("Intelligence gathering complete.", 'success');
          setStep('review_research');
        } catch (e) { handleError(e); }
      };
      execute();
    }
  }, [step, plan, retryTrigger]);

  // PHASE 3
  const handleApproveResearch = () => setStep('structuring');

  useEffect(() => {
    if ((step === 'structuring' && researchData && !structure) || (step === 'structuring' && errorState === null && retryTrigger > 0)) {
      if (errorState) return;
      const execute = async () => {
        addLog(`Architecting Report Skeleton... ${useFallbackModel ? '[FALLBACK MODE]' : ''}`, 'planning');
        try {
          const activeSources = editableSources.filter(s => s.active !== false);
          const sourceManifest = activeSources.map((s, i) => `[Source ${i+1}] ${s.title} (${s.url})`).join('\n');
          const fullContext = `INSTRUCTIONS: ${config.instructions}\nRAW: ${config.rawText}\nSOURCES: ${sourceManifest}\nRESEARCH: ${researchData!.context}`;
          
          const struct = await runStructurePhase(fullContext, config.attachments, config.instructions, addLog, useFallbackModel);
          setStructure(struct); setEditableStructure(struct);
          addLog("Structure generated.", 'success');
          setStep('review_structure');
        } catch (e) { handleError(e); }
      };
      execute();
    }
  }, [step, researchData, retryTrigger]);

  // PHASE 4 & 5
  const handleApproveStructure = async () => {
    if (!editableStructure || !researchData) return;
    setStructure(editableStructure);
    addLog("Verifying structural integrity against gathered intel...", 'ai');
    // We don't bubble error here strictly as it's a sub-check
    const missingQueries = await identifyStructuralGaps(editableStructure, researchData.context);
    if (missingQueries.length > 0) {
        addLog(`Gap detected. Filling void with ${missingQueries.length} queries...`, 'network');
        const tacticalResult = await conductTacticalResearch(missingQueries, addLog);
        setResearchData(prev => prev ? ({ ...prev, context: prev.context + tacticalResult.context }) : null);
    }
    setStep('drafting');
  };

  useEffect(() => {
    if ((step === 'drafting' && structure && researchData) || (step === 'drafting' && errorState === null && retryTrigger > 0)) {
      if (errorState) return;
      const execute = async () => {
        addLog(`Synthesizing Final Product... ${useFallbackModel ? '[FALLBACK MODE]' : ''}`, 'synthesizing');
        try {
          const activeSources = editableSources.filter(s => s.active !== false);
          const sourceManifest = activeSources.map((s, i) => `[${i+1}] ${s.title}: ${s.summary} (${s.url})`).join('\n');
          const fullContext = `INSTRUCTIONS: ${config.instructions}\nRAW: ${config.rawText}\nSOURCES: ${sourceManifest}\nRESEARCH: ${researchData!.context}`;

          const sections = await runDraftingPhase(structure!, fullContext, config.attachments, config.instructions, addLog, useFallbackModel);
          addLog("Finalizing Metadata and Classification...", 'ai');
          const meta = await runFinalizePhase(sections, plan?.reliabilityAssessment || "Unknown", config.instructions, addLog, useFallbackModel);
          
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
            relevantLinks: activeSources
          });
        } catch (e) { handleError(e); }
      };
      execute();
    }
  }, [step, structure, retryTrigger]);

  // --- HANDLERS FOR UI ---
  const handleAutoGenerateQueries = async () => {
    if (!editablePlan) return;
    setIsGeneratingQueries(true);
    addLog("Analyzing strategy gaps...", 'ai');
    try {
        const moreQueries = await generateMoreQueries(
            config.rawText + "\n" + config.instructions, 
            editablePlan.searchQueries, 
            config.instructions
        );
        if (moreQueries.length > 0) {
            setEditablePlan(prev => prev ? ({ ...prev, searchQueries: [...prev.searchQueries, ...moreQueries] }) : null);
            addLog(`Strategy expanded with ${moreQueries.length} new vectors.`, 'success');
        } else {
            addLog("Strategy appears optimal. No new vectors generated.", 'info');
        }
    } catch (e) { addLog("Failed to generate queries.", 'info'); } finally { setIsGeneratingQueries(false); }
  };

  const handleAddManualSource = () => {
      if (!newSourceUrl.trim()) return;
      const newSource: SourceReference = {
          url: newSourceUrl,
          title: newSourceTitle || newSourceUrl,
          summary: "Manually added by operator.",
          active: true
      };
      setEditableSources(prev => [...prev, newSource]);
      setNewSourceUrl(''); setNewSourceTitle(''); setShowAddSource(false);
      addLog(`Manual source added: ${newSource.title}`, 'info');
  };
  
  const handleResolveFailedSource = (url: string) => {
      if (!resolveText.trim()) return;
      const newSource: SourceReference = {
          url: url,
          title: "Manual Upload (Resolved)",
          summary: "Content provided by operator after automated fetch failure.",
          active: true
      };
      setEditableSources(prev => [...prev, newSource]);
      setResearchData(prev => prev ? ({ ...prev, context: prev.context + `\n[MANUAL UPLOAD FOR ${url}]\n${resolveText}\n` }) : null);
      setFailedSources(prev => prev.filter(f => f.url !== url));
      setResolvingSourceUrl(null); setResolveText('');
      addLog(`Resolved failed source: ${url}`, 'success');
  };
  
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files[0]) {
          const file = e.target.files[0];
          try {
              let text = "";
              if (file.name.endsWith('.docx')) {
                  const arrayBuffer = await file.arrayBuffer();
                  const result = await mammoth.extractRawText({ arrayBuffer });
                  text = result.value;
              } else { text = await file.text(); }
              setResolveText(text);
          } catch (e) { alert("Failed to read file"); }
      }
  };

  const isReview = step.startsWith('review');

  return (
    <div className="absolute inset-0 bg-gray-950 z-50 text-gray-100 font-mono flex flex-col">
      
      {/* ERROR MODAL */}
      {errorState && (
          <div className="absolute inset-0 z-[100] bg-black/80 backdrop-blur-md flex items-center justify-center p-8 animate-[fadeIn_0.2s_ease-out]">
              <div className="bg-gray-900 border-2 border-red-500 rounded-lg shadow-2xl max-w-lg w-full overflow-hidden">
                  <div className="bg-red-500/10 p-6 border-b border-red-500/30 flex items-start gap-4">
                      <AlertOctagon className="w-12 h-12 text-red-500 flex-shrink-0 animate-pulse" />
                      <div>
                          <h2 className="text-xl font-bold text-white uppercase tracking-wider mb-2">Operation Interrupted</h2>
                          <p className="text-sm text-red-200">{errorState.message}</p>
                      </div>
                  </div>
                  <div className="p-6 bg-black/50 space-y-4">
                      {errorState.type === 'quota' && (
                          <div className="text-xs text-gray-400 bg-gray-800 p-3 rounded border border-gray-700">
                              <p className="mb-2"><strong className="text-white">Reason:</strong> The advanced reasoning model (Gemini 3 Pro) has exceeded the daily or minute-level usage limits for this API key.</p>
                              <p><strong className="text-white">Recommendation:</strong> Reroute the operation through the standard throughput model (Gemini 2 Flash). Quality will be maintained, though deep reasoning capability may be slightly reduced.</p>
                          </div>
                      )}
                  </div>
                  <div className="p-4 bg-gray-900 border-t border-gray-800 flex justify-end gap-3">
                      <button onClick={onCancel} className="px-4 py-2 text-gray-400 hover:text-white text-xs uppercase font-bold">Abort Mission</button>
                      {errorState.type === 'quota' && (
                          <button 
                            onClick={handleRetryWithFallback}
                            className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded text-xs font-bold uppercase flex items-center gap-2 shadow-[0_0_15px_rgba(220,38,38,0.5)]"
                          >
                            <RefreshCw className="w-4 h-4" /> Use Standard Model (Resume)
                          </button>
                      )}
                  </div>
              </div>
          </div>
      )}

      {/* Header */}
      <div className="h-16 border-b border-gray-800 bg-gray-900 flex items-center justify-between px-6">
         <div className="flex items-center gap-3">
             <Shield className="w-6 h-6 text-uk-blue animate-pulse" />
             <h1 className="text-lg font-bold tracking-widest uppercase">Sentinel <span className="text-uk-blue">Process Grid</span></h1>
             {useFallbackModel && <span className="bg-yellow-900/50 text-yellow-500 text-[10px] px-2 py-0.5 rounded border border-yellow-700 font-bold uppercase tracking-wider">Fallback Mode Active</span>}
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
                 <LogItem key={log.id} log={log} />
               ))}
               <div ref={logsEndRef} />
            </div>
         </div>

         {/* Right Panel: Visualization / Review */}
         {isReview && (
            <div className="flex-1 bg-gray-900 overflow-y-auto p-8 animate-[slideIn_0.3s_ease-out]">
               {/* REVIEW PLAN */}
               {step === 'review_plan' && editablePlan && (
                  <div className="max-w-3xl mx-auto space-y-6">
                     <h2 className="text-xl font-bold uppercase text-white border-b border-gray-700 pb-2 flex items-center gap-2"><Target className="w-5 h-5 text-uk-blue"/> Mission Strategy Review</h2>
                     
                     <div className="bg-black border border-gray-800 p-4 rounded">
                        <label className="text-xs text-gray-500 uppercase font-bold">Reliability Assessment</label>
                        <textarea value={editablePlan.reliabilityAssessment} onChange={e=>setEditablePlan({...editablePlan, reliabilityAssessment: e.target.value})} className="w-full bg-transparent text-sm mt-2 focus:outline-none text-gray-300" rows={3} />
                     </div>

                     <div className="space-y-2">
                        <label className="text-xs text-gray-500 uppercase font-bold flex items-center gap-2"><Link2 className="w-3 h-3"/> Identified Direct Targets (Docs & Input)</label>
                        <div className="bg-gray-900 border border-gray-800 rounded p-2 space-y-2">
                             {(editablePlan.foundUrls || []).length > 0 ? (
                                 editablePlan.foundUrls?.map((url, i) => (
                                    <div key={i} className="flex gap-2 items-center bg-black/40 p-1.5 rounded">
                                        <ExternalLink className="w-3 h-3 text-uk-blue flex-shrink-0" />
                                        <input 
                                            value={url} 
                                            onChange={e => { const n = [...(editablePlan.foundUrls || [])]; n[i] = e.target.value; setEditablePlan({...editablePlan, foundUrls: n}); }}
                                            className="flex-1 bg-transparent text-xs text-cyan-300 font-mono outline-none"
                                        />
                                        <button onClick={() => { const n = (editablePlan.foundUrls || []).filter((_, idx) => idx !== i); setEditablePlan({...editablePlan, foundUrls: n}); }} className="text-gray-600 hover:text-red-500"><X className="w-3 h-3" /></button>
                                    </div>
                                 ))
                             ) : ( <div className="text-[10px] text-gray-600 italic px-2">No direct URL links extracted.</div> )}
                             
                             <div className="flex gap-2 pt-1 border-t border-gray-800 mt-2">
                                <input value={newPlanUrl} onChange={e => setNewPlanUrl(e.target.value)} placeholder="Add Target URL..." className="flex-1 bg-black border border-gray-700 rounded px-2 py-1 text-xs text-white focus:border-uk-blue outline-none" />
                                <button onClick={() => { if(newPlanUrl) { setEditablePlan({...editablePlan, foundUrls: [...(editablePlan.foundUrls || []), newPlanUrl]}); setNewPlanUrl(''); } }} className="bg-gray-700 hover:bg-uk-blue px-2 rounded text-white"><Plus className="w-3 h-3" /></button>
                             </div>
                        </div>
                     </div>

                     <div className="space-y-2">
                        <label className="text-xs text-gray-500 uppercase font-bold">Planned Vectors (Search Queries)</label>
                        {editablePlan.searchQueries.map((q, i) => (
                           <div key={i} className="flex gap-2 items-center">
                              <span className="text-gray-600 text-xs py-2 w-6 text-right font-mono">{i+1 < 10 ? `0${i+1}` : i+1}.</span>
                              <input value={q} onChange={e => { const n = [...editablePlan.searchQueries]; n[i] = e.target.value; setEditablePlan({...editablePlan, searchQueries: n}); }} className="flex-1 bg-gray-800 border border-gray-700 p-2 rounded text-sm text-cyan-300 font-mono focus:border-uk-blue outline-none transition-colors" />
                              <button onClick={() => { const n = editablePlan.searchQueries.filter((_, idx) => idx !== i); setEditablePlan({...editablePlan, searchQueries: n}); }} className="p-2 text-gray-500 hover:text-red-500 transition-colors"><X className="w-4 h-4" /></button>
                           </div>
                        ))}
                        <div className="flex gap-2 mt-3">
                            <button onClick={() => setEditablePlan({ ...editablePlan, searchQueries: [...editablePlan.searchQueries, ""] })} className="text-xs bg-gray-800 hover:bg-gray-700 text-white px-3 py-1.5 rounded uppercase font-bold flex items-center gap-1"><Plus className="w-3 h-3" /> Add Vector</button>
                            <button onClick={handleAutoGenerateQueries} disabled={isGeneratingQueries} className={`text-xs px-3 py-1.5 rounded uppercase font-bold flex items-center gap-1 transition-all ${isGeneratingQueries ? 'bg-purple-900/50 text-purple-200' : 'bg-purple-900 hover:bg-purple-800 text-white'}`}>
                                {isGeneratingQueries ? <Activity className="w-3 h-3 animate-spin"/> : <BrainCircuit className="w-3 h-3" />} Auto-Expand Strategy
                            </button>
                        </div>
                     </div>

                     <div className="flex justify-end pt-4">
                        <button onClick={handleApprovePlan} className="bg-uk-blue hover:bg-blue-600 text-white px-6 py-2 rounded font-bold uppercase text-xs flex items-center gap-2">Initialize Phase 2 <ArrowRight className="w-4 h-4"/></button>
                     </div>
                  </div>
               )}

               {/* REVIEW RESEARCH */}
               {step === 'review_research' && (
                  <div className="max-w-3xl mx-auto space-y-6">
                     <h2 className="text-xl font-bold uppercase text-white border-b border-gray-700 pb-2 flex items-center gap-2"><Globe className="w-5 h-5 text-cyan-500"/> Intelligence Asset Review</h2>
                     
                     {failedSources.length > 0 && (
                         <div className="bg-red-950/30 border border-red-900 rounded p-4 space-y-3">
                             <h3 className="text-red-400 text-xs font-bold uppercase flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> Target Acquisition Failures</h3>
                             <div className="space-y-2">
                                 {failedSources.map((fs, i) => (
                                     <div key={i} className="flex flex-col md:flex-row md:items-center justify-between gap-2 bg-red-900/20 p-2 rounded">
                                         <div className="overflow-hidden">
                                             <div className="flex items-center gap-2">
                                                 <a href={fs.url} target="_blank" rel="noreferrer" className="text-xs font-bold text-red-200 hover:underline truncate">{fs.url}</a>
                                                 {fs.isHighValue && <span className="bg-red-600 text-white text-[9px] font-bold px-1.5 rounded">HIGH VALUE</span>}
                                             </div>
                                             <div className="text-[10px] text-red-400 font-mono">{fs.reason}</div>
                                         </div>
                                         <button onClick={() => setResolvingSourceUrl(fs.url)} className="whitespace-nowrap bg-red-900 hover:bg-red-800 text-white px-3 py-1 rounded text-[10px] font-bold uppercase flex items-center gap-2">
                                             <Upload className="w-3 h-3" /> Upload Intel
                                         </button>
                                     </div>
                                 ))}
                             </div>
                         </div>
                     )}

                     {resolvingSourceUrl && (
                         <div className="bg-gray-800 border border-gray-700 rounded p-4 space-y-3 animate-[fadeIn_0.2s_ease-out]">
                             <div className="flex justify-between items-center">
                                 <h3 className="text-xs font-bold text-white uppercase">Manually Input Intelligence: {resolvingSourceUrl}</h3>
                                 <button onClick={() => setResolvingSourceUrl(null)} className="text-gray-500 hover:text-white"><X className="w-4 h-4"/></button>
                             </div>
                             <textarea value={resolveText} onChange={e => setResolveText(e.target.value)} placeholder="Paste content..." className="w-full h-32 bg-black border border-gray-600 rounded p-2 text-xs text-gray-300 font-mono focus:border-uk-blue outline-none" />
                             <div className="flex justify-between items-center">
                                 <div className="flex items-center gap-2">
                                    <input type="file" ref={resolveFileInput} className="hidden" onChange={handleFileUpload} accept=".txt,.md,.json,.csv,.docx" />
                                    <button onClick={() => resolveFileInput.current?.click()} className="text-xs text-uk-blue hover:text-white flex items-center gap-1 font-bold uppercase"><Paperclip className="w-3 h-3" /> Upload File</button>
                                 </div>
                                 <button onClick={() => handleResolveFailedSource(resolvingSourceUrl)} className="bg-uk-blue hover:bg-blue-600 text-white px-4 py-1.5 rounded text-xs font-bold uppercase">Confirm Resolution</button>
                             </div>
                         </div>
                     )}

                     <div className="space-y-2">
                        {editableSources.map((src, i) => (
                           <div key={i} className={`p-3 border rounded border-gray-800 flex items-start gap-3 ${src.active !== false ? 'bg-gray-800/50' : 'opacity-50'}`}>
                              <input type="checkbox" checked={src.active !== false} onChange={e => {const n=[...editableSources];n[i]={...src, active: e.target.checked};setEditableSources(n)}} className="mt-1" />
                              <div className="flex-1 overflow-hidden">
                                 <div className="flex justify-between items-start">
                                    <div className="font-bold text-sm text-cyan-400 truncate pr-2">{src.title}</div>
                                    <a href={src.url} target="_blank" rel="noreferrer" className="text-gray-500 hover:text-white"><ExternalLink className="w-3 h-3" /></a>
                                 </div>
                                 <div className="text-xs text-gray-500 truncate mb-1 font-mono">{src.url}</div>
                              </div>
                           </div>
                        ))}
                     </div>

                     <div className="border-t border-gray-800 pt-3">
                         {!showAddSource ? (
                             <button onClick={() => setShowAddSource(true)} className="text-xs text-gray-500 hover:text-cyan-400 flex items-center gap-2 font-bold uppercase"><Plus className="w-3 h-3" /> Add Manual Source</button>
                         ) : (
                             <div className="bg-gray-900 border border-gray-700 p-3 rounded space-y-2 animate-[fadeIn_0.2s_ease-out]">
                                 <div className="flex items-center gap-2 text-xs font-bold text-gray-400 uppercase"><Link className="w-3 h-3"/> New Source Entry</div>
                                 <input value={newSourceUrl} onChange={e => setNewSourceUrl(e.target.value)} placeholder="https://..." className="w-full bg-black border border-gray-700 rounded px-2 py-1.5 text-xs text-white focus:border-uk-blue outline-none" />
                                 <input value={newSourceTitle} onChange={e => setNewSourceTitle(e.target.value)} placeholder="Title" className="w-full bg-black border border-gray-700 rounded px-2 py-1.5 text-xs text-white focus:border-uk-blue outline-none" />
                                 <div className="flex gap-2 justify-end">
                                     <button onClick={() => setShowAddSource(false)} className="px-3 py-1 text-xs text-gray-500 hover:text-white">Cancel</button>
                                     <button onClick={handleAddManualSource} className="px-3 py-1 bg-uk-blue text-white rounded text-xs font-bold uppercase">Confirm</button>
                                 </div>
                             </div>
                         )}
                     </div>

                     <div className="flex justify-end pt-4">
                        <button onClick={handleApproveResearch} className="bg-uk-blue hover:bg-blue-600 text-white px-6 py-2 rounded font-bold uppercase text-xs flex items-center gap-2">Initialize Phase 3 <ArrowRight className="w-4 h-4"/></button>
                     </div>
                  </div>
               )}

               {/* REVIEW STRUCTURE */}
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
