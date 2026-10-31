declare module '*.css'

// `@wterm/dom`'s `./css` subpath export has no `types` condition, so a
// side-effect import of it is unresolvable to TypeScript even though the
// bundler handles it.
declare module '@wterm/dom/css'
