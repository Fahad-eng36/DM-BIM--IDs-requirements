/* Turns the checker's IDS.json into the compact rule set the IFC checker uses.
   attribute tuple: [propertySet, name, ifcReference, dataType, sample, phaseBits] */
const fs = require('fs');

function compact(idsPath) {
  const ids = JSON.parse(fs.readFileSync(idsPath, 'utf8').replace(/^﻿/, ''));
  let phases = null;
  const tuple = (a) => {
    if (!phases) phases = a.Phases.map((p) => p.Name);
    return [(a.PropertySet || '').trim(), (a.Name || '').trim(), (a.IfcReference || a.Name || '').trim(), a.DataType || 'string', a.DataSample || '', a.Phases.map((p) => (p.IsRequired ? '1' : '0')).join('')];
  };
  const versions = ids.IfcVersionSchemas.map((v) => {
    const common = {};
    v.CommonSchemas.forEach((c) => { common[c.IfcType] = c.Attributes || []; });
    return {
      name: v.Name,
      groups: v.EntityGroups.map((g) => {
        const seen = new Set(), attrs = [];
        (common[g.IfcType] || []).concat((g.SpecificSchema && g.SpecificSchema.Attributes) || []).forEach((a) => {
          const t = tuple(a), k = (t[0] + '|' + t[2]).toLowerCase();
          if (!seen.has(k)) { seen.add(k); attrs.push(t); }
        });
        return {
          name: g.Name, type: g.IfcType,
          subs: (g.SubTypes || []).map((s) => [(s.PredefinedType || '').toUpperCase(), (s.ObjectTypeOverride || '').toUpperCase()]),
          attrs
        };
      })
    };
  });
  return { schema: ids.SchemaVersion, phases, versions };
}

module.exports = { compact };
