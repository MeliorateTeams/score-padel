---
name: scorepadel-cloudflare-audit
description: Auditoría profesional para proyectos Astro desplegados en Cloudflare con Wrangler, D1, endpoints API, auth, sesiones, migraciones y seguridad. Usar cuando se pida revisar ScorePadel, auditar arquitectura, revisar backend, Cloudflare, D1 o seguridad.
---

# ScorePadel Cloudflare Audit

## Objetivo
Auditar el proyecto ScorePadel con foco en seguridad, arquitectura, endpoints API, Cloudflare, Wrangler, D1/migrations y frontend Astro.

## Archivos permitidos
Leer principalmente:
- src/
- migrations/
- package.json
- astro.config.mjs
- tsconfig.json
- wrangler.jsonc
- .github/workflows/
- README.md
- .gitignore

## Archivos prohibidos salvo petición explícita
No leer ni indexar:
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

## Proceso de revisión
1. Crear mapa de arquitectura.
2. Identificar rutas, endpoints, layouts, componentes y librerías internas.
3. Revisar auth, sesiones, cookies, roles y permisos.
4. Revisar validación de inputs en backend.
5. Revisar acceso a D1 y migraciones SQL.
6. Revisar configuración de Wrangler/Cloudflare.
7. Detectar bugs reales, riesgos de seguridad y deuda técnica.
8. Ordenar hallazgos por severidad: crítico, alto, medio, bajo.
9. Proponer cambios mínimos y seguros.
10. No editar hasta explicar el diff esperado.

## Criterio de calidad
- Código profesional.
- Seguridad primero.
- Sin localStorage salvo necesidad clara.
- Backend como fuente de verdad.
- Evitar duplicación.
- Evitar cambios masivos.
- Mantener compatibilidad con Cloudflare runtime.
