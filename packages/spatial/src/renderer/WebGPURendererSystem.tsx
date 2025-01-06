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

import { SMAAPreset } from 'postprocessing'
import React, { useEffect } from 'react'

import {
  ComponentType,
  defineComponent,
  defineQuery,
  defineSystem,
  ECSState,
  Entity,
  getComponent,
  getMutableComponent,
  getOptionalComponent,
  PresentationSystemGroup,
  setComponent,
  useComponent,
  useEntityContext
} from '@ir-engine/ecs'
import { S } from '@ir-engine/ecs/src/schemas/JSONSchemas'
import { getState, NO_PROXY } from '@ir-engine/hyperflux'
import { TransformComponent } from '@ir-engine/spatial/src/transform/components/TransformComponent'
import { Effect, EffectPass, OutlineEffect } from 'postprocessing'
import { mat4, quat, vec3 } from 'wgpu-matrix'
import { CameraComponent, wgpuCameraComponent } from '../camera/components/CameraComponent'
import {
  cubePositionOffset,
  cubeUVOffset,
  cubeVertexArray,
  cubeVertexCount,
  cubeVertexSize
} from '../common/primitives/cube'
import { basicFrag, basicVert } from '../common/shaders/basic'
import { ColliderComponent } from '../physics/components/ColliderComponent'
import {
  UniformBindGroupComponent,
  UniformBufferComponent,
  VertexBufferComponent
} from '../transform/components/UniformBindGroupComponent'

import { PerformanceManager } from './PerformanceState'
declare module 'postprocessing' {
  interface EffectComposer {
    EffectPass: EffectPass
    OutlineEffect: OutlineEffect
  }
  interface Effect {
    isActive: boolean
  }
}

