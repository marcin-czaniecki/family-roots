# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and Biome for linting/formatting.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Biome

Lint and format with:

```sh
npm run lint
npm run format
```

Configuration lives in `biome.json`. See the [Biome documentation](https://biomejs.dev/guides/getting-started/) for available rules.
