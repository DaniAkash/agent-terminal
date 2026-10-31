/// <reference types="vite/client" />

// `@wterm/dom`'s `./css` subpath export has no `types` condition, so a
// side-effect import of it is unresolvable to TypeScript even though
// Vite handles it. Declaring the module keeps the import honest rather
// than silencing it at the call site.
declare module '@wterm/dom/css'
