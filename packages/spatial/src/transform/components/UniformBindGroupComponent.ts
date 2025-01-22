/*
CPAL-1.0 License

The contents of this file are subject to the Common Public Attribution License
Version 1.0. (the "License"); you may not use this file except in compliance
with the License. You may obtain a copy of the License at
https://github.com/ir-engine/ir-engine/blob/dev/LICENSE.
The License is based on the Mozilla Public License Version 1.1, but Sections 14
and 15 have been added to cover use of software over a computer network and 
provide for limited attribution for the Original Developer. In addition, 
Exhibit A has been modified to be consistent with Exhibit B.

Software distributed under the License is distributed on an "AS IS" basis,
WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License for the
specific language governing rights and limitations under the License.

The Original Code is Infinite Reality Engine.

The Original Developer is the Initial Developer. The Initial Developer of the
Original Code is the Infinite Reality Engine team.

All portions of the code written by the Infinite Reality Engine team are Copyright © 2021-2023 
Infinite Reality Engine. All Rights Reserved.
*/

import { defineComponent, getComponent, S, setComponent } from '@ir-engine/ecs'
import { getState } from '@ir-engine/hyperflux'
import { ReferenceSpaceState } from '../../ReferenceSpaceState'
import { WgpuRendererComponent } from '../../renderer/WebGPURendererSystem'

export const WgpuMeshComponent = defineComponent({
  name: 'WgpuMeshComponent',

  schema: S.Object({
    vertexArray: S.Type<Float32Array>(),
    vertexCount: S.Number(0)
  }),

  /*@todo: These components should go on entities in a rendering layer
mapped to their source entities */
  onSet: (entity, component, args: { vertexArray: Float32Array; vertexCount: number }) => {
    component.vertexArray.set(args.vertexArray)
    component.vertexCount.set(args.vertexCount)
    const viewer = getState(ReferenceSpaceState).viewerEntity
    const renderer = getComponent(viewer, WgpuRendererComponent)
    const meshComponent = getComponent(entity, WgpuMeshComponent)
    const vertexArray = meshComponent.vertexArray
    const vertexCount = meshComponent.vertexCount

    const device = renderer.device!
    setComponent(entity, VertexBufferComponent, {
      buffer: device.createBuffer({
        size: vertexArray.byteLength,
        usage: GPUBufferUsage.VERTEX,
        mappedAtCreation: true
      }),
      vertexLength: vertexCount
    })
    const vertexBuffer = getComponent(entity, VertexBufferComponent).buffer
    new Float32Array(vertexBuffer.getMappedRange()).set(vertexArray)

    vertexBuffer.unmap()

    setComponent(
      entity,
      UniformBufferComponent,
      device.createBuffer({
        size: 2048,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
      })
    )
    setComponent(entity, UniformBindGroupComponent, {
      bindGroup: device.createBindGroup({
        layout: renderer.pipeline!.getBindGroupLayout(0),
        entries: [
          {
            binding: 0,
            resource: {
              buffer: getComponent(entity, UniformBufferComponent)
            }
          }
        ]
      }),
      offset: 0
    })
  },

  onRemove: (entity, component) => {
    const vertexBuffer = getComponent(entity, VertexBufferComponent).buffer
    vertexBuffer.destroy()
    const uniformBuffer = getComponent(entity, UniformBufferComponent)
    uniformBuffer.destroy()
  }
})

/*@todo: These components should go on entities in a rendering layer
mapped to their source entities */
export const UniformBindGroupComponent = defineComponent({
  name: 'UniformBindGroupComponent',

  schema: S.Object({
    bindGroup: S.Type<GPUBindGroup>(),
    offset: S.Number(0)
  })
})

export const VertexBufferComponent = defineComponent({
  name: 'VertexBufferComponent',

  schema: S.Object({
    buffer: S.Type<GPUBuffer>(),
    vertexLength: S.Number(0)
  })
})

export const UniformBufferComponent = defineComponent({
  name: 'UniformBufferComponent',

  schema: S.Type<GPUBuffer>()
})
