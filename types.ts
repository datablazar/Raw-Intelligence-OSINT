
export enum ConfidenceLevel {
  LOW = "Low Probability",
  MODERATE = "Moderate Probability",
  HIGH = "High Probability",
  NEAR_CERTAINTY = "Near Certainty"
}

export enum Classification {
  OFFICIAL = "OFFICIAL",
  OFFICIAL_SENSITIVE = "OFFICIAL-SENSITIVE",
  SECRET = "SECRET",
  TOP_SECRET = "TOP SECRET"
}

export interface ReportSection {
  title: string;
  type: 'text' | 'list';
  content: string | string[];
}

export interface Entity {
  name: string;
  type: 'Person' | 'Location' | 'Organization' | 'Weapon' | 'Cyber' | 'Event';
  context: string;
  threatLevel?: 'Low' | 'Medium' | 'High' | 'Critical';
}

export interface SourceReference {
  url: string;
  title?: string;
  summary?: string;
  active?: boolean; // For UI toggling
}

export interface FailedSource {
  url: string;
  reason: string;
  isHighValue: boolean;
}

export interface IntelligenceReport {
  classification: Classification;
  handlingInstructions: string;
  reportTitle: string;
  referenceNumber: string;
  dateOfInformation: string;
  executiveSummary: string;
  sections: ReportSection[];
  entities: Entity[];
  sourceReliability: string;
  analystComment: string;
  overallConfidence: ConfidenceLevel;
  relevantLinks?: SourceReference[];
}

export interface ProcessingLog {
  id: string;
  message: string;
  type: 'info' | 'network' | 'ai' | 'success' | 'planning' | 'synthesizing';
  timestamp: number;
  details?: string[]; // URLS or sub-steps
}

export interface ProcessingState {
  status: 'idle' | 'planning' | 'researching' | 'synthesizing' | 'complete' | 'error';
  logs: ProcessingLog[];
  activeTasks: string[];
  error?: string;
  progress: number;
}

export interface HistoryItem {
  id: string;
  timestamp: number;
  report: IntelligenceReport;
  rawContext: string;
}

export interface Attachment {
  file: File;
  base64?: string;
  mimeType: string;
  type: 'image' | 'audio' | 'video' | 'file' | 'text';
  textContent?: string;
  context?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  attachments?: Attachment[];
  isThinking?: boolean;
  groundingMetadata?: any;
}

// --- NEW TYPES FOR WIZARD ---

export interface MissionConfig {
  rawText: string;
  attachments: Attachment[];
  instructions: string;
}

export interface ResearchPlan {
  reliabilityAssessment: string;
  informationGaps: string[];
  searchQueries: string[];
  foundUrls?: string[]; // URLs extracted from source docs
}

export interface ReportStructureItem {
  title: string;
  type: 'text' | 'list';
  guidance: string;
}

export interface ReportStructure {
  sections: ReportStructureItem[];
}

export interface DeepResearchResult {
  context: string;
  sources: SourceReference[];
  failedUrls?: FailedSource[];
}

export interface ResearchSectionResult {
  title: string;
  content: string;
  links: SourceReference[];
}