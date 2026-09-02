/*
 * Two devices, one intention.
 *
 * A keyboard says which way to travel relative to where he is looking and a
 * mouse says where that is; a thumb has to say both at once, so on a touch
 * screen the stick sets the facing as well and the two come back together.
 * Nothing downstream knows which of them is driving: both end up as a heading
 * and a throttle, and the game reads only that.
 *
 * The camera is here too, because orbiting it changes what A and D mean — they
 * are the screen's axes, and the screen is wherever the camera is looking.
 */

import { ISO_PITCH, type OrbitCamera } from '@hexdelve/engine';

const STICK_DEAD = 9;
const STICK_FULL = 62;

export interface ControlsOptions {
	/** Called on a click or a tap that was not a drag, and on space. */
	onStrike?: () => void;
	/** Called when the user takes the camera somewhere themselves. */
	onPan?: () => void;
}

const BINDINGS: Record<string, keyof KeyState> = {
	KeyW: 'forward',
	ArrowUp: 'forward',
	KeyS: 'back',
	ArrowDown: 'back',
	KeyA: 'left',
	ArrowLeft: 'left',
	KeyD: 'right',
	ArrowRight: 'right',
	ShiftLeft: 'run',
	ShiftRight: 'run',
	KeyQ: 'camLeft',
	KeyE: 'camRight',
};

interface KeyState {
	forward: number;
	back: number;
	left: number;
	right: number;
	run: number;
	camLeft: number;
	camRight: number;
}

export class Controls {
	readonly keys: KeyState = {
		forward: 0,
		back: 0,
		left: 0,
		right: 0,
		run: 0,
		camLeft: 0,
		camRight: 0,
	};

	/** Where the mouse is, in client pixels, and whether it is over the canvas. */
	readonly pointer = { x: 0, y: 0, has: false };

	readonly stick = { active: false, id: -1, ox: 0, oy: 0, x: 0, z: 0, throttle: 0 };

