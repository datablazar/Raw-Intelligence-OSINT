
import React, { useEffect, useRef } from 'react';
import { ProcessingState } from '../types';
import { Shield, Globe, Cpu, CheckCircle2, Terminal, Activity, Search, BrainCircuit, FileText } from 'lucide-react';

interface ProcessingHUDProps {
  state: ProcessingState;
  onDismissError: () => void;
}

const ProcessingHUD: React.FC<ProcessingHUDProps> = ({ state, onDismissError }) => {
  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (state.status !== 'idle' && state.status !== 'complete') {
      logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [state.logs, state.status]);

  if (state.status === 'idle' || state.status === 'complete') return null;

  if (state.status === 'error') {
    return (
      <div className="absolute top-4 right-4 z-50 bg-red-950/90 border border-red-500 text-red-100 p-4 rounded shadow-2xl backdrop-blur-md flex items-start gap-3 max-w-md animate-[slideIn_0.3s_ease-out]">
        <Activity className="w-5 h-5 text-red-500 mt-1 flex-shrink-0" />
        <div>
          <h3 className="text-sm font-bold uppercase tracking-wider">Operation Halted</h3>
          <p className="text-xs mt-1 text-red-200 font-mono">{state.error}</p>
          <button onClick={onDismissError} className="text-xs text-white underline mt-2 hover:text-red-300">DISMISS</button>
        </div>
      </div>
    );
  }

  const getPhaseIcon = () => {
    switch (state.status) {
      case 'planning': return <BrainCircuit className="w-8 h-8 text-purple-400 animate-pulse" />;
      case 'researching': return <Globe className="w-8 h-8 text-cyan-400 animate-[spin_3s_linear_infinite]" />;
      case 'synthesizing': return <FileText className="w-8 h-8 text-yellow-400 animate-pulse" />;
      default: return <Shield className="w-8 h-8 text-uk-blue animate-pulse" />;
    }
  };

  const getPhaseText = () => {
    switch (state.status) {
      case 'planning': return "PHASE 1: TACTICAL PLANNING & TRIAGE";
      case 'researching': return "PHASE 2: GLOBAL RESEARCH GATHERING";
      case 'synthesizing': return "PHASE 3: REPORT COMPILATION";
      default: return "SENTINEL PROTOCOL INITIALIZED";
    }
  };

  return (
    <div className="absolute inset-0 bg-gray-950/95 z-50 flex items-center justify-center backdrop-blur-sm p-4">
      <div className="w-full max-w-3xl bg-black border border-uk-navy rounded-xl shadow-[0_0_100px_rgba(0,94,184,0.15)] overflow-hidden flex flex-col max-h-[85vh]">
        
        {/* Header */}
        <div className="bg-uk-navy/20 p-6 border-b border-uk-blue/20 flex justify-between items-center relative overflow-hidden">
          <div className="absolute inset-0 bg-[linear-gradient(90deg,transparent,rgba(0,94,184,0.05),transparent)] animate-[shimmer_3s_infinite]"></div>
          
          <div className="flex items-center gap-4 relative z-10">
            {getPhaseIcon()}
            <div>
              <h2 className="text-xl text-white font-mono font-bold tracking-widest">{getPhaseText()}</h2>
              <p className="text-xs text-uk-blue font-mono mt-1">SESSION ACTIVE</p>
            </div>
          </div>
          <ActivityIndicator />
        </div>

        {/* Progress Bar */}
        <div className="h-1 bg-gray-900 w-full">
           <div className="h-full bg-gradient-to-r from-uk-blue to-cyan-400 transition-all duration-500 ease-out" style={{ width: `${state.status === 'planning' ? 20 : state.status === 'researching' ? 50 : 90}%` }}></div>
        </div>

        {/* Dynamic Visualization Area (Vectors) */}
        {state.activeTasks.length > 0 && (
          <div className="bg-gray-900/80 p-4 border-b border-gray-800 grid grid-cols-2 md:grid-cols-3 gap-3 max-h-32 overflow-y-auto scrollbar-thin scrollbar-thumb-gray-700">
             {state.activeTasks.map((task, i) => (
               <div key={i} className="flex items-center gap-2 text-[10px] font-mono text-cyan-300 bg-cyan-950/30 px-2 py-1 rounded border border-cyan-900/50">
                 <Search className="w-3 h-3 flex-shrink-0 animate-pulse" />
                 <span className="truncate">{task}</span>
               </div>
             ))}
          </div>
        )}

        {/* Terminal Log */}
        <div className="flex-grow overflow-y-auto p-6 bg-black font-mono text-xs space-y-3 h-[400px] scrollbar-thin scrollbar-thumb-uk-blue/30">
          {state.logs.map((log) => (
            <div key={log.id} className="flex gap-4 animate-[fadeIn_0.1s_ease-out] group hover:bg-white/5 p-1 -mx-1 rounded">
              <span className="text-gray-600 flex-shrink-0 select-none w-20 text-right">
                {new Date(log.timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
              <div className="flex-grow flex items-start gap-3">
                <span className="mt-0.5">
                  {log.type === 'network' && <Globe className="w-3.5 h-3.5 text-cyan-500" />}
                  {log.type === 'ai' && <Cpu className="w-3.5 h-3.5 text-purple-500" />}
                  {log.type === 'success' && <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />}
                  {log.type === 'info' && <Terminal className="w-3.5 h-3.5 text-gray-500" />}
                  {log.type === 'planning' && <BrainCircuit className="w-3.5 h-3.5 text-purple-400" />}
                  {log.type === 'synthesizing' && <FileText className="w-3.5 h-3.5 text-yellow-400" />}
                </span>
                <span className={`
                  tracking-wide
                  ${log.type === 'network' ? 'text-cyan-300' : ''}
                  ${log.type === 'ai' ? 'text-purple-300' : ''}
                  ${log.type === 'success' ? 'text-green-400 font-bold' : ''}
                  ${log.type === 'info' ? 'text-gray-400' : ''}
                  ${log.type === 'planning' ? 'text-purple-300' : ''}
                  ${log.type === 'synthesizing' ? 'text-yellow-300' : ''}
                `}>
                  {log.message}
                </span>
              </div>
            </div>
          ))}
          <div ref={logsEndRef} className="h-2" />
          <div className="flex items-center gap-2 text-uk-blue animate-pulse pl-24">
            <span className="w-2 h-4 bg-uk-blue block"></span>
            <span className="text-xs opacity-50">AWAITING SYSTEM RESPONSE...</span>
          </div>
        </div>
      </div>
    </div>
  );
};

const ActivityIndicator = () => (
  <div className="flex gap-1">
    {[1,2,3,4,5].map(i => (
      <div key={i} className="w-1 bg-uk-blue h-6 animate-[pulse_1s_ease-in-out_infinite]" style={{ animationDelay: `${i * 0.1}s`, height: `${Math.random() * 24 + 4}px` }}></div>
    ))}
  </div>
);

export default ProcessingHUD;
