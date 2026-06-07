/**
 * Whether a {@link CustomCategory} buckets income or expense operations. The
 * operation's signed amount already conveys direction; this is the category's
 * declared intent, used by the frontend to filter/group categories.
 */
export enum CategorySign {
  Income = 'INCOME',
  Expense = 'EXPENSE',
}
