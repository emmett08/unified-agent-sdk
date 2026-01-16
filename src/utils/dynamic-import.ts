/**
 * Dynamic import helper that avoids compile-time dependency resolution.
 * Useful when providers are optional peerDependencies.
 */
export const dynamicImport: (specifier: string) => Promise<any> =
  // eslint-disable-next-line no-new-func
  new Function('s', 'return import(s)') as any;
