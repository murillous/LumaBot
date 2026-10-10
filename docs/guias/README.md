# Guias do autor de plugin

Como escrever um plugin do ZapForge sem ler o código interno do kernel. Comece pelo primeiro
plugin; os outros guias vão por assunto e apontam para a documentação de cada módulo do core
quando o detalhe importa.

| Guia | Assunto | Issue |
| --- | --- | --- |
| [Seu primeiro plugin em 5 minutos](primeiro-plugin.md) | Do `create-zapforge-plugin` ao plugin respondendo no bot | #123 |
| [Comandos](comandos.md) | `command()`, args, aliases, `role` e respostas | #124 |
| [Eventos e mídia](eventos-e-midia.md) | Reagir a eventos e ler ou enviar mídia | #124 |
| [Storage](storage.md) | KV e coleções do plugin | #124 |
| [Config](config.md) | Schema Zod, segredos, mensagens e reload | #124 |
| [Services](services.md) | Oferecer e consumir services entre plugins | #124 |
| [Scheduler](scheduler.md) | Tarefas agendadas que sobrevivem a restart | #124 |
| [Capabilities](capabilities.md) | O que cada transport suporta, com matriz por transport | #124 |
| [Portabilidade entre plataformas](portabilidade.md) | Formatação neutra, IDs e owners, botões, resposta esperada, tenant | #124 |
| [Escape hatch](escape-hatch.md) | Objeto bruto da mensagem e do transport | #124 |
| [Testes](testes.md) | `@zapforge/testing` e os perfis de transport | #124 |

## Outras referências

- **Referência da API**: gerada pelo TypeDoc em `docs/referencia/` (#125).
- **Documentação do core** (como cada módulo funciona): [`packages/core/docs/`](../../packages/core/docs/README.md) (#126).
- **O porquê das decisões**: [ADRs](../adr/README.md).
