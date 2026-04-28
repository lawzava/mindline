<script lang="ts" module>
	import { type VariantProps, tv } from "tailwind-variants";

	export const badgeVariants = tv({
		base: "focus-visible:border-live focus-visible:ring-live/30 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap transition-[color,box-shadow] focus-visible:ring-[3px] [&>svg]:pointer-events-none [&>svg]:size-3",
		variants: {
			variant: {
				default:
					"border-transparent bg-live text-live-foreground shadow-xs shadow-live/15 [a&]:hover:bg-live/90",
				secondary:
					"border-transparent bg-local text-local-foreground shadow-xs shadow-local/15 [a&]:hover:bg-local/90",
				destructive:
					"border-transparent bg-destructive text-destructive-foreground shadow-xs shadow-destructive/15 [a&]:hover:bg-destructive/90 focus-visible:border-destructive focus-visible:ring-destructive/25 dark:focus-visible:ring-destructive/35",
				outline:
					"border-border bg-surface-quiet text-foreground [a&]:hover:border-live/45 [a&]:hover:bg-surface-warm [a&]:hover:text-accent-foreground",
			},
		},
		defaultVariants: {
			variant: "default",
		},
	});

	export type BadgeVariant = VariantProps<typeof badgeVariants>["variant"];
</script>

<script lang="ts">
	import type { HTMLAnchorAttributes } from "svelte/elements";
	import { cn, type WithElementRef } from "$lib/utils.js";

	let {
		ref = $bindable(null),
		href,
		class: className,
		variant = "default",
		children,
		...restProps
	}: WithElementRef<HTMLAnchorAttributes> & {
		variant?: BadgeVariant;
	} = $props();
</script>

<svelte:element
	this={href ? "a" : "span"}
	bind:this={ref}
	data-slot="badge"
	{href}
	class={cn(badgeVariants({ variant }), className)}
	{...restProps}
>
	{@render children?.()}
</svelte:element>
