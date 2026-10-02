/**
 * Minimal, lossless XML parser and serialiser for IODD documents.
 *
 * WHY HAND-WRITTEN?
 * -----------------
 * 1. Bun exposes no `DOMParser`/`XMLSerializer`, so a browser-only approach could
 *    not be unit-tested. This parser behaves identically in Bun, Node and the browser.
 * 2. Zero dependencies, matching the sibling `@calumk/ioddforge-checker` package.
 * 3. Full control over output bytes. IODD files carry a `<Stamp crc>` computed over
 *    the raw byte stream, so serialisation must be deterministic and explicit.
 *
 * SCOPE
 * -----
 * Deliberately supports only what real IODD files actually contain. A survey of all
 * 41 XML files in the IO-Link specification packages plus a real Balluff vendor IODD
 * found *none* of: CDATA sections, DOCTYPE declarations, processing instructions
 * (beyond the XML declaration), named or numeric character entities beyond the five
 * predefined ones, namespace-prefixed element names, single-quoted attribute values,
 * or multi-line attribute values.
 *
 * What *is* present, and therefore supported:
 *   - the XML declaration
 *   - elements, attributes, self-closing tags
 *   - comments (every file has them)
 *   - text content (in exactly 8 `ProfileHeader` boilerplate elements)
 *   - `&apos;` / `&quot;` inside attribute values
 *
 * Anything outside that set raises a clear error rather than being silently mangled.
 *
 * THE NODE TREE IS THE MODEL
 * --------------------------
 * Parsing produces a generic tree of plain JavaScript objects. There is deliberately
 * no parallel "typed" model: a typed model can only represent what its author thought
 * to include, so anything unmodelled would be dropped on export. Because the editor
 * re-serialises from this tree, generic-and-complete is the only safe representation.
 * Ergonomic typed access is provided by selector helpers layered on top.
 *
 *   document : { declaration: { version, encoding } | null, children: Node[] }
 *   element  : { type: 'element', name: string, attrs: Record<string,string>, children: Node[] }
 *   text     : { type: 'text', value: string }
 *   comment  : { type: 'comment', value: string }
 *
 * Attribute order is preserved by virtue of JavaScript object key insertion order.
 */

const NAME_START = /[A-Za-z_:]/
const NAME_CHAR = /[-A-Za-z0-9_:.]/

/** Characters that must be escaped when written as element text. */
const TEXT_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;' }
/** Characters that must be escaped inside a double-quoted attribute value. */
const ATTR_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }

/** The five entities predefined by the XML specification. */
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

export class XmlParseError extends Error {
  constructor(message, source, position) {
    const { line, column } = locate(source, position)
    super(`${message} (line ${line}, column ${column})`)
    this.name = 'XmlParseError'
    this.line = line
    this.column = column
    this.position = position
  }
}

function locate(source, position) {
  let line = 1
  let lineStart = 0
  for (let i = 0; i < position && i < source.length; i++) {
    if (source[i] === '\n') {
      line++
      lineStart = i + 1
    }
  }
  return { line, column: position - lineStart + 1 }
}

/**
 * Expand the five predefined XML entities plus numeric character references.
 *
 * Anything else — a named entity such as `&nbsp;` that would require a DTD to
 * resolve — is an error. Silently passing it through would corrupt the document
 * on the next round-trip, because serialising would re-escape the bare `&`.
 */
function decodeEntities(value, source, offset) {
  if (!value.includes('&')) return value
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, body) => {
    if (body[0] === '#') {
      const codePoint = body[1] === 'x' || body[1] === 'X'
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10)
      if (!Number.isFinite(codePoint)) {
        throw new XmlParseError(`Invalid character reference "${match}"`, source, offset)
      }
      return String.fromCodePoint(codePoint)
    }
    const replacement = ENTITIES[body]
    if (replacement === undefined) {
      throw new XmlParseError(
        `Unsupported entity "${match}". IODD documents may only use the five predefined XML entities.`,
        source,
        offset,
      )
    }
    return replacement
  })
}

/** Escape a string for use as element text content. */
export function escapeText(value) {
  return String(value).replace(/[&<>]/g, (c) => TEXT_ESCAPES[c])
}

