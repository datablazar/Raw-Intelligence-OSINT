
import React, { useState, useRef, useEffect } from 'react';
import { Send, Paperclip, X, FileImage, Sparkles, Globe, BrainCircuit, FileText } from 'lucide-react';
import { Chat } from "@google/genai";
import { Attachment, ChatMessage, AnalysisReport } from '../types';
import { sendChatMessage, performSearchQuery } from '../services/geminiService';
const loadMammoth = (() => {
  let cached: Promise<any> | null = null;
  return async () => {
    if (!cached) cached = import('mammoth');
    const mod = await cached;
    return mod.default ?? mod;
  };
})();

interface ChatInterfaceProps {
  chatSession: Chat | null;
  report: AnalysisReport | null;
  onUpdateReport: (report: AnalysisReport) => void;
  className?: string;
  onClose?: () => void;
}

interface FunctionArgs {
    sectionTitle?: string;
    content?: string;
    urls?: string[];
    query?: string;
}

const ChatInterface: React.FC<ChatInterfaceProps> = ({ chatSession, report, onUpdateReport, className, onClose }) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (chatSession && messages.length === 0) {
      setMessages([{
        id: 'init',
        role: 'model',
        text: "I verify facts, analyze patterns, and edit the report. What is your requirement?"
      }]);
    }
  }, [chatSession]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const files = Array.from(e.target.files) as File[];
      const newAttachments: Attachment[] = [];
      for (const file of files) {
        let type: Attachment['type'] = 'file';
        let textContent: string | undefined;
        let base64: string | undefined;

        // Determine Type
        if (file.type.startsWith('image/')) type = 'image';
        else if (file.type.startsWith('audio/')) type = 'audio';
        else if (file.type.startsWith('video/')) type = 'video';
        
        // Process Content
        if (file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
            // DOCX
            try {
                type = 'text';
                const arrayBuffer = await file.arrayBuffer();
                const mammoth = await loadMammoth();
                const result = await mammoth.extractRawText({ arrayBuffer });
                textContent = result.value;
            } catch (e) {
                console.error("DOCX extraction failed", e);
                continue;
            }
        } else if (file.type === 'text/plain' || file.type === 'application/json' || file.type === 'text/csv' || file.type === 'text/markdown' || file.name.endsWith('.md')) {
            // TEXT
            type = 'text';
            textContent = await file.text();
        } else {
            // BINARY (PDF, Images, etc)
            base64 = await new Promise<string>((resolve) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
                reader.readAsDataURL(file);
            });
        }

        newAttachments.push({ file, base64, mimeType: file.type, type, textContent });
      }
      setAttachments(prev => [...prev, ...newAttachments]);
    }
  };

  const processToolCall = async (call: any, currentReport: AnalysisReport | null): Promise<{ reportUpdated: boolean, updatedReport: AnalysisReport | null, message: string, result: any }> => {
      const args = call.args as FunctionArgs;
      
      if (call.name === 'edit_report_section' && currentReport && args.sectionTitle && args.content) {
          const updatedReport = { ...currentReport, sections: [...currentReport.sections] };
          const sectionIndex = updatedReport.sections.findIndex(s => s.title.toLowerCase() === args.sectionTitle?.toLowerCase());
          
          let contentData: string | string[] = args.content;
          if (String(args.content).includes('\n') || String(args.content).trim().startsWith('-')) {
             contentData = String(args.content).split('\n').map(s => s.replace(/^[•-]\s*/, '').trim()).filter(s => s);
          }

          if (sectionIndex >= 0) {
              updatedReport.sections[sectionIndex] = { ...updatedReport.sections[sectionIndex], content: contentData };
              return { reportUpdated: true, updatedReport, message: `Updated section [${args.sectionTitle}]`, result: "Success" };
          } else {
              updatedReport.sections.push({ 
                  title: args.sectionTitle, 
                  type: Array.isArray(contentData) ? 'list' : 'text', 
                  content: contentData 
              });
              return { reportUpdated: true, updatedReport, message: `Created section [${args.sectionTitle}]`, result: "Success" };
          }
      }

      if (call.name === 'add_sources_to_report' && currentReport && args.urls) {
          const updatedReport = { ...currentReport };
          const existingUrls = new Set(updatedReport.relevantLinks?.map(l => l.url) || []);
          const newLinks = args.urls.filter(u => !existingUrls.has(u)).map(u => ({
              url: u, title: 'Manually Added Source', summary: 'Added via analyst chat.'
          }));
          updatedReport.relevantLinks = [...(updatedReport.relevantLinks || []), ...newLinks];
          return { reportUpdated: true, updatedReport, message: `Added ${newLinks.length} new source(s)`, result: "Success" };
      }

      if (call.name === 'search_google' && args.query) {
          const result = await performSearchQuery(args.query);
          return { reportUpdated: false, updatedReport: null, message: "", result };
      }

      return { reportUpdated: false, updatedReport: null, message: "", result: "Unknown Tool" };
  };

  const handleSend = async () => {
    if ((!input.trim() && attachments.length === 0) || !chatSession) return;

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      text: input,
      attachments: [...attachments]
    };

    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setAttachments([]);
    setIsTyping(true);

    try {
      const response = await sendChatMessage(chatSession, userMsg.text, userMsg.attachments);
      
      let botText = response.text || "";
      let grounding = response.candidates?.[0]?.groundingMetadata;

      // Handle Tool Calls
      const functionCalls = response.candidates?.[0]?.content?.parts?.filter(p => p.functionCall).map(p => p.functionCall);
      
      if (functionCalls && functionCalls.length > 0) {
        let currentReportState = report;
        const toolOutputs: string[] = [];

        for (const call of functionCalls) {
            const { reportUpdated, updatedReport, message, result } = await processToolCall(call, currentReportState);
            
            if (reportUpdated && updatedReport) {
                currentReportState = updatedReport;
                toolOutputs.push(message);
            }

            // Send tool response back to model
            const res = await chatSession.sendMessage({
                message: [{ functionResponse: { name: call.name, response: { result }, id: call.id } }]
            });

            if (res.text) botText += (botText ? "\n\n" : "") + res.text;
            if (res.candidates?.[0]?.groundingMetadata) grounding = res.candidates[0].groundingMetadata;
        }

        if (currentReportState && currentReportState !== report) {
            onUpdateReport(currentReportState);
            if (!botText) botText = toolOutputs.join(". ") + ".";
        }
      }

      setMessages(prev => [...prev, { id: crypto.randomUUID(), role: 'model', text: botText || "Acknowledged.", groundingMetadata: grounding }]);

    } catch (error) {
      console.error(error);
      setMessages(prev => [...prev, { id: crypto.randomUUID(), role: 'model', text: "Error: Communications link disrupted." }]);
    } finally {
      setIsTyping(false);
    }
  };

  return (
    <div className={`flex flex-col h-full bg-white ${className}`}>
      {/* Header */}
      <div className="p-4 border-b border-gray-200 flex justify-between items-center bg-gray-50 flex-shrink-0">
        <div className="flex items-center gap-2">
          <div className="bg-uk-blue/10 p-1.5 rounded-full"><BrainCircuit className="w-5 h-5 text-uk-blue" /></div>
          <div>
            <h3 className="font-bold text-uk-navy text-sm">Sentinel Assistant</h3>
            <p className="text-[10px] uppercase text-gray-400 font-bold tracking-wider">Analysis Channel</p>
          </div>
        </div>
        {onClose && <button onClick={onClose} className="text-gray-400 hover:text-uk-blue"><X className="w-5 h-5" /></button>}
      </div>

      {/* Messages */}
      <div className="flex-grow overflow-y-auto p-4 space-y-4 bg-gray-50/50">
        {messages.map((msg) => (
          <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] rounded-lg p-3 text-sm shadow-sm ${msg.role === 'user' ? 'bg-uk-blue text-white rounded-br-none' : 'bg-white border border-gray-200 text-gray-800 rounded-bl-none'}`}>
              {msg.attachments && msg.attachments.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-2">
                   {msg.attachments.map((att, i) => (
                     <div key={i} className="bg-black/20 rounded p-1" title={att.file.name}>
                       {att.type === 'image' ? <FileImage className="w-3 h-3 text-white" /> : <FileText className="w-3 h-3 text-white" />}
                     </div>
                   ))}
                </div>
              )}
              <p className="whitespace-pre-wrap leading-relaxed">{msg.text}</p>
              {msg.groundingMetadata?.groundingChunks && (
                <div className="mt-2 pt-2 border-t border-white/20">
                  <p className="text-[10px] font-bold opacity-70 mb-1 flex items-center gap-1"><Globe className="w-3 h-3" /> VERIFIED SOURCES</p>
                  <ul className="space-y-1">
                    {msg.groundingMetadata.groundingChunks.map((chunk: any, idx: number) => {
                       const uri = chunk.web?.uri;
                       if (uri && !uri.includes('vertexaisearch')) {
                         return <li key={idx}><a href={uri} target="_blank" rel="noreferrer" className="text-[10px] underline hover:text-blue-300 truncate block max-w-xs">{chunk.web.title || uri}</a></li>;
                       }
                       return null;
                    })}
                  </ul>
                </div>
              )}
            </div>
          </div>
        ))}
        {isTyping && <div className="text-xs text-gray-400 flex items-center gap-2 p-2"><Sparkles className="w-3 h-3 animate-pulse" /> Processing...</div>}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-3 bg-white border-t border-gray-200 flex-shrink-0">
        <div className="flex gap-2">
          <input type="file" multiple ref={fileInputRef} className="hidden" onChange={handleFileSelect} />
          <button onClick={() => fileInputRef.current?.click()} className="p-2 text-gray-400 hover:text-uk-blue hover:bg-gray-50 rounded-lg transition-colors"><Paperclip className="w-5 h-5" /></button>
          
          <div className="flex-grow relative">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }}}
              placeholder="Enter query..."
              className="w-full pl-3 pr-8 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-uk-blue resize-none h-10 text-sm"
            />
          </div>
          
          <button onClick={handleSend} disabled={!input.trim()} className="p-2 bg-uk-blue text-white rounded-lg hover:bg-uk-navy transition-colors disabled:opacity-50"><Send className="w-5 h-5" /></button>
        </div>
      </div>
    </div>
  );
};

export default ChatInterface;
