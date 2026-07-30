# Repository Guidelines

## Project Structure & Module Organization

This repository is a Vue 3 and TypeScript application for interactive backend-system visualizations.

- `src/components/`: lab interfaces and shared controls. Use PascalCase filenames such as `KafkaLab.vue`.
- `src/composables/`: reusable Vue state logic, including the step player.
- `src/simulations/`: deterministic domain models, state frames, and their unit tests.
- `src/style.css`: global styles; component-specific styles remain in Vue single-file components.
- `index.html` and `src/main.ts`: application entry points.

When adding a lab, model its deterministic state transitions in `src/simulations/` first. Components should map those states to SVG/UI; animations should interpolate between frames, not calculate domain rules.

## Build, Test, and Development Commands

- `npm install`: install the locked dependencies from `package-lock.json`.
- `npm run dev`: start the Vite development server with hot reload.
- `npm test`: run the Vitest suite once.
- `npm run build`: type-check with `vue-tsc` and create the production bundle in `dist/`.
- `npm run preview`: serve the production build locally for final verification.

Run tests and the production build before submitting a pull request.

## Coding Style & Naming Conventions

Follow the existing TypeScript style: two-space indentation, single quotes, no semicolons, and trailing commas in multiline structures. Keep strict TypeScript types; avoid `any` and prefer explicit domain unions or IDs. Name Vue components in PascalCase, composables with a `use` prefix, functions and variables in camelCase, and exported constants descriptively.

No standalone formatter or linter is configured. Match nearby code and rely on `npm run build` for type validation.

## Testing Guidelines

Tests use Vitest; component tests use Vue Test Utils with jsdom. Place tests beside their source as `*.test.ts`, for example `src/simulations/kafka.test.ts`. Test observable behavior, invariants, causal frame ordering, and boundary cases. Add or update tests whenever simulation rules, navigation, or playback behavior changes.

## Commit & Pull Request Guidelines

Recent commits use short, imperative, sentence-style subjects, such as `Fix Kafka consumer route anchors`. Keep each commit focused and avoid unrelated cleanup.

Pull requests should explain the user-visible change, note affected labs, and list verification commands. Link relevant issues when available. Include screenshots or a short recording for visual, animation, or responsive-layout changes, and call out any intentional model simplifications.
