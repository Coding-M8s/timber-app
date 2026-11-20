/**
 * The entries of `record` that `keep` keeps. The same record comes back when
 * every entry is kept, so a caller can tell that nothing changed.
 */
export function keepEntries<Value>(record: Readonly<Record<string, Value>>, keep: (key: string, value: Value) => boolean): Readonly<Record<string, Value>> {
	const kept = Object.entries(record).filter(([key, value]) => keep(key, value));
	return kept.length === Object.keys(record).length ? record : Object.fromEntries(kept);
}
