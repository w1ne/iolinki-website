// A bounded pattern language with linear dynamic programming. Native RegExp only
// evaluates individual character atoms, never the whole input, so repeated
// overlapping quantifiers cannot trigger exponential backtracking.
export function compilePattern(pattern) {
  if (typeof pattern !== "string" || pattern.length > 128)
    throw Error(
      "Validation patterns must be strings of at most 128 characters.",
    );
  try {
    new RegExp(pattern, "u");
  } catch {
    throw Error("Invalid validation pattern.");
  }
  const tokens = [];
  let cursor = 0,
    anchoredStart = false,
    anchoredEnd = false;
  if (pattern[0] === "^") {
    anchoredStart = true;
    cursor++;
  }
  while (cursor < pattern.length) {
    if (pattern[cursor] === "$" && cursor === pattern.length - 1) {
      anchoredEnd = true;
      cursor++;
      break;
    }
    const start = cursor;
    let atom;
    if (pattern[cursor] === "[") {
      cursor++;
      if (pattern[cursor] === "^") cursor++;
      while (cursor < pattern.length) {
        if (pattern[cursor] === "\\") {
          cursor += 2;
          continue;
        }
        if (pattern[cursor++] === "]") break;
      }
      atom = pattern.slice(start, cursor);
    } else if (pattern[cursor] === "\\") {
      cursor++;
      const escape = pattern[cursor++];
      if (escape === undefined || /[1-9bk]/.test(escape))
        throw Error(
          "Groups, alternatives, boundaries and backreferences are not supported in validation patterns.",
        );
      if (["p", "P"].includes(escape)) {
        if (pattern[cursor++] !== "{")
          throw Error("Invalid Unicode character property.");
        while (cursor < pattern.length && pattern[cursor] !== "}") cursor++;
        cursor++;
      } else if (escape === "u") {
        if (pattern[cursor] === "{") {
          cursor++;
          while (cursor < pattern.length && pattern[cursor] !== "}") cursor++;
          cursor++;
        } else cursor += 4;
      } else if (escape === "x") cursor += 2;
      atom = pattern.slice(start, cursor);
    } else {
      const char = String.fromCodePoint(pattern.codePointAt(cursor));
      if (/[()|^$*+?{}]/.test(char))
        throw Error(
          "Use character atoms and quantifiers without groups or alternatives.",
        );
      cursor += char.length;
      atom = char;
    }
    let min = 1,
      max = 1;
    const quantifier = pattern[cursor];
    if (quantifier === "*" || quantifier === "+" || quantifier === "?") {
      cursor++;
      min = quantifier === "+" ? 1 : 0;
      max = quantifier === "?" ? 1 : Infinity;
    } else if (quantifier === "{") {
      const match = pattern.slice(cursor).match(/^\{(\d+)(?:,(\d*))?\}/);
      if (!match) throw Error("Invalid pattern quantifier.");
      min = Number(match[1]);
      max =
        match[2] === undefined
          ? min
          : match[2] === ""
            ? Infinity
            : Number(match[2]);
      if (min > 256 || (max !== Infinity && max > 256) || max < min)
        throw Error("Pattern repetitions must be between 0 and 256.");
      cursor += match[0].length;
    }
    if (pattern[cursor] === "?")
      throw Error("Lazy quantifiers are not supported in validation patterns.");
    let matcher;
    try {
      matcher = new RegExp("^(?:" + atom + ")$", "u");
    } catch {
      throw Error("Invalid pattern character atom.");
    }
    tokens.push({ matcher, min, max });
    if (tokens.length > 128) throw Error("Pattern exceeds 128 atoms.");
  }
  return {
    test(value) {
      if (typeof value !== "string" || value.length > 512) return false;
      const chars = [...value],
        length = chars.length;
      let active = new Uint8Array(length + 1);
      if (anchoredStart) active[0] = 1;
      else active.fill(1);
      for (const token of tokens) {
        const run = new Uint16Array(length + 1);
        for (let i = length - 1; i >= 0; i--)
          if (token.matcher.test(chars[i])) run[i] = run[i + 1] + 1;
        const changes = new Int16Array(length + 2);
        for (let i = 0; i <= length; i++)
          if (active[i]) {
            const available = Math.min(run[i], token.max);
            if (available < token.min) continue;
            changes[i + token.min]++;
            changes[i + available + 1]--;
          }
        const next = new Uint8Array(length + 1);
        let count = 0;
        for (let i = 0; i <= length; i++) {
          count += changes[i];
          if (count > 0) next[i] = 1;
        }
        active = next;
      }
      return anchoredEnd ? active[length] === 1 : active.some((n) => n === 1);
    },
  };
}
