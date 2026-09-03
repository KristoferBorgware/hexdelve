/*
 * Arithmetic in a data file.
 *
 * Assets moved out of TypeScript and into YAML the moment there were seven
 * bodies to keep in step rather than two. What nearly did not survive the move
 * was the *arithmetic* — because a helmet's cheek plate is not tilted by
 * 1.6207963267948965 radians, it is tilted by `PI / 2 + 0.05`, and those are
 * the same number only until somebody has to change it.
 *
 * Half the numbers in these meshes are like that: a quarter turn plus a
 * nudge, a degree count converted, six studs at `i * PI / 3 + PI / 6` round a
 * rim, a radius times 1.07. Baking them flat would produce files nobody can
 * read and nobody can check, so any scalar in an asset file may instead be a
 * string holding the expression that produced it — and the file goes on saying
 * what the source said.
 *
 *   "pi / 2 + 0.05"          "deg(-12)"        "cos(pi / 6) * radius * 0.86"
 *
 * Deliberately not a scripting language: numbers, four operators, brackets, a
 * handful of functions, and names looked up in a scope the file itself
 * declares. No variables, no calls out, no state. Evaluation is
 * left-to-right within a precedence level, which is what JavaScript does, so
 * an expression lifted out of the TypeScript it replaces gives bit-for-bit
 * the same double.
 */

export class ExpressionError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ExpressionError';
	}
}

/** Names an expression may use, beyond the constants below. */
export type Scope = Readonly<Record<string, number>>;

const CONSTANTS: Scope = {
	pi: Math.PI,
	tau: Math.PI * 2,
	e: Math.E,
	inf: Infinity,
};

const FUNCTIONS: Readonly<Record<string, (value: number) => number>> = {
	sin: Math.sin,
	cos: Math.cos,
	tan: Math.tan,
	sqrt: Math.sqrt,
	abs: Math.abs,
	sign: Math.sign,
	/** Degrees to radians, spelled the way the source spelled it. */
	deg: (value) => (value * Math.PI) / 180,
};

/**
 * Evaluate an expression.
 *
 * @param text  the expression
 * @param scope names the file has declared, checked after the built-in constants
 */
export function evaluateExpression(text: string, scope: Scope = {}): number {
	const parser = new Parser(text, scope);
	const value = parser.expression();
	parser.end();
	return value;
}

/** The names an expression uses, for a loader that wants to check them early. */
export function expressionNames(text: string): string[] {
	const out = new Set<string>();
	for (const match of text.matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)) {
		const name = match[0]!;
		if (name in CONSTANTS || name in FUNCTIONS) continue;
		out.add(name);
	}
	return [...out];
}

const HEX = /^0[xX][0-9a-fA-F]+/;
const NUMBER = /^(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?/;
const NAME = /^[A-Za-z_][A-Za-z0-9_]*/;

class Parser {
	private at = 0;

	constructor(
		private readonly text: string,
		private readonly scope: Scope,
	) {}

	end(): void {
		this.space();
		if (this.at < this.text.length) {
			this.fail(`unexpected '${this.text.slice(this.at)}'`);
		}
	}

	/** Addition and subtraction: the loosest-binding level. */
	expression(): number {
		let value = this.term();
		for (;;) {
			this.space();
			const c = this.text[this.at];
			if (c === '+') {
				this.at++;
				value = value + this.term();
			} else if (c === '-') {
				this.at++;
				value = value - this.term();
			} else {
				return value;
			}
		}
	}

	private term(): number {
		let value = this.unary();
		for (;;) {
			this.space();
			const c = this.text[this.at];
			if (c === '*') {
				this.at++;
				value = value * this.unary();
			} else if (c === '/') {
				this.at++;
				value = value / this.unary();
			} else if (c === '%') {
				this.at++;
				value = value % this.unary();
			} else {
				return value;
			}
		}
	}

	private unary(): number {
		this.space();
		const c = this.text[this.at];
		if (c === '-') {
			this.at++;
			return -this.unary();
		}
		if (c === '+') {
			this.at++;
			return this.unary();
		}
		return this.primary();
	}

	private primary(): number {
		this.space();
		const rest = this.text.slice(this.at);

		if (rest.startsWith('(')) {
			this.at++;
			const value = this.expression();
			this.space();
			if (this.text[this.at] !== ')') this.fail('expected )');
			this.at++;
			return value;
		}

		const hex = HEX.exec(rest);
		if (hex !== null) {
			this.at += hex[0].length;
			return Number(hex[0]);
		}

		const number = NUMBER.exec(rest);
		if (number !== null) {
			this.at += number[0].length;
			return Number(number[0]);
		}

		const name = NAME.exec(rest);
		if (name !== null) {
			this.at += name[0].length;
			return this.named(name[0]);
		}

		return this.fail(rest === '' ? 'expression ended early' : `unexpected '${rest}'`);
	}

	private named(name: string): number {
		const fn = FUNCTIONS[name];
		if (fn !== undefined) {
			this.space();
			if (this.text[this.at] !== '(') this.fail(`${name} needs brackets: ${name}(x)`);
			this.at++;
			const argument = this.expression();
			this.space();
			if (this.text[this.at] !== ')') this.fail(`expected ) after ${name}(`);
			this.at++;
			return fn(argument);
		}

		const constant = CONSTANTS[name];
		if (constant !== undefined) return constant;

		const scoped = this.scope[name];
		if (scoped !== undefined) return scoped;

		const known = [...Object.keys(this.scope), ...Object.keys(CONSTANTS)].sort().join(', ');
		return this.fail(`unknown name '${name}'; this file knows ${known || 'nothing'}`);
	}

	private space(): void {
		while (this.text[this.at] === ' ' || this.text[this.at] === '\t') this.at++;
	}

	private fail(message: string): never {
		throw new ExpressionError(`in '${this.text}': ${message}`);
	}
}
