import React, { useState, useRef } from 'react';
import { Trash2, Upload, FileAudio, FileVideo, FileImage, X, Shield, Paperclip, Clipboard, Play } from 'lucide-react';
import { Attachment } from '../types';

interface InputSectionProps {
  onGenerate: (text: string, attachments: Attachment[], instructions: string) => void;
  isProcessing: boolean;
  variant?: 'card' | 'sidebar';
}

const InputSection: React.FC<InputSectionProps> = ({ onGenerate, isProcessing, variant = 'card' }) => {
  const [rawText, setRawText] = useState('');
  const [instructions, setInstructions] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      await processFiles(Array.from(e.dataTransfer.files));
    }
  };

  const processFiles = async (files: File[]) => {
    const newAttachments: Attachment[] = [];
    for (const file of files) {
      let type: Attachment['type'] = 'file';
      if (file.type.startsWith('image/')) type = 'image';
      else if (file.type.startsWith('audio/')) type = 'audio';
      else if (file.type.startsWith('video/')) type = 'video';

      const base64 = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
        reader.readAsDataURL(file);
      });
      newAttachments.push({ file, base64, mimeType: file.type, type });
    }
    setAttachments(prev => [...prev, ...newAttachments]);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) processFiles(Array.from(e.target.files));
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setRawText(prev => prev + (prev ? '\n\n' : '') + text);
    } catch (error) {
      console.warn("Clipboard access blocked:", error);
      alert("Clipboard access is restricted in this environment. Please use keyboard shortcuts (Ctrl+V / Cmd+V) to paste.");
    }
  };

  const handleGenerate = () => {
    if (rawText.trim().length === 0 && attachments.length === 0) return;
    onGenerate(rawText, attachments, instructions);
  };

  const isSidebar = variant === 'sidebar';

  return (
    <div 
      className={`flex flex-col h-full bg-white relative ${isSidebar ? 'border-r border-gray-200' : 'rounded-xl shadow-lg border border-gray-200 overflow-hidden'}`}
      onDragEnter={handleDrag}
    >
      {/* Header */}
      <div className={`px-5 py-4 border-b border-gray-200 flex justify-between items-center ${isSidebar ? 'bg-white' : 'bg-gray-50'}`}>
        <div className="flex items-center gap-2">
          <Shield className="w-5 h-5 text-uk-blue" />
          <h2 className="font-bold text-uk-navy text-sm uppercase tracking-wide">
            {isSidebar ? 'Current Mission' : 'Mission Initialization'}
          </h2>
        </div>
        {!isSidebar && (
          <div className="flex gap-2">
             <button onClick={() => {
                setRawText("TOP SECRET // 2024 \nSOURCE: SIGINT-42\nIntercepted comms indicate movement of assets in Sector 7...");
                setInstructions("Focus on the capabilities of the ground units.");
             }} className="text-xs font-mono text-gray-400 hover:text-uk-blue">LOAD SAMPLE</button>
          </div>
        )}
      </div>
      
      {/* Drag Overlay */}
      {dragActive && (
        <div className="absolute inset-0 z-50 bg-uk-blue/10 backdrop-blur-sm border-2 border-uk-blue border-dashed m-2 rounded-lg flex items-center justify-center pointer-events-none">
          <p className="text-uk-blue font-bold">DROP INTELLIGENCE ASSETS HERE</p>
        </div>
      )}

      <div className="flex-grow flex flex-col p-5 gap-4 overflow-hidden" onDragEnter={handleDrag} onDragLeave={handleDrag} onDragOver={handleDrag} onDrop={handleDrop}>
        
        {/* Main Text Input */}
        <div className="flex-grow-[2] relative flex flex-col">
          <textarea
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            placeholder="ENTER RAW INTELLIGENCE DATA..."
            className={`w-full h-full p-4 font-mono text-sm bg-gray-50 text-gray-900 border border-gray-200 rounded-lg focus:ring-2 focus:ring-uk-blue focus:border-uk-blue resize-none outline-none transition-all placeholder:text-gray-400 ${isSidebar ? 'min-h-[200px]' : ''}`}
            disabled={isProcessing}
          />
          {!rawText && !isSidebar && (
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center opacity-20">
              <Shield className="w-32 h-32 text-gray-400" />
            </div>
          )}
          <button onClick={handlePaste} className="absolute top-2 right-2 p-1.5 bg-white border border-gray-200 rounded shadow-sm text-gray-500 hover:text-uk-blue" title="Paste Clipboard">
            <Clipboard className="w-4 h-4" />
          </button>
        </div>

        {/* Mission Instructions */}
        <div className="flex-grow-[1] flex flex-col">
           <label className="text-xs font-bold text-uk-navy uppercase mb-1">Specific Mission Instructions (Optional)</label>
           <textarea
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder="e.g. Focus on financial implications, ignore cyber aspects..."
            className="w-full h-full p-3 font-mono text-sm bg-blue-50/50 text-gray-900 border border-blue-100 rounded-lg focus:ring-2 focus:ring-uk-blue focus:border-uk-blue resize-none outline-none transition-all placeholder:text-blue-300"
            disabled={isProcessing}
          />
        </div>

        {/* Attachments */}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto p-1">
            {attachments.map((att, idx) => (
              <div key={idx} className="group relative bg-white border border-gray-200 pl-2 pr-8 py-2 rounded-md flex items-center gap-3 shadow-sm hover:shadow-md transition-all">
                {att.type === 'image' && <FileImage className="w-4 h-4 text-blue-600" />}
                {att.type === 'audio' && <FileAudio className="w-4 h-4 text-purple-600" />}
                {att.type === 'video' && <FileVideo className="w-4 h-4 text-red-600" />}
                <div className="flex flex-col">
                  <span className="text-xs font-medium text-gray-700 truncate max-w-[150px]">{att.file.name}</span>
                  <span className="text-[10px] text-gray-400 uppercase">{(att.file.size / 1024).toFixed(1)} KB</span>
                </div>
                <button onClick={() => setAttachments(prev => prev.filter((_, i) => i !== idx))} className="absolute right-1 top-1/2 -translate-y-1/2 p-1 text-gray-300 hover:text-red-500 transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Toolbar */}
        <div className="flex items-center justify-between pt-2 border-t border-gray-100">
           <div className="flex items-center gap-2">
              <input type="file" multiple accept="image/*,audio/*,video/*" className="hidden" ref={fileInputRef} onChange={handleFileSelect} />
              <button 
                onClick={() => fileInputRef.current?.click()}
                disabled={isProcessing}
                className="flex items-center gap-2 px-3 py-2 text-xs font-bold text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-md transition-colors uppercase tracking-wide"
              >
                <Paperclip className="w-4 h-4" /> Attach Assets
              </button>
              <button 
                onClick={() => { setRawText(''); setAttachments([]); setInstructions(''); }}
                className="p-2 text-gray-400 hover:text-red-600 transition-colors"
                title="Clear All"
              >
                <Trash2 className="w-4 h-4" />
              </button>
           </div>

           <button
             onClick={handleGenerate}
             disabled={(!rawText.trim() && attachments.length === 0) || isProcessing}
             className={`
               flex items-center gap-2 px-6 py-2 rounded-md font-bold text-sm shadow-md transition-all uppercase tracking-wider
               ${(!rawText.trim() && attachments.length === 0) || isProcessing 
                 ? 'bg-gray-200 text-gray-400 cursor-not-allowed' 
                 : 'bg-uk-navy text-white hover:bg-uk-blue hover:shadow-lg active:scale-95'}
             `}
           >
             {isProcessing ? 'Executing...' : 'Initiate Analysis'}
             {!isProcessing && <Play className="w-4 h-4 fill-current" />}
           </button>
        </div>
      </div>
    </div>
  );
};

export default InputSection;