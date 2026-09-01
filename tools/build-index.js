/*
 * tools/build-index.js — generate the landing page from the labs themselves.
 *
 * There is no build step in this project: the labs are plain files and Three.js
 * comes from a CDN. The one thing worth generating is the index, because every
 * lab already carries its own title, heading and description in its markup —
 * so listing them by hand would be the same text written twice, drifting apart.
 *
 *   node tools/build-index.js
 *
 * Writes index.html at the repo root. Run it after adding or renaming a lab;
 * CI regenerates it before publishing, so the deployed page is never stale.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const labsDir = path.join(root, 'labs');

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ' };

// Markup to readable prose: drop tags, decode the few entities we use, and
// collapse the whitespace that came from source indentation.
function text(html) {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&([a-z]+|#\d+);/gi, function (m, e) {
      const k = e.toLowerCase();
      return ENTITIES[k] === undefined ? m : ENTITIES[k];
    })
    .replace(/\s+/g, ' ')
    .trim();
}

// A lab's blurb is written for the running page, so it contains placeholders
// the page fills in at load — "<span id="count">…</span> of them". Scraped
// verbatim those read as stray ellipses, so keep only the first line, drop any
// parenthetical built around a placeholder, then drop the placeholders left.
function blurb(html) {
  const firstLine = html.split(/<br\s*\/?>/i)[0];
  const cleaned = firstLine
    .replace(/\([^()]*<span[^>]*>[^<]*<\/span>[^()]*\)/g, '')
    .replace(/<span[^>]*>[^<]*<\/span>/g, '');
  return text(cleaned).replace(/\s+([,.:;])/g, '$1');
}

function escape(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function readLab(dir) {
  const file = path.join(labsDir, dir, 'index.html');
  if (!fs.existsSync(file)) return null;
  const html = fs.readFileSync(file, 'utf8');

  const rawTitle = (html.match(/<title>([\s\S]*?)<\/title>/i) || [, dir])[1];
  const title = text(rawTitle).replace(/^Hexdelve\s*[—-]\s*/, '');
  const heading = text((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [, title])[1]);
  const sub = blurb((html.match(/<p class="sub">([\s\S]*?)<\/p>/i) || [, ''])[1]);

  return { dir: dir, title: title, heading: heading, sub: sub };
}

const labs = fs
  .readdirSync(labsDir, { withFileTypes: true })
  .filter(function (e) { return e.isDirectory() && /^\d/.test(e.name); })
  .map(function (e) { return e.name; })
  .sort()
  .map(readLab)
  .filter(Boolean);

const cards = labs
  .map(function (lab) {
    const number = (lab.heading.match(/Lab\s+(\d+)/i) || [, ''])[1];
    const name = lab.heading.replace(/^Lab\s+\d+\s*[—-]\s*/i, '');
    return [
      '\t\t\t<a class="lab" href="labs/' + lab.dir + '/index.html">',
      '\t\t\t\t<span class="num">' + escape(number) + '</span>',
      '\t\t\t\t<span class="body">',
      '\t\t\t\t\t<span class="name">' + escape(name) + '</span>',
      '\t\t\t\t\t<span class="desc">' + escape(lab.sub) + '</span>',
      '\t\t\t\t</span>',
      '\t\t\t</a>',
    ].join('\n');
  })
  .join('\n');

const page = `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="utf-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1" />
	<title>Hexdelve — hexagon game-world labs</title>
	<style>
		* { margin: 0; padding: 0; box-sizing: border-box; }
		body {
			min-height: 100%;
			font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
			color: #2c3a2e;
			background: radial-gradient(ellipse 120% 90% at 50% 15%, #dfeae0 0%, #c4d6c8 55%, #a9c0b0 100%);
			padding: 48px 24px 64px;
		}
		main { max-width: 760px; margin: 0 auto; }
		h1 { font-size: 30px; font-weight: 680; letter-spacing: -0.01em; }
		.tag { margin-top: 8px; font-size: 14px; line-height: 1.55; color: #55645a; }
		.tag b { color: #3d5136; font-weight: 620; }
		h2 {
			margin: 34px 0 12px; font-size: 11px; font-weight: 650;
			text-transform: uppercase; letter-spacing: 0.08em; color: #6b7a70;
		}
		.lab {
			display: flex; gap: 14px; align-items: flex-start;
			padding: 13px 15px; margin-bottom: 8px;
			text-decoration: none; color: inherit;
			background: rgba(252, 253, 250, 0.82);
			border: 1px solid rgba(60, 80, 60, 0.14);
			border-radius: 10px;
			transition: transform .12s ease, box-shadow .12s ease, border-color .12s ease;
		}
		.lab:hover {
			transform: translateY(-1px);
			border-color: rgba(92, 122, 60, 0.5);
			box-shadow: 0 5px 16px rgba(30, 50, 35, 0.13);
		}
		.num {
			flex: 0 0 34px; height: 34px; border-radius: 8px;
			display: grid; place-items: center;
			background: #5c7a3c; color: #fff;
			font-size: 13px; font-weight: 650; font-variant-numeric: tabular-nums;
		}
		.body { display: block; }
		.name { display: block; font-size: 14.5px; font-weight: 620; margin-bottom: 3px; }
		.desc { display: block; font-size: 12.5px; line-height: 1.5; color: #55645a; }
		footer { margin-top: 34px; font-size: 12px; line-height: 1.6; color: #7a887e; }
		footer a { color: #4a7a3c; }
		code {
			font-family: ui-monospace, "Cascadia Code", Consolas, monospace;
			font-size: 11.5px; background: rgba(60, 80, 60, 0.09);
			padding: 1px 5px; border-radius: 4px;
		}
	</style>
</head>
<body>
	<main>
		<h1>Hexdelve</h1>
		<p class="tag">Hexagon experiments on a flat plane, viewed isometrically. Every
			object in every scene is a <b>hexagonal prism</b> — the terrain, the buildings,
			the characters, the helmet, the smoke. Each lab is a standalone page with no build step.</p>

		<h2>Labs</h2>
${cards}

		<footer>
			Open any lab and drag to orbit, wheel to zoom, right-drag to pan. Most read
			their initial state from the query string, e.g.
			<code>labs/04-blend-tree/index.html?speed=1.4&amp;skel=1</code>.
			<br />Source on <a href="https://github.com/KristoferBorgware/hexdelve">GitHub</a>.
		</footer>
	</main>
</body>
</html>
`;

fs.writeFileSync(path.join(root, 'index.html'), page);
console.log('index.html written — ' + labs.length + ' labs');
