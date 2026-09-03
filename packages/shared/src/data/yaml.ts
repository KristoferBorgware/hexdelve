/*
 * A YAML reader, in the subset this project's asset files are written in.
 *
 * The obvious question first: why not `npm i yaml`. Because @hexdelve/shared
 * has no dependencies and nothing built on it does either — the client's whole
 * promise is one ES module of about 25 kB with nothing to install — and a
 * config parser is a poor reason to break that. The same argument that put
 * quaternions in this package rather than pulling in gl-matrix applies here:
 * what is actually needed is small, and what is not needed is most of the spec.
 *
 * So this reads the subset the asset files use and REFUSES the rest loudly
 * rather than mis-reading it. A file using an anchor, a tag or a second
 * document gets an error naming the line, not a silently different value —
 * which is the one property that matters in a parser you wrote yourself.
 *
 * Supported
 *
 *   mappings       block (`key: value`, nested by indentation) and flow (`{}`)
 *   sequences      block (`- item`) and flow (`[]`)
 *   scalars        plain, 'single' and "double" quoted, with the usual escapes
 *   block scalars  `|` and `>`, with `-` chomping
 *   numbers        integers, decimals, exponents, and 0x hex — so a colour can
 *                  stay written the way the source that authored it wrote it
 *   booleans       true / false, and null / ~
 *   comments       `#` to end of line, outside quotes
 *   `---`          one leading document marker, ignored
 *
 * Refused, by name and line number
 *
 *   anchors and aliases (& *), tags (!), directives (%), `+` chomping, a
 *   second document, and a tab used as indentation — which YAML forbids and
 *   which an editor configured for this repository's tab-indented TypeScript
 *   will cheerfully insert if nobody says otherwise.
 *
 * Keys are strings, and a duplicate key is an error rather than
 * last-one-wins: in an asset file the two spellings are always a mistake, and
 * the silent version of that mistake is a part drawn in the wrong colour with
 * nothing to point at.
 */

export type YamlValue = string | number | boolean | null | YamlValue[] | YamlMap;

export interface YamlMap {
	[key: string]: YamlValue;
}

export class YamlError extends Error {
	readonly line: number;
	readonly file: string | null;

	constructor(message: string, line: number, file: string | null = null) {
		super(`${file ?? '<yaml>'}:${line}: ${message}`);
		this.name = 'YamlError';
		this.line = line;
		this.file = file;
	}
}

/**
 * Parse one document.
 *
 * @param source the file's text
 * @param file   its name, for error messages only
 */
export function parseYaml(source: string, file: string | null = null): YamlValue {
	const lines = scan(source, file);
	const reader = new Reader(lines, file);
	if (reader.done) return null;
	const value = reader.block(reader.peek().indent);
	if (!reader.done) {
		throw new YamlError('unexpected content after the document', reader.peek().number, file);
	}
	return value;
}

/* ---------------------------------------------------------------- scanning -- */

interface Line {
	/** Columns of leading space. Mutated when a `-` hands its content on. */
	indent: number;
	/** The line, with its indentation and any trailing comment removed. */
	text: string;
	/** 1-based, for the error messages. */
	number: number;
}

/**
 * Split the source into significant lines.
 *
 * Block scalars are why this is not simply `split('\n')` inside the reader:
 * their body is raw text in which a `#` is a `#` and an indent is content, so
 * they are consumed here, in one pass, while the header line is still in hand.
 */
function scan(source: string, file: string | null): Line[] {
	const raw = source.split(/\r\n|\r|\n/);
	const out: Line[] = [];

	for (let i = 0; i < raw.length; i++) {
		const text = raw[i]!;
		const number = i + 1;

		const indent = measureIndent(text, number, file);
		const body = text.slice(indent).trimEnd();
		if (body === '' || body.startsWith('#')) continue;

		if (body === '---' && out.length === 0) continue;
		if (body === '---' || body === '...') {
			throw new YamlError('only one document per file is supported', number, file);
		}
		if (body.startsWith('%')) throw new YamlError('directives are not supported', number, file);

		const stripped = stripComment(body, number, file);
		if (stripped === '') continue;

		const header = blockScalarHeader(stripped);
		if (header === null) {
			out.push({ indent, text: stripped, number });
			continue;
		}

		// A `|` or `>` at the end of the line takes everything below it, and
		// comes back as a double-quoted scalar the ordinary reader can take.
		const scalar = readBlockScalar(raw, i + 1, indent, header, number, file);
		out.push({
			indent,
			text: `${stripped.slice(0, header.at)}${requote(scalar.body)}`,
			number,
		});
		i = scalar.next - 1;
	}

	return out;
}

