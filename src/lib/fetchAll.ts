// The database returns at most 1,000 rows per request. fetchAll() keeps
// asking for the next 1,000 until everything is in, and answers in the
// same { data, error } shape as a single request - so lists never stop
// silently at row 1,000 as the company grows. The query should be ordered
// (so pages don't overlap).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function fetchAll<T = any>(make: () => any): Promise<{ data: T[] | null; error: { message: string } | null }> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await make().range(from, from + 999);
    if (error) return { data: from ? out : null, error };
    out.push(...((data as T[]) ?? []));
    if (!data || data.length < 1000) break;
  }
  return { data: out, error: null };
}
