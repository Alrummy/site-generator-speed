// makefun-site 1.0.0, lean drop-in: the same build, as one flat program instead of a pipeline
// over plugins. Implements makefun-site's own dialect exactly (front matter, templates, the
// Markdown subset, the slug rule, the report); it is the reference's answer on every input.
//
// run(input) -> the output tree, a plain object of path -> text.

// ---------------------------------------------------------------- the text rules

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// & < > " ' : the whole escape set, nothing else is ever replaced
function escapeHtml(text) {
  const esc = text.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;');
  return esc;
}

// NFKD, the combining marks dropped, A-Z lowered, every run of other characters one '-',
// nothing at either end, 64 characters most, 'untitled' when nothing is left
function slugify(text) {
  const plain = text.normalize('NFKD').replace(/\p{M}/gu, '');
  let out = '';
  let gap = false;
  for (const ch of plain) {
    let keep;
    if (ch >= 'A' && ch <= 'Z') keep = String.fromCharCode(ch.charCodeAt(0) + 32);
    else if ((ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9')) keep = ch;
    else {
      gap = out.length > 0;
      continue;
    }
    out += (gap ? '-' : '') + keep;
    gap = false;
  }
  out = out.slice(0, 64).replace(/-+$/, '');
  return out === '' ? 'untitled' : out;
}

// slug, slug-2, slug-3 ... the first not in `taken`; the winner is added
function uniqueSlug(slug, taken) {
  let out = slug;
  for (let n = 2; taken.has(out); n++) out = slug + '-' + n;
  taken.add(out);
  return out;
}

// the date in words, from the string alone
function longDate(date) {
  return Number(date.slice(8)) + ' ' + MONTHS[Number(date.slice(5, 7)) - 1] + ' ' + date.slice(0, 4);
}

// ---------------------------------------------------------------- front matter

const LINE = /^([a-z_]+):(?: (.*))?$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const LAYOUT_RE = /^[a-z0-9-]+$/;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TAG_BAD = /["\[\]]/;
const KEYS = { title: 1, date: 1, tags: 1, draft: 1, layout: 1, slug: 1, summary: 1 };

// the source's front matter and body, or its refusal
function parseFrontMatter(text) {
  const lines = text.split('\n');
  if (lines[0] !== '---') return { error: 'no front matter' };
  let close = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---') {
      close = i;
      break;
    }
  }
  if (close === -1) return { error: 'the front matter is not closed' };
  const data = {};
  for (let i = 1; i < close; i++) {
    const line = lines[i];
    if (/^[ \t]*$/.test(line) || line[0] === '#') continue;
    const m = LINE.exec(line);
    if (m === null) return { error: 'line ' + (i + 1) + ' is not "key: value"' };
    const key = m[1];
    const raw = m[2] === undefined ? '' : m[2].replace(/[ \t]+$/, '');
    if (KEYS[key] === undefined) return { error: 'unknown key "' + key + '"' };
    if (key in data) return { error: 'key "' + key + '" is given twice' };
    if (raw === '') return { error: 'key "' + key + '" has no value' };
    let v;
    switch (key) {
      case 'title':
      case 'summary': {
        if (raw[0] === '"') {
          if (raw.length < 2 || raw.slice(-1) !== '"') return { error: 'key "' + key + '": a quoted string is not closed' };
          let out = '';
          for (let q = 1; q < raw.length - 1; q++) {
            const c = raw[q];
            if (c === '\\') {
              const nx = raw[q + 1];
              if ((nx !== '"' && nx !== '\\') || q + 1 === raw.length - 1)
                return { error: 'key "' + key + '": a quoted string holds an escape other than \" or \\' };
              out += nx;
              q++;
            } else if (c === '"') return { error: 'key "' + key + '": a quoted string holds a stray quote' };
            else out += c;
          }
          v = out;
        } else if (raw[0] === '[') return { error: 'key "' + key + '": a bare string opens on [' };
        else v = raw;
        break;
      }
      case 'date': {
        const dm = DATE_RE.exec(raw);
        if (dm === null) return { error: 'key "date": not a date from 1970-01-01 to 2099-12-31 (YYYY-MM-DD)' };
        const y = +dm[1], mo = +dm[2], d = +dm[3];
        const dim = mo === 2 ? ((y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28) : mo === 4 || mo === 6 || mo === 9 || mo === 11 ? 30 : 31;
        if (y < 1970 || y > 2099 || mo < 1 || mo > 12 || d < 1 || d > dim)
          return { error: 'key "date": not a date from 1970-01-01 to 2099-12-31 (YYYY-MM-DD)' };
        v = raw;
        break;
      }
      case 'tags': {
        if (raw[0] !== '[' || raw.slice(-1) !== ']') return { error: 'key "tags": not a list [a, b]' };
        const inner = raw.slice(1, -1);
        if (inner.trim() === '') v = [];
        else {
          const parts = inner.split(',').map((x) => x.trim());
          for (const p of parts) if (p === '' || TAG_BAD.test(p))
            return { error: 'key "tags": an empty tag, or one holding " [ or ]' };
          v = parts;
        }
        break;
      }
      case 'draft':
        if (raw === 'true') v = true;
        else if (raw === 'false') v = false;
        else return { error: 'key "draft": true or false' };
        break;
      case 'layout':
        if (!LAYOUT_RE.test(raw)) return { error: 'key "layout": not a template name' };
        v = raw;
        break;
      case 'slug':
        if (!SLUG_RE.test(raw) || raw.length > 64) return { error: 'key "slug": not a slug' };
        v = raw;
        break;
    }
    data[key] = v;
  }
  if (data.title === undefined) return { error: 'no title' };
  return { data, body: lines.slice(close + 1).join('\n') };
}

// ---------------------------------------------------------------- markdown

// the characters a backslash writes
const ESCAPABLE = '\\`*_[]()#+-.!>';
const isEscapable = (c) => ESCAPABLE.includes(c);

// a paragraph line without its end spaces and tabs
function trimST(line) {
  let a = 0, b = line.length;
  while (a < b && (line.charCodeAt(a) === 32 || line.charCodeAt(a) === 9)) a++;
  while (b > a && (line.charCodeAt(b - 1) === 32 || line.charCodeAt(b - 1) === 9)) b--;
  return line.slice(a, b);
}

const isBlank = (line) => /^[ \t]*$/.test(line);

// a fence open: its language, or null; a fence close
const FENCE_OPEN = /^```([A-Za-z0-9_+-]*)[ \t]*$/;
const FENCE_CLOSE = /^```[ \t]*$/;
const HR = /^(?:---|\*\*\*)[ \t]*$/;
const BULLET = /^([-*]) (.*)$/;
const ORDERED = /^(\d{1,9})\. (.*)$/;
const CONTINUED = /^ {2,}\S/;
const QUOTE = /^>/;

function headingOf(line) {
  const m = /^(#{1,6})[ \t]+(.*?)[ \t]*$/.exec(line);
  return m === null || m[2] === '' ? null : { depth: m[1].length, text: m[2] };
}

function endsParagraph(line) {
  return (
    isBlank(line) ||
    FENCE_OPEN.test(line) ||
    headingOf(line) !== null ||
    HR.test(line)
  );
}

// `s` rendered inline; `link(target)` is a link's href
function inline(s, link) {
  let out = '';
  let i = 0;
  const n = s.length;
  while (i < n) {
    const c = s.charCodeAt(i);
    if (c === 92) {
      if (i + 1 < n && isEscapable(s.charAt(i + 1))) {
        out += escapeHtml(s.charAt(i + 1));
        i += 2;
      } else {
        out += '\\';
        i++;
      }
      continue;
    }
    if (c === 96) {
      const j = s.indexOf('`', i + 1);
      if (j > i + 1) {
        out += '<code>' + escapeHtml(s.slice(i + 1, j)) + '</code>';
        i = j + 1;
      } else {
        out += '`';
        i++;
      }
      continue;
    }
    if (c === 42) {
      if (i + 1 < n && s.charCodeAt(i + 1) === 42) {
        // the next unescaped **
        let j = i + 2;
        let found = -1;
        for (; j + 2 <= n; ) {
          const ck = s.charCodeAt(j);
          if (ck === 92) {
            if (j + 1 < n && isEscapable(s.charAt(j + 1))) { j += 2; continue; }
            j++;
            continue;
          }
          if (ck === 42 && s.charCodeAt(j + 1) === 42) { found = j; break; }
          j++;
        }
        if (found > i + 2) {
          out += '<strong>' + inline(s.slice(i + 2, found), link) + '</strong>';
          i = found + 2;
        } else {
          out += '**';
          i += 2;
        }
        continue;
      }
      // the next single * (a run of two is a strong open, not a close)
      let j = i + 1;
      let found = -1;
      for (; j < n; ) {
        const ck = s.charCodeAt(j);
        if (ck === 92) {
          if (j + 1 < n && isEscapable(s.charAt(j + 1))) { j += 2; continue; }
          j++;
          continue;
        }
        if (ck === 42) {
          if (s.charCodeAt(j + 1) === 42) { j += 2; continue; }
          found = j;
          break;
        }
        j++;
      }
      if (found > i + 1) {
        out += '<em>' + inline(s.slice(i + 1, found), link) + '</em>';
        i = found + 1;
      } else {
        out += '*';
        i++;
      }
      continue;
    }
    if (c === 91) {
      // [text](target)
      let j = i + 1;
      let found = -1;
      for (; j < n; ) {
        const ck = s.charCodeAt(j);
        if (ck === 92) {
          if (j + 1 < n && isEscapable(s.charAt(j + 1))) { j += 2; continue; }
          j++;
          continue;
        }
        if (ck === 93) { found = j; break; }
        j++;
      }
      if (found !== -1 && s.charCodeAt(found + 1) === 40) {
        const m = s.indexOf(')', found + 2);
        const target = m === -1 ? '' : s.slice(found + 2, m);
        if (target !== '' && !/\s/.test(target)) {
          out += '<a href="' + escapeHtml(link(target)) + '">' + inline(s.slice(i + 1, found), link) + '</a>';
          i = m + 1;
          continue;
        }
      }
      out += '[';
      i++;
      continue;
    }
    if (c === 38) out += '&amp;';
    else if (c === 60) out += '&lt;';
    else if (c === 62) out += '&gt;';
    else if (c === 34) out += '&quot;';
    else if (c === 39) out += '&#39;';
    else out += s.charAt(i);
    i++;
  }
  return out;
}

// a body's HTML (each block on its own line, a "\n" after the last), its toc and its excerpt
function renderMarkdown(src, link) {
  const lines = src.split('\n');
  const blocks = [];
  const toc = [];
  const ids = new Set();
  let excerpt = null;
  let i = 0;
  const nl = lines.length;
  while (i < nl) {
    const line = lines[i];
    if (isBlank(line)) {
      i++;
      continue;
    }
    const fence = FENCE_OPEN.exec(line);
    if (fence !== null) {
      i++;
      const body = [];
      while (i < nl && !FENCE_CLOSE.test(lines[i])) body.push(escapeHtml(lines[i++]) + '\n');
      i++;
      const cls = fence[1] === '' ? '' : ' class="language-' + escapeHtml(fence[1]) + '"';
      blocks.push('<pre><code' + cls + '>' + body.join('') + '</code></pre>');
      continue;
    }
    const h = headingOf(line);
    if (h !== null) {
      const id = uniqueSlug(slugify(h.text), ids);
      const html = inline(h.text, link);
      blocks.push('<h' + h.depth + ' id="' + id + '">' + html + '</h' + h.depth + '>');
      if (h.depth === 2 || h.depth === 3) toc.push({ level: h.depth, id, html });
      i++;
      continue;
    }
    if (HR.test(line)) {
      blocks.push('<hr>');
      i++;
      continue;
    }
    if (QUOTE.test(line)) {
      const body = [];
      while (i < nl && QUOTE.test(lines[i])) {
        const t = trimST(lines[i].replace(/^> ?/, ''));
        if (t !== '') body.push(t);
        i++;
      }
      blocks.push(
        body.length === 0
          ? '<blockquote>\n</blockquote>'
          : '<blockquote>\n<p>' + inline(body.join('\n'), link) + '</p>\n</blockquote>',
      );
      continue;
    }
    const bullet = BULLET.exec(line);
    const ordered = bullet === null ? ORDERED.exec(line) : null;
    if (bullet !== null || ordered !== null) {
      const isOrdered = ordered !== null;
      const items = [];
      while (i < nl) {
        const m = isOrdered ? ORDERED.exec(lines[i]) : BULLET.exec(lines[i]);
        if (m !== null) {
          items.push(trimST(m[2]));
          i++;
        } else if (CONTINUED.test(lines[i])) {
          items[items.length - 1] += '\n' + trimST(lines[i]);
          i++;
        } else break;
      }
      const tag = isOrdered ? 'ol' : 'ul';
      const open = isOrdered && +ordered[1] !== 1 ? '<ol start="' + ordered[1] + '">' : '<' + tag + '>';
      blocks.push(open + '\n' + items.map((it) => '<li>' + inline(it, link) + '</li>\n').join('') + '</' + tag + '>');
      continue;
    }
    const body = [trimST(line)];
    i++;
    while (i < nl && !endsParagraph(lines[i])) body.push(trimST(lines[i++]));
    const html = inline(body.join('\n'), link);
    if (excerpt === null) excerpt = html;
    blocks.push('<p>' + html + '</p>');
  }
  return { html: blocks.join('\n') + (blocks.length === 0 ? '' : '\n'), toc, excerpt: excerpt ?? '' };
}

// ---------------------------------------------------------------- templates

const PATH_RE = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/;
const FOR_RE = /^for ([A-Za-z_][A-Za-z0-9_]*) in (\S+)$/;
const IF_RE = /^if (not )?(\S+)$/;
const INCLUDE_RE = /^include "([a-z0-9-]+)"$/;

class ParseError extends Error {}

// `src` parsed: a flat node array and a list of the templates it includes
function parseTemplate(name, src) {
  const pathOf = (text) => {
    if (!PATH_RE.test(text)) throw new ParseError('template "' + name + '": ' + JSON.stringify(text) + ' is not a path');
    return text.split('.');
  };
  const nodes = [];
  const includes = [];
  // frames: { t: 'for'|'if', node }
  const stack = [];
  let pending = '';
  const flush = () => {
    if (pending !== '') {
      nodes.push({ k: 0, s: pending });
      pending = '';
    }
  };
  let i = 0;
  const n = src.length;
  while (i < n) {
    const open = src.indexOf('{', i);
    if (open === -1 || open === n - 1) {
      pending += src.slice(i);
      break;
    }
    const nx = src.charCodeAt(open + 1);
    if (nx !== 123 && nx !== 37) {
      pending += src.slice(i, open + 1);
      i = open + 1;
      continue;
    }
    pending += src.slice(i, open);
    if (nx === 123) {
      const raw = src.charCodeAt(open + 2) === 123;
      const close = src.indexOf(raw ? '}}}' : '}}', open + (raw ? 3 : 2));
      if (close === -1) throw new ParseError('template "' + name + '": a ' + (raw ? '{{{' : '{{') + ' is not closed');
      flush();
      nodes.push({ k: raw ? 2 : 1, p: pathOf(src.slice(open + (raw ? 3 : 2), close).trim()) });
      i = close + (raw ? 3 : 2);
      continue;
    }
    const close = src.indexOf('%}', open + 2);
    if (close === -1) throw new ParseError('template "' + name + '": a {% is not closed');
    const end = close + 2;
    const lineStart = src.lastIndexOf('\n', open - 1) + 1;
    const nl = src.indexOf('\n', end);
    const lineEnd = nl === -1 ? n : nl;
    const standalone = /^[ \t]*$/.test(src.slice(lineStart, open)) && /^[ \t]*$/.test(src.slice(end, lineEnd));
    if (standalone) pending = pending.slice(0, pending.length - (open - lineStart));
    flush();
    const tag = src.slice(open + 2, close).trim();
    i = standalone ? (nl === -1 ? n : nl + 1) : end;
    let m;
    if ((m = FOR_RE.exec(tag)) !== null) {
      const node = { k: 4, var: m[1], p: pathOf(m[2]), start: nodes.length, count: 0, end: -1 };
      nodes.push(node);
      stack.push({ t: 'for', node });
      continue;
    }
    if ((m = IF_RE.exec(tag)) !== null) {
      const node = { k: 3, not: m[1] !== undefined, p: pathOf(m[2]), then: nodes.length + 1, elseAt: -1, end: -1 };
      nodes.push(node);
      stack.push({ t: 'if', node });
      continue;
    }
    if (tag === 'else') {
      const top = stack[stack.length - 1];
      if (top === undefined || top.t !== 'if') throw new ParseError('template "' + name + '": an else outside an if');
      if (top.node.elseAt !== -1) throw new ParseError('template "' + name + '": an else outside an if');
      top.node.elseAt = nodes.length;
      continue;
    }
    if (tag === 'endfor' || tag === 'endif') {
      const top = stack.pop();
      if (top === undefined || (tag === 'endfor' ? top.t !== 'for' : top.t !== 'if'))
        throw new ParseError('template "' + name + '": an ' + tag + ' with no open ' + tag.slice(3));
      top.node.count = nodes.length - top.node.start - 1;
      top.node.end = nodes.length - 1;
      continue;
    }
    if ((m = INCLUDE_RE.exec(tag)) !== null) {
      includes.push(m[1]);
      nodes.push({ k: 5, name: m[1] });
      continue;
    }
    throw new ParseError('template "' + name + '": {% ' + tag + ' %} is not a tag');
  }
  flush();
  if (stack.length > 0) throw new ParseError('template "' + name + '": a ' + (stack[stack.length - 1].node.k === 4 ? 'for' : 'if') + ' is not closed');
  return { nodes, includes };
}

// a value as text: a string itself, a number in JavaScript's digits, true or false, an
// array's items joined by ", ", else ""
function textOf(v) {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) {
    let out = '';
    for (let i = 0; i < v.length; i++) {
      if (i > 0) out += ', ';
      out += textOf(v[i]);
    }
    return out;
  }
  return '';
}

// undefined, null, false, "", 0 and an empty array are false; anything else is true
function truthy(v) {
  if (Array.isArray(v)) return v.length > 0;
  return v !== undefined && v !== null && v !== false && v !== '' && v !== 0;
}

// the value at a dotted path: its first name from the innermost scope that binds it
// (a loop's variable and loop first, then the page's values), the rest own properties
function lookup(scope, parts) {
  let s = scope;
  while (s !== null && !(parts[0] in s.vars)) s = s.parent;
  if (s === null) return undefined;
  let v = s.vars[parts[0]];
  for (let k = 1; k < parts.length; k++) {
    if (v === null || typeof v !== 'object' || !(parts[k] in v)) return undefined;
    v = v[parts[k]];
  }
  return v;
}

// one template's nodes in a scope chain; `includes` is name -> parsed template
function renderInto(nodes, start, end, scope, includes, depth, out) {
  for (let idx = start; idx < end; idx++) {
    const node = nodes[idx];
    const k = node.k;
    if (k === 0) {
      out.push(node.s);
      continue;
    }
    if (k === 1 || k === 2) {
      const v = textOf(lookup(scope, node.p));
      out.push(k === 1 ? escapeHtml(v) : v);
      continue;
    }
    if (k === 3) {
      // if
      const v = truthy(lookup(scope, node.p));
      const takeThen = node.not ? !v : v;
      if (takeThen) {
        renderInto(nodes, node.then, node.elseAt === -1 ? node.end + 1 : node.elseAt, scope, includes, depth, out);
      } else if (node.elseAt !== -1) {
        renderInto(nodes, node.elseAt, node.end + 1, scope, includes, depth, out);
      }
      idx = node.end;
      continue;
    }
    if (k === 4) {
      // for
      const xs = lookup(scope, node.p);
      if (Array.isArray(xs)) {
        const len = xs.length;
        for (let j = 0; j < len; j++) {
          const vars = {};
          vars[node.var] = xs[j];
          vars.loop = { index: j + 1, first: j === 0, last: j === len - 1, length: len };
          renderInto(nodes, node.start + 1, node.start + 1 + node.count, { vars, parent: scope }, includes, depth, out);
        }
      }
      idx = node.end;
      continue;
    }
    // include
    if (depth < 8) {
      const t = includes.get(node.name);
      if (t !== undefined) renderInto(t.nodes, 0, t.nodes.length, scope, includes, depth + 1, out);
    }
  }
}

// ---------------------------------------------------------------- the build

export function run(input) {
  const siteIn = input.site;
  const base = siteIn.base_url.replace(/\/+$/, '');
  const perPage = siteIn.per_page;
  const recentN = siteIn.recent;

  // the sources, in code-unit order of their paths, line ends made "\n"; a source that is
  // not .md is static
  const files = input.files;
  const filesSorted = files.slice().sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const sources = [];
  const statics = [];
  for (const f of filesSorted) {
    if (f.path.endsWith('.md')) sources.push({ path: f.path, text: f.content.replace(/\r\n?/g, '\n') });
    else statics.push(f);
  }

  // the templates, in code-unit order of their name; one that does not parse is reported
  const report = [];
  const templates = new Map();
  for (const name of Object.keys(input.templates).sort()) {
    try {
      templates.set(name, parseTemplate(name, input.templates[name]));
    } catch (err) {
      if (!(err instanceof ParseError)) throw err;
      report.push(err.message);
    }
  }

  // front matter: a refused source is reported and dropped, and so is a draft
  const kept = [];
  for (const s of sources) {
    const fm = parseFrontMatter(s.text);
    if (fm.error !== undefined) {
      report.push('refused ' + s.path + ': ' + fm.error);
      continue;
    }
    s.data = fm.data;
    s.body = fm.body;
    s.post = s.path.startsWith('posts/');
    const own = s.path.startsWith('tags/') ? 'tags' : s.path.startsWith('page/') ? 'page' : null;
    if (own !== null) {
      report.push('refused ' + s.path + ': ' + own + '/ is the generator\'s own');
      continue;
    }
    if (s.post && !('date' in s.data)) {
      report.push('refused ' + s.path + ': a post needs a date');
      continue;
    }
    const layout = s.data.layout !== undefined ? s.data.layout : s.post ? 'post' : 'page';
    if (!templates.has(layout)) {
      report.push('refused ' + s.path + ': layout "' + layout + '" is no template that parses');
      continue;
    }
    s.layout = layout;
    if (s.data.draft === true) {
      report.push('draft ' + s.path);
      continue;
    }
    kept.push(s);
  }

  // the permalinks: each page's directory and url, its slug made unique in its directory
  const taken = new Map();
  const takenIn = (dir) => {
    let t = taken.get(dir);
    if (t === undefined) {
      t = new Set();
      if (dir === '') {
        t.add('posts');
        t.add('tags');
        t.add('page');
      }
      taken.set(dir, t);
    }
    return t;
  };
  const bySource = new Map();
  for (const s of kept) {
    const dir = s.post ? 'posts' : s.path.includes('/') ? s.path.slice(0, s.path.lastIndexOf('/')) : '';
    const slug = uniqueSlug(s.data.slug !== undefined ? s.data.slug : slugify(s.data.title), takenIn(dir));
    s.slug = slug;
    s.outDir = dir === '' ? slug : dir + '/' + slug;
    s.url = base + '/' + s.outDir + '/';
    bySource.set(s.path, s);
  }

  // the bodies' Markdown, its links resolved
  const staticPaths = new Set();
  for (const f of statics) staticPaths.add(f.path);
  const broken = new Set();
  for (const s of kept) {
    const dir = s.path.includes('/') ? s.path.slice(0, s.path.lastIndexOf('/')) : '';
    const dirParts = dir === '' ? [] : dir.split('/');
    const link = (target) => {
      // a scheme, a leading / or #: kept as written
      let scheme = false;
      const c0 = target.charCodeAt(0);
      if ((c0 >= 65 && c0 <= 90) || (c0 >= 97 && c0 <= 122)) {
        let j = 1;
        while (j < target.length) {
          const c = target.charCodeAt(j);
          if ((c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 43 || c === 46 || c === 45) j++;
          else break;
        }
        if (j < target.length && target.charCodeAt(j) === 58) return target;
      }
      if (c0 === 47 || c0 === 35) return target;
      const hash = target.indexOf('#');
      const rel = hash === -1 ? target : target.slice(0, hash);
      const frag = hash === -1 ? '' : target.slice(hash);
      let path = null;
      if (rel !== '') {
        const parts = dirParts.slice();
        let out = false;
        for (const seg of rel.split('/')) {
          if (seg === '' || seg === '.') continue;
          if (seg === '..') {
            if (parts.length === 0) { out = true; break; }
            parts.pop();
          } else parts.push(seg);
        }
        if (!out) path = parts.join('/');
      }
      if (path !== null) {
        const src = bySource.get(path);
        if (src !== undefined) return src.url + frag;
        if (staticPaths.has(path)) return base + '/' + path + frag;
      }
      broken.add('broken-link ' + s.path + ' -> ' + target);
      return target;
    };
    const r = renderMarkdown(s.body, link);
    s.html = r.html;
    s.toc = r.toc;
    s.excerpt = r.excerpt;
  }

  // the collections: the posts, newest date first, equal dates by slug
  const posts = kept.filter((s) => s.post);
  posts.sort((x, y) => (x.data.date > y.data.date ? -1 : x.data.date < y.data.date ? 1 : 0) || (x.slug < y.slug ? -1 : x.slug > y.slug ? 1 : 0));
  for (let k = 0; k < posts.length; k++) {
    posts[k].newer = k === 0 ? null : posts[k - 1];
    posts[k].older = k === posts.length - 1 ? null : posts[k + 1];
  }

  // the tags: grouped by slug, named as first met, ordered by count then slug
  const byTag = new Map();
  const tagRefsOf = (s) => {
    const seen = new Set();
    const out = [];
    for (const name of s.data.tags ?? []) {
      const slug = slugify(name);
      if (seen.has(slug)) continue;
      seen.add(slug);
      let t = byTag.get(slug);
      if (t === undefined) {
        t = { name, slug, url: base + '/tags/' + slug + '/', posts: [] };
        byTag.set(slug, t);
      }
      t.posts.push(s);
      out.push(t);
    }
    return out;
  };
  for (const p of posts) p.tagRefs = tagRefsOf(p);
  for (const s of kept) {
    if (s.post) continue;
    s.tagRefs = [];
    const seen = new Set();
    for (const name of s.data.tags ?? []) {
      const slug = slugify(name);
      if (seen.has(slug)) continue;
      seen.add(slug);
      let t = byTag.get(slug);
      if (t === undefined) t = { name, slug, url: '', posts: [] };
      s.tagRefs.push(t);
    }
  }
  const tagsAll = [...byTag.values()].sort((x, y) => y.posts.length - x.posts.length || (x.slug < y.slug ? -1 : x.slug > y.slug ? 1 : 0));

  // the cards, and a page as its layout reads it
  const cards = new Map();
  for (const p of posts) {
    const date = p.data.date;
    cards.set(p, {
      title: p.data.title,
      url: p.url,
      date: date === undefined ? '' : date,
      date_long: date === undefined ? '' : longDate(date),
      summary: p.data.summary === undefined ? '' : p.data.summary,
      excerpt: p.excerpt,
      reading_minutes: Math.max(1, Math.ceil(wordsOf(p.body) / 200)),
      tags: p.tagRefs.map((t) => ({ name: t.name, slug: t.slug, url: t.url })),
    });
  }
  const pageOf = (s) => {
    const card = cards.get(s) ?? {
      title: s.data.title,
      url: s.url,
      date: s.data.date ?? '',
      date_long: s.data.date === undefined ? '' : longDate(s.data.date),
      summary: s.data.summary === undefined ? '' : s.data.summary,
      excerpt: s.excerpt,
      reading_minutes: Math.max(1, Math.ceil(wordsOf(s.body) / 200)),
      tags: s.tagRefs.map((t) => ({ name: t.name, slug: t.slug, url: t.url })),
    };
    return {
      title: card.title,
      url: card.url,
      date: card.date,
      date_long: card.date_long,
      summary: card.summary,
      excerpt: card.excerpt,
      reading_minutes: card.reading_minutes,
      tags: card.tags,
      slug: s.slug,
      content: s.html,
      toc: s.toc.map((h) => ({ level: h.level, id: h.id, html: h.html })),
      newer: s.newer == null ? null : { title: s.newer.data.title, url: s.newer.url, date: s.newer.data.date ?? '', date_long: s.newer.data.date === undefined ? '' : longDate(s.newer.data.date) },
      older: s.older == null ? null : { title: s.older.data.title, url: s.older.url, date: s.older.data.date ?? '', date_long: s.older.data.date === undefined ? '' : longDate(s.older.data.date) },
      is_post: s.post,
    };
  };

  // every page through its layout; the index, tag and tags pages through theirs
  const ctxSite = { title: siteIn.title, base_url: base };
  const ctxTags = tagsAll.map((t) => ({ name: t.name, slug: t.slug, url: t.url, count: t.posts.length }));
  const ctxRecent = posts.slice(0, recentN).map((p) => cards.get(p));
  const ctxVars = { site: ctxSite, tags: ctxTags, recent: ctxRecent };

  const out = {};
  const render = (name, extra) => {
    const t = templates.get(name);
    if (t === undefined) return null;
    const scope = { vars: extra === undefined ? ctxVars : Object.assign({}, ctxVars, extra), parent: null };
    const buf = [];
    renderInto(t.nodes, 0, t.nodes.length, scope, templates, 0, buf);
    return buf.join('');
  };

  for (const s of kept) {
    const html = render(s.layout, { page: pageOf(s) });
    out[s.outDir + '/index.html'] = html === null ? '' : html;
  }
  const totalPages = Math.max(1, Math.ceil(posts.length / perPage));
  const indexUrlOf = (k) => (k === 1 ? base + '/' : base + '/page/' + k + '/');
  for (let k = 1; k <= totalPages; k++) {
    const html = render('index', {
      posts: posts.slice((k - 1) * perPage, k * perPage).map((p) => cards.get(p)),
      pager: {
        number: k,
        total: totalPages,
        url: indexUrlOf(k),
        newer_url: k === 1 ? '' : indexUrlOf(k - 1),
        older_url: k === totalPages ? '' : indexUrlOf(k + 1),
      },
    });
    if (html !== null) out[k === 1 ? 'index.html' : 'page/' + k + '/index.html'] = html;
  }
  for (const t of tagsAll) {
    const html = render('tag', {
      tag: { name: t.name, slug: t.slug, url: t.url, count: t.posts.length, posts: t.posts.map((p) => cards.get(p)) },
    });
    if (html !== null) out['tags/' + t.slug + '/index.html'] = html;
  }
  const tagsIndex = render('tags');
  if (tagsIndex !== null) out['tags/index.html'] = tagsIndex;

  // the statics, unless a built page has their path
  for (const f of statics) {
    if (f.path in out) report.push('shadowed ' + f.path + ': a built page has its path');
    else out[f.path] = f.content;
  }

  // the report: every line above and each broken link, sorted, then the counts
  const lines = report.concat([...broken]).sort();
  const nPages = kept.filter((s) => !s.post).length;
  lines.push('built ' + nPages + ' pages, ' + posts.length + ' posts, ' + tagsAll.length + ' tags and ' + statics.length + ' static files');
  out['build-report.txt'] = lines.join('\n') + '\n';
  return out;
}

// the words of a body: its runs of characters other than whitespace
function wordsOf(text) {
  const m = text.match(/\S+/g);
  return m === null ? 0 : m.length;
}
