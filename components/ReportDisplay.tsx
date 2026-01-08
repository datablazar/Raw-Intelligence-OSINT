
import React, { useState, useRef, useEffect } from 'react';
import { IntelligenceReport, Classification, HistoryItem, ProcessingLog } from '../types';
import { Printer, Download, Clock, ChevronDown, Sparkles, X, Wand2, MessageSquareText, ShieldCheck, Globe, AlertCircle, Pencil, User, MapPin, Building, Hash, Zap, Calendar, Search, Trash2, FileJson, FileText, AlertTriangle, Crosshair, ExternalLink } from 'lucide-react';
import { refineSection, createReportChatSession, verifyClaim, VerificationResult, conductDeepResearch } from '../services/geminiService';
import ChatInterface from './ChatInterface';
import { Chat } from '@google/genai';

interface ReportDisplayProps {
  report: IntelligenceReport | null;
  reset: () => void;
  history: HistoryItem[];
  currentReportId: string | null;
  onSelectReport: (id: string) => void;
  onUpdateReport: (report: IntelligenceReport) => void;
  onClearHistory?: () => void;
  rawContext?: string;
  onProcessingStart?: (logs: ProcessingLog[]) => void;
  onProcessingEnd?: () => void;
  onProcessingLog?: (msg: string, type: 'info'|'network'|'ai'|'success'|'planning'|'synthesizing') => void;
}

