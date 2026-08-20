import { getOwnership, setOwnership } from '../store/ownershipStore.js';

export { setOwnership };

export function canManageService({ serviceType, serviceId, userId, isAdmin = false, roleIds = [] } = {}) {
  if (isAdmin === true) return true;
  if (typeof userId !== 'string' || !/^\d{17,20}$/.test(userId)) return false;
  if (!Array.isArray(roleIds)) return false;
  const ownership = getOwnership({ serviceType, serviceId });
  if (!ownership) return false;
  return roleIds.some((roleId) => String(roleId) === ownership.role_id);
}

export function interactionCanManageService(interaction, target) {
  return canManageService({
    serviceType: target?.serviceType,
    serviceId: target?.serviceId,
    userId: interaction?.user?.id,
    isAdmin: interaction?.user?.id === interaction?.client?.config?.adminUserId,
    roleIds: interaction?.member?.roles?.cache ? [...interaction.member.roles.cache.keys()] : [],
  });
}
