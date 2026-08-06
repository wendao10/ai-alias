const Module = require('module');
const orig = Module._load;
Module._load = function (req, ...args) {
	if (req === 'obsidian') {
		return {
			Plugin: class {},
			PluginSettingTab: class {},
			Setting: class {},
			Notice: class {},
			Modal: class {},
			Editor: class {},
			App: class {}
		};
	}
	return orig.call(this, req, ...args);
};

const AIAliasPlugin = require('./main.js').default;
const plugin = Object.create(AIAliasPlugin.prototype);
plugin.settings = {
	prefix: '[[',
	suffix: ']]',
	language: 'en',
	mappings: [
		{ real: 'TianShu Cloud', code: 'PROJ_02' },
		{ real: 'TianShu', code: 'PROJ_01' },
		{ real: 'North Ocean Dept', code: 'ORG_A' }
	]
};

const input = 'We deployed TianShu on TianShu Cloud, owned by North Ocean Dept.';
const enc = plugin.encrypt(input);
console.log('ENC:', enc);
const dec = plugin.decrypt(enc);
console.log('DEC:', dec);
console.log('roundtrip ok:', dec === input);
console.log('nested ok:', enc.includes('[[PROJ_02]]') && !enc.includes('[[PROJ_01]] Cloud'));
