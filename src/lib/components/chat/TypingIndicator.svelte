<script lang="ts">
	/**
	 * Animated typing indicator dots
	 */
</script>

<span class="inline-flex items-center gap-1">
	<span class="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.3s]"></span>
	<span class="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.15s]"></span>
	<span class="h-1.5 w-1.5 animate-bounce rounded-full bg-current"></span>
</span>

<style>
	@keyframes bounce {
		0%, 60%, 100% {
			transform: translateY(0);
		}
		30% {
			transform: translateY(-4px);
		}
	}
</style>
