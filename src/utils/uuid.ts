import { v4 as uuidv4 } from 'uuid';

export function uuid(): string {
  const cryptoObj = globalThis.crypto;
  if (typeof cryptoObj?.randomUUID === 'function') return cryptoObj.randomUUID();
  return uuidv4();
}
