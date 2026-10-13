<template>
  <button type="button" class="rf-btn" :disabled="$disabled" @click="$submit">
    <slot>{{ $label }}</slot>
  </button>
</template>

<script lang="ts">
export default { vrfParent: 'submit' }
</script>
