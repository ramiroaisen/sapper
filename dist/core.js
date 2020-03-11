'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

function _interopDefault (ex) { return (ex && (typeof ex === 'object') && 'default' in ex) ? ex['default'] : ex; }

var path = require('path');
var path__default = _interopDefault(path);
var fs = require('fs');
var __chunk_2 = require('./chunk2.js');
var module$1 = _interopDefault(require('module'));
var index = require('./index.js');
var hash = _interopDefault(require('string-hash'));
var codec = require('sourcemap-codec');
var __chunk_3 = require('./chunk3.js');
var svelte = _interopDefault(require('svelte/compiler'));

//import {inspect} from "util";

function create_app({
	bundler,
	manifest_data,
	dev_port,
	dev,
	cwd,
	src,
	dest,
	routes,
	output
}









) {
	if (!fs.existsSync(output)) fs.mkdirSync(output);

	const path_to_routes = path.relative(`${output}/internal`, routes);

	const client_manifest = generate_client_manifest(manifest_data, path_to_routes, bundler, dev, dev_port);
	const server_manifest = generate_server_manifest(manifest_data, path_to_routes, cwd, src, dest, dev);

	const app = generate_app(manifest_data, path_to_routes);

	//console.log(inspect(path_to_routes, {depth: 100, colors: true}));
	//console.log(inspect(manifest_data, {depth: 100, colors: true}));

	__chunk_2.write_if_changed(`${output}/internal/manifest-client.mjs`, client_manifest);
	__chunk_2.write_if_changed(`${output}/internal/manifest-server.mjs`, server_manifest);
	__chunk_2.write_if_changed(`${output}/internal/App.svelte`, app);
}

function create_serviceworker_manifest({ manifest_data, output, client_files, static_files }




) {
	let files = ['service-worker-index.html'];

	if (fs.existsSync(static_files)) {
		files = files.concat(__chunk_2.walk(static_files));
	} else {
		// TODO remove in a future version
		if (fs.existsSync('assets')) {
			throw new Error(`As of Sapper 0.21, the assets/ directory should become static/`);
		}
	}

	let code = `
		// This file is generated by Sapper — do not edit it!
		export const timestamp = ${Date.now()};

		export const files = [\n\t${files.map((x) => __chunk_2.stringify(x)).join(',\n\t')}\n];
		export { files as assets }; // legacy

		export const shell = [\n\t${client_files.map((x) => __chunk_2.stringify(x)).join(',\n\t')}\n];

		export const routes = [\n\t${manifest_data.pages.map((r) => `{ pattern: ${r.pattern} }`).join(',\n\t')}\n];
	`.replace(/^\t\t/gm, '').trim();

	__chunk_2.write_if_changed(`${output}/service-worker.js`, code);
}

function create_param_match(param, i) {
	return /^\.{3}.+$/.test(param)
		? `${param.replace(/.{3}/, '')}: d(match[${i + 1}]).split('/')`
		: `${param}: d(match[${i + 1}])`
}

function generate_client_manifest(
	manifest_data,
	path_to_routes,
	bundler,
	dev,
	dev_port
) {
	const page_ids = new Set(manifest_data.pages.map(page =>
		page.pattern.toString()));

	const server_routes_to_ignore = manifest_data.server_routes.filter(route =>
		!page_ids.has(route.pattern.toString()));

	const component_indexes = {};

	const components = `[
		${manifest_data.components.map((component, i) => {
			const annotation = bundler === 'webpack'
				? `/* webpackChunkName: "${component.name}" */ `
				: '';

			const source = get_file(path_to_routes, component);

			component_indexes[component.name] = i;

			return `{
					js: () => import(${annotation}${__chunk_2.stringify(source)}),
					css: "__SAPPER_CSS_PLACEHOLDER:${__chunk_2.stringify(component.file, false)}__"
				}`;
		}).join(',\n\t\t\t\t')}
	]`.replace(/^\t/gm, '');

	let needs_decode = false;

	let routes = `[
				${manifest_data.pages.map(page => `{
					// ${page.parts[page.parts.length - 1].component.file}
					pattern: ${page.pattern},
					parts: [
						${page.parts.map(part => {
							if (part === null) return 'null';

							if (part.params.length > 0) {
								needs_decode = true;
								const props = part.params.map(create_param_match);
								return `{ i: ${component_indexes[part.component.name]}, params: match => ({ ${props.join(', ')} }) }`;
							}

							return `{ i: ${component_indexes[part.component.name]} }`;
						}).join(',\n\t\t\t\t\t\t')}
					]
				}`).join(',\n\n\t\t\t\t')}
	]`.replace(/^\t/gm, '');

	if (needs_decode) {
		routes = `(d => ${routes})(decodeURIComponent)`;
	}

	return `
		// This file is generated by Sapper — do not edit it!
		export { default as Root } from '${__chunk_2.stringify(get_file(path_to_routes, manifest_data.root), false)}';
		export { preload as root_preload } from '${manifest_data.root.has_preload ? __chunk_2.stringify(get_file(path_to_routes, manifest_data.root), false) : './shared'}';
		export { default as ErrorComponent } from '${__chunk_2.stringify(get_file(path_to_routes, manifest_data.error), false)}';

		export const ignore = [${server_routes_to_ignore.map(route => route.pattern).join(', ')}];

		export const components = ${components};

		export const routes = ${routes};

		${dev ? `if (typeof window !== 'undefined') {
			import(${__chunk_2.stringify(__chunk_2.posixify(path.resolve(__dirname, '../sapper-dev-client.js')))}).then(client => {
				client.connect(${dev_port});
			});
		}` : ''}
	`.replace(/^\t{2}/gm, '').trim();
}

