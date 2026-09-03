/*
 * Turning the stand.
 *
 * The client's `Controls` are the game's: they walk a man, aim him and swing a
 * sword, and they deliberately never touch the camera. A bench wants the exact
 * opposite — nothing to drive, one thing to look at — so it gets its own, and
 * they are the three gestures every inspection view has ever had:
 *
 *   drag                orbit
 *   shift-drag / middle pan the point being looked at
 *   wheel               dolly
 *
 * Pointer capture rather than window-level listeners, so a drag that leaves the
 * canvas keeps orbiting instead of stopping at the edge of the viewport.
 */

import type { OrbitCamera } from '@hexdelve/engine';

/** Radians per pixel. Slow enough to place a limb, fast enough to spin round. */
const ORBIT_RATE = 0.008;
/** Metres per pixel at unit distance, so panning feels the same at any range. */
const PAN_RATE = 0.0022;
const WHEEL_RATE = 0.0015;

export interface BenchControlsOptions {
	/** Called after any gesture, so a paused viewport can redraw itself. */
	onChange?: () => void;
}

export class BenchControls {
	private readonly listeners: (() => void)[] = [];
	private dragging = -1;
	private panning = false;
	private lastX = 0;
	private lastY = 0;

	constructor(
		private readonly canvas: HTMLCanvasElement,
		private readonly camera: OrbitCamera,
		private readonly options: BenchControlsOptions = {},
	) {
		this.bind();
	}

	dispose(): void {
		for (const off of this.listeners) off();
		this.listeners.length = 0;
	}

	private on<K extends keyof HTMLElementEventMap>(
		type: K,
		handler: (event: HTMLElementEventMap[K]) => void,
		options?: AddEventListenerOptions,
	): void {
		const listener = handler as EventListener;
		this.canvas.addEventListener(type, listener, options);
		this.listeners.push(() => this.canvas.removeEventListener(type, listener, options));
	}

	private bind(): void {
		this.on('contextmenu', (event) => event.preventDefault());

		this.on('pointerdown', (event) => {
			if (this.dragging >= 0) return;
			this.canvas.setPointerCapture(event.pointerId);
			this.dragging = event.pointerId;
			this.panning = event.button === 1 || event.button === 2 || event.shiftKey;
			this.lastX = event.clientX;
			this.lastY = event.clientY;
			event.preventDefault();
		});

		this.on('pointermove', (event) => {
			if (event.pointerId !== this.dragging) return;
			const dx = event.clientX - this.lastX;
			const dy = event.clientY - this.lastY;
			this.lastX = event.clientX;
			this.lastY = event.clientY;

			if (this.panning) {
				const scale = PAN_RATE * this.camera.distance;
				// Up on the screen is up in the world here, not forward along
				// the ground: a bench pans over a body, not across a map.
				this.camera.pan(-dx * scale, 0);
				this.camera.target[1] = this.camera.target[1]! + dy * scale;
			} else {
				this.camera.orbit(-dx * ORBIT_RATE, dy * ORBIT_RATE);
			}
			this.options.onChange?.();
		});

		const release = (event: PointerEvent): void => {
			if (event.pointerId !== this.dragging) return;
			this.dragging = -1;
			this.panning = false;
		};
		this.on('pointerup', release);
		this.on('pointercancel', release);

		this.on(
			'wheel',
			(event) => {
				event.preventDefault();
				this.camera.dolly(Math.exp(event.deltaY * WHEEL_RATE));
				this.options.onChange?.();
			},
			{ passive: false },
		);
	}
}
