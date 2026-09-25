/**
 * Who is here, in words: the header names people instead of counting
 * "peers". Names are self-chosen display hints (PROTOCOL.md §3.7), so a
 * member who has not announced one yet is counted, never given a made-up
 * name.
 */
export function peopleLabel(names: readonly (string | undefined)[]): string {
	if (names.length === 0) return 'just you';
	const known = names.filter((n): n is string => !!n?.trim());
	const unnamed = names.length - known.length;
	if (known.length === 0) return unnamed === 1 ? '1 person' : `${unnamed} people`;

	const shown = known.length <= 3 && unnamed === 0 ? known : known.slice(0, 2);
	const rest = names.length - shown.length;
	if (rest === 0) {
		if (shown.length === 1) return shown[0];
		if (shown.length === 2) return `${shown[0]} and ${shown[1]}`;
		return `${shown.slice(0, -1).join(', ')}, and ${shown.at(-1)}`;
	}
	const others = `${rest} other${rest === 1 ? '' : 's'}`;
	return shown.length === 1 ? `${shown[0]} and ${others}` : `${shown.join(', ')}, and ${others}`;
}
