
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
    e.preventDefault(); e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") setDragActive(true);
    else if (e.type === "dragleave") setDragActive(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation(); setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) await processFiles(Array.from(e.dataTransfer.files));
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

  const handleGenerate = () => {
    if (rawText.trim().length === 0 && attachments.length === 0) return;
    onGenerate(rawText, attachments, instructions);
  };

  return (
    <div className="flex flex-col h-full bg-gray-900 border border-gray-800 rounded-lg shadow-2xl relative overflow-hidden text-gray-100" onDragEnter={handleDrag}>
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-800 bg-black/50 flex justify-between items-center">
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-uk-blue" />
          <h2 className="font-bold text-sm uppercase tracking-widest text-gray-400">Parameters</h2>
        </div>
        <button onClick={() => {
            setRawText("TOP SECRET // 2024 \nSOURCE: SIGINT-42\nIntercepted comms indicate movement of assets in Sector 7...");
            setInstructions("Focus on the capabilities of the ground units.");
        }} className="text-[10px] font-mono text-uk-blue hover:text-white uppercase">[Load Sample Data]</button>
      </div>
      
      {dragActive && (
        <div className="absolute inset-0 z-50 bg-uk-blue/20 backdrop-blur-sm border-2 border-uk-blue border-dashed m-4 rounded-lg flex items-center justify-center pointer-events-none">
          <p className="text-uk-blue font-bold tracking-widest">DROP INTEL ASSETS</p>
        </div>
      )}

      <div className="flex-grow flex flex-col p-6 gap-6" onDragEnter={handleDrag} onDragLeave={handleDrag} onDragOver={handleDrag} onDrop={handleDrop}>
        
        <div className="flex-grow-[2] relative flex flex-col group">
          <label className="text-[10px] font-bold text-gray-500 uppercase mb-2">Raw Intelligence</label>
          <textarea
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            placeholder="PASTE TEXT HERE..."
            className="w-full h-full p-4 font-mono text-sm bg-black border border-gray-800 rounded focus:ring-1 focus:ring-uk-blue focus:border-uk-blue resize-none outline-none transition-all placeholder:text-gray-700 text-gray-300"
            disabled={isProcessing}
          />
        </div>

        <div className="flex-grow-[1] flex flex-col">
           <label className="text-[10px] font-bold text-gray-500 uppercase mb-2">Specific Directives (Optional)</label>
           <textarea
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder="e.g. Focus on financial networks, ignore cyber capabilities..."
            className="w-full h-full p-4 font-mono text-sm bg-black border border-gray-800 rounded focus:ring-1 focus:ring-uk-blue focus:border-uk-blue resize-none outline-none transition-all placeholder:text-gray-700 text-uk-blue"
            disabled={isProcessing}
          />
        </div>

        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 p-2 bg-black rounded border border-gray-800">
            {attachments.map((att, idx) => (
              <div key={idx} className="bg-gray-800 px-3 py-1 rounded flex items-center gap-2 text-xs">
                <span className="text-gray-300 max-w-[100px] truncate">{att.file.name}</span>
                <button onClick={() => setAttachments(p => p.filter((_, i) => i !== idx))}><X className="w-3 h-3 hover:text-red-500" /></button>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between pt-4 border-t border-gray-800">
           <div className="flex items-center gap-3">
              <input type="file" multiple className="hidden" ref={fileInputRef} onChange={e => e.target.files && processFiles(Array.from(e.target.files))} />
              <button onClick={() => fileInputRef.current?.click()} disabled={isProcessing} className="flex items-center gap-2 text-xs font-bold text-gray-400 hover:text-white uppercase transition-colors">
                <Paperclip className="w-4 h-4" /> Attach Files
              </button>
              <button onClick={() => { setRawText(''); setAttachments([]); setInstructions(''); }} className="text-gray-600 hover:text-red-500 transition-colors" title="Clear All"><Trash2 className="w-4 h-4" /></button>
           </div>

           <button onClick={handleGenerate} disabled={(!rawText.trim() && attachments.length === 0) || isProcessing}
             className={`flex items-center gap-2 px-8 py-3 rounded font-bold text-xs uppercase tracking-widest transition-all ${(!rawText.trim() && attachments.length === 0) || isProcessing ? 'bg-gray-800 text-gray-600 cursor-not-allowed' : 'bg-uk-blue text-white hover:bg-blue-600 hover:shadow-[0_0_20px_rgba(29,78,216,0.5)]'}`}>
             {isProcessing ? 'System Busy' : 'Initialize Operation'} {!isProcessing && <Play className="w-3 h-3 fill-current" />}
           </button>
        </div>
      </div>
    </div>
  );
};

export default InputSection;
