<script lang="ts">
	import * as Popover from '$lib/components/ui/popover';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import { Button } from '$lib/components/ui/button';
	import { MoreHorizontal, Pencil, Trash2 } from 'lucide-svelte';
	import { cn } from '$lib/utils';

	interface Props {
		isMe: boolean;
		isDeleted: boolean;
		isEditing: boolean;
		open: boolean;
		showTrigger?: boolean;
		onOpenChange?: (open: boolean) => void;
		onEdit?: () => void;
		onDelete?: () => void;
		onReaction?: (emoji: string) => void;
	}

	let {
		isMe,
		isDeleted,
		isEditing,
		open = $bindable(false),
		showTrigger = false,
		onOpenChange,
		onEdit,
		onDelete,
		onReaction
	}: Props = $props();

	let showDeleteConfirm = $state(false);

	// Edit/delete belong to your own messages only.
	const showActions = $derived(isMe && !isDeleted && !isEditing);

	const emojis = ['👍', '❤️', '😂', '😮', '😢', '👏', '🔥', '🎉'];

	function handleEdit() {
		onEdit?.();
		open = false;
		onOpenChange?.(false);
	}

	function handleDeleteClick() {
		showDeleteConfirm = true;
	}

	function confirmDelete() {
		onDelete?.();
		showDeleteConfirm = false;
		open = false;
		onOpenChange?.(false);
	}

	function cancelDelete() {
		showDeleteConfirm = false;
	}

	function handleReaction(emoji: string) {
		onReaction?.(emoji);
		open = false;
		onOpenChange?.(false);
	}

	function handleOpenChange(isOpen: boolean) {
		open = isOpen;
		onOpenChange?.(isOpen);
	}
</script>

<Popover.Root bind:open onOpenChange={handleOpenChange}>
	<Popover.Trigger
		class={showTrigger
			? 'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground outline-ring/50 hover:bg-accent focus-visible:ring-2'
			: 'hidden'}
	>
		<MoreHorizontal class="h-4 w-4" />
		<span class="sr-only">Message actions</span>
	</Popover.Trigger>

	<!-- collisionPadding keeps the popover off the screen edge on phones. -->
	<Popover.Content
		class="w-auto p-2"
		side="top"
		align={isMe ? 'end' : 'start'}
		collisionPadding={8}
	>
		<div class="flex flex-col gap-2">
			<!-- Emoji reactions row; the divider only separates it from actions
			     that actually follow (peer messages have none). -->
			{#if !isDeleted && !isEditing}
				<div class={cn('flex gap-1', showActions && 'border-b border-border pb-2')}>
					{#each emojis as emoji (emoji)}
						<button
							onclick={() => handleReaction(emoji)}
							aria-label={`React with ${emoji}`}
							class="flex h-8 w-8 items-center justify-center rounded text-lg transition-colors hover:bg-muted"
						>
							{emoji}
						</button>
					{/each}
				</div>
			{/if}

			<!-- Actions row (only for own messages) -->
			{#if showActions}
				<div class="flex gap-2">
					{#if onEdit}
						<Button variant="ghost" size="sm" onclick={handleEdit} class="gap-2">
							<Pencil class="h-4 w-4" />
							Edit
						</Button>
					{/if}
					<Button
						variant="ghost"
						size="sm"
						onclick={handleDeleteClick}
						class="gap-2 text-destructive hover:text-destructive"
					>
						<Trash2 class="h-4 w-4" />
						Delete
					</Button>
				</div>
			{/if}
		</div>
	</Popover.Content>
</Popover.Root>

<!-- Delete confirmation dialog -->
<AlertDialog.Root bind:open={showDeleteConfirm}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Delete message?</AlertDialog.Title>
			<AlertDialog.Description>
				This action cannot be undone. The message will be marked as deleted for all participants.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel onclick={cancelDelete}>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action
				onclick={confirmDelete}
				class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
			>
				Delete
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