const ReportDisplay: React.FC<ReportDisplayProps> = ({ 
  report, 
  history, 
  onSelectReport,
  onUpdateReport,
  onClearHistory,
  rawContext = "",
  onProcessingStart,
  onProcessingEnd,
  onProcessingLog
}) => {
  const [activeTab, setActiveTab] = useState<'report' | 'entities' | 'json'>('report');
  const [showHistory, setShowHistory] = useState(false);
  const [showChat, setShowChat] = useState(false);
  
  // Refinement & Edit State
  const [refineSectionTitle, setRefineSectionTitle] = useState<string | null>(null);
  const [refineInstruction, setRefineInstruction] = useState("");
  const [isRefining, setIsRefining] = useState(false);
  const [editSectionTitle, setEditSectionTitle] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  
  // Deep Research State
  const [showResearchModal, setShowResearchModal] = useState(false);
  const [researchTopic, setResearchTopic] = useState("");

  // Verification State
  const [verifications, setVerifications] = useState<Record<string, VerificationResult & { groundingMetadata: any }>>({});
  const [verifyingId, setVerifyingId] = useState<string | null>(null);

  // Chat State
  const [chatSession, setChatSession] = useState<Chat | null>(null);

  const historyRef = useRef<HTMLDivElement>(null);
  const refineInputRef = useRef<HTMLTextAreaElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);
  const entityFooterRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (historyRef.current && !historyRef.current.contains(event.target as Node)) {
        setShowHistory(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (report) {
      const session = createReportChatSession(report, rawContext);
      setChatSession(session);
      setVerifications({});
    } else {
      setChatSession(null);
      setShowChat(false);
    }
  }, [report?.referenceNumber]);

  useEffect(() => {
     if (refineSectionTitle) refineInputRef.current?.focus();
  }, [refineSectionTitle]);

  if (!report) return null;

  const getClassificationColor = (cls: Classification) => {
    switch (cls) {
      case Classification.TOP_SECRET: return 'text-red-700 border-red-700 bg-red-50';
      case Classification.SECRET: return 'text-orange-700 border-orange-700 bg-orange-50';
      case Classification.OFFICIAL_SENSITIVE: return 'text-blue-800 border-blue-800 bg-blue-50';
      default: return 'text-gray-700 border-gray-700 bg-gray-50';
    }
  };

  const handleExport = () => {
    const element = document.createElement("a");
    const file = new Blob([JSON.stringify(report, null, 2)], {type: 'application/json'});
    element.href = URL.createObjectURL(file);
    element.download = `${report.referenceNumber}.json`;
    document.body.appendChild(element);
    element.click();
  };

  const executeRefinement = async () => {
    if (!refineSectionTitle || !refineInstruction.trim()) return;
    setIsRefining(true);
    try {
      const newContent = await refineSection(report, refineSectionTitle, refineInstruction);
      const updatedReport = {
        ...report,
        sections: report.sections.map(s => {
          if (s.title === refineSectionTitle) {
            // Update content AND type based on what AI returned
            const isList = Array.isArray(newContent);
            return { ...s, content: newContent, type: (isList ? 'list' : 'text') as 'text' | 'list' };
          }
          return s;
        })
      };
      onUpdateReport(updatedReport);
      setRefineSectionTitle(null);
    } catch (err) { alert("Refinement Failed"); } finally { setIsRefining(false); }
  };

  const handleSaveEdit = () => {
    if (!editSectionTitle) return;
    const section = report.sections.find(s => s.title === editSectionTitle);
    if (!section) return;
    let newValue: string | string[] = editContent;
    if (section.type === 'list') newValue = editContent.split('\n').map(s => s.trim()).filter(s => s);
    onUpdateReport({ ...report, sections: report.sections.map(s => s.title === editSectionTitle ? { ...s, content: newValue } : s) });
    setEditSectionTitle(null);
  };

  const handleVerify = async (text: string, id: string) => {
    if (verifyingId) return;
    setVerifyingId(id);
    try {
      const result = await verifyClaim(text);
      setVerifications(prev => ({ ...prev, [id]: result }));
    } catch (e) { console.error(e); } finally { setVerifyingId(null); }
  };
  
  const handleDeepResearch = async () => {
    if (!researchTopic.trim()) return;
    setShowResearchModal(false);
    onProcessingStart?.([{ id: 'init', message: `Initializing Deep Research: ${researchTopic}`, type: 'info', timestamp: Date.now() }]);
    try {
      const combinedContext = `=== RAW INTEL ===\n${rawContext}\n=== REPORT ===\n${JSON.stringify(report)}`;
      const result = await conductDeepResearch(researchTopic, combinedContext);
      onProcessingLog?.(`Completed research on ${researchTopic}`, 'success');
      
      // Merge new links safely
      const currentLinks = report.relevantLinks || [];
      const newLinks = result.links.filter(nl => !currentLinks.find(cl => cl.url === nl.url));
      
      onUpdateReport({
        ...report,
        sections: [...report.sections, { title: result.title, type: 'text', content: result.content }],
        relevantLinks: [...currentLinks, ...newLinks]
      });
      onProcessingEnd?.();
      setResearchTopic("");
    } catch (error) { onProcessingEnd?.(); alert("Research Failed"); }
  };

  const scrollToFooter = () => {
    footerRef.current?.scrollIntoView({ behavior: 'smooth' });
  };
  
  const scrollToEntities = () => {
    entityFooterRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const renderTextWithEntities = (text: string, keyPrefix: any) => {
      if (!report.entities || report.entities.length === 0) return text;
      
      const sortedEntities = [...report.entities].map((e, i) => ({...e, idx: i})).sort((a, b) => b.name.length - a.name.length);
      const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // Use capture group to split but keep delimiter
      const pattern = new RegExp(`(${sortedEntities.map(e => escapeRegExp(e.name)).join('|')})`, 'gi');
      
      const parts = text.split(pattern);
      if (parts.length === 1) return text;

      return (
        <React.Fragment key={keyPrefix}>
            {parts.map((subPart, j) => {
                const matchedEntity = sortedEntities.find(e => e.name.toLowerCase() === subPart.toLowerCase());
                if (matchedEntity) {
                    return (
                        <span key={j} onClick={scrollToEntities} className="group/entity relative border-b border-dotted border-gray-400 hover:bg-yellow-50 hover:border-yellow-400 transition-colors cursor-pointer" title={`${matchedEntity.type}: ${matchedEntity.threatLevel || 'Unknown'} Threat`}>
                            {subPart}
                            <sup className="text-[9px] font-bold text-gray-500 ml-0.5 select-none hover:text-uk-red">
                                E{matchedEntity.idx + 1}
                            </sup>
                        </span>
                    );
                }
                return subPart;
            })}
        </React.Fragment>
      );
  };

  const renderEnrichedContent = (content: string | any) => {
    // Safety check for non-string content (e.g. array when type mismatch occurs)
    if (typeof content !== 'string') {
        if (Array.isArray(content)) {
            // Join array for display in a text block, or fallback
            return renderEnrichedContent(content.join('\n'));
        }
        return String(content || "");
    }

    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const parts = content.split(urlRegex);
    
    return parts.map((part, i) => {
      if (part.match(urlRegex)) {
        const cleanUrl = part.replace(/[.,;)]$/, '');
        const punctuation = part.slice(cleanUrl.length);
        
        const idx = report.relevantLinks?.findIndex(l => l.url === cleanUrl);
        
        if (idx !== undefined && idx !== -1) {
           return (
             <React.Fragment key={i}>
               <button 
                 onClick={scrollToFooter}
                 className="inline-flex items-center justify-center align-top text-[10px] font-bold text-white bg-uk-blue rounded-full w-4 h-4 ml-0.5 hover:bg-uk-navy transition-colors transform -translate-y-1"
                 title={`Source: ${report.relevantLinks![idx].title || cleanUrl}`}
               >
                 {idx + 1}
               </button>
               {punctuation}
             </React.Fragment>
           );
        }
        return <a key={i} href={part} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline break-all">{part}</a>;
      } else {
        return renderTextWithEntities(part, i);
      }
    });
  };

  const EntityBadge = ({ type, threat }: { type: string, threat?: string }) => {
     const getIcon = () => {
       switch(type) {
         case 'Person': return <User className="w-3 h-3" />;
         case 'Location': return <MapPin className="w-3 h-3" />;
         case 'Organization': return <Building className="w-3 h-3" />;
         case 'Cyber': return <Hash className="w-3 h-3" />;
         case 'Weapon': return <Zap className="w-3 h-3" />;
         default: return <AlertCircle className="w-3 h-3" />;
       }
     };
     const getThreatColor = () => {
       switch(threat) {
         case 'Critical': return 'bg-red-100 text-red-800 border-red-200';
         case 'High': return 'bg-orange-100 text-orange-800 border-orange-200';
         case 'Medium': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
         default: return 'bg-gray-100 text-gray-700 border-gray-200';
       }
     };
     return (
       <span className={`text-[10px] uppercase font-bold px-2 py-1 rounded border flex items-center gap-1.5 w-fit ${getThreatColor()}`}>
         {getIcon()} {type} {threat && `| ${threat}`}
       </span>
     );
  };

  return (
    <div className="flex flex-col h-full bg-gray-100 overflow-hidden relative">
      
      {/* Top Toolbar */}
      <div className="bg-white px-4 py-2 border-b border-gray-200 flex justify-between items-center no-print shadow-sm z-20">
        <div className="flex items-center gap-2">
          {/* History Dropdown */}
          <div className="relative" ref={historyRef}>
            <button onClick={() => setShowHistory(!showHistory)} className="flex items-center gap-2 px-3 py-1.5 text-xs font-bold text-uk-navy bg-gray-100 hover:bg-gray-200 rounded transition-colors uppercase tracking-wider">
              <Clock className="w-3.5 h-3.5" /> <span>Files ({history.length})</span> <ChevronDown className="w-3 h-3" />
            </button>
            {showHistory && (
               <div className="absolute left-0 mt-2 w-72 bg-white rounded shadow-xl border border-gray-200 z-50 max-h-96 overflow-y-auto">
                  <div className="p-2 border-b flex justify-between items-center bg-gray-50"><span className="text-[10px] font-bold text-gray-500 uppercase">Recent Ops</span>
                  {onClearHistory && <button onClick={onClearHistory} className="text-red-500 hover:text-red-700"><Trash2 className="w-3 h-3"/></button>}</div>
                  {history.slice().reverse().map(item => (
                    <button key={item.id} onClick={() => { onSelectReport(item.id); setShowHistory(false); }} className="w-full text-left px-4 py-3 hover:bg-blue-50 border-b border-gray-50">
                       <p className="text-xs font-bold text-gray-900 truncate">{item.report.reportTitle}</p>
                       <p className="text-[10px] text-gray-400">{new Date(item.timestamp).toLocaleString()}</p>
                    </button>
                  ))}
               </div>
            )}
          </div>
          
          <div className="h-6 w-px bg-gray-200 mx-2"></div>
          
          {/* Tabs */}
          <div className="flex bg-gray-100 rounded p-1">
            {['report', 'entities', 'json'].map((t) => (
              <button key={t} onClick={() => setActiveTab(t as any)} 
                className={`px-3 py-1 rounded text-xs font-bold uppercase transition-all ${activeTab === t ? 'bg-white text-uk-blue shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                {t}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
           <button onClick={() => setShowResearchModal(true)} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-uk-blue border border-uk-blue/30 rounded hover:bg-blue-50 transition-colors uppercase tracking-wide">
             <Globe className="w-3.5 h-3.5" /> Research
           </button>
           <button onClick={() => setShowChat(!showChat)} className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded transition-colors uppercase tracking-wide ${showChat ? 'bg-uk-navy text-white' : 'text-gray-600 bg-gray-100 hover:bg-gray-200'}`}>
             <MessageSquareText className="w-3.5 h-3.5" /> Analyst
           </button>
           <div className="h-6 w-px bg-gray-200 mx-1"></div>
           <button onClick={() => window.print()} className="p-1.5 text-gray-500 hover:text-uk-navy"><Printer className="w-4 h-4" /></button>
           <button onClick={handleExport} className="p-1.5 text-gray-500 hover:text-uk-navy"><Download className="w-4 h-4" /></button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden relative">
        {/* Main Content */}
        <div className="flex-1 overflow-y-auto bg-gray-200/50 p-4 md:p-8 flex justify-center">
          
          {/* VIEW: REPORT */}
          {activeTab === 'report' && (
            <div className="bg-white w-full max-w-[210mm] min-h-[297mm] shadow-lg p-12 text-gray-900 font-serif relative">
               {/* Classification Banner */}
               <div className={`text-center border-b-2 mb-8 pb-4 ${getClassificationColor(report.classification)}`}>
                  <h1 className="font-bold text-xl uppercase tracking-[0.2em]">{report.classification}</h1>
                  <p className="text-xs font-sans text-gray-500 uppercase tracking-wider mt-1">{report.handlingInstructions}</p>
               </div>

               {/* Meta Table */}
               <div className="grid grid-cols-2 gap-y-2 text-sm font-sans border-b border-gray-100 pb-6 mb-8">
                  {/* Removed Report Ref and kept layout balance */}
                  <div></div>
                  <div className="flex flex-col text-right"><span className="text-[10px] text-gray-400 font-bold uppercase">Date</span><span className="font-mono">{report.dateOfInformation}</span></div>
                  <div className="col-span-2 mt-2"><span className="text-[10px] text-gray-400 font-bold uppercase">Subject</span><span className="font-bold text-lg text-uk-navy block leading-tight">{report.reportTitle.replace(/^INTREP:?\s*/i, '')}</span></div>
               </div>

               {/* Executive Summary */}
               <div className="mb-8 bg-gray-50 p-4 border-l-4 border-uk-blue rounded-r">
                 <h3 className="font-sans font-bold text-xs uppercase text-uk-blue mb-2 tracking-wider">Executive Summary</h3>
                 <p className="text-sm leading-relaxed font-medium">{renderEnrichedContent(report.executiveSummary)}</p>
               </div>

               {/* Sections */}
               {report.sections.map((section, idx) => {
                 // Determine explicit rendering mode based on data type, not just declared type
                 const isListContent = Array.isArray(section.content);
                 
                 return (
                 <div key={idx} className="mb-8 group relative">
                   <div className="absolute -right-8 top-0 opacity-0 group-hover:opacity-100 flex flex-col gap-1 no-print">
                      <button onClick={() => { setEditSectionTitle(section.title); setEditContent(Array.isArray(section.content) ? section.content.join('\n') : section.content); }} className="p-1.5 bg-gray-100 rounded hover:bg-blue-100 text-blue-600"><Pencil className="w-3 h-3"/></button>
                      <button onClick={() => { setRefineSectionTitle(section.title); setRefineInstruction(""); }} className="p-1.5 bg-gray-100 rounded hover:bg-purple-100 text-purple-600"><Sparkles className="w-3 h-3"/></button>
                   </div>
                   <h3 className="font-sans font-bold text-sm uppercase text-uk-navy mb-3 flex items-center gap-2">
                     <span className="text-gray-400">{idx + 1}.</span> {section.title}
                   </h3>
                   {isListContent ? (
                     <ul className="list-disc pl-5 space-y-2 text-sm leading-relaxed">
                       {(section.content as string[]).map((item, i) => (
                         <li key={i} className="group/item relative">
                           <span>{renderEnrichedContent(item)}</span>
                           <button onClick={() => handleVerify(item, `v-${idx}-${i}`)} className="ml-2 opacity-0 group-hover/item:opacity-100 text-[10px] uppercase font-bold text-uk-blue hover:underline bg-blue-50 px-1 rounded">Verify</button>
                           {verifications[`v-${idx}-${i}`] && (
                             <div className={`mt-1 p-2 text-xs border-l-2 ${verifications[`v-${idx}-${i}`].status === 'Verified' ? 'border-green-500 bg-green-50' : 'border-red-500 bg-red-50'}`}>
                               {verifications[`v-${idx}-${i}`].explanation}
                             </div>
                           )}
                         </li>
                       ))}
                     </ul>
                   ) : (
                     <p className="text-sm leading-relaxed whitespace-pre-wrap">{renderEnrichedContent(section.content)}</p>
                   )}
                 </div>
               )})}

               {/* Entity Footnotes */}
               {report.entities && report.entities.length > 0 && (
                 <div className="mt-12 border-t border-gray-200 pt-8 page-break-inside-avoid" ref={entityFooterRef}>
                    <h4 className="font-sans font-bold text-sm uppercase text-uk-navy mb-4 flex items-center gap-2">
                      <Crosshair className="w-4 h-4" /> Entity Profiles
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {report.entities.map((ent, i) => (
                        <div key={i} className="flex gap-3 text-xs p-2 rounded hover:bg-gray-50 border border-transparent hover:border-gray-100 transition-colors">
                           <span className="flex-shrink-0 text-[10px] font-bold text-gray-400 select-none">E{i + 1}</span>
                           <div>
                              <div className="flex items-center gap-2 mb-1">
                                <span className="font-bold text-gray-900">{ent.name}</span>
                                <EntityBadge type={ent.type} threat={ent.threatLevel} />
                              </div>
                              <p className="text-gray-600 leading-snug">{ent.context}</p>
                           </div>
                        </div>
                      ))}
                    </div>
                 </div>
               )}

               {/* Detailed References Footer */}
               {report.relevantLinks && report.relevantLinks.length > 0 && (
                 <div className="mt-12 border-t border-gray-200 pt-8" ref={footerRef}>
                   <h4 className="font-sans font-bold text-sm uppercase text-uk-navy mb-4 flex items-center gap-2">
                     <Globe className="w-4 h-4" /> Intelligence Sources
                   </h4>
                   <div className="space-y-4">
                     {report.relevantLinks.map((link, i) => (
                       <div key={i} className="flex gap-3 text-sm group">
                         <span className="flex-shrink-0 flex items-center justify-center w-6 h-6 bg-gray-100 text-gray-500 font-bold text-xs rounded-full">
                           {i + 1}
                         </span>
                         <div className="flex-1 min-w-0">
                           <div className="flex items-baseline gap-2">
                             <a href={link.url} target="_blank" rel="noreferrer" className="font-bold text-uk-blue hover:underline">
                               {link.title || link.url}
                             </a>
                             <a href={link.url} target="_blank" rel="noreferrer" className="text-gray-400 hover:text-gray-600">
                               <ExternalLink className="w-3 h-3" />
                             </a>
                           </div>
                           <p className="text-xs text-gray-600 mt-0.5">{link.summary || "No summary available."}</p>
                           <p className="text-[10px] text-gray-400 font-mono mt-1 break-all">{link.url}</p>
                         </div>
                       </div>
                     ))}
                   </div>
                 </div>
               )}
            </div>
          )}

          {/* VIEW: ENTITIES */}
          {activeTab === 'entities' && (
            <div className="w-full max-w-4xl space-y-4">
              {report.entities.map((ent, i) => (
                <div key={i} className="bg-white p-4 rounded-lg shadow-sm border border-gray-200 flex items-start gap-4">
                  <div className={`p-3 rounded-full ${ent.threatLevel === 'Critical' ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-600'}`}>
                     <Crosshair className="w-6 h-6" />
                  </div>
                  <div className="flex-1">
                    <div className="flex justify-between items-start">
                      <div>
                        <h3 className="font-bold text-gray-900 text-lg">{ent.name}</h3>
                        <EntityBadge type={ent.type} threat={ent.threatLevel} />
                      </div>
                    </div>
                    <p className="mt-2 text-sm text-gray-600 leading-relaxed bg-gray-50 p-3 rounded">{ent.context}</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* VIEW: JSON */}
          {activeTab === 'json' && (
            <div className="w-full max-w-4xl bg-gray-900 rounded-lg shadow-lg p-6 overflow-hidden">
               <pre className="text-green-400 font-mono text-xs overflow-x-auto whitespace-pre-wrap">{JSON.stringify(report, null, 2)}</pre>
            </div>
          )}
        </div>

        {/* Chat Sidebar */}
        <div className={`bg-white border-l border-gray-200 shadow-2xl z-30 transition-all duration-300 ease-in-out ${showChat ? 'w-96' : 'w-0 overflow-hidden opacity-0'}`}>
           <ChatInterface chatSession={chatSession} report={report} onUpdateReport={onUpdateReport} className="h-full" onClose={() => setShowChat(false)} />
        </div>
      </div>

      {/* --- MODALS (Edit/Refine/Research) --- */}
      {/* Kept simple for brevity, logic exists in handles */}
      {showResearchModal && (
        <div className="absolute inset-0 z-50 bg-uk-navy/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-lg rounded-xl shadow-2xl p-6">
            <h3 className="font-bold text-lg mb-4 flex items-center gap-2"><Globe className="w-5 h-5 text-uk-blue"/> Targeted Research</h3>
            <input autoFocus value={researchTopic} onChange={e => setResearchTopic(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleDeepResearch()} className="w-full p-3 border rounded mb-4" placeholder="Enter topic..." />
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowResearchModal(false)} className="px-4 py-2 text-gray-600">Cancel</button>
              <button onClick={handleDeepResearch} className="px-4 py-2 bg-uk-blue text-white rounded">Execute</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal (Generic) */}
      {(editSectionTitle || refineSectionTitle) && (
        <div className="absolute inset-0 z-50 bg-uk-navy/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-2xl rounded-xl shadow-2xl p-6 flex flex-col max-h-[80vh]">
            <h3 className="font-bold mb-4">{editSectionTitle ? `Edit: ${editSectionTitle}` : `Refine: ${refineSectionTitle}`}</h3>
            {editSectionTitle ? (
              <textarea value={editContent} onChange={e => setEditContent(e.target.value)} className="flex-1 p-3 border rounded mb-4 font-mono text-sm" />
            ) : (
              <textarea value={refineInstruction} onChange={e => setRefineInstruction(e.target.value)} placeholder="Enter instructions..." className="h-32 p-3 border rounded mb-4" />
            )}
            <div className="flex justify-end gap-2">
              <button onClick={() => { setEditSectionTitle(null); setRefineSectionTitle(null); }} className="px-4 py-2 text-gray-600">Cancel</button>
              <button onClick={editSectionTitle ? handleSaveEdit : executeRefinement} className="px-4 py-2 bg-uk-blue text-white rounded">{isRefining ? 'Processing...' : 'Apply'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ReportDisplay;
