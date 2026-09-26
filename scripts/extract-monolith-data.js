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
	'drone',
	'shuttle',
	'salvage',
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
	if (lower === 'hostile_ai' || lower === 'ai' || lower === 'drone') return 'hostile_ai';
	if (lower === 'station' || lower === 'poi') return 'station';
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

function resolveImage(id, shuttlePath, extraHints = []) {
	const staticFiles = new Set(fs.readdirSync(STATIC_DIR).map((f) => f.toLowerCase()));

	const idClean = id.toLowerCase().replace(/[^a-z0-9_-]/g, '');
	const idUnderscores = idClean.replace(/-/g, '_');
	const idHyphens = idClean.replace(/_/g, '-');

	let pathBase = '';
	if (shuttlePath) {
		pathBase = path.basename(shuttlePath, '.yml').toLowerCase();
	}

	const candidates = [
		...extraHints,
		`${idClean}-0.png`,
		`${idClean}.png`,
		`${idUnderscores}-0.png`,
		`${idUnderscores}.png`,
		`${idHyphens}-0.png`,
		`${idHyphens}.png`,
		pathBase ? `${pathBase}-0.png` : null,
		pathBase ? `${pathBase}.png` : null,
		pathBase ? `${pathBase.replace(/-/g, '_')}-0.png` : null,
		pathBase ? `${pathBase.replace(/_/g, '-')}-0.png` : null,
		pathBase && pathBase.endsWith('luam') ? `${pathBase.slice(0, -4)}-0.png` : null,
		pathBase && pathBase.endsWith('luam') ? `${pathBase.slice(0, -4)}.png` : null
	].filter(Boolean);

	for (const candidate of candidates) {
		const cLow = candidate.toLowerCase();
		if (staticFiles.has(cLow)) {
			return `/${cLow}`;
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

// --- 4. Parse Hostile AI Drones ---
const HOSTILE_DRONES = [
	{
		id: 'drone-needle',
		mapName: 'needle.yml',
		name: 'Юнит: Нидл (NEEDLE)',
		description: 'Автономный высокоскоростной дрон-перехватчик с импульсным вооружением.',
		size: 'small',
		hullClass: 'drone',
		classes: ['fighter', 'pursuit'],
		engines: ['apu']
	},
	{
		id: 'drone-wedge',
		mapName: 'wedge.yml',
		name: 'Юнит: Ведж (WEDGE)',
		description: 'Тяжёлый автономный штурмовой дрон клиновидной формы.',
		size: 'medium',
		hullClass: 'drone',
		classes: ['fighter'],
		engines: ['apu']
	},
	{
		id: 'drone-ram-small',
		mapName: 'ramdronesmall.yml',
		name: 'Юнит: Рам-дрон (Малый)',
		description: 'Бродячий малый дрон-камикадзе с бронированным таранным носом.',
		size: 'micro',
		hullClass: 'drone',
		classes: ['fighter'],
		engines: ['apu']
	},
	{
		id: 'drone-ram-medium',
		mapName: 'ramdronemedium.yml',
		name: 'Юнит: Рам-дрон (Средний)',
		description: 'Усиленный боевой дрон таранного типа с тяжелым бронекорпусом.',
		size: 'small',
		hullClass: 'drone',
		classes: ['fighter'],
		engines: ['apu']
	},
	{
		id: 'drone-mpulsar',
		mapName: 'mpulsar.yml',
		name: 'Юнит: Пульсар (PULSAR)',
		description: 'Автономный патрульный дрон с циклической импульсной лазерной пушкой.',
		size: 'small',
		hullClass: 'drone',
		classes: ['fighter', 'patrol'],
		engines: ['apu']
	},
	{
		id: 'drone-lance',
		mapName: 'lance.yml',
		name: 'Юнит: Ланс (LANCE)',
		description: 'Автономный истребитель поддержки с фокусированным энергетическим орудием.',
		size: 'small',
		hullClass: 'drone',
		classes: ['fighter'],
		engines: ['apu']
	},
	{
		id: 'drone-gust',
		mapName: 'gust.yml',
		name: 'Юнит: Гаст (GUST)',
		description: 'Манёвренный ударный дрон класса T2 со сбалансированным вооружением.',
		size: 'small',
		hullClass: 'drone',
		classes: ['fighter'],
		engines: ['apu']
	},
	{
		id: 'drone-wasp',
		mapName: 'wasp.yml',
		name: 'Юнит: Васп (WASP)',
		description: 'Легкий роевой боевой дрон типа «Оса», действующий на предельных скоростях.',
		size: 'micro',
		hullClass: 'drone',
		classes: ['fighter'],
		engines: ['apu']
	},
	{
		id: 'drone-crown',
		mapName: 'crown.yml',
		name: 'Юнит: Краун (CROWN)',
		description: 'Боевой дрон огневой поддержки T2 с кольцевым распределением орудийных гнезд.',
		size: 'small',
		hullClass: 'drone',
		classes: ['fighter'],
		engines: ['apu']
	},
	{
		id: 'drone-piercer',
		mapName: 'piercer.yml',
		name: 'Юнит: Пирсер (PIERCER)',
		description: 'Бронебойный перехватчик высокой пробивной силы для охоты на лёгкие корабли.',
		size: 'small',
		hullClass: 'drone',
		classes: ['fighter', 'pursuit'],
		engines: ['apu']
	},
	{
		id: 'drone-medusa',
		mapName: 'medusa.yml',
		name: 'Юнит: Медуза (MEDUSA)',
		description: 'Тяжелый автономный дрон подавления и радиоэлектронной борьбы.',
		size: 'medium',
		hullClass: 'drone',
		classes: ['fighter'],
		engines: ['apu']
	},
	{
		id: 'drone-assembly',
		mapName: 'assembly.yml',
		name: 'Юнит: Ассамблея (ASSEMBLY)',
		description: 'Модульный носитель дронов и автономный полевой ремонтный узел.',
		size: 'medium',
		hullClass: 'drone',
		classes: ['fighter', 'engineering'],
		engines: ['apu']
	},
	{
		id: 'drone-bracket',
		mapName: 'bracket.yml',
		name: 'Юнит: Бракет (BRACKET)',
		description: 'Тяжёлый осадный дрон T2 с усиленной защитой фронтальной проекции.',
		size: 'medium',
		hullClass: 'drone',
		classes: ['fighter'],
		engines: ['apu']
	},
	{
		id: 'drone-mauler',
		mapName: 'mauler.yml',
		name: 'Юнит: Маулер (MAULER)',
		description: 'Сверхтяжелый дрон-разрушитель класса T2-3, способный уничтожать фрегаты.',
		size: 'large',
		hullClass: 'corvette',
		classes: ['fighter'],
		engines: ['apu', 'rtg']
	},
	{
		id: 'drone-quake',
		mapName: 'quake.yml',
		name: 'Юнит: Квейк (QUAKE)',
		description: 'Тяжелый ударный дрон прорыва с массивными кинетическими орудиями.',
		size: 'large',
		hullClass: 'corvette',
		classes: ['fighter'],
		engines: ['apu', 'rtg']
	},
	{
		id: 'drone-lens',
		mapName: 'lens.yml',
		name: 'Юнит: Ленс (LENS)',
		description: 'Разведывательный дрон оптического сканирования и наведения.',
		size: 'small',
		hullClass: 'drone',
		classes: ['fighter', 'patrol'],
		engines: ['apu']
	}
];

function parseHostileAiDrones() {
	const drones = [];
	for (const d of HOSTILE_DRONES) {
		const baseNoExt = path.basename(d.mapName, '.yml');
		const image = resolveImage(baseNoExt, d.mapName, [`${baseNoExt}-0.png`, `${baseNoExt}.png`]);

		drones.push({
			id: d.id,
			name: d.name,
			description: d.description,
			price: 0,
			group: 'hostile_ai',
			hullClass: d.hullClass,
			size: d.size,
			classes: d.classes,
			engines: d.engines,
			image
		});
	}

	console.log(`Extracted ${drones.length} Hostile AI combat drones.`);
	return drones;
}

// --- 5. Parse Hostile AI Ships, Chimera & Asakim Events ---
const SPECIAL_EVENT_SHIPS = [
	{
		id: 'hostile-ai-zenith',
		mapName: 'zenith.yml',
		name: 'ИИ-Фрегат «Зенит»',
		description: 'Поврежденный боевой корабль под полным контролем агрессивного боевого ядра ИИ.',
		group: 'hostile_ai',
		hullClass: 'frigate',
		size: 'medium',
		classes: ['fighter'],
		engines: ['rtg', 'apu'],
		hints: ['zenith-0.png']
	},
	{
		id: 'hostile-ai-zenith-e',
		mapName: 'zenith_e.yml',
		name: 'ИИ-Фрегат «Зенит-Э»',
		description: 'Элитная модификация «Зенита» с усиленным бронированием и защитными протоколами.',
		group: 'hostile_ai',
		hullClass: 'frigate',
		size: 'medium',
		classes: ['fighter'],
		engines: ['rtg', 'apu'],
		hints: ['zenith_e-0.png']
	},
	{
		id: 'hostile-ai-nebula',
		mapName: 'nebula.yml',
		name: 'ИИ-Корвет «Небула»',
		description: 'Автономный ударный корвет сошедшей с ума системы планетарной защиты.',
		group: 'hostile_ai',
		hullClass: 'corvette',
		size: 'medium',
		classes: ['fighter'],
		engines: ['rtg', 'apu'],
		hints: ['nebula-0.png']
	},
	{
		id: 'hostile-ai-wyrm',
		mapName: 'wyrm.yml',
		name: 'ИИ-Эсминец «Вирм»',
		description: 'Тяжеловооруженный боевой корабль автономного ударного флота ИИ.',
		group: 'hostile_ai',
		hullClass: 'destroyer',
		size: 'large',
		classes: ['fighter'],
		engines: ['plasma', 'rtg'],
		hints: ['wyrm-0.png']
	},
	{
		id: 'hostile-ai-razorn',
		mapName: 'razorn.yml',
		name: 'ИИ-Штурмовик «Рейзор-Н»',
		description: 'Смертоносный перехватчик с экстремальной огневой мощью и реактивными маневрами.',
		group: 'hostile_ai',
		hullClass: 'fighter',
		size: 'small',
		classes: ['fighter', 'pursuit'],
		engines: ['apu'],
		hints: ['razorn-0.png']
	},
	{
		id: 'hostile-ai-wyvern',
		mapName: 'wyvern.yml',
		name: 'ИИ-Крейсер «Виверна»',
		description: 'Флагманский супер-крейсер искусственного интеллекта колоссальной мощности.',
		group: 'hostile_ai',
		hullClass: 'cruiser',
		size: 'large',
		classes: ['fighter'],
		engines: ['singularity', 'supermatter'],
		hints: ['wyvern-0.png']
	},
	{
		id: 'chimera-sakuratsu',
		mapName: 'sakuratsu_chimera.yml',
		name: '«Сакурацу» Химеры',
		description: 'Штурмовой корвет засекреченной военизированной группировки Химера.',
		group: 'custom',
		hullClass: 'corvette',
		size: 'medium',
		classes: ['fighter', 'mercenary'],
		engines: ['plasma', 'apu'],
		hints: ['sakuratsu-0.png']
	},
	{
		id: 'chimera-olympus',
		mapName: 'olympus_chimera.yml',
		name: '«Олимпус» Химеры',
		description: 'Тяжелый десантный корабль Химеры.',
		group: 'custom',
		hullClass: 'corvette',
		size: 'medium',
		classes: ['fighter', 'mercenary'],
		engines: ['plasma', 'apu'],
		hints: ['olympus-0.png']
	},
	{
		id: 'chimera-tethys',
		mapName: 'tethys_chimera.yml',
		name: '«Тетис» Химеры',
		description: 'Боевой фрегат огневого прикрытия Химеры.',
		group: 'custom',
		hullClass: 'frigate',
		size: 'medium',
		classes: ['fighter', 'mercenary'],
		engines: ['plasma', 'rtg'],
		hints: ['tethys-0.png']
	},
	{
		id: 'chimera-legionnaire',
		mapName: 'legionnaire_chimera.yml',
		name: '«Легионер» Химеры',
		description: 'Флагманский эсминец элитного ударного крыла Химеры.',
		group: 'custom',
		hullClass: 'destroyer',
		size: 'large',
		classes: ['fighter', 'mercenary'],
		engines: ['singularity', 'rtg'],
		hints: ['legionnaire-0.png']
	},
	{
		id: 'asakim-small',
		mapName: 'asakim_small.yml',
		name: 'Рейдер Асаким (Малый)',
		description: 'Быстрый рейдерский перехватчик синдикатного клана Асаким.',
		group: 'syndicate',
		hullClass: 'fighter',
		size: 'small',
		classes: ['fighter', 'syndicate'],
		engines: ['apu'],
		hints: ['asakim-0.png']
	},
	{
		id: 'asakim-medium',
		mapName: 'asakim_medium.yml',
		name: 'Фрегат Асаким',
		description: 'Боевой фрегат синдикатного клана Асаким.',
		group: 'syndicate',
		hullClass: 'frigate',
		size: 'medium',
		classes: ['fighter', 'syndicate'],
		engines: ['plasma', 'apu'],
		hints: ['asakim-0.png']
	}
];

function parseSpecialEventShips() {
	const ships = [];
	for (const s of SPECIAL_EVENT_SHIPS) {
		const baseNoExt = path.basename(s.mapName, '.yml');
		const image = resolveImage(baseNoExt, s.mapName, s.hints || []);

		ships.push({
			id: s.id,
			name: s.name,
			description: s.description,
			price: 0,
			group: s.group,
			hullClass: s.hullClass,
			size: s.size,
			classes: s.classes,
			engines: s.engines,
			image
		});
	}

	console.log(`Extracted ${ships.length} special event & hostile ships.`);
	return ships;
}

// --- 6. Parse POI Stations & Dungeons ---
const POI_DEFINITIONS = [
	{
		id: 'station-hammer-of-the-union',
		mapName: 'hammeroftheunion.yml',
		name: 'Молот «Союза»',
		description:
			'Легендарный заброшенный флагманский дредноут СССП. Древний рубеж обороны с редчайшими технологическими дисками.',
		group: 'ussp',
		hullClass: 'battleship',
		size: 'large',
		classes: ['fighter', 'salvage'],
		engines: ['singularity', 'supermatter'],
		hints: ['hammeroftheunion-0.png']
	},
	{
		id: 'station-colossus-central',
		mapName: 'colossus_central.yml',
		name: 'Станция «Колосс Централ»',
		description: 'Главный узловой хаб и торговый аванпост сектора Колосс.',
		group: 'sr',
		hullClass: 'station',
		size: 'large',
		classes: ['civilian'],
		engines: ['solar', 'singularity'],
		hints: ['colossus_central-0.png']
	},
	{
		id: 'station-black-market',
		mapName: 'BlackMarket.yml',
		name: 'Бар «Веселый Роджер»',
		description: 'Убежище контрабандистов и чёрный рынок на границе фронтира.',
		group: 'blackmarket',
		hullClass: 'station',
		size: 'medium',
		classes: ['pirate', 'civilian'],
		engines: ['solar'],
		hints: ['trading_outpost-0.png']
	},
	{
		id: 'station-pdvhelios',
		mapName: 'pdvhelios.yml',
		name: 'ДФ | Крепость Гелиос',
		description: 'Военно-оборонительный форпост Династии Фаэтон.',
		group: 'blackmarket',
		hullClass: 'station',
		size: 'large',
		classes: ['fighter', 'pirate'],
		engines: ['supermatter'],
		hints: ['pdvhelios-0.png']
	},
	{
		id: 'station-jupiter',
		mapName: 'jupiter.yml',
		name: 'ДФ | Авианосец класса «Юпитер»',
		description: 'Тяжелый авианесущий флагман Династии Фаэтон.',
		group: 'blackmarket',
		hullClass: 'carrier',
		size: 'large',
		classes: ['fighter', 'pirate'],
		engines: ['singularity'],
		hints: ['jupiter-0.png']
	},
	{
		id: 'station-tsfmchalcyon',
		mapName: 'tsfmchalcyon.yml',
		name: 'КВП | Флагман Фалкон',
		description: 'Командный флагман сил безопасности Консорциума.',
		group: 'security',
		hullClass: 'carrier',
		size: 'large',
		classes: ['fighter', 'patrol'],
		engines: ['supermatter'],
		hints: ['tsfmchalcyon-0.png']
	},
	{
		id: 'station-tsfmcoutpost',
		mapName: 'tsfmcoutpost.yml',
		name: 'ДФ-ГРАЖД | Аванпост гражданских ДФ',
		description: 'Смежный патрульно-гражданский аванпост.',
		group: 'security',
		hullClass: 'station',
		size: 'medium',
		classes: ['civilian', 'patrol'],
		engines: ['solar'],
		hints: ['tsfmcoutpost-0.png']
	},
	{
		id: 'station-camelot',
		mapName: 'camelot.yml',
		name: 'Форт Камелот (СССП)',
		description: 'Укрепленный форпост Вооруженных сил СССП.',
		group: 'ussp',
		hullClass: 'station',
		size: 'large',
		classes: ['fighter'],
		engines: ['supermatter'],
		hints: ['camelot-0.png']
	},
	{
		id: 'station-usspbaikal',
		mapName: 'usspbaikal.yml',
		name: 'СССП | Станция Байкал',
		description: 'Научно-производственный комплекс СССП.',
		group: 'ussp',
		hullClass: 'station',
		size: 'large',
		classes: ['science', 'civilian'],
		engines: ['singularity']
	},
	{
		id: 'station-sevastopol',
		mapName: 'sevastopol.yml',
		name: 'Дата-центр Севастополь',
		description: 'Автономный информационный и телекоммуникационный узел сектора.',
		group: 'station',
		hullClass: 'station',
		size: 'medium',
		classes: ['science'],
		engines: ['solar'],
		hints: ['sevastopol-0.png']
	},
	{
		id: 'station-anomalouslab',
		mapName: 'anomalouslab.yml',
		name: 'Лаборатория Аномалий',
		description: 'Исследовательский комплекс по изучению глубоких пространственных аномалий.',
		group: 'station',
		hullClass: 'station',
		size: 'medium',
		classes: ['science'],
		engines: ['solar'],
		hints: ['anomalouslab-0.png']
	},
	{
		id: 'station-derelictdrillsite',
		mapName: 'derelictdrillsite.yml',
		name: 'Брошенный Буровой Комплекс',
		description: 'Оставленная добывающая станция на богатом рудном массиве.',
		group: 'station',
		hullClass: 'salvage',
		size: 'large',
		classes: ['salvage'],
		engines: ['solar'],
		hints: ['derelictdrillsite-0.png']
	},
	{
		id: 'station-lancelot',
		mapName: 'lancelot.yml',
		name: 'Шахтёрский аванпост Ланселот',
		description: 'Глубокий данж-комплекс в астероидном поясе.',
		group: 'station',
		hullClass: 'salvage',
		size: 'large',
		classes: ['salvage'],
		engines: ['solar'],
		hints: ['lancelot-0.png']
	},
	{
		id: 'station-polaris',
		mapName: 'polaris.yml',
		name: 'Центр биоисследований Полярис',
		description: 'Изолированная биологическая станция повышенного уровня секретности.',
		group: 'station',
		hullClass: 'salvage',
		size: 'large',
		classes: ['science'],
		engines: ['solar'],
		hints: ['polaris-0.png']
	},
	{
		id: 'station-ruin-tanker',
		mapName: 'ruin_tanker.yml',
		name: 'Автоматизированный танкер',
		description: 'Дрейфующий в пустоте топливный танкер с ценными запасами.',
		group: 'station',
		hullClass: 'salvage',
		size: 'large',
		classes: ['cargo', 'salvage'],
		engines: ['plasma'],
		hints: ['ruin_tanker-0.png']
	},
	{
		id: 'station-zenith-poi',
		mapName: 'zenith_poi.yml',
		name: 'ADS «Зенит» CK-395 (POI)',
		description: 'Брошенный комплекс прототипа фрегата серии ADS.',
		group: 'station',
		hullClass: 'salvage',
		size: 'large',
		classes: ['salvage', 'fighter'],
		engines: ['rtg'],
		hints: ['zenith_poi-0.png']
	},
	{
		id: 'station-zvezda',
		mapName: 'zvezda.yml',
		name: 'Орбитальный жилой комплекс «Звезда»',
		description: 'Заброшенный орбитальный сектор с древними технологиями.',
		group: 'station',
		hullClass: 'salvage',
		size: 'large',
		classes: ['salvage', 'civilian'],
		engines: ['solar'],
		hints: ['zvezda-0.png']
	},
	{
		id: 'station-caseys-casino',
		mapName: 'caseyscasino.yml',
		name: 'Казино Безумного Кейси',
		description: 'Развлекательный сектор азартных игр и контрабанды.',
		group: 'station',
		hullClass: 'station',
		size: 'medium',
		classes: ['civilian'],
		engines: ['solar'],
		hints: ['caseyscasino-0.png']
	},
	{
		id: 'station-trade-mall',
		mapName: 'trademall.yml',
		name: 'Торговый Молл',
		description: 'Крупный распределительный торговый центр сектора.',
		group: 'station',
		hullClass: 'station',
		size: 'large',
		classes: ['cargo', 'civilian'],
		engines: ['solar'],
		hints: ['trademall-0.png']
	},
	{
		id: 'station-cargo-depot',
		mapName: 'cargodepot.yml',
		name: 'Грузовое Депо',
		description: 'Логистический хаб снабжения и погрузки контейнеров.',
		group: 'station',
		hullClass: 'station',
		size: 'medium',
		classes: ['cargo'],
		engines: ['solar'],
		hints: ['cargodepot-0.png']
	},
	{
		id: 'station-cargo-depot-alt',
		mapName: 'cargodepotalt.yml',
		name: 'Грузовое Депо (Запасное)',
		description: 'Резервный перегрузочный узел снабжения.',
		group: 'station',
		hullClass: 'station',
		size: 'medium',
		classes: ['cargo'],
		engines: ['solar'],
		hints: ['cargodepotalt-0.png']
	},
	{
		id: 'station-lpbravo',
		mapName: 'lpbravo.yml',
		name: 'Пост прослушки Браво',
		description: 'Скрытая станция радиолокационного перехвата и слежения.',
		group: 'station',
		hullClass: 'station',
		size: 'medium',
		classes: ['patrol', 'science'],
		engines: ['solar'],
		hints: ['lpbravo-0.png']
	},
	{
		id: 'station-the-pit',
		mapName: 'arena.yml',
		name: 'Арена «Яма»',
		description: 'Гладиаторский боевой комплекс в открытом космосе.',
		group: 'station',
		hullClass: 'station',
		size: 'medium',
		classes: ['mercenary'],
		engines: ['solar'],
		hints: ['arena-0.png']
	},
	{
		id: 'station-beacon-a',
		mapName: 'beaconstation_a.yml',
		name: 'Астероидный кластер INSO-357k',
		description: 'Навигационный маяк и группа богатых минеральных астероидов.',
		group: 'station',
		hullClass: 'station',
		size: 'small',
		classes: ['salvage'],
		engines: ['solar']
	},
	{
		id: 'station-beacon-wilds',
		mapName: 'beaconstation_wilds.yml',
		name: 'Астероидный кластер LINEAR-21',
		description: 'Дальний навигационный маяк на границе неизведанного пространства.',
		group: 'station',
		hullClass: 'station',
		size: 'small',
		classes: ['salvage'],
		engines: ['solar']
	},
	{
		id: 'station-surface-outpost',
		mapName: 'surface_outpost_desert.yml',
		name: 'Пустынный Аванпост',
		description: 'Планетарная станция в засушливой зоне.',
		group: 'station',
		hullClass: 'station',
		size: 'medium',
		classes: ['civilian'],
		engines: ['solar']
	}
];

function parsePointsOfInterest() {
	const stations = [];
	for (const p of POI_DEFINITIONS) {
		const baseNoExt = path.basename(p.mapName, '.yml');
		const image = resolveImage(baseNoExt, p.mapName, p.hints || []);

		stations.push({
			id: p.id,
			name: p.name,
			description: p.description,
			price: 0,
			group: p.group,
			hullClass: p.hullClass,
			size: p.size,
			classes: p.classes,
			engines: p.engines,
			image
		});
	}

	console.log(`Extracted ${stations.length} POI & dungeon stations.`);
	return stations;
}

// --- 7. Parse Salvage Wrecks ---
function parseSalvageWrecks(fluent) {
	const salvageProtoPath = path.join(
		MONOLITH_DIR,
		'Resources',
		'Prototypes',
		'Maps',
		'salvage.yml'
	);
	const wrecks = [];
	if (!fs.existsSync(salvageProtoPath)) return wrecks;

	const content = fs.readFileSync(salvageProtoPath, 'utf-8');
	const docs = content.split(/^-\s*type:\s*/m);

	for (const doc of docs) {
		if (!doc.startsWith('salvageMap')) continue;

		const idMatch = doc.match(/\bid:\s*([^\r\n#]+)/);
		const pathMatch = doc.match(/\bmapPath:\s*([^\r\n#]+)/);
		const sizeMatch = doc.match(/\bsizeString:\s*([^\r\n#]+)/);

		if (!idMatch || !pathMatch) continue;
		const id = idMatch[1].trim();
		const mapPath = pathMatch[1].trim();
		const sizeString = sizeMatch ? sizeMatch[1].trim() : '';

		const locKey = `salvage-map-proto-${id}`;
		let name = fluent.get(locKey);
		if (!name) {
			name = id
				.replace(/([A-Z])/g, ' $1')
				.trim()
				.split(/\s+/)
				.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
				.join(' ');
		}

		let size = 'medium';
		if (sizeString.includes('small') || id.toLowerCase().includes('small')) size = 'small';
		else if (sizeString.includes('large') || id.toLowerCase().includes('large')) size = 'large';

		const baseNoExt = path.basename(mapPath, '.yml');
		const image = resolveImage(id, mapPath, [`${baseNoExt}-0.png`, `${baseNoExt}.png`]);

		wrecks.push({
			id: `salvage-${id.toLowerCase()}`,
			name: `Обломок: ${name}`,
			description: 'Заброшенный космический обломок, доступный для утилизации магнитом.',
			price: 0,
			group: 'scrapyard',
			hullClass: 'salvage',
			size,
			classes: ['salvage', 'scrapyard'],
			engines: ['solar'],
			image
		});
	}

	console.log(`Extracted ${wrecks.length} salvage wrecks.`);
	return wrecks;
}

// --- 8. Parse Bluespace Scrap & Ruins ---
function parseBluespaceScrap() {
	const scrapDir = path.join(MONOLITH_DIR, 'Resources', 'Maps', '_NF', 'Shuttles', 'Scrap');
	const scraps = [];
	if (!fs.existsSync(scrapDir)) return scraps;

	const ymlFiles = fs.readdirSync(scrapDir).filter((f) => f.endsWith('.yml'));

	for (const filename of ymlFiles) {
		const baseNoExt = path.basename(filename, '.yml');
		const id = `scrap-${baseNoExt.toLowerCase().replace(/_/g, '-')}`;
		const name = baseNoExt
			.split(/[_\-\s]+/)
			.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
			.join(' ');

		const image = resolveImage(baseNoExt, filename);

		scraps.push({
			id,
			name: `Обломок «${name}»`,
			description: 'Поврежденный полуразобранный шаттл, дрейфующий в блюспейс-пространстве.',
			price: 0,
			group: 'scrapyard',
			hullClass: 'salvage',
			size: 'medium',
			classes: ['scrapyard'],
			engines: ['apu'],
			image
		});
	}

	console.log(`Extracted ${scraps.length} bluespace scrap shuttles.`);
	return scraps;
}

function parseRuins() {
	const ruinsDir = path.join(MONOLITH_DIR, 'Resources', 'Maps', 'Ruins');
	const ruins = [];
	if (!fs.existsSync(ruinsDir)) return ruins;

	const ymlFiles = fs.readdirSync(ruinsDir).filter((f) => f.endsWith('.yml'));

	const RUIN_NAMES = {
		'derelict.yml': 'Заброшенная станция Дерилект',
		'djstation.yml': 'Станция космического диджея',
		'abandoned_outpost.yml': 'Заброшенный аванпост',
		'old_ai_sat.yml': 'Старый спутник ИИ',
		'whiteship_ancient.yml': 'Древний Белый Корабль',
		'whiteship_bluespacejumper.yml': 'Прыжковый Белый Корабль',
		'ruined_prison_ship.yml': 'Разрушенный тюремный корабль',
		'syndicate_dropship.yml': 'Десантный бот Синдиката (Руина)',
		'empty_flagship.yml': 'Покинутый флагман',
		'wrecklaimer.yml': 'Обломок Реклеймера',
		'biodome_satellite.yml': 'Биокупольный спутник',
		'chunked_tcomms.yml': 'Разрушенный узел телекоммуникаций'
	};

	for (const filename of ymlFiles) {
		const baseNoExt = path.basename(filename, '.yml');
		const id = `ruin-${baseNoExt.toLowerCase().replace(/_/g, '-')}`;
		const name =
			RUIN_NAMES[filename] ||
			baseNoExt
				.split(/[_\-\s]+/)
				.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
				.join(' ');

		const image = resolveImage(baseNoExt, filename);

		ruins.push({
			id,
			name,
			description: 'Космические руины древних экспедиций и покинутых станций.',
			price: 0,
			group: 'scrapyard',
			hullClass: 'salvage',
			size: 'large',
			classes: ['salvage', 'scrapyard'],
			engines: ['solar'],
			image
		});
	}

	console.log(`Extracted ${ruins.length} space ruins.`);
	return ruins;
}

// --- Main execution ---
function main() {
	console.log(`Source build directory: ${MONOLITH_DIR}`);
	const fluent = loadFluentTranslations();
	const vessels = parseVesselPrototypes(fluent);
	const drones = parseHostileAiDrones();
	const events = parseSpecialEventShips();
	const pois = parsePointsOfInterest();
	const salvage = parseSalvageWrecks(fluent);
	const bluespaceScrap = parseBluespaceScrap();
	const ruins = parseRuins();

	// Deduplicate by ID
	const map = new Map();
	for (const item of [
		...vessels,
		...drones,
		...events,
		...pois,
		...salvage,
		...bluespaceScrap,
		...ruins
	]) {
		map.set(item.id, item);
	}

	const all = Array.from(map.values());
	all.sort((a, b) => a.name.localeCompare(b.name, 'ru'));

	fs.writeFileSync(OUTPUT_FILE, JSON.stringify(all, null, 2), 'utf-8');
	console.log(`Successfully generated ${all.length} entities into ${OUTPUT_FILE}`);
}

main();
