/*
 * Mouse and touch on an orbit camera, with the same gestures every lab uses:
 * drag to orbit, wheel or pinch to zoom, right-drag or two fingers to pan.
 *
 * Pointer events rather than mouse and touch separately, so a stylus and a
 * trackpad behave without a second code path.
 */

import type { OrbitCamera } from '@hexdelve/engine';

export interface OrbitControlsOptions {
	orbitSpeed?: number;
	zoomSpeed?: number;
	panSpeed?: number;
}

interface Pointer {
	x: number;
	y: number;
	button: number;
}

export class OrbitControls {
	private readonly element: HTMLElement;
	private readonly camera: OrbitCamera;
	private readonly orbitSpeed: number;
	private readonly zoomSpeed: number;
	private readonly panSpeed: number;

	private readonly pointers = new Map<number, Pointer>();
	private pinchDistance = 0;
	private disposed = false;

	constructor(element: HTMLElement, camera: OrbitCamera, options: OrbitControlsOptions = {}) {
		this.element = element;
		this.camera = camera;
		this.orbitSpeed = options.orbitSpeed ?? 0.005;
		this.zoomSpeed = options.zoomSpeed ?? 0.0012;
		this.panSpeed = options.panSpeed ?? 0.02;

		element.addEventListener('pointerdown', this.onPointerDown);
		element.addEventListener('pointermove', this.onPointerMove);
		element.addEventListener('pointerup', this.onPointerUp);
		element.addEventListener('pointercancel', this.onPointerUp);
		element.addEventListener('wheel', this.onWheel, { passive: false });
		element.addEventListener('contextmenu', this.onContextMenu);
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		const element = this.element;
		element.removeEventListener('pointerdown', this.onPointerDown);
		element.removeEventListener('pointermove', this.onPointerMove);
		element.removeEventListener('pointerup', this.onPointerUp);
		element.removeEventListener('pointercancel', this.onPointerUp);
		element.removeEventListener('wheel', this.onWheel);
		element.removeEventListener('contextmenu', this.onContextMenu);
		this.pointers.clear();
	}

	private readonly onPointerDown = (event: PointerEvent): void => {
		this.element.setPointerCapture(event.pointerId);
		this.pointers.set(event.pointerId, {
			x: event.clientX,
			y: event.clientY,
			button: event.button,
		});
		if (this.pointers.size === 2) this.pinchDistance = this.currentPinchDistance();
	};

	private readonly onPointerMove = (event: PointerEvent): void => {
		const previous = this.pointers.get(event.pointerId);
		if (!previous) return;

		const dx = event.clientX - previous.x;
		const dy = event.clientY - previous.y;
		previous.x = event.clientX;
		previous.y = event.clientY;

		if (this.pointers.size >= 2) {
			// Two fingers: the change in separation zooms, the shared motion pans.
			const distance = this.currentPinchDistance();
			if (this.pinchDistance > 0 && distance > 0) {
				this.camera.zoom(this.pinchDistance / distance);
			}
			this.pinchDistance = distance;
			this.camera.pan(-dx * this.panSpeed * 0.5, dy * this.panSpeed * 0.5);
			return;
		}

		// Right or middle button pans, anything else orbits.
		if (previous.button === 2 || previous.button === 1) {
			this.camera.pan(-dx * this.panSpeed, dy * this.panSpeed);
		} else {
			this.camera.orbit(-dx * this.orbitSpeed, dy * this.orbitSpeed);
		}
	};

	private readonly onPointerUp = (event: PointerEvent): void => {
		this.pointers.delete(event.pointerId);
		if (this.pointers.size < 2) this.pinchDistance = 0;
		if (this.element.hasPointerCapture(event.pointerId)) {
			this.element.releasePointerCapture(event.pointerId);
		}
	};

	private readonly onWheel = (event: WheelEvent): void => {
		event.preventDefault();
		this.camera.zoom(Math.exp(event.deltaY * this.zoomSpeed));
	};

	private readonly onContextMenu = (event: Event): void => {
		// Otherwise a right-drag to pan ends in a context menu.
		event.preventDefault();
	};

	private currentPinchDistance(): number {
		const [a, b] = [...this.pointers.values()];
		if (!a || !b) return 0;
		return Math.hypot(a.x - b.x, a.y - b.y);
	}
}
