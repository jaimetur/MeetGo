/// <reference types="vite/client" />
declare const __APP_VERSION__: string;
declare module "*.po?raw" {
  const content: string;
  export default content;
}
