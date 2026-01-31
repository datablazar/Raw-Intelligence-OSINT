
import React from 'react';
import { ShieldCheck, FileText, Wifi } from 'lucide-react';

const Header: React.FC = () => {
  return (
    <header className="bg-uk-navy text-white shadow-md border-b-4 border-uk-red no-print">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-white/10 rounded-full">
            <ShieldCheck className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight uppercase">Sentinel</h1>
            <p className="text-[10px] text-gray-400 font-mono tracking-widest uppercase">UK Intelligence Transformation Platform</p>
          </div>
        </div>
        <div className="flex items-center gap-4 text-sm text-gray-400">
           <div className="hidden md:flex items-center gap-2 bg-black/20 px-3 py-1 rounded-full border border-white/5">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
              <span className="text-[10px] font-mono font-bold tracking-wider text-green-500">SYSTEM ACTIVE</span>
           </div>
           <div className="flex items-center gap-2">
              <FileText className="w-4 h-4" />
              <span className="text-[10px] font-bold tracking-widest uppercase text-uk-red">SECURE // NOFORN</span>
           </div>
        </div>
      </div>
    </header>
  );
};

export default Header;
