import type { ArchiveKind } from '../../../shared/types.js';

/**
 * The archive kinds, as a runtime value the server owns.
 *
 * `shared/types.ts` is the contract and stays so — but every other import of it
 * in this package is `import type`, which erases at compile time. This one was
 * the single reason the server needed a file outside its own package to still
 * exist when the code runs, and a value import that crosses a package boundary
 * is exactly the kind of thing that survives bundling and breaks under file
 * tracing, where it becomes a module-not-found at the first request.
 *
 * The two lists cannot drift. The assertions below stop compiling the moment
 * either gains a member the other lacks — which is a build error here rather
 * than a validation that quietly rejects a real kind in production.
 */
export const ARCHIVE_KINDS = ['תצלום', 'מכתב', 'קול', 'מסמך', 'חפץ', 'סיפור'] as const;

type AssertNever<T extends never> = T;

/** Fails to compile if the contract gains a kind this list is missing. */
export type EveryContractKindIsListed = AssertNever<
  Exclude<ArchiveKind, (typeof ARCHIVE_KINDS)[number]>
>;

/** Fails to compile if this list invents a kind the contract does not have. */
export type EveryListedKindIsInTheContract = AssertNever<
  Exclude<(typeof ARCHIVE_KINDS)[number], ArchiveKind>
>;
