/*
 * labs/shared/ui.js — the shell every lab shares: the notes panel, and the
 * camera gestures.
 *
 * Every lab had its own copy of the same forty lines of pointer handling, which
 * was fine while they only had to answer a mouse. Touch is where that stopped
 * being fine: a phone has no right button, no wheel and no hover, so the same
 * three gestures have to be built out of one and two fingers — and fixing that
 * seven times over is how six of them would quietly drift out of step.
 *
 * The camera model is the one thing the labs already agreed on:
 *
 *   view = { azimuth, target: Vector3, zoom, zoomGoal }
 *
 * so this module drives that and calls back for whatever is lab-specific: the
 * zoom limits, whether the target is fenced in, what a tap means, and what to
 * do when the user takes the camera off a character it was following.
 */

var Hexdelve = Hexdelve || {};

Hexdelve.ui = (function () {
'use strict';

// A finger never lands as still as a mouse, so it gets more room to be a tap.
const TAP_SLOP = { mouse: 5, touch: 12 };

/**
 * The notes panel, as a disclosure.
 *
 * It explains the scene, so on a desktop it can sit open beside it — but on a
 * phone it would cover the thing it is describing. So it starts as its own
 * title bar and opens when asked, and `?panel=1` opens it on load.
 */
function attachPanel(options) {
	const opts = options || {};
	const panel = document.getElementById(opts.panel || 'panel');
	const toggle = document.getElementById(opts.toggle || 'panelToggle');
	if (!panel || !toggle) return null;

	function set(open) {
		panel.classList.toggle('collapsed', !open);
		toggle.setAttribute('aria-expanded', String(open));
	}

	toggle.addEventListener('click', function () {
		set(panel.classList.contains('collapsed'));
	});

	const qs = new URLSearchParams(location.search);
	if (qs.has('panel')) set(qs.get('panel') !== '0');

	return { set: set, isOpen: function () { return !panel.classList.contains('collapsed'); } };
}

/**
 * The zoom to open at, for the window we actually have.
 *
 * The orthographic frustum is sized from the viewport height, so the width
 * falls away with the aspect ratio: a setting framed on a desktop window puts
 * two hexagons on a portrait phone. Below `threshold` the zoom follows the
 * aspect ratio down, to a floor, so a narrow screen opens on a scene.
 */
function startZoom(zoom, threshold) {
	const t = threshold || 1.2;
	const aspect = window.innerWidth / window.innerHeight;
	if (aspect >= t) return zoom;
	return Math.max(zoom * 0.52, zoom * (aspect / t));
}

/**
 * Orbit, pan and zoom on one canvas, from a mouse or from fingers.
 *
 *   one pointer          drag to orbit; press and release without moving is a tap
 *   right / shift drag   pan
 *   two pointers         pinch to zoom, drag to pan — the phone's right button
 *                        and wheel in one gesture
 *
 * @param {HTMLCanvasElement} canvas
 * @param {object} view    { azimuth, target, zoom, zoomGoal }, driven in place
 * @param {object} options
 *   applyCamera   required; called whenever the view changes
 *   viewHeight    world half-height at zoom 1 (the lab's VIEW)
 *   pitch         camera elevation in radians (the lab's ISO_PITCH)
 *   zoom          [min, max]
 *   onPan         called as a pan begins — labs that follow a character use
 *                 this to let go of it
 *   clampTarget   called with view.target after it moves, to fence it in
 *   onTap         (clientX, clientY, pointerType) for labs that pick
 *   onHover       (clientX, clientY) — mouse only; a finger cannot hover
 *   onHoverEnd    called when the mouse leaves, or a tap ends
 */
function attachView(canvas, view, options) {
	const o = options || {};
	const applyCamera = o.applyCamera;
	const viewHeight = o.viewHeight;
	const pitch = o.pitch;
	const zoomRange = o.zoom || [0.6, 4];

	const drag = { active: false, pan: false, moved: 0, x: 0, y: 0, slop: TAP_SLOP.mouse };
	const pointers = new Map();
	const pinch = { active: false, distance: 0, x: 0, y: 0 };
	const fwd = new THREE.Vector3();
	const right = new THREE.Vector3();

	function setZoom(z) {
		view.zoomGoal = Math.max(zoomRange[0], Math.min(zoomRange[1], z));
	}

	// Move the target in the ground plane, by a screen-space delta.
	function panView(dx, dy) {
		if (o.onPan) o.onPan();
		const scale = (2 * viewHeight) / (window.innerHeight * view.zoom);
		fwd.set(-Math.cos(view.azimuth), 0, -Math.sin(view.azimuth));
		right.set(-Math.sin(view.azimuth), 0, Math.cos(view.azimuth));
		view.target.addScaledVector(right, -dx * scale);
		view.target.addScaledVector(fwd, (dy * scale) / Math.sin(pitch));
		if (o.clampTarget) o.clampTarget(view.target);
	}

	function pinchState() {
		const points = [];
		pointers.forEach(function (p) { points.push(p); });
		const a = points[0];
		const b = points[1];
		return {
			distance: Math.hypot(a.x - b.x, a.y - b.y),
			x: (a.x + b.x) / 2,
			y: (a.y + b.y) / 2,
		};
	}

	canvas.addEventListener('pointerdown', function (e) {
		pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
		canvas.setPointerCapture(e.pointerId);

		if (pointers.size === 2) {
			// The second finger cancels whatever the first was doing: a pinch is
			// never also a tap, and must not leave a click queued behind it.
			const p = pinchState();
			pinch.active = true;
			pinch.distance = p.distance;
			pinch.x = p.x;
			pinch.y = p.y;
			drag.active = false;
			drag.moved = Infinity;
			canvas.classList.remove('dragging');
			return;
		}
		if (pointers.size > 2) return;

		drag.active = true;
		drag.slop = e.pointerType === 'mouse' ? TAP_SLOP.mouse : TAP_SLOP.touch;
		drag.pan = e.button === 2 || e.shiftKey;
		drag.moved = 0;
		drag.x = e.clientX;
		drag.y = e.clientY;
	});

	canvas.addEventListener('pointermove', function (e) {
		if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

		if (pinch.active && pointers.size >= 2) {
			const p = pinchState();
			if (pinch.distance > 0) setZoom(view.zoomGoal * (p.distance / pinch.distance));
			view.zoom = view.zoomGoal; // a pinch is direct, not eased
			panView(p.x - pinch.x, p.y - pinch.y);
			pinch.distance = p.distance;
			pinch.x = p.x;
			pinch.y = p.y;
			applyCamera();
			return;
		}

		if (!drag.active) {
			// Hover is a mouse idea; a finger only "hovers" while it is pressed.
			if (o.onHover && e.pointerType === 'mouse') o.onHover(e.clientX, e.clientY);
			return;
		}

		const dx = e.clientX - drag.x;
		const dy = e.clientY - drag.y;
		drag.moved += Math.abs(dx) + Math.abs(dy);
		drag.x = e.clientX;
		drag.y = e.clientY;
		if (drag.moved > drag.slop) canvas.classList.add('dragging');
		if (drag.pan) panView(dx, dy);
		else view.azimuth += dx * 0.007;
		applyCamera();
	});

	function release(e) {
		pointers.delete(e.pointerId);
		if (pointers.size < 2) pinch.active = false;
		drag.active = false;
		canvas.classList.remove('dragging');
	}

	canvas.addEventListener('pointercancel', release);

	canvas.addEventListener('pointerup', function (e) {
		const wasTap = drag.active && drag.moved <= drag.slop && !drag.pan;
		const touch = e.pointerType !== 'mouse';
		release(e);
		// A tap leaves no cursor behind, so the hover marker goes with the finger.
		if (touch && o.onHoverEnd) o.onHoverEnd();
		if (wasTap && o.onTap) o.onTap(e.clientX, e.clientY, e.pointerType);
	});

	canvas.addEventListener('pointerleave', function (e) {
		if (e.pointerType === 'mouse' && o.onHoverEnd) o.onHoverEnd();
	});

	canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });

	canvas.addEventListener(
		'wheel',
		function (e) {
			e.preventDefault();
			setZoom(view.zoomGoal * Math.exp(-e.deltaY * 0.0012));
		},
		{ passive: false },
	);

	return { setZoom: setZoom, panView: panView };
}

return { attachPanel: attachPanel, attachView: attachView, startZoom: startZoom };
})();
