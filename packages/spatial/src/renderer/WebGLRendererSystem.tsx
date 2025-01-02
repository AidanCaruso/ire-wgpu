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

import { NormalPass, RenderPass, SMAAPreset } from 'postprocessing'
import React, { useEffect } from 'react'
import { ArrayCamera, Color, CubeTexture, FogBase, Object3D, Scene, Texture, WebGLRenderer } from 'three'

import {
  ComponentType,
  defineComponent,
  defineQuery,
  defineSystem,
  ECSState,
  Entity,
  getComponent,
  hasComponent,
  PresentationSystemGroup,
  QueryReactor,
  setComponent,
  useComponent,
  useEntityContext
} from '@ir-engine/ecs'
import { S } from '@ir-engine/ecs/src/schemas/JSONSchemas'
import { defineState, getMutableState, getState, NO_PROXY, none, State, useMutableState } from '@ir-engine/hyperflux'
import { TransformComponent } from '@ir-engine/spatial/src/transform/components/TransformComponent'
import { Effect, EffectComposer, EffectPass, OutlineEffect } from 'postprocessing'
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
import { getNestedChildren } from '../transform/components/EntityTree'
import { UniformBindGroupComponent } from '../transform/components/UniformBindGroupComponent'
import { WebXRManager } from '../xr/WebXRManager'
import { XRState } from '../xr/XRState'
import { GroupComponent } from './components/GroupComponent'
import { BackgroundComponent, EnvironmentMapComponent, FogComponent } from './components/SceneComponents'
import { VisibleComponent } from './components/VisibleComponent'
import { ObjectLayers } from './constants/ObjectLayers'
import { RenderModes } from './constants/RenderModes'
import { CSM } from './csm/CSM'
import CSMHelper from './csm/CSMHelper'
import { changeRenderMode } from './functions/changeRenderMode'
import { HighlightState } from './HighlightState'
import { PerformanceManager, PerformanceState } from './PerformanceState'
import { RendererState } from './RendererState'
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
export const uniformBufferSize = 65536
export const RendererComponent = defineComponent({
  name: 'RendererComponent',

  schema: S.NonSerialized(
    S.Object({
      /** Is resize needed? */
      needsResize: S.Bool(false),

      renderPass: S.Nullable(S.Type<RenderPass>()),
      normalPass: S.Nullable(S.Type<NormalPass>()),
      renderContext: S.Nullable(S.Type<GPUCanvasContext>()),
      effects: S.Record(S.String(), EffectSchema),

      canvas: S.Nullable(S.Type<HTMLCanvasElement>()),

      device: S.Nullable(S.Type<GPUDevice>()),
      pipeline: S.Nullable(S.Type<GPURenderPipeline>()),
      depthTexture: S.Nullable(S.Type<GPUTexture>()),
      uniformBuffer: S.Nullable(S.Type<GPUBuffer>()),
      renderPassDescriptor: S.Nullable(S.Type<GPURenderPassDescriptor>()),
      verticesBuffer: S.Nullable(S.Type<GPUBuffer>()),
      aspect: S.Number(1),

      renderer: S.Nullable(S.Type<WebGLRenderer>()),
      effectComposer: S.Nullable(S.Type<EffectComposer>()),

      scenes: S.Array(S.Entity()),
      scene: S.Class(() => new Scene()),

      /** @todo deprecate and replace with engine implementation */
      xrManager: S.Nullable(S.Type<WebXRManager>()),
      webGLLostContext: S.Nullable(S.Type<WEBGL_lose_context>()),

      csm: S.Nullable(S.Type<CSM>()),
      csmHelper: S.Nullable(S.Type<CSMHelper>())
    })
  ),

  onInit(initial) {
    initial.scene.matrixAutoUpdate = false
    initial.scene.matrixWorldAutoUpdate = false
    initial.scene.layers.set(ObjectLayers.Scene)
    return initial
  },

  /**
   * @deprecated will be removed once threejs objects are not proxified. Should only be used in proxifyParentChildRelationships.ts
   * see https://github.com/ir-engine/ir-engine/issues/9308
   */
  activeRender: false,

  reactor: () => {
    const entity = useEntityContext()
    const rendererComponent = useComponent(entity, RendererComponent)
    const camera = useComponent(entity, CameraComponent).value as ArrayCamera
    const hightlightState = useMutableState(HighlightState)
    const renderSettings = useMutableState(RendererState)
    const effectComposerState = rendererComponent.effectComposer as State<EffectComposer>

    useEffect(() => {
      navigator.gpu.requestAdapter().then((a) => a?.requestDevice().then((d) => rendererComponent.device.set(d)))
    }, [])

    useEffect(() => {
      if (!rendererComponent.device.value) return
      const device = rendererComponent.device.value as GPUDevice
      const pipeline = device.createRenderPipeline({
        layout: 'auto',
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

          // Backface culling since the cube is solid piece of geometry.
          // Faces pointing away from the camera will be occluded by faces
          // pointing toward the camera.
          cullMode: 'back'
        },

        // Enable depth testing so that the fragment closest to the camera
        // is rendered in front.
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

      rendererComponent.verticesBuffer.set(
        device.createBuffer({
          size: cubeVertexArray.byteLength,
          usage: GPUBufferUsage.VERTEX,
          mappedAtCreation: true
        })
      )
      new Float32Array(rendererComponent.verticesBuffer.value!.getMappedRange()).set(cubeVertexArray)
      rendererComponent.verticesBuffer.value!.unmap()

      rendererComponent.aspect.set(canvas.clientWidth / canvas.clientHeight)
    }, [rendererComponent.device])

    useEffect(() => {
      if (!effectComposerState.value) return

      const scene = rendererComponent.scene.value as Scene
      const outlineEffect = new OutlineEffect(scene, camera, getState(HighlightState))
      outlineEffect.selectionLayer = ObjectLayers.HighlightEffect
      effectComposerState.OutlineEffect.set(outlineEffect)

      return () => {
        if (!hasComponent(entity, RendererComponent)) return
        outlineEffect.dispose()
        effectComposerState.OutlineEffect.set(none)
      }
    }, [!!effectComposerState.value, hightlightState])

    useEffect(() => {
      const effectComposer = effectComposerState.value
      if (!effectComposer) return

      const effectsVal = rendererComponent.effects.get(NO_PROXY) as Record<string, Effect>

      const enabled = renderSettings.usePostProcessing.value

      const effectArray = enabled ? Object.values(effectsVal) : []
      if (effectComposer.OutlineEffect) effectArray.unshift(effectComposer.OutlineEffect as OutlineEffect)

      const effectPass = new EffectPass(camera, ...effectArray)
      effectComposerState.EffectPass.set(effectPass)

      if (enabled) {
        effectComposerState.merge(effectsVal)
      }

      try {
        effectComposer.addPass(effectPass)
      } catch (e) {
        console.warn(e) /** @todo Implement user messaging Ex: (Can not use multiple convolution effects) */
      }

      effectComposer.setRenderer(rendererComponent.renderer.value as WebGLRenderer)

      return () => {
        if (!hasComponent(entity, RendererComponent)) return
        if (enabled) {
          for (const effect in effectsVal) {
            effectsVal[effect].dispose()
            effectComposerState[effect].set(none)
          }
        }
        effectComposer.EffectPass.dispose()
        effectComposer.removePass(effectPass)
      }
    }, [rendererComponent.effects, !!effectComposerState?.OutlineEffect?.value, renderSettings.usePostProcessing.value])

    useEffect(() => {
      const canvas = rendererComponent.canvas.value as HTMLCanvasElement
      const context = canvas.getContext('webgpu')
      rendererComponent.renderContext.set(context)
    }, [])

    useEffect(() => {
      // const context = rendererComponent.renderContext.get(NO_PROXY)
      // if (!context) return
      if (!rendererComponent.device.value) return
      const canvas = rendererComponent.canvas.get(NO_PROXY) as HTMLCanvasElement

      const onResize = () => {
        canvas.width = canvas.clientWidth
        canvas.height = canvas.clientHeight
        rendererComponent.aspect.set(canvas.clientWidth / canvas.clientHeight)
        rendererComponent.depthTexture.value?.destroy()
        rendererComponent.depthTexture.set(
          rendererComponent.device.value!.createTexture({
            size: [canvas.width, canvas.height],
            format: 'depth24plus',
            usage: GPUTextureUsage.RENDER_ATTACHMENT
          })
        )
        ;(rendererComponent.renderPassDescriptor.get(NO_PROXY)!.depthStencilAttachment!.view as GPUTextureView) =
          rendererComponent.depthTexture.get(NO_PROXY)!.createView()
      }

      // // https://stackoverflow.com/questions/48124372/pointermove-event-not-working-with-touch-why-not
      // canvas.style.touchAction = 'none'
      canvas.addEventListener('resize', onResize, false)
      window.addEventListener('resize', onResize, false)
      onResize()
    }, [rendererComponent.device.value])

    return null
  }
})

/**
 * Executes the system. Called each frame by default from the Engine.instance.
 * @param delta Time since last frame.
 */
const bindGroupQuery = defineQuery([UniformBindGroupComponent])
export const render = (renderer: ComponentType<typeof RendererComponent>, camera: Entity, delta: number) => {
  navigator.gpu.getPreferredCanvasFormat()

  const canvasParent = renderer.canvas!.parentElement
  if (!canvasParent) return

  const device = renderer.device! as GPUDevice
  const uniformBuffer = renderer.uniformBuffer!
  const renderPassDescriptor = renderer.renderPassDescriptor!
  const pipeline = renderer.pipeline!

  const projectionMatrix = getComponent(camera, wgpuCameraComponent).projectionMatrix
  projectionMatrix.set(mat4.perspective(Math.PI * 0.5, renderer.aspect, 0.1, 1000.0))
  const rotation = getComponent(camera, TransformComponent).rotation
  const quaternion = quat.create(rotation.x, rotation.y, rotation.z, rotation.w)
  const quatMat = mat4.create()
  mat4.fromQuat(quaternion, quatMat)
  mat4.inverse(quatMat, quatMat)
  mat4.multiply(projectionMatrix, quatMat, projectionMatrix)

  const position = getComponent(camera, TransformComponent).position
  mat4.translate(projectionMatrix, vec3.fromValues(-position.x, -position.y, -position.z), projectionMatrix)

  for (const entity of bindGroupQuery()) {
    const modelViewProjection = mat4.create()
    modelViewProjection.set(projectionMatrix)
    const worldMatrix = new Float32Array(getComponent(entity, TransformComponent).matrixWorld.elements)
    mat4.mul(modelViewProjection, worldMatrix, modelViewProjection)
    device.queue.writeBuffer(
      uniformBuffer,
      getComponent(entity, UniformBindGroupComponent).offset,
      modelViewProjection.buffer,
      modelViewProjection.byteOffset,
      modelViewProjection.byteLength
    )
  }

  renderPassDescriptor.colorAttachments[0].view = renderer
    .canvas!.getContext('webgpu')!
    .getCurrentTexture()
    .createView()

  const commandEncoder = device.createCommandEncoder()
  const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor)
  passEncoder.setPipeline(pipeline)
  passEncoder.setVertexBuffer(0, renderer.verticesBuffer!)

  for (const entity of bindGroupQuery()) {
    const uniformBindGroup = getComponent(entity, UniformBindGroupComponent)
    passEncoder.setBindGroup(0, uniformBindGroup.bindGroup)
    passEncoder.draw(cubeVertexCount)
  }
  passEncoder.end()
  device.queue.submit([commandEncoder.finish()])
}

