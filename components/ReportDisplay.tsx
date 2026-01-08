
import React, { useState, useRef, useEffect } from 'react';
import { IntelligenceReport, Classification, HistoryItem } from '../types';
import { Printer, Download, Clock, ChevronDown, Sparkles, MessageSquareText, Globe, AlertCircle, Pencil, User, MapPin, Building, Hash, Zap, Crosshair, ExternalLink, ShieldAlert } from 'lucide-react';
import { refineSection, createReportChatSession, verifyClaim, VerificationResult, conductDeepResearch } from '../services/geminiService';
import ChatInterface from './ChatInterface';
import { Chat } from '@google/genai';
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, BorderStyle } from "docx";
import FileSaver from "file-saver";

interface ReportDisplayProps {
  report: IntelligenceReport | null;
  reset: () => void;
  history: HistoryItem[];
  currentReportId: string | null;
  onSelectReport: (id: string) => void;
  onUpdateReport: (report: IntelligenceReport) => void;
  onClearHistory?: () => void;
  rawContext?: string;
  onProcessingStart?: (logs: any[]) => void;
  onProcessingEnd?: () => void;
  onProcessingLog?: (msg: string, type: any) => void;
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
  const [activeTab, setActiveTab] = useState<'report' | 'entities'>('report');
  const [showHistory, setShowHistory] = useState(false);
  const [showChat, setShowChat] = useState(false);
  
  // Interaction State
  const [verifications, setVerifications] = useState<Record<string, VerificationResult>>({});
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [editSectionTitle, setEditSectionTitle] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [showResearchModal, setShowResearchModal] = useState(false);
  const [researchTopic, setResearchTopic] = useState("");

