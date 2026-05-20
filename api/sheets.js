// api/sheets.js — Lector de la planilla pública "A3 Info" (Matba Rofex / Primary)
// Fuente: https://docs.google.com/spreadsheets/d/1j-ZrWBO-fCkGUPqWtWRsGgGswMRCm2mnMhsPmX6osLI
//
// Uso:
//   /api/sheets?tab=financiero      → Dólar futuro (DLR + otros financieros)
//   /api/sheets?tab=agropecuarios   → Futuros agrícolas MATba (soja, maíz, trigo, girasol)
//   /api/sheets?tab=home            → Spot internacional (Soja Chicago, Maíz Chicago, WTI, Oro)
//   /api/sheets?tab=<key>&raw=1     → Devuelve también las filas crudas (debug)

const SHEET_ID  = '1j-ZrWBO-fCkGUPqWtWRsGgGswMRCm2mnMhsPmX6osLI';
const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}`;

const TABS = {
  home:          { gid: 1523589361, name: 'Home' },
  instrumentos:  { gid: 219973338,  name: 'Instrumentos' },
  activos:       { gid: 999017548,  name: 'Activos Aceptados' },
  fci:           { gid: 1554958349, name: 'Mercado FCI' },
  financiero:    { gid: 2027743157, name: 'Resumen - Financiero' },
  agropecuarios: { gid: 527444289,  name: 'Resumen - Agropecuarios' },
};

// ─── CSV parser (maneja comillas, comas escapadas, saltos de línea) ───
function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], n = text[i + 1];
    if (inQ) {
      if (c === '"' && n === '"') { field += '"'; i++; }
      else if (c === '"') { inQ = false; }
      else { field += c; }
    } else {
      if (c === '"') { inQ = true; }
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\r') { /* skip */ }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else { field += c; }
    }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function num(v) {
  if (v === null || v === undefined || v === '' || v === 'N/A') return null;
  // Asume formato US (1234.56). Si Google exporta con coma decimal, también lo soporta.
  let s = String(v).trim();
  if (/^-?\d{1,3}(\.\d{3})+,\d+$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d+,\d+$/.test(s)) s = s.replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// "DLR052026" → {mes:5, año:2026}
// "SOJ.ROS/MAY26" → {mes:5, año:2026}
// "ORO052026" → {mes:5, año:2026}
const MES3 = { ene:1,feb:2,mar:3,abr:4,may:5,jun:6,jul:7,ago:8,sep:9,oct:10,nov:11,dic:12,
               jan:1,apr:4,aug:8,dec:12 };
function parseContrato(contrato) {
  if (!contrato) return null;
  const s = String(contrato).toUpperCase();
  // Formato 1: PREFIJO + MMYYYY  (ej DLR052026, ORO052026)
  let m = s.match(/(\d{2})(\d{4})$/);
  if (m) return { mes: +m[1], año: +m[2] };
  // Formato 2: PREFIJO + /MES_LETRAS + YY  (ej SOJ.ROS/MAY26)
  m = s.match(/\/([A-Z]{3})(\d{2})$/);
  if (m) {
    const mes = MES3[m[1].toLowerCase()];
    if (mes) return { mes, año: 2000 + +m[2] };
  }
  return null;
}

// ─── Parsers por pestaña ───
function parseFinanciero(rows) {
  // Headers en r2: Contrato, Fecha Venc, Producto, Margen, Moneda, TipoInstr, Put/Call,
  //                Ajuste/Valor teórico, Vol Operado, Interés Abierto, Var I.A. vs T-1, Fecha Datos, Última Act
  const data = [];
  for (let i = 3; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r[0]) continue;
    const contrato = String(r[0]).trim();
    if (!contrato || contrato === 'Contrato') continue;
    const parsed = parseContrato(contrato);
    data.push({
      contrato,
      vencimiento:     r[1] || null,
      producto:        r[2] || null,
      moneda:          r[4] || null,
      tipo:            r[5] || null,
      precio:          num(r[7]),
      volumen:         num(r[8]),
      interesAbierto:  num(r[9]),
      mes:             parsed?.mes ?? null,
      año:             parsed?.año ?? null,
    });
  }
  return {
    fuente:        'A3 Info · Resumen Financiero (Matba Rofex)',
    fuenteUrl:     `${SHEET_URL}/edit#gid=${TABS.financiero.gid}`,
    actualizado:   rows[3]?.[12] || null,
    contratos:     data,
    dolares:       data.filter(d => d.producto === 'DLR'),
  };
}

