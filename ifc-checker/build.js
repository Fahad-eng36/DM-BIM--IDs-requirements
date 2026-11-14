/* Builds the checker page from IDS.json:  node build.js [path/to/IDS.json]
   Writes ../DM-IFC-Checker.html (open it directly in a browser), dist/checker.html (the copy hosted next to
   index.html in the GitHub repository) and dist/artifact.html (the same page for publishing as an artifact).
   Re-run after installing a new version of the DM tools so the page picks up the new rule file. */
const fs = require('fs');
const path = require('path');
const { compact } = require('./rules');

const idsPath = process.argv[2] || path.join(__dirname, '..', 'dmbim.buildingcardgenerator', 'dmbim.buildingcardgenerator', 'InfoDeliverySpecs', 'Resources', 'IDS.json');
const rules = compact(idsPath);
const safe = (s) => s.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');
const read = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');

const page = read('template.html')
  .replace('/*__RULES__*/', () => safe(JSON.stringify(rules)))
  .replace('/*__SAMPLE__*/', () => safe(read('sample.ifc')))
  .replace('/*__CORE__*/', () => safe(read('core.js')));
const [head, body] = page.split('<!--BODY-->');
// Where "requirements browser" in the footer points: the published artifact, or index.html when both pages are hosted together.
const ARTIFACT = 'https://claude.ai/artifact/41vVvbBpsTtst7pKKHyLBk';
const link = (s, url) => s.replace('/*__BROWSER_URL__*/', url);
const wrap = (b) => '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n' + head + '</head>\n<body>\n' + b + '</body>\n</html>\n';

fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'dist', 'artifact.html'), head + link(body, ARTIFACT));
fs.writeFileSync(path.join(__dirname, 'dist', 'checker.html'), wrap(link(body, 'index.html'))); // for the GitHub repository, next to index.html
const standalone = wrap(link(body, ARTIFACT));
const out = path.join(__dirname, '..', 'DM-IFC-Checker.html');
fs.writeFileSync(out, standalone);

const count = rules.versions.map((v) => v.name + ': ' + v.groups.length + ' element groups, ' + v.groups.reduce((n, g) => n + g.attrs.length, 0) + ' properties').join('; ');
console.log('Rules schema v' + rules.schema + ' · ' + count);
console.log('Wrote ' + out + ' (' + Math.round(standalone.length / 1024) + ' KB)');
