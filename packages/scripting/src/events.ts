/*
 * How one script tells another that something happened.
 *
 * A character that can be hurt does not know what hurts it, and the sword does
 * not know what it hit. Both would have to, if the swing called a method on the
 * thing in front of it, and every new way of dealing damage would then be a
 * change to every script that can take it. An event is the seam between them:
 *
 *     export const Damage = defineEvent<{ amount: number }>('damage');
 *
 *     export class Health extends Script {
 *       hp = param(10, { min: 1 });
 *
 *       @on(Damage)
 *       hurt(blow: { amount: number }): void {
 *         this.hp -= blow.amount;
 *         if (this.hp <= 0) this.object.destroy();
 *       }
 *     }
 *
 * and whoever swung it writes `target.send(Damage, { amount: 3 })`.
 *
 * ## Why this one is a decorator when a parameter is not
 *
 * The two cases are genuinely different, and the difference is fields against
 * methods.
 *
 * A parameter has to carry its DEFAULT. A legacy decorator on a field is handed
 * the prototype and the name and nothing else, so it never sees `= 1.5`: the
 * default would be written twice and the two would drift. And a field under
 * ES2022 semantics is defined on the instance, which shadows anything a
 * decorator put on the prototype. Hence `param()`, which declares by value.
 *
 * A handler carries no value. `@on(Damage)` states one fact about a method that
 * is already on the prototype: this method answers that event. Nothing is
 * shadowed, nothing is written twice, and the alternative is worse in a way
 * that matters here:
 *
 *     override onLoad()    { bus.on(Damage, this.hurt); }
 *     override onDestroy()  { bus.off(Damage, this.hurt); }
 *
 * That is every handler in two places, and the second place is the one that
 * gets forgotten. A script that forgets it doubles its handler on every hot
 * reload, and the symptom, a creature taking damage twice, turns up three saves
 * later looking like a combat bug. Declaring the handler on the class means the
 * host can ENUMERATE what a script subscribed to, so it can always take back
 * exactly what it put in. The symmetry the whole reload story rests on stops
 * being a discipline and becomes a property.
 *
 * ## Events are matched by name
 *
 * `defineEvent` returns a token, but what the host keys on is the string inside
 * it. That is deliberate. A hot reload rebuilds the script bundle, so every
 * token in it is a NEW object, and identity would mean nothing survived a save.
 * Two events with the same name are the same event, which is what anyone
 * writing `defineEvent('damage')` in two files meant anyway.
 */

/**
 * One kind of thing that can happen, and what comes with it.
 *
 * `payload` is never assigned. It is how the payload type travels with the
 * token, so `send(Damage, ...)` knows what it wants and `@on(Damage)` knows
 * what its method will be handed.
 */
export interface GameEvent<P = void> {
	readonly name: string;
	readonly payload?: P;
}

/**
 * Declare an event.
 *
 * The name is what the host matches on, so it has to be unique across the
 * scripts that use it: `'damage'`, `'spotted'`, `'picked-up'`.
 */
export function defineEvent<P = void>(name: string): GameEvent<P> {
	if (!name) throw new Error('an event needs a name');
	return { name };
}

/**
 * An event's payload as an argument list, so an event carrying nothing takes no
 * argument rather than an explicit `undefined`.
 */
export type Payload<P> = void extends P ? [] : [payload: P];

/** One method that answers one event. */
export interface EventHandler {
	/** The event's name, not its token. See the header for why. */
	readonly event: string;
	readonly method: string;
}

/**
 * Declared handlers, kept against the PROTOTYPE they were written on.
 *
 * Against the prototype rather than the class so that inheritance works without
 * being arranged: a subclass's own prototype holds its own handlers, and
 * `handlersOf` walks the chain.
 */
const declared = new WeakMap<object, EventHandler[]>();

/**
 * Mark a method as the answer to an event.
 *
 *     @on(Damage)
 *     hurt(blow: { amount: number }): void { ... }
 *
 * The method's parameter is checked against the event's payload, so a handler
 * that expects the wrong shape does not compile.
 */
export function on<P>(event: GameEvent<P>) {
	return <T extends (...payload: Payload<P>) => void>(
		target: object,
		key: string | symbol,
		_descriptor: TypedPropertyDescriptor<T>,
	): void => {
		if (typeof key !== 'string') throw new Error(`${event.name} needs a named method`);
		let own = declared.get(target);
		if (!own) declared.set(target, (own = []));
		own.push({ event: event.name, method: key });
	};
}

/**
 * Every handler a class declares, its base classes included.
 *
 * Deduplicated by event and method name: a subclass that overrides a decorated
 * method and decorates it again has said the same thing twice, and delivering
 * to it twice would be a bug nobody would think to look for in a decorator.
 */
export function handlersOf(constructor: Function): readonly EventHandler[] {
	const out: EventHandler[] = [];
	const seen = new Set<string>();
	let proto: object | null = (constructor as { prototype?: object }).prototype ?? null;
	while (proto && proto !== Object.prototype) {
		for (const handler of declared.get(proto) ?? []) {
			const key = `${handler.event} ${handler.method}`;
			if (seen.has(key)) continue;
			seen.add(key);
			out.push(handler);
		}
		proto = Object.getPrototypeOf(proto) as object | null;
	}
	return out;
}
