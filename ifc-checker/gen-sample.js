/* Writes sample.ifc: a small properties-only IFC4 example (no geometry) with deliberate gaps,
   used as the demo the page opens with and as the test model for cli.js. */
const fs = require('fs');
const path = require('path');
const { compact } = require('./rules');

const idsPath = process.argv[2] || path.join(__dirname, '..', 'dmbim.buildingcardgenerator', 'dmbim.buildingcardgenerator', 'InfoDeliverySpecs', 'Resources', 'IDS.json');
const rules = compact(idsPath);
const ver = rules.versions.find((v) => v.name === 'IFC4');
const group = (name) => ver.groups.find((g) => g.name === name);

let n = 0;
const lines = [];
const add = (s) => { lines.push('#' + (++n) + '=' + s + ';'); return n; };
const q = (s) => (s === null || s === undefined ? '$' : "'" + String(s).replace(/'/g, "''") + "'");
let gidN = 0;
const gid = () => q('0DMexample' + String(++gidN).padStart(12, '0'));

function value(a, bad) {
  const t = a[3].toLowerCase();
  if (bad) return "IFCLABEL('2 hours')";
  if (t === 'bool') return 'IFCBOOLEAN(.T.)';
  if (t === 'int') return 'IFCINTEGER(60)';
  if (t === 'double') return 'IFCREAL(1.5)';
  if (t === 'date') return "IFCLABEL('2021-01-01')";
  return 'IFCLABEL(' + q((a[4] || 'Sample').split(',')[0].trim() || 'Sample') + ')';
}

// opts: omit [property names], blank [property names], dropSets [pset names], bad [property names]
function psets(el, g, opts) {
  const by = new Map();
  g.attrs.forEach((a) => {
    if (/ attribute$/.test(a[0]) || (opts.dropSets || []).includes(a[0]) || (opts.omit || []).includes(a[2])) return;
    if (!by.has(a[0])) by.set(a[0], []);
    by.get(a[0]).push(a);
  });
  by.forEach((attrs, name) => {
    const isQ = /^Qto_/.test(name);
    const ids = attrs.map((a) => isQ
      ? add('IFCQUANTITYLENGTH(' + q(a[2]) + ',$,$,1.5,$)')
      : add('IFCPROPERTYSINGLEVALUE(' + q(a[2]) + ',$,' + ((opts.blank || []).includes(a[2]) ? '$' : value(a, (opts.bad || []).includes(a[2]))) + ',$)'));
    const list = '(' + ids.map((i) => '#' + i).join(',') + ')';
    const ps = isQ ? add('IFCELEMENTQUANTITY(' + gid() + ',$,' + q(name) + ',$,$,' + list + ')') : add('IFCPROPERTYSET(' + gid() + ',$,' + q(name) + ',$,' + list + ')');
    add('IFCRELDEFINESBYPROPERTIES(' + gid() + ',$,$,$,(#' + el + '),#' + ps + ')');
  });
}

const project = add('IFCPROJECT(' + gid() + ",$,'Example villa',$,$,$,$,$,$)");
psets(project, group('Project'), {});
const site = add('IFCSITE(' + gid() + ",$,'Plot',$,$,$,$,$,.ELEMENT.,$,$,$,$,$)");
psets(site, group('Topography (Site)'), {});
const addr = add("IFCPOSTALADDRESS($,$,$,$,('Al Example Street'),$,'Dubai',$,$,'UAE')");
const building = add('IFCBUILDING(' + gid() + ",$,'Villa','G+1 villa',$,$,$,'1',.ELEMENT.,$,$,#" + addr + ')');
psets(building, group('Building'), { omit: ['OccupancyUsageCode'], blank: ['FireProtectionClass'] });
const storeys = ['Ground Floor', 'First Floor'].map((nm, i) => {
  const s = add('IFCBUILDINGSTOREY(' + gid() + ',$,' + q(nm) + ',$,$,$,$,$,.ELEMENT.,' + (i * 3.6).toFixed(1) + ')');
  psets(s, group('Storey'), i ? { omit: ['TotalNetArea'] } : {});
  return s;
});
add('IFCRELAGGREGATES(' + gid() + ',$,$,$,#' + project + ',(#' + site + '))');
add('IFCRELAGGREGATES(' + gid() + ',$,$,$,#' + site + ',(#' + building + '))');
add('IFCRELAGGREGATES(' + gid() + ',$,$,$,#' + building + ',(' + storeys.map((s) => '#' + s).join(',') + '))');

const placed = [[], []];
let tag = 348100;
function el(groupName, entity, name, storey, tail, objType, opts) {
  const id = add(entity + '(' + gid() + ',$,' + q(name) + ',$,' + q(objType) + ',$,$,' + q(++tag) + tail + ')');
  psets(id, group(groupName), opts || {});
  placed[storey].push(id);
  return id;
}

el('Wall', 'IFCWALL', 'Basic Wall:Ext 250 Block', 0, ',.SOLIDWALL.', null, {});
el('Wall', 'IFCWALL', 'Basic Wall:Ext 250 Block', 0, ',.SOLIDWALL.', null, { omit: ['FireRating'] });
el('Wall', 'IFCWALL', 'Basic Wall:Int 150 Block', 0, ',.PARTITIONING.', null, { omit: ['FireRating', 'AcousticRating'], bad: ['ThermalTransmittance'] });
el('Wall', 'IFCWALL', 'Basic Wall:Int 150 Block', 1, ',.PARTITIONING.', null, { dropSets: ['Building Permit'] });
el('Wall', 'IFCWALL', 'Basic Wall:Parapet 200', 1, ',.PARAPET.', null, {});
el('Wall', 'IFCWALLSTANDARDCASE', 'Basic Wall:Garden wall', 0, ',.USERDEFINED.', 'GARDENWALL', { blank: ['Color'] });
el('Door', 'IFCDOOR', 'Single-Flush:900x2100', 0, ',2.1,0.9,.USERDEFINED.,$,$', 'MAINENTRANCEDOOR', {});
el('Door', 'IFCDOOR', 'Single-Flush:800x2100', 0, ',2.1,0.8,.USERDEFINED.,$,$', 'BATHROOMDOOR', { omit: ['DoorClearWidth', 'HandicapAccessible'] });
el('Door', 'IFCDOOR', 'Single-Flush:800x2100', 1, ',2.1,0.8,.DOOR.,$,$', null, { omit: ['DoorClearWidth'], bad: ['FireRating'] });
el('Door', 'IFCDOOR', 'Sliding-2 Panel:1800x2400', 1, ',2.4,1.8,.USERDEFINED.,$,$', 'BALCONYDOOR', {});
el('Floor (Slabs)', 'IFCSLAB', 'Floor:RC Slab 200', 0, ',.BASESLAB.', null, {});
el('Floor (Slabs)', 'IFCSLAB', 'Floor:RC Slab 200', 1, ',.FLOOR.', null, { omit: ['CompressiveStrength', 'LoadBearing'] });
el('Column', 'IFCCOLUMN', 'RC Column:300x600', 0, ',.COLUMN.', null, {});
el('Column', 'IFCCOLUMN', 'RC Column:300x600', 0, ',.COLUMN.', null, { dropSets: ['Pset_ConcreteElementGeneral'] });
el('Window', 'IFCWINDOW', 'Fixed:1200x1500', 1, ',1.5,1.2,.WINDOW.,$,$', null, { omit: ['ThermalTransmittance'] });
add('IFCBUILDINGELEMENTPROXY(' + gid() + ",$,'Generic Model:Planter',$,$,$,$,'348200',$)");
placed.forEach((ids, i) => add('IFCRELCONTAINEDINSPATIALSTRUCTURE(' + gid() + ',$,$,$,(' + ids.map((x) => '#' + x).join(',') + '),#' + storeys[i] + ')'));

const out = ['ISO-10303-21;', 'HEADER;', "FILE_DESCRIPTION(('Properties-only example for the DM IFC checker'),'2;1');", "FILE_NAME('example-villa.ifc','2026-01-01T00:00:00',(''),(''),'','','');", "FILE_SCHEMA(('IFC4'));", 'ENDSEC;', 'DATA;']
  .concat(lines, ['ENDSEC;', 'END-ISO-10303-21;']).join('\n') + '\n';
fs.writeFileSync(path.join(__dirname, 'sample.ifc'), out);
console.log('sample.ifc written:', lines.length, 'records,', out.length, 'bytes');
