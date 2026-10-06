# Baja Telemetria v2

O contrato do projeto está em `docs/ARQUITETURA.md`: leia a seção da parte em que vai mexer.

Regras que valem sempre:

- **Os números não mudam.** `packages/core` é o porte fiel de `legacy/js` (app antigo,
  validado com modelo físico). Nada de "melhorar" fórmulas, limiares ou arredondamentos.
  Toda função portada tem teste de equivalência contra o app antigo
  (`packages/core/test/legacy.ts` + `test/compare.ts`).
- `legacy/` é só leitura.
- **Todo número, gráfico e correlação mostra de quais sensores saiu** e abre um card de
  explicação (o que é, sensores, como é calculado, uso no projeto do carro novo, limites,
  teste). Ver `docs/ARQUITETURA.md` 3.8 e 4.6. Serve para a equipe e para os juízes.
- `@baja/core` é puro (sem DOM, sem Node). Interface em `apps/web`, servidor em `apps/server`.
- Interface em português do Brasil; comentários em português, no mesmo tom do código antigo.
- Não instale dependências novas sem necessidade; se instalar, registre em `docs/ARQUITETURA.md`.
- Antes de dar por pronto: `npm run typecheck`, `npm test` e `npm run build` na raiz passam.
- Windows + Git Bash: use caminhos absolutos (`/c/Users/ricar/baja-telemetria/...`).