  const [chatSession, setChatSession] = useState<Chat | null>(null);
  const historyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (report) {
      setChatSession(createReportChatSession(report, rawContext));
      setVerifications({});
    }
  }, [report?.referenceNumber]);

  if (!report) return null;

  const handleVerify = async (text: string, id: string) => {
    if (verifyingId) return;
    setVerifyingId(id);
    try {
      const result = await verifyClaim(text);
      setVerifications(prev => ({ ...prev, [id]: result }));
    } catch (e) { console.error(e); } finally { setVerifyingId(null); }
  };

  const handleSaveEdit = () => {
    if (!editSectionTitle) return;
    const isList = report.sections.find(s => s.title === editSectionTitle)?.type === 'list';
    const newContent = isList ? editContent.split('\n').filter(s=>s) : editContent;
    onUpdateReport({
        ...report,
        sections: report.sections.map(s => s.title === editSectionTitle ? { ...s, content: newContent } : s)
    });
    setEditSectionTitle(null);
  };

  const handleDeepResearch = async () => {
    if (!researchTopic) return;
    setShowResearchModal(false);
    onProcessingStart?.([{ id: 'init', message: `Executing deep research on: ${researchTopic}`, type: 'network', timestamp: Date.now() }]);
    try {
        const result = await conductDeepResearch(researchTopic, rawContext + JSON.stringify(report));
        const newLinks = result.links.filter(nl => !report.relevantLinks?.find(cl => cl.url === nl.url));
        onUpdateReport({
            ...report,
            sections: [...report.sections, { title: result.title, type: 'text', content: result.content }],
            relevantLinks: [...(report.relevantLinks || []), ...newLinks]
        });
        onProcessingEnd?.();
    } catch { onProcessingEnd?.(); alert("Research failed."); }
  };

  const handleDownloadDocx = async () => {
    if (!report) return;

    try {
      const doc = new Document({
        styles: {
            paragraphStyles: [
                {
                    id: "Normal",
                    name: "Normal",
                    run: { font: "Calibri", size: 22 }, // 11pt
                    paragraph: { spacing: { after: 120 } }
                },
                {
                    id: "Heading1",
                    name: "Heading 1",
                    run: { font: "Calibri", size: 32, bold: true, color: "111111" },
                    paragraph: { spacing: { before: 240, after: 120 } }
                },
                {
                    id: "Heading2",
                    name: "Heading 2",
                    run: { font: "Calibri", size: 26, bold: true, color: "1d4ed8" },
                    paragraph: { spacing: { before: 240, after: 120 } }
                }
            ]
        },
        sections: [{
          properties: {},
          children: [
            // Title
            new Paragraph({
              text: report.reportTitle,
              heading: HeadingLevel.TITLE,
              alignment: AlignmentType.CENTER,
              run: { font: "Calibri", size: 36, bold: true }
            }),
            // Meta
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [
                  new TextRun({ text: `DATE: ${report.dateOfInformation.toUpperCase()}`, bold: true, size: 16 }),
                  new TextRun({ text: " | ", size: 16 }),
                  new TextRun({ text: `REF: ${report.referenceNumber || "N/A"}`, size: 16 })
              ],
              border: { bottom: { color: "000000", space: 12, value: BorderStyle.SINGLE, size: 6 } },
              spacing: { after: 400 }
            }),
            // Executive Summary
            new Paragraph({
                text: "EXECUTIVE SUMMARY",
                heading: HeadingLevel.HEADING_2,
            }),
            new Paragraph({
                children: [ new TextRun({ text: report.executiveSummary }) ],
                border: { left: { color: "000000", space: 12, value: BorderStyle.SINGLE, size: 12 } },
                indent: { left: 240 },
                spacing: { after: 400 }
            }),
            // Sections
            ...report.sections.flatMap((s, i) => {
                const head = new Paragraph({
                    text: `${i+1}.0 ${s.title.toUpperCase()}`,
                    heading: HeadingLevel.HEADING_2
                });
                let body: Paragraph[] = [];
                if (Array.isArray(s.content)) {
                    body = s.content.map(line => new Paragraph({
                        text: line,
                        bullet: { level: 0 }
                    }));
                } else {
                    body = s.content.split('\n').map(line => new Paragraph({ text: line }));
                }
                return [head, ...body];
            }),
            // Appendix A
            new Paragraph({
                text: "APPENDIX A: KEY ENTITIES",
                heading: HeadingLevel.HEADING_1,
                pageBreakBefore: true,
                spacing: { before: 400, after: 200 }
            }),
            ...report.entities.map(e => new Paragraph({
                children: [
                    new TextRun({ text: e.name, bold: true }),
                    new TextRun({ text: ` [${e.type.toUpperCase()}]`, size: 18, color: "666666" }),
                    new TextRun({ text: ` - ${e.context}` })
                ],
                spacing: { after: 120 }
            })),
            // Appendix B
            new Paragraph({
                text: "APPENDIX B: SOURCE MANIFEST",
                heading: HeadingLevel.HEADING_1,
                spacing: { before: 400, after: 200 }
            }),
            ...(report.relevantLinks || []).map((l, i) => new Paragraph({
                children: [
                    new TextRun({ text: `[${i+1}] `, bold: true }),
                    new TextRun({ text: l.title || "External Source" }),
                    new TextRun({ text: `\n${l.url}`, size: 16, color: "004488" })
                ],
                spacing: { after: 160 }
            }))
          ]
        }]
      });

      const blob = await Packer.toBlob(doc);
      FileSaver.saveAs(blob, `INTREP_${report.dateOfInformation}_${report.reportTitle.replace(/[^a-zA-Z0-9]/g, '_').substring(0,30)}.docx`);
    } catch (e) {
        console.error(e);
        alert("Error creating document.");
    }
  };

  const EntityBadge = ({ type, threat }: { type: string, threat?: string }) => {
    const color = threat === 'Critical' ? 'bg-red-100 text-red-800 border-red-200' : threat === 'High' ? 'bg-orange-100 text-orange-800 border-orange-200' : 'bg-gray-100 text-gray-700 border-gray-200';
    return <span className={`text-[9px] uppercase font-bold px-1.5 py-0.5 rounded border ${color}`}>{type} | {threat}</span>;
  };

  return (
    <div className="flex flex-col h-full bg-gray-950 overflow-hidden relative">
      
      {/* Toolbar */}
      <div className="bg-gray-900 border-b border-gray-800 px-4 py-3 flex justify-between items-center no-print flex-shrink-0 z-20">
        <div className="flex items-center gap-3">
          <div className="relative" ref={historyRef}>
            <button onClick={() => setShowHistory(!showHistory)} className="flex items-center gap-2 px-3 py-1.5 text-xs font-bold text-gray-300 bg-gray-800 hover:bg-gray-700 rounded transition-colors uppercase tracking-wider">
              <Clock className="w-3.5 h-3.5" /> <span>History</span> <ChevronDown className="w-3 h-3" />
            </button>
            {showHistory && (
               <div className="absolute left-0 mt-2 w-72 bg-gray-800 border border-gray-700 rounded shadow-2xl z-50 max-h-96 overflow-y-auto">
                  {history.slice().reverse().map(item => (
                    <button key={item.id} onClick={() => { onSelectReport(item.id); setShowHistory(false); }} className="w-full text-left px-4 py-3 hover:bg-gray-700 border-b border-gray-700 last:border-0">
                       <p className="text-xs font-bold text-gray-200 truncate">{item.report.reportTitle}</p>
                       <p className="text-[10px] text-gray-500">{new Date(item.timestamp).toLocaleString()}</p>
                    </button>
                  ))}
               </div>
            )}
          </div>
          <div className="h-5 w-px bg-gray-700"></div>
          <button onClick={() => setActiveTab('report')} className={`px-3 py-1.5 rounded text-xs font-bold uppercase ${activeTab === 'report' ? 'bg-uk-blue text-white' : 'text-gray-400 hover:text-white'}`}>Report</button>
          <button onClick={() => setActiveTab('entities')} className={`px-3 py-1.5 rounded text-xs font-bold uppercase ${activeTab === 'entities' ? 'bg-uk-blue text-white' : 'text-gray-400 hover:text-white'}`}>Entities</button>
        </div>

        <div className="flex items-center gap-3">
           <button onClick={() => setShowResearchModal(true)} className="flex items-center gap-2 px-3 py-1.5 text-xs font-bold text-uk-blue border border-uk-blue/30 rounded hover:bg-uk-blue/10 uppercase tracking-wide">
             <Globe className="w-3.5 h-3.5" /> Extend Research
           </button>
           <button onClick={() => setShowChat(!showChat)} className={`flex items-center gap-2 px-3 py-1.5 text-xs font-bold rounded uppercase tracking-wide ${showChat ? 'bg-uk-blue text-white' : 'text-gray-300 bg-gray-800 hover:bg-gray-700'}`}>
             <MessageSquareText className="w-3.5 h-3.5" /> Analyst Chat
           </button>
           <div className="w-px h-5 bg-gray-700 mx-1"></div>
           <button onClick={handleDownloadDocx} className="p-2 text-gray-400 hover:text-white" title="Export DOCX"><Download className="w-4 h-4" /></button>
           <button onClick={() => window.print()} className="p-2 text-gray-400 hover:text-white" title="Print PDF"><Printer className="w-4 h-4" /></button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden relative">
        
        {/* Main Workspace */}
        <div className="flex-1 overflow-y-auto bg-gray-950 p-4 md:p-12 flex justify-center">
          
          {/* --- PAPER VIEW --- */}
          {activeTab === 'report' && (
            <div className="bg-white w-full max-w-[210mm] min-h-[297mm] shadow-2xl relative text-black font-serif print:shadow-none print:w-full print:max-w-none print:m-0 print:p-0 flex flex-col">
              
              <div className="p-12 md:p-16 print:p-12 flex-grow">
                 
                 {/* Header Meta */}
                 <div className="border-b-2 border-black pb-6 mb-8">
                    <h1 className="text-2xl font-bold uppercase tracking-wide leading-tight mb-2 font-sans">{report.reportTitle}</h1>
                    <div className="flex justify-between items-end text-xs font-sans uppercase text-gray-500 font-bold tracking-wider">
                       <span>Intelligence Assessment</span>
                       <span>Date: {report.dateOfInformation}</span>
                    </div>
                 </div>

                 {/* Executive Summary */}
                 <div className="bg-gray-100 p-6 mb-10 border-l-4 border-black font-sans print-bg-force break-inside-avoid">
                    <h3 className="font-bold text-xs uppercase mb-3 tracking-wider text-gray-900">Executive Summary (BLUF)</h3>
                    <p className="text-sm leading-relaxed font-medium text-gray-900 text-justify">{report.executiveSummary}</p>
                 </div>

                 {/* Sections */}
                 <div className="space-y-8">
                    {report.sections.map((section, idx) => (
                        <div key={idx} className="group relative break-inside-avoid">
                            {/* Hover Tools */}
                            <div className="absolute -left-12 top-0 hidden group-hover:flex flex-col gap-1 no-print">
                                <button onClick={() => { setEditSectionTitle(section.title); setEditContent(Array.isArray(section.content) ? section.content.join('\n') : section.content); }} className="p-1.5 bg-gray-200 hover:bg-uk-blue hover:text-white rounded shadow transition-colors"><Pencil className="w-3 h-3"/></button>
                            </div>

                            <h2 className="font-sans font-bold text-sm uppercase border-b border-gray-300 pb-1 mb-3 flex items-center gap-2 text-gray-900">
                                <span className="text-uk-blue print:text-black">{idx + 1}.0</span> {section.title}
                            </h2>

                            {Array.isArray(section.content) ? (
                                <ul className="list-disc ml-4 pl-2 space-y-2 text-sm leading-relaxed text-justify text-gray-800 marker:text-gray-400">
                                    {section.content.map((item, i) => (
                                        <li key={i} className="pl-1 group/item relative">
                                            <span>{item}</span>
                                            <button onClick={() => handleVerify(item, `${idx}-${i}`)} className="ml-2 text-[10px] font-bold text-uk-blue opacity-0 group-hover/item:opacity-100 hover:underline uppercase no-print transition-opacity">Verify</button>
                                            {verifications[`${idx}-${i}`] && (
                                                <div className={`mt-2 text-xs p-2 no-print rounded ${verifications[`${idx}-${i}`].status === 'Verified' ? 'bg-green-50 text-green-800 border border-green-100' : 'bg-red-50 text-red-800 border border-red-100'}`}>
                                                    <strong>{verifications[`${idx}-${i}`].status}:</strong> {verifications[`${idx}-${i}`].explanation}
                                                </div>
                                            )}
                                        </li>
                                    ))}
                                </ul>
                            ) : (
                                <p className="text-sm leading-relaxed text-justify whitespace-pre-wrap text-gray-800">{section.content}</p>
                            )}
                        </div>
                    ))}
                 </div>

                 {/* Footnotes / Sources */}
                 {report.relevantLinks && report.relevantLinks.length > 0 && (
                     <div className="mt-16 pt-8 border-t border-gray-300 font-sans break-inside-avoid">
                         <h3 className="text-xs font-bold uppercase mb-4 text-gray-400 tracking-wider">Appendix A: Source Manifest</h3>
                         <div className="space-y-3">
                             {report.relevantLinks.map((link, i) => (
                                 <div key={i} className="flex gap-3 text-xs text-gray-600">
                                     <span className="font-mono text-gray-400 font-bold select-none">[{i+1}]</span>
                                     <div className="flex-1">
                                        <a href={link.url} target="_blank" className="hover:text-uk-blue hover:underline font-bold text-gray-800 block mb-0.5 print:no-underline print:text-black">{link.title || "External Source"}</a>
                                        <p className="text-gray-500 leading-tight">{link.summary || "No summary available."}</p>
                                        <span className="text-[10px] text-gray-400 truncate block mt-0.5 print:text-[9px]">{link.url}</span>
                                     </div>
                                 </div>
                             ))}
                         </div>
                     </div>
                 )}

                 {/* Entities Footer */}
                 {report.entities && report.entities.length > 0 && (
                    <div className="mt-8 pt-8 border-t border-gray-300 font-sans break-inside-avoid">
                        <h3 className="text-xs font-bold uppercase mb-4 text-gray-400 tracking-wider">Appendix B: Key Entities</h3>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                            {report.entities.map((e, i) => (
                                <div key={i} className="p-2 bg-gray-50 border border-gray-100 rounded print:border-gray-300">
                                    <div className="flex justify-between items-start mb-1">
                                        <span className="font-bold text-xs text-gray-800">{e.name}</span>
                                        <span className="text-[9px] uppercase font-bold text-gray-400">{e.type}</span>
                                    </div>
                                    <div className="text-[10px] text-gray-500 leading-tight">{e.context.substring(0, 80)}...</div>
                                </div>
                            ))}
                        </div>
                    </div>
                 )}

              </div>
              
              {/* Paper Footer (Space for classification if needed later, but kept empty for now) */}
              <div className="h-12 w-full"></div>
            </div>
          )}

          {/* --- ENTITIES VIEW --- */}
          {activeTab === 'entities' && (
             <div className="w-full max-w-5xl grid grid-cols-1 md:grid-cols-2 gap-4">
                {report.entities.map((ent, i) => (
                    <div key={i} className="bg-gray-900 border border-gray-800 p-4 rounded-lg shadow-lg flex flex-col gap-3">
                        <div className="flex justify-between items-start">
                            <h3 className="font-bold text-gray-100 text-lg">{ent.name}</h3>
                            <EntityBadge type={ent.type} threat={ent.threatLevel} />
                        </div>
                        <p className="text-sm text-gray-400 leading-relaxed bg-black/30 p-3 rounded border border-gray-800/50">{ent.context}</p>
                    </div>
                ))}
             </div>
          )}

        </div>

        {/* Chat Drawer */}
        <div className={`bg-white border-l border-gray-200 shadow-2xl z-30 transition-all duration-300 no-print ${showChat ? 'w-96' : 'w-0 overflow-hidden'}`}>
           <ChatInterface chatSession={chatSession} report={report} onUpdateReport={onUpdateReport} onClose={() => setShowChat(false)} className="h-full" />
        </div>
      </div>

      {/* Edit Modal */}
      {editSectionTitle && (
          <div className="absolute inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-8 no-print">
              <div className="bg-white w-full max-w-3xl rounded-lg p-6 flex flex-col h-3/4 shadow-2xl">
                  <h3 className="font-bold text-lg mb-4 text-gray-900">Editing: {editSectionTitle}</h3>
                  <textarea value={editContent} onChange={e => setEditContent(e.target.value)} className="flex-1 p-4 border border-gray-300 rounded font-serif text-sm resize-none focus:outline-none focus:ring-2 focus:ring-uk-blue text-gray-900" />
                  <div className="mt-4 flex justify-end gap-3">
                      <button onClick={() => setEditSectionTitle(null)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded">Cancel</button>
                      <button onClick={handleSaveEdit} className="px-4 py-2 bg-uk-blue text-white rounded font-bold uppercase text-xs">Save Changes</button>
                  </div>
              </div>
          </div>
      )}

      {/* Research Modal */}
      {showResearchModal && (
          <div className="absolute inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-8 no-print">
              <div className="bg-gray-900 border border-gray-700 w-full max-w-lg rounded-lg p-6 shadow-2xl">
                  <h3 className="font-bold text-white mb-2 flex items-center gap-2"><Globe className="w-5 h-5 text-uk-blue"/> Extend Research</h3>
                  <p className="text-gray-400 text-xs mb-4">Launch a new autonomous agent to research a specific topic and append it to the report.</p>
                  <input autoFocus value={researchTopic} onChange={e => setResearchTopic(e.target.value)} placeholder="e.g. Financial backing of the group..." className="w-full p-3 bg-black border border-gray-700 rounded text-white mb-4 focus:border-uk-blue outline-none" onKeyDown={e => e.key === 'Enter' && handleDeepResearch()} />
                  <div className="flex justify-end gap-3">
                      <button onClick={() => setShowResearchModal(false)} className="px-4 py-2 text-gray-400 hover:text-white">Cancel</button>
                      <button onClick={handleDeepResearch} className="px-4 py-2 bg-uk-blue text-white rounded font-bold uppercase text-xs">Execute Agent</button>
                  </div>
              </div>
          </div>
      )}

    </div>
  );
};

export default ReportDisplay;
