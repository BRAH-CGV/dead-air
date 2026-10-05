// ─────────────────────────────────────────────
// PhysicsLayers  –  named collision group bits + Rapier pack helper
// ─────────────────────────────────────────────
// Rapier's collision groups are a 32-bit value: the high 16 bits are the
// membership mask (what groups this collider IS part of) and the low 16 bits
// are the filter mask (what groups this collider can INTERACT with).
//
// Two colliders A and B interact only when:
//   (A.membership & B.filter) !== 0  AND  (B.membership & A.filter) !== 0
//
// We expose named layer constants (bit indices 0–15) so manifest authors and
// engine code write readable names instead of raw bit shifts. The pack helper
// converts arrays of layer names into the 32-bit value Rapier expects.
//
// ── Default behaviour ──
// Omitting `groups` from a manifest entry gives DEFAULT_GROUPS (member of all,
// filters all) — identical to Rapier's own default, so existing assets keep
// working without a change.
// ─────────────────────────────────────────────

/**
 * Named layer bit indices. Add new layers here; the bit position is the value.
 * 16 layers available (bits 0–15).
 */
export const Layers = Object.freeze({
  /** Everything — the default layer all colliders belong to unless overridden. */
  DEFAULT:    0,
  /** The player character's capsule(s). */
  PLAYER:     1,
  /** Shelf-level collision boards — player walks through, items rest on them. */
  SHELF:      2,
});

/**
 * The default collision groups: member of ALL groups, interacts with ALL groups.
 * This is Rapier's own default (0xFFFFFFFF) and what every collider gets when
 * no `groups` field is specified in the manifest.
 */
export const DEFAULT_GROUPS = 0xFFFFFFFF;

/**
 * Pack arrays of layer names (or bit indices) into Rapier's 32-bit format.
 *
 * @param {(string|number)[]} membership  Layers this collider IS part of.
 * @param {(string|number)[]} filter      Layers this collider can INTERACT with.
 * @returns {number}  The packed 32-bit collision group value.
 *
 * @example
 *   // Member of DEFAULT + SHELF, interacts with DEFAULT only
 *   packGroups(['DEFAULT', 'SHELF'], ['DEFAULT'])
 *   // → 0x00050001
 */
export function packGroups(membership, filter) {
  let mem = 0;
  let flt = 0;
  for (const layer of membership) {
    const bit = typeof layer === 'string' ? Layers[layer] : layer;
    if (bit === undefined || bit === null) continue;
    mem |= (1 << bit);
  }
  for (const layer of filter) {
    const bit = typeof layer === 'string' ? Layers[layer] : layer;
    if (bit === undefined || bit === null) continue;
    flt |= (1 << bit);
  }
  return ((mem & 0xFFFF) << 16) | (flt & 0xFFFF);
}

/**
 * Resolve a manifest `groups` field into a packed 32-bit value.
 * Accepts either:
 *   - A packed number (passed through), or
 *   - An object `{ membership: string[], filter: string[] }`
 *
 * Returns DEFAULT_GROUPS when the input is null/undefined (backward compat).
 *
 * @param {number|{membership:(string|number)[], filter:(string|number)[]}|null|undefined} groups
 * @returns {number}
 */
export function resolveGroups(groups) {
  if (groups == null) return DEFAULT_GROUPS;
  if (typeof groups === 'number') return groups;
  return packGroups(groups.membership ?? [], groups.filter ?? []);
}
