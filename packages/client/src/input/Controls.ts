/*
 * One gesture, one order.
 *
 * Lab 09 spent the mouse on aiming — it owned his facing every frame, which is
 * why the camera had to be driven from somewhere else entirely and `WASD`
 * carried the walking. On a turn clock none of that is true. Facing follows
 * the hexagon he steps into, so the mouse has exactly one job left: say which
 * hexagon. That frees the drag, and the drag goes back to the camera, where
 * every lab in this project had it.
 *
 * So a press that does not move is an order and a press that moves is a look:
 *
 *   click / tap        the hexagon under it — walk there, pick that up, cut that
 *   drag               orbit
 *   wheel / pinch      zoom
 *   space              spend a turn standing still
 *   escape             forget where he was going
 *
 * Nothing here knows what a hexagon is, or that there is a grid at all. It
 * reports a press at a place on the screen; turning that into a cell is the
 * game's business, and the point on the ground under the cursor is asked for
 * by the caller rather than pushed at it — because orbiting the camera under a
 * still mouse moves the place it is over, so the question has to be re-asked
 * every frame rather than answered once on movement.
 *
 * Only the azimuth is draggable. The pitch is the isometric one and stays
 * there: a hexagon at that angle is the same hexagon wherever it sits on the
 * screen, which is the whole reason the labs chose it, and a drag that could
 * tilt out of it would let you lose that for nothing in return.
 */

import { ISO_PITCH, type OrbitCamera } from '@hexdelve/engine';

/**
 * How far a press may travel and still be a click, in CSS pixels. Small enough
 * that a deliberate drag is never an order, large enough that a shaky hand on a
 * trackpad is never a camera move.
 */
const DRAG_SLOP = 5;

/** Radians of azimuth per pixel dragged. */
const ORBIT_RATE = 0.008;

export interface ControlsOptions {
	/**
	 * A click or tap. The caller resolves what was under it, because the plane
	 * to intersect is a fact about the world and not about the pointer.
	 */
	onPick?: () => void;
	/** Space, or a tap with a second finger down: spend a turn doing nothing. */
	onHold?: () => void;
	/** Escape: drop the standing order. */
	onCancel?: () => void;
}

export class Controls {
	/** Where the mouse is, in client pixels, and whether it is over the canvas. */
	readonly pointer = { x: 0, y: 0, has: false };

	private readonly listeners: (() => void)[] = [];

	/** The press in progress, and whether it has travelled far enough to be a drag. */
	private readonly press = { id: -1, down: false, x: 0, y: 0, lastX: 0, lastY: 0, dragged: false };

	private readonly pinch = new Map<number, { x: number; y: number }>();
	private pinchDistance = 0;

	constructor(
		private readonly canvas: HTMLCanvasElement,
		private readonly camera: OrbitCamera,
		private readonly options: ControlsOptions = {},
	) {
		this.bind();
	}

	private on<K extends keyof WindowEventMap>(
		target: Window | HTMLCanvasElement,
		type: K,
		handler: (event: WindowEventMap[K]) => void,
		options?: AddEventListenerOptions,
	): void {
		const listener = handler as EventListener;
		target.addEventListener(type, listener, options);
		this.listeners.push(() => target.removeEventListener(type, listener, options));
	}

