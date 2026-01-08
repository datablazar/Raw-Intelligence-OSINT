import React from 'react';
import { ShieldCheck, FileText } from 'lucide-react';

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
            <p className="text-xs text-gray-300 font-mono tracking-widest">UKIC INTELLIGENCE GENERATOR</p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <FileText className="w-4 h-4" />
          <span className="hidden sm:inline">Secure Environment: UNCLASSIFIED (Until Generated)</span>
        </div>
      </div>
    </header>
  );
};

export default Header;