export const RenderSettingsState = defineState({
  name: 'RenderSettingsState',
  initial: {
    smaaPreset: SMAAPreset.MEDIUM
  }
})

const rendererQuery = defineQuery([RendererComponent, CameraComponent])

export const filterVisible = (entity: Entity) => hasComponent(entity, VisibleComponent)
export const getNestedVisibleChildren = (entity: Entity) => getNestedChildren(entity, filterVisible)
export const getSceneParameters = (entities: Entity[]) => {
  const vals = {
    background: null as Color | Texture | CubeTexture | null,
    environment: null as Texture | null,
    fog: null as FogBase | null,
    children: [] as Object3D[]
  }

  for (const entity of entities) {
    if (hasComponent(entity, EnvironmentMapComponent)) {
      vals.environment = getComponent(entity, EnvironmentMapComponent)
    }
    if (hasComponent(entity, BackgroundComponent)) {
      vals.background = getComponent(entity, BackgroundComponent as any) as Color | Texture | CubeTexture
    }
    if (hasComponent(entity, FogComponent)) {
      vals.fog = getComponent(entity, FogComponent)
    }
    if (hasComponent(entity, GroupComponent)) {
      vals.children.push(...getComponent(entity, GroupComponent)!)
    }
  }

  return vals
}

const colliderQuery = defineQuery([ColliderComponent])

