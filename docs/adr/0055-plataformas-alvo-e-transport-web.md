# ADR 0055 — Plataformas-alvo e um transport fora do WhatsApp antes do 1.0

**Status:** Aceito (2026-10-09) · Substitui o trecho "só Baileys na v1" do
[ADR 0003](0003-transport-abstrato.md) · Detalha **D29** ([ADR 0029](0029-open-core-repo-privado.md))
para a licença dos transports novos

## Contexto

O plano nasceu para o WhatsApp. O D03 entrega só o `@zapforge/transport-baileys` na v1 e deixa os
outros transports para depois, todos de WhatsApp (Cloud API, Twilio e Zenvia) e comerciais, no
repo privado do D29. O próprio ADR 0003 registra o risco de a interface ficar com o formato do
Baileys.

Na sessão de 2026-10-08 com o dono do repositório, o alvo do kernel passou a ser **WhatsApp,
Discord, Telegram e sistemas web próprios**: um chatbot dentro do ERP e do sistema de gestão
escolar do dono, para consultar o próprio sistema. A revisão feita na mesma data (código do core,
plano, ADRs 0001–0053 e issues abertas) achou mais de 20 pontos do contrato com formato de
WhatsApp: owners por telefone, prefixo único e não vazio, nenhum modelo de botão nem de conversa,
`group-admin` dependente da lista completa de participantes, `clean-session` em loop para
transport autenticado por token, entre outros (#267–#284).

Depois do 1.0, o D27 obriga um ciclo de `@deprecated` de pelo menos um minor para cada correção da
API pública. Sem um segundo transport antes disso, nenhum desses pontos é testado contra outra
plataforma antes de a API congelar.

Alternativas consideradas:

- **Manter o D03 e corrigir depois do 1.0.** Cada correção vira um ciclo de `@deprecated`, e os
  plugins da comunidade já estariam escritos sobre o formato do WhatsApp.
- **Um segundo transport de WhatsApp antes do 1.0 (Cloud API).** Não testa remetente sem
  telefone, botões, prefixo por tipo de chat nem autenticação por token. Além disso, é comercial
  e fica no repo privado.
- **Telegram ou Discord antes do 1.0.** Testam o contrato contra uma plataforma real, mas
  dependem de API externa, de conta de bot e de limites da plataforma no CI, e atrasam o 1.0. Não
  são o caso de negócio principal.
- **Vários transports num mesmo `Bot`.** Quebra o ADR 0004 e mistura no core a escolha de por
  onde responder. Vários `Bot`s no mesmo processo já atendem quem precisa de mais de uma
  plataforma.

## Decisão

- **Plataformas-alvo:** WhatsApp, Discord, Telegram e sistemas web próprios. O core não conhece
  nenhuma delas: o que é de uma plataforma fica no transport, e o core só conhece o contrato. O
  `Transport` abstrato do D03 continua valendo (interface, capabilities, o core não importa
  transport concreto).
- **Um transport por `Bot`**, como no ADR 0004. Quem atende mais de uma plataforma sobe um `Bot`
  por transport, no mesmo processo e com o mesmo storage. O escopo dos dados entre esses bots fica
  para o ADR do tema E (#279).
- **Contrato neutro validado antes do 1.0.** Um `@zapforge/transport-web` mínimo entra no M3,
  junto com o HTTP do core (#120), e valida o contrato (#287). O release 1.0 (#155) só sai depois
  que um plugin portátil roda sem mudança no Baileys e no web.
- **O web é o segundo transport** porque o dono controla as duas pontas (widget e servidor). Ele
  roda no CI sem conta externa e é o caso de negócio principal. Também exercita a maior parte do
  contrato novo: identidade por claims, tenant, botões, conversa guiada e prefixo vazio.
- **Telegram (#288) e Discord (#289) vêm depois do v1.0.** O que eles pedirem de novo no contrato
  entra como mudança aditiva (campo opcional, capability ou evento novos), como manda o D27.
- **Licença:** os transports Discord, Telegram e web são **públicos**, Apache-2.0 (D28), neste
  monorepo, em `packages/transport-*`. O repo privado do D29 fica com os transports comerciais de
  WhatsApp (Cloud API, Twilio e Zenvia), o dashboard multi-número e as integrações com os
  sistemas do dono (ERP e gestão escolar). Essas integrações são plugins que consomem a API
  pública, inclusive a do `transport-web`.
- **Os pontos com formato de WhatsApp** se resolvem antes do 1.0, em ADRs por tema, não um por
  issue: B (identidade, chat e grupos), C (interação), D (conteúdo), E (escopo de dados) e F
  (conexão e envio). Ordem: B, depois C; D, E e F em paralelo depois de B.

## Consequências

- O M3 cresce com o `transport-web`, que depende das rotas de transport no HTTP do core (#120) e
  dos ADRs B, C e E. O 1.0 espera por ele.
- Os ADRs B a F podem quebrar a API pública. A quebra cabe no `0.x` e fica registrada no
  changeset de cada pacote. Depois do 1.0, não cabe mais.
- O web não testa limite de taxa de plataforma nem token de bot revogado. Esses casos entram no
  contrato pelo ADR do tema F, a partir da documentação do Telegram e do Discord. O transport
  deles, quando chegar, só confirma.
- O monorepo passa a manter três transports públicos a mais, com CI e docs próprios. O custo é
  aceito porque são eles que provam o contrato.
- As docs do core perdem o enquadramento de WhatsApp (#286). O exemplo de cada conceito usa o
  vocabulário neutro do contrato, e o que é de uma plataforma vai para a doc do transport.
- O nome "ZapForge" e o público inicial ficam numa decisão à parte (#290).
