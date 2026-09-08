# Versionamento — LumaBot

## Visão Geral

LumaBot adere ao **[Versionamento Semântico (SemVer)](https://semver.org/lang/pt-BR/)** e mantém histórico de mudanças em formato **[Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/)**.

Cada release marca um ponto estável e identificável do projeto. A versão comunica:
- **O que mudou** (features, correções, quebras)
- **Quando mudou** (data do release)
- **Por que mudou** (contexto no CHANGELOG e ADRs)

---

## Formato da Versão: MAJOR.MINOR.PATCH

```
1.5.0
│ │ └─ PATCH (0-9...): Correções de bugs, sem novas features
│ └─── MINOR (0-9...): Novas features, sem quebra de compatibilidade
└───── MAJOR (0-9...): Quebras de compatibilidade ou mudanças arquiteturais grandes
```

### Quando incrementar cada parte

| Versão | Incrementa quando | Exemplos |
|--------|-------------------|----------|
| **MAJOR** | Quebra compatibilidade ou refactoring arquitetural radical | Migração de banco de dados, mudança de port de API, remoção de comando público |
| **MINOR** | Nova feature ou melhoria significativa, sem quebras | Novo plugin, novo comando, migração interna (systemInstruction), new adapter |
| **PATCH** | Correção de bug ou otimização interna | Fix em detecção de mídia, ajuste em timeout, correção de citações |

**Exemplo do histórico:**
- `1.4.x` → `1.5.0`: adição de suporte multi-turno (`systemInstruction`), legendas em stickers, novas opções em handlers
- `1.5.0` → `1.5.1`: correção de bug em citações, otimização de FFmpeg (patch)

---

## Estrutura do CHANGELOG

O arquivo `CHANGELOG.md` (raiz do projeto) segue Keep a Changelog:

```markdown
# Changelog

## [Unreleased]
### Added
- Nova feature X

### Changed
- Comportamento de Y mudou

### Fixed
- Bug em Z

## [1.5.0] — 2026-09-03
### Added
- ...

[Unreleased]: https://github.com/murillous/LumaBot/commits/main
[1.5.0]: https://github.com/murillous/LumaBot/releases/tag/1.5.0
```

### Seções obrigatórias (em ordem)

| Seção | Conteúdo | Usado para |
|-------|----------|-----------|
| **Added** | Novas features ou funcionalidades | Incremente MINOR ou PATCH (se é small) |
| **Changed** | Mudanças em comportamento existente | Pode ser MINOR (feature enhancement) ou MAJOR (breaking) |
| **Fixed** | Correções de bugs | PATCH (ou MINOR se é uma mudança de comportamento) |
| **Deprecated** | Features que serão removidas em versão futura | Deprecation path (geralmente MINOR) |
| **Removed** | Features ou módulos removidos | MAJOR (breaking) |
| **Security** | Correções de vulnerabilidade | PATCH ou MINOR, conforme severidade |

---

## Workflow de Release

### 1. Desenvolvimento (branch `main` ou feature)

Trabalhe normalmente. Cada PR que entra em `main` é potencial release candidate.

### 2. Preparar a versão

**No fim da sprint ou quando ficar pronto:**

1. **Revise o `CHANGELOG.md`** — confirme que todas as mudanças estão documentadas em `[Unreleased]`
2. **Decida a versão** — usando SemVer, qual é a próxima? (ver tabela acima)
3. **Atualize `CHANGELOG.md`:**
   - Mude `## [Unreleased]` para `## [X.Y.Z] — YYYY-MM-DD`
   - Adicione nova seção `## [Unreleased]` (vazia)
   - Atualize links de comparação no rodapé

```markdown
# Antes
## [Unreleased]

# Depois
## [Unreleased]

## [1.5.0] — 2026-09-03
```

4. **Commit e tag:**
   ```bash
   git add CHANGELOG.md
   git commit -m "chore: release 1.5.0"
   git tag -a v1.5.0 -m "Release 1.5.0"
   git push origin main --follow-tags
   ```

5. **No GitHub:** vá para **Releases**, crie uma release com a tag e copie o conteúdo do CHANGELOG

### 3. Durante o desenvolvimento

- **Toda mudança relevante** entra no `[Unreleased]` do CHANGELOG
- Se adicionar feature → seção `Added`
- Se corrigir bug → seção `Fixed`
- Se mudar comportamento → seção `Changed`
- Se deprecar algo → seção `Deprecated`

---

## Exemplo Real: v1.5.0

**Contexto:** Migração de prompt-blob para pipeline multi-turno + suporte a download de imagens + fixes em citações.

**Decisão de versão:**
- ✅ Novas features (legendas, `getTurns()`, opção `persist`) → Added
- ✅ Mudança arquitetural em systemInstruction → Changed (arquitetura interna, não quebra compatibilidade pública)
- ✅ Vários bugfixes significativos (áudio com citações, contexto de grupo) → Fixed
- ❌ Nenhuma quebra de compatibilidade → não é MAJOR

**→ Versão: 1.5.0 (MINOR)**

---

## Boas Práticas

### ✅ Faça

- Atualize o CHANGELOG no **mesmo PR** que a feature/fix
- Use linguagem clara e orientada ao **usuário final** ("Legendas em stickers agora...", não "refatorei ImageProcessor")
- Agrupe mudanças relacionadas na mesma entrada
- Links e referências a PRs/commits quando relevante
- Inclua ADR (Architecture Decision Record) para decisões arquiteturais significativas

### ❌ Evite

- **Não faça batch release** — a cada sprint, release uma versão. Frequência > perfeição.
- **Não mude CHANGELOG retroativamente** — o histórico é imutável depois do release
- **Não misture bug fix com feature** em um PR se puder separar — versões diferentes
- **Não deixe o `[Unreleased]` crescer indefinidamente** — release a cada 1-2 semanas

---

## Versões Pré-release (Opcional)

Se precisar testar uma versão antes de release:

```bash
git tag v1.5.0-rc1    # Release Candidate
git tag v1.5.0-beta   # Beta
```

No CHANGELOG:
```markdown
## [1.5.0-rc1] — 2026-09-02
```

Não use pré-releases no fluxo normal — são para testes ou deploys de staging.

---

## Retrocompatibilidade e MAJOR Bumps

**Quando marcar como MAJOR (1.x.0 → 2.0.0):**
- Remoção de comando público (ex: `!resume` desaparece)
- Mudança em assinatura de API (se expõe publicamente)
- Mudança em formato de dados persistidos (ex: schema SQLite incompatível)
- Mudança em ambiente (ex: exige Node 20+, era 18+)

**Não é MAJOR:**
- Mudanças internas de arquitetura (`systemInstruction`, refactoring de adapters)
- Adição de parâmetros opcionais em funções
- Melhoria de performance

---

## Links de Referência

- [Versionamento Semântico](https://semver.org/lang/pt-BR/)
- [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/)
- [CHANGELOG.md](../CHANGELOG.md) deste projeto
- [ADRs](./adr/) — decisões arquiteturais por versão