export const EffectSchema = S.Union([S.Any(), S.Type<Effect>(undefined, { isActive: S.Bool() })])
/**@todo track useage and resize buffer as needed */
const uniformBufferSize = 256
export const WgpuRendererComponent = defineComponent({
  name: 'WgpuRendererComponent',

  schema: S.NonSerialized(
    S.Object({
      /** Is resize needed? */
      needsResize: S.Bool(false),
      canvas: S.Nullable(S.Type<HTMLCanvasElement>()),
      renderContext: S.Nullable(S.Type<GPUCanvasContext>()),
      currentGroupOffset: S.Number(0),
      device: S.Nullable(S.Type<GPUDevice>()),
      pipeline: S.Nullable(S.Type<GPURenderPipeline>()),
      depthTexture: S.Nullable(S.Type<GPUTexture>()),
      uniformBuffer: S.Nullable(S.Type<GPUBuffer>()),
      renderPassDescriptor: S.Nullable(S.Type<GPURenderPassDescriptor>()),
      aspect: S.Number(1)
    })
  ),

  reactor: () => {
    const entity = useEntityContext()
    const rendererComponent = useComponent(entity, WgpuRendererComponent)

    useEffect(() => {
      navigator.gpu.requestAdapter().then((a) => a?.requestDevice().then((d) => rendererComponent.device.set(d)))
    }, [])

    useEffect(() => {
      if (!rendererComponent.device.value) return
      const device = rendererComponent.device.value as GPUDevice

      const bindGroupLayout = device.createBindGroupLayout({
        entries: [
          {
            binding: 0,
            visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
            buffer: {
              type: 'uniform'
            }
          }
        ]
      })

      const pipelineLayout = device.createPipelineLayout({
        bindGroupLayouts: [bindGroupLayout]
      })

      const pipeline = device.createRenderPipeline({
        layout: pipelineLayout,
        vertex: {
          module: device.createShaderModule({
            code: basicVert
          }),
          buffers: [
            {
              arrayStride: cubeVertexSize,
              attributes: [
                {
                  // position
                  shaderLocation: 0,
                  offset: cubePositionOffset,
                  format: 'float32x4'
                },
                {
                  // uv
                  shaderLocation: 1,
                  offset: cubeUVOffset,
                  format: 'float32x2'
                }
              ]
            }
          ]
        },
        fragment: {
          module: device.createShaderModule({
            code: basicFrag
          }),
          targets: [
            {
              format: navigator.gpu.getPreferredCanvasFormat()
            }
          ]
        },
        primitive: {
          topology: 'triangle-list',
          cullMode: 'back'
        },

        depthStencil: {
          depthWriteEnabled: true,
          depthCompare: 'less',
          format: 'depth24plus'
        }
      })
      rendererComponent.pipeline.set(pipeline)

      const canvas = rendererComponent.canvas.value!
      rendererComponent.depthTexture.set(
        rendererComponent.device.value.createTexture({
          size: [canvas.width, canvas.height],
          format: 'depth24plus',
          usage: GPUTextureUsage.RENDER_ATTACHMENT
        })
      )

      canvas.getContext('webgpu')!.configure({
        device,
        format: navigator.gpu.getPreferredCanvasFormat()
      })

      rendererComponent.uniformBuffer.set(
        device.createBuffer({
          size: uniformBufferSize,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        })
      )

      rendererComponent.renderPassDescriptor.set({
        colorAttachments: [
          {
            view: null!,

            clearValue: [0.5, 0.5, 0.5, 1.0],
            loadOp: 'clear',
            storeOp: 'store'
          }
        ],
        depthStencilAttachment: {
          view: rendererComponent.depthTexture.get(NO_PROXY)!.createView(),

          depthClearValue: 1.0,
          depthLoadOp: 'clear',
          depthStoreOp: 'store'
        }
      })

      rendererComponent.aspect.set(canvas.clientWidth / canvas.clientHeight)
    }, [rendererComponent.device])

    useEffect(() => {
      const canvas = rendererComponent.canvas.value as HTMLCanvasElement
      const context = canvas.getContext('webgpu')
      rendererComponent.renderContext.set(context)
    }, [])

    useEffect(() => {
      if (!rendererComponent.device.value) return
      const canvas = rendererComponent.canvas.get(NO_PROXY) as HTMLCanvasElement

      const onResize = () => {
        rendererComponent.needsResize.set(true)
      }

      // // https://stackoverflow.com/questions/48124372/pointermove-event-not-working-with-touch-why-not
      canvas.style.touchAction = 'none'
      canvas.addEventListener('resize', onResize, false)
      window.addEventListener('resize', onResize, false)
      onResize()

      return () => {
        canvas.removeEventListener('resize', onResize, false)
        window.removeEventListener('resize', onResize, false)
      }
    }, [rendererComponent.device.value])

    return null
  }
})

/**
 * Executes the system. Called each frame by default from the Engine.instance.
 * @param delta Time since last frame.
 */
const bindGroupQuery = defineQuery([UniformBindGroupComponent])

