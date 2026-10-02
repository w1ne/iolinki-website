/**
 * Ergonomic access helpers over the generic node tree.
 *
 * The tree from `parseXml` is deliberately untyped so that nothing can be lost.
 * The cost is verbosity: reaching a device's vendor name means walking four levels
 * of `children.find(...)`. These helpers pay that cost once, in one place.
 *
 * Everything here is a *view* over the live tree — no copying, no shadow state.
 * Mutations through `setAttr`/`insertChild` therefore show up immediately in the
 * next `serialiseXml`, and stay reactive when the tree is wrapped in Vue's
 * `reactive()`.
 */

/** All element children of `node`, optionally filtered by tag name. */
export function elements(node, name) {
  const kids = node?.children ?? []
  const found = kids.filter((n) => n.type === 'element')
  return name ? found.filter((n) => n.name === name) : found
}

/** First element child with the given name, or `undefined`. */
export function child(node, name) {
  return elements(node, name)[0]
}

/**
 * Walk a chain of element names.
 *
 * `path(doc, 'ProfileBody', 'DeviceIdentity')` reads far better than the
 * equivalent nested `.find()` calls, and returns `undefined` at the first
 * missing link rather than throwing.
 */
export function path(node, ...names) {
  let cursor = node
  for (const name of names) {
    cursor = child(cursor, name)
    if (!cursor) return undefined
  }
  return cursor
}

/** Depth-first iterator over every element in the subtree, including `node`. */
export function* walk(node) {
  if (node?.type === 'element') yield node
  for (const kid of node?.children ?? []) {
    if (kid.type === 'element') yield* walk(kid)
  }
}

/** Every element in the subtree with the given tag name, at any depth. */
export function findAll(node, name) {
  const out = []
  for (const el of walk(node)) {
    if (el.name === name) out.push(el)
  }
  return out
}

/** First element in the subtree matching a tag name or predicate. */
export function find(node, match) {
  const test = typeof match === 'function' ? match : (el) => el.name === match
  for (const el of walk(node)) {
    if (test(el)) return el
  }
  return undefined
}

/** Concatenated text content of an element. */
export function text(node) {
  return (node?.children ?? [])
    .filter((n) => n.type === 'text')
    .map((n) => n.value)
    .join('')
}

/**
 * Replace an element's text content.
 *
 * Comments among the children are preserved; only text nodes are replaced.
 */
export function setText(node, value) {
  const kept = node.children.filter((n) => n.type !== 'text')
  node.children = value === '' ? kept : [...kept, { type: 'text', value: String(value) }]
  return node
}

/** Create a new element node. */
export function element(name, attrs = {}, children = []) {
  return { type: 'element', name, attrs: { ...attrs }, children: [...children] }
}

/**
 * Set or remove an attribute.
 *
 * Passing `null`/`undefined` deletes the attribute, which matters because an
 * empty string is a meaningful value in IODD (e.g. a blank default) and must not
 * be conflated with absence.
 */
export function setAttr(node, name, value) {
  if (value === null || value === undefined) delete node.attrs[name]
  else node.attrs[name] = String(value)
  return node
}

/** Remove a node from its parent. Returns true if it was found. */
export function removeChild(parent, node) {
  const index = parent.children.indexOf(node)
  if (index === -1) return false
  parent.children.splice(index, 1)
  return true
}

/** The root element of a parsed document. */
export function root(doc) {
  return doc.children.find((n) => n.type === 'element')
}
