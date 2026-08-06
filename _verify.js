const AIAliasPlugin = require('./main.js').default;

// minimal mock
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

// nested check: TianShu Cloud must become PROJ_02, NOT PROJ_01-wrapped
console.log('nested ok:', enc.includes('[[PROJ_02]]') && !enc.includes('[[PROJ_01]] Cloud'));