//move this to component
let currentGroupOffset = 0
const offset = 256
const matrixSize = 4 * 16

const execute = () => {
  const deltaSeconds = getState(ECSState).deltaSeconds

  const onRenderEnd = PerformanceManager.profileGPURender()
  for (const entity of rendererQuery()) {
    const camera = getComponent(entity, CameraComponent)
    const renderer = getComponent(entity, RendererComponent)
    const _scene = renderer.scene!

    const entitiesToRender = renderer.scenes.map(getNestedVisibleChildren).flat()
    const { background, environment, fog, children } = getSceneParameters(entitiesToRender)
    _scene.children = children

    const renderMode = getState(RendererState).renderMode

    const sessionMode = getState(XRState).sessionMode
    _scene.background =
      sessionMode === 'immersive-ar' ? null : renderMode === RenderModes.WIREFRAME ? new Color(0xffffff) : background

    _scene.environment = environment

    _scene.fog = fog

    //this is just for testing purposes
    for (const entity of colliderQuery.enter()) {
      const collider = getComponent(entity, ColliderComponent)
      setComponent(entity, UniformBindGroupComponent, {
        bindGroup: renderer.device!.createBindGroup({
          layout: renderer.pipeline!.getBindGroupLayout(0),
          entries: [
            {
              binding: 0,
              resource: {
                buffer: renderer.uniformBuffer as GPUBuffer,
                size: matrixSize,
                offset: currentGroupOffset
              }
            }
          ]
        }),
        offset: currentGroupOffset
      })
      currentGroupOffset += offset
    }

    render(renderer, entity, deltaSeconds)
  }
  onRenderEnd()
}

