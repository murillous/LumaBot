// `ctx.groups` (ADR 0040): leitura dos metadados direto no transport; alteração de participantes
// é tráfego e passa pela fila de saída, como as ações de `ctx.send`.

import type { EnqueueAction } from '#outbound/actions.ts';
import type { ActionOptions } from '#outbound/types.ts';
import { assertCapability, groupActionCapability } from '#transport/capabilities.ts';
import type { GroupMetadata, GroupParticipantAction, Transport } from '#transport/types.ts';

export interface Groups {
  /**
   * Nome, descrição e participantes do grupo (capability `groups`). `participants` fica ausente
   * onde a plataforma não lista membros (ADR 0059). Sem cache: cada chamada consulta o transport.
   */
  metadata(groupId: string): Promise<GroupMetadata>;
  /**
   * Adiciona, remove, promove ou rebaixa participantes, pela fila de saída. Cada ação exige a
   * sua capability: `groups.add`, `groups.remove` ou `groups.promote` (que vale também para
   * `demote`); o bot precisa ser admin do grupo.
   */
  updateParticipants(
    groupId: string,
    participantIds: readonly string[],
    action: GroupParticipantAction,
    options?: ActionOptions,
  ): Promise<void>;
}

export function createGroups(
  transport: Pick<
    Transport,
    'name' | 'capabilities' | 'getGroupMetadata' | 'updateGroupParticipants'
  >,
  action: EnqueueAction,
): Groups {
  return {
    async metadata(groupId) {
      assertCapability(transport, 'groups');
      return transport.getGroupMetadata(groupId);
    },
    updateParticipants: (groupId, participantIds, change, options) =>
      action(
        groupActionCapability(change),
        groupId,
        () => transport.updateGroupParticipants(groupId, participantIds, change),
        options,
      ),
  };
}
