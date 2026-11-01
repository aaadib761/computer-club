// Turns a list (columns + rows) into a downloadable CSV or Excel (.xlsx) file.
// The .xlsx is built by hand (it's a zip of a few XML files), so no extra package is needed.
const zlib = require('zlib');

function cellText(value) {
    return value === null || value === undefined ? '' : String(value);
}

// ---------- CSV ----------

function csvCell(value) {
    let text = cellText(value);
    // stop spreadsheet apps from running text that looks like a formula
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
}

function toCsv(columns, rows) {
    const lines = [columns.map(c => csvCell(c.label)).join(','),
        ...rows.map(row => columns.map(c => csvCell(row[c.key])).join(','))];
    // the BOM makes Excel read Bangla and other non-English text correctly
    return Buffer.from('﻿' + lines.join('\r\n'), 'utf8');
}

// ---------- Excel ----------

function xml(text) {
    return cellText(text)
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')   // characters XML doesn't allow
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// A1-style column letters: 0 -> A, 25 -> Z, 26 -> AA
function columnName(index) {
    let name = '';
    for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
    return name;
}

function sheetXml(columns, rows) {
    // wide enough for the longest value, within reason
    const widths = columns.map(c => Math.min(60, Math.max(8,
        cellText(c.label).length + 2, ...rows.map(r => cellText(r[c.key]).length + 2))));
    const row = (values, r, style) => `<row r="${r}">${values.map((v, i) =>
        `<c r="${columnName(i)}${r}" t="inlineStr"${style}><is><t xml:space="preserve">${xml(v)}</t></is></c>`).join('')}</row>`;
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        + '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
        + `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>`
        + '<sheetData>'
        + row(columns.map(c => c.label), 1, ' s="1"')
        + rows.map((r, i) => row(columns.map(c => r[c.key]), i + 2, '')).join('')
        + '</sheetData>'
        + (rows.length ? `<autoFilter ref="A1:${columnName(columns.length - 1)}${rows.length + 1}"/>` : '')
        + '</worksheet>';
}

function toXlsx(sheetName, columns, rows) {
    // sheet names can't have : \ / ? * [ ] and are at most 31 characters
    const name = xml(cellText(sheetName).replace(/[:\\/?*[\]]/g, ' ').slice(0, 31) || 'Sheet1');
    return zip({
        '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            + '<Default Extension="xml" ContentType="application/xml"/>'
            + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
            + '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
            + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
            + '</Types>',
        '_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
            + '</Relationships>',
        'xl/workbook.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
            + `<sheets><sheet name="${name}" sheetId="1" r:id="rId1"/></sheets>`
            + '</workbook>',
        'xl/_rels/workbook.xml.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
            + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
            + '</Relationships>',
        // style 0 = normal, style 1 = bold header with a light fill
        'xl/styles.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
            + '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
            + '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>'
            + '<fill><patternFill patternType="solid"><fgColor rgb="FFFDE3D2"/><bgColor indexed="64"/></patternFill></fill></fills>'
            + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
            + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
            + '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
            + '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs>'
            + '</styleSheet>',
        'xl/worksheets/sheet1.xml': sheetXml(columns, rows),
    });
}

// A plain zip file (deflate), enough for the few files an .xlsx needs.
function zip(files) {
    const locals = [];
    const centrals = [];
    let offset = 0;
    for (const [path, content] of Object.entries(files)) {
        const name = Buffer.from(path, 'utf8');
        const data = Buffer.from(content, 'utf8');
        const packed = zlib.deflateRawSync(data);
        const crc = zlib.crc32(data);

        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4);            // version needed
        local.writeUInt16LE(0x0800, 6);        // names are UTF-8
        local.writeUInt16LE(8, 8);             // deflate
        local.writeUInt32LE(0, 10);            // time + date (not needed)
        local.writeUInt32LE(crc, 14);
        local.writeUInt32LE(packed.length, 18);
        local.writeUInt32LE(data.length, 22);
        local.writeUInt16LE(name.length, 26);
        local.writeUInt16LE(0, 28);
        locals.push(local, name, packed);

        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014b50, 0);
        central.writeUInt16LE(20, 4);          // made by
        central.writeUInt16LE(20, 6);          // version needed
        central.writeUInt16LE(0x0800, 8);
        central.writeUInt16LE(8, 10);
        central.writeUInt32LE(0, 12);
        central.writeUInt32LE(crc, 16);
        central.writeUInt32LE(packed.length, 20);
        central.writeUInt32LE(data.length, 24);
        central.writeUInt16LE(name.length, 28);
        central.writeUInt32LE(offset, 42);     // where this file's local header starts
        centrals.push(central, name);

        offset += local.length + name.length + packed.length;
    }
    const centralSize = centrals.reduce((sum, b) => sum + b.length, 0);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(centrals.length / 2, 8);
    end.writeUInt16LE(centrals.length / 2, 10);
    end.writeUInt32LE(centralSize, 12);
    end.writeUInt32LE(offset, 16);
    return Buffer.concat([...locals, ...centrals, end]);
}

module.exports = { toCsv, toXlsx };
