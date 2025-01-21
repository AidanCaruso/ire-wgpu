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

import { useEffect, useLayoutEffect } from 'react'

import {
  defineComponent,
  getComponent,
  setComponent,
  useComponent,
  useOptionalComponent
} from '@ir-engine/ecs/src/ComponentFunctions'
import { useEntityContext } from '@ir-engine/ecs/src/EntityFunctions'
import { S } from '@ir-engine/ecs/src/schemas/JSONSchemas'
import { useMutableState } from '@ir-engine/hyperflux'
import { ReferenceSpaceState } from '@ir-engine/spatial'
import { Geometry } from '@ir-engine/spatial/src/common/constants/Geometry'
import { cubeVertexArray } from '@ir-engine/spatial/src/common/primitives/cube'
import { createSphereVertexArray } from '@ir-engine/spatial/src/common/primitives/sphere'
import { WgpuRendererComponent } from '@ir-engine/spatial/src/renderer/WebGPURendererSystem'
import { useMeshComponent } from '@ir-engine/spatial/src/renderer/components/MeshComponent'
import {
  UniformBindGroupComponent,
  UniformBufferComponent,
  VertexBufferComponent
} from '@ir-engine/spatial/src/transform/components/UniformBindGroupComponent'
import { MeshStandardMaterial } from 'three'
import { GeometryTypeEnum, GeometryTypeToFactory } from '../constants/GeometryTypeEnum'
const createGeometry = (geometryType: GeometryTypeEnum, geometryParams: Record<string, any>): Geometry => {
  const factory = GeometryTypeToFactory[geometryType]
  const geometry = factory(geometryParams)
  return geometry
}

export const PrimitiveGeometryComponent = defineComponent({
  name: 'PrimitiveGeometryComponent',
  jsonID: 'EE_primitive_geometry',

  schema: S.Object({
    geometryType: S.Enum(GeometryTypeEnum, GeometryTypeEnum.BoxGeometry),
    geometryParams: S.Record(S.String(), S.Any())
  }),

  reactor: () => {
    const entity = useEntityContext()
    const viewer = useMutableState(ReferenceSpaceState).viewerEntity
    const renderer = useOptionalComponent(viewer.value, WgpuRendererComponent)

    useEffect(() => {
      if (!renderer?.pipeline.value) return

      // -webgpu logic-
      // For now let's just pretend all primitive geometry are spheres ;)
      // And no, this is not how it should be done AT ALL, but it's a start
      const sphereVertices = createSphereVertexArray(8, 8)
      console.log(cubeVertexArray)
      console.log(sphereVertices)
      const device = renderer.device.value!
      setComponent(entity, VertexBufferComponent, {
        buffer: device.createBuffer({
          size: sphereVertices.byteLength,
          usage: GPUBufferUsage.VERTEX,
          mappedAtCreation: true
        }),
        vertexLength: sphereVertices.length / 10
      })
      const vertexBuffer = getComponent(entity, VertexBufferComponent).buffer
      new Float32Array(vertexBuffer.getMappedRange()).set(sphereVertices)

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
          layout: renderer.pipeline.value!.getBindGroupLayout(0),
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
    }, [renderer?.pipeline])

    // -threejs logic-
    const geometryComponent = useComponent(entity, PrimitiveGeometryComponent)
    const mesh = useMeshComponent(
      entity,
      () => createGeometry(geometryComponent.geometryType.value, geometryComponent.geometryParams.value),
      () => new MeshStandardMaterial()
    )

    useLayoutEffect(() => {
      mesh.geometry.set(createGeometry(geometryComponent.geometryType.value, geometryComponent.geometryParams.value))
    }, [geometryComponent.geometryType, geometryComponent.geometryParams])

    return null
  }
})
