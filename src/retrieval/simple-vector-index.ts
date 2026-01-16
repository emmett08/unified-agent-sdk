import type { RetrievedChunk, RetrieverPort } from './retriever.js';
import type { EmbeddingProvider } from './embedding.js';

function dot(a: number[], b: number[]): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i]! * b[i]!;
  return s;
}
function norm(a: number[]): number {
  return Math.sqrt(dot(a, a));
}
function cosine(a: number[], b: number[]): number {
  const d = dot(a, b);
  const na = norm(a);
  const nb = norm(b);
  if (na === 0 || nb === 0) return 0;
  return d / (na * nb);
}

export interface VectorDocument {
  id: string;
  text: string;
  embedding: number[];
  metadata?: Record<string, unknown>;
}

export class SimpleVectorIndex implements RetrieverPort {
  private docs: VectorDocument[] = [];
  constructor(private embedder: EmbeddingProvider) {}

  async addDocuments(docs: Array<{ id: string; text: string; metadata?: Record<string, unknown> }>): Promise<void> {
    const embeddings = await this.embedder.embed(docs.map((d) => d.text));
    this.docs.push(...docs.map((d, i) => ({ id: d.id, text: d.text, metadata: d.metadata, embedding: embeddings[i]! })));
  }

  async retrieve(query: string, topK: number): Promise<RetrievedChunk[]> {
    const [qEmb] = await this.embedder.embed([query]);
    if (!qEmb) return [];
    const scored = this.docs
      .map((d) => ({ d, score: cosine(qEmb, d.embedding) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(1, topK));
    return scored.map(({ d, score }) => ({ id: d.id, text: d.text, metadata: d.metadata, score }));
  }
}
