import { ReactNode } from 'react';

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
}

export default function DataTable<T>({ columns, rows, keyFn, emptyLabel = 'Nothing here yet.', onRowClick }: DataTableProps<T>) {
  if (rows.length === 0) {
    return (
      <div className="card p-10 text-center">
        <p className="text-[13px] text-gray-400">{emptyLabel}</p>
      </div>
    );
  }

  return (
    <div className="card overflow-x-auto p-0">
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="border-b border-gray-100 dark:border-white/5">
            {columns.map((col, i) => (
              <th key={i} className={`text-[10px] font-semibold uppercase tracking-wide text-gray-400 px-3.5 py-2.5 whitespace-nowrap ${col.className ?? ''}`}>
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
              className={`border-b border-gray-50 dark:border-white/5 last:border-0 ${onRowClick ? 'cursor-pointer hover:bg-gray-50 dark:hover:bg-white/5' : ''} transition-colors`}
            >
              {columns.map((col, i) => (
                <td key={i} className={`px-3.5 py-2.5 text-[12px] align-middle whitespace-nowrap ${col.className ?? ''}`}>
                  {col.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
