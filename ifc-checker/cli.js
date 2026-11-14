/* Command-line check: node cli.js model.ifc [phase] [--csv issues.csv] [--ids path/to/IDS.json]
   phase defaults to Final. Reads the file as a stream, so large models are fine. */
const fs = require('fs');
const path = require('path');
const core = require('./core');
const { compact } = require('./rules');

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : null; };
const csv = opt('--csv');
const idsPath = opt('--ids') || path.join(__dirname, '..', 'dmbim.buildingcardgenerator', 'dmbim.buildingcardgenerator', 'InfoDeliverySpecs', 'Resources', 'IDS.json');
const file = args[0];
if (!file) { console.error('Usage: node cli.js model.ifc [Preliminary|Final|Inspection] [--csv issues.csv] [--ids IDS.json]'); process.exit(2); }

const rules = compact(idsPath);
const phase = Math.max(0, rules.phases.findIndex((p) => p.toLowerCase() === (args[1] || 'Final').toLowerCase()));
const parser = core.createParser(core.elementTypes(rules));
const t0 = Date.now();

fs.createReadStream(file, { encoding: 'utf8', highWaterMark: 1 << 22 })
  .on('data', (c) => parser.feed(c))
  .on('error', (e) => { console.error(e.message); process.exit(2); })
  .on('end', () => {
    const result = core.evaluate(parser.finish(), rules);
    const s = core.summarize(result, phase);
    console.log(`${path.basename(file)} · ${result.schema || 'unknown schema'} · ${result.records} records · ${result.ruleSet} rules · ${rules.phases[phase]} stage · ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    console.log(`${s.failing} of ${s.elements} checked elements are missing required properties (${s.missing} missing values, ${s.warn} values of the wrong kind, ${s.typeAdv} with an unlisted type)\n`);
    const pad = (v, n) => String(v).padEnd(n);
    console.log(pad('Element', 24) + pad('In model', 10) + pad('Incomplete', 12) + pad('Missing', 9) + 'Most often missing');
    s.groups.forEach((g) => {
      const top = core.topMissing(g, 3).map((p) => `${p[0]} (${p[1]})`).join(', ');
      console.log(pad(g.g.name, 24) + pad(g.n, 10) + pad(g.fail, 12) + pad(g.miss, 9) + top);
    });
    const other = Object.keys(result.other);
    if (other.length) console.log('\nNot covered by the rule file: ' + other.map((k) => `${k} ×${result.other[k]}`).join(', '));
    if (csv) {
      const esc = (v) => (/[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v));
      fs.writeFileSync(csv, '﻿' + core.issueRows(s).map((r) => r.map(esc).join(',')).join('\r\n'));
      console.log('\nIssues written to ' + csv);
    }
    process.exit(s.failing ? 1 : 0);
  });
