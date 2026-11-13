import type { RowLook } from './search-picker';

/**
 * What a row is called to assistive technology: its name, what tells it from its namesakes, the
 * place it belongs to where one list holds rows of both maps, and its note. Which map such a row is
 * on is otherwise shown by its ink and said by its group's label, and neither is sure to be read out
 * with the row.
 */
export function accessibleRowName({ name, context, sheet, note }: RowLook): string {
  return [name, context, sheet && `in ${sheet.place}`, note].filter(Boolean).join(', ');
}