function generate_server_manifest(
	manifest_data,
	path_to_routes,
	cwd,
	src,
	dest,
	dev
) {
	const imports = [].concat(
		manifest_data.server_routes.map((route, i) =>
			`import * as route_${i} from ${__chunk_2.stringify(__chunk_2.posixify(`${path_to_routes}/${route.file}`))};`),
		manifest_data.components.map((component, i) =>
			`import component_${i}${component.has_preload ? `, { preload as preload_${i} }` : ''} from ${__chunk_2.stringify(get_file(path_to_routes, component))};`),
		`import root${manifest_data.root.has_preload ? `, { preload as root_preload }` : ''} from ${__chunk_2.stringify(get_file(path_to_routes, manifest_data.root))};`,
		`import error from ${__chunk_2.stringify(get_file(path_to_routes, manifest_data.error))};`
	);

	const component_lookup = {};
	manifest_data.components.forEach((component, i) => {
		component_lookup[component.name] = i;
	});

	let code = `
		`.replace(/^\t\t/gm, '').trim();

	const build_dir = __chunk_2.posixify(path.relative(cwd, dest));
	const src_dir = __chunk_2.posixify(path.relative(cwd, src));

	// REMOVED: server filenames are not the same as client filenames
	// we well parse these import() statements in runtime to get the build filenames
	// this way the bundler replace the source filenames with the build filenames
	/*
	const routes_map = `{
	${manifest_data.components.map(component => {
		const source = get_file(path_to_routes, component);
		return `${stringify(component.file)}: (() => import(${stringify(source)})).toString().match(/\\(["']\\.\\/(.+)["']\\)/)[1]`;
	}).join(",\n\t")}
	}`;
	*/

	const components = `[
		${manifest_data.components.map((component, i) => {
			const source = get_file(path_to_routes, component);
			return `{
					js: () => import(${__chunk_2.stringify(source)}),
					css: "__SAPPER_CSS_PLACEHOLDER:${__chunk_2.stringify(component.file, false)}__"
				}`;
		}).join(',\n\t\t\t\t')}
	]`.replace(/^\t/gm, '');

	return `
		// This file is generated by Sapper — do not edit it!
		${imports.join('\n')}

		const d = decodeURIComponent;

		export const manifest = {
			server_routes: [
				${manifest_data.server_routes.map((route, i) => `{
					// ${route.file}
					pattern: ${route.pattern},
					handlers: route_${i},
					params: ${route.params.length > 0
						? `match => ({ ${route.params.map(create_param_match).join(', ')} })`
						: `() => ({})`}
				}`).join(',\n\n\t\t\t\t')}
			],

			pages: [
				${manifest_data.pages.map(page => `{
					// ${page.parts[page.parts.length - 1].component.file}
					pattern: ${page.pattern},
					parts: [
						${page.parts.map(part => {
							if (part === null) return 'null';

							const props = [
								`name: "${part.component.name}"`,
								`file: ${__chunk_2.stringify(part.component.file)}`,
								`component: component_${component_lookup[part.component.name]}`,
								part.component.has_preload && `preload: preload_${component_lookup[part.component.name]}`
							].filter(Boolean);

							if (part.params.length > 0) {
								const params = part.params.map(create_param_match);
								props.push(`params: match => ({ ${params.join(', ')} })`);
							}

							return `{ ${props.join(', ')} }`;
						}).join(',\n\t\t\t\t\t\t')}
					]
				}`).join(',\n\n\t\t\t\t')}
			],

			root,
			root_preload${manifest_data.root.has_preload ? '' : `: () => {}`},
			error
		};

		export const build_dir = ${JSON.stringify(build_dir)};

		export const src_dir = ${JSON.stringify(src_dir)};

		export const dev = ${dev ? 'true' : 'false'};
	`.replace(/^\t{2}/gm, '').trim();
}

function generate_app(manifest_data, path_to_routes) {
	// TODO remove default layout altogether

	const max_depth = Math.max(...manifest_data.pages.map(page => page.parts.filter(Boolean).length));

	const levels = [];
	for (let i = 0; i < max_depth; i += 1) {
		levels.push(i + 1);
	}

	let l = max_depth;

	let pyramid = `<svelte:component this="{level${l}.component}" {...level${l}.props}/>`;

	while (l-- > 1) {
		pyramid = `
			<svelte:component this="{level${l}.component}" segment="{segments[${l}]}" {...level${l}.props}>
				{#if level${l + 1}}
					${pyramid.replace(/\n/g, '\n\t\t\t\t\t')}
				{/if}
			</svelte:component>
		`.replace(/^\t\t\t/gm, '').trim();
	}

	return `
		<!-- This file is generated by Sapper — do not edit it! -->
		<script>
			import { setContext } from 'svelte';
			import { CONTEXT_KEY } from './shared';
			import Layout from '${get_file(path_to_routes, manifest_data.root)}';
			import Error from '${get_file(path_to_routes, manifest_data.error)}';

			export let stores;
			export let error;
			export let status;
			export let segments;
			export let level0;
			${levels.map(l => `export let level${l} = null;`).join('\n\t\t\t')}

			setContext(CONTEXT_KEY, stores);
		</script>

		<Layout segment="{segments[0]}" {...level0.props}>
			{#if error}
				<Error {error} {status}/>
			{:else}
				${pyramid.replace(/\n/g, '\n\t\t\t\t')}
			{/if}
		</Layout>
	`.replace(/^\t\t/gm, '').trim();
}

