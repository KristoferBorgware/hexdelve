/*
 * The frame loop.
 *
 * Simulation runs on a fixed step and rendering runs whenever the browser is
 * ready, with `alpha` handed to the renderer so it can interpolate between the
 * last two simulation states. A long stall — a hidden tab, a breakpoint — is
 * clamped rather than replayed, so coming back does not run a thousand steps.
 */

export interface TickerOptions {
	/** Seconds per simulation step. Defaults to 1/60. */
	fixedStep?: number;
	/** Longest real time a single frame may advance the clock. */
	maxFrameTime?: number;
}

export type FixedUpdate = (step: number) => void;
export type FrameUpdate = (dt: number, alpha: number) => void;

export class Ticker {
	readonly fixedStep: number;
	readonly maxFrameTime: number;

	onFixedUpdate: FixedUpdate | null = null;
	onFrame: FrameUpdate | null = null;

	private handle: number | null = null;
	private last = 0;
	private accumulator = 0;

	constructor(options: TickerOptions = {}) {
		this.fixedStep = options.fixedStep ?? 1 / 60;
		this.maxFrameTime = options.maxFrameTime ?? 0.25;
	}

	get running(): boolean {
		return this.handle !== null;
	}

	start(): void {
		if (this.handle !== null) return;
		this.last = performance.now();
		this.accumulator = 0;
		this.handle = requestAnimationFrame(this.tick);
	}

	stop(): void {
		if (this.handle === null) return;
		cancelAnimationFrame(this.handle);
		this.handle = null;
	}

	private readonly tick = (now: number): void => {
		this.handle = requestAnimationFrame(this.tick);

		const dt = Math.min((now - this.last) / 1000, this.maxFrameTime);
		this.last = now;

		if (this.onFixedUpdate) {
			this.accumulator += dt;
			while (this.accumulator >= this.fixedStep) {
				this.onFixedUpdate(this.fixedStep);
				this.accumulator -= this.fixedStep;
			}
		}

		this.onFrame?.(dt, this.accumulator / this.fixedStep);
	};
}