function parseAgropecuarios(rows) {
  const data = [];
  for (let i = 3; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r[0]) continue;
    const contrato = String(r[0]).trim();
    if (!contrato || contrato === 'Contrato') continue;
    const parsed = parseContrato(contrato);
    data.push({
      contrato,
      vencimiento:     r[1] || null,
      producto:        r[2] || null,
      moneda:          r[4] || null,
      tipo:            r[5] || null,
      precio:          num(r[7]),
      volumen:         num(r[8]),
      interesAbierto:  num(r[9]),
      mes:             parsed?.mes ?? null,
      año:             parsed?.año ?? null,
    });
  }
  return {
    fuente:      'A3 Info · Resumen Agropecuarios (Matba Rofex)',
    fuenteUrl:   `${SHEET_URL}/edit#gid=${TABS.agropecuarios.gid}`,
    actualizado: rows[3]?.[12] || null,
    contratos:   data,
    // Agrupados por producto base
    soja:   data.filter(d => /^SOJ/.test(d.contrato)),
    maiz:   data.filter(d => /^MAI/.test(d.contrato)),
    trigo:  data.filter(d => /^TRI/.test(d.contrato)),
    girasol:data.filter(d => /^GIR/.test(d.contrato)),
  };
}

function parseHome(rows) {
  // Defensivo: busca celdas que coincidan con nombres SPOT conocidos en cualquier columna/fila,
  // y toma el siguiente valor numérico como precio. Inmune a cambios de layout en la planilla.
  const SPOT_PATTERNS = [
    { rx: /^petr[oó]leo crudo wti cme$/i, key: 'wti',   unit: 'USD/bbl' },
    { rx: /^soja chicago$/i,              key: 'soja',  unit: 'USD/Tn'  },
    { rx: /^ma[ií]z chicago$/i,           key: 'maiz',  unit: 'USD/Tn'  },
    { rx: /^trigo chicago$/i,             key: 'trigo', unit: 'USD/Tn'  },
    { rx: /^oro cme$/i,                   key: 'oro',   unit: 'USD/oz'  },
  ];

  const spot = [];
  const seen = new Set();
  let ultimaAct = null;

  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    for (let i = 0; i < row.length; i++) {
      const cell = String(row[i] || '').trim();
      if (!cell) continue;
      const pat = SPOT_PATTERNS.find(p => p.rx.test(cell));
      if (!pat || seen.has(pat.key)) continue;

      // Próximo valor numérico en la misma fila
      let valor = null, fechaCotizacion = null;
      for (let j = i + 1; j < row.length; j++) {
        const v = row[j];
        if (v === '' || v === null || v === undefined) continue;
        const n = num(v);
        if (n !== null && valor === null) { valor = n; continue; }
        if (n === null && valor !== null && !fechaCotizacion) {
          fechaCotizacion = String(v).trim();
          break;
        }
      }

      if (valor !== null) {
        seen.add(pat.key);
        spot.push({
          nombre: cell,
          key: pat.key,
          unit: pat.unit,
          valor,
          fechaCotizacion,
        });
      }
      break;  // una coincidencia por fila
    }

    // Capturar timestamp de "Fecha y Hora de Última Actualización" si aparece
    if (!ultimaAct) {
      const found = row?.find(c => typeof c === 'string' && /^\d{1,2}-\d{1,2}-\d{4}\s*\|/.test(c));
      if (found) ultimaAct = found;
    }
  }

  return {
    fuente:      'A3 Info · Home / Cotizaciones SPOT (Matba Rofex)',
    fuenteUrl:   `${SHEET_URL}/edit#gid=${TABS.home.gid}`,
    actualizado: ultimaAct,
    spot,
  };
}

// Genérico para tabs sin parser específico
function parseGeneric(rows, tabKey) {
  return {
    fuente:    `A3 Info · ${TABS[tabKey].name} (Matba Rofex)`,
    fuenteUrl: `${SHEET_URL}/edit#gid=${TABS[tabKey].gid}`,
    rows,
  };
}

// ─── Handler ───
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const tabKey = String(req.query.tab || '').toLowerCase();
  const debug  = req.query.raw === '1' || req.query.debug === '1';

  if (!TABS[tabKey]) {
    return res.status(400).json({
      error: 'tab inválido',
      validos: Object.keys(TABS),
    });
  }

  const csvUrl = `${SHEET_URL}/gviz/tq?tqx=out:csv&gid=${TABS[tabKey].gid}`;

  try {
    const r = await fetch(csvUrl, {
      headers: { 'Accept': 'text/csv,text/plain' },
    });
    if (!r.ok) {
      return res.status(502).json({
        error: `Google Sheets HTTP ${r.status}`,
        url: csvUrl,
      });
    }
    const text = await r.text();
    if (text.startsWith('<') || /<!DOCTYPE/i.test(text)) {
      return res.status(502).json({
        error: 'Respuesta no es CSV (¿la planilla dejó de ser pública?)',
        preview: text.substring(0, 300),
      });
    }

    const rows = parseCSV(text);

    let data;
    switch (tabKey) {
      case 'financiero':    data = parseFinanciero(rows);    break;
      case 'agropecuarios': data = parseAgropecuarios(rows); break;
      case 'home':          data = parseHome(rows);          break;
      default:              data = parseGeneric(rows, tabKey);
    }

    if (debug) data.raw = rows;
    data.licencia = 'Planilla pública A3 Info — propiedad de Matba Rofex / Primary. Datos provistos vía Argentina Clearing API REST de BackOffice.';

    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({
      error: err.message,
      url: csvUrl,
    });
  }
}
