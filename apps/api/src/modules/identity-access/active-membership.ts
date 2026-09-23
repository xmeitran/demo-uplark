// Membership/grant intervals are inclusive at startsAt and exclusive at endsAt.
export function activeMembershipWhere(now = new Date()) {
  return { startsAt: { lte: now }, OR: [{ endsAt: null }, { endsAt: { gt: now } }] };
}
export function isActiveMembership(binding: { startsAt: Date; endsAt: Date | null }, now = new Date()) {
  return binding.startsAt <= now && (!binding.endsAt || binding.endsAt > now);
}