	private bind(): void {
		this.on(window, 'keydown', (event) => {
			if (event.code === 'Space') {
				event.preventDefault();
				if (!event.repeat) this.options.onHold?.();
				return;
			}
			if (event.code === 'Escape') {
				this.options.onCancel?.();
			}
		});

		this.on(this.canvas, 'contextmenu', (event) => event.preventDefault());

		this.on(this.canvas, 'pointerdown', (event) => {
			this.canvas.setPointerCapture(event.pointerId);

			if (event.pointerType !== 'mouse') {
				this.pinch.set(event.pointerId, { x: event.clientX, y: event.clientY });
				// A second finger belongs to the camera, so it takes the press
				// away rather than fighting it — a pinch is never also a tap.
				if (this.press.down) {
					this.press.down = false;
					this.press.dragged = true;
					return;
				}
			} else if (event.button !== 0) {
				return;
			}

			this.pointer.x = event.clientX;
			this.pointer.y = event.clientY;
			this.pointer.has = true;

			this.press.id = event.pointerId;
			this.press.down = true;
			this.press.dragged = false;
			this.press.x = event.clientX;
			this.press.y = event.clientY;
			this.press.lastX = event.clientX;
			this.press.lastY = event.clientY;
		});

		this.on(this.canvas, 'pointermove', (event) => {
			if (event.pointerType === 'mouse') {
				this.pointer.x = event.clientX;
				this.pointer.y = event.clientY;
				this.pointer.has = true;
			}

			if (this.pinch.has(event.pointerId)) {
				this.pinch.set(event.pointerId, { x: event.clientX, y: event.clientY });
			}

			// Two fingers: pinch to zoom rather than orbit.
			if (this.pinch.size >= 2) {
				const [a, b] = [...this.pinch.values()];
				const distance = Math.hypot(a!.x - b!.x, a!.y - b!.y);
				if (this.pinchDistance > 0 && distance > 0) {
					this.camera.dolly(this.pinchDistance / distance);
				}
				this.pinchDistance = distance;
				return;
			}

			if (!this.press.down || event.pointerId !== this.press.id) return;

			if (
				!this.press.dragged &&
				Math.hypot(event.clientX - this.press.x, event.clientY - this.press.y) > DRAG_SLOP
			) {
				this.press.dragged = true;
			}
			if (this.press.dragged) {
				// Azimuth only. See the note at the top of the file.
				this.camera.orbit(-(event.clientX - this.press.lastX) * ORBIT_RATE, 0);
			}
			this.press.lastX = event.clientX;
			this.press.lastY = event.clientY;
		});

		const release = (event: PointerEvent): void => {
			this.pinch.delete(event.pointerId);
			if (this.pinch.size < 2) this.pinchDistance = 0;

			if (!this.press.down || event.pointerId !== this.press.id) return;
			this.press.down = false;
			// A press that never travelled is an order. On release rather than
			// on press, because until it comes up there is no telling it from
			// the beginning of a camera drag.
			if (!this.press.dragged) this.options.onPick?.();
		};

		this.on(this.canvas, 'pointerup', release);
		this.on(this.canvas, 'pointercancel', release);

		this.on(this.canvas, 'pointerleave', (event) => {
			if (event.pointerType === 'mouse') this.pointer.has = false;
		});

		this.on(
			this.canvas,
			'wheel',
			(event) => {
				event.preventDefault();
				this.camera.dolly(Math.exp(event.deltaY * 0.0012));
			},
			{ passive: false },
		);
	}

	/**
	 * Where the cursor is on the ground he is standing on.
	 *
	 * Re-asked every frame rather than on movement, because orbiting the camera
	 * under a still mouse moves the point it is over — the cursor is over a
	 * place in the world, not a place on the screen.
	 *
	 * The arithmetic belongs to the camera, which is the one thing that knows
	 * how it is pointed. Doing it here as well, from the yaw and pitch, is how
	 * this shipped with the aim tracking sideways correctly and moving only a
	 * third as far up and down.
	 */
	aimOnPlane(planeY: number): { x: number; z: number } | null {
		if (!this.pointer.has) return null;

		const rect = this.canvas.getBoundingClientRect();
		if (rect.width === 0 || rect.height === 0) return null;

		const ndcX = ((this.pointer.x - rect.left) / rect.width) * 2 - 1;
		const ndcY = -((this.pointer.y - rect.top) / rect.height) * 2 + 1;

		return this.camera.groundPoint(ndcX, ndcY, rect.width / rect.height, planeY);
	}

	dispose(): void {
		for (const off of this.listeners) off();
		this.listeners.length = 0;
	}
}

export { ISO_PITCH };