	private readonly listeners: (() => void)[] = [];
	private dragging = false;
	private dragButton = -1;
	private dragged = false;
	private lastX = 0;
	private lastY = 0;
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
				if (!event.repeat) this.options.onStrike?.();
				return;
			}
			const bind = BINDINGS[event.code];
			if (!bind) return;
			event.preventDefault();
			this.keys[bind] = 1;
		});

		this.on(window, 'keyup', (event) => {
			const bind = BINDINGS[event.code];
			if (bind) this.keys[bind] = 0;
		});

		// A key held while the window loses focus is a key that never comes up.
		this.on(window, 'blur', () => {
			for (const key of Object.keys(this.keys) as (keyof KeyState)[]) this.keys[key] = 0;
		});

		this.on(this.canvas, 'contextmenu', (event) => event.preventDefault());

		this.on(this.canvas, 'pointerdown', (event) => {
			this.canvas.setPointerCapture(event.pointerId);

			if (event.pointerType !== 'mouse') {
				this.pinch.set(event.pointerId, { x: event.clientX, y: event.clientY });
				// A second finger belongs to the camera, so it takes the stick
				// away rather than fighting it.
				if (this.stick.active) {
					this.endStick();
					return;
				}
				this.stick.active = true;
				this.stick.id = event.pointerId;
				this.stick.ox = event.clientX;
				this.stick.oy = event.clientY;
				this.stick.throttle = 0;
				return;
			}

			this.dragging = true;
			this.dragButton = event.button;
			this.dragged = false;
			this.lastX = event.clientX;
			this.lastY = event.clientY;
		});

		this.on(this.canvas, 'pointermove', (event) => {
			if (event.pointerType === 'mouse') {
				this.pointer.x = event.clientX;
				this.pointer.y = event.clientY;
				this.pointer.has = true;

				if (this.dragging) {
					const dx = event.clientX - this.lastX;
					const dy = event.clientY - this.lastY;
					this.lastX = event.clientX;
					this.lastY = event.clientY;
					if (Math.abs(dx) + Math.abs(dy) > 2) this.dragged = true;

					if (this.dragButton === 2) {
						this.camera.pan(-dx * 0.012, dy * 0.012);
						this.options.onPan?.();
					} else {
						this.camera.orbit(-dx * 0.006, 0);
					}
				}
				return;
			}

			if (this.pinch.has(event.pointerId)) {
				this.pinch.set(event.pointerId, { x: event.clientX, y: event.clientY });
			}

			// Two fingers: pinch to zoom rather than steer.
			if (this.pinch.size >= 2) {
				const [a, b] = [...this.pinch.values()];
				const distance = Math.hypot(a!.x - b!.x, a!.y - b!.y);
				if (this.pinchDistance > 0 && distance > 0) {
					this.camera.dolly(this.pinchDistance / distance);
				}
				this.pinchDistance = distance;
				return;
			}

			if (!this.stick.active || event.pointerId !== this.stick.id) return;

			const dx = event.clientX - this.stick.ox;
			const dy = event.clientY - this.stick.oy;
			const len = Math.hypot(dx, dy);
			this.stick.throttle = clamp((len - STICK_DEAD) / (STICK_FULL - STICK_DEAD), 0, 1);
			if (this.stick.throttle > 0) {
				// Screen to ground, through the camera: up the screen is away
				// from it, and right is the camera's own X axis, (sin, -cos) of
				// the azimuth.
				const ux = dx / len;
				const uy = dy / len;
				const rx = Math.sin(this.camera.yaw);
				const rz = -Math.cos(this.camera.yaw);
				const fx = -Math.cos(this.camera.yaw);
				const fz = -Math.sin(this.camera.yaw);
				this.stick.x = rx * ux - fx * uy;
				this.stick.z = rz * ux - fz * uy;
			}
		});

		const release = (event: PointerEvent): void => {
			this.pinch.delete(event.pointerId);
			if (this.pinch.size < 2) this.pinchDistance = 0;

			if (event.pointerType === 'mouse') {
				if (this.dragging && !this.dragged && this.dragButton === 0) {
					this.options.onStrike?.();
				}
				this.dragging = false;
				this.dragButton = -1;
				return;
			}
			if (event.pointerId === this.stick.id) this.endStick();
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

	private endStick(): void {
		this.stick.active = false;
		this.stick.id = -1;
		this.stick.throttle = 0;
	}

	/** Q and E turn the camera; they are the only keys it owns. */
	updateCamera(dt: number): void {
		if (this.keys.camLeft || this.keys.camRight) {
			this.camera.yaw += (this.keys.camRight - this.keys.camLeft) * 1.6 * dt;
		}
	}

	/**
	 * Where the cursor is on the ground he is standing on.
	 *
	 * Re-asked every frame rather than on movement, because orbiting the camera
	 * under a still mouse moves the point it is over — the cursor is over a
	 * place in the world, not a place on the screen.
	 *
	 * The camera is orthographic, so every ray through the viewport is parallel
	 * and the arithmetic is a plane offset rather than a projection: the point
	 * on the screen maps to a point on the camera's own right and up axes, and
	 * the ray from there along the view direction meets the plane once.
	 */
	aimOnPlane(planeY: number): { x: number; z: number } | null {
		if (!this.pointer.has) return null;

		const rect = this.canvas.getBoundingClientRect();
		if (rect.width === 0 || rect.height === 0) return null;

		const ndcX = ((this.pointer.x - rect.left) / rect.width) * 2 - 1;
		const ndcY = -((this.pointer.y - rect.top) / rect.height) * 2 + 1;

		const halfHeight = this.camera.viewHeight / this.camera.zoom;
		const halfWidth = halfHeight * (rect.width / rect.height);

		const yaw = this.camera.yaw;
		const pitch = this.camera.pitch;

		// The camera's basis. Forward is from the eye towards the target.
		const fx = -Math.cos(pitch) * Math.sin(yaw);
		const fy = -Math.sin(pitch);
		const fz = -Math.cos(pitch) * Math.cos(yaw);
		const rx = Math.cos(yaw);
		const rz = -Math.sin(yaw);
		const ux = -Math.sin(pitch) * Math.sin(yaw) * -1;
		const uy = Math.cos(pitch);
		const uz = -Math.sin(pitch) * Math.cos(yaw) * -1;

		const eye = this.camera.eye();
		const ox = eye[0]! + rx * ndcX * halfWidth + ux * ndcY * halfHeight;
		const oy = eye[1]! + uy * ndcY * halfHeight;
		const oz = eye[2]! + rz * ndcX * halfWidth + uz * ndcY * halfHeight;

		if (Math.abs(fy) < 1e-6) return null;
		const t = (planeY - oy) / fy;
		if (t < 0) return null;

		return { x: ox + fx * t, z: oz + fz * t };
	}

	dispose(): void {
		for (const off of this.listeners) off();
		this.listeners.length = 0;
	}
}

export { ISO_PITCH };

function clamp(v: number, lo: number, hi: number): number {
	return v < lo ? lo : v > hi ? hi : v;
}