const rendererReactor = () => {
  const entity = useEntityContext()
  const renderer = useComponent(entity, RendererComponent)
  const engineRendererSettings = useMutableState(RendererState)

  useEffect(() => {
    if (engineRendererSettings.automatic.value) return

    const qualityLevel = engineRendererSettings.qualityLevel.value
    getMutableState(PerformanceState).merge({
      gpuTier: qualityLevel,
      cpuTier: qualityLevel
    } as any)
  }, [engineRendererSettings.qualityLevel, engineRendererSettings.automatic])

  useEffect(() => {
    renderer.renderer.value!.setPixelRatio(window.devicePixelRatio * engineRendererSettings.renderScale.value)
    renderer.needsResize.set(true)
  }, [engineRendererSettings.renderScale])

  useEffect(() => {
    changeRenderMode(entity)
  }, [engineRendererSettings.renderMode])

  return null
}

const cameraReactor = () => {
  const entity = useEntityContext()
  const camera = useComponent(entity, CameraComponent).value
  const engineRendererSettings = useMutableState(RendererState)

  useEffect(() => {
    if (engineRendererSettings.physicsDebug.value) camera.layers.enable(ObjectLayers.PhysicsHelper)
    else camera.layers.disable(ObjectLayers.PhysicsHelper)
  }, [engineRendererSettings.physicsDebug])

  useEffect(() => {
    if (engineRendererSettings.avatarDebug.value) camera.layers.enable(ObjectLayers.AvatarHelper)
    else camera.layers.disable(ObjectLayers.AvatarHelper)
  }, [engineRendererSettings.avatarDebug])

  useEffect(() => {
    if (engineRendererSettings.gridVisibility.value) camera.layers.enable(ObjectLayers.Gizmos)
    else camera.layers.disable(ObjectLayers.Gizmos)
  }, [engineRendererSettings.gridVisibility])

  useEffect(() => {
    if (engineRendererSettings.nodeHelperVisibility.value) camera.layers.enable(ObjectLayers.NodeHelper)
    else camera.layers.disable(ObjectLayers.NodeHelper)
  }, [engineRendererSettings.nodeHelperVisibility])

  return null
}

export const WebGLRendererSystem = defineSystem({
  uuid: 'ee.engine.WebGLRendererSystem',
  insert: { with: PresentationSystemGroup },
  execute,
  reactor: () => {
    return (
      <>
        <QueryReactor Components={[RendererComponent]} ChildEntityReactor={rendererReactor} />
        <QueryReactor Components={[CameraComponent]} ChildEntityReactor={cameraReactor} />
      </>
    )
  }
})