export const render = (renderer: ComponentType<typeof WgpuRendererComponent>, camera: Entity, delta: number) => {
  navigator.gpu.getPreferredCanvasFormat()

  const device = renderer.device as GPUDevice
  const renderPassDescriptor = renderer.renderPassDescriptor
  const pipeline = renderer.pipeline

  if (!renderPassDescriptor || !pipeline || !device) return

  const projectionMatrix = getOptionalComponent(camera, wgpuCameraComponent)?.projectionMatrix
  if (!projectionMatrix) return
  projectionMatrix.set(mat4.perspective(Math.PI * 0.5, renderer.aspect, 0.1, 1000.0))
  const rotation = getComponent(camera, TransformComponent).rotation
  const quaternion = quat.create(rotation.x, rotation.y, rotation.z, rotation.w)
  const quatMat = mat4.create()
  mat4.fromQuat(quaternion, quatMat)
  mat4.inverse(quatMat, quatMat)
  mat4.multiply(projectionMatrix, quatMat, projectionMatrix)

  const position = getComponent(camera, TransformComponent).position
  mat4.translate(projectionMatrix, vec3.fromValues(-position.x, -position.y, -position.z), projectionMatrix)

  renderPassDescriptor.colorAttachments[0].view = renderer
    .canvas!.getContext('webgpu')!
    .getCurrentTexture()
    .createView()

  const commandEncoder = device.createCommandEncoder()
  const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor)
  passEncoder.setPipeline(pipeline)

  for (const entity of bindGroupQuery()) {
    const modelViewProjection = mat4.create()
    modelViewProjection.set(projectionMatrix)
    const worldMatrix = new Float32Array(getComponent(entity, TransformComponent).matrixWorld.elements)
    mat4.mul(modelViewProjection, worldMatrix, modelViewProjection)
    device.queue.writeBuffer(
      getComponent(entity, UniformBufferComponent),
      0,
      modelViewProjection.buffer,
      modelViewProjection.byteOffset,
      modelViewProjection.byteLength
    )
    const vertexBuffer = getComponent(entity, VertexBufferComponent)
    passEncoder.setVertexBuffer(0, vertexBuffer.buffer)
    const uniformBindGroup = getComponent(entity, UniformBindGroupComponent)
    passEncoder.setBindGroup(0, uniformBindGroup.bindGroup)
    passEncoder.draw(vertexBuffer.vertexLength)
  }

  passEncoder.end()
  device.queue.submit([commandEncoder.finish()])
}

const rendererQuery = defineQuery([WgpuRendererComponent, CameraComponent])
const colliderQuery = defineQuery([ColliderComponent])

const execute = () => {
  const deltaSeconds = getState(ECSState).deltaSeconds

  const onRenderEnd = PerformanceManager.profileGPURender()
  for (const entity of rendererQuery()) {
    const renderer = getComponent(entity, WgpuRendererComponent)

    // this lives here for testing purposes
    // @todo move this collider vis into debug reactor and make toggleable
    for (const entity of colliderQuery.enter()) {
      //bad
      const device = renderer.device!
      setComponent(entity, VertexBufferComponent, {
        buffer: device.createBuffer({
          size: cubeVertexArray.byteLength,
          usage: GPUBufferUsage.VERTEX,
          mappedAtCreation: true
        }),
        vertexLength: cubeVertexCount
      })
      const vertexBuffer = getComponent(entity, VertexBufferComponent).buffer
      new Float32Array(vertexBuffer.getMappedRange()).set(cubeVertexArray)
      vertexBuffer.unmap()

      setComponent(
        entity,
        UniformBufferComponent,
        device.createBuffer({
          size: uniformBufferSize,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        })
      )
      setComponent(entity, UniformBindGroupComponent, {
        bindGroup: renderer.device!.createBindGroup({
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
    }

    const canvasParent = renderer.canvas?.parentElement
    if (!canvasParent) return

    if (renderer.needsResize) {
      const rendererComponent = getMutableComponent(entity, WgpuRendererComponent)
      renderer.canvas!.width = canvasParent.clientWidth
      renderer.canvas!.height = canvasParent.clientHeight
      rendererComponent.aspect.set(canvasParent.clientWidth / canvasParent.clientHeight)
      renderer.depthTexture?.destroy()
      rendererComponent.depthTexture.set(
        renderer.device!.createTexture({
          size: [renderer.canvas!.width, renderer.canvas!.height],
          format: 'depth24plus',
          usage: GPUTextureUsage.RENDER_ATTACHMENT
        })
      )
      ;(rendererComponent.renderPassDescriptor.get(NO_PROXY)!.depthStencilAttachment!.view as GPUTextureView) =
        rendererComponent.depthTexture.get(NO_PROXY)!.createView()

      rendererComponent.needsResize.set(false)
    }

    render(renderer, entity, deltaSeconds)
  }
  onRenderEnd()
}

export const WgpuRendererSystem = defineSystem({
  uuid: 'ee.engine.WgpuRendererSystem',
  insert: { with: PresentationSystemGroup },
  execute,
  reactor: () => {
    return <></>
  }
})