/** Escape a string for use inside a double-quoted attribute value. */
export function escapeAttr(value) {
  // Tabs and newlines inside attribute values would otherwise be normalised to
  // spaces by a conforming parser on the way back in, so encode them numerically.
  return String(value)
    .replace(/[&<>"]/g, (c) => ATTR_ESCAPES[c])
    .replace(/\t/g, '&#9;')
    .replace(/\n/g, '&#10;')
    .replace(/\r/g, '&#13;')
}

/**
 * Parse an XML string into a lossless document tree.
 *
 * @param {string} source Raw XML text. A leading byte-order mark is tolerated.
 * @returns {{declaration: {version: string, encoding: string|null}|null, children: Array}}
 */
export function parseXml(source) {
  if (typeof source !== 'string') {
    throw new TypeError('parseXml expects a string')
  }

  // A BOM is a byte-level concern; strip it here and let the caller record its
  // presence separately if the original byte layout matters.
  let text = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source

  let pos = 0
  let declaration = null
  const rootChildren = []
  /** @type {Array<{name: string, children: Array, start: number}>} */
  const stack = []

  const current = () => (stack.length ? stack[stack.length - 1].children : rootChildren)

  while (pos < text.length) {
    const lt = text.indexOf('<', pos)

    // ---- text run before the next tag -------------------------------------
    if (lt === -1) {
      pushText(text.slice(pos), pos)
      break
    }
    if (lt > pos) {
      pushText(text.slice(pos, lt), pos)
    }

    // ---- XML declaration ---------------------------------------------------
    if (text.startsWith('<?xml', lt)) {
      const end = text.indexOf('?>', lt)
      if (end === -1) throw new XmlParseError('Unterminated XML declaration', text, lt)
      if (declaration || rootChildren.length) {
        throw new XmlParseError('XML declaration must be the first thing in the document', text, lt)
      }
      const body = text.slice(lt + 5, end)
      declaration = {
        version: (body.match(/version\s*=\s*"([^"]*)"/) || [])[1] || '1.0',
        encoding: (body.match(/encoding\s*=\s*"([^"]*)"/) || [])[1] || null,
      }
      pos = end + 2
      continue
    }

    // ---- comment -----------------------------------------------------------
    if (text.startsWith('<!--', lt)) {
      const end = text.indexOf('-->', lt)
      if (end === -1) throw new XmlParseError('Unterminated comment', text, lt)
      current().push({ type: 'comment', value: text.slice(lt + 4, end) })
      pos = end + 3
      continue
    }

    // ---- unsupported constructs, reported rather than mangled --------------
    if (text.startsWith('<![CDATA[', lt)) {
      throw new XmlParseError('CDATA sections are not supported in IODD documents', text, lt)
    }
    if (text.startsWith('<!DOCTYPE', lt)) {
      throw new XmlParseError('DOCTYPE declarations are not supported in IODD documents', text, lt)
    }
    if (text.startsWith('<?', lt)) {
      throw new XmlParseError('Processing instructions are not supported in IODD documents', text, lt)
    }

    // ---- closing tag -------------------------------------------------------
    if (text.startsWith('</', lt)) {
      const end = text.indexOf('>', lt)
      if (end === -1) throw new XmlParseError('Unterminated closing tag', text, lt)
      const name = text.slice(lt + 2, end).trim()
      const open = stack.pop()
      if (!open) {
        throw new XmlParseError(`Unexpected closing tag </${name}>`, text, lt)
      }
      if (open.name !== name) {
        throw new XmlParseError(
          `Mismatched closing tag: expected </${open.name}> but found </${name}>`,
          text,
          lt,
        )
      }
      pos = end + 1
      continue
    }

    // ---- opening tag -------------------------------------------------------
    pos = parseElement(lt)
  }

  if (stack.length) {
    const unclosed = stack[stack.length - 1]
    throw new XmlParseError(`Unclosed element <${unclosed.name}>`, text, unclosed.start)
  }

  const roots = rootChildren.filter((n) => n.type === 'element')
  if (roots.length === 0) throw new XmlParseError('Document has no root element', text, 0)
  if (roots.length > 1) throw new XmlParseError('Document has more than one root element', text, 0)

  return { declaration, children: rootChildren }

  function pushText(raw, offset) {
    if (!raw) return
    // Whitespace between elements is layout, not data. Dropping it here is what
    // lets the serialiser re-indent freely; meaningful text is always non-blank.
    if (!raw.trim()) return
    current().push({ type: 'text', value: decodeEntities(raw, text, offset) })
  }

  /** Parse an element starting at `<`; returns the index just past its opening tag. */
  function parseElement(start) {
    let i = start + 1
    if (!NAME_START.test(text[i] || '')) {
      throw new XmlParseError('Invalid element name', text, i)
    }
    const nameStart = i
    while (i < text.length && NAME_CHAR.test(text[i])) i++
    const name = text.slice(nameStart, i)

    const attrs = {}
    for (;;) {
      while (i < text.length && /\s/.test(text[i])) i++
      if (i >= text.length) throw new XmlParseError(`Unterminated tag <${name}>`, text, start)

      if (text[i] === '>') {
        i++
        stack.push({ name, children: pushElement(), start })
        return i
      }
      if (text.startsWith('/>', i)) {
        pushElement()
        return i + 2
      }

      // attribute name
      if (!NAME_START.test(text[i])) {
        throw new XmlParseError(`Invalid attribute name in <${name}>`, text, i)
      }
      const attrStart = i
      while (i < text.length && NAME_CHAR.test(text[i])) i++
      const attrName = text.slice(attrStart, i)

      while (i < text.length && /\s/.test(text[i])) i++
      if (text[i] !== '=') {
        throw new XmlParseError(`Attribute "${attrName}" has no value`, text, i)
      }
      i++
      while (i < text.length && /\s/.test(text[i])) i++

      const quote = text[i]
      if (quote !== '"' && quote !== "'") {
        throw new XmlParseError(`Attribute "${attrName}" value must be quoted`, text, i)
      }
      i++
      const valueStart = i
      const closeQuote = text.indexOf(quote, i)
      if (closeQuote === -1) {
        throw new XmlParseError(`Unterminated value for attribute "${attrName}"`, text, valueStart)
      }
      const rawValue = text.slice(valueStart, closeQuote)
      if (Object.prototype.hasOwnProperty.call(attrs, attrName)) {
        throw new XmlParseError(`Duplicate attribute "${attrName}" on <${name}>`, text, attrStart)
      }
      attrs[attrName] = decodeEntities(rawValue, text, valueStart)
      i = closeQuote + 1
    }

    function pushElement() {
      const node = { type: 'element', name, attrs, children: [] }
      current().push(node)
      return node.children
    }
  }
}

/**
 * Serialise a document tree back to XML text.
 *
 * Defaults match IODD house style as observed across the specification corpus:
 * tab indentation and CRLF line endings, which is what every official example and
 * the real vendor file use.
 *
 * @param {object} doc Document produced by {@link parseXml}.
 * @param {object} [options]
 * @param {string} [options.indent='\t']       One level of indentation.
 * @param {string} [options.eol='\r\n']        Line ending.
 * @param {boolean} [options.trailingNewline=true] Emit a final line ending.
 * @param {boolean} [options.bom=false]        Prefix a UTF-8 byte-order mark.
 * @param {boolean} [options.selfCloseSpace=false] Write `<X />` instead of `<X/>`.
 * @returns {string}
 */
export function serialiseXml(doc, options = {}) {
  const {
    indent = '\t',
    eol = '\r\n',
    trailingNewline = true,
    bom = false,
    selfCloseSpace = false,
  } = options

  const out = []

  if (doc.declaration) {
    const { version = '1.0', encoding } = doc.declaration
    out.push(
      encoding
        ? `<?xml version="${version}" encoding="${encoding}"?>`
        : `<?xml version="${version}"?>`,
    )
  }

  for (const node of doc.children) {
    writeNode(node, 0)
  }

  let text = out.join(eol)
  if (trailingNewline) text += eol
  if (bom) text = '\uFEFF' + text
  return text

  function writeNode(node, depth) {
    const pad = indent.repeat(depth)

    if (node.type === 'text') {
      out.push(pad + escapeText(node.value))
      return
    }
    if (node.type === 'comment') {
      out.push(`${pad}<!--${node.value}-->`)
      return
    }
    if (node.type !== 'element') {
      throw new TypeError(`Unknown node type "${node.type}"`)
    }

    let open = `<${node.name}`
    for (const [key, value] of Object.entries(node.attrs)) {
      if (value === undefined || value === null) continue
      open += ` ${key}="${escapeAttr(value)}"`
    }

    const kids = node.children
    if (kids.length === 0) {
      out.push(`${pad}${open}${selfCloseSpace ? ' />' : '/>'}`)
      return
    }

    // An element whose only child is text stays on a single line. This matches
    // the corpus, where `<ProfileRevision>1.1</ProfileRevision>` is never split.
    if (kids.length === 1 && kids[0].type === 'text') {
      out.push(`${pad}${open}>${escapeText(kids[0].value)}</${node.name}>`)
      return
    }

    out.push(`${pad}${open}>`)
    for (const child of kids) writeNode(child, depth + 1)
    out.push(`${pad}</${node.name}>`)
  }
}
