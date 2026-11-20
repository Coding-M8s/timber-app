// The message of a thrown value, for showing to the person or writing to a log.
export function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
