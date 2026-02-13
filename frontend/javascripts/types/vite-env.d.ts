/// <reference types="vite/client" />


// This file is used to add types to the import.meta.env object
// vitest set's MODE to test during (unit) tests
interface ImportMetaEnv {
  readonly MODE: "production" | "development" | "test"
  readonly BASE_URL: string
  readonly PROD: boolean
  readonly DEV: boolean
  readonly SSR: boolean
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}