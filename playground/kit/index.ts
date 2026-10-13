import RfInput from './RfInput.vue'
import RfCheckbox from './RfCheckbox.vue'
import RfSubmit from './RfSubmit.vue'

// A minimal vrf UI-kit, registered via the `adapters` option. Each component
// extends a core vrf descriptor (named by `vrfParent`) and only supplies markup.
export default {
  name: 'vrf-kit',
  components: {
    RfInput,
    RfCheckbox,
    RfSubmit,
  },
}