function get_file(path_to_routes, component) {
	if (component.default) return `./${component.type}.svelte`;
	return __chunk_2.posixify(`${path_to_routes}/${component.file}`);
}

var modules = {};

var getModule = function(dir) {
  var rootPath = dir ? path__default.resolve(dir) : process.cwd();
  var rootName = path__default.join(rootPath, '@root');
  var root = modules[rootName];
  if (!root) {
    root = new module$1(rootName);
    root.filename = rootName;
    root.paths = module$1._nodeModulePaths(rootPath);
    modules[rootName] = root;
  }
  return root;
};

var requireRelative = function(requested, relativeTo) {
  var root = getModule(relativeTo);
  return root.require(requested);
};

requireRelative.resolve = function(requested, relativeTo) {
  var root = getModule(relativeTo);
  return module$1._resolveFilename(requested, root);
};

var requireRelative_1 = requireRelative;

const inline_sourcemap_header = 'data:application/json;charset=utf-8;base64,';

function extract_sourcemap(raw, id) {
	let raw_map;
	let map = null;

	const code = raw.replace(/\/\*#\s+sourceMappingURL=(.+)\s+\*\//g, (m, url) => {
		if (raw_map) {
			// TODO should not happen!
			throw new Error(`Found multiple sourcemaps in single CSS file (${id})`);
		}

		raw_map = url;
		return '';
	}).trim();

	if (raw_map) {
		if (raw_map.startsWith(inline_sourcemap_header)) {
			const json = Buffer.from(raw_map.slice(inline_sourcemap_header.length), 'base64').toString();
			map = JSON.parse(json);
		}
	}

	return {
		code,
		map
	};
}










function get_css_from_modules(modules, css_map, asset_dir) {
	const parts = [];
	const mappings = [];

	const combined_map = {
		version: 3,
		file: null,
		sources: [],
		sourcesContent: [],
		names: [],
		mappings: null
	};

	modules.forEach(module => {
		if (!/\.css$/.test(module)) return;

		const css = css_map.get(module);

		const { code, map } = extract_sourcemap(css, module);

		parts.push(code);

		if (map) {
			const lines = codec.decode(map.mappings);

			if (combined_map.sources.length > 0 || combined_map.names.length > 0) {
				lines.forEach(line => {
					line.forEach(segment => {
						// adjust source index
						segment[1] += combined_map.sources.length;

						// adjust name index
						if (segment[4]) segment[4] += combined_map.names.length;
					});
				});
			}

			combined_map.sources.push(...map.sources);
			combined_map.sourcesContent.push(...map.sourcesContent);
			combined_map.names.push(...map.names);

			mappings.push(...lines);
		}
	});

	if (parts.length > 0) {
		combined_map.mappings = codec.encode(mappings);

		combined_map.sources = combined_map.sources.map(source => path.relative(asset_dir, source).replace(/\\/g, '/'));

		return {
			code: parts.join('\n'),
			map: combined_map
		};
	}

	return null;
}

