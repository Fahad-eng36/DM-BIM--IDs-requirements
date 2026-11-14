/* DM IFC checker core: reads an IFC (STEP) file as text and checks element properties
   against the compact rule set that build.js produces from IDS.json.
   Works in the browser (window.DMCheck) and in Node (require). No dependencies. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DMCheck = factory();
})(this, function () {
  'use strict';

  // Occurrence types that are checked as their parent type.
  var ALIAS = {
    IFCWALLSTANDARDCASE: 'IFCWALL', IFCWALLELEMENTEDCASE: 'IFCWALL', IFCBEAMSTANDARDCASE: 'IFCBEAM',
    IFCCOLUMNSTANDARDCASE: 'IFCCOLUMN', IFCSLABSTANDARDCASE: 'IFCSLAB', IFCSLABELEMENTEDCASE: 'IFCSLAB',
    IFCDOORSTANDARDCASE: 'IFCDOOR', IFCWINDOWSTANDARDCASE: 'IFCWINDOW', IFCMEMBERSTANDARDCASE: 'IFCMEMBER',
    IFCPLATESTANDARDCASE: 'IFCPLATE'
  };
  // IFC2x3 has no IfcTank / IfcWasteTerminal occurrences; they are recognised through their type object.
  var VIA_TYPE = { IFCFLOWTERMINAL: { IFCWASTETERMINALTYPE: 'IFCWASTETERMINAL' }, IFCFLOWSTORAGEDEVICE: { IFCTANKTYPE: 'IFCTANK' } };
  // Position of PredefinedType in the occurrence's argument list (default 8).
  var PRE_IDX = { IFCDOOR: 10, IFCWINDOW: 10, IFCSTAIRFLIGHT: 12, IFCELEMENTASSEMBLY: 9, IFCSPACE: 9 };
  var NO_PRE = { IFCPROJECT: 1, IFCSITE: 1, IFCBUILDING: 1, IFCBUILDINGSTOREY: 1 };
  // Common element types the rule file does not cover; counted so the report can say so.
  var UNCHECKED = {};
  ['IfcBuildingElementProxy', 'IfcFurnishingElement', 'IfcFurniture', 'IfcSanitaryTerminal', 'IfcFlowTerminal', 'IfcFlowSegment',
    'IfcFlowFitting', 'IfcFlowStorageDevice', 'IfcShadingDevice', 'IfcChimney', 'IfcBuildingElementPart', 'IfcDiscreteAccessory',
    'IfcReinforcingBar', 'IfcGeographicElement'].forEach(function (n) { UNCHECKED[n.toUpperCase()] = n; });
  var REC = /^\s*#(\d+)\s*=\s*([A-Za-z0-9_]+)\s*\(/;

  function decode(s) {
    if (s.indexOf('\\') === -1) return s;
    return s
      .replace(/\\X2\\([0-9A-Fa-f]+)\\X0\\/g, function (m, h) { var o = ''; for (var i = 0; i + 4 <= h.length; i += 4) o += String.fromCharCode(parseInt(h.substr(i, 4), 16)); return o; })
      .replace(/\\X4\\([0-9A-Fa-f]+)\\X0\\/g, function (m, h) { var o = ''; for (var i = 0; i + 8 <= h.length; i += 8) o += String.fromCodePoint(parseInt(h.substr(i, 8), 16)); return o; })
      .replace(/\\X\\([0-9A-Fa-f]{2})/g, function (m, h) { return String.fromCharCode(parseInt(h, 16)); })
      .replace(/\\S\\(.)/g, function (m, c) { return String.fromCharCode(c.charCodeAt(0) + 128); })
      .replace(/\\\\/g, '\\');
  }

  // Parses a STEP argument list starting just after its opening parenthesis.
  // null = $ or *, string, number, {r: id}, {e: 'ENUM'}, {t: 'IFCTYPE', v: value}, or a nested array.
  function parseList(s, i) {
    var out = [], n = s.length, c, j, k;
    while (i < n) {
      c = s.charCodeAt(i);
      if (c === 32 || c === 44 || c === 10 || c === 13 || c === 9) { i++; continue; }
      if (c === 41) return [out, i + 1];
      if (c === 36 || c === 42) { out.push(null); i++; continue; }
      if (c === 39) {
        var str = ''; j = i + 1;
        for (;;) {
          k = s.indexOf("'", j);
          if (k < 0) { str += s.slice(j); j = n; break; }
          str += s.slice(j, k);
          if (s.charCodeAt(k + 1) === 39) { str += "'"; j = k + 2; } else { j = k + 1; break; }
        }
        out.push(decode(str)); i = j; continue;
      }
      if (c === 35) {
        j = i + 1; while (j < n && (k = s.charCodeAt(j)) >= 48 && k <= 57) j++;
        out.push({ r: +s.slice(i + 1, j) }); i = j; continue;
      }
      if (c === 46 && (k = s.charCodeAt(i + 1)) >= 65 && k <= 122) {
        k = s.indexOf('.', i + 1); if (k < 0) k = n;
        out.push({ e: s.slice(i + 1, k).toUpperCase() }); i = k + 1; continue;
      }
      if (c === 40) { var r = parseList(s, i + 1); out.push(r[0]); i = r[1]; continue; }
      if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122)) {
        j = i; while (j < n && /[A-Za-z0-9_]/.test(s.charAt(j))) j++;
        var t = s.slice(i, j).toUpperCase();
        while (j < n && s.charCodeAt(j) <= 32) j++;
        if (s.charCodeAt(j) === 40) { var r2 = parseList(s, j + 1); out.push({ t: t, v: r2[0].length ? r2[0][0] : null }); i = r2[1]; }
        else { out.push({ e: t }); i = j; }
        continue;
      }
      j = i; while (j < n && /[0-9+\-.Ee]/.test(s.charAt(j))) j++;
      if (j === i) { i++; continue; }
      out.push(parseFloat(s.slice(i, j))); i = j;
    }
    return [out, i];
  }

  function refs(v) {
    var out = [];
    if (Array.isArray(v)) { for (var i = 0; i < v.length; i++) if (v[i] && v[i].r !== undefined) out.push(v[i].r); }
    else if (v && v.r !== undefined) out.push(v.r);
    return out;
  }
  function str(v) { return typeof v === 'string' ? v : (v && typeof v.v === 'string' ? v.v : null); }
  function en(v) { return v && v.e ? v.e : null; }
  // Unwraps IFCLABEL('x'), IFCBOOLEAN(.T.), IFCREAL(1.) and so on to a plain JS value; undefined = no value.
  function plain(v) {
    if (v === null || v === undefined) return undefined;
    if (v.t !== undefined) return plain(v.v);
    if (v.e !== undefined) return v.e === 'T' || v.e === 'TRUE' ? true : v.e === 'F' || v.e === 'FALSE' ? false : v.e === 'U' || v.e === 'UNKNOWN' ? undefined : v.e;
    if (Array.isArray(v)) { var a = v.map(plain).filter(function (x) { return x !== undefined && x !== ''; }); return a.length ? a.join(', ') : undefined; }
    if (v.r !== undefined) return '#' + v.r;
    if (typeof v === 'string') return v.trim() === '' ? undefined : v;
    return v;
  }

  function createParser(elementTypes) {
    var wanted = {};
    elementTypes.forEach(function (t) { wanted[t.toUpperCase()] = 1; });
    var m = {
      schema: '', records: 0, elements: [], psets: new Map(), props: new Map(), types: new Map(),
      relProps: new Map(), typeOf: new Map(), contained: new Map(), aggParent: new Map(), addresses: new Map(), other: {}
    };
    var buf = '', scan = 0, inStr = false;

    function record(s) {
      var x = REC.exec(s);
      if (!x) {
        if (!m.schema) { var f = /FILE_SCHEMA\s*\(\s*\(\s*'([^']+)'/i.exec(s); if (f) m.schema = f[1].toUpperCase(); }
        return;
      }
      m.records++;
      var raw = x[2].toUpperCase(), id = +x[1], canon = ALIAS[raw] || raw, a;
      if (wanted[canon] || VIA_TYPE[raw]) {
        a = parseList(s, x[0].length)[0];
        var spatial = canon === 'IFCSPACE' || NO_PRE[canon];
        var pre = NO_PRE[canon] ? null : en(a[PRE_IDX[canon] || 8]);
        m.elements.push({
          id: id, raw: raw, canon: canon, gid: str(a[0]) || '', name: str(a[2]) || '', desc: str(a[3]),
          objType: str(a[4]), tag: spatial ? '' : (str(a[7]) || ''), longName: spatial ? str(a[canon === 'IFCPROJECT' ? 5 : 7]) : null,
          pre: pre, addr: canon === 'IFCBUILDING' && a[11] && a[11].r !== undefined ? a[11].r : null
        });
        return;
      }
      if (raw === 'IFCPROPERTYSINGLEVALUE') { a = parseList(s, x[0].length)[0]; m.props.set(id, [str(a[0]) || '', plain(a[2])]); return; }
      if (raw === 'IFCPROPERTYENUMERATEDVALUE' || raw === 'IFCPROPERTYLISTVALUE') { a = parseList(s, x[0].length)[0]; m.props.set(id, [str(a[0]) || '', plain(a[2])]); return; }
      if (raw.lastIndexOf('IFCQUANTITY', 0) === 0) { a = parseList(s, x[0].length)[0]; m.props.set(id, [str(a[0]) || '', plain(a[3])]); return; }
      if (raw === 'IFCPROPERTYBOUNDEDVALUE' || raw === 'IFCPROPERTYTABLEVALUE' || raw === 'IFCPROPERTYREFERENCEVALUE' || raw === 'IFCCOMPLEXPROPERTY' || raw === 'IFCPHYSICALCOMPLEXQUANTITY') {
        a = parseList(s, x[0].length)[0]; m.props.set(id, [str(a[0]) || '', '(complex value)']); return;
      }
      if (raw === 'IFCPROPERTYSET') { a = parseList(s, x[0].length)[0]; m.psets.set(id, { n: (str(a[2]) || '').trim(), p: refs(a[4]) }); return; }
      if (raw === 'IFCELEMENTQUANTITY') { a = parseList(s, x[0].length)[0]; m.psets.set(id, { n: (str(a[2]) || '').trim(), p: refs(a[5]) }); return; }
      if (raw === 'IFCRELDEFINESBYPROPERTIES') {
        a = parseList(s, x[0].length)[0];
        var defs = refs(a[5]);
        refs(a[4]).forEach(function (o) { var l = m.relProps.get(o); if (!l) m.relProps.set(o, l = []); for (var i = 0; i < defs.length; i++) l.push(defs[i]); });
        return;
      }
      if (raw === 'IFCRELDEFINESBYTYPE') { a = parseList(s, x[0].length)[0]; var tr = refs(a[5])[0]; if (tr !== undefined) refs(a[4]).forEach(function (o) { m.typeOf.set(o, tr); }); return; }
      if (raw === 'IFCRELCONTAINEDINSPATIALSTRUCTURE') { a = parseList(s, x[0].length)[0]; var st = refs(a[5])[0]; if (st !== undefined) refs(a[4]).forEach(function (o) { m.contained.set(o, st); }); return; }
      if (raw === 'IFCRELAGGREGATES') { a = parseList(s, x[0].length)[0]; var pa = refs(a[4])[0]; if (pa !== undefined) refs(a[5]).forEach(function (o) { m.aggParent.set(o, pa); }); return; }
      if (raw === 'IFCPOSTALADDRESS') {
        a = parseList(s, x[0].length)[0];
        m.addresses.set(id, a.some(function (v, i) { return i >= 3 && plain(v) !== undefined; })); return;
      }
      if (raw === 'IFCDOORSTYLE' || raw === 'IFCWINDOWSTYLE' || (raw.length > 7 && raw.slice(-4) === 'TYPE')) {
        a = parseList(s, x[0].length)[0];
        if (a.length < 6) return;
        var isStyle = raw.slice(-5) === 'STYLE';
        m.types.set(id, { raw: raw, psets: refs(a[5]), pre: isStyle ? null : en(a[9]), etype: isStyle ? null : str(a[8]) });
        return;
      }
      if (UNCHECKED[raw]) m.other[raw] = (m.other[raw] || 0) + 1;
    }

    return {
      feed: function (chunk) {
        buf += chunk;
        var start = 0, i = scan, n = buf.length, c;
        for (; i < n; i++) {
          c = buf.charCodeAt(i);
          if (c === 39) inStr = !inStr;
          else if (c === 59 && !inStr) { record(buf.slice(start, i)); start = i + 1; }
        }
        buf = start ? buf.slice(start) : buf;
        scan = buf.length;
      },
      finish: function () { if (buf.trim()) record(buf); buf = ''; return m; }
    };
  }

  function norm(s) { return String(s || '').trim().toLowerCase(); }
  function up(s) { return s ? String(s).trim().toUpperCase() : null; }

  // 0 = fine, 4 = has a value but it does not read as the expected data type.
  function checkValue(v, type) {
    var t = norm(type), s = typeof v === 'string' ? v.trim() : v;
    if (t === 'bool') return typeof v === 'boolean' || (typeof s === 'string' && /^(yes|no|true|false|y|n|1|0)$/i.test(s)) || v === 1 || v === 0 ? 0 : 4;
    if (t === 'int') return (typeof v === 'number' && Math.abs(v - Math.round(v)) < 1e-9) || (typeof s === 'string' && /^[-+]?\d+(\.0+)?$/.test(s)) ? 0 : 4;
    if (t === 'double') return typeof v === 'number' || (typeof s === 'string' && s !== '' && isFinite(Number(s))) ? 0 : 4;
    if (t === 'date') return typeof v === 'number' || (typeof s === 'string' && !isNaN(Date.parse(s))) || /^\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}/.test(String(s)) ? 0 : 4;
    return 0;
  }

  function subMatches(sub, P, O) {
    var X = sub[0], ovr = sub[1], loose = !P || P === 'USERDEFINED' || P === 'NOTDEFINED';
    if (X === 'NOTFOUND') return true;
    if (!ovr) return P === X || (loose && O === X);
    return O === ovr && (P === X || loose);
  }

  /* Status codes per element and rule attribute:
     0 ok · 1 property set not on the element · 2 property not in the set · 3 no value · 4 value does not read as the expected type */
  function evaluate(model, rules) {
    var is2x3 = /2X3/.test(model.schema || '');
    var ver = rules.versions.filter(function (v) { return /2x3/i.test(v.name) === is2x3; })[0] || rules.versions[rules.versions.length - 1];
    var byType = {}, results = [], byId = new Map(), other = {};
    Object.keys(model.other).forEach(function (k) { other[k] = model.other[k]; });
    ver.groups.forEach(function (g) {
      var r = { name: g.name, type: g.type, subs: g.subs, attrs: g.attrs, elements: [], anyType: g.subs.some(function (s) { return s[0] === 'NOTFOUND'; }) };
      results.push(r);
      (byType[g.type.toUpperCase()] = byType[g.type.toUpperCase()] || []).push(r);
    });
    model.elements.forEach(function (e) { byId.set(e.id, e); });

    var psetCache = new Map();
    function pset(id) {
      var c = psetCache.get(id);
      if (c !== undefined) return c;
      var p = model.psets.get(id);
      if (!p) { psetCache.set(id, null); return null; }
      var map = new Map();
      for (var i = 0; i < p.p.length; i++) { var pr = model.props.get(p.p[i]); if (pr) { var k = norm(pr[0]); if (!map.has(k) || map.get(k) === undefined) map.set(k, pr[1]); } }
      c = { name: norm(p.n), map: map };
      psetCache.set(id, c);
      return c;
    }
    function storeyOf(e) {
      if (NO_PRE[e.canon]) return '';
      var id = e.id, hop = 0, p;
      while (hop++ < 8) {
        p = model.contained.get(id); if (p === undefined) p = model.aggParent.get(id);
        if (p === undefined) return '';
        var n = byId.get(p);
        if (n && n.canon === 'IFCBUILDINGSTOREY') return n.name;
        if (n && (n.canon === 'IFCBUILDING' || n.canon === 'IFCSITE')) return n.name ? '(' + n.name + ')' : '';
        id = p;
      }
      return '';
    }

    model.elements.forEach(function (e) {
      var tid = model.typeOf.get(e.id), tobj = tid !== undefined ? model.types.get(tid) : null, canon = e.canon;
      if (VIA_TYPE[e.raw]) {
        canon = tobj && VIA_TYPE[e.raw][tobj.raw];
        if (!canon) { other[e.raw] = (other[e.raw] || 0) + 1; return; }
      }
      var cands = byType[canon];
      if (!cands) return;
      var P = e.pre && e.pre !== 'NOTDEFINED' ? e.pre : (tobj && tobj.pre && tobj.pre !== 'NOTDEFINED' ? tobj.pre : (e.pre || null));
      var O = up(e.objType) || up(tobj && tobj.etype);
      var g = null, typeOk = 0, i;
      for (i = 0; i < cands.length && !g; i++) if (cands[i].anyType || cands[i].subs.some(function (s) { return subMatches(s, P, O); })) g = cands[i];
      if (!g) { g = cands[cands.length - 1]; typeOk = P && P !== 'NOTDEFINED' ? 1 : 0; } // no explicit type (usual in IFC2x3) is not flagged

      var ids = (model.relProps.get(e.id) || []).concat(tobj ? tobj.psets : []), sets = [];
      for (i = 0; i < ids.length; i++) { var ps = pset(ids[i]); if (ps) sets.push(ps); }
      var st = new Uint8Array(g.attrs.length);
      for (i = 0; i < g.attrs.length; i++) {
        var a = g.attrs[i], code;
        if (/ attribute$/i.test(a[0])) {
          var ref = norm(a[2]), val = ref === 'description' ? e.desc : ref === 'longname' ? e.longName : ref === 'buildingaddress' ? (e.addr !== null && model.addresses.get(e.addr) ? 'address' : null) : undefined;
          code = val === undefined || val === null || String(val).trim() === '' ? 3 : (ref === 'buildingaddress' ? 0 : checkValue(val, a[3]));
        } else {
          var want = norm(a[0]), alt = want.lastIndexOf('qto_', 0) === 0 ? 'basequantities' : null, k1 = norm(a[2]), k2 = norm(a[1]);
          code = 1;
          for (var j = 0; j < sets.length; j++) {
            if (sets[j].name !== want && sets[j].name !== alt) continue;
            var mp = sets[j].map, key = mp.has(k1) ? k1 : mp.has(k2) ? k2 : null;
            if (key === null) { if (code === 1) code = 2; continue; }
            var v = mp.get(key);
            if (v === undefined) { if (code < 3) code = 3; continue; }
            code = checkValue(v, a[3]); break;
          }
        }
        st[i] = code;
      }
      g.elements.push({ id: e.id, name: e.name, gid: e.gid, tag: e.tag, P: P, O: O, storey: storeyOf(e), st: st, typeOk: typeOk });
    });

    var pretty = {};
    Object.keys(other).forEach(function (k) { if (other[k]) pretty[UNCHECKED[k] || k] = other[k]; });
    other = pretty;
    return { schema: model.schema, ruleSet: ver.name, records: model.records, phases: rules.phases, groups: results.filter(function (g) { return g.elements.length; }), other: other };
  }

  // Rolls a result up for one phase (index into rules.phases).
  function summarize(result, ph) {
    var out = { phase: ph, elements: 0, failing: 0, missing: 0, warn: 0, typeAdv: 0, required: 0, groups: [] };
    result.groups.forEach(function (g) {
      var req = [], i, j;
      for (i = 0; i < g.attrs.length; i++) if (g.attrs[i][5].charAt(ph) === '1') req.push(i);
      var s = { g: g, req: req, n: g.elements.length, fail: 0, miss: 0, warn: 0, typeAdv: 0, perAttr: new Int32Array(g.attrs.length), perWarn: new Int32Array(g.attrs.length) };
      for (j = 0; j < g.elements.length; j++) {
        var e = g.elements[j], bad = 0;
        for (i = 0; i < req.length; i++) {
          var c = e.st[req[i]];
          if (c >= 1 && c <= 3) { bad++; s.perAttr[req[i]]++; } else if (c === 4) { s.warn++; s.perWarn[req[i]]++; }
        }
        if (bad) { s.fail++; s.miss += bad; }
        if (e.typeOk) s.typeAdv++;
      }
      out.elements += s.n; out.failing += s.fail; out.missing += s.miss; out.warn += s.warn; out.typeAdv += s.typeAdv; out.required += req.length;
      out.groups.push(s);
    });
    return out;
  }

  // The most frequently missing property names of a group summary, merged across property sets.
  function topMissing(s, n) {
    var best = {};
    s.req.forEach(function (i) { var k = s.g.attrs[i][2]; if (s.perAttr[i] > (best[k] || 0)) best[k] = s.perAttr[i]; });
    return Object.keys(best).sort(function (a, b) { return best[b] - best[a]; }).slice(0, n).map(function (k) { return [k, best[k]]; });
  }

  var PROBLEM = ['', 'Property set not found', 'Property not found', 'No value', 'Value does not read as the expected type'];

  // One row per problem, for export.
  function issueRows(summary, onlyGroup) {
    var rows = [['Element', 'IFC type', 'Name', 'Revit ID', 'GlobalId', 'Storey', 'Property set', 'Property', 'Expected type', 'Problem']];
    summary.groups.forEach(function (s) {
      if (onlyGroup && s.g !== onlyGroup) return;
      s.g.elements.forEach(function (e) {
        s.req.forEach(function (i) {
          var c = e.st[i]; if (!c) return;
          var a = s.g.attrs[i];
          rows.push([s.g.name, s.g.type, e.name, e.tag, e.gid, e.storey, a[0], (a[2] || a[1]).trim(), a[3], PROBLEM[c]]);
        });
      });
    });
    return rows;
  }

  function elementTypes(rules) {
    var t = {};
    rules.versions.forEach(function (v) { v.groups.forEach(function (g) { t[g.type] = 1; }); });
    return Object.keys(t);
  }

  function checkText(text, rules) {
    var p = createParser(elementTypes(rules));
    p.feed(text);
    return evaluate(p.finish(), rules);
  }

  return { createParser: createParser, evaluate: evaluate, summarize: summarize, issueRows: issueRows, topMissing: topMissing, elementTypes: elementTypes, checkText: checkText, PROBLEM: PROBLEM, parseList: parseList };
});
