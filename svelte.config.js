import adapter from '@sveltejs/adapter-static';
import configJson from './config.json' with { type: 'json' };

const isVercel = Boolean(process.env.VERCEL);
const isProd = process.env.NODE_ENV === 'production';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	compilerOptions: {
		// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
		runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true)
	},
	kit: {
		adapter: adapter(),
		paths: {
			base: isProd ? (isVercel ? '' : (process.env.BASE_PATH ?? `/${configJson.base_path}`)) : ''
		},
		alias: {
			$root: process.cwd()
		},
		prerender: {
			handleHttpError: ({ path, message }) => {
				if (
					path.endsWith('.png') ||
					path.endsWith('.webp') ||
					path.endsWith('.jpg') ||
					path.endsWith('.svg')
				) {
					console.warn(`[prerender warning] 404 for asset: ${path}`);
					return;
				}
				throw new Error(message);
			}
		}
	}
};

export default config;
