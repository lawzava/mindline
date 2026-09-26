<script lang="ts">
	import * as Popover from '$lib/components/ui/popover';
	import { reading, type TextSize } from '$lib/stores/reading';
	import { prefersReducedMotion } from 'svelte/motion';
	import { cn } from '$lib/utils';

	// The Reading entry point: an RTT reading mode for people who read the
	// wire instead of hearing a call. Plain words on the trigger ("Aa" is
	// the universal text-settings glyph), no iconography to decode.

	interface Props {
		/** Room header: the glyph alone, the label stays for assistive tech. */
		compact?: boolean;
		class?: string;
	}

	let { compact = false, class: className }: Props = $props();

	const sizes: { value: TextSize; label: string }[] = [
		{ value: 'default', label: 'Default' },
		{ value: 'large', label: 'Large' },
		{ value: 'xlarge', label: 'Extra large' }
	];

	// Reduced motion already stills every draft animation (app.css), so the
	// steady toggle shows as on and locked rather than as a lie.
	const motionLocked = $derived(prefersReducedMotion.current);
	const uid = $props.id();
</script>

<!-- A row is one label (whole row is the hit target); the hint is its
     description, not part of its name. -->
{#snippet toggle(
	key: string,
	label: string,
	hint: string,
	checked: boolean,
	onToggle: (on: boolean) => void,
	disabled = false
)}
	<label
		class={cn(
			'flex items-start gap-3 rounded-md px-2 py-2',
			disabled ? 'cursor-default' : 'cursor-pointer hover:bg-accent'
		)}
	>
		<span class="flex min-w-0 flex-1 flex-col gap-0.5">
			<span class="text-sm">{label}</span>
			<span id={`${uid}-${key}`} class="text-xs text-muted-foreground" aria-hidden="true"
				>{hint}</span
			>
		</span>
		<input
			type="checkbox"
			{checked}
			{disabled}
			onchange={(e) => onToggle(e.currentTarget.checked)}
			aria-describedby={`${uid}-${key}`}
			class="mt-0.5 size-4 shrink-0 accent-foreground"
			data-testid={`reading-${key}`}
		/>
	</label>
{/snippet}

<Popover.Root>
	<Popover.Trigger
		class={cn(
			'inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-md px-2.5 text-sm font-medium text-muted-foreground outline-ring/50 hover:bg-accent hover:text-foreground',
			compact && 'h-11 w-11 px-0',
			className
		)}
		title="Reading settings"
		data-testid="reading-settings-btn"
	>
		<span class="text-[0.9375rem] font-semibold leading-none tracking-tight" aria-hidden="true"
			>Aa</span
		>
		<span class={compact ? 'sr-only' : ''}>Reading</span>
	</Popover.Trigger>
	<Popover.Content class="w-72 p-3" side="bottom" align="end" data-testid="reading-settings">
		<div class="space-y-3">
			<fieldset class="space-y-1.5">
				<legend class="mb-1.5 text-xs font-medium text-muted-foreground">Text size</legend>
				<div class="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1">
					{#each sizes as size (size.value)}
						<label
							class="flex min-h-9 cursor-pointer items-center justify-center rounded-md px-1 text-center text-sm leading-tight text-muted-foreground has-[:checked]:bg-background has-[:checked]:font-medium has-[:checked]:text-foreground has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50"
						>
							<input
								type="radio"
								name={`${uid}-size`}
								value={size.value}
								checked={$reading.textSize === size.value}
								onchange={() => reading.change({ textSize: size.value })}
								class="sr-only"
								data-testid={`reading-size-${size.value}`}
							/>
							{size.label}
						</label>
					{/each}
				</div>
			</fieldset>

			<div class="space-y-0.5 border-t border-border pt-2">
				{@render toggle(
					'contrast',
					'High contrast',
					'Stronger text in both themes.',
					$reading.highContrast,
					(on) => reading.change({ highContrast: on })
				)}
				{@render toggle(
					'steady',
					'Show drafts steadily',
					motionLocked
						? 'On, because your device reduces motion.'
						: 'Forming text never pulses or dims.',
					motionLocked || $reading.steadyDrafts,
					(on) => reading.change({ steadyDrafts: on }),
					motionLocked
				)}
				{@render toggle(
					'aloud',
					'Read drafts aloud',
					"Screen readers speak the other person's words as they form, a phrase at a time.",
					$reading.readDraftsAloud,
					(on) => reading.change({ readDraftsAloud: on })
				)}
			</div>
		</div>
	</Popover.Content>
</Popover.Root>
