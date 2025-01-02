export function createSphereVertexArray(stacks = 20, slices = 20): Float32Array {
  const verticesPerQuad = 6
  const floatsPerVertex = 4 + 4 + 2 // position float4, color float4, uv float2
  const totalQuads = stacks * slices
  const totalFloats = totalQuads * verticesPerQuad * floatsPerVertex
  const data = new Float32Array(totalFloats)

  let offset = 0
  for (let i = 0; i < stacks; i++) {
    // φ in [0..π]
    const phi1 = (i / stacks) * Math.PI
    const phi2 = ((i + 1) / stacks) * Math.PI

    for (let j = 0; j < slices; j++) {
      // θ in [0..2π]
      const theta1 = (j / slices) * 2.0 * Math.PI
      const theta2 = ((j + 1) / slices) * 2.0 * Math.PI

      // 4 corners of the quad
      const p1 = spherePos(phi1, theta1)
      const p2 = spherePos(phi1, theta2)
      const p3 = spherePos(phi2, theta1)
      const p4 = spherePos(phi2, theta2)

      const uv1: [number, number] = [j / slices, i / stacks]
      const uv2: [number, number] = [(j + 1) / slices, i / stacks]
      const uv3: [number, number] = [j / slices, (i + 1) / stacks]
      const uv4: [number, number] = [(j + 1) / slices, (i + 1) / stacks]

      // Triangle 1: p1, p2, p3
      offset = writeVertex(data, offset, p1, uv1)
      offset = writeVertex(data, offset, p2, uv2)
      offset = writeVertex(data, offset, p3, uv3)
      // Triangle 2: p3, p2, p4
      offset = writeVertex(data, offset, p3, uv3)
      offset = writeVertex(data, offset, p2, uv2)
      offset = writeVertex(data, offset, p4, uv4)
    }
  }
  return data

  function spherePos(phi: number, theta: number): [number, number, number] {
    const x = Math.sin(phi) * Math.cos(theta)
    const y = Math.cos(phi)
    const z = Math.sin(phi) * Math.sin(theta)
    return [x, y, z]
  }

  function writeVertex(arr: Float32Array, off: number, pos: [number, number, number], uv: [number, number]) {
    // position float4
    arr[off + 0] = pos[0]
    arr[off + 1] = pos[1]
    arr[off + 2] = pos[2]
    arr[off + 3] = 1.0
    // color float4 (white)
    arr[off + 4] = 1.0
    arr[off + 5] = 1.0
    arr[off + 6] = 1.0
    arr[off + 7] = 1.0
    // uv float2
    arr[off + 8] = uv[0]
    arr[off + 9] = uv[1]
    return off + floatsPerVertex
  }
}
