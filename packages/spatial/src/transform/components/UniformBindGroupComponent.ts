import { defineComponent, S } from '@ir-engine/ecs'

export const UniformBindGroupComponent = defineComponent({
  name: 'UniformBindGroupComponent',

  schema: S.Object({
    bindGroup: S.Type<GPUBindGroup>(),
    offset: S.Number(0)
  })
})
