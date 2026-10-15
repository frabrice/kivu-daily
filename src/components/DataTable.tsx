import { ReactNode } from 'react';
import { Pager, usePaged } from '../ui/Pager';

export interface DataTableColumn<T> {
  header: string;
  render: (row: T) => ReactNode;
  className?: string;
}

interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  keyFn: (row: T) => string;
  emptyLabel?: string;
  onRowClick?: (row: T) => void;
  // Rows per page (25 by default; the reader can switch to 50 or 100). `pageKey` remembers their choice.
  pageKey?: string;
  noun?: string;
}

export default function DataTable<T>({ columns, rows: allRows, keyFn, emptyLabel = 'Nothing here yet.', onRowClick, pageKey, noun }: DataTableProps<T>) {
  const { rows, pager } = usePaged(allRows, { key: pageKey });
  if (allRows.length === 0) {
    return (
      <div className="card p-10 text-center">
        <p className="text-small text-fg-subtle">{emptyLabel}</p>
      </div>
    );
  }

  return (
    <div>
    <div className="card overflow-x-auto p-0">
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="border-b border-line-muted ">
            {columns.map((col, i) => (
              <th key={i} className={`text-micro font-semibold uppercase tracking-wide text-fg-subtle px-3.5 py-2.5 whitespace-nowrap ${col.className ?? ''}`}>
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={keyFn(row)}
              onClick={() => onRowClick?.(row)}
              className={`border-b border-line-muted last:border-0 ${onRowClick ? 'cursor-pointer hover:bg-hover ' : ''} transition-colors`}
            >
              {columns.map((col, i) => (
                <td key={i} className={`px-3.5 py-2.5 text-caption align-middle whitespace-nowrap ${col.className ?? ''}`}>
                  {col.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    <Pager pager={pager} noun={noun} />
    </div>
  );
}