function extract_css(
	client_result,
	components,
	dirs,
	sourcemap
) {
	const result


 = {
		main: null,
		chunks: {}
	};

	if (!client_result.css_files) return; // Rollup-only for now

	let asset_dir = `${dirs.dest}/client`;
	if (process.env.SAPPER_LEGACY_BUILD) asset_dir += '/legacy';

	const unclaimed = new Set(client_result.css_files.map(x => x.id));

	const lookup = new Map();
	client_result.chunks.forEach(chunk => {
		lookup.set(chunk.file, chunk);
	});

	const css_map = new Map();
	client_result.css_files.forEach(css_module => {
		css_map.set(css_module.id, css_module.code);
	});

	const chunks_with_css = new Set();

	// concatenate and emit CSS
	client_result.chunks.forEach(chunk => {
		const css_modules = chunk.modules.filter(m => css_map.has(m));
		if (!css_modules.length) return;

		const css = get_css_from_modules(css_modules, css_map, asset_dir);

		let { code, map } = css;

		const output_file_name = chunk.file.replace(/\.js$/, '.css');

		map.file = output_file_name;

		if (sourcemap === true) {
			fs.writeFileSync(`${asset_dir}/${output_file_name}.map`, JSON.stringify(map, null, '  '));
			code += `\n/*# sourceMappingURL=${output_file_name}.map */`;
		}

		if (sourcemap === 'inline') {
			const base64 = Buffer.from(JSON.stringify(map), 'utf8').toString('base64');
			code += `\n/*# sourceMappingURL=${inline_sourcemap_header}${base64} */`;
		}

		fs.writeFileSync(`${asset_dir}/${output_file_name}`, code);

		chunks_with_css.add(chunk);
	});

	const entry = path.resolve(dirs.src, 'client.js');
	const entry_chunk = client_result.chunks.find(chunk => chunk.modules.indexOf(entry) !== -1);

	const entry_chunk_dependencies = new Set([entry_chunk]);
	const entry_css_modules = [];

	// recursively find the chunks this component depends on
	entry_chunk_dependencies.forEach(chunk => {
		if (!chunk) return; // TODO why does this happen?

		chunk.imports.forEach(file => {
			entry_chunk_dependencies.add(lookup.get(file));
		});

		if (chunks_with_css.has(chunk)) {
			chunk.modules.forEach(file => {
				unclaimed.delete(file);
				if (css_map.has(file)) {
					entry_css_modules.push(file);
				}
			});
		}
	});

	// figure out which (css-having) chunks each component depends on
	components.forEach(component => {
		const resolved = path.resolve(dirs.routes, component.file);
		const chunk = client_result.chunks.find(chunk => chunk.modules.indexOf(resolved) !== -1);

		if (!chunk) {
			// this should never happen!
			return;
			// throw new Error(`Could not find chunk that owns ${component.file}`);
		}

		const chunk_dependencies = new Set([chunk]);
		const css_dependencies = [];

		// recursively find the chunks this component depends on
		chunk_dependencies.forEach(chunk => {
			if (!chunk) return; // TODO why does this happen?

			chunk.imports.forEach(file => {
				chunk_dependencies.add(lookup.get(file));
			});

			if (chunks_with_css.has(chunk)) {
				css_dependencies.push(chunk.file.replace(/\.js$/, '.css'));

				chunk.modules.forEach(file => {
					unclaimed.delete(file);
				});
			}
		});

		result.chunks[component.file] = css_dependencies;
	});

	fs.readdirSync(asset_dir).forEach(file => {
		if (fs.statSync(`${asset_dir}/${file}`).isDirectory()) return;

		const source = fs.readFileSync(`${asset_dir}/${file}`, 'utf-8');

		const replaced = source.replace(/(\\?["'])__SAPPER_CSS_PLACEHOLDER:([^"']+?)__\1/g, (m, quotes, route) => {
			let replacement = JSON.stringify(
				process.env.SAPPER_LEGACY_BUILD && result.chunks[route] ?
					result.chunks[route].map(_ => `legacy/${_}`) :
					result.chunks[route]
			);

			// If the quotation marks are escaped, then
			// the source code is in a string literal
			// (e.g., source maps) rather than raw
			// JavaScript source. We need to stringify
			// again and then remove the extra quotation
			// marks so that replacement is correct.
			if (quotes[0] === '\\') {
				replacement = JSON.stringify(replacement);
				replacement = replacement.substring(1, replacement.length - 1);
			}

			return replacement;
		});

		fs.writeFileSync(`${asset_dir}/${file}`, replaced);
	});

	unclaimed.forEach(file => {
		entry_css_modules.push(file);
	});

	const leftover = get_css_from_modules(entry_css_modules, css_map, asset_dir);
	if (leftover) {
		let { code, map } = leftover;

		const main_hash = hash(code);

		const output_file_name = `main.${main_hash}.css`;

		map.file = output_file_name;

		if (sourcemap === true) {
			fs.writeFileSync(`${asset_dir}/${output_file_name}.map`, JSON.stringify(map, null, '  '));
			code += `\n/*# sourceMappingURL=client/${output_file_name}.map */`;
		}

		if (sourcemap === 'inline') {
			const base64 = Buffer.from(JSON.stringify(map), 'utf8').toString('base64');
			code += `\n/*# sourceMappingURL=${inline_sourcemap_header}${base64} */`;
		}

		fs.writeFileSync(`${asset_dir}/${output_file_name}`, code);

		result.main = output_file_name;
	}

	return result;
}

class RollupResult  {
	
	
	
	
	
	
	



	
	

	constructor(duration, compiler, sourcemap) {
		this.duration = duration;
		this.sourcemap = sourcemap;

		this.errors = compiler.errors.map(munge_warning_or_error);
		this.warnings = compiler.warnings.map(munge_warning_or_error); // TODO emit this as they happen

		this.chunks = compiler.chunks.map(chunk => ({
			file: chunk.fileName,
			imports: chunk.imports.filter(Boolean),
			modules: Object.keys(chunk.modules)
		}));

		this.css_files = compiler.css_files;

		// TODO populate this properly. We don't have named chunks, as in
		// webpack, but we can have a route -> [chunk] map or something
		this.assets = {};

		if (typeof compiler.input === 'string') {
			compiler.chunks.forEach(chunk => {
				if (compiler.input in chunk.modules) {
					this.assets.main = chunk.fileName;
				}
			});
		} else {
			for (const name in compiler.input) {
				const file = compiler.input[name];
				const chunk = compiler.chunks.find(chunk => file in chunk.modules);
				if (chunk) this.assets[name] = chunk.fileName;
			}
		}

		this.summary = compiler.chunks.map(chunk => {
			const size_color = chunk.code.length > 150000 ? __chunk_2.kleur.bold().red : chunk.code.length > 50000 ? __chunk_2.kleur.bold().yellow : __chunk_2.kleur.bold().white;
			const size_label = __chunk_2.left_pad(index.default(chunk.code.length), 10);

			const lines = [size_color(`${size_label} ${chunk.fileName}`)];

			const deps = Object.keys(chunk.modules)
				.map(file => {
					return {
						file: path.relative(process.cwd(), file),
						size: chunk.modules[file].renderedLength
					};
				})
				.filter(dep => dep.size > 0)
				.sort((a, b) => b.size - a.size);

			const total_unminified = deps.reduce((t, d) => t + d.size, 0);

			deps.forEach((dep, i) => {
				const c = i === deps.length - 1 ? '└' : '│';
				let line = `           ${c} ${dep.file}`;

				if (deps.length > 1) {
					const p = (100 * dep.size / total_unminified).toFixed(1);
					line += ` (${p}%)`;
				}

				lines.push(__chunk_2.kleur.gray(line));
			});

			return lines.join('\n');
		}).join('\n');
	}

	to_json(manifest_data, dirs) {
		// TODO extract_css has side-effects that don't belong
		// in a method called to_json
		return {
			bundler: 'rollup',
			shimport: require('shimport/package.json').version,
			assets: this.assets,
			css: extract_css(this, manifest_data.components, dirs, this.sourcemap)
		};
	}

	print() {
		const blocks = this.warnings.map(warning => {
			return warning.file
				? `> ${__chunk_2.kleur.bold(warning.file)}\n${warning.message}`
				: `> ${warning.message}`;
		});

		blocks.push(this.summary);

		return blocks.join('\n\n');
	}
}

function munge_warning_or_error(warning_or_error) {
	return {
		file: warning_or_error.filename,
		message: [warning_or_error.message, warning_or_error.frame].filter(Boolean).join('\n')
	};
}

let rollup;

class RollupCompiler {
	
	
	
	
	
	
	
	

	constructor(config) {
		this._ = this.get_config(config);
		this.input = null;
		this.warnings = [];
		this.errors = [];
		this.chunks = [];
		this.css_files = [];
	}

	async get_config(mod) {
		// TODO this is hacky, and doesn't need to apply to all three compilers
		(mod.plugins || (mod.plugins = [])).push({
			name: 'sapper-internal',
			options: (opts) => {
				this.input = opts.input;
			},
			renderChunk: (code, chunk) => {
				this.chunks.push(chunk);
			},
			transform: (code, id) => {
				if (/\.css$/.test(id)) {
					this.css_files.push({ id, code });
					return ``;
				}
			}
		});

		const onwarn = mod.onwarn || ((warning, handler) => {
			handler(warning);
		});

		mod.onwarn = (warning) => {
			onwarn(warning, (warning) => {
				this.warnings.push(warning);
			});
		};

		return mod;
	}

	oninvalid(cb) {
		this._oninvalid = cb;
	}

	async compile() {
		const config = await this._;
		const sourcemap = config.output.sourcemap;

		const start = Date.now();

		try {
			const bundle = await rollup.rollup(config);
			await bundle.write(config.output);

			return new RollupResult(Date.now() - start, this, sourcemap);
		} catch (err) {
			if (err.filename) {
				// TODO this is a bit messy. Also, can
				// Rollup emit other kinds of error?
				err.message = [
					`Failed to build — error in ${err.filename}: ${err.message}`,
					err.frame
				].filter(Boolean).join('\n');
			}

			throw err;
		}
	}

	async watch(cb) {
		const config = await this._;
		const sourcemap = config.output.sourcemap;

		const watcher = rollup.watch(config);

		watcher.on('change', (id) => {
			this.chunks = [];
			this.warnings = [];
			this.errors = [];
			this._oninvalid(id);
		});

		watcher.on('event', (event) => {
			switch (event.code) {
				case 'FATAL':
					// TODO kill the process?
					if (event.error.filename) {
						// TODO this is a bit messy. Also, can
						// Rollup emit other kinds of error?
						event.error.message = [
							`Failed to build — error in ${event.error.filename}: ${event.error.message}`,
							event.error.frame
						].filter(Boolean).join('\n');
					}

					cb(event.error);
					break;

				case 'ERROR':
					this.errors.push(event.error);
					cb(null, new RollupResult(Date.now() - this._start, this, sourcemap));
					break;

				case 'START':
				case 'END':
					// TODO is there anything to do with this info?
					break;

				case 'BUNDLE_START':
					this._start = Date.now();
					break;

				case 'BUNDLE_END':
					cb(null, new RollupResult(Date.now() - this._start, this, sourcemap));
					break;

				default:
					console.log(`Unexpected event ${event.code}`);
			}
		});
	}

	static async load_config(cwd) {
		if (!rollup) rollup = requireRelative_1('rollup', cwd);

		const input = path.resolve(cwd, 'rollup.config.js');

		const bundle = await rollup.rollup({
			input,
			inlineDynamicImports: true,
			external: (id) => {
				return (id[0] !== '.' && !path.isAbsolute(id)) || id.slice(-5, id.length) === '.json';
			}
		});

		const resp = await bundle.generate({ format: 'cjs' });
		const { code } = resp.output ? resp.output[0] : resp;

		// temporarily override require
		const defaultLoader = require.extensions['.js'];
		require.extensions['.js'] = (module, filename) => {
			if (filename === input) {
				module._compile(code, filename);
			} else {
				defaultLoader(module, filename);
			}
		};

		const config = require(input);
		delete require.cache[input];

		return config;
	}
}

/**
 * This has been adapted from `create-react-app`, authored by Facebook, Inc.
 * see: https://github.com/facebookincubator/create-react-app/tree/master/packages/react-dev-utils
 */



const errorLabel = 'Syntax error:';
const isLikelyASyntaxError = str => str.includes(errorLabel);

const exportRegex = /\s*(.+?)\s*(")?export '(.+?)' was not found in '(.+?)'/;
const stackRegex = /^\s*at\s((?!webpack:).)*:\d+:\d+[\s\)]*(\n|$)/gm;

function formatMessage(message, isError) {
  let lines = message.split('\n');

  if (lines.length > 2 && lines[1] === '') {
    lines.splice(1, 1); // Remove extra newline.
  }

  // Remove loader notation from filenames:
  //   `./~/css-loader!./src/App.css` ~~> `./src/App.css`
  if (lines[0].lastIndexOf('!') !== -1) {
    lines[0] = lines[0].substr(lines[0].lastIndexOf('!') + 1);
  }

	// Remove useless `entry` filename stack details
  lines = lines.filter(line => line.indexOf(' @ ') !== 0);

  // 0 ~> filename; 1 ~> main err msg
  if (!lines[0] || !lines[1]) {
    return lines.join('\n');
  }

  // Cleans up verbose "module not found" messages for files and packages.
  if (lines[1].startsWith('Module not found: ')) {
    lines = [
      lines[0],
      lines[1] // "Module not found: " is enough detail
        .replace("Cannot resolve 'file' or 'directory' ", '')
        .replace('Cannot resolve module ', '')
        .replace('Error: ', '')
        .replace('[CaseSensitivePathsPlugin] ', '')
    ];
  }

  // Cleans up syntax error messages.
  if (lines[1].startsWith('Module build failed: ')) {
    lines[1] = lines[1].replace('Module build failed: SyntaxError:', errorLabel);
  }

  if (lines[1].match(exportRegex)) {
    lines[1] = lines[1].replace(exportRegex, "$1 '$4' does not contain an export named '$3'.");
  }

  lines[0] = __chunk_2.kleur.inverse(lines[0]);

  // Reassemble & Strip internal tracing, except `webpack:` -- (create-react-app/pull/1050)
  return lines.join('\n').replace(stackRegex, '').trim();
}

var webpackFormatMessages = function (stats) {
	const json = stats.toJson({}, true);

	const result = {
		errors: json.errors.map(msg => formatMessage(msg)),
		warnings: json.warnings.map(msg => formatMessage(msg))
	};

	// Only show syntax errors if we have them
  if (result.errors.some(isLikelyASyntaxError)) {
    result.errors = result.errors.filter(isLikelyASyntaxError);
  }

  // First error is usually it; others usually the same
  if (result.errors.length > 1) {
    result.errors.length = 1;
  }

  return result;
};

var formatMessage_1 = formatMessage;
webpackFormatMessages.formatMessage = formatMessage_1;

const locPattern = /\((\d+):(\d+)\)$/;

function munge_warning_or_error$1(message) {
	// TODO this is all a bit rube goldberg...
	const lines = message.split('\n');

	const file = lines.shift()
		.replace('[7m', '') // careful — there is a special character at the beginning of this string
		.replace('[27m', '')
		.replace('./', '');

	let line = null;
	let column = null;

	const match = locPattern.exec(lines[0]);
	if (match) {
		lines[0] = lines[0].replace(locPattern, '');
		line = +match[1];
		column = +match[2];
	}

	return {
		file,
		message: lines.join('\n')
	};
}

class WebpackResult  {
	
	
	
	
	
	
	

	constructor(stats) {
		this.stats = stats;

		const info = stats.toJson();

		const messages = webpackFormatMessages(stats);

		this.errors = messages.errors.map(munge_warning_or_error$1);
		this.warnings = messages.warnings.map(munge_warning_or_error$1);

		this.duration = info.time;

		this.chunks = info.assets.map((chunk) => ({ file: chunk.name }));
		this.assets = info.assetsByChunkName;
	}

	to_json(manifest_data, dirs) {
		const extract_css = (assets) => {
			assets = Array.isArray(assets) ? assets : [assets];
			return assets.find(asset => /\.css$/.test(asset));
		};

		return {
			bundler: 'webpack',
			shimport: null, // webpack has its own loader
			assets: this.assets,
			css: {
				main: extract_css(this.assets.main),
				chunks: manifest_data.components
					.reduce((chunks, component) => {
						const css_dependencies = [];
						const css = extract_css(this.assets[component.name]);

						if (css) css_dependencies.push(css);

						chunks[component.file] = css_dependencies;

						return chunks;
					}, {})
			}
		};
	}

	print() {
		return this.stats.toString({ colors: true });
	}
}

let webpack;

class WebpackCompiler {
	

	constructor(config) {
		if (!webpack) webpack = requireRelative_1('webpack', process.cwd());
		this._ = webpack(config);
	}

	oninvalid(cb) {
		this._.hooks.invalid.tap('sapper', cb);
	}

	compile() {
		return new Promise((fulfil, reject) => {
			this._.run((err, stats) => {
				if (err) {
					reject(err);
					process.exit(1);
				}

				const result = new WebpackResult(stats);

				if (result.errors.length) {
					console.error(stats.toString({ colors: true }));
					reject(new Error(`Encountered errors while building app`));
				}

				else {
					fulfil(result);
				}
			});
		});
	}

	watch(cb) {
		this._.watch({}, (err, stats) => {
			cb(err, stats && new WebpackResult(stats));
		});
	}
}

async function create_compilers(
	bundler,
	cwd,
	src,
	dest,
	dev
) {
	__chunk_3.set_dev(dev);
	__chunk_3.set_src(src);
	__chunk_3.set_dest(dest);

	if (bundler === 'rollup') {
		const config = await RollupCompiler.load_config(cwd);
		validate_config(config, 'rollup');

		normalize_rollup_config(config.client);
		normalize_rollup_config(config.server);

		if (config.serviceworker) {
			normalize_rollup_config(config.serviceworker);
		}

		return {
			client: new RollupCompiler(config.client),
			server: new RollupCompiler(config.server),
			serviceworker: config.serviceworker && new RollupCompiler(config.serviceworker)
		};
	}

	if (bundler === 'webpack') {
		const config = require(path.resolve(cwd, 'webpack.config.js'));
		validate_config(config, 'webpack');

		return {
			client: new WebpackCompiler(config.client),
			server: new WebpackCompiler(config.server),
			serviceworker: config.serviceworker && new WebpackCompiler(config.serviceworker)
		};
	}

	// this shouldn't be possible...
	throw new Error(`Invalid bundler option '${bundler}'`);
}

function validate_config(config, bundler) {
	if (!config.client || !config.server) {
		throw new Error(`${bundler}.config.js must export a { client, server, serviceworker? } object`);
	}
}

function normalize_rollup_config(config) {
	if (typeof config.input === 'string') {
		config.input = path.normalize(config.input);
	} else {
		for (const name in config.input) {
			config.input[name] = path.normalize(config.input[name]);
		}
	}
}

function create_manifest_data(cwd, extensions = '.svelte .html') {

	const component_extensions = extensions.split(' ');

	// TODO remove in a future version
	if (!fs.existsSync(cwd)) {
		throw new Error(`As of Sapper 0.21, the routes/ directory should become src/routes/`);
	}

	function has_preload(file) {
		const source = fs.readFileSync(path.join(cwd, file), 'utf-8');

		if (/preload/.test(source)) {
			try {
				const { vars } = svelte.compile(source.replace(/<style\b[^>]*>[^]*?<\/style>/g, ''), { generate: false });
				return vars.some((variable) => variable.module && variable.export_name === 'preload');
			} catch (err) {}
		}

		return false;
	}

	function find_layout(file_name, component_name, dir = '') {
		const ext = component_extensions.find((ext) => fs.existsSync(path.join(cwd, dir, `${file_name}${ext}`)));
		const file = __chunk_2.posixify(path.join(dir, `${file_name}${ext}`));

		return ext
			? {
				name: component_name,
				file: file,
				has_preload: has_preload(file)
			}
			: null;
	}

	const components = [];
	const pages = [];
	const server_routes = [];

	const default_layout = {
		default: true,
		type: 'layout',
		name: '_default_layout',
		file: null,
		has_preload: false
	};

	const default_error = {
		default: true,
		type: 'error',
		name: '_default_error',
		file: null,
		has_preload: false
	};

	function walk(
		dir,
		parent_segments,
		parent_params,
		stack



	) {
		const items = fs.readdirSync(dir)
			.map(basename => {
				const resolved = path.join(dir, basename);
				const file = path.relative(cwd, resolved);
				const is_dir = fs.statSync(resolved).isDirectory();

				const ext = path.extname(basename);

				if (basename[0] === '_') return null;
				if (basename[0] === '.' && basename !== '.well-known') return null;
				if (!is_dir && !/^\.[a-z]+$/i.test(ext)) return null; // filter out tmp files etc

				const segment = is_dir
					? basename
					: basename.slice(0, -ext.length);

				const parts = get_parts(segment);
				const is_index = is_dir ? false : basename.startsWith('index.');
				const is_page = component_extensions.indexOf(ext) !== -1;
				const route_suffix = basename.slice(basename.indexOf('.'), -ext.length);

				parts.forEach(part => {
					if (/\]\[/.test(part.content)) {
						throw new Error(`Invalid route ${file} — parameters must be separated`);
					}

					if (part.qualifier && /[\(\)\?\:]/.test(part.qualifier.slice(1, -1))) {
						throw new Error(`Invalid route ${file} — cannot use (, ), ? or : in route qualifiers`);
					}
				});

				return {
					basename,
					ext,
					parts,
					file: __chunk_2.posixify(file),
					is_dir,
					is_index,
					is_page,
					route_suffix
				};
			})
			.filter(Boolean)
			.sort(comparator);

		items.forEach(item => {
			const segments = parent_segments.slice();

			if (item.is_index) {
				if (item.route_suffix) {
					if (segments.length > 0) {
						const last_segment = segments[segments.length - 1].slice();
						const last_part = last_segment[last_segment.length - 1];

						if (last_part.dynamic) {
							last_segment.push({ dynamic: false, content: item.route_suffix });
						} else {
							last_segment[last_segment.length - 1] = {
								dynamic: false,
								content: `${last_part.content}${item.route_suffix}`
							};
						}

						segments[segments.length - 1] = last_segment;
					} else {
						segments.push(item.parts);
					}
				}
			} else {
				segments.push(item.parts);
			}

			const params = parent_params.slice();
			params.push(...item.parts.filter(p => p.dynamic).map(p => p.content));

			if (item.is_dir) {
				const component = find_layout('_layout', `${get_slug(item.file)}__layout`, item.file);

				if (component) components.push(component);

				walk(
					path.join(dir, item.basename),
					segments,
					params,
					component
						? stack.concat({ component, params })
						: stack.concat(null)
				);
			}

			else if (item.is_page) {
				const component = {
					name: get_slug(item.file),
					file: item.file,
					has_preload: has_preload(item.file)
				};

				components.push(component);

				const parts = (item.is_index && stack[stack.length - 1] === null)
					? stack.slice(0, -1).concat({ component, params })
					: stack.concat({ component, params });

				pages.push({
					pattern: get_pattern(segments, true),
					parts
				});
			}

			else {
				server_routes.push({
					name: `route_${get_slug(item.file)}`,
					pattern: get_pattern(segments, !item.route_suffix),
					file: item.file,
					params: params
				});
			}
		});
	}

	const root = find_layout('_layout', 'main') || default_layout;
	const error = find_layout('_error', 'error') || default_error;

	walk(cwd, [], [], []);

	// check for clashes
	const seen_pages = new Map();
	pages.forEach(page => {
		const pattern = page.pattern.toString();
		if (seen_pages.has(pattern)) {
			const file = page.parts.pop().component.file;
			const other_page = seen_pages.get(pattern);
			const other_file = other_page.parts.pop().component.file;

			throw new Error(`The ${other_file} and ${file} pages clash`);
		}

		seen_pages.set(pattern, page);
	});

	const seen_routes = new Map();
	server_routes.forEach(route => {
		const pattern = route.pattern.toString();
		if (seen_routes.has(pattern)) {
			const other_route = seen_routes.get(pattern);
			throw new Error(`The ${other_route.file} and ${route.file} routes clash`);
		}

		seen_routes.set(pattern, route);
	});

	return {
		root,
		error,
		components,
		pages,
		server_routes
	};
}








function is_spread(path) {
	const spread_pattern = /\[\.{3}/g;
	return spread_pattern.test(path)
}

function comparator(
	a,
	b
) {
	if (a.is_index !== b.is_index) {
		if (a.is_index) return is_spread(a.file) ? 1 : -1;

		return is_spread(b.file) ? -1 : 1;
	}

	const max = Math.max(a.parts.length, b.parts.length);

	for (let i = 0; i < max; i += 1) {
		const a_sub_part = a.parts[i];
		const b_sub_part = b.parts[i];

		if (!a_sub_part) return 1; // b is more specific, so goes first
		if (!b_sub_part) return -1;

		// if spread && index, order later
		if (a_sub_part.spread && b_sub_part.spread) {
			return a.is_index ? 1 : -1
		}

		// If one is ...spread order it later
		if (a_sub_part.spread !== b_sub_part.spread) return a_sub_part.spread ? 1 : -1;

		if (a_sub_part.dynamic !== b_sub_part.dynamic) {
			return a_sub_part.dynamic ? 1 : -1;
		}

		if (!a_sub_part.dynamic && a_sub_part.content !== b_sub_part.content) {
			return (
				(b_sub_part.content.length - a_sub_part.content.length) ||
				(a_sub_part.content < b_sub_part.content ? -1 : 1)
			);
		}

		// If both parts dynamic, check for regexp patterns
		if (a_sub_part.dynamic && b_sub_part.dynamic) {
			const regexp_pattern = /\((.*?)\)/;
			const a_match = regexp_pattern.exec(a_sub_part.content);
			const b_match = regexp_pattern.exec(b_sub_part.content);

			if (!a_match && b_match) {
				return 1; // No regexp, so less specific than b
			}
			if (!b_match && a_match) {
				return -1;
			}
			if (a_match && b_match && a_match[1] !== b_match[1]) {
				return b_match[1].length - a_match[1].length;
			}
		}
	}
}

function get_parts(part) {
	return part.split(/\[(.+)\]/)
		.map((str, i) => {
			if (!str) return null;
			const dynamic = i % 2 === 1;

			const [, content, qualifier] = dynamic
				? /([^(]+)(\(.+\))?$/.exec(str)
				: [, str, null];

			return {
				content,
				dynamic,
				spread: /^\.{3}.+$/.test(content),
				qualifier
			};
		})
		.filter(Boolean);
}

function get_slug(file) {
	let name = file
		.replace(/[\\\/]index/, '')
		.replace(/[\/\\]/g, '_')
		.replace(/\.\w+$/, '')
		.replace(/\[([^(]+)(?:\([^(]+\))?\]/, '$$$1')
		.replace(/[^a-zA-Z0-9_$]/g, c => {
			return c === '.' ? '_' : `$${c.charCodeAt(0)}`
		});

	if (__chunk_2.reserved_words.has(name)) name += '_';
	return name;
}

function get_pattern(segments, add_trailing_slash) {
	const path = segments.map(segment => {
		return segment.map(part => {
			return part.dynamic
				? part.qualifier || (part.spread ? '(.+)' : '([^\\/]+?)')
				: encodeURI(part.content.normalize())
					.replace(/\?/g, '%3F')
					.replace(/#/g, '%23')
					.replace(/%5B/g, '[')
					.replace(/%5D/g, ']');
		}).join('');
	}).join('\\/');

	const trailing = add_trailing_slash && segments.length ? '\\/?$' : '$';

	return new RegExp(`^\\/${path}${trailing}`);
}

exports.create_app = create_app;
exports.create_compilers = create_compilers;
exports.create_manifest_data = create_manifest_data;
exports.create_serviceworker_manifest = create_serviceworker_manifest;
//# sourceMappingURL=core.js.map
