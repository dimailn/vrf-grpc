<template>
  <label class="rf-check">
    <input
      type="checkbox"
      :checked="$value"
      :disabled="$disabled"
      @change="$value = ($event.target as HTMLInputElement).checked"
    />
    <span v-if="$label">{{ $label }}</span>
  </label>
</template>

<script lang="ts">
export default { vrfParent: 'checkbox' }
</script>
