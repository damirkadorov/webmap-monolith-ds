import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MONOLITH_DIR = process.env.MONOLITH_DIR || 'D:\\mk\\Monolith-DS';
const WEBMAP_DIR = path.resolve(__dirname, '..');
const STATIC_DIR = path.join(WEBMAP_DIR, 'static');
const OUTPUT_FILE = path.join(WEBMAP_DIR, 'src', 'lib', 'data', 'shuttles.json');

// --- Helper: Find files recursively ---
function walkDir(dir, filterFn, list = []) {
	if (!fs.existsSync(dir)) return list;
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			walkDir(full, filterFn, list);
		} else if (filterFn(entry.name)) {
			list.push(full);
		}
	}
	return list;
}

// --- 1. Load Fluent translations ---
function loadFluentTranslations() {
	const translations = new Map();
	const localeDirs = [
		path.join(MONOLITH_DIR, 'Resources', 'Locale', 'ru-RU'),
		path.join(MONOLITH_DIR, 'Resources', 'Locale', 'en-US')
	];

	for (const locDir of localeDirs) {
		const files = walkDir(locDir, (f) => f.endsWith('.ftl'));
		for (const file of files) {
			try {
				let content = fs.readFileSync(file, 'utf-8').replace(/^\uFEFF/, '');
				const lines = content.split(/\r?\n/);
				let currentKey = null;
				let currentValue = '';

				for (const rawLine of lines) {
					const trimmed = rawLine.trim();
					if (!trimmed || trimmed.startsWith('#')) continue;

					const match = rawLine.match(/^([a-zA-Z0-9_-]+)\s*=\s*(.*)$/);
					if (match) {
						if (currentKey && !translations.has(currentKey)) {
							translations.set(currentKey, currentValue.trim());
						}
						currentKey = match[1];
						currentValue = match[2];
					} else if (currentKey && (rawLine.startsWith(' ') || rawLine.startsWith('\t'))) {
						currentValue += ' ' + trimmed;
					}
				}
				if (currentKey && !translations.has(currentKey)) {
					translations.set(currentKey, currentValue.trim());
				}
			} catch (e) {
				console.warn(`Could not parse ${file}: ${e.message}`);
			}
		}
	}

	console.log(`Loaded ${translations.size} Fluent translation strings.`);
	return translations;
}

// --- 2. Hull class & Role categorization ---
const HULL_CLASSES = new Set([
	'battleship',
	'carrier',
	'cruiser',
	'destroyer',
	'frigate',
	'corvette',
	'fighter',
	'shuttle',
	'station'
]);

function normalizeGroup(g) {
	const lower = (g || '').toLowerCase().trim();
	if (lower === 'ussp') return 'ussp';
	if (lower === 'security') return 'security';
	if (lower === 'sr') return 'sr';
	if (lower === 'blackmarket' || lower === 'pirate') return 'blackmarket';
	if (lower === 'syndicate') return 'syndicate';
	if (lower === 'expedition') return 'expedition';
	if (lower === 'medical') return 'medical';
	if (lower === 'shipyard') return 'shipyard';
	if (lower === 'scrap' || lower === 'scrapyard') return 'scrapyard';
	if (lower === 'custom') return 'custom';
	if (lower === 'eighth_fleet' || lower === 'eighthfleet') return 'eighth_fleet';
	if (lower === 'hostile_ai') return 'hostile_ai';
	if (lower === 'station') return 'station';
	return lower || 'shipyard';
}

function normalizeSize(s) {
	const lower = (s || '').toLowerCase().trim();
	if (lower === 'micro') return 'micro';
	if (lower === 'small') return 'small';
	if (lower === 'medium') return 'medium';
	if (lower === 'large') return 'large';
	return 'medium';
}

function resolveImage(id, shuttlePath) {
	const staticFiles = new Set(fs.readdirSync(STATIC_DIR).map((f) => f.toLowerCase()));

	const idClean = id.toLowerCase().replace(/[^a-z0-9_-]/g, '');
	const idUnderscores = idClean.replace(/-/g, '_');
	const idHyphens = idClean.replace(/_/g, '-');

	let pathBase = '';
	if (shuttlePath) {
		pathBase = path.basename(shuttlePath, '.yml').toLowerCase();
	}

	const candidates = [
		`${idClean}-0.png`,
		`${idClean}.png`,
		`${idUnderscores}-0.png`,
		`${idUnderscores}.png`,
		`${idHyphens}-0.png`,
		`${idHyphens}.png`,
		pathBase ? `${pathBase}-0.png` : null,
		pathBase ? `${pathBase}.png` : null,
		pathBase ? `${pathBase.replace(/-/g, '_')}-0.png` : null,
		pathBase ? `${pathBase.replace(/_/g, '-')}-0.png` : null
	].filter(Boolean);

	for (const candidate of candidates) {
		if (staticFiles.has(candidate.toLowerCase())) {
			return `/${candidate}`;
		}
	}

	return '/atom.png';
}

