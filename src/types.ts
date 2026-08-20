export type Protocol = "openai" | "anthropic" | "gemini";
export type MessageRole = "user" | "assistant" | "system";
export type MemoryKind = "fact" | "scene" | "relationship" | "preference";
export type MemoryStatus = "confirmed" | "pending" | "rejected";
export type NarrativePreset = "none" | "cultivation-conquest";

export interface ProviderProfile {
  id: string;
  name: string;
  protocol: Protocol;
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
  persistKey: boolean;
  updatedAt?: number;
}

export interface CharacterProfile {
  id: string;
  name: string;
  aliases: string[];
  role: string;
  age?: number;
  adult: boolean;
  traits: string[];
  goals: string[];
  fears: string[];
  voice: string;
  knowledge: string[];
  unknowns: string[];
  boundaries: string[];
  relationships: Record<string, string>;
  notes?: string;
}

export interface LoreEntry {
  id: string;
  title: string;
  keys: string[];
  content: string;
  priority: number;
  alwaysActive?: boolean;
  chapterStart?: number;
  chapterEnd?: number;
}

export interface NarrativeStyleGuide {
  summary: string;
  traits: string[];
  avoid: string[];
  adultSummary?: string;
  adultTraits?: string[];
  adultAvoid?: string[];
}

export interface ChapterProfile {
  id: string;
  order: number;
  sourceIndex?: number;
  chapterNumber?: number;
  title: string;
  sourceFile?: string;
  content: string;
  openingExcerpt: string;
  closingExcerpt: string;
  characterIds: string[];
  locationIds: string[];
  itemIds: string[];
  keywords: string[];
}

export interface TimelineEntry {
  id: string;
  label: string;
  description: string;
  chapterOrder?: number;
}

export interface WorldbookPack {
  format: "tavern-worldbook/v1";
  meta: {
    title: string;
    author?: string;
    source?: string;
    summary?: string;
    canonVersion?: string;
    cover?: string;
  };
  world: {
    era: string;
    setting: string;
    rules: string[];
    glossary: Record<string, string>;
  };
  characters: CharacterProfile[];
  factions: { id: string; name: string; stance: string; members?: string[] }[];
  locations: { id: string; name: string; description: string }[];
  items: { id: string; name: string; description: string }[];
  timeline: TimelineEntry[];
  lorebook: LoreEntry[];
  chapters?: ChapterProfile[];
  styleGuide?: NarrativeStyleGuide;
  openingScene?: SceneState;
}

export interface Book extends WorldbookPack {
  id: string;
  referenceText?: string;
  createdAt: number;
  updatedAt: number;
}

export interface SceneState {
  chapter: string;
  location: string;
  time: string;
  weather: string;
  atmosphere: string;
  objective: string;
  activeCharacters: string[];
  lastEvent: string;
}

export interface RelationshipState {
  characterId: string;
  trust: number;
  familiarity: number;
  tension: number;
  note: string;
}

export interface MemoryRecord {
  id: string;
  bookId: string;
  sessionId: string;
  kind: MemoryKind;
  content: string;
  source: string;
  status: MemoryStatus;
  createdAt: number;
}

export interface StatePatch {
  scene?: Partial<SceneState>;
  relationships?: Partial<RelationshipState>[];
  memories?: { kind: MemoryKind; content: string; reason?: string }[];
}

export interface ChatMessage {
  id: string;
  role: MessageRole;
  speaker?: string;
  content: string;
  createdAt: number;
  statePatch?: StatePatch;
}

export interface Session {
  id: string;
  bookId: string;
  title: string;
  chapter: string;
  messages: ChatMessage[];
  scene: SceneState;
  relationships: RelationshipState[];
  entryPoint?: SessionEntryPoint;
  createdAt: number;
  updatedAt: number;
}

export interface SessionEntryPoint {
  chapterId?: string;
  chapterOrder?: number;
  roleMode: "traveler" | "character";
  playerCharacterId?: string;
  playerName: string;
  playerRole: string;
  playerAdult: boolean;
  canonMode: "strict";
  styleMode: "source" | "custom";
}

export interface AppSettings {
  activeProviderId: string;
  activeBookId: string;
  activeSessionId: string;
  rightPanel: "scene" | "relations" | "memory" | "worldbook";
  adultContent: boolean;
  compactMode: boolean;
  narrativePreset: NarrativePreset;
  customStyle: string;
}

export interface ModelMessage {
  role: MessageRole;
  content: string;
}
