<script lang="ts">
	import { encodeQr, qrPath } from '$lib/qr';
	import { cn } from '$lib/utils';

	interface Props {
		/** The full invite URL, key fragment included (or any text to show). */
		value: string;
		/** Names the code for screen readers, never its contents. */
		label?: string;
		testid?: string;
		class?: string;
	}

	let {
		value,
		label = 'QR code of the invite link',
		testid = 'invite-qr',
		class: className
	}: Props = $props();

	const qr = $derived(encodeQr(value));
	const path = $derived(qrPath(qr.modules));
</script>

<!--
	Inline SVG: no img-src, no canvas, nothing leaves the page. Colors are
	pinned instead of themed: scanners expect dark modules on a light field,
	so the code stays paper-light in dark mode too. The label names the
	code, never its contents (the URL is the key).
-->
<svg
	viewBox="0 0 {qr.size} {qr.size}"
	role="img"
	aria-label={label}
	shape-rendering="crispEdges"
	class={cn('block aspect-square w-60 max-w-full rounded-md', className)}
	data-testid={testid}
>
	<rect width={qr.size} height={qr.size} class="fill-[oklch(0.995_0.002_262)]" />
	<path d={path} class="fill-[oklch(0.215_0.015_262)]" />
</svg>