function measureIndent(text: string, number: number, file: string | null): number {
	let indent = 0;
	while (text[indent] === ' ') indent++;
	if (text[indent] === '\t') {
		throw new YamlError('tabs may not indent YAML; use spaces', number, file);
	}
	return indent;
}

/** Remove a trailing `#` comment, respecting quotes. */
function stripComment(body: string, number: number, file: string | null): string {
	let quote: string | null = null;
	for (let i = 0; i < body.length; i++) {
		const c = body[i]!;
		if (quote !== null) {
			if (c === '\\' && quote === '"') i++;
			else if (c === quote) quote = null;
			continue;
		}
		if (c === '"' || c === "'") quote = c;
		else if (c === '#' && (i === 0 || body[i - 1] === ' ')) return body.slice(0, i).trimEnd();
	}
	if (quote !== null) throw new YamlError('unterminated quoted string', number, file);
	return body;
}

interface BlockHeader {
	/** Where the `|` or `>` starts, so the line can be rewritten around it. */
	readonly at: number;
	readonly fold: boolean;
	readonly strip: boolean;
}

function blockScalarHeader(text: string): BlockHeader | null {
	const match = /(^|: |- )([|>])([-+]?)$/.exec(text);
	if (match === null) return null;
	return {
		at: match.index + match[1]!.length,
		fold: match[2] === '>',
		strip: match[3] === '-',
	};
}

function readBlockScalar(
	raw: string[],
	from: number,
	parentIndent: number,
	header: BlockHeader,
	number: number,
	file: string | null,
): { body: string; next: number } {
	let indent = -1;
	const collected: string[] = [];
	let i = from;

	for (; i < raw.length; i++) {
		const text = raw[i]!;
		if (text.trim() === '') {
			collected.push('');
			continue;
		}
		const lineIndent = measureIndent(text, i + 1, file);
		if (lineIndent <= parentIndent) break;
		if (indent === -1) indent = lineIndent;
		if (lineIndent < indent) break;
		collected.push(text.trimEnd().slice(indent));
	}

	if (indent === -1) throw new YamlError('block scalar has no content', number, file);

	// Trailing blank lines are the chomping rule's business, not the value's.
	while (collected.length > 0 && collected[collected.length - 1] === '') collected.pop();

	let body: string;
	if (header.fold) {
		// Folded: one newline becomes a space, a blank line stays a break.
		const parts: string[] = [];
		for (const line of collected) {
			if (line === '') parts.push('\n');
			else if (parts.length > 0 && parts[parts.length - 1] !== '\n') parts.push(` ${line}`);
			else parts.push(line);
		}
		body = parts.join('');
	} else {
		body = collected.join('\n');
	}

	return { body: header.strip ? body : `${body}\n`, next: i };
}

