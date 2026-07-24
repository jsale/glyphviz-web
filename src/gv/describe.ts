// Field list for the node inspector: label/value pairs, formatted the way
// the CSV columns read, with id fields resolved to their desktop names.

import type { GvNode, Vec3 } from './types'
import { GEOMETRY_NAMES, NODE_TYPE_NAMES, RotationMode, TOPO_NAMES } from './types'

export interface NodeField {
  label: string
  value: string
}

function num(v: number): string {
  // Up to 6 decimals (the CSV save precision), trailing zeros trimmed.
  return Number(v.toFixed(6)).toString()
}

function vec(v: Vec3): string {
  return `${num(v.x)}, ${num(v.y)}, ${num(v.z)}`
}

function named(names: Record<number, string>, id: number, fallback: string): string {
  return names[id] !== undefined ? `${names[id]} (${id})` : `${fallback} (${id})`
}

export function describeNode(node: GvNode): NodeField[] {
  const fields: NodeField[] = [
    { label: 'id', value: String(node.id) },
    { label: 'type', value: named(NODE_TYPE_NAMES, node.type, 'Glyph-like') },
    {
      label: 'parent',
      value: node.parentId === 0 ? 'root (0)' : String(node.parentId),
    },
    { label: 'branch level', value: String(node.branchLevel) },
    { label: 'translate', value: vec(node.translate) },
    {
      label: 'rotate',
      value: `${vec(node.rotate)} (${
        node.rotationMode === RotationMode.EulerXYZ ? 'Euler XYZ' : 'Heading/Tilt/Roll'
      })`,
    },
    { label: 'scale', value: vec(node.scale) },
    {
      label: 'color',
      value: `${node.color.r}, ${node.color.g}, ${node.color.b}, ${node.color.a}`,
    },
    { label: 'geometry', value: named(GEOMETRY_NAMES, node.geometry, 'Unknown') },
    { label: 'topo', value: named(TOPO_NAMES, node.topo, 'Unknown') },
    { label: 'ratio', value: num(node.ratio) },
    { label: 'facet', value: `${node.subspace + 1} (subspace ${node.subspace})` },
  ]
  if (node.hide) fields.push({ label: 'hide', value: '1 (hidden)' })
  if (node.textureId) fields.push({ label: 'texture id', value: String(node.textureId) })
  if (node.text) fields.push({ label: 'text', value: node.text })
  if (node.link) fields.push({ label: 'link', value: node.link })
  const extras = Object.keys(node.extras)
  if (extras.length > 0) {
    fields.push({ label: 'extras', value: `${extras.length} column(s): ${extras.join(', ')}` })
  }
  return fields
}

/** Hex swatch color for the inspector (ignores alpha). */
export function nodeCssColor(node: GvNode): string {
  const hex = (v: number) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')
  return `#${hex(node.color.r)}${hex(node.color.g)}${hex(node.color.b)}`
}
