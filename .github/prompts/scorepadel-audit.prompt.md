---
description: Auditoría profesional de ScorePadel Astro + Cloudflare + Wrangler + D1
mode: agent
---

Audita este proyecto ScorePadel sin editar nada todavía.

Lee primero:
- .github/copilot-instructions.md
- .github/skills/scorepadel-cloudflare-audit/SKILL.md

Usa las skills relevantes:
- scorepadel-cloudflare-audit
- cloudflare
- wrangler
- workers-best-practices
- web-perf

No leas:
- node_modules/
- dist/
- .wrangler/
- .astro/
- .git/
- .vscode/
- .claude/
- .agents/
- public/fonts/
- public/images/
- package-lock.json
- ScorePadel.code-workspace

Revisa solo:
- src/
- migrations/
- package.json
- astro.config.mjs
- tsconfig.json
- wrangler.jsonc
- .github/workflows/
- README.md
- .gitignore

Primero crea un mapa de arquitectura.

Después lista problemas reales por severidad:
1. crítico
2. alto
3. medio
4. bajo

Prioriza:
- auth
- sesiones
- cookies
- roles
- permisos
- endpoints API
- validación backend
- acceso a D1
- migraciones SQL
- configuración Wrangler
- compatibilidad Cloudflare runtime
- frontend Astro
- rendimiento
- mantenibilidad

No edites archivos todavía.
No hagas refactors masivos.
No propongas cambios cosméticos.
Cuando encuentres un problema, indica archivo, causa, riesgo y cambio mínimo recomendado.