/** Re-encode a block scalar's body as a double-quoted scalar for the reader. */
function requote(body: string): string {
	const escaped = body
		.replace(/\\/g, '\\\\')
		.replace(/"/g, '\\"')
		.replace(/\n/g, '\\n')
		.replace(/\t/g, '\\t');
	return `"${escaped}"`;
}

/* ----------------------------------------------------------------- reading -- */

class Reader {
	private index = 0;

	constructor(
		private readonly lines: Line[],
		private readonly file: string | null,
	) {}

	get done(): boolean {
		return this.index >= this.lines.length;
	}

	peek(): Line {
		return this.lines[this.index]!;
	}

	/** A mapping, a sequence or a scalar, whichever begins at `indent`. */
	block(indent: number): YamlValue {
		const line = this.peek();
		if (line.indent !== indent) this.fail('unexpected indentation', line);
		if (isSequenceEntry(line.text)) return this.sequence(indent);
		if (findKeyColon(line.text) !== -1) return this.mapping(indent);

		this.index++;
		return this.scalar(line.text, line);
	}

	private mapping(indent: number): YamlMap {
		const out: YamlMap = {};
		while (!this.done) {
			const line = this.peek();
			if (line.indent < indent) break;
			if (line.indent > indent) this.fail('unexpected indentation', line);
			if (isSequenceEntry(line.text)) break;

			const colon = findKeyColon(line.text);
			if (colon === -1) this.fail('expected `key: value`', line);

			const key = this.key(line.text.slice(0, colon), line);
			if (Object.prototype.hasOwnProperty.call(out, key)) {
				this.fail(`duplicate key '${key}'`, line);
			}
			const rest = line.text.slice(colon + 1).trim();
			this.index++;
			out[key] = rest === '' ? this.nested(indent, true) : this.scalar(rest, line);
		}
		return out;
	}

	private sequence(indent: number): YamlValue[] {
		const out: YamlValue[] = [];
		while (!this.done) {
			const line = this.peek();
			if (line.indent < indent) break;
			if (line.indent > indent) this.fail('unexpected indentation', line);
			if (!isSequenceEntry(line.text)) break;

			const after = line.text.slice(1);
			const rest = after.trim();

			if (rest === '') {
				this.index++;
				out.push(this.nested(indent, false));
				continue;
			}

			/*
			 * `- name: root` is a mapping whose first key happens to share the
			 * dash's line. Rather than special-case that, the line is handed
			 * back to the reader as though it had begun at the column its
			 * content is actually in — which is also how the rest of that
			 * mapping is indented, so the ordinary path takes it from here.
			 */
			line.indent = indent + 1 + (after.length - after.trimStart().length);
			line.text = rest;
			out.push(this.block(line.indent));
		}
		return out;
	}

	/**
	 * The block under a `key:` or a bare `-`.
	 *
	 * A sequence is allowed to sit at its parent KEY's own indentation, which
	 * is the one place YAML lets a child go un-indented and the shape every
	 * hand-written list in this project's asset files uses. Under a bare dash
	 * it is not allowed, or the dash would swallow its own siblings.
	 */
	private nested(indent: number, sameIndentSequence: boolean): YamlValue {
		if (this.done) return null;
		const next = this.peek();
		if (next.indent > indent) return this.block(next.indent);
		if (sameIndentSequence && next.indent === indent && isSequenceEntry(next.text)) {
			return this.sequence(indent);
		}
		return null;
	}

	private key(text: string, line: Line): string {
		const trimmed = text.trim();
		if (trimmed === '') this.fail('empty key', line);
		if (trimmed[0] === '"' || trimmed[0] === "'") {
			return String(new Flow(trimmed, line.number, this.file).whole());
		}
		return trimmed;
	}

	/**
	 * A value beside its key.
	 *
	 * Only a bracket or a quote opens a flow collection. Everything else is
	 * one plain scalar running to the end of the line, commas and all — which
	 * is what lets a `hint:` be a sentence rather than something that has to
	 * be quoted to survive.
	 */
	private scalar(text: string, line: Line): YamlValue {
		const first = text[0];
		if (first === '[' || first === '{' || first === '"' || first === "'") {
			return new Flow(text, line.number, this.file).whole();
		}
		if (first === '&' || first === '*') this.fail('anchors and aliases are not supported', line);
		if (first === '!') this.fail('tags are not supported', line);
		return interpret(text);
	}

	private fail(message: string, line: Line): never {
		throw new YamlError(message, line.number, this.file);
	}
}

function isSequenceEntry(text: string): boolean {
	return text === '-' || text.startsWith('- ');
}

/**
 * Where the `key:` of a block mapping ends.
 *
 * A colon only separates when a space or the end of the line follows it,
 * which is what keeps `to: { bone: foreL }` from being read as a key of
 * `to: { bone` — and what lets a plain scalar contain one at all.
 */
function findKeyColon(text: string): number {
	let quote: string | null = null;
	let depth = 0;
	for (let i = 0; i < text.length; i++) {
		const c = text[i]!;
		if (quote !== null) {
			if (c === '\\' && quote === '"') i++;
			else if (c === quote) quote = null;
			continue;
		}
		if (c === '"' || c === "'") quote = c;
		else if (c === '[' || c === '{') depth++;
		else if (c === ']' || c === '}') depth--;
		else if (c === ':' && depth === 0 && (i + 1 === text.length || text[i + 1] === ' ')) return i;
	}
	return -1;
}

/* -------------------------------------------------------------------- flow -- */

/** Flow collections and quoted scalars: everything that fits on one line. */
class Flow {
	private at = 0;

	constructor(
		private readonly text: string,
		private readonly line: number,
		private readonly file: string | null,
	) {}

	whole(): YamlValue {
		const value = this.value();
		this.space();
		if (this.at < this.text.length) this.fail(`unexpected '${this.text.slice(this.at)}'`);
		return value;
	}

	private fail(message: string): never {
		throw new YamlError(message, this.line, this.file);
	}

	private space(): void {
		while (this.text[this.at] === ' ') this.at++;
	}

	private value(): YamlValue {
		this.space();
		const c = this.text[this.at];
		if (c === undefined) return null;
		if (c === '[') return this.sequence();
		if (c === '{') return this.mapping();
		if (c === '"' || c === "'") return this.quoted();
		if (c === '&' || c === '*') this.fail('anchors and aliases are not supported');
		if (c === '!') this.fail('tags are not supported');
		return this.plain();
	}

	private sequence(): YamlValue[] {
		this.at++; // [
		const out: YamlValue[] = [];
		this.space();
		if (this.text[this.at] === ']') {
			this.at++;
			return out;
		}
		for (;;) {
			out.push(this.value());
			this.space();
			const c = this.text[this.at];
			if (c === ']') {
				this.at++;
				return out;
			}
			if (c !== ',') this.fail('expected , or ] in a flow sequence');
			this.at++;
			this.space();
			// A trailing comma before the bracket is a typo worth forgiving.
			if (this.text[this.at] === ']') {
				this.at++;
				return out;
			}
		}
	}

	private mapping(): YamlMap {
		this.at++; // {
		const out: YamlMap = {};
		this.space();
		if (this.text[this.at] === '}') {
			this.at++;
			return out;
		}
		for (;;) {
			this.space();
			const quote = this.text[this.at];
			const key = String(quote === '"' || quote === "'" ? this.quoted() : this.plainKey());
			this.space();
			if (this.text[this.at] !== ':') this.fail(`expected ':' after '${key}'`);
			this.at++;
			const value = this.value();
			if (Object.prototype.hasOwnProperty.call(out, key)) this.fail(`duplicate key '${key}'`);
			out[key] = value;

			this.space();
			const c = this.text[this.at];
			if (c === '}') {
				this.at++;
				return out;
			}
			if (c !== ',') this.fail('expected , or } in a flow mapping');
			this.at++;
			this.space();
			if (this.text[this.at] === '}') {
				this.at++;
				return out;
			}
		}
	}

	private plainKey(): string {
		const start = this.at;
		while (this.at < this.text.length && !':,{}[]'.includes(this.text[this.at]!)) this.at++;
		const key = this.text.slice(start, this.at).trim();
		if (key === '') this.fail('empty key in a flow mapping');
		return key;
	}

	private quoted(): string {
		const quote = this.text[this.at]!;
		this.at++;
		let out = '';
		while (this.at < this.text.length) {
			const c = this.text[this.at]!;
			if (c === quote) {
				// '' inside a single-quoted scalar is one quote, as in YAML.
				if (quote === "'" && this.text[this.at + 1] === "'") {
					out += "'";
					this.at += 2;
					continue;
				}
				this.at++;
				return out;
			}
			if (c === '\\' && quote === '"') {
				this.at++;
				out += this.escape();
				continue;
			}
			out += c;
			this.at++;
		}
		this.fail('unterminated quoted string');
	}

	private escape(): string {
		const c = this.text[this.at];
		this.at++;
		switch (c) {
			case 'n':
				return '\n';
			case 't':
				return '\t';
			case 'r':
				return '\r';
			case '0':
				return '\0';
			case '"':
				return '"';
			case '\\':
				return '\\';
			case '/':
				return '/';
			case 'u': {
				const hex = this.text.slice(this.at, this.at + 4);
				if (!/^[0-9a-fA-F]{4}$/.test(hex)) this.fail('bad \\u escape');
				this.at += 4;
				return String.fromCharCode(parseInt(hex, 16));
			}
			default:
				return this.fail(`unknown escape \\${c ?? ''}`);
		}
	}

	private plain(): YamlValue {
		const start = this.at;
		while (this.at < this.text.length && !',[]{}'.includes(this.text[this.at]!)) this.at++;
		return interpret(this.text.slice(start, this.at).trim());
	}
}

const HEX = /^[-+]?0[xX][0-9a-fA-F]+$/;
const NUMBER = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;

/** A plain scalar's type, by the shapes YAML gives them. */
function interpret(text: string): YamlValue {
	if (text === '' || text === '~' || text === 'null') return null;
	if (text === 'true') return true;
	if (text === 'false') return false;
	if (HEX.test(text) || NUMBER.test(text)) return Number(text);
	return text;
}
