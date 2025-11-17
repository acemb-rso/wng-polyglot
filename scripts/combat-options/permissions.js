export function isActivePrimaryGM() {
  if (!game?.user?.isGM) return false;
  const activeGM = game.users?.activeGM;
  if (!activeGM) return true;
  return activeGM.id === game.user.id;
}
