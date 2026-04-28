# ScorePadel - GitHub Copilot Instructions

## Stack
Proyecto Astro desplegado en Cloudflare con Wrangler y posibles migraciones D1.

## Copilot debe leer normalmente
- src/
- migrations/
- package.json
- astro.config.mjs
- tsconfig.json
- wrangler.jsonc
- .github/workflows/
- README.md
- .gitignore

## Copilot NO debe leer salvo petición explícita
- node_modules/
- dist/
- .wrangler/
- .astro/
- .git/
- .vscode/
- .claude/
- public/fonts/
- public/images/
- package-lock.json
- ScorePadel.code-workspace

## Prioridad técnica
1. Seguridad
2. Auth y sesiones
3. Endpoints API
4. Validación backend
5. Roles y permisos
6. D1/migrations
7. Cloudflare/Wrangler
8. Frontend Astro
9. Rendimiento
10. Mantenibilidad

## Reglas
- No usar localStorage salvo necesidad real y justificada.
- No hacer refactors masivos sin justificar.
- Antes de editar, explicar el problema y el cambio.
- Cambios mínimos, seguros y profesionales.
- Validación fuerte en backend.
- No tocar node_modules, dist ni carpetas generadas.
- No ejecutar comandos destructivos.