// --- 3. Parse Vessels from Prototypes ---
function parseVesselPrototypes(fluent) {
	const protoFiles = walkDir(path.join(MONOLITH_DIR, 'Resources', 'Prototypes'), (f) =>
		f.endsWith('.yml')
	);

	const vessels = [];

	for (const file of protoFiles) {
		const content = fs.readFileSync(file, 'utf-8');
		if (!content.includes('type: vessel')) continue;

		// Split into documents or blocks
		const docs = content.split(/^-\s*type:\s*/m);

		for (const doc of docs) {
			if (!doc.startsWith('vessel')) continue;

			// Extract fields
			const idMatch = doc.match(/\bid:\s*([^\r\n#]+)/);
			if (!idMatch) continue;
			const id = idMatch[1].trim();

			const nameMatch = doc.match(/\bname:\s*([^\r\n#]+)/);
			const rawName = nameMatch ? nameMatch[1].trim().replace(/^['"]|['"]$/g, '') : id;

			const descMatch = doc.match(/\bdescription:\s*([^\r\n#]+)/);
			const rawDesc = descMatch ? descMatch[1].trim().replace(/^['"]|['"]$/g, '') : '';

			const priceMatch = doc.match(/\bprice:\s*(\d+)/);
			const price = priceMatch ? parseInt(priceMatch[1], 10) : 0;

			const groupMatch = doc.match(/\bgroup:\s*([^\r\n#]+)/);
			const group = groupMatch ? normalizeGroup(groupMatch[1].trim()) : 'shipyard';

			const categoryMatch = doc.match(/\bcategory:\s*([^\r\n#]+)/);
			const size = categoryMatch ? normalizeSize(categoryMatch[1].trim()) : 'medium';

			const shuttlePathMatch = doc.match(/\bshuttlePath:\s*([^\r\n#]+)/);
			const shuttlePath = shuttlePathMatch ? shuttlePathMatch[1].trim() : '';

			// Parse classes / roles / hullClass
			const classBlockMatch = doc.match(/\bclass:\s*\r?\n((\s*-\s*[^\r\n#]+\r?\n)+)/);
			const rawClasses = [];
			if (classBlockMatch) {
				const items = classBlockMatch[1].match(/-\s*([^\r\n#]+)/g);
				if (items) {
					items.forEach((item) => rawClasses.push(item.replace(/^-\s*/, '').trim().toLowerCase()));
				}
			}

			// Engine
			const engineBlockMatch = doc.match(/\bengine:\s*\r?\n((\s*-\s*[^\r\n#]+\r?\n)+)/);
			const engines = [];
			if (engineBlockMatch) {
				const items = engineBlockMatch[1].match(/-\s*([^\r\n#]+)/g);
				if (items) {
					items.forEach((item) => engines.push(item.replace(/^-\s*/, '').trim().toLowerCase()));
				}
			}

			// Determine hullClass vs role classes
			let hullClass = 'shuttle';
			const roles = [];

			for (const c of rawClasses) {
				if (HULL_CLASSES.has(c)) {
					hullClass = c;
				} else if (c === 'capital') {
					hullClass = 'battleship';
				} else {
					roles.push(c);
				}
			}

			// If no explicit hullClass found, infer from size
			if (hullClass === 'shuttle') {
				if (size === 'large') hullClass = 'corvette';
				else if (size === 'small' || size === 'micro') hullClass = 'fighter';
			}

			// Resolve name & description via Fluent
			let resolvedName = fluent.get(rawName) || rawName;
			let resolvedDesc = fluent.get(rawDesc) || rawDesc;

			// If name is still an unresolved key like "vessel-foo-name", humanize id
			if (/^[a-z0-9_-]+(-name)?$/.test(resolvedName) && resolvedName.includes('-')) {
				resolvedName = id
					.split(/[-_]+/)
					.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
					.join(' ');
			}

			const image = resolveImage(id, shuttlePath);

			vessels.push({
				id,
				name: resolvedName,
				description: resolvedDesc,
				price,
				group,
				hullClass,
				size,
				classes: roles,
				engines,
				image
			});
		}
	}

	console.log(`Extracted ${vessels.length} vessel prototypes.`);
	return vessels;
}

// --- 4. Parse POI Stations ---
const KNOWN_POI_NAMES = {
	'pdvhelios.yml': 'ДФ | Крепость Гелиос',
	'camelot.yml': 'Форт Камелот',
	'sevastopol.yml': 'Дата-центр Севастополь',
	'tsfmchalcyon.yml': 'КВП | Флагман Фалкон',
	'tsfmcoutpost.yml': 'ДФ-ГРАЖД | Аванпост гражданских ДФ',
	'usspbaikal.yml': 'СССП | Станция Байкал',
	'anomalouslab.yml': 'Лаборатория Аномалий',
	'derelictdrillsite.yml': 'Брошенный Буровой Комплекс',
	'beaconstation_a.yml': 'INSO-357k Asteroid Cluster',
	'beaconstation_wilds.yml': 'LINEAR-21 Asteroid Cluster',
	'surface_outpost_desert.yml': 'Пустынный Аванпост',
	'jupiter.yml': 'ДФ | Авианосец класса «Юпитер»'
};

function parsePoiStations() {
	const poiDir = path.join(MONOLITH_DIR, 'Resources', 'Maps', '_Mono', 'POI');
	const stations = [];
	if (!fs.existsSync(poiDir)) return stations;

	const ymlFiles = fs.readdirSync(poiDir).filter((f) => f.endsWith('.yml'));

	for (const filename of ymlFiles) {
		const baseNoExt = path.basename(filename, '.yml');
		const id = `station-${baseNoExt.toLowerCase().replace(/_/g, '-')}`;
		const name =
			KNOWN_POI_NAMES[filename] ||
			baseNoExt
				.split(/[_\-\s]+/)
				.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
				.join(' ');

		const image = resolveImage(baseNoExt, filename);

		stations.push({
			id,
			name,
			description: 'Станция / аванпост сектора (POI).',
			price: 0,
			group: 'station',
			hullClass: 'station',
			size: 'large',
			classes: ['civilian'],
			engines: ['solar'],
			image
		});
	}

	console.log(`Extracted ${stations.length} POI stations.`);
	return stations;
}

// --- 5. Parse ShuttleEvents ---
function parseShuttleEvents() {
	const eventDir = path.join(MONOLITH_DIR, 'Resources', 'Maps', '_Mono', 'ShuttleEvent');
	const events = [];
	if (!fs.existsSync(eventDir)) return events;

	const ymlFiles = fs.readdirSync(eventDir).filter((f) => f.endsWith('.yml'));

	for (const filename of ymlFiles) {
		const baseNoExt = path.basename(filename, '.yml');
		const id = `eighth-${baseNoExt.toLowerCase().replace(/_/g, '-')}`;
		const name = baseNoExt
			.split(/[_\-\s]+/)
			.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
			.join(' ');

		const image = resolveImage(baseNoExt, filename);

		events.push({
			id,
			name: `ВЭФ ${name}`,
			description: 'Боевой корабль или объект системы защиты сектора.',
			price: 0,
			group: 'eighth_fleet',
			hullClass: 'corvette',
			size: 'medium',
			classes: ['fighter'],
			engines: ['rtg', 'apu'],
			image
		});
	}

	console.log(`Extracted ${events.length} ShuttleEvent ships.`);
	return events;
}

// --- Main execution ---
function main() {
	console.log(`Source build directory: ${MONOLITH_DIR}`);
	const fluent = loadFluentTranslations();
	const vessels = parseVesselPrototypes(fluent);
	const stations = parsePoiStations();
	const events = parseShuttleEvents();

	// Deduplicate by ID
	const map = new Map();
	for (const item of [...vessels, ...stations, ...events]) {
		map.set(item.id, item);
	}

	const all = Array.from(map.values());
	all.sort((a, b) => a.name.localeCompare(b.name, 'ru'));

	fs.writeFileSync(OUTPUT_FILE, JSON.stringify(all, null, 2), 'utf-8');
	console.log(`Successfully generated ${all.length} shuttles into ${OUTPUT_FILE}`);
}

main();
