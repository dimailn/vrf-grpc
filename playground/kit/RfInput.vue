<template>
  <div class="rf-field" :class="{ 'rf-field--error': $firstError }">
    <label v-if="$label" class="rf-label">{{ $label }}</label>
    <input
      class="rf-control"
      :type="$type"
      :name="name"
      :placeholder="placeholder"
      :disabled="$disabled"
      :readonly="$readonly"
      :value="$value"
      @input="$value = ($event.target as HTMLInputElement).value"
      @blur="onBlur"
      @change="onChange"
      @keyup.enter="submit"
    />
    <span v-if="$firstError" class="rf-error">{{ $firstError }}</span>
  </div>
</template>

<script lang="ts">
// A vrf UI-kit component: it declares which core descriptor to extend via
// `vrfParent`; the installer wires in $value / $label / $firstError etc.
export default { vrfParent: 'input' }
</script>
