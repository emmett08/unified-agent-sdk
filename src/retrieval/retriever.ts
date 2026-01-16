export interface RetrievedChunk {
  id: string;
  text: string;
  score?: number;
  metadata?: Record<string, unknown>;
}

export interface RetrieverPort {
  retrieve(query: string, topK: number): Promise<RetrievedChunk[]>;
}
