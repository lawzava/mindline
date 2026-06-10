<script lang="ts">
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import { Button } from '$lib/components/ui/button';
	import { MoreHorizontal, Pencil, Trash2 } from 'lucide-svelte';

	interface Props {
		onEdit: () => void;
		onDelete: () => void;
	}

	let { onEdit, onDelete }: Props = $props();
	let showDeleteConfirm = $state(false);
</script>

<DropdownMenu.Root>
	<DropdownMenu.Trigger>
		{#snippet child({ props })}
			<Button
				{...props}
				variant="ghost"
				size="icon"
				class="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
			>
				<MoreHorizontal class="h-4 w-4" />
				<span class="sr-only">Message options</span>
			</Button>
		{/snippet}
	</DropdownMenu.Trigger>
	<DropdownMenu.Content align="end" class="w-40">
		<DropdownMenu.Item onclick={onEdit} class="gap-2 cursor-pointer">
			<Pencil class="h-4 w-4" />
			<span>Edit</span>
		</DropdownMenu.Item>
		<DropdownMenu.Separator />
		<DropdownMenu.Item onclick={() => (showDeleteConfirm = true)} class="gap-2 text-destructive focus:text-destructive cursor-pointer">
			<Trash2 class="h-4 w-4" />
			<span>Delete</span>
		</DropdownMenu.Item>
	</DropdownMenu.Content>
</DropdownMenu.Root>

<AlertDialog.Root bind:open={showDeleteConfirm}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Delete message?</AlertDialog.Title>
			<AlertDialog.Description>
				This action cannot be undone. The message will be marked as deleted for all participants.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action onclick={onDelete} class="bg-destructive text-destructive-foreground hover:bg-destructive/90">
				Delete
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
