/// <reference types="vite/client" />

declare module 'occt-import-js' {
  const occtimportjs: (config?: { locateFile?: (path: string) => string }) => Promise<unknown>;
  export default occtimportjs;
}
