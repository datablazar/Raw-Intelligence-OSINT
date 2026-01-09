import React, { useState, useEffect, Suspense, lazy } from 'react';
import InputSection from './components/InputSection';
import { AnalysisReport, HistoryItem, Attachment, MissionConfig } from './types';
import { LayoutDashboard, FileText, Plus, LogOut } from 'lucide-react';

const ReportDisplay = lazy(() => import('./components/ReportDisplay'));
const MissionWizard = lazy(() => import('./components/MissionWizard'));

const App: React.FC = () => {
  const [history, setHistory] = useState<HistoryItem[]>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('sentinel_history');
        return saved ? JSON.parse(saved) : [];
      } catch (e) { return []; }
    }
    return [];
  });

  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeConfig, setActiveConfig] = useState<MissionConfig | null>(null);
  const [rawContext, setRawContext] = useState<string>("");

  useEffect(() => {
    try { localStorage.setItem('sentinel_history', JSON.stringify(history)); } catch (e) {}
  }, [history]);

  const activeReport = activeId ? history.find(h => h.id === activeId)?.report || null : null;

  const handleStartMission = (rawText: string, attachments: Attachment[], instructions: string) => {
    setRawContext(rawText);
    setActiveConfig({ rawText, attachments, instructions });
  };

  const handleMissionComplete = (report: AnalysisReport) => {
    const newId = crypto.randomUUID();
    const newItem: HistoryItem = { id: newId, timestamp: Date.now(), report, rawContext };
    setHistory(prev => [...prev, newItem]);
    setActiveId(newId);
    setActiveConfig(null);
  };

  const handleUpdateReport = (updatedReport: AnalysisReport) => {
    if (!activeId) return;
    setHistory(prev => prev.map(item => item.id === activeId ? { ...item, report: updatedReport } : item));
  };

  const handleClearHistory = () => {
    if (window.confirm("Purge all mission files?")) {
      setHistory([]);
      localStorage.removeItem('sentinel_history');
      setActiveId(null);
    }
  };

  return (
    <div className="h-screen bg-gray-950 flex flex-col font-sans overflow-hidden text-gray-100">
      
      {/* Wizard Overlay */}
      {activeConfig && (
        <Suspense fallback={<div className="absolute inset-0 bg-black/60 flex items-center justify-center text-sm text-gray-200">Loading...</div>}>
          <MissionWizard 
            config={activeConfig} 
            onComplete={handleMissionComplete} 
            onCancel={() => setActiveConfig(null)} 
          />
        </Suspense>
      )}
      
      {/* App Shell */}
      <div className="flex flex-1 overflow-hidden">
        
        {/* Sidebar Navigation */}
        <div className="w-16 md:w-64 bg-uk-navy border-r border-uk-blue/30 flex flex-col flex-shrink-0 z-30 transition-all">
           <div className="p-4 flex items-center gap-3 border-b border-uk-blue/30 h-16 bg-uk-navy shadow-md">
             <LayoutDashboard className="w-6 h-6 text-uk-blue" />
             <span className="font-bold text-lg tracking-wider hidden md:block">SENTINEL</span>
           </div>

           <div className="flex-1 overflow-y-auto py-4 space-y-2">
             <button 
                onClick={() => setActiveId(null)}
                className={`w-full px-4 py-3 flex items-center gap-3 hover:bg-white/10 transition-colors ${!activeId ? 'bg-uk-blue/20 border-r-4 border-uk-blue' : ''}`}
             >
                <Plus className="w-5 h-5" />
                <span className="font-medium hidden md:block">New Operation</span>
             </button>

             <div className="pt-4 pb-2 px-4 text-xs font-bold text-gray-400 uppercase tracking-widest hidden md:block">Mission Files</div>
             {history.map(item => (
               <button 
                 key={item.id} 
                 onClick={() => { setActiveId(item.id); setRawContext(item.rawContext || ""); }}
                 className={`w-full px-4 py-3 flex items-center gap-3 hover:bg-white/10 transition-colors text-left ${activeId === item.id ? 'bg-uk-blue/20 border-r-4 border-uk-blue' : 'text-gray-400'}`}
               >
                  <FileText className="w-4 h-4 flex-shrink-0" />
                  <div className="hidden md:block overflow-hidden">
                    <div className="truncate text-sm font-medium text-gray-200">{item.report.reportTitle}</div>
                    <div className="text-[10px] text-gray-500">{new Date(item.timestamp).toLocaleDateString()}</div>
                  </div>
               </button>
             ))}
           </div>

           <div className="p-4 border-t border-uk-blue/30">
              <button onClick={handleClearHistory} className="flex items-center gap-3 text-gray-400 hover:text-red-400 transition-colors">
                <LogOut className="w-5 h-5" />
                <span className="text-xs font-bold hidden md:block">PURGE DATA</span>
              </button>
           </div>
        </div>

        {/* Main Workspace */}
        <div className="flex-1 flex flex-col bg-gray-100 relative">
           {!activeReport ? (
             <div className="flex-1 p-6 md:p-12 overflow-y-auto">
                <div className="max-w-3xl mx-auto space-y-8">
                  <div className="text-center space-y-2 mb-12">
                     <h1 className="text-3xl font-bold text-uk-navy tracking-tight">Analysis Generation and Transformation Platform</h1>
                     <p className="text-gray-500">Raw input and research environment</p>
                  </div>
                  <InputSection onGenerate={handleStartMission} isProcessing={false} />
                </div>
             </div>
           ) : (
             <Suspense fallback={<div className="flex-1 flex items-center justify-center text-sm text-gray-500">Loading report...</div>}>
               <ReportDisplay 
                 report={activeReport} 
                 reset={() => setActiveId(null)} 
                 history={history}
                 currentReportId={activeId}
                 onSelectReport={setActiveId}
                 onUpdateReport={handleUpdateReport}
                 onClearHistory={handleClearHistory}
                 rawContext={rawContext}
               />
             </Suspense>
           )}
        </div>
      </div>
    </div>
  );
};

export default App;
